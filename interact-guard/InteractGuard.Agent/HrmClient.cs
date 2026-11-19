using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace InteractGuard;

public sealed class HeartbeatResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("assigned_employee_id")]
    public string? AssignedEmployeeId { get; set; }

    [JsonPropertyName("assigned_employee_name")]
    public string? AssignedEmployeeName { get; set; }

    [JsonPropertyName("pseudonym")]
    public string? Pseudonym { get; set; }

    /// <summary>Admin remote: pause | resume | restart | exit | on</summary>
    [JsonPropertyName("command")]
    public string? Command { get; set; }

    [JsonPropertyName("admin_enabled")]
    public bool? AdminEnabled { get; set; }

    [JsonPropertyName("idle_seconds")]
    public int? IdleSeconds { get; set; }

    [JsonPropertyName("recheck_while_idle_seconds")]
    public int? RecheckWhileIdleSeconds { get; set; }

    [JsonPropertyName("face_scan_interval_seconds")]
    public int? FaceScanIntervalSeconds { get; set; }

    [JsonPropertyName("face_verify_max_attempts")]
    public int? FaceVerifyMaxAttempts { get; set; }

    [JsonPropertyName("face_verify_retry_gap_seconds")]
    public int? FaceVerifyRetryGapSeconds { get; set; }

    [JsonPropertyName("exit_password")]
    public string? ExitPassword { get; set; }

    /// <summary>Global Presence/Idle master switch from admin settings.</summary>
    [JsonPropertyName("presence_enabled")]
    public bool? PresenceEnabled { get; set; }

    /// <summary>Global camera face verification toggle — when false, no face checks.</summary>
    [JsonPropertyName("camera_verification_enabled")]
    public bool? CameraVerificationEnabled { get; set; }

    /// <summary>Assigned employee has open HRM clock-in (no clock-out).</summary>
    [JsonPropertyName("clocked_in")]
    public bool? ClockedIn { get; set; }

    /// <summary>Admin master switch for auto screenshots (Presence/Idle page).</summary>
    [JsonPropertyName("screenshot_capture_enabled")]
    public bool? ScreenshotCaptureEnabled { get; set; }

    /// <summary>Admin-set interval for auto screenshots.</summary>
    [JsonPropertyName("screenshot_interval_seconds")]
    public int? ScreenshotIntervalSeconds { get; set; }

    /// <summary>JPEG quality 10–95 from gallery Capture settings.</summary>
    [JsonPropertyName("screenshot_jpeg_quality")]
    public int? ScreenshotJpegQuality { get; set; }

    /// <summary>Scale percent 25–100 from gallery Capture settings.</summary>
    [JsonPropertyName("screenshot_scale_percent")]
    public int? ScreenshotScalePercent { get; set; }

    [JsonPropertyName("live_preview_active")]
    public bool? LivePreviewActive { get; set; }

    [JsonPropertyName("live_interval_ms")]
    public int? LiveIntervalMs { get; set; }

    [JsonPropertyName("live_jpeg_quality")]
    public int? LiveJpegQuality { get; set; }

    [JsonPropertyName("live_scale_percent")]
    public int? LiveScalePercent { get; set; }

    /// <summary>Admin Presence page — HRM URL agents should use.</summary>
    [JsonPropertyName("agent_hrm_base_url")]
    public string? AgentHrmBaseUrl { get; set; }
}

public sealed class HrmClient
{
    private readonly AppSettings _settings;
    private readonly HttpClient _http;

