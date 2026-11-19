using System.Security.Cryptography;
using System.Text;

namespace InteractGuard.Service;

/// <summary>
/// Same machine_id as the tray agent — shared via ProgramData (and legacy LocalAppData).
/// </summary>
internal static class ServiceMachineId
{
    private static string? _cached;

    public static string GetOrCreate()
    {
        if (!string.IsNullOrEmpty(_cached)) return _cached!;

        var shared = Path.Combine(ServiceSettings.ProgramDataDir, "machine-id.txt");
        try
        {
            if (File.Exists(shared))
            {
                var id = (File.ReadAllText(shared) ?? "").Trim();
                if (IsValid(id))
                {
                    _cached = id;
                    return _cached;
                }
            }
        }
        catch
        {
            /* scan users */
        }

        var fromUser = FindInUserProfiles();
        if (fromUser != null)
        {
            _cached = fromUser;
            TryWriteShared(fromUser);
            return _cached;
        }

        _cached = ComputeMachineWideId();
        TryWriteShared(_cached);
        return _cached;
    }

    private static string? FindInUserProfiles()
    {
        try
        {
            var users = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "..", "Users");
            users = Path.GetFullPath(users);
            if (!Directory.Exists(users)) return null;

            string? best = null;
            DateTime bestWrite = DateTime.MinValue;
            foreach (var dir in Directory.EnumerateDirectories(users))
            {
                var name = Path.GetFileName(dir);
                if (name is "Public" or "Default" or "Default User" or "All Users")
                    continue;
                var path = Path.Combine(dir, "AppData", "Local", "InteractGuard", "machine-id.txt");
                if (!File.Exists(path)) continue;
                try
                {
                    var id = (File.ReadAllText(path) ?? "").Trim();
                    if (!IsValid(id)) continue;
                    var wt = File.GetLastWriteTimeUtc(path);
                    if (best == null || wt > bestWrite)
                    {
                        best = id;
                        bestWrite = wt;
                    }
                }
                catch
                {
                    /* next */
                }
            }
            return best;
        }
        catch
        {
            return null;
        }
    }

    private static void TryWriteShared(string id)
    {
        try
        {
            Directory.CreateDirectory(ServiceSettings.ProgramDataDir);
            File.WriteAllText(Path.Combine(ServiceSettings.ProgramDataDir, "machine-id.txt"), id);
        }
        catch
        {
            /* ignore */
        }
    }

    private static bool IsValid(string id) =>
        id.Length >= 8 && id.Length <= 128;

    private static string ComputeMachineWideId()
    {
        var host = Environment.MachineName?.Trim().ToUpperInvariant() ?? "UNKNOWN";
        var guid = ReadMachineGuid() ?? "no-guid";
        var raw = $"{host}|{guid}|machine";
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
