using System.Net.Http;
using System.Net.Http.Json;

namespace InteractGuard;

/// <summary>
/// TEST/SIMULATION ONLY — feeds a fixed synthetic keyboard-event sequence through the
/// same Guard ingest API. Does NOT install a keyboard hook and does NOT read real input
/// from other applications.
/// </summary>
public sealed class KeyboardSimulationService
{
    /// <summary>Hard-coded fixture: w a q a s [space] r a f i q</summary>
    public static readonly string[] DefaultTokens =
    {
        "w", "a", "q", "a", "s", "[space]", "r", "a", "f", "i", "q",
    };

    public const string SimulationAppName = "InteractGuard.SIMULATION";
    public const string SimulationWindow = "TEST / SIMULATION — synthetic keyboard pipeline";

    private readonly AppSettings _settings;
    private readonly object _gate = new();
    private bool _running;

    public KeyboardSimulationService(AppSettings settings)
    {
        _settings = settings;
    }

    /// <summary>
    /// Builds ordered synthetic events, groups into one session, POSTs to
    /// /api/guard/keyboard-activity with is_simulation=true.
    /// </summary>
    public async Task<(bool ok, string detail)> RunOnceAsync(
        CancellationToken ct = default,
        Action<string>? onStatus = null)
    {
        lock (_gate)
        {
            if (_running) return (false, "Simulation already running");
            _running = true;
        }

        try
        {
            var empId = (_settings.EmployeeId ?? "").Trim();
            if (string.IsNullOrEmpty(empId))
                return (false, "Bind an employee first (open Employee Dashboard once)");

            var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
            if (string.IsNullOrEmpty(baseUrl))
                return (false, "HRM base URL missing");

            onStatus?.Invoke("TEST/SIMULATION: generating synthetic keyboard events…");

            var periodStart = DateTime.Now;
            var events = new List<object>();
            var ord = 0;
            foreach (var token in DefaultTokens)
            {
                // Preserve order with staggered timestamps (80ms apart).
                var at = periodStart.AddMilliseconds(ord * 80);
                events.Add(new
                {
                    ord,
                    token,
                    captured_at = at.ToString("o"),
                    app_name = SimulationAppName,
                    window_title = SimulationWindow,
                });
                ord++;
                await Task.Delay(15, ct).ConfigureAwait(false);
            }

            var periodEnd = periodStart.AddMilliseconds(Math.Max(1, (DefaultTokens.Length - 1) * 80));
            var typingActiveMs = Math.Max(0, (DefaultTokens.Length - 1) * 80);
            var batchId = "sim-" + Guid.NewGuid().ToString("N");

            var payload = new
            {
                is_simulation = true,
                mode = "TEST_SIMULATION",
                batch_id = batchId,
                employee_id = empId,
                employee_name = _settings.EmployeeName,
                pseudonym = _settings.Pseudonym,
                machine_id = MachineIdentity.GetOrCreate(),
                hostname = MachineIdentity.Hostname,
                windows_user = MachineIdentity.WindowsUser,
                period_start = periodStart.ToString("o"),
                period_end = periodEnd.ToString("o"),
                segments = new[]
                {
                    new
                    {
                        app_name = SimulationAppName,
                        app_path = (string?)null,
                        key_down_count = DefaultTokens.Length,
                        typing_active_ms = typingActiveMs,
                        keyboard_idle_ms = 0,
                        simulation_events = events,
                        simulation_sequence = string.Join(" → ", DefaultTokens),
                    },
                },
            };

            onStatus?.Invoke("TEST/SIMULATION: posting session to HRM…");

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(25) };
            var url = $"{baseUrl}/api/guard/keyboard-activity";
            using var res = await http.PostAsJsonAsync(url, payload, ct).ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                var tip = body.Length > 180 ? body[..180] + "…" : body;
                return (false, $"HTTP {(int)res.StatusCode}: {tip}");
            }

            onStatus?.Invoke(
                $"TEST/SIMULATION OK — {DefaultTokens.Length} synthetic events → {SimulationAppName}");
            return (true, $"Posted {DefaultTokens.Length} synthetic tokens (batch {batchId[..8]}…)");
        }
        catch (OperationCanceledException)
        {
            return (false, "Cancelled");
        }
        catch (Exception ex)
        {
            return (false, ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            lock (_gate) _running = false;
        }
    }
}
