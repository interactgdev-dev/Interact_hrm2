using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace InteractPresence;

/// <summary>
/// Posts unavailable-on-seat events to Interact HRM.
/// On failure, queues locally for retry (do not discard).
/// </summary>
public sealed class HrmApiClient
{
    private readonly AppSettings _settings;
    private readonly HttpClient _http;
    private readonly string _queuePath;

    public HrmApiClient(AppSettings settings)
    {
        _settings = settings;
        // Staging often uses self-signed HTTPS (e.g. 192.168.10.6:8443).
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractPresence");
        Directory.CreateDirectory(dir);
        _queuePath = Path.Combine(dir, "pending-events.json");
    }

    public async Task PostUnavailableOnSeatAsync(UnavailableEvent evt, CancellationToken ct = default)
    {
        try
        {
            // Endpoint will be added on HRM side later. Until then we queue + log.
            var url = $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence/unavailable";
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            if (!string.IsNullOrWhiteSpace(_settings.AuthToken))
                req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_settings.AuthToken}");
            req.Content = JsonContent.Create(evt);

            var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
                Enqueue(evt);
        }
        catch
        {
            Enqueue(evt);
        }
    }

    public async Task FlushQueueAsync(CancellationToken ct = default)
    {
        var list = LoadQueue();
        if (list.Count == 0) return;

        var remaining = new List<UnavailableEvent>();
        foreach (var evt in list)
        {
            try
            {
                var url = $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence/unavailable";
                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                if (!string.IsNullOrWhiteSpace(_settings.AuthToken))
                    req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_settings.AuthToken}");
                req.Content = JsonContent.Create(evt);
                var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
                if (!res.IsSuccessStatusCode)
                    remaining.Add(evt);
            }
            catch
            {
                remaining.Add(evt);
            }
        }
        SaveQueue(remaining);
    }

    /// <summary>
    /// Register / heartbeat so admin can see this PC. Applies admin-assigned Employee ID when set.
    /// </summary>
    public async Task<bool> TrySendHeartbeatAsync(AppSettings target, CancellationToken ct = default)
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
                local_employee_id = (target.EmployeeId ?? "").Trim(),
                agent_version = AgentUpdater.CurrentVersion,
            };
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.TryAddWithoutValidation("Cache-Control", "no-cache, no-store");
            req.Content = JsonContent.Create(payload);
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return false;
            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var ok) || !ok.GetBoolean()) return false;

            string? assignedId = null;
            if (root.TryGetProperty("assigned_employee_id", out var idEl))
            {
                if (idEl.ValueKind == JsonValueKind.String)
                    assignedId = (idEl.GetString() ?? "").Trim();
                else if (idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt32(out var n))
                    assignedId = n.ToString();
            }

            if (string.IsNullOrWhiteSpace(assignedId)) return true;

            var current = (target.EmployeeId ?? "").Trim();
            if (string.Equals(current, assignedId, StringComparison.OrdinalIgnoreCase))
                return true;

            target.EmployeeId = assignedId;
            if (root.TryGetProperty("assigned_employee_name", out var nameEl) &&
                nameEl.ValueKind == JsonValueKind.String)
            {
                var name = (nameEl.GetString() ?? "").Trim();
                if (name.Length > 0) target.EmployeeName = name;
            }
            try { target.Save(); } catch { /* ignore */ }
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<bool> TryApplyPresenceSettingsAsync(AppSettings target, CancellationToken ct = default)
    {
        try
        {
            // Cache-bust so nginx / proxies never serve a stale password.
            var url =
                $"{_settings.HrmBaseUrl.TrimEnd('/')}/api/presence-settings?_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.TryAddWithoutValidation("Cache-Control", "no-cache, no-store");
            req.Headers.TryAddWithoutValidation("Pragma", "no-cache");
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return false;
            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("success", out var ok) || !ok.GetBoolean()) return false;
            if (!root.TryGetProperty("settings", out var s)) return false;

            var changed = false;
            if (s.TryGetProperty("presenceEnabled", out var pe) && pe.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                var v = pe.GetBoolean();
                if (target.PresenceEnabled != v) { target.PresenceEnabled = v; changed = true; }
            }
            if (s.TryGetProperty("cameraVerificationEnabled", out var cv) && cv.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                var v = cv.GetBoolean();
                if (target.CameraVerificationEnabled != v) { target.CameraVerificationEnabled = v; changed = true; }
            }
            if (s.TryGetProperty("idleWarningSeconds", out var idle) && idle.TryGetInt32(out var idleSec))
            {
                idleSec = Math.Max(5, idleSec);
                if (target.IdleWarningSeconds != idleSec) { target.IdleWarningSeconds = idleSec; changed = true; }
            }
            if (s.TryGetProperty("popupCountdownSeconds", out var pop) && pop.TryGetInt32(out var popSec))
            {
                popSec = Math.Max(5, popSec);
                if (target.PopupCountdownSeconds != popSec) { target.PopupCountdownSeconds = popSec; changed = true; }
            }
            if (s.TryGetProperty("recheckWhileIdleSeconds", out var re) && re.TryGetInt32(out var reSec))
            {
                reSec = Math.Max(30, reSec);
                if (target.RecheckWhileIdleSeconds != reSec) { target.RecheckWhileIdleSeconds = reSec; changed = true; }
            }
            if (s.TryGetProperty("agentExitPassword", out var pw) && pw.ValueKind == JsonValueKind.String)
            {
                var v = (pw.GetString() ?? "").Trim();
                if (v.Length >= 4 &&
                    !string.Equals(target.AgentExitPassword?.Trim(), v, StringComparison.Ordinal))
                {
                    target.AgentExitPassword = v;
                    changed = true;
                }
            }
            if (s.TryGetProperty("enabledEmployeeIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
            {
                var list = new List<string>();
                foreach (var el in ids.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.String)
                    {
                        var t = (el.GetString() ?? "").Trim();
                        if (t.Length > 0) list.Add(t);
                    }
                    else if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var n))
                    {
                        list.Add(n.ToString());
                    }
                }
                list = list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (!ListEqualsIgnoreOrder(target.EnabledEmployeeIds, list))
                {
                    target.EnabledEmployeeIds = list;
                    changed = true;
                }
            }

            if (changed)
            {
                try { target.Save(); } catch { /* ignore */ }
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void Enqueue(UnavailableEvent evt)
    {
        var list = LoadQueue();
        list.Add(evt);
        SaveQueue(list);
    }

    private List<UnavailableEvent> LoadQueue()
    {
        try
        {
            if (!File.Exists(_queuePath)) return new List<UnavailableEvent>();
            var json = File.ReadAllText(_queuePath);
            return JsonSerializer.Deserialize<List<UnavailableEvent>>(json) ?? new List<UnavailableEvent>();
        }
        catch
        {
            return new List<UnavailableEvent>();
        }
    }

    private void SaveQueue(List<UnavailableEvent> list)
    {
        var json = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_queuePath, json);
    }

    private static bool ListEqualsIgnoreOrder(List<string>? a, List<string>? b)
    {
        a ??= new List<string>();
        b ??= new List<string>();
        if (a.Count != b.Count) return false;
        var set = new HashSet<string>(a, StringComparer.OrdinalIgnoreCase);
        return b.All(x => set.Contains(x));
    }
}

public sealed class UnavailableEvent
{
    public string EmployeeId { get; set; } = "";
    public string? EmployeeName { get; set; }
    public string Status { get; set; } = "Unavailable on Seat";
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public int DurationSeconds { get; set; }
    public bool ConfirmedByUser { get; set; }
}
