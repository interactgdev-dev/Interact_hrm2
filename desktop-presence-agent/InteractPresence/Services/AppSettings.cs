using System.IO;
using System.Text.Json;

namespace InteractPresence;

public sealed class AppSettings
{
    public string HrmBaseUrl { get; set; } = "https://192.168.10.6:8443";
    public string? EmployeeId { get; set; }
    public string? EmployeeName { get; set; }
    public string? AuthToken { get; set; }

    /// <summary>Seconds of global idle before presence flow. Overridden by HRM admin settings.</summary>
    public int IdleWarningSeconds { get; set; } = 10;

    /// <summary>Seconds the popup countdown runs before auto-log timeout.</summary>
    public int PopupCountdownSeconds { get; set; } = 30;

    /// <summary>Optional: call LockWorkStation on timeout. Default OFF.</summary>
    public bool LockScreenOnTimeout { get; set; } = false;

    /// <summary>Poll interval for GetLastInputInfo while Active.</summary>
    public int PollIntervalSeconds { get; set; } = 2;

    /// <summary>
    /// After a successful seated match while still idle, wait this long before
    /// another camera check. Prevents spam re-verify every few seconds.
    /// </summary>
    public int RecheckWhileIdleSeconds { get; set; } = 120;

    /// <summary>Master switch from Admin → Presence / Idle.</summary>
    public bool PresenceEnabled { get; set; } = true;

    /// <summary>When true, agent must shut down permanently (admin retired all agents).</summary>
    public bool AgentsRetired { get; set; } = false;

    /// <summary>
    /// true = idle then camera/face check; false = idle mouse/keyboard only → popup.
    /// </summary>
    public bool CameraVerificationEnabled { get; set; } = true;

  /// <summary>
  /// Password required to Exit (and to disable auto-start). Synced from HRM admin.
  /// Default matches HRM DEFAULT_PRESENCE_SETTINGS.agentExitPassword.
  /// </summary>
  public string AgentExitPassword { get; set; } = "InteractAdmin";

  /// <summary>
  /// Empty = all employees. Otherwise only these employee IDs may run monitoring.
  /// </summary>
  public List<string> EnabledEmployeeIds { get; set; } = new();

  private static string SettingsPath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence",
            "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            }
        }
        catch
        {
            /* use defaults */
        }
        return new AppSettings();
    }

    public void Save()
    {
        var dir = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(SettingsPath, json);
    }
}
