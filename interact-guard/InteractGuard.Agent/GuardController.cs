using System.Diagnostics;
using System.Windows.Threading;
using Application = System.Windows.Application;

namespace InteractGuard;

/// <summary>
/// Core loop: heartbeat always (shows in Admin after install).
/// Face / seat monitoring only when AdminEnabled == true.
/// Flow: admin timer (clocked in, no break) → face verify × N (gap) → OK / ticket.
/// Idle is ignored. Active break skips verification.
/// </summary>
public sealed class GuardController : IDisposable
{
    private readonly AppSettings _settings;
    private readonly HrmClient _hrm;
    private readonly LocalBindServer _bindServer;
    private readonly ScreenCaptureService _screenshots;
    private readonly LivePreviewService _livePreview;
    private readonly ForegroundActivityService _appActivity;
    private readonly KeyboardActivityService _keyboardActivity;
    private readonly KeyboardSimulationService _keyboardSimulation;
    private readonly CancellationTokenSource _cts = new();
    private DispatcherTimer? _pollTimer;
    private DateTime _lastFaceCheckUtc = DateTime.MinValue;
    private DateTime _lastTicketUtc = DateTime.MinValue;
    private bool _faceInProgress;

    public event Action<string>? StatusChanged;
    /// <summary>title, body, success — tray balloon + on-screen toast.</summary>
    public event Action<string, string, bool>? NotifyUser;

    public bool ScreenshotCaptureEnabled => _settings.ScreenshotCaptureEnabled;
    public bool KeyboardMetricsCollecting => _keyboardActivity.IsCollecting;

    /// <summary>
    /// TEST/SIMULATION: synthetic keyboard pipeline (no real key capture).
    /// </summary>
    public async Task<(bool ok, string detail)> RunKeyboardPipelineSimulationAsync()
    {
        SetStatus("TEST/SIMULATION: keyboard pipeline starting…");
        var (ok, detail) = await _keyboardSimulation
            .RunOnceAsync(CancellationToken.None, SetStatus)
            .ConfigureAwait(false);
        Notify(
            ok ? "Keyboard pipeline TEST OK" : "Keyboard pipeline TEST failed",
            detail,
            ok);
        if (ok) SetStatus("TEST/SIMULATION complete — check Guard Screenshots → Keyboard activity");
        return (ok, detail);
    }

    public GuardController(AppSettings settings)
    {
        _settings = settings;
        _hrm = new HrmClient(settings);
        _screenshots = new ScreenCaptureService(settings, _hrm);
        _livePreview = new LivePreviewService(settings);
        _appActivity = new ForegroundActivityService(settings);
        _keyboardActivity = new KeyboardActivityService(settings);
        _keyboardSimulation = new KeyboardSimulationService(settings);
        _bindServer = new LocalBindServer(settings);
        _bindServer.BoundChanged += () =>
        {
            SetStatus($"Bound: {_settings.EmployeeName} (ID {_settings.EmployeeId})");
            _ = _hrm.HeartbeatAsync();
            _screenshots.SyncFromSettings();
            _livePreview.SyncFromSettings();
            _keyboardActivity.SyncFromSettings();
        };
    }

