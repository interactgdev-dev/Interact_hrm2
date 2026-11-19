using System.Net.Http;
using System.Net.Http.Headers;

namespace InteractGuard;

/// <summary>
/// Temporary live JPEG stream while admin Guard Screenshots "Live view" is open.
/// Separate from archived auto-screenshots — does not change face/idle behavior.
/// </summary>
public sealed class LivePreviewService : IDisposable
{
    private readonly AppSettings _settings;
    private readonly object _gate = new();
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private Action<string>? _onStatus;

    public LivePreviewService(AppSettings settings)
    {
        _settings = settings;
    }

    public void BindUi(Action<string> onStatus) => _onStatus = onStatus;

    public void SyncFromSettings()
    {
        if (_settings.LivePreviewActive)
            Start();
        else
            Stop();
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_loop != null && !_loop.IsCompleted) return;
            _cts = new CancellationTokenSource();
            _loop = Task.Run(() => LoopAsync(_cts.Token));
        }
    }

    public void Stop()
    {
        CancellationTokenSource? cts;
        lock (_gate)
        {
            cts = _cts;
            _cts = null;
            _loop = null;
        }
        try { cts?.Cancel(); } catch { /* ignore */ }
        try { cts?.Dispose(); } catch { /* ignore */ }
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        await Task.Delay(400, ct).ConfigureAwait(false);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!_settings.LivePreviewActive)
                    break;

                var empId = (_settings.EmployeeId ?? "").Trim();
                if (string.IsNullOrEmpty(empId))
                {
                    _onStatus?.Invoke("Live view ON — waiting for employee bind");
                }
                else
                {
                    var quality = ScreenCaptureService.ClampJpegQuality(_settings.LiveJpegQuality);
                    var scale = ScreenCaptureService.ClampScalePercent(_settings.LiveScalePercent);
                    var jpeg = ScreenCaptureService.CapturePrimaryScreenJpeg(quality, scale);
                    if (jpeg is { Length: > 0 })
                    {
                        var ok = await UploadLiveFrameAsync(jpeg, empId, CancellationToken.None)
                            .ConfigureAwait(false);
                        if (!ok)
                            _onStatus?.Invoke("Live frame upload failed — retrying");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                /* retry */
            }

            var waitMs = Math.Clamp(_settings.LiveIntervalMs, 300, 5000);
            try
            {
                await Task.Delay(waitMs, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<bool> UploadLiveFrameAsync(byte[] jpeg, string employeeId, CancellationToken ct)
    {
        var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(baseUrl)) return false;
        var url = $"{baseUrl}/api/guard/live-frame";
        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
            using var content = new ByteArrayContent(jpeg);
            content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
            static string H(string? s) => Uri.EscapeDataString(s ?? "");
            req.Headers.TryAddWithoutValidation("x-employee-id", H(employeeId));
            req.Headers.TryAddWithoutValidation("x-employee-name", H(_settings.EmployeeName));
            req.Headers.TryAddWithoutValidation("x-pseudonym", H(_settings.Pseudonym));
            req.Headers.TryAddWithoutValidation("x-machine-id", H(MachineIdentity.GetOrCreate()));
            req.Headers.TryAddWithoutValidation("x-agent-version", H(AppSettings.Version));
            using var res = await http.SendAsync(req, ct).ConfigureAwait(false);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose() => Stop();
}
