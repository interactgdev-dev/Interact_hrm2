using System.IO;
using System.Security.Principal;
using System.Text.Json;

namespace InteractGuard;

public sealed class AppSettings
{
    public const string ProductName = "Interact Guard";
    public const string Version = "1.2.66";
    public const string UninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\InteractGuard";

    public string HrmBaseUrl { get; set; } = "https://192.168.10.6:8443";
    public string? EmployeeId { get; set; }
    public string? EmployeeName { get; set; }
    public string? Pseudonym { get; set; }
    public string? AuthToken { get; set; }

    /// <summary>
    /// Synced from Admin Presence/Idle. When true, periodic screenshots save locally for
    /// <see cref="ScreenCaptureService.LocalRetainDays"/> days, then upload slowly to HRM.
    /// </summary>
    public bool ScreenshotCaptureEnabled { get; set; } = false;

    /// <summary>Seconds between auto screenshots. Synced from Admin (prefer ≥300 with many PCs).</summary>
    public int ScreenshotIntervalSeconds { get; set; } = 300;

    /// <summary>JPEG quality 10–95. Synced from Guard Screenshots gallery settings.</summary>
    public int ScreenshotJpegQuality { get; set; } = 35;

    /// <summary>Capture scale 25–100% of screen pixels. Synced from gallery settings.</summary>
    public int ScreenshotScalePercent { get; set; } = 40;

    /// <summary>Admin opened Live view on Guard Screenshots. Temporary stream only.</summary>
    public bool LivePreviewActive { get; set; } = false;

    public int LiveIntervalMs { get; set; } = 600;
    public int LiveJpegQuality { get; set; } = 50;
    public int LiveScalePercent { get; set; } = 55;

    /// <summary>Legacy idle threshold (unused for trigger). Synced for older builds.</summary>
    public int IdleSecondsBeforeCheck { get; set; } = 120;

    /// <summary>Poll timer interval.</summary>
    public int PollIntervalSeconds { get; set; } = 2;

    /// <summary>Legacy recheck while idle. Prefer FaceScanIntervalSeconds.</summary>
    public int RecheckWhileIdleSeconds { get; set; } = 180;

    /// <summary>
    /// While clocked in and not on break, run face verify this often (seconds).
    /// Idle state is ignored. Synced from Presence / Idle admin settings.
    /// </summary>
    public int FaceScanIntervalSeconds { get; set; } = 600;

    /// <summary>Failed face verifies before seat-absent ticket. Synced from admin.</summary>
    public int FaceVerifyMaxAttempts { get; set; } = 3;

    /// <summary>Seconds between failed face-verify attempts. Synced from admin.</summary>
    public int FaceVerifyRetryGapSeconds { get; set; } = 10;

    /// <summary>
    /// Admin master switch. Install registers the PC; monitoring starts only when true.
    /// </summary>
    public bool AdminEnabled { get; set; } = false;

    /// <summary>Global Presence monitoring master switch from HRM Presence/Idle page.</summary>
    public bool PresenceMonitoringEnabled { get; set; } = true;

    public bool CameraVerificationEnabled { get; set; } = true;

    /// <summary>Open HRM clock-in session. Idle face check only when true.</summary>
    public bool ClockedIn { get; set; } = false;

    /// <summary>Password for tray Status and Exit. Synced from HRM Presence/Idle.</summary>
    public string AdminExitPassword { get; set; } = "InteractAdmin";

    /// <summary>
    /// Machine-wide writable folder created by Setup with Users Modify ACL.
    /// Safe for WebView2 even if a process briefly runs elevated.
    /// </summary>
    public static string ProgramDataDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "InteractGuard");

    /// <summary>WebView2 user data — never under Program Files or SYSTEM profile.</summary>
    public static string WebView2UserDataDir => Path.Combine(ProgramDataDir, "WebView2");

    public static string DataDir
    {
        get
        {
            // Prefer interactive user LocalAppData; fall back to ProgramData when running as SYSTEM
            try
            {
                if (!IsRunningAsLocalSystem())
                {
                    var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    if (!string.IsNullOrWhiteSpace(local) &&
                        local.IndexOf("systemprofile", StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        return Path.Combine(local, "InteractGuard");
                    }
                }
            }
            catch
            {
                /* ProgramData below */
            }
            return ProgramDataDir;
        }
    }

    private static string SettingsPath => Path.Combine(DataDir, "settings.json");

    public static bool IsRunningAsLocalSystem()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return id.IsSystem ||
                   string.Equals(id.Name, @"NT AUTHORITY\SYSTEM", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public static void EnsureWritableFolders()
    {
        try
        {
            Directory.CreateDirectory(ProgramDataDir);
            Directory.CreateDirectory(WebView2UserDataDir);
            Directory.CreateDirectory(DataDir);
        }
        catch
        {
            /* best-effort */
        }
    }

    public static AppSettings Load()
    {
        EnsureWritableFolders();
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            }
            // Migrate from ProgramData if user-local missing
            var shared = Path.Combine(ProgramDataDir, "settings.json");
            if (File.Exists(shared) && !string.Equals(SettingsPath, shared, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(shared, SettingsPath, overwrite: false);
                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            }
        }
        catch
        {
            /* defaults */
        }
        return new AppSettings();
    }

    public void Save()
    {
        EnsureWritableFolders();
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(SettingsPath, json);
        try
        {
            // Keep a copy under ProgramData so service/watchdog can read shared config
            File.WriteAllText(Path.Combine(ProgramDataDir, "settings.json"), json);
        }
        catch
        {
            /* ignore */
        }
    }
}
