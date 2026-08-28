using System.Windows.Threading;
using WpfApp = System.Windows.Application;

namespace InteractPresence;

/// <summary>
/// Logic:
///   1) Mouse/keyboard idle → once (after threshold) silently check camera.
///   2) Enrolled face match → OK, no popup; do NOT re-check every few seconds.
///   3) No match (streak) → "Are you there?" popup.
///   4) Mouse/keyboard activity → back to Active (cooldown cleared).
/// </summary>
public sealed class PresenceController : IDisposable
{
    public enum State
    {
        Active,
        IdlePresent,   // idle input, enrolled face matched — quiet until recheck due
        IdleWarning,   // idle input + no match → popup
    }

    private readonly AppSettings _settings;
    private readonly IdleDetector _idle;
    private readonly HrmApiClient _api;
    private readonly HrmFacePresenceChecker _camera;
    private readonly DispatcherTimer _pollTimer;
    private readonly DispatcherTimer _countdownTimer;

    private State _state = State.Active;
    private DateTime? _idleStartedAt;
    private DateTime? _popupShownAt;
    private DateTime? _nextAllowedCheckAt;
    private int _secondsLeft;
    private AreYouThereWindow? _popup;
    private bool _cameraCheckInFlight;
    private int _noFaceStreak;

    public State CurrentState => _state;
    public event Action<string>? StatusChanged;

    public PresenceController(AppSettings settings, IdleDetector idle, HrmApiClient api, HrmFacePresenceChecker camera)
    {
        _settings = settings;
        _idle = idle;
        _api = api;
        _camera = camera;

        _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(Math.Max(1, settings.PollIntervalSeconds)) };
        _pollTimer.Tick += (_, _) => OnPoll();

