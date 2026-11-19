using System.IO;
using System.Windows;
using Application = System.Windows.Application;

namespace InteractGuard;

public partial class App : Application
{
    private TrayHost? _tray;
    private GuardController? _controller;
    private Mutex? _singleInstance;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Agent must run in interactive user session (camera + WebView2)
        if (AppSettings.IsRunningAsLocalSystem())
        {
            Shutdown();
            return;
        }

        AppSettings.EnsureWritableFolders();
        // Purge legacy folders only — pending-screenshots (3-day local queue) is kept.
        ScreenCaptureService.PurgeLegacyScreenshotFoldersOnly();

        _singleInstance = new Mutex(true, @"Global\InteractGuard.Agent.SingleInstance", out var created);
        if (!created)
        {
            Shutdown();
            return;
        }

        var settings = AppSettings.Load();
        _controller = new GuardController(settings);
        _tray = new TrayHost(settings, _controller);
        _tray.Show();

        // One-time: Installed popup after Setup puts the agent on this PC
        TryShowInstalledNotice();

        // Start watchdog sibling if missing
        WatchdogLauncher.EnsureRunning();

        _ = _controller.StartAsync();
    }

    private void TryShowInstalledNotice()
    {
        try
        {
            var marker = Path.Combine(AppSettings.DataDir, "installed-notice.shown");
            var already = File.Exists(marker)
                ? File.ReadAllText(marker).Trim()
                : "";
            // Show once per installed agent version (so updates get the success toast once).
            if (string.Equals(already, AppSettings.Version, StringComparison.OrdinalIgnoreCase))
                return;
            Directory.CreateDirectory(AppSettings.DataDir);
            ResultToast.Show(
                "Interact Guard",
                "Interact Guard Installed Successfully",
                success: true);
            try
            {
                _tray?.ShowBalloon(
                    "Interact Guard",
                    "Interact Guard Installed Successfully",
                    success: true);
            }
            catch { /* ignore */ }
            File.WriteAllText(marker, AppSettings.Version);
        }
        catch
        {
            /* ignore */
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _controller?.Dispose();
        _tray?.Dispose();
        _singleInstance?.ReleaseMutex();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
