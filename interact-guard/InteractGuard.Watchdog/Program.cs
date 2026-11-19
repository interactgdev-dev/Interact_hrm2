using System.Diagnostics;
using System.Security.Principal;

namespace InteractGuard.Watchdog;

/// <summary>
/// Restarts InteractGuard agent if it disappears (employee End Task).
/// Must run in the interactive user session — never under SYSTEM Session 0.
/// </summary>
internal static class Program
{
    private const string AgentName = "InteractGuard";
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(8);

    [STAThread]
    private static void Main()
    {
        if (IsLocalSystem())
        {
            // SYSTEM Session 0 must not host the agent (WebView2/camera breaks).
            return;
        }

        using var mutex = new Mutex(true, @"Global\InteractGuard.Watchdog.SingleInstance", out var created);
        if (!created) return;

        var agentExe = Path.Combine(AppContext.BaseDirectory, "InteractGuard.exe");
        while (true)
        {
            try
            {
                if (File.Exists(agentExe) && Process.GetProcessesByName(AgentName).Length == 0)
                {
                    Process.Start(new ProcessStartInfo(agentExe)
                    {
                        UseShellExecute = true,
                        WorkingDirectory = AppContext.BaseDirectory,
                    });
                }
            }
            catch
            {
                /* keep looping */
            }

            Thread.Sleep(Interval);
        }
    }

    private static bool IsLocalSystem()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return id.IsSystem;
        }
        catch
        {
            return false;
        }
    }
}
