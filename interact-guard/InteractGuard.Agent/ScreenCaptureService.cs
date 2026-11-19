using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

namespace InteractGuard;

/// <summary>
/// Primary-screen capture on a timer (JPEG + optional scale).
/// Save on PC + upload to HRM immediately (admin sees live) → keep local
/// <see cref="LocalRetainDays"/> days → then delete local only.
/// Failed uploads retry slowly; never popup-notify; rate-limit so HRM stays up.
/// </summary>
public sealed class ScreenCaptureService : IDisposable
{
    /// <summary>Local files younger than this stay on the PC; only older ones upload.</summary>
    public const int LocalRetainDays = 3;

    /// <summary>Server rejects above this; skip save instead of wasting disk/bandwidth.</summary>
    private const int MaxUploadBytes = 3 * 1024 * 1024;

    /// <summary>Min/max gap between successive uploads from this PC (HRM safety).</summary>
    private const int UploadGapMinSeconds = 60;
    private const int UploadGapMaxSeconds = 180;

    /// <summary>Extra wait when HRM returns busy/timeout.</summary>
    private const int BusyBackoffSeconds = 300;

    private static readonly Regex CapturedAtInName = new(
        @"^(?<stamp>\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly AppSettings _settings;
    private readonly HrmClient _hrm;
    private readonly object _gate = new();
    private CancellationTokenSource? _cts;
    private Task? _captureLoop;
    private Task? _uploadLoop;
    private Action<string>? _onStatus;

    public ScreenCaptureService(AppSettings settings, HrmClient hrm)
    {
        _settings = settings;
        _hrm = hrm;
    }

    /// <summary>Local queue root: %LocalAppData%\InteractGuard\pending-screenshots\...</summary>
    public static string PendingScreenshotsDir =>
        Path.Combine(AppSettings.DataDir, "pending-screenshots");

    /// <summary>
    /// Status text only (tray tooltip) — never balloons/toasts.
    /// Upload fail / HRM down must stay silent; only install notice may notify the user.
    /// </summary>
    public void BindUi(Action<string> onStatus)
    {
        _onStatus = onStatus;
    }

    public void SyncFromSettings()
    {
        // Capture follows admin toggle; upload drain always runs while agent is up
        // so aged local files still clear even if capture is temporarily off.
        Start();
        if (!_settings.ScreenshotCaptureEnabled)
            _onStatus?.Invoke("Screenshots capture OFF — aged local queue still drains slowly");
    }

    public void SetEnabled(bool enabled)
    {
        _settings.ScreenshotCaptureEnabled = enabled;
        _settings.Save();
        SyncFromSettings();
        // Silent — no balloon/toast on enable/disable or any upload outcome.
        _onStatus?.Invoke(
            enabled
                ? $"Screenshots ON — local+HRM · keep local {LocalRetainDays}d · every {ClampInterval(_settings.ScreenshotIntervalSeconds)}s"
                : "Screenshots capture OFF — unsent/local cleanup still runs");
    }

    public void Start()
    {
        // Do NOT wipe pending-screenshots — that is the intentional local queue.
        PurgeLegacyScreenshotFoldersOnly();
        try
        {
            Directory.CreateDirectory(PendingScreenshotsDir);
        }
        catch
        {
            /* best-effort */
        }

        lock (_gate)
        {
            if (_cts != null && _captureLoop != null && !_captureLoop.IsCompleted)
                return;
            _cts?.Cancel();
            _cts?.Dispose();
            _cts = new CancellationTokenSource();
            var ct = _cts.Token;
            _captureLoop = Task.Run(() => CaptureLoopAsync(ct));
            _uploadLoop = Task.Run(() => UploadAgedLoopAsync(ct));
        }
    }

    public void Stop()
    {
        CancellationTokenSource? cts;
        lock (_gate)
        {
            cts = _cts;
            _cts = null;
            _captureLoop = null;
            _uploadLoop = null;
        }
        try { cts?.Cancel(); } catch { /* ignore */ }
        try { cts?.Dispose(); } catch { /* ignore */ }
    }

    private async Task CaptureLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!_settings.ScreenshotCaptureEnabled)
                {
                    await Task.Delay(TimeSpan.FromSeconds(20), ct).ConfigureAwait(false);
                    continue;
                }

