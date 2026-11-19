using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace InteractGuard.Service;

internal sealed class ServiceHeartbeatResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("command")]
    public string? Command { get; set; }

    [JsonPropertyName("admin_enabled")]
    public bool? AdminEnabled { get; set; }

    [JsonPropertyName("agent_hrm_base_url")]
    public string? AgentHrmBaseUrl { get; set; }
}

internal sealed class ServiceHrmClient
{
    private readonly HttpClient _http;

    public ServiceHrmClient()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    }

    public async Task<ServiceHeartbeatResult?> HeartbeatAsync(
        string hrmBaseUrl,
        string machineId,
        string? completedCommand,
        bool agentRunning,
        CancellationToken ct)
    {
        try
        {
            var baseUrl = (hrmBaseUrl ?? "").Trim().TrimEnd('/');
            if (string.IsNullOrWhiteSpace(baseUrl)) return null;

            var url =
                $"{baseUrl}/api/presence-agent/heartbeat?_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var payload = new
            {
                machine_id = machineId,
                hostname = Environment.MachineName,
                windows_user = "SYSTEM",
                hrm_base_url = baseUrl,
                agent_version = ServiceSettings.Version,
                agent_product = "InteractGuard.Service",
                component = "service",
                completed_command = string.IsNullOrWhiteSpace(completedCommand)
                    ? null
                    : completedCommand.Trim().ToLowerInvariant(),
                agent_running = agentRunning,
            };
            using var res = await _http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonSerializer.Deserialize<ServiceHeartbeatResult>(json);
        }
        catch
        {
            return null;
        }
    }
}
