using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Application = System.Windows.Application;
using MediaBrushes = System.Windows.Media.Brushes;
using Window = System.Windows.Window;

namespace InteractGuard;

/// <summary>
/// Topmost WebView2 host for /presence-silent?embed=1.
/// Keeps the page alive between checks so TF face models stay in memory
/// (restart via __hrmStartFaceCheck — no full reload / re-download).
/// </summary>
public static class FaceVerifyHostWindow
{
    private const double HostWidth = 300;
    private const double HostHeight = 480;
    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNomove = 0x0002;
    private const uint SwpNosize = 0x0001;
    private const uint SwpShowwindow = 0x0040;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    private static Window? _win;
    private static WebView2? _web;
    private static bool _coreReady;
    private static bool _scriptHooked;
    private static string? _lastOrigin;
    private static string? _warmUrl;
    private static CancellationTokenSource? _autoCloseCts;

    public static void Show(string pageUrl) => ShowInternal(pageUrl);

    public static void CloseActive()
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) return;
        _ = dispatcher.InvokeAsync(HideActiveSync);
    }

    /// <summary>Warm WebView + load face models into memory (hidden).</summary>
    public static void Prewarm(string? hrmBaseUrl = null)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) return;
        _ = dispatcher.InvokeAsync(async () =>
        {
            try
            {
                await EnsureHostAsync().ConfigureAwait(true);
                if (_web?.CoreWebView2 == null || string.IsNullOrWhiteSpace(hrmBaseUrl)) return;
                var origin = new Uri(hrmBaseUrl.TrimEnd('/') + "/").GetLeftPart(UriPartial.Authority);
                await GrantCameraAsync(origin).ConfigureAwait(true);
                _warmUrl = origin + "/presence-silent?embed=1&warm=1&source=interact-guard";
                var src = _web.CoreWebView2.Source ?? "";
                if (!src.Contains("/presence-silent", StringComparison.OrdinalIgnoreCase))
                {
                    _web.CoreWebView2.Navigate(_warmUrl);
                }
            }
            catch { /* ignore */ }
        });
    }

    public static void Reveal(string? checkId = null) { /* unused */ }

    private static void ShowInternal(string pageUrl)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) return;
        _ = dispatcher.InvokeAsync(async () =>
        {
            try { await ShowOnUiAsync(pageUrl).ConfigureAwait(true); }
            catch { /* ignore */ }
        });
    }

    private static async Task ShowOnUiAsync(string pageUrl)
    {
        _autoCloseCts?.Cancel();
        await EnsureHostAsync().ConfigureAwait(true);
        if (_win == null || _web?.CoreWebView2 == null) return;

        try
        {
            var uri = new Uri(pageUrl);
            var origin = uri.GetLeftPart(UriPartial.Authority);
            await GrantCameraAsync(origin).ConfigureAwait(true);
            _warmUrl ??= origin + "/presence-silent?embed=1&warm=1&source=interact-guard";
        }
        catch { /* ignore */ }

        PlaceCentered(_win);
        _win.Show();
        ForceTopmost(_win);
        try { _win.Activate(); } catch { /* ignore */ }

        // Prefer in-page restart when models are already loaded (skip ~6MB reload).
        var reused = await TryRestartInPageAsync(pageUrl).ConfigureAwait(true);
        if (!reused)
        {
            _web.CoreWebView2.Navigate(pageUrl);
        }

        _autoCloseCts = new CancellationTokenSource();
        var token = _autoCloseCts.Token;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(120_000, token).ConfigureAwait(false);
                await (_win?.Dispatcher.InvokeAsync(HideActiveSync) ?? default);
            }
            catch { /* cancelled */ }
        }, token);
    }

    private static async Task<bool> TryRestartInPageAsync(string pageUrl)
    {
        try
        {
            if (_web?.CoreWebView2 == null) return false;
            var src = _web.CoreWebView2.Source ?? "";
            if (!src.Contains("/presence-silent", StringComparison.OrdinalIgnoreCase))
                return false;

            var readyJson = await _web.CoreWebView2.ExecuteScriptAsync(
                    "!!(window.__hrmStartFaceCheck && window.__hrmFaceModelsReady && window.__hrmFaceModelsReady())")
                .ConfigureAwait(true);
            if (readyJson != "true") return false;

            var uri = new Uri(pageUrl);
            var q = ParseQuery(uri.Query);
            var payload = new
            {
                employeeId = q.GetValueOrDefault("employeeId")
                    ?? q.GetValueOrDefault("employee_id")
                    ?? "",
                employeeName = q.GetValueOrDefault("employeeName") ?? "",
                checkId = q.GetValueOrDefault("checkId") ?? q.GetValueOrDefault("check_id"),
            };
            if (string.IsNullOrWhiteSpace(payload.employeeId)) return false;

            var json = JsonSerializer.Serialize(payload);
            await _web.CoreWebView2.ExecuteScriptAsync(
                    $"window.__hrmStartFaceCheck({json})")
                .ConfigureAwait(true);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query)) return map;
        var q = query[0] == '?' ? query[1..] : query;
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var i = part.IndexOf('=');
            if (i <= 0) continue;
            var key = Uri.UnescapeDataString(part[..i]);
            var val = Uri.UnescapeDataString(part[(i + 1)..]);
            map[key] = val;
        }
        return map;
    }

    private static async Task EnsureHostAsync()
    {
        if (_coreReady && _win != null && _web?.CoreWebView2 != null) return;

        if (_web == null)
        {
            _web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.White };
        }

        if (_win == null)
        {
            var root = new Border
            {
                Background = MediaBrushes.White,
                Child = _web,
                CornerRadius = new CornerRadius(16),
                ClipToBounds = true,
                BorderBrush = new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xEE, 0xF2, 0xF7)),
                BorderThickness = new Thickness(1),
                Effect = new System.Windows.Media.Effects.DropShadowEffect
                {
                    Color = System.Windows.Media.Color.FromRgb(0x0F, 0x17, 0x2A),
                    BlurRadius = 28,
                    ShadowDepth = 6,
                    Direction = 270,
                    Opacity = 0.16,
                },
            };

            _win = new Window
            {
                Title = "Face Verification",
                Width = HostWidth,
                Height = HostHeight,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Topmost = true,
                ShowInTaskbar = false,
                ResizeMode = ResizeMode.NoResize,
                WindowStyle = WindowStyle.None,
                AllowsTransparency = false,
                Background = MediaBrushes.White,
                Content = root,
                Tag = "InteractGuardFaceVerify",
                ShowActivated = true,
            };
            PlaceCentered(_win);
        }

        if (_web.CoreWebView2 == null)
        {
            var wasVisible = _win.IsVisible;
            if (!wasVisible) _win.Show();
            var ud = AppSettings.WebView2UserDataDir;
            Directory.CreateDirectory(ud);
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: ud).ConfigureAwait(true);
            await _web.EnsureCoreWebView2Async(env).ConfigureAwait(true);
            if (!wasVisible) _win.Hide();
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        if (!_scriptHooked)
        {
            _scriptHooked = true;
            core.ServerCertificateErrorDetected += (_, e) =>
            {
                e.Action = CoreWebView2ServerCertificateErrorAction.AlwaysAllow;
            };
            core.PermissionRequested += (_, e) =>
            {
                if (e.PermissionKind is CoreWebView2PermissionKind.Camera
                    or CoreWebView2PermissionKind.Microphone)
                {
                    e.State = CoreWebView2PermissionState.Allow;
                    e.Handled = true;
                }
            };
            core.WindowCloseRequested += (_, _) => HideActiveSync();
            core.WebMessageReceived += (_, e) =>
            {
                try
                {
                    var raw = e.TryGetWebMessageAsString() ?? "";
                    if (raw.Contains("ui-ready", StringComparison.OrdinalIgnoreCase))
                        return;
                    HideActiveSync();
                }
                catch
                {
                    HideActiveSync();
                }
            };
            core.NavigationCompleted += (_, _) =>
            {
                try
                {
                    if (_win is { IsVisible: true })
                        _win.Dispatcher.Invoke(() => ForceTopmost(_win));
                }
                catch { /* ignore */ }
            };
        }

        _coreReady = true;
    }

    private static async Task GrantCameraAsync(string origin)
    {
        if (_web?.CoreWebView2 == null || string.IsNullOrEmpty(origin)) return;
        if (string.Equals(_lastOrigin, origin, StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            await _web.CoreWebView2.Profile.SetPermissionStateAsync(
                    CoreWebView2PermissionKind.Camera,
                    origin,
                    CoreWebView2PermissionState.Allow)
                .ConfigureAwait(true);
            _lastOrigin = origin;
        }
        catch { /* older runtime */ }
    }

    private static void PlaceCentered(Window win)
    {
        win.Left = SystemParameters.WorkArea.Left +
            (SystemParameters.WorkArea.Width - HostWidth) / 2;
        win.Top = SystemParameters.WorkArea.Top +
            (SystemParameters.WorkArea.Height - HostHeight) / 2;
    }

    private static void ForceTopmost(Window win)
    {
        try
        {
            win.Topmost = false;
            win.Topmost = true;
            var helper = new WindowInteropHelper(win);
            helper.EnsureHandle();
            if (helper.Handle != IntPtr.Zero)
            {
                SetWindowPos(
                    helper.Handle,
                    HwndTopmost,
                    0, 0, 0, 0,
                    SwpNomove | SwpNosize | SwpShowwindow);
            }
        }
        catch { /* ignore */ }
    }

    private static void HideActiveSync()
    {
        try
        {
            _autoCloseCts?.Cancel();
            if (_win != null)
            {
                try { _win.Hide(); } catch { /* ignore */ }
            }
            // Keep presence-silent document alive so TF models stay in memory.
            // Soft-reset to warm mode via script when possible; else navigate warm URL.
            if (_web?.CoreWebView2 != null)
            {
                try
                {
                    _ = _web.CoreWebView2.ExecuteScriptAsync(
                        "try{if(window.__hrmStartFaceCheck){document.title='presence-warm';}}catch(e){}");
                }
                catch { /* ignore */ }
            }
        }
        catch { /* ignore */ }
    }
}