    public async Task StartAsync()
    {
        _screenshots.BindUi(SetStatus); // status only — never toast on upload fail / HRM down
        _livePreview.BindUi(SetStatus);
        _keyboardActivity.BindUi(SetStatus, Notify);
        _appActivity.BindUi(SetStatus);
        _bindServer.Start();
        SetStatus(
            !string.IsNullOrWhiteSpace(_settings.EmployeeId)
                ? (_settings.AdminEnabled
                    ? $"Armed — face scan every {_settings.FaceScanIntervalSeconds}s"
                    : $"Bound {_settings.EmployeeName} — waiting for Admin ON")
                : "Installed — open Employee Dashboard once to auto-bind");
        _ = HeartbeatLoopAsync(_cts.Token);

        _pollTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(Math.Max(1, _settings.PollIntervalSeconds)),
        };
        _pollTimer.Tick += async (_, _) => await OnPollAsync();
        _pollTimer.Start();
        _screenshots.SyncFromSettings();
        _livePreview.SyncFromSettings();
        _appActivity.Start();
        _keyboardActivity.SyncFromSettings();
        await Task.CompletedTask;
    }

    public void SetScreenshotCaptureEnabled(bool enabled) => _screenshots.SetEnabled(enabled);

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var hb = await _hrm.HeartbeatAsync(ct).ConfigureAwait(false);
                ApplyHeartbeat(hb);
            }
            catch
            {
                /* keep running */
            }

            try
            {
                // Faster poll while live view is on so agents join/leave quickly.
                var delaySec = _settings.LivePreviewActive ? 4 : 12;
                await Task.Delay(TimeSpan.FromSeconds(delaySec), ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void ApplyHeartbeat(HeartbeatResult? hb)
    {
        if (hb == null) return;

        if (!string.IsNullOrWhiteSpace(hb.AssignedEmployeeId))
            _settings.EmployeeId = hb.AssignedEmployeeId.Trim();
        if (!string.IsNullOrWhiteSpace(hb.AssignedEmployeeName))
            _settings.EmployeeName = hb.AssignedEmployeeName.Trim();
        if (!string.IsNullOrWhiteSpace(hb.Pseudonym))
            _settings.Pseudonym = hb.Pseudonym.Trim();
        if (hb.AdminEnabled.HasValue)
            _settings.AdminEnabled = hb.AdminEnabled.Value;
        if (hb.PresenceEnabled.HasValue)
            _settings.PresenceMonitoringEnabled = hb.PresenceEnabled.Value;
        if (hb.CameraVerificationEnabled.HasValue)
            _settings.CameraVerificationEnabled = hb.CameraVerificationEnabled.Value;
        if (hb.ClockedIn.HasValue)
            _settings.ClockedIn = hb.ClockedIn.Value;
        if (hb.IdleSeconds is > 0)
            _settings.IdleSecondsBeforeCheck = hb.IdleSeconds.Value;
        if (hb.RecheckWhileIdleSeconds is > 0)
            _settings.RecheckWhileIdleSeconds = hb.RecheckWhileIdleSeconds.Value;
        if (hb.FaceScanIntervalSeconds is > 0)
            _settings.FaceScanIntervalSeconds = hb.FaceScanIntervalSeconds.Value;
        else if (hb.IdleSeconds is > 0)
            _settings.FaceScanIntervalSeconds = hb.IdleSeconds.Value;
        if (hb.FaceVerifyMaxAttempts is > 0)
            _settings.FaceVerifyMaxAttempts = Math.Clamp(hb.FaceVerifyMaxAttempts.Value, 1, 10);
        if (hb.FaceVerifyRetryGapSeconds is > 0)
            _settings.FaceVerifyRetryGapSeconds = Math.Clamp(hb.FaceVerifyRetryGapSeconds.Value, 5, 120);
        if (hb.ScreenshotCaptureEnabled.HasValue)
            _settings.ScreenshotCaptureEnabled = hb.ScreenshotCaptureEnabled.Value;
        if (hb.ScreenshotIntervalSeconds is > 0)
            _settings.ScreenshotIntervalSeconds =
                ScreenCaptureService.ClampInterval(hb.ScreenshotIntervalSeconds.Value);
        if (hb.ScreenshotJpegQuality is >= 10)
            _settings.ScreenshotJpegQuality =
                ScreenCaptureService.ClampJpegQuality(hb.ScreenshotJpegQuality.Value);
        if (hb.ScreenshotScalePercent is >= 25)
            _settings.ScreenshotScalePercent =
                ScreenCaptureService.ClampScalePercent(hb.ScreenshotScalePercent.Value);
        if (hb.LivePreviewActive.HasValue)
            _settings.LivePreviewActive = hb.LivePreviewActive.Value;
        if (hb.LiveIntervalMs is >= 300)
            _settings.LiveIntervalMs = Math.Clamp(hb.LiveIntervalMs.Value, 300, 5000);
        if (hb.LiveJpegQuality is >= 10)
            _settings.LiveJpegQuality =
                ScreenCaptureService.ClampJpegQuality(hb.LiveJpegQuality.Value);
        if (hb.LiveScalePercent is >= 25)
            _settings.LiveScalePercent =
                ScreenCaptureService.ClampScalePercent(hb.LiveScalePercent.Value);
        if (!string.IsNullOrWhiteSpace(hb.ExitPassword))
            _settings.AdminExitPassword = hb.ExitPassword!;
        if (!string.IsNullOrWhiteSpace(hb.AgentHrmBaseUrl))
        {
            var url = hb.AgentHrmBaseUrl.Trim().TrimEnd('/');
            if (!string.Equals(_settings.HrmBaseUrl?.TrimEnd('/'), url, StringComparison.OrdinalIgnoreCase))
            {
                _settings.HrmBaseUrl = url;
                SetStatus($"HRM URL updated from admin: {url}");
            }
        }

        _settings.Save();
        // Screenshots ignore clock-in / face arming — sync whenever admin flag changes
        _screenshots.SyncFromSettings();

        var cmd = (hb.Command ?? "").Trim().ToLowerInvariant();
        if (cmd == "pause")
        {
            _settings.AdminEnabled = false;
            _settings.Save();
            SetStatus("Paused by Admin (Stop)");
        }
        else if (cmd is "resume" or "on" or "start")
        {
            _settings.AdminEnabled = true;
            _settings.Save();
            SetStatus($"Armed — face scan every {_settings.FaceScanIntervalSeconds}s");
        }
        else if (cmd == "restart")
        {
            RestartSelf();
        }
        // "exit" ignored for Guard — watchdog would restart; use Stop (pause) instead

        // Screenshots / live / keyboard metrics sync after AdminEnabled may have changed
        _screenshots.SyncFromSettings();
        _livePreview.SyncFromSettings();
        _keyboardActivity.SyncFromSettings();
        // Keep WebView2 + camera permission warm so timed face UI opens fast
        if (!string.IsNullOrWhiteSpace(_settings.HrmBaseUrl))
            FaceVerifyHostWindow.Prewarm(_settings.HrmBaseUrl);

        // Prefer screenshot status when capture is on (clock-in not required)
        if (_settings.ScreenshotCaptureEnabled)
        {
            var emp = (_settings.EmployeeId ?? "").Trim();
            SetStatus(
                string.IsNullOrEmpty(emp)
                    ? "Screenshots ON — waiting for employee assign"
                    : $"Screenshots ON — local+HRM · keep {ScreenCaptureService.LocalRetainDays}d · every {ScreenCaptureService.ClampInterval(_settings.ScreenshotIntervalSeconds)}s");
        }
        else if (!_settings.PresenceMonitoringEnabled)
        {
            SetStatus(_settings.ClockedIn
                ? "Presence monitoring OFF (admin settings)"
                : "Not clocked in — face scan paused");
        }
        else if (!_settings.CameraVerificationEnabled)
            SetStatus("Camera verification OFF — no face checks");
        else if (!_settings.AdminEnabled)
            SetStatus("Installed — waiting for Admin Start");
        else if (_settings.ClockedIn)
            SetStatus($"Armed — face scan every {EffectiveScanIntervalSeconds}s");
    }

    private bool MonitoringArmed =>
        _settings.AdminEnabled &&
        _settings.PresenceMonitoringEnabled &&
        _settings.CameraVerificationEnabled;

    private int EffectiveScanIntervalSeconds =>
        _settings.FaceScanIntervalSeconds > 0
            ? _settings.FaceScanIntervalSeconds
            : (_settings.RecheckWhileIdleSeconds > 0
                ? _settings.RecheckWhileIdleSeconds
                : 600);

    private int EffectiveMaxAttempts =>
        Math.Clamp(_settings.FaceVerifyMaxAttempts > 0 ? _settings.FaceVerifyMaxAttempts : 3, 1, 10);

    private int EffectiveRetryGapSeconds =>
        Math.Clamp(
            _settings.FaceVerifyRetryGapSeconds > 0 ? _settings.FaceVerifyRetryGapSeconds : 10,
            5,
            120);

    private async Task OnPollAsync()
    {
        if (!MonitoringArmed || _faceInProgress) return;
        if (string.IsNullOrWhiteSpace(_settings.EmployeeId))
        {
            SetStatus("Waiting for HRM employee assignment");
            return;
        }

        var clockedIn = await _hrm.CheckClockedInAsync().ConfigureAwait(true);
        if (clockedIn == false)
        {
            _settings.ClockedIn = false;
            SetStatus("Not clocked in — face scan skipped");
            return;
        }
        if (clockedIn == true)
            _settings.ClockedIn = true;

        var interval = EffectiveScanIntervalSeconds;
        var sinceCheck = (DateTime.UtcNow - _lastFaceCheckUtc).TotalSeconds;
        if (sinceCheck < interval)
        {
            var left = Math.Max(0, interval - sinceCheck);
            SetStatus($"Next face scan in {left:0}s");
            return;
        }

        // Break marked → skip verify (do not advance timer so scan resumes after break)
        var onBreak = await _hrm.CheckActiveBreakAsync().ConfigureAwait(true);
        if (onBreak == true)
        {
            SetStatus("On break — face scan skipped");
            return;
        }

        _faceInProgress = true;
        try
        {
            var maxAttempts = EffectiveMaxAttempts;
            var retryGap = EffectiveRetryGapSeconds;
            FacePresenceChecker.FaceCheckResult? lastFail = null;

            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                onBreak = await _hrm.CheckActiveBreakAsync().ConfigureAwait(true);
                if (onBreak == true)
                {
                    SetStatus("On break — face scan skipped");
                    return;
                }

                clockedIn = await _hrm.CheckClockedInAsync().ConfigureAwait(true);
                if (clockedIn == false)
                {
                    _settings.ClockedIn = false;
                    SetStatus("Not clocked in — face scan skipped");
                    return;
                }

                SetStatus($"Face verification {attempt}/{maxAttempts}…");
                var check = await FacePresenceChecker.VerifyAsync(
                        _settings.HrmBaseUrl,
                        _settings.EmployeeId,
                        _settings.EmployeeName)
                    .ConfigureAwait(true);

                if (check.AtSeat)
                {
                    _lastFaceCheckUtc = DateTime.UtcNow;
                    SetStatus("Seated verified");
                    Notify("Present", "You are at your seat.", success: true);
                    return;
                }

                var code = (check.Code ?? "").Trim().ToLowerInvariant();
                var hardInfraFail = code is "error" or "bad_frame";
                if (hardInfraFail)
                {
                    _lastFaceCheckUtc = DateTime.UtcNow;
                    SetStatus($"Face check issue: {check.Code ?? "error"}");
                    Notify(
                        "Face check could not complete",
                        check.Error ?? "Camera/model issue — will retry. No ticket sent.",
                        success: false);
                    return;
                }

                lastFail = check;

                if (attempt < maxAttempts)
                {
                    SetStatus($"Face verify failed — retry in {retryGap}s ({attempt}/{maxAttempts})");
                    Notify(
                        $"Face verify failed ({attempt}/{maxAttempts})",
                        $"Retrying in {retryGap} seconds…",
                        success: false);
                    await Task.Delay(TimeSpan.FromSeconds(retryGap)).ConfigureAwait(true);
                }
            }

            onBreak = await _hrm.CheckActiveBreakAsync().ConfigureAwait(true);
            if (onBreak == true)
            {
                SetStatus("Away — break/meeting active");
                Notify(
                    "Not at seat — on break",
                    "Verification failed, but an active break/meeting was found — no ticket sent.",
                    success: false);
                return;
            }

            var clockedAfterFail = await _hrm.CheckClockedInAsync().ConfigureAwait(true);
            if (clockedAfterFail == false)
            {
                _settings.ClockedIn = false;
                SetStatus("Not clocked in — ticket skipped");
                return;
            }

            _lastFaceCheckUtc = DateTime.UtcNow;
            var failCode = (lastFail?.Code ?? "").Trim().ToLowerInvariant();
            var failReason = string.IsNullOrWhiteSpace(lastFail?.Error)
                ? failCode switch
                {
                    "wrong_person" =>
                        $"Wrong person in front of camera after {maxAttempts} timed face scans.",
                    "low_similarity" or "mismatch" =>
                        $"Face did not match enrolled employee after {maxAttempts} timed face scans.",
                    "no_face" =>
                        $"No face in camera after {maxAttempts} timed face scans.",
                    "timeout" =>
                        $"Face check timed out on all {maxAttempts} timed face scans.",
                    _ =>
                        $"Face verification failed after {maxAttempts} attempts (code: {lastFail?.Code ?? "mismatch"}).",
                }
                : $"Face verification failed after {maxAttempts} attempts: {lastFail!.Error}";
            await HandleAbsenceTicketAsync(failReason).ConfigureAwait(true);
        }
        finally
        {
            _faceInProgress = false;
        }
    }

    private async Task HandleAbsenceTicketAsync(string reason)
    {
        // Short local throttle only (spam from double-fire); server also dedupes briefly
        if ((DateTime.UtcNow - _lastTicketUtc).TotalMinutes < 2)
        {
            SetStatus("Ticket recently sent — waiting");
            Notify(
                "Ticket already sent recently",
                "HR already received a seat-absent ticket in the last 2 minutes.",
                success: false);
            return;
        }

        var (ok, deduped, ticketNumber, err) =
            await _hrm.PostSeatAbsentTicketAsync(reason).ConfigureAwait(true);
        _lastTicketUtc = DateTime.UtcNow;

        if (ok && err == "skipped_active_break")
        {
            SetStatus("On break — ticket skipped");
            return;
        }

        if (ok && deduped)
        {
            SetStatus(ticketNumber != null
                ? $"Already in HR inbox ({ticketNumber})"
                : "Already in HR inbox (recent ticket)");
            Notify(
                "Ticket already in HR inbox",
                ticketNumber != null
                    ? $"Seat-absent ticket {ticketNumber} is already open — check Ticket Inbox."
                    : "A seat-absent ticket is already open in HR inbox from the last few minutes.",
                success: false);
        }
        else if (ok)
        {
            SetStatus(ticketNumber != null
                ? $"Ticket sent: {ticketNumber}"
                : "Ticket sent: not at seat");
            Notify(
                "Ticket sent to HR",
                ticketNumber != null
                    ? $"Seat-absent ticket {ticketNumber} was sent to HR."
                    : "A seat-absent ticket has been sent to HR.",
                success: false);
        }
        else
        {
            SetStatus("Ticket API failed (will retry)");
            Notify(
                "Could not send ticket",
                $"Ticket to HR failed{(err != null ? $": {err}" : "")} — will retry later.",
                success: false);
        }
    }

    private void SetStatus(string s) => StatusChanged?.Invoke(s);

    private void Notify(string title, string body, bool success)
    {
        try { NotifyUser?.Invoke(title, body, success); } catch { /* ignore */ }
        ResultToast.Show(title, body, success);
    }

    private static void RestartSelf()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe))
                Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
            System.Windows.Application.Current?.Shutdown();
        }
        catch { /* ignore */ }
    }

    public void Dispose()
    {
        _pollTimer?.Stop();
        _screenshots.Dispose();
        _livePreview.Dispose();
        _appActivity.Dispose();
        _keyboardActivity.Dispose();
    }
}
