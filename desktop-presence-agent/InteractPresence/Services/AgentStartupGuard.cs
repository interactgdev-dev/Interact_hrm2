using System.Diagnostics;
using System.IO;

namespace InteractPresence;

/// <summary>Cleans leftover update scripts and applies pending downloads without restarting.</summary>
internal static class AgentStartupGuard
{
    public static void Prepare()
    {
        KillUpdateScripts();
        ApplyPendingDownloadedExe();
        CleanupDevFolderArtifacts();
    }

    /// <summary>Replace canonical install with pending download before the app fully starts.</summary>
    private static void ApplyPendingDownloadedExe()
    {
        try
        {
            var stagingExe = Path.Combine(AgentInstallPaths.AppDir, "update-staging", "InteractPresence.exe");
            if (!File.Exists(stagingExe)) return;

            var pendingVer = AgentInstallPaths.ReadFileVersion(stagingExe);
            if (pendingVer == null) return;

            var currentVer = AgentInstallPaths.ReadFileVersion(AgentInstallPaths.CanonicalExe);
            if (currentVer != null && !AgentInstallPaths.IsVersionNewer(pendingVer, currentVer)) return;

            var stagingDir = Path.GetDirectoryName(stagingExe)!;
            AgentInstallPaths.CopyFullInstall(stagingDir, AgentInstallPaths.AppDir);
            TryDelete(stagingExe);
        }
        catch
        {
            /* non-fatal */
        }
    }

    private static void KillUpdateScripts()
    {
        foreach (var path in new[]
                 {
                     Path.Combine(AgentInstallPaths.AppDir, "apply-update.cmd"),
                     Path.Combine(AgentInstallPaths.AppDir, "apply-update.bat"),
                 })
        {
            TryDelete(path);
        }
    }

    private static void CleanupDevFolderArtifacts()
    {
        try
        {
            foreach (var orphan in new[] { "watchdog.exe", "InteractPresenceGuardian.exe" })
            {
                TryDelete(Path.Combine(AgentInstallPaths.AppDir, orphan));
            }

            var repoRoot = FindRepoRoot();
            if (repoRoot == null) return;
            var agentRoot = Path.Combine(repoRoot, "desktop-presence-agent");
            if (!Directory.Exists(agentRoot)) return;
            foreach (var file in Directory.EnumerateFiles(agentRoot, "apply-update.cmd", SearchOption.AllDirectories))
                TryDelete(file);
            foreach (var file in Directory.EnumerateFiles(agentRoot, "InteractPresence_new.exe", SearchOption.AllDirectories))
                TryDelete(file);
        }
        catch { /* ignore */ }
    }

    private static string? FindRepoRoot()
    {
        try
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "package.json"))
                    && Directory.Exists(Path.Combine(dir.FullName, "desktop-presence-agent")))
                    return dir.FullName;
                dir = dir.Parent;
            }
        }
        catch { /* ignore */ }
        return null;
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* ignore */ }
    }
}