                var interval = ClampInterval(_settings.ScreenshotIntervalSeconds);
                var slotKey =
                    $"{(_settings.EmployeeId ?? "").Trim()}|{MachineIdentity.GetOrCreate()}|{MachineIdentity.Hostname}";
                await WaitForCaptureSlotAsync(slotKey, interval, ct).ConfigureAwait(false);

                if (!_settings.ScreenshotCaptureEnabled)
                    continue;

                var empId = (_settings.EmployeeId ?? "").Trim();
                if (string.IsNullOrEmpty(empId))
                {
                    _onStatus?.Invoke("Screenshots ON — waiting for employee bind");
                    await Task.Delay(TimeSpan.FromSeconds(15), ct).ConfigureAwait(false);
                    continue;
                }

                var quality = ClampJpegQuality(_settings.ScreenshotJpegQuality);
                var scale = ClampScalePercent(_settings.ScreenshotScalePercent);
                byte[]? jpeg = null;
                try
                {
                    jpeg = CapturePrimaryScreenJpeg(quality, scale);
                    if (jpeg == null || jpeg.Length == 0)
                    {
                        _onStatus?.Invoke("Screenshot capture failed (empty) — next slot");
                    }
                    else if (jpeg.Length > MaxUploadBytes)
                    {
                        _onStatus?.Invoke(
                            $"Screenshot skipped — {jpeg.Length / 1024} KB > 3MB (lower quality/scale)");
                    }
                    else
                    {
                        var capturedAt = DateTime.Now;
                        var path = SaveLocalPending(jpeg, empId, capturedAt);
                        var kb = Math.Max(1, jpeg.Length / 1024);
                        if (path == null)
                        {
                            _onStatus?.Invoke("Screenshot local save failed — next slot");
                        }
                        else
                        {
                            // Admin gallery needs the shot now — upload immediately (silent on fail).
                            var (ok, softBusy, _) = await _hrm.UploadScreenshotAsync(
                                    jpeg,
                                    empId,
                                    _settings.EmployeeName,
                                    _settings.Pseudonym,
                                    CancellationToken.None,
                                    "image/jpeg",
                                    capturedAt)
                                .ConfigureAwait(false);
                            if (ok)
                            {
                                MarkSent(path);
                                _onStatus?.Invoke(
                                    $"Screenshot → HRM + local {kb} KB · keep {LocalRetainDays}d · {capturedAt:HH:mm:ss}");
                            }
                            else
                            {
                                // Keep local; background loop retries — no popup.
                                _onStatus?.Invoke(
                                    softBusy
                                        ? $"Screenshot local {kb} KB · HRM busy, will retry · {capturedAt:HH:mm:ss}"
                                        : $"Screenshot local {kb} KB · HRM upload deferred · {capturedAt:HH:mm:ss}");
                                if (softBusy)
                                {
                                    try
                                    {
                                        await Task.Delay(TimeSpan.FromSeconds(60), ct)
                                            .ConfigureAwait(false);
                                    }
                                    catch (OperationCanceledException)
                                    {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
                finally
                {
                    if (jpeg != null)
                    {
                        Array.Clear(jpeg, 0, jpeg.Length);
                        jpeg = null;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _onStatus?.Invoke($"Screenshot error: {ex.GetType().Name} — next slot");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(20), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    /// <summary>
    /// (1) Retry unsent local files so admin eventually gets them if immediate upload failed.
    /// (2) Delete local files older than <see cref="LocalRetainDays"/> (disk cleanup).
    /// One file at a time + gaps + busy backoff so HRM stays up. No popups.
    /// </summary>
    private async Task UploadAgedLoopAsync(CancellationToken ct)
    {
        try
        {
            var bootJitter = StableOffsetSeconds(
                $"{MachineIdentity.GetOrCreate()}|upload-boot",
                600);
            await Task.Delay(TimeSpan.FromSeconds(30 + bootJitter), ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var empId = (_settings.EmployeeId ?? "").Trim();
                if (string.IsNullOrEmpty(empId) ||
                    string.IsNullOrWhiteSpace(_settings.HrmBaseUrl))
                {
                    await Task.Delay(TimeSpan.FromSeconds(60), ct).ConfigureAwait(false);
                    continue;
                }

                // Disk cleanup first — already-sent locals past retain window
                PurgeExpiredLocalFiles(empId);

                var unsent = FindUnsentPendingFiles(empId).Take(1).ToList();
                if (unsent.Count == 0)
                {
                    await Task.Delay(TimeSpan.FromMinutes(2), ct).ConfigureAwait(false);
                    continue;
                }

                var file = unsent[0];
                byte[]? bytes = null;
                try
                {
                    bytes = await File.ReadAllBytesAsync(file, ct).ConfigureAwait(false);
                    if (bytes.Length == 0 || bytes.Length > MaxUploadBytes)
                    {
                        TryDeleteLocal(file);
                        continue;
                    }

                    var capturedAt = ParseCapturedAt(file) ?? File.GetLastWriteTime(file);
                    var (ok, softBusy, _) = await _hrm.UploadScreenshotAsync(
                            bytes,
                            empId,
                            _settings.EmployeeName,
                            _settings.Pseudonym,
                            ct,
                            "image/jpeg",
                            capturedAt)
                        .ConfigureAwait(false);

                    if (ok)
                    {
                        MarkSent(file);
                        _onStatus?.Invoke(
                            $"Queued screenshot → HRM · local kept {LocalRetainDays}d · {DateTime.Now:HH:mm:ss}");
                        var gap = Random.Shared.Next(UploadGapMinSeconds, UploadGapMaxSeconds + 1);
                        await Task.Delay(TimeSpan.FromSeconds(gap), ct).ConfigureAwait(false);
                    }
                    else if (softBusy)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(BusyBackoffSeconds), ct)
                            .ConfigureAwait(false);
                    }
                    else
                    {
                        await Task.Delay(TimeSpan.FromSeconds(120), ct).ConfigureAwait(false);
                    }
                }
                finally
                {
                    if (bytes != null)
                    {
                        Array.Clear(bytes, 0, bytes.Length);
                        bytes = null;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(90), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private string? SaveLocalPending(byte[] jpeg, string employeeId, DateTime capturedAt)
    {
        try
        {
            var day = capturedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var stamp = capturedAt.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture);
            var dir = Path.Combine(PendingScreenshotsDir, SanitizePathPart(employeeId), day);
            Directory.CreateDirectory(dir);
            var name = $"{stamp}__{SanitizePathPart(employeeId)}.jpg";
            var path = Path.Combine(dir, name);
            // Unique if same-second collision
            if (File.Exists(path))
                path = Path.Combine(dir, $"{stamp}__{SanitizePathPart(employeeId)}_{Guid.NewGuid():N}.jpg");
            File.WriteAllBytes(path, jpeg);
            try
            {
                File.SetCreationTime(path, capturedAt);
                File.SetLastWriteTime(path, capturedAt);
            }
            catch
            {
                /* ignore */
            }
            return path;
        }
        catch
        {
            return null;
        }
    }

    private static string SentMarkerPath(string jpgPath) => jpgPath + ".sent";

    private static void MarkSent(string jpgPath)
    {
        try
        {
            File.WriteAllText(SentMarkerPath(jpgPath), DateTime.UtcNow.ToString("o"));
        }
        catch
        {
            /* ignore */
        }
    }

    private static bool IsSent(string jpgPath)
    {
        try
        {
            return File.Exists(SentMarkerPath(jpgPath));
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Local JPGs not yet confirmed on HRM (immediate upload missed / failed).</summary>
    private IEnumerable<string> FindUnsentPendingFiles(string employeeId)
    {
        var root = Path.Combine(PendingScreenshotsDir, SanitizePathPart(employeeId));
        if (!Directory.Exists(root))
            yield break;

        string[] files;
        try
        {
            files = Directory.GetFiles(root, "*.jpg", SearchOption.AllDirectories);
        }
        catch
        {
            yield break;
        }

        Array.Sort(files, StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            if (!IsSent(file))
                yield return file;
        }
    }

    /// <summary>Delete local JPGs (and .sent markers) older than retain window.</summary>
    private void PurgeExpiredLocalFiles(string employeeId)
    {
        var root = Path.Combine(PendingScreenshotsDir, SanitizePathPart(employeeId));
        if (!Directory.Exists(root)) return;

        var cutoff = DateTime.Now.AddDays(-LocalRetainDays);
        string[] files;
        try
        {
            files = Directory.GetFiles(root, "*.jpg", SearchOption.AllDirectories);
        }
        catch
        {
            return;
        }

        foreach (var file in files)
        {
            try
            {
                var when = ParseCapturedAt(file) ?? File.GetLastWriteTime(file);
                if (when > cutoff) continue;
                TryDeleteLocal(file);
            }
            catch
            {
                /* ignore */
            }
        }
    }

    private static DateTime? ParseCapturedAt(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path);
        var m = CapturedAtInName.Match(name ?? "");
        if (!m.Success) return null;
        if (DateTime.TryParseExact(
                m.Groups["stamp"].Value,
                "yyyy-MM-dd_HH-mm-ss",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out var dt))
            return dt;
        return null;
    }

    private static void TryDeleteLocal(string path)
    {
        try
        {
            var marker = SentMarkerPath(path);
            if (File.Exists(marker)) File.Delete(marker);
        }
        catch
        {
            /* ignore */
        }

        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            /* keep for next retry */
        }

        try
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) &&
                Directory.Exists(dir) &&
                !Directory.EnumerateFileSystemEntries(dir).Any())
            {
                Directory.Delete(dir, recursive: false);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    private static string SanitizePathPart(string raw)
    {
        var s = (raw ?? "").Trim();
        foreach (var c in Path.GetInvalidFileNameChars())
            s = s.Replace(c, '_');
        return string.IsNullOrEmpty(s) ? "unknown" : s;
    }

    /// <summary>
    /// Align captures to UTC windows so agents do not all capture at once.
    /// </summary>
    private static async Task WaitForCaptureSlotAsync(
        string slotKey,
        int intervalSeconds,
        CancellationToken ct)
    {
        if (intervalSeconds < 1) intervalSeconds = 1;
        var slot = StableOffsetSeconds(slotKey, intervalSeconds);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var windowStart = now - (now % intervalSeconds);
        var next = windowStart + slot;
        if (next <= now) next += intervalSeconds;
        var jitterMs = Random.Shared.Next(0, 2000);
        var delay = TimeSpan.FromSeconds(next - now) + TimeSpan.FromMilliseconds(jitterMs);
        if (delay < TimeSpan.FromMilliseconds(200))
            delay = TimeSpan.FromMilliseconds(200);
        await Task.Delay(delay, ct).ConfigureAwait(false);
    }

    private static int StableOffsetSeconds(string key, int intervalSeconds)
    {
        if (intervalSeconds < 1) intervalSeconds = 1;
        unchecked
        {
            var h = 17;
            foreach (var c in (key ?? ""))
                h = h * 31 + c;
            if (string.IsNullOrEmpty(key))
                h ^= Environment.MachineName.GetHashCode();
            if (h < 0) h = -h;
            return h % intervalSeconds;
        }
    }

    /// <summary>
    /// Delete legacy local screenshot folders from older builds — never the pending queue.
    /// </summary>
    public static void PurgeLocalScreenshotFolders() => PurgeLegacyScreenshotFoldersOnly();

    public static void PurgeLegacyScreenshotFoldersOnly()
    {
        try
        {
            var roots = new[]
            {
                AppSettings.DataDir,
                AppSettings.ProgramDataDir,
            };
            // NOTE: "pending-screenshots" is intentionally NOT listed — that is the 3-day queue.
            string[] names =
            {
                "screenshots",
                "screenshot",
                "pending_screenshots",
                "pending",
                "captures",
                "gallery-pending",
            };
            foreach (var root in roots)
            {
                if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) continue;
                foreach (var name in names)
                {
                    var dir = Path.Combine(root, name);
                    try
                    {
                        if (Directory.Exists(dir))
                            Directory.Delete(dir, recursive: true);
                    }
                    catch
                    {
                        /* best-effort */
                    }
                }

                // Loose leftovers only in data root — not inside pending-screenshots
                try
                {
                    foreach (var file in Directory.EnumerateFiles(root, "*.jpg"))
                        try { File.Delete(file); } catch { /* ignore */ }
                    foreach (var file in Directory.EnumerateFiles(root, "*.jpeg"))
                        try { File.Delete(file); } catch { /* ignore */ }
                    foreach (var file in Directory.EnumerateFiles(root, "*.png"))
                        try { File.Delete(file); } catch { /* ignore */ }
                }
                catch
                {
                    /* ignore */
                }
            }
        }
        catch
        {
            /* never break capture loop */
        }
    }

    public static int ClampInterval(int seconds)
    {
        if (seconds < 120) return 120;
        if (seconds > 3600) return 3600;
        return seconds;
    }

    public static int ClampJpegQuality(int quality)
    {
        if (quality < 10) return 10;
        if (quality > 95) return 95;
        return quality;
    }

    public static int ClampScalePercent(int percent)
    {
        if (percent < 25) return 25;
        if (percent > 100) return 100;
        return percent;
    }

    public static byte[]? CapturePrimaryScreenJpeg(int jpegQuality, int scalePercent)
    {
        try
        {
            var bounds = System.Windows.Forms.Screen.PrimaryScreen?.Bounds
                         ?? new Rectangle(0, 0, 1920, 1080);
            using var src = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(src))
            {
                g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
            }

            var scale = ClampScalePercent(scalePercent) / 100.0;
            var quality = ClampJpegQuality(jpegQuality);
            Bitmap toEncode = src;
            Bitmap? scaled = null;
            try
            {
                if (scale < 0.999)
                {
                    var w = Math.Max(1, (int)Math.Round(src.Width * scale));
                    var h = Math.Max(1, (int)Math.Round(src.Height * scale));
                    scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb);
                    using var sg = Graphics.FromImage(scaled);
                    sg.CompositingQuality = CompositingQuality.HighQuality;
                    sg.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    sg.SmoothingMode = SmoothingMode.HighQuality;
                    sg.DrawImage(src, 0, 0, w, h);
                    toEncode = scaled;
                }

                using var ms = new MemoryStream();
                SaveJpeg(toEncode, ms, quality);
                return ms.ToArray();
            }
            finally
            {
                scaled?.Dispose();
            }
        }
        catch
        {
            return null;
        }
    }

    private static void SaveJpeg(Image image, Stream stream, int quality)
    {
        var encoder = GetEncoder(ImageFormat.Jpeg);
        if (encoder == null)
        {
            image.Save(stream, ImageFormat.Jpeg);
            return;
        }

        using var ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
        image.Save(stream, encoder, ep);
    }

    private static ImageCodecInfo? GetEncoder(ImageFormat format)
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
        {
            if (codec.FormatID == format.Guid) return codec;
        }
        return null;
    }

    public void Dispose() => Stop();
}
