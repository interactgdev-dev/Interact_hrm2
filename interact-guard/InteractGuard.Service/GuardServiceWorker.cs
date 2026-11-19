using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace InteractGuard.Service;

/// <summary>
/// Always-on listener (SYSTEM). Heartbeats to HRM so Admin Start can relaunch the
/// tray agent into the interactive user session when the process is dead.
/// Does not host UI/WebView2 in Session 0.
/// </summary>
public sealed class GuardServiceWorker : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(12);

    private readonly ILogger<GuardServiceWorker> _log;
    private readonly ServiceHrmClient _hrm = new();
    private string? _pendingAck;

    public GuardServiceWorker(ILogger<GuardServiceWorker> log) => _log = log;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation(
            "Interact Guard service {Version} — remote start + auto-relaunch enabled.",
            ServiceSettings.Version);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Service tick failed");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var settings = ServiceSettings.Load();
        var machineId = ServiceMachineId.GetOrCreate();
        var installDir = ServiceSettings.InstallDir;
        var agentRunning = SessionProcessLauncher.IsAgentRunning();

        var ack = _pendingAck;
        _pendingAck = null;

        var hb = await _hrm
            .HeartbeatAsync(settings.HrmBaseUrl, machineId, ack, agentRunning, ct)
            .ConfigureAwait(false);

        var cmd = (hb?.Command ?? "").Trim().ToLowerInvariant();

        if (cmd == "restart" && agentRunning)
        {
            TrySoftRestartAgent();
            // Relaunch below
        }

        // Keep tray agent alive whenever a user is logged on (backup for killed watchdog).
        // Admin Start/on also lands here via pending command + ack after success.
        if (!SessionProcessLauncher.IsAgentRunning())
        {
            var launched = SessionProcessLauncher.EnsureAgentInUserSession(installDir, _log);
            if (launched && cmd is "start" or "on" or "resume" or "restart")
                _pendingAck = cmd;
        }
        else if (cmd is "start" or "on" or "resume" or "restart")
        {
            _pendingAck = cmd;
        }

        // pause / exit: monitoring flags only — do not kill the process
    }

    private void TrySoftRestartAgent()
    {
        try
        {
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("InteractGuard"))
            {
                try { p.Kill(entireProcessTree: true); } catch { /* ignore */ }
                try { p.Dispose(); } catch { /* ignore */ }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Soft restart kill failed");
        }
    }
}
