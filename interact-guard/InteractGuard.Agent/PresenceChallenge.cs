using System.Text.Json.Serialization;

namespace InteractGuard;

/// <summary>
/// Pending idle face-check for the open Employee Dashboard to show
/// FaceVerifyModal (same popup as Break) — no Chrome tab.
/// </summary>
public static class PresenceChallenge
{
    private static readonly object Gate = new();
    private static string? _checkId;
    private static string? _employeeId;
    private static string? _employeeName;
    private static DateTime _expiresUtc = DateTime.MinValue;

    public static void Offer(string checkId, string employeeId, string? employeeName)
    {
        lock (Gate)
        {
            _checkId = (checkId ?? "").Trim();
            _employeeId = (employeeId ?? "").Trim();
            _employeeName = string.IsNullOrWhiteSpace(employeeName) ? null : employeeName.Trim();
            _expiresUtc = DateTime.UtcNow.AddMinutes(2);
        }
    }

    public static void Clear(string? checkId = null)
    {
        lock (Gate)
        {
            if (!string.IsNullOrWhiteSpace(checkId) &&
                !string.Equals(_checkId, checkId.Trim(), StringComparison.Ordinal))
                return;
            _checkId = null;
            _employeeId = null;
            _employeeName = null;
            _expiresUtc = DateTime.MinValue;
        }
    }

    public static PresenceChallengeDto? Peek()
    {
        lock (Gate)
        {
            if (string.IsNullOrWhiteSpace(_checkId) || DateTime.UtcNow > _expiresUtc)
            {
                if (DateTime.UtcNow > _expiresUtc)
                {
                    _checkId = null;
                    _employeeId = null;
                    _employeeName = null;
                }
                return null;
            }

            return new PresenceChallengeDto
            {
                Pending = true,
                CheckId = _checkId,
                EmployeeId = _employeeId,
                EmployeeName = _employeeName,
            };
        }
    }
}

public sealed class PresenceChallengeDto
{
    [JsonPropertyName("pending")]
    public bool Pending { get; set; }

    [JsonPropertyName("check_id")]
    public string? CheckId { get; set; }

    [JsonPropertyName("employee_id")]
    public string? EmployeeId { get; set; }

    [JsonPropertyName("employee_name")]
    public string? EmployeeName { get; set; }
}
