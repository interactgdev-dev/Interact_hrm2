using System.IO;

namespace InteractPresence;

/// <summary>Stable machine identity for HRM agent registry.</summary>
public static class MachineIdentity
{
    private static string IdPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence",
            "machine-id.txt");

    public static string GetOrCreate()
    {
        try
        {
            if (File.Exists(IdPath))
            {
                var existing = (File.ReadAllText(IdPath) ?? "").Trim();
                if (existing.Length >= 8 && existing.Length <= 128)
                    return existing;
            }
        }
        catch
        {
            /* regenerate */
        }

        var id = Guid.NewGuid().ToString("N");
        try
        {
            var dir = Path.GetDirectoryName(IdPath)!;
            Directory.CreateDirectory(dir);
            File.WriteAllText(IdPath, id);
        }
        catch
        {
            /* still return in-memory id for this session */
        }
        return id;
    }

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
}