        _countdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _countdownTimer.Tick += (_, _) => OnCountdownTick();
    }

    public void Start()
    {
        _state = State.Active;
        _pollTimer.Start();
        StatusChanged?.Invoke(
            _settings.PresenceEnabled
                ? $"Active — idle {_settings.IdleWarningSeconds}s; camera={(_settings.CameraVerificationEnabled ? "on" : "off")}"
                : "Presence disabled by admin (waiting for settings)");
        _ = _api.FlushQueueAsync();
        // Immediate settings pull + update check
        _ = Task.Run(async () =>
        {
            await ForceSyncSettingsAsync().ConfigureAwait(false);
            // Do not force-update on every start — that caused restart loops after a bad publish.
            await AgentUpdater.CheckAndUpdateAsync(_settings).ConfigureAwait(false);
        });
    }

    public void Stop()
    {
        _pollTimer.Stop();
        _countdownTimer.Stop();
        ClosePopup();
    }

    public void Dispose()
    {
        Stop();
    }

    private void OnPoll()
    {
        // Pull admin settings from HRM periodically (~every 30s)
        MaybeRefreshRemoteSettings();

        if (!_settings.PresenceEnabled)
        {
            if (_state == State.IdleWarning) return;
            StatusChanged?.Invoke("Presence disabled by admin");
            return;
        }

        if (!IsEmployeeAllowed())
        {
            if (_state == State.IdleWarning) return;
            StatusChanged?.Invoke("Presence not enabled for this employee (admin list)");
            return;
        }

        var threshold = TimeSpan.FromSeconds(Math.Max(5, _settings.IdleWarningSeconds));
        var idle = _idle.IsIdleBeyond(threshold);

        // Any real input → cancel present-idle; popup still needs I'm Here
        if (!idle)
        {
            _idleStartedAt = null;
            _noFaceStreak = 0;
            _nextAllowedCheckAt = null;
            if (_state == State.IdleWarning)
                return;
            if (_state != State.Active)
            {
                _state = State.Active;
                StatusChanged?.Invoke("Active — input detected");
            }
            return;
        }

        _idleStartedAt ??= DateTime.UtcNow - threshold;

        if (_state == State.IdleWarning)
            return;

        // Cooldown after success / after popup — do NOT hammer camera every poll
        if (_nextAllowedCheckAt.HasValue && DateTime.UtcNow < _nextAllowedCheckAt.Value)
        {
            if (_state == State.IdlePresent)
            {
                var left = (int)(_nextAllowedCheckAt.Value - DateTime.UtcNow).TotalSeconds;
                StatusChanged?.Invoke($"At seat — next check in {Math.Max(0, left)}s");
            }
            return;
        }

        // Idle only (no camera) → popup directly
        if (!_settings.CameraVerificationEnabled)
        {
            StatusChanged?.Invoke("Idle — mouse/keyboard only (camera off by admin)");
            EnterIdleWarning("Idle timeout — camera verification disabled by admin");
            return;
        }

        if (_cameraCheckInFlight) return;
        _cameraCheckInFlight = true;
        StatusChanged?.Invoke("Idle — HRM face enrollment check…");

        _ = Task.Run(async () =>
        {
            var result = await _camera.CheckFacePresentAsync().ConfigureAwait(false);
            await WpfApp.Current.Dispatcher.InvokeAsync(() =>
            {
                _cameraCheckInFlight = false;
                HandleCameraResult(result, threshold);
            });
        });
    }

    private DateTime _lastSettingsFetch = DateTime.MinValue;
    private DateTime _lastSyncFailNotify = DateTime.MinValue;

    /// <summary>Pull admin settings (incl. exit password) from HRM now. Returns false if HRM unreachable.</summary>
    public async Task<bool> ForceSyncSettingsAsync(CancellationToken ct = default)
    {
        try
        {
            _lastSettingsFetch = DateTime.UtcNow;
            var applied = await _api.TryApplyPresenceSettingsAsync(_settings, ct).ConfigureAwait(false);
            var hb = await _api.TrySendHeartbeatAsync(_settings, ct).ConfigureAwait(false);
            await HandleRemoteCommandAsync(hb?.Command).ConfigureAwait(false);
            if (ct.IsCancellationRequested) return false;
            await WpfApp.Current.Dispatcher.InvokeAsync(() =>
            {
                if (applied)
                {
                    StatusChanged?.Invoke(
                        $"Settings synced — idle {_settings.IdleWarningSeconds}s, " +
                        $"camera={(_settings.CameraVerificationEnabled ? "on" : "off")}, " +
                        $"enabled={_settings.PresenceEnabled} @ {_settings.HrmBaseUrl}");
                }
                else
                {
                    StatusChanged?.Invoke($"Settings sync FAILED @ {_settings.HrmBaseUrl}");
                }
            });
            return applied;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch
        {
            return false;
        }
    }

    private async Task HandleRemoteCommandAsync(string? command)
    {
        if (string.IsNullOrWhiteSpace(command)) return;
        var c = command.Trim().ToLowerInvariant();
        await WpfApp.Current.Dispatcher.InvokeAsync(() =>
        {
            if (c == "restart")
            {
                StatusChanged?.Invoke("Admin requested restart…");
                AgentCommands.Restart();
            }
            else if (c == "exit")
            {
                StatusChanged?.Invoke("Admin requested exit…");
                Stop();
                AgentCommands.Exit();
            }
        });
    }

    private bool IsEmployeeAllowed()
    {
        var list = _settings.EnabledEmployeeIds;
        if (list == null || list.Count == 0) return true; // empty = all
        var id = (_settings.EmployeeId ?? "").Trim();
        if (string.IsNullOrEmpty(id)) return false;
        return list.Any(x => string.Equals(x?.Trim(), id, StringComparison.OrdinalIgnoreCase));
    }

    private void MaybeRefreshRemoteSettings()
    {
        if ((DateTime.UtcNow - _lastSettingsFetch).TotalSeconds < 15) return;
        _lastSettingsFetch = DateTime.UtcNow;
        _ = Task.Run(async () =>
        {
            try
            {
                var applied = await _api.TryApplyPresenceSettingsAsync(_settings).ConfigureAwait(false);
                var hb = await _api.TrySendHeartbeatAsync(_settings).ConfigureAwait(false);
                await HandleRemoteCommandAsync(hb?.Command).ConfigureAwait(false);
                if (applied)
                {
                    await WpfApp.Current.Dispatcher.InvokeAsync(() =>
                    {
                        StatusChanged?.Invoke(
                            $"Settings synced — idle {_settings.IdleWarningSeconds}s, " +
                            $"camera={(_settings.CameraVerificationEnabled ? "on" : "off")}, " +
                            $"enabled={_settings.PresenceEnabled}");
                    });
                }
                else if ((DateTime.UtcNow - _lastSyncFailNotify).TotalSeconds > 60)
                {
                    _lastSyncFailNotify = DateTime.UtcNow;
                    await WpfApp.Current.Dispatcher.InvokeAsync(() =>
                    {
                        StatusChanged?.Invoke($"Settings sync FAILED @ {_settings.HrmBaseUrl}");
                        DesktopNotify.Failed(
                            $"Cannot reach HRM settings at {_settings.HrmBaseUrl}. Password/settings will not update.");
                    });
                }
                await AgentUpdater.CheckAndUpdateAsync(_settings).ConfigureAwait(false);
            }
            catch
            {
                /* keep local */
            }
        });
    }

    private void HandleCameraResult(HrmFacePresenceChecker.FaceCheckResult result, TimeSpan threshold)
    {
        var stillIdle = _idle.IsIdleBeyond(threshold);

        if (!stillIdle)
        {
            _idleStartedAt = null;
            // Don't wipe a successful match toast — still notify below
            if (!(result.CameraOk && result.FacePresent))
            {
                _noFaceStreak = 0;
                _nextAllowedCheckAt = null;
                _state = State.Active;
                StatusChanged?.Invoke("Active — input during camera check");
            }
        }

        // Soft camera/bridge errors — one toast, then quiet (not spam every poll)
        if (!result.CameraOk)
        {
            _nextAllowedCheckAt = DateTime.UtcNow.AddSeconds(45);
            StatusChanged?.Invoke($"Camera: {result.Error ?? result.Code ?? "unavailable"}");
            NotifyVerification(
                success: false,
                detail: result.Error ?? "Camera/verification could not complete.");
            if (!stillIdle) _state = State.Active;
            return;
        }

        if (result.FacePresent)
        {
            _noFaceStreak = 0;
            _state = stillIdle ? State.IdlePresent : State.Active;
            var quiet = Math.Max(60, _settings.RecheckWhileIdleSeconds);
            _nextAllowedCheckAt = DateTime.UtcNow.AddSeconds(quiet);
            StatusChanged?.Invoke($"At seat (match) — quiet {quiet}s (no repeat toast)");
            NotifyVerification(success: true, detail: "You are present.");
            return;
        }

        _noFaceStreak++;
        var detail = string.IsNullOrWhiteSpace(result.Error)
            ? (result.Code ?? "fail")
            : $"{result.Code}: {result.Error}";

        if (!stillIdle)
        {
            _state = State.Active;
            _noFaceStreak = 0;
            // One fail toast if check finished while user moved
            NotifyVerification(success: false, detail: "Face did not match your enrollment.");
            StatusChanged?.Invoke($"Mismatch (not idle) [{detail}]");
            return;
        }

        if (_noFaceStreak < 2)
        {
            // Silent recheck — toast only once when confirmed (streak 2)
            _nextAllowedCheckAt = DateTime.UtcNow.AddSeconds(8);
            StatusChanged?.Invoke($"No enrollment match ({_noFaceStreak}/2) [{detail}] — recheck…");
            return;
        }

        // Once: red toast + Are you there
        NotifyVerification(success: false, detail: "Face did not match your enrollment.");
        EnterIdleWarning(detail);
    }

    private void NotifyVerification(bool success, string? detail)
    {
        var msg = string.IsNullOrWhiteSpace(detail)
            ? (success
                ? "Verification successful — you are present."
                : "Verification failed — face did not match.")
            : detail!;

        // WinForms STA toast + tray balloon (WPF toast was not appearing)
        if (success)
            DesktopNotify.Success(msg);
        else
            DesktopNotify.Failed(msg);

        StatusChanged?.Invoke(success ? "Notify: SUCCESS" : "Notify: ERROR");
    }

    private void EnterIdleWarning(string? failDetail = null)
    {
        if (_state == State.IdleWarning) return;
        _state = State.IdleWarning;
        _popupShownAt = DateTime.UtcNow;
        _secondsLeft = Math.Max(5, _settings.PopupCountdownSeconds);

        WpfApp.Current.Dispatcher.Invoke(() =>
        {
            _popup = new AreYouThereWindow(_secondsLeft, failDetail);
            _popup.ImHereClicked += OnImHere;
            _popup.Show();
            TopmostHelper.ForceToFront(_popup);
        });

        _countdownTimer.Start();
        StatusChanged?.Invoke($"Away — [{failDetail ?? "no match"}] — {_secondsLeft}s");
    }

    private void OnCountdownTick()
    {
        if (_state != State.IdleWarning) return;

        _secondsLeft--;
        _popup?.UpdateCountdown(_secondsLeft);
        StatusChanged?.Invoke($"Away — {_secondsLeft}s left");

        if (_secondsLeft > 0) return;

        _countdownTimer.Stop();
        var end = DateTime.UtcNow;
        var start = _idleStartedAt ?? (_popupShownAt ?? end) - TimeSpan.FromSeconds(_settings.IdleWarningSeconds);
        var duration = DurationSeconds(start, end);

        ClosePopup();
        _ = LogAndResetAsync(start, end, duration, confirmedByUser: false);
        OptionalScreenLock.TryLockIfEnabled(_settings.LockScreenOnTimeout);
    }

    private void OnImHere()
    {
        if (_state != State.IdleWarning) return;

        _countdownTimer.Stop();
        var end = DateTime.UtcNow;
        var start = _idleStartedAt ?? (_popupShownAt ?? end) - TimeSpan.FromSeconds(_settings.IdleWarningSeconds);
        var duration = DurationSeconds(start, end);

        ClosePopup();
        _ = LogAndResetAsync(start, end, duration, confirmedByUser: true);
    }

    private static int DurationSeconds(DateTime startUtc, DateTime endUtc) =>
        Math.Max(0, (int)(endUtc - startUtc).TotalSeconds);

    private async Task LogAndResetAsync(DateTime start, DateTime end, int durationSeconds, bool confirmedByUser)
    {
        var evt = new UnavailableEvent
        {
            EmployeeId = _settings.EmployeeId ?? "unknown",
            EmployeeName = _settings.EmployeeName,
            Status = "Unavailable on Seat",
            StartTime = start,
            EndTime = end,
            DurationSeconds = durationSeconds,
            ConfirmedByUser = confirmedByUser,
        };

        await _api.PostUnavailableOnSeatAsync(evt).ConfigureAwait(true);

        _idleStartedAt = null;
        _popupShownAt = null;
        _noFaceStreak = 0;
        _state = State.Active;
        // After popup, do not immediately re-verify while still sitting idle
        var cooldown = Math.Max(45, _settings.IdleWarningSeconds * 3);
        _nextAllowedCheckAt = DateTime.UtcNow.AddSeconds(cooldown);
        StatusChanged?.Invoke(confirmedByUser
            ? $"Logged (I'm Here) — next check in {cooldown}s"
            : $"Logged (timeout) — next check in {cooldown}s");
    }

    private void ClosePopup()
    {
        WpfApp.Current.Dispatcher.Invoke(() =>
        {
            if (_popup == null) return;
            _popup.ImHereClicked -= OnImHere;
            _popup.Close();
            _popup = null;
        });
    }
}
