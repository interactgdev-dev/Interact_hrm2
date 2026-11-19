using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Application = System.Windows.Forms.Application;

namespace InteractGuard;

/// <summary>
/// Aggregates keyboard activity metrics by foreground app.
/// Counts key-downs and typing/idle durations only — never stores key codes or text.
/// </summary>
public sealed class KeyboardActivityService : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const uint WmQuit = 0x0012;
    private const int TypingGapMs = 2500;
    private const int FlushSeconds = 45;

    private readonly AppSettings _settings;
    private readonly object _gate = new();
    private readonly Dictionary<string, Bucket> _buckets = new(StringComparer.OrdinalIgnoreCase);

    private LowLevelKeyboardProc? _proc;
    private IntPtr _hookId = IntPtr.Zero;
    private Thread? _hookThread;
    private int _hookNativeThreadId;
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private volatile bool _hookReady;

    private DateTime _periodStartUtc = DateTime.UtcNow;
    private string _batchId = Guid.NewGuid().ToString("N");
    private string _currentAppKey = "";
    private FgInfo? _currentFg;
    private DateTime? _lastKeyUtc;
    private DateTime _sliceStartUtc = DateTime.UtcNow;

    private Action<string>? _onStatus;
    private Action<string, string, bool>? _onNotify;

    public KeyboardActivityService(AppSettings settings)
    {
        _settings = settings;
    }

    public void BindUi(Action<string> onStatus, Action<string, string, bool> onNotify)
    {
        _onStatus = onStatus;
        _onNotify = onNotify;
    }

    public bool IsCollecting
    {
        get
        {
            lock (_gate)
            {
                return _loop != null && !_loop.IsCompleted &&
                       _settings.AdminEnabled &&
                       !string.IsNullOrWhiteSpace(_settings.EmployeeId);
            }
        }
    }

    public void SyncFromSettings()
    {
        var shouldRun = _settings.AdminEnabled &&
                        !string.IsNullOrWhiteSpace(_settings.EmployeeId);
        if (shouldRun) Start();
        else Stop(flush: true);
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_loop != null && !_loop.IsCompleted) return;
            _cts = new CancellationTokenSource();
            ResetPeriodUnlocked();
            EnsureHookThread();
            _loop = Task.Run(() => LoopAsync(_cts.Token));
        }

        _onStatus?.Invoke("Keyboard metrics ON (counts only — no typed text)");
    }

    public void Stop(bool flush = false)
    {
        CancellationTokenSource? cts;
        Task? loop;
        lock (_gate)
        {
            cts = _cts;
            loop = _loop;
            _cts = null;
            _loop = null;
        }

        try { cts?.Cancel(); } catch { /* ignore */ }
        try { loop?.Wait(TimeSpan.FromSeconds(3)); } catch { /* ignore */ }
        try { cts?.Dispose(); } catch { /* ignore */ }

        if (flush)
        {
            try
            {
                FlushAsync(force: true, CancellationToken.None).GetAwaiter().GetResult();
            }
            catch { /* ignore */ }
        }

        TeardownHook();
        _onStatus?.Invoke("Keyboard metrics OFF");
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        await Task.Delay(1500, ct).ConfigureAwait(false);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!_settings.AdminEnabled || string.IsNullOrWhiteSpace(_settings.EmployeeId))
                {
                    await Task.Delay(2000, ct).ConfigureAwait(false);
                    continue;
                }

                var fg = ReadForeground();
                var appChanged = false;
                if (fg != null)
                {
                    var key = AppKey(fg);
                    lock (_gate)
                    {
                        if (!string.Equals(_currentAppKey, key, StringComparison.Ordinal))
                        {
                            CloseCurrentSliceUnlocked(DateTime.UtcNow);
                            _currentAppKey = key;
                            _currentFg = fg;
                            _sliceStartUtc = DateTime.UtcNow;
                            _lastKeyUtc = null;
                            appChanged = true;
                        }
                        else
                        {
                            _currentFg = fg;
                        }
                    }
                }

                // Flush on app change when keystrokes were recorded, else on the 45s timer.
                await FlushAsync(force: appChanged && HasKeystrokeMetrics(), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                /* keep looping */
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private bool HasKeystrokeMetrics()
    {
        lock (_gate) return _buckets.Values.Any(b => b.KeyDownCount > 0);
    }

    /// <summary>Called from the LL keyboard hook — never reads or stores key identity.</summary>
    private void OnKeyDown()
    {
        if (!_settings.AdminEnabled || string.IsNullOrWhiteSpace(_settings.EmployeeId))
            return;

        var now = DateTime.UtcNow;
        var fg = ReadForeground() ?? new FgInfo { AppName = "Unknown" };
        var appKey = AppKey(fg);

        lock (_gate)
        {
            if (!string.Equals(_currentAppKey, appKey, StringComparison.Ordinal))
            {
                CloseCurrentSliceUnlocked(now);
                _currentAppKey = appKey;
                _currentFg = fg;
                _sliceStartUtc = now;
                _lastKeyUtc = null;
            }
            else
            {
                _currentFg = fg;
            }

            var bucket = GetOrCreateBucketUnlocked(fg);
            if (_lastKeyUtc.HasValue)
            {
                var gapMs = (long)Math.Max(0, (now - _lastKeyUtc.Value).TotalMilliseconds);
                if (gapMs <= TypingGapMs)
                    bucket.TypingActiveMs += gapMs;
                else
                    bucket.KeyboardIdleMs += gapMs;
            }
            else
            {
                var idle = (long)Math.Max(0, (now - _sliceStartUtc).TotalMilliseconds);
                if (idle > 0) bucket.KeyboardIdleMs += idle;
            }

            bucket.KeyDownCount += 1;
            _lastKeyUtc = now;
        }
    }

    private void CloseCurrentSliceUnlocked(DateTime now)
    {
        if (_currentFg == null) return;
        var bucket = GetOrCreateBucketUnlocked(_currentFg);
        if (_lastKeyUtc.HasValue)
        {
            var gapMs = (long)Math.Max(0, (now - _lastKeyUtc.Value).TotalMilliseconds);
            if (gapMs > TypingGapMs)
                bucket.KeyboardIdleMs += gapMs;
            else if (gapMs > 0)
                bucket.TypingActiveMs += gapMs;
        }
        else
        {
            var idle = (long)Math.Max(0, (now - _sliceStartUtc).TotalMilliseconds);
            if (idle > 0) bucket.KeyboardIdleMs += idle;
        }
    }

    private Bucket GetOrCreateBucketUnlocked(FgInfo fg)
    {
        if (!_buckets.TryGetValue(fg.AppName, out var b))
        {
            b = new Bucket { AppName = fg.AppName, AppPath = fg.AppPath };
            _buckets[fg.AppName] = b;
        }
        else if (string.IsNullOrEmpty(b.AppPath) && !string.IsNullOrEmpty(fg.AppPath))
        {
            b.AppPath = fg.AppPath;
        }
        return b;
    }

    private static bool HasMetrics(Bucket b) =>
        b.KeyDownCount > 0 || b.TypingActiveMs > 0 || b.KeyboardIdleMs > 0;

    private static string AppKey(FgInfo fg) => $"{fg.AppName}|{fg.AppPath ?? ""}";

    private async Task FlushAsync(bool force, CancellationToken ct)
    {
        List<Bucket> snapshot;
        string batchId;
        DateTime periodStart;
        DateTime periodEnd;
        string employeeId;

        lock (_gate)
        {
            employeeId = (_settings.EmployeeId ?? "").Trim();
            if (string.IsNullOrEmpty(employeeId)) return;

            var elapsed = (DateTime.UtcNow - _periodStartUtc).TotalSeconds;
            if (!force && elapsed < FlushSeconds) return;

            CloseCurrentSliceUnlocked(DateTime.UtcNow);
            snapshot = _buckets.Values.Where(HasMetrics).Select(CloneBucket).ToList();
            if (snapshot.Count == 0)
            {
                ResetPeriodUnlocked();
                KeepSliceTrackingUnlocked();
                return;
            }

            batchId = _batchId;
            periodStart = _periodStartUtc;
            periodEnd = DateTime.UtcNow;
            ResetPeriodUnlocked();
            KeepSliceTrackingUnlocked();
        }

        var ok = await PostAsync(employeeId, batchId, periodStart, periodEnd, snapshot, ct)
            .ConfigureAwait(false);
        if (ok)
        {
            var keys = snapshot.Sum(b => b.KeyDownCount);
            _onStatus?.Invoke($"Keyboard metrics uploaded ({keys} keys, {snapshot.Count} app(s))");
        }
    }

    private void KeepSliceTrackingUnlocked()
    {
        if (_currentFg != null)
        {
            _currentAppKey = AppKey(_currentFg);
            _sliceStartUtc = DateTime.UtcNow;
            _lastKeyUtc = null;
        }
        else
        {
            _currentAppKey = "";
            _lastKeyUtc = null;
        }
    }

    private void ResetPeriodUnlocked()
    {
        _buckets.Clear();
        _periodStartUtc = DateTime.UtcNow;
        _batchId = Guid.NewGuid().ToString("N");
    }

    private static Bucket CloneBucket(Bucket b) => new()
    {
        AppName = b.AppName,
        AppPath = b.AppPath,
        KeyDownCount = b.KeyDownCount,
        TypingActiveMs = b.TypingActiveMs,
        KeyboardIdleMs = b.KeyboardIdleMs,
    };

    private async Task<bool> PostAsync(
        string employeeId,
        string batchId,
        DateTime periodStart,
        DateTime periodEnd,
        List<Bucket> segments,
        CancellationToken ct)
    {
        var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(baseUrl)) return false;
        var url = $"{baseUrl}/api/guard/keyboard-activity";
        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
            var payload = new
            {
                batch_id = batchId,
                employee_id = employeeId,
                employee_name = _settings.EmployeeName,
                pseudonym = _settings.Pseudonym,
                machine_id = MachineIdentity.GetOrCreate(),
                hostname = MachineIdentity.Hostname,
                windows_user = MachineIdentity.WindowsUser,
                period_start = periodStart.ToLocalTime().ToString("o"),
                period_end = periodEnd.ToLocalTime().ToString("o"),
                segments = segments.Select(s => new
                {
                    app_name = s.AppName,
                    app_path = s.AppPath,
                    key_down_count = s.KeyDownCount,
                    typing_active_ms = s.TypingActiveMs,
                    keyboard_idle_ms = s.KeyboardIdleMs,
                }).ToList(),
            };
            using var res = await http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private void EnsureHookThread()
    {
        if (_hookThread != null && _hookThread.IsAlive && _hookReady) return;

        TeardownHook();
        _hookReady = false;
        _proc = HookCallback;
        _hookThread = new Thread(HookThreadMain)
        {
            IsBackground = true,
            Name = "InteractGuard.KeyboardHook",
        };
        _hookThread.SetApartmentState(ApartmentState.STA);
        _hookThread.Start();

        var sw = Stopwatch.StartNew();
        while (!_hookReady && sw.ElapsedMilliseconds < 3000)
            Thread.Sleep(50);
    }

    private void HookThreadMain()
    {
        try
        {
            _hookNativeThreadId = GetCurrentThreadId();
            _hookId = SetWindowsHookEx(WhKeyboardLl, _proc!, GetModuleHandle(null), 0);
            _hookReady = _hookId != IntPtr.Zero;
            if (!_hookReady) return;
            Application.Run();
        }
        catch
        {
            _hookReady = false;
        }
        finally
        {
            if (_hookId != IntPtr.Zero)
            {
                try { UnhookWindowsHookEx(_hookId); } catch { /* ignore */ }
                _hookId = IntPtr.Zero;
            }
            _hookReady = false;
            _hookNativeThreadId = 0;
        }
    }

    private void TeardownHook()
    {
        try
        {
            if (_hookId != IntPtr.Zero)
            {
                try { UnhookWindowsHookEx(_hookId); } catch { /* ignore */ }
                _hookId = IntPtr.Zero;
            }

            var tid = _hookNativeThreadId;
            if (tid != 0)
            {
                try { PostThreadMessage(tid, WmQuit, IntPtr.Zero, IntPtr.Zero); }
                catch { /* ignore */ }
            }

            var t = _hookThread;
            if (t != null && t.IsAlive)
                t.Join(2000);
        }
        catch { /* ignore */ }
        finally
        {
            _hookThread = null;
            _hookReady = false;
            _hookNativeThreadId = 0;
        }
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode >= 0)
            {
                var msg = wParam.ToInt32();
                if (msg == WmKeyDown || msg == WmSysKeyDown)
                {
                    // Do not read KBDLLHOOKSTRUCT — no vkCode / characters.
                    OnKeyDown();
                }
            }
        }
        catch
        {
            /* never break the hook chain */
        }

        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    private sealed class Bucket
    {
        public string AppName { get; set; } = "Unknown";
        public string? AppPath { get; set; }
        public int KeyDownCount { get; set; }
        public long TypingActiveMs { get; set; }
        public long KeyboardIdleMs { get; set; }
    }

    private sealed class FgInfo
    {
        public string AppName { get; set; } = "Unknown";
        public string? AppPath { get; set; }
    }

    private static FgInfo? ReadForeground()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return null;

            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid == 0) return null;

            string appName = "Unknown";
            string? appPath = null;
            try
            {
                using var proc = Process.GetProcessById((int)pid);
                appName = string.IsNullOrWhiteSpace(proc.ProcessName)
                    ? "Unknown"
                    : proc.ProcessName + ".exe";
                try { appPath = proc.MainModule?.FileName; } catch { /* access denied */ }
            }
            catch
            {
                /* ignore */
            }

            return new FgInfo { AppName = appName, AppPath = appPath };
        }
        catch
        {
            return null;
        }
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("kernel32.dll")]
    private static extern int GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(int idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public void Dispose()
    {
        Stop(flush: true);
        TeardownHook();
    }
}
