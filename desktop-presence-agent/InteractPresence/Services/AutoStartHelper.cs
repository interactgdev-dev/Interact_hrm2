using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace InteractPresence;

/// <summary>Registers InteractPresence to start when the Windows user logs in.</summary>
internal static class AutoStartHelper
{
    private const string ShortcutName = "Interact Presence.lnk";

    public static string StartupFolder =>
        Environment.GetFolderPath(Environment.SpecialFolder.Startup);

    public static string ShortcutPath => Path.Combine(StartupFolder, ShortcutName);

    public static bool IsEnabled() => File.Exists(ShortcutPath);

    public static void EnsureEnabled()
    {
        try
        {
            var exe = AgentInstallPaths.CanonicalExe;
            if (!File.Exists(exe))
            {
                var running = AgentInstallPaths.RunningExe;
                var dir = Path.GetDirectoryName(running);
                if (string.IsNullOrWhiteSpace(dir) || !File.Exists(running)) return;
                AgentInstallPaths.CopyFullInstall(dir, AgentInstallPaths.AppDir);
            }

            if (!File.Exists(exe)) return;
            CreateShortcut(exe);
        }
        catch
        {
            /* ignore — non-fatal */
        }
    }

    public static bool TryDisable()
    {
        try
        {
            if (File.Exists(ShortcutPath))
                File.Delete(ShortcutPath);
            return !File.Exists(ShortcutPath);
        }
        catch
        {
            return false;
        }
    }

    private static void CreateShortcut(string exePath)
    {
        Directory.CreateDirectory(StartupFolder);
        // COM WScript.Shell — no extra NuGet package needed on Windows.
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        dynamic shell = Activator.CreateInstance(shellType)!;
        try
        {
            dynamic shortcut = shell.CreateShortcut(ShortcutPath);
            shortcut.TargetPath = exePath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(exePath) ?? "";
            shortcut.WindowStyle = 7; // minimized / tray-friendly
            shortcut.Description = "Interact HRM Presence Agent";
            shortcut.Save();
            Marshal.FinalReleaseComObject(shortcut);
        }
        finally
        {
            Marshal.FinalReleaseComObject(shell);
        }
    }
}
