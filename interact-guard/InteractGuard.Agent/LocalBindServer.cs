using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;

namespace InteractGuard;

/// <summary>
/// Local bridge: employee dashboard POSTs logged-in id/name/pseudo here.
/// Browser → http://127.0.0.1:19501/bind
/// </summary>
public sealed class LocalBindServer : IDisposable
{
    public const int Port = 19501;
    private readonly AppSettings _settings;
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;

    public event Action? BoundChanged;

    public LocalBindServer(AppSettings settings) => _settings = settings;

    public void Start()
    {
        try
        {
            _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
            _listener.Start();
            _loop = Task.Run(() => ListenLoopAsync(_cts.Token));
        }
        catch
        {
            /* port in use — ignore */
        }
    }

    private async Task ListenLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener.IsListening)
        {
            HttpListenerContext? ctx = null;
            try
            {
                ctx = await _listener.GetContextAsync().WaitAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                continue;
            }

            _ = Task.Run(() => HandleAsync(ctx), ct);
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx)
    {
        try
        {
            AddCors(ctx.Response);
            var path = ctx.Request.Url?.AbsolutePath?.TrimEnd('/') ?? "";
            if (ctx.Request.HttpMethod == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                ctx.Response.Close();
                return;
            }

            if (path.Equals("/status", StringComparison.OrdinalIgnoreCase) &&
                ctx.Request.HttpMethod == "GET")
            {
                await WriteJsonAsync(ctx.Response, new
                {
                    ok = true,
                    product = "InteractGuard",
                    version = AppSettings.Version,
                    hostname = Environment.MachineName,
                    machine_name = Environment.MachineName,
                    employee_id = _settings.EmployeeId,
                    employee_name = _settings.EmployeeName,
                    pseudonym = _settings.Pseudonym,
                }).ConfigureAwait(false);
                return;
            }

            // Dashboard polls this — show Break-style FaceVerifyModal in-page (no Chrome tab)
            if (path.Equals("/presence-challenge", StringComparison.OrdinalIgnoreCase) &&
                ctx.Request.HttpMethod == "GET")
            {
                var ch = PresenceChallenge.Peek();
                if (ch == null)
                {
                    await WriteJsonAsync(ctx.Response, new { ok = true, pending = false })
                        .ConfigureAwait(false);
                }
                else
                {
                    await WriteJsonAsync(ctx.Response, new
                    {
                        ok = true,
                        pending = true,
                        check_id = ch.CheckId,
                        employee_id = ch.EmployeeId,
                        employee_name = ch.EmployeeName,
                    }).ConfigureAwait(false);
                }
                return;
            }

            if (path.Equals("/presence-result", StringComparison.OrdinalIgnoreCase) &&
                ctx.Request.HttpMethod == "POST")
            {
                using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding);
                var raw = await reader.ReadToEndAsync().ConfigureAwait(false);
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
                var root = doc.RootElement;
                var checkId = GetStr(root, "check_id", "checkId") ?? "";
                PresenceChallenge.Clear(checkId);
                await WriteJsonAsync(ctx.Response, new { ok = true }).ConfigureAwait(false);
                return;
            }

            if (path.Equals("/bind", StringComparison.OrdinalIgnoreCase) &&
                ctx.Request.HttpMethod == "POST")
            {
                using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding);
                var raw = await reader.ReadToEndAsync().ConfigureAwait(false);
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
                var root = doc.RootElement;
                var id = GetStr(root, "employee_id", "employeeId", "id");
                var name = GetStr(root, "employee_name", "employeeName", "name");
                var pseudo = GetStr(root, "pseudonym", "pseudo", "pseudo_name");

                if (string.IsNullOrWhiteSpace(id) || !id.All(char.IsDigit))
                {
                    ctx.Response.StatusCode = 400;
                    await WriteJsonAsync(ctx.Response, new { ok = false, error = "employee_id required" })
                        .ConfigureAwait(false);
                    return;
                }

                _settings.EmployeeId = id.Trim();
                if (!string.IsNullOrWhiteSpace(name))
                    _settings.EmployeeName = name.Trim();
                if (!string.IsNullOrWhiteSpace(pseudo))
                    _settings.Pseudonym = pseudo.Trim();
                _settings.Save();
                BoundChanged?.Invoke();

                await WriteJsonAsync(ctx.Response, new
                {
                    ok = true,
                    employee_id = _settings.EmployeeId,
                    employee_name = _settings.EmployeeName,
                    pseudonym = _settings.Pseudonym,
                }).ConfigureAwait(false);
                return;
            }

            ctx.Response.StatusCode = 404;
            await WriteJsonAsync(ctx.Response, new { ok = false, error = "not found" }).ConfigureAwait(false);
        }
        catch
        {
            try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { /* ignore */ }
        }
    }

    private static string? GetStr(JsonElement root, params string[] keys)
    {
        foreach (var k in keys)
        {
            if (root.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String)
            {
                var s = v.GetString()?.Trim();
                if (!string.IsNullOrEmpty(s)) return s;
            }
            if (root.TryGetProperty(k, out var n) && n.ValueKind == JsonValueKind.Number)
                return n.GetRawText();
        }
        return null;
    }

    private static void AddCors(HttpListenerResponse res)
    {
        res.Headers.Add("Access-Control-Allow-Origin", "*");
        res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
    }

    private static async Task WriteJsonAsync(HttpListenerResponse res, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        res.Close();
    }

    public void Dispose()
    {
        try { _cts.Cancel(); } catch { /* ignore */ }
        try { _listener.Stop(); } catch { /* ignore */ }
        try { _listener.Close(); } catch { /* ignore */ }
        _cts.Dispose();
    }
}
