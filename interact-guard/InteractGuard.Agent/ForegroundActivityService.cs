using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text;

namespace InteractGuard;

/// <summary>
/// Reports foreground application name + window title to HRM.
/// Does NOT capture keystrokes or typed text.
/// </summary>
public sealed class ForegroundActivityService : IDisposable
{
    private readonly AppSettings _settings;
    private readonly object _gate = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private string _lastKey = "";
    private DateTime _lastSentUtc = DateTime.MinValue;
    private int _failStreak;
    private Action<string>? _onStatus;

    public ForegroundActivityService(AppSettings settings)
    {
        _settings = settings;
    }

    public void BindUi(Action<string> onStatus) => _onStatus = onStatus;

    public void Start()
    {
        lock (_gate)
        {
            if (_loop != null && !_loop.IsCompleted) return;
            _cts = new CancellationTokenSource();
            _loop = Task.Run(() => LoopAsync(_cts.Token));
        }
    }

    public void Stop()
    {
        CancellationTokenSource? cts;
        lock (_gate)
        {
            cts = _cts;
            _cts = null;
            _loop = null;
        }
        try { cts?.Cancel(); } catch { /* ignore */ }
        try { cts?.Dispose(); } catch { /* ignore */ }
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        await Task.Delay(2000, ct).ConfigureAwait(false);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var empId = (_settings.EmployeeId ?? "").Trim();
                if (string.IsNullOrEmpty(empId))
                {
                    _onStatus?.Invoke("App activity: waiting for employee bind");
                }
                else
                {
                    var info = ReadForeground();
                    if (info != null)
                    {
                        var key = $"{info.AppName}|{info.Caption}";
                        // Always on window/app change; keep-alive every ~45s while same window.
                        var changed = string.IsNullOrEmpty(_lastKey) || key != _lastKey;
                        var stale = (DateTime.UtcNow - _lastSentUtc).TotalSeconds > 45;
                        if (changed || stale)
                        {
                            var ok = await PostAsync(info, empId, CancellationToken.None)
                                .ConfigureAwait(false);
                            if (ok)
                            {
                                _lastKey = key;
                                _lastSentUtc = DateTime.UtcNow;
                                _failStreak = 0;
                                _onStatus?.Invoke($"App activity: {info.AppName}");
                            }
                            else
                            {
                                _failStreak++;
                                if (_failStreak <= 3 || _failStreak % 10 == 0)
                                {
                                    _onStatus?.Invoke(
                                        $"App activity upload failed (check HRM URL) ×{_failStreak}");
                                }
                            }
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                /* retry */
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(4), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<bool> PostAsync(FgInfo info, string employeeId, CancellationToken ct)
    {
        var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(baseUrl)) return false;
        var url = $"{baseUrl}/api/guard/app-activity";
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
                employee_id = employeeId,
                employee_name = _settings.EmployeeName,
                pseudonym = _settings.Pseudonym,
                machine_id = MachineIdentity.GetOrCreate(),
                hostname = MachineIdentity.Hostname,
                windows_user = MachineIdentity.WindowsUser,
                app_name = info.AppName,
                app_path = info.AppPath,
                caption = info.Caption,
                captured_at = DateTime.Now.ToString("o"),
            };
            using var res = await http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private sealed class FgInfo
    {
        public string AppName { get; set; } = "Unknown";
        public string? AppPath { get; set; }
        public string Caption { get; set; } = "";
    }

    private static FgInfo? ReadForeground()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return null;

            var title = new StringBuilder(512);
            GetWindowText(hwnd, title, title.Capacity);
            var caption = title.ToString().Trim();
            if (caption.Length > 500) caption = caption[..500];

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

            return new FgInfo
            {
                AppName = appName,
                AppPath = appPath,
                Caption = caption,
            };
        }
        catch
        {
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public void Dispose() => Stop();
}
