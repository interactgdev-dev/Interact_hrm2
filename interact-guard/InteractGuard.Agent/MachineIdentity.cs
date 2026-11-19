using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace InteractGuard;

/// <summary>
/// Stable per-PC identity. Shared with Windows Service via ProgramData so Admin
/// remote-start targets the same presence_agents row as the tray agent.
/// </summary>
public static class MachineIdentity
{
    private static string? _cached;

    public static string Hostname
    {
        get
        {
            try { return Environment.MachineName; }
            catch { return "unknown"; }
        }
    }

    public static string WindowsUser
    {
        get
        {
            try
            {
                var domain = Environment.UserDomainName;
                var user = Environment.UserName;
                if (string.IsNullOrWhiteSpace(domain)) return user ?? "unknown";
                if (string.IsNullOrWhiteSpace(user)) return domain;
                return $"{domain}\\{user}";
            }
            catch
            {
                return "unknown";
            }
        }
    }

    public static string GetOrCreate()
    {
        if (!string.IsNullOrEmpty(_cached)) return _cached!;

        var sharedPath = Path.Combine(AppSettings.ProgramDataDir, "machine-id.txt");
        var localPath = Path.Combine(AppSettings.DataDir, "machine-id.txt");

        // 1) Shared ProgramData (service + agent)
        var shared = ReadValidId(sharedPath);
        if (shared != null)
        {
            _cached = shared;
            TryWrite(localPath, shared);
            return _cached;
        }

        // 2) Legacy LocalAppData — promote to ProgramData (keeps existing admin row)
        var local = ReadValidId(localPath);
        if (local != null)
        {
            _cached = local;
            TryWrite(sharedPath, local);
            return _cached;
        }

        // 3) New machine-wide id (no Windows user — SYSTEM and user must match)
        _cached = ComputeMachineWideId();
        TryWrite(sharedPath, _cached);
        TryWrite(localPath, _cached);
        return _cached;
    }

    private static string? ReadValidId(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var existing = (File.ReadAllText(path) ?? "").Trim();
            if (existing.Length >= 8 && existing.Length <= 128) return existing;
        }
        catch
        {
            /* ignore */
        }
        return null;
    }

    private static void TryWrite(string path, string id)
    {
        try
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(path, id);
        }
        catch
        {
            /* ignore */
        }
    }

    private static string ComputeMachineWideId()
    {
        var guid = ReadMachineGuid() ?? "no-guid";
        var raw = $"{Hostname.Trim().ToUpperInvariant()}|{guid}|machine";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
        return hash[..32];
    }

    private static string? ReadMachineGuid()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Cryptography");
            var v = key?.GetValue("MachineGuid")?.ToString()?.Trim();
            return string.IsNullOrEmpty(v) ? null : v;
        }
        catch
        {
            return null;
        }
    }
}
