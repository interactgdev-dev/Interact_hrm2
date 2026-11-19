using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace InteractPresence;

/// <summary>
/// Stable per-PC identity. Never uses random Guid (that caused duplicate HRM agent rows).
/// </summary>
public static class MachineIdentity
{
    private static string? _cached;

    private static string IdPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence",
            "machine-id.txt");

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

        var deterministic = ComputeDeterministicId();
        try
        {
            if (File.Exists(IdPath))
            {
                var existing = (File.ReadAllText(IdPath) ?? "").Trim();
                if (string.Equals(existing, deterministic, StringComparison.OrdinalIgnoreCase))
                {
                    _cached = existing;
                    return _cached;
                }
            }
        }
        catch
        {
            /* rewrite below */
        }

        _cached = deterministic;
        try
        {
            var dir = Path.GetDirectoryName(IdPath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(IdPath, _cached);
        }
        catch
        {
            /* in-memory still stable for this session */
        }
        return _cached;
    }

    private static string ComputeDeterministicId()
    {
        var guid = ReadMachineGuid() ?? "no-guid";
        var raw = $"{Hostname.Trim().ToUpperInvariant()}|{guid}|{WindowsUser.Trim().ToUpperInvariant()}";
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
