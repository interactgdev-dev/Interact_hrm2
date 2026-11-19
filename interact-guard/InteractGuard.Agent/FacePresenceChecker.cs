using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace InteractGuard;

/// <summary>
/// Idle Guard: arms presence-session, then opens topmost WebView2 FaceVerify
/// (same Break modal via /presence-silent?embed=1). Works even when the user
/// is on another browser tab or desktop app — does not depend on Employee Dashboard.
/// </summary>
public static class FacePresenceChecker
{
    private static readonly HttpClient Http = CreateHttp();

    private static HttpClient CreateHttp()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback =
                HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    }

    public sealed class FaceCheckResult
    {
        public bool CameraOk { get; init; }
        public bool AtSeat { get; init; }
        public string? Code { get; init; }
        public string? Error { get; init; }
        public double? Similarity { get; init; }
    }

    public sealed class ArmedSession : IDisposable
    {
        public string CheckId { get; }
        private readonly string _baseUrl;
        private readonly string _employeeId;
        private readonly string? _employeeName;
        private bool _disposed;

        internal ArmedSession(string checkId, string baseUrl, string employeeId, string? employeeName)
        {
            CheckId = checkId;
            _baseUrl = baseUrl;
            _employeeId = employeeId;
            _employeeName = employeeName;
        }

        public async Task SignalStartAsync(CancellationToken ct = default)
        {
            var body = JsonSerializer.Serialize(new
            {
                check_id = CheckId,
                action = "start",
                agent_host = true,
            });
            using var req = new HttpRequestMessage(
                HttpMethod.Post,
                $"{_baseUrl}/api/biometric/presence-session")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            using (await Http.SendAsync(req, ct).ConfigureAwait(false)) { }

            // Topmost Break-style FaceVerify — independent of which page/app has focus
            var url =
                $"{_baseUrl}/presence-silent" +
                $"?employeeId={Uri.EscapeDataString(_employeeId)}" +
                $"&employeeName={Uri.EscapeDataString(_employeeName ?? "")}" +
                $"&checkId={Uri.EscapeDataString(CheckId)}" +
                "&embed=1&source=interact-guard";
            FaceVerifyHostWindow.Show(url);
        }

        public async Task CancelAsync()
        {
            PresenceChallenge.Clear(CheckId);
            FaceVerifyHostWindow.CloseActive();
            try
            {
                var body = JsonSerializer.Serialize(new { check_id = CheckId, action = "cancel" });
                using var req = new HttpRequestMessage(
                    HttpMethod.Post,
                    $"{_baseUrl}/api/biometric/presence-session")
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                };
                using var _ = await Http.SendAsync(req).ConfigureAwait(false);
            }
            catch { /* ignore */ }
        }

        public async Task<FaceCheckResult> AwaitResultAsync(int timeoutSeconds = 90)
        {
            try
            {
                var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
                while (DateTime.UtcNow < deadline)
                {
                    await Task.Delay(250).ConfigureAwait(false);
                    try
                    {
                        using var pollRes = await Http.GetAsync(
                                $"{_baseUrl}/api/biometric/presence-session?check_id={Uri.EscapeDataString(CheckId)}")
                            .ConfigureAwait(false);
                        var pollJson = await pollRes.Content.ReadAsStringAsync().ConfigureAwait(false);
                        using var pollDoc = JsonDocument.Parse(pollJson);
                        var root = pollDoc.RootElement;
                        if (root.TryGetProperty("pending", out var pending) && pending.GetBoolean())
                            continue;
                        if (root.TryGetProperty("result", out var resultEl))
                        {
                            PresenceChallenge.Clear(CheckId);
                            return ParseResult(resultEl);
                        }
                    }
                    catch
                    {
                        /* retry */
                    }
                }

                PresenceChallenge.Clear(CheckId);
                return new FaceCheckResult
                {
                    CameraOk = true,
                    AtSeat = false,
                    Code = "timeout",
                    Error = "Face did not match enrolled employee in time after clicking Here.",
                };
            }
            finally
            {
                FaceVerifyHostWindow.CloseActive();
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            PresenceChallenge.Clear(CheckId);
            FaceVerifyHostWindow.CloseActive();
        }
    }

    public static async Task<ArmedSession?> BeginArmedAsync(
        string hrmBaseUrl,
        string employeeId,
        string? employeeName = null)
    {
        if (AppSettings.IsRunningAsLocalSystem()) return null;

        var baseUrl = (hrmBaseUrl ?? "").TrimEnd('/');
        employeeId = (employeeId ?? "").Trim();
        if (string.IsNullOrEmpty(employeeId) || string.IsNullOrEmpty(baseUrl))
            return null;

        string checkId;
        try
        {
            var createBody = JsonSerializer.Serialize(new { employee_id = employeeId });
            using var createReq = new HttpRequestMessage(
                HttpMethod.Post,
                $"{baseUrl}/api/biometric/presence-session")
            {
                Content = new StringContent(createBody, Encoding.UTF8, "application/json"),
            };
            using var createRes = await Http.SendAsync(createReq).ConfigureAwait(false);
            var createJson = await createRes.Content.ReadAsStringAsync().ConfigureAwait(false);
            using var createDoc = JsonDocument.Parse(createJson);
            if (!createDoc.RootElement.TryGetProperty("check_id", out var idEl))
                return null;
            checkId = idEl.GetString() ?? "";
        }
        catch
        {
            return null;
        }

        if (string.IsNullOrEmpty(checkId)) return null;
        return new ArmedSession(checkId, baseUrl, employeeId, employeeName);
    }

    public static async Task<FaceCheckResult> VerifyAsync(
        string hrmBaseUrl,
        string employeeId,
        string? employeeName = null,
        int timeoutSeconds = 90)
    {
        var armed = await BeginArmedAsync(hrmBaseUrl, employeeId, employeeName)
            .ConfigureAwait(false);
        if (armed == null)
        {
            return new FaceCheckResult
            {
                CameraOk = false,
                AtSeat = false,
                Code = "error",
                Error = "Could not start face check",
            };
        }

        try
        {
            await armed.SignalStartAsync().ConfigureAwait(false);
            return await armed.AwaitResultAsync(timeoutSeconds).ConfigureAwait(false);
        }
        finally
        {
            armed.Dispose();
        }
    }

    private static FaceCheckResult ParseResult(JsonElement resultEl)
    {
        double? sim = null;
        if (resultEl.TryGetProperty("similarity", out var s) &&
            s.ValueKind == JsonValueKind.Number)
            sim = s.GetDouble();

        return new FaceCheckResult
        {
            CameraOk = resultEl.TryGetProperty("cameraOk", out var c) && c.GetBoolean(),
            AtSeat = resultEl.TryGetProperty("atSeat", out var a) && a.GetBoolean(),
            Code = resultEl.TryGetProperty("code", out var code) ? code.GetString() : null,
            Error = resultEl.TryGetProperty("error", out var err) &&
                    err.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
                ? err.GetString()
                : null,
            Similarity = sim,
        };
    }
}
