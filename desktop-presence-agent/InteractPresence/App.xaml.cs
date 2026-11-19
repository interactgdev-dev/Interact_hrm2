using System;
using System.IO;
using System.Threading;
using System.Windows;

namespace InteractPresence;

public partial class App : System.Windows.Application
{
    private TrayHost? _tray;
    private Mutex? _singleInstance;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        AgentStartupGuard.Prepare();
        StartupLog("prepare done");

        if (AgentInstallPaths.TryMigrateToCanonicalInstall())
        {
            StartupLog("migrated to canonical — exiting launcher");
            Shutdown();
            return;
        }

        const string mutexName = "Global\\InteractPresence_SingleInstance_v1";
        _singleInstance = new Mutex(true, mutexName, out var createdNew);
        if (!createdNew)
        {
            StartupLog("another instance running — exit");
            Shutdown();
            return;
        }

        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        StartupLog("mutex acquired");

        var settings = AppSettings.Load();
        try
        {
            var api = new HrmApiClient(settings);
            api.TryApplyPresenceSettingsAsync(settings).GetAwaiter().GetResult();
            api.TrySendHeartbeatAsync(settings).GetAwaiter().GetResult();
            StartupLog($"sync ok retired={settings.AgentsRetired} url={settings.HrmBaseUrl}");
        }
        catch (Exception ex)
        {
            StartupLog($"sync failed: {ex.Message}");
        }

        if (settings.AgentsRetired)
        {
            StartupLog("agents retired — exit");
            AutoStartHelper.TryDisable();
            System.Windows.MessageBox.Show(
                "InteractPresence is disabled by admin (Agents Retired).\n\n" +
                "Ask admin: Presence / Idle → turn OFF \"Agents retired\" → Save → \"Start all (activate)\".",
                "Interact Presence",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        AutoStartHelper.EnsureEnabled();
        StartupLog("tray starting");

        var apiClient = new HrmApiClient(settings);
        var idle = new IdleDetector();
        var camera = new HrmFacePresenceChecker(settings);
        var controller = new PresenceController(settings, idle, apiClient, camera);

        _tray = new TrayHost(controller, settings);
        _tray.Show();

        controller.Start();
        StartupLog("running");
    }

    private static void StartupLog(string message)
    {
        try
        {
            var path = Path.Combine(AgentInstallPaths.AppDir, "startup.log");
            Directory.CreateDirectory(AgentInstallPaths.AppDir);
            File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        try { _singleInstance?.ReleaseMutex(); } catch { /* ignore */ }
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
