using System.Diagnostics;
using System.IO;

namespace InteractPresence;

/// <summary>Single stable install location — auto-start and updates always use this path.</summary>
internal static class AgentInstallPaths
{
    public static string AppDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence");

    public static string CanonicalExe => Path.Combine(AppDir, "InteractPresence.exe");

    public static string RunningExe =>
        Environment.ProcessPath
        ?? Process.GetCurrentProcess().MainModule?.FileName
        ?? CanonicalExe;

    public static bool IsRunningFromCanonical()
    {
        try
        {
            return string.Equals(
                Path.GetFullPath(RunningExe),
                Path.GetFullPath(CanonicalExe),
                StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Hand off to LocalAppData install when launched from a build/dev folder.</summary>
    public static bool TryMigrateToCanonicalInstall()
    {
        try
        {
            var current = RunningExe;
            if (string.IsNullOrWhiteSpace(current) || !File.Exists(current)) return false;
            if (IsRunningFromCanonical()) return false;

            var sourceDir = Path.GetDirectoryName(current)!;
            CopyFullInstall(sourceDir, AppDir);

            var canonical = CanonicalExe;
            if (!File.Exists(canonical)) return false;

            Process.Start(new ProcessStartInfo
            {
                FileName = canonical,
                WorkingDirectory = AppDir,
                UseShellExecute = true,
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Copy exe + all dll/config deps next to it (framework-dependent publish).</summary>
    public static void CopyFullInstall(string sourceDir, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        foreach (var pattern in new[] { "*.exe", "*.dll", "*.json", "*.deps.json", "*.runtimeconfig.json" })
        {
            foreach (var file in Directory.GetFiles(sourceDir, pattern))
            {
                var name = Path.GetFileName(file);
                if (name.Equals("InteractPresence_new.exe", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(file, Path.Combine(targetDir, name), overwrite: true);
            }
        }

        var runtimesSrc = Path.Combine(sourceDir, "runtimes");
        if (Directory.Exists(runtimesSrc))
        {
            var runtimesDst = Path.Combine(targetDir, "runtimes");
            CopyDirectoryRecursive(runtimesSrc, runtimesDst);
        }
    }

    private static void CopyDirectoryRecursive(string sourceDir, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        foreach (var file in Directory.GetFiles(sourceDir))
            File.Copy(file, Path.Combine(targetDir, Path.GetFileName(file)), overwrite: true);
        foreach (var dir in Directory.GetDirectories(sourceDir))
            CopyDirectoryRecursive(dir, Path.Combine(targetDir, Path.GetFileName(dir)));
    }

    public static string ResolveUpdateTargetExe()
    {
        if (File.Exists(CanonicalExe)) return CanonicalExe;
        var running = RunningExe;
        if (!string.IsNullOrWhiteSpace(running) && File.Exists(running)) return running;
        return CanonicalExe;
    }

    public static string? ReadFileVersion(string path)
    {
        try
        {
            var vi = FileVersionInfo.GetVersionInfo(path);
            var raw = (vi.FileVersion ?? vi.ProductVersion ?? "").Trim();
            if (raw.Length == 0) return null;
            return NormalizeVersion(raw);
        }
        catch
        {
            return null;
        }
    }

    public static string RunningAssemblyVersion()
    {
        var v = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        if (v == null) return "0.0.0";
        return NormalizeVersion($"{v.Major}.{v.Minor}.{v.Build}");
    }

    public static bool IsVersionNewer(string remote, string local)
    {
        if (!Version.TryParse(NormalizeVersion(remote), out var r)) return false;
        if (!Version.TryParse(NormalizeVersion(local), out var l)) return true;
        return r > l;
    }

    public static bool IsSameVersion(string a, string b) =>
        string.Equals(NormalizeVersion(a), NormalizeVersion(b), StringComparison.OrdinalIgnoreCase);

    public static string NormalizeVersion(string v)
    {
        var parts = (v ?? "0").Trim().Split('.');
        while (parts.Length < 3) Array.Resize(ref parts, parts.Length + 1);
        for (var i = 0; i < parts.Length; i++)
            if (string.IsNullOrWhiteSpace(parts[i])) parts[i] = "0";
        return string.Join(".", parts.Take(4));
    }
}