    public HrmClient(AppSettings settings)
    {
        _settings = settings;
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(25) };
    }

    public async Task<HeartbeatResult?> HeartbeatAsync(CancellationToken ct = default)
    {
        try
        {
            var url =
                $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence-agent/heartbeat?_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var payload = new
            {
                machine_id = MachineIdentity.GetOrCreate(),
                hostname = MachineIdentity.Hostname,
                windows_user = MachineIdentity.WindowsUser,
                hrm_base_url = (_settings.HrmBaseUrl ?? "").Trim(),
                local_employee_id = (_settings.EmployeeId ?? "").Trim(),
                agent_version = AppSettings.Version,
                agent_product = "InteractGuard",
            };
            using var res = await _http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<HeartbeatResult>(json);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Seat-absent auto ticket: employee name + pseudonym + HRM id.
    /// </summary>
    public async Task<(bool Ok, bool Deduped, string? TicketNumber, string? Error)> PostSeatAbsentTicketAsync(
        string? reason = null,
        CancellationToken ct = default)
    {
        try
        {
            var url = $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence/seat-absent-ticket";
            var payload = new
            {
                employee_id = _settings.EmployeeId,
                employee_name = _settings.EmployeeName,
                pseudonym = _settings.Pseudonym,
                machine_id = MachineIdentity.GetOrCreate(),
                hostname = MachineIdentity.Hostname,
                reason = string.IsNullOrWhiteSpace(reason)
                    ? "Employee not at seat; no break/meeting/restroom active"
                    : reason.Trim(),
                agent_product = "InteractGuard",
                detected_at = DateTimeOffset.Now.ToString("o"),
            };
            using var res = await _http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                return (false, false, null, $"HTTP {(int)res.StatusCode}");

            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.TryGetProperty("skipped", out var skipped) &&
                    skipped.ValueKind == JsonValueKind.True)
                {
                    return (true, true, null, "skipped_active_break");
                }
                var deduped = root.TryGetProperty("deduped", out var d) && d.ValueKind == JsonValueKind.True;
                string? num = null;
                if (root.TryGetProperty("ticket_number", out var tn) && tn.ValueKind == JsonValueKind.String)
                    num = tn.GetString();
                else if (root.TryGetProperty("ticket", out var ticket) &&
                         ticket.ValueKind == JsonValueKind.Object &&
                         ticket.TryGetProperty("ticket_number", out var tn2))
                    num = tn2.GetString();
                return (true, deduped, num, null);
            }
            catch
            {
                return (true, false, null, null);
            }
        }
        catch (Exception ex)
        {
            return (false, false, null, ex.Message);
        }
    }

    public async Task<bool?> CheckActiveBreakAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.EmployeeId)) return null;
        try
        {
            var url =
                $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence/active-break?employeeId={Uri.EscapeDataString(_settings.EmployeeId)}";
            using var res = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("active", out var a))
                return a.GetBoolean();
            return false;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>True when employee has an open HRM clock-in (clock_out is null).</summary>
    public async Task<bool?> CheckClockedInAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.EmployeeId)) return null;
        try
        {
            var url =
                $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/attendance/auto-presence-check?employeeId={Uri.EscapeDataString(_settings.EmployeeId)}";
            using var res = await _http.GetAsync(url, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("clockedIn", out var c))
                return c.GetBoolean();
            return null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Opens HRM silent face page; returns true on match (best-effort via query callback later).</summary>
    public string BuildPresenceSilentUrl()
    {
        var id = Uri.EscapeDataString(_settings.EmployeeId ?? "");
        return $"{_settings.HrmBaseUrl.TrimEnd('/')}/presence-silent?employeeId={id}&source=interact-guard";
    }

    /// <summary>Upload full-screen JPEG/PNG. Returns (ok, softBusy, detail).</summary>
    public async Task<(bool Ok, bool SoftBusy, string Detail)> UploadScreenshotAsync(
        byte[] imageBytes,
        string employeeId,
        string? employeeName,
        string? pseudonym,
        CancellationToken ct = default,
        string contentType = "image/jpeg",
        DateTime? capturedAt = null)
    {
        var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(baseUrl))
            return (false, false, "HRM URL empty");

        var url = $"{baseUrl}/api/guard/screenshots";
        try
        {
            // Raw image body + headers — Next.js often fails to parse .NET MultipartFormDataContent.
            // Shared client + short timeout: do not hold HRM connections under 100+ agents.
            using var content = new ByteArrayContent(imageBytes);
            content.Headers.ContentType =
                new System.Net.Http.Headers.MediaTypeHeaderValue(
                    string.IsNullOrWhiteSpace(contentType) ? "image/jpeg" : contentType);

            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
            // Header values must be ASCII-safe (names/pseudos may have spaces/Unicode).
            static string H(string? s) => Uri.EscapeDataString(s ?? "");
            var at = capturedAt ?? DateTime.Now;
            req.Headers.TryAddWithoutValidation("x-employee-id", H(employeeId));
            req.Headers.TryAddWithoutValidation("x-employee-name", H(employeeName));
            req.Headers.TryAddWithoutValidation("x-pseudonym", H(pseudonym));
            req.Headers.TryAddWithoutValidation("x-machine-id", H(MachineIdentity.GetOrCreate()));
            req.Headers.TryAddWithoutValidation("x-captured-at", H(at.ToString("o")));
            req.Headers.TryAddWithoutValidation("x-agent-version", H(AppSettings.Version));

            using var ctsUpload = CancellationTokenSource.CreateLinkedTokenSource(ct);
            ctsUpload.CancelAfter(TimeSpan.FromSeconds(20));
            using var res = await _http.SendAsync(req, ctsUpload.Token).ConfigureAwait(false);
            if (res.IsSuccessStatusCode)
                return (true, false, $"HTTP {(int)res.StatusCode} → {baseUrl}");

            var code = (int)res.StatusCode;
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (body.Length > 120) body = body[..120];
            // 502/503/429 = proxy overload or admission — not a user-facing "failure".
            var soft = code is 502 or 503 or 429 or 504;
            return (false, soft, $"HTTP {code} {body}");
        }
        catch (TaskCanceledException)
        {
            return (false, true, "Timeout — server busy");
        }
        catch (HttpRequestException ex)
        {
            var soft = (ex.Message ?? "").Contains("502", StringComparison.OrdinalIgnoreCase)
                       || (ex.Message ?? "").Contains("503", StringComparison.OrdinalIgnoreCase);
            return (false, soft, $"Network: {ex.Message}");
        }
        catch (Exception ex)
        {
            return (false, false, $"{ex.GetType().Name}: {ex.Message}");
        }
    }
}
