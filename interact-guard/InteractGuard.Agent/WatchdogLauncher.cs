using System.Diagnostics;
using System.IO;

namespace InteractGuard;

public static class WatchdogLauncher
{
    public static void EnsureRunning()
    {
        try
        {
            var name = "InteractGuard.Watchdog";
            if (Process.GetProcessesByName(name).Length > 0) return;

            var dir = AppContext.BaseDirectory;
            var exe = Path.Combine(dir, "InteractGuard.Watchdog.exe");
            if (!File.Exists(exe)) return;

            Process.Start(new ProcessStartInfo(exe)
            {
                UseShellExecute = true,
                WorkingDirectory = dir,
            });
        }
        catch
        {
            /* optional */
        }
    }
}
