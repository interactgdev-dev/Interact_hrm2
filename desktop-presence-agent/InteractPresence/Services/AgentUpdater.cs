using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace InteractPresence;

/// <summary>Manual update only — never downloads or restarts automatically.</summary>
internal static class AgentUpdater
{
    private static readonly HttpClient Http = CreateHttp();
    private static bool _updateInFlight;

    private static string UpdateStatePath =>
        Path.Combine(AgentInstallPaths.AppDir, "update-state.json");

    private static HttpClient CreateHttp()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) };
    }

    /// <summary>Version of the code actually running in this process.</summary>
    public static string CurrentVersion => AgentInstallPaths.RunningAssemblyVersion();

    /// <param name="force">Must be true (tray admin action). Automatic calls are ignored.</param>
    public static async Task CheckAndUpdateAsync(
        AppSettings settings,
        CancellationToken ct = default,
        bool force = false)
    {
        if (!force) return;
        if (_updateInFlight) return;

        var baseUrl = (settings.HrmBaseUrl ?? "").TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        var state = LoadUpdateState();
        var now = DateTime.UtcNow;
        if (state.LastManualCheckUtc.HasValue &&
            (now - state.LastManualCheckUtc.Value).TotalMinutes < 2)
        {
            return;
        }
        state.LastManualCheckUtc = now;
        SaveUpdateState(state);

        try
        {
            using var res = await Http.GetAsync($"{baseUrl}/api/presence-agent/version", ct)
                .ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return;
            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var ok) || !ok.GetBoolean()) return;
            if (!root.TryGetProperty("hasBinary", out var has) || !has.GetBoolean()) return;

            var remoteVer = AgentInstallPaths.NormalizeVersion(root.TryGetProperty("version", out var verEl)
                ? (verEl.GetString() ?? "")
                : "");
            var localVer = CurrentVersion;

            if (!AgentInstallPaths.IsVersionNewer(remoteVer, localVer))
            {
                DesktopNotify.Success($"Already on latest agent ({localVer}).");
                return;
            }

            var downloadPath = root.TryGetProperty("downloadPath", out var dp)
                ? (dp.GetString() ?? "/api/presence-agent/download")
                : "/api/presence-agent/download";
            if (!downloadPath.StartsWith('/')) downloadPath = "/" + downloadPath;

            _updateInFlight = true;
            await DownloadOnlyAsync($"{baseUrl}{downloadPath}", remoteVer, ct).ConfigureAwait(false);
        }
        catch
        {
            _updateInFlight = false;
        }
    }

    /// <summary>Download to pending file — user restarts manually (no auto-restart script).</summary>
    private static async Task DownloadOnlyAsync(string url, string version, CancellationToken ct)
    {
        var stagingDir = Path.Combine(AgentInstallPaths.AppDir, "update-staging");
        Directory.CreateDirectory(stagingDir);
        var newPath = Path.Combine(stagingDir, "InteractPresence.exe");

        using (var res = await Http.GetAsync(url, ct).ConfigureAwait(false))
        {
            if (!res.IsSuccessStatusCode)
            {
                _updateInFlight = false;
                DesktopNotify.Failed("Agent update download failed.");
                return;
            }
            await using var fs = File.Create(newPath);
            await res.Content.CopyToAsync(fs, ct).ConfigureAwait(false);
        }

        var fi = new FileInfo(newPath);
        if (fi.Length < 1024)
        {
            TryDelete(newPath);
            _updateInFlight = false;
            DesktopNotify.Failed("Agent update file invalid.");
            return;
        }

        var downloadedVer = AgentInstallPaths.ReadFileVersion(newPath);
        if (downloadedVer == null ||
            !AgentInstallPaths.IsVersionNewer(downloadedVer, CurrentVersion))
        {
            TryDelete(newPath);
            _updateInFlight = false;
            DesktopNotify.Failed("Downloaded file is not newer than this install.");
            return;
        }

        if (!AgentInstallPaths.IsSameVersion(version, downloadedVer))
        {
            TryDelete(newPath);
            _updateInFlight = false;
            DesktopNotify.Failed(
                $"Published version {version} does not match uploaded exe ({downloadedVer}).");
            return;
        }

        _updateInFlight = false;
        DesktopNotify.Success(
            $"Update {version} downloaded to staging. Exit the agent fully, then run it again to install.");
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* ignore */ }
    }

    private static UpdateState LoadUpdateState()
    {
        try
        {
            if (!File.Exists(UpdateStatePath)) return new UpdateState();
            var json = File.ReadAllText(UpdateStatePath);
            return JsonSerializer.Deserialize<UpdateState>(json) ?? new UpdateState();
        }
        catch
        {
            return new UpdateState();
        }
    }

    private static void SaveUpdateState(UpdateState state)
    {
        try
        {
            Directory.CreateDirectory(AgentInstallPaths.AppDir);
            var json = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(UpdateStatePath, json);
        }
        catch { /* ignore */ }
    }

    private sealed class UpdateState
    {
        public DateTime? LastManualCheckUtc { get; set; }
    }
}
