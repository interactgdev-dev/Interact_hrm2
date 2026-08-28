using System.Diagnostics;
using System.IO;
using System.Windows;
using WpfApp = System.Windows.Application;

namespace InteractPresence;

internal static class AgentCommands
{
    public static void Restart()
    {
        var exe = Environment.ProcessPath
                  ?? Process.GetCurrentProcess().MainModule?.FileName;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
        {
            WpfApp.Current?.Shutdown();
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
            UseShellExecute = true,
        });
        WpfApp.Current?.Shutdown();
    }

    public static void Exit()
    {
        WpfApp.Current?.Shutdown();
    }
}
