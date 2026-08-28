using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace InteractPresence;

/// <summary>
/// Polls HRM for a newer InteractPresence.exe and self-updates via a short cmd script.
/// </summary>
internal static class AgentUpdater
{
    private static readonly HttpClient Http = CreateHttp();
    private static DateTime _lastCheckUtc = DateTime.MinValue;
    private static bool _updateInFlight;

    private static string UpdateStatePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence",
            "update-state.json");

    private static HttpClient CreateHttp()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) };
    }

    public static string CurrentVersion
    {
        get
        {
            var v = Assembly.GetExecutingAssembly().GetName().Version;
            if (v == null) return "0.0.0";
            return $"{v.Major}.{v.Minor}.{v.Build}";
        }
    }

    public static async Task CheckAndUpdateAsync(
        AppSettings settings,
        CancellationToken ct = default,
        bool force = false)
    {
        if (_updateInFlight) return;
        if (!force && (DateTime.UtcNow - _lastCheckUtc).TotalMinutes < 10) return;

        var baseUrl = (settings.HrmBaseUrl ?? "").TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)) return;

        _lastCheckUtc = DateTime.UtcNow;

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
            var remoteVer = root.TryGetProperty("version", out var verEl)
                ? (verEl.GetString() ?? "")
                : "";
            if (!IsNewer(remoteVer, CurrentVersion)) return;

            var state = LoadUpdateState();
            if (ShouldSkipDueToCooldown(state, remoteVer)) return;

            var downloadPath = root.TryGetProperty("downloadPath", out var dp)
                ? (dp.GetString() ?? "/api/presence-agent/download")
                : "/api/presence-agent/download";
            if (!downloadPath.StartsWith('/')) downloadPath = "/" + downloadPath;

            _updateInFlight = true;
            RecordAttempt(state, remoteVer);
            DesktopNotify.Success($"Updating agent to {remoteVer}…");
            await DownloadAndApplyAsync($"{baseUrl}{downloadPath}", remoteVer, ct)
                .ConfigureAwait(false);
        }
        catch
        {
            _updateInFlight = false;
        }
    }

    private static bool ShouldSkipDueToCooldown(UpdateState state, string remoteVer)
    {
        if (!string.Equals(state.LastRemoteVersion, remoteVer, StringComparison.OrdinalIgnoreCase))
            return false;
        if (state.AttemptCount < 3) return false;
        if (!state.LastAttemptUtc.HasValue) return false;
        return (DateTime.UtcNow - state.LastAttemptUtc.Value).TotalHours < 6;
    }

    private static void RecordAttempt(UpdateState state, string remoteVer)
    {
        if (string.Equals(state.LastRemoteVersion, remoteVer, StringComparison.OrdinalIgnoreCase))
            state.AttemptCount++;
        else
        {
            state.LastRemoteVersion = remoteVer;
            state.AttemptCount = 1;
        }
        state.LastAttemptUtc = DateTime.UtcNow;
        SaveUpdateState(state);
    }

    private static bool IsNewer(string remote, string local)
    {
        if (!Version.TryParse(Normalize(remote), out var r)) return false;
        if (!Version.TryParse(Normalize(local), out var l)) return true;
        return r > l;
    }

    private static string Normalize(string v)
    {
        var parts = (v ?? "0").Trim().Split('.');
        while (parts.Length < 3) Array.Resize(ref parts, parts.Length + 1);
        for (var i = 0; i < parts.Length; i++)
            if (string.IsNullOrWhiteSpace(parts[i])) parts[i] = "0";
        return string.Join(".", parts.Take(4));
    }

    private static string? ReadExeFileVersion(string path)
    {
        try
        {
            var vi = FileVersionInfo.GetVersionInfo(path);
            var raw = (vi.FileVersion ?? vi.ProductVersion ?? "").Trim();
            if (raw.Length == 0) return null;
            return Normalize(raw);
        }
        catch
        {
            return null;
        }
    }

    private static async Task DownloadAndApplyAsync(string url, string version, CancellationToken ct)
    {
        var exe = Environment.ProcessPath
                   ?? Process.GetCurrentProcess().MainModule?.FileName;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
        {
            _updateInFlight = false;
            return;
        }

        var dir = Path.GetDirectoryName(exe)!;
        var newPath = Path.Combine(dir, "InteractPresence_new.exe");
        var batPath = Path.Combine(dir, "apply-update.cmd");

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
            try { File.Delete(newPath); } catch { /* ignore */ }
            _updateInFlight = false;
            DesktopNotify.Failed("Agent update file invalid.");
            return;
        }

        var downloadedVer = ReadExeFileVersion(newPath);
        if (downloadedVer == null || !IsNewer(downloadedVer, CurrentVersion))
        {
            try { File.Delete(newPath); } catch { /* ignore */ }
            _updateInFlight = false;
            DesktopNotify.Failed(
                "Update skipped — downloaded file is not newer than this install. Ask admin to republish the correct exe.");
            return;
        }

        var state = LoadUpdateState();
        state.LastAppliedVersion = version;
        state.LastAttemptUtc = DateTime.UtcNow;
        SaveUpdateState(state);

        var bat = $"""
@echo off
timeout /t 2 /nobreak >nul
copy /y "{newPath}" "{exe}" >nul
if exist "{newPath}" del /f /q "{newPath}"
start "" "{exe}"
del /f /q "%~f0"
""";
        await File.WriteAllTextAsync(batPath, bat, ct).ConfigureAwait(false);

        Process.Start(new ProcessStartInfo
        {
            FileName = batPath,
            WorkingDirectory = dir,
            UseShellExecute = true,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });

        DesktopNotify.Success($"Restarting for update {version}…");
        System.Windows.Application.Current?.Dispatcher.Invoke(() =>
        {
            System.Windows.Application.Current.Shutdown();
        });
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
            var dir = Path.GetDirectoryName(UpdateStatePath)!;
            Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(UpdateStatePath, json);
        }
        catch
        {
            /* ignore */
        }
    }

    private sealed class UpdateState
    {
        public string? LastRemoteVersion { get; set; }
        public string? LastAppliedVersion { get; set; }
        public DateTime? LastAttemptUtc { get; set; }
        public int AttemptCount { get; set; }
    }
}
