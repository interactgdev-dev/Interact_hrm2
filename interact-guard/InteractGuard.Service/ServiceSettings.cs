using System.Text.Json;

namespace InteractGuard.Service;

internal sealed class ServiceSettings
{
    public const string Version = "1.1.0";

    public string HrmBaseUrl { get; set; } = "https://192.168.10.6:8443";

    public static string ProgramDataDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "InteractGuard");

    public static string InstallDir
    {
        get
        {
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\InteractGuard");
                var loc = key?.GetValue("InstallLocation")?.ToString()?.Trim();
                if (!string.IsNullOrWhiteSpace(loc) && Directory.Exists(loc))
                    return loc.TrimEnd('\\', '/');
            }
            catch
            {
                /* fall through */
            }

            var beside = AppContext.BaseDirectory.TrimEnd('\\', '/');
            if (File.Exists(Path.Combine(beside, "InteractGuard.exe")))
                return beside;

            var pf = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "InteractGuard");
            return pf;
        }
    }

    public static ServiceSettings Load()
    {
        try
        {
            var path = Path.Combine(ProgramDataDir, "settings.json");
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var s = JsonSerializer.Deserialize<ServiceSettings>(json);
                if (s != null && !string.IsNullOrWhiteSpace(s.HrmBaseUrl))
                    return s;
            }
        }
        catch
        {
            /* defaults */
        }
        return new ServiceSettings();
    }
}
