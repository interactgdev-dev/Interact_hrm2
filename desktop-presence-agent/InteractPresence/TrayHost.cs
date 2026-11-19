using System.Windows;
using System.Windows.Forms;
using Application = System.Windows.Application;

namespace InteractPresence;

/// <summary>System-tray host — no permanent main window.</summary>
public sealed class TrayHost : IDisposable
{
    private readonly NotifyIcon _notify;
    private readonly ContextMenuStrip _menu;
    private readonly PresenceController _controller;
    private readonly AppSettings _settings;
    private string? _pendingStatus;

    public TrayHost(PresenceController controller, AppSettings settings)
    {
        _controller = controller;
        _settings = settings;

        _notify = new NotifyIcon
        {
            Visible = true,
            Text = $"Interact Presence {AgentUpdater.CurrentVersion}",
            Icon = System.Drawing.SystemIcons.Application,
        };

        _menu = new ContextMenuStrip
        {
            AutoClose = true,
            ShowImageMargin = false,
            ShowCheckMargin = false,
        };
        _menu.Closed += (_, _) =>
        {
            if (_pendingStatus == null) return;
            var text = _pendingStatus;
            _pendingStatus = null;
            ApplyStatusText(text);
        };

        _menu.Items.Add("Status: starting…", null, null).Name = "status";
        _menu.Items.Add($"Version: {AgentUpdater.CurrentVersion}", null, null);
        _menu.Items.Add(new ToolStripSeparator());
        AddAction("Set Employee ID (admin)…", PromptEmployeeId);
        AddAction("Set HRM URL (admin)…", PromptHrmUrl);
        AddAction("Use Staging HRM (admin)…", () =>
            SetHrmUrlWithPassword("https://192.168.10.6:8443", "staging"));
        AddAction("Use Main HRM (admin)…", () =>
            SetHrmUrlWithPassword("https://192.168.10.40:8443", "main HRM"));
        AddAction("Use Localhost HRM (admin)…", () =>
            SetHrmUrlWithPassword("http://localhost:3000", "localhost"));
        AddAction("Check for updates (admin)…", CheckUpdates);
        AddAction("Sync settings from HRM now…", SyncSettingsNow);
        AddAction("Test success toast (admin)…", () =>
        {
            if (!ConfirmAdminPassword("Enter admin password for test toast:", refreshFromHrm: true))
                return;
            DesktopNotify.Success("Verification successful — you are present.");
        });
        AddAction("Test fail toast (admin)…", () =>
        {
            if (!ConfirmAdminPassword("Enter admin password for test toast:", refreshFromHrm: true))
                return;
            DesktopNotify.Failed("Verification failed — face did not match.");
        });
        AddAction("Open HRM in browser (admin)…", OpenHrm);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(
            AutoStartHelper.IsEnabled() ? "Auto-start: ON (login)" : "Auto-start: OFF",
            null,
            null).Name = "autostart";
        AddAction("Disable auto-start (admin)…", DisableAutoStartWithPassword);
        _menu.Items.Add(new ToolStripSeparator());
        AddAction("Exit (admin password)…", TryExitWithPassword);

        // Assign after items built so WinForms owns the handle; close before modals (see AddAction).
        _notify.ContextMenuStrip = _menu;

        DesktopNotify.AttachTrayIcon(_notify);

        _controller.StatusChanged += text =>
        {
            void apply()
            {
                if (_menu.Visible)
                {
                    // Updating items while open can freeze the strip over other windows.
                    _pendingStatus = text;
                    return;
                }
                ApplyStatusText(text);
            }

            if (_menu.IsHandleCreated && _menu.InvokeRequired)
                _menu.BeginInvoke(apply);
            else
                apply();
        };
    }

    private void AddAction(string text, Action action)
    {
        _menu.Items.Add(text, null, (_, _) => RunAfterMenuCloses(action));
    }

    /// <summary>
    /// Close tray menu first, then run work on next message tick.
    /// Prevents ContextMenuStrip from staying stuck when WPF ShowDialog / sync runs.
    /// </summary>
    private void RunAfterMenuCloses(Action action)
    {
        try { _menu.Close(ToolStripDropDownCloseReason.ItemClicked); } catch { /* ignore */ }
        try { _menu.Hide(); } catch { /* ignore */ }

        void run()
        {
            try { action(); }
            catch { /* keep tray alive */ }
        }

        // Prefer WinForms pump (menu handle), else WPF dispatcher.
        if (_menu.IsHandleCreated)
            _menu.BeginInvoke(run);
        else
            Application.Current?.Dispatcher.BeginInvoke(run);
    }

    private void ApplyStatusText(string text)
    {
        if (_menu.Items["status"] is ToolStripMenuItem item)
            item.Text = $"Status: {text}";
        _notify.Text = text.Length > 60 ? text[..60] : text;
    }

    public void Show()
    {
        AutoStartHelper.EnsureEnabled();
        RefreshAutoStartLabel();
        // No startup toast — avoids spam during any unexpected restarts.
    }

    private void RefreshAutoStartLabel()
    {
        if (_menu.Items["autostart"] is ToolStripMenuItem item)
            item.Text = AutoStartHelper.IsEnabled() ? "Auto-start: ON (login)" : "Auto-start: OFF";
    }

    /// <summary>
    /// Soft pull — max ~2.5s. Never block tray actions for a full HttpClient timeout
    /// (that made "Use Staging" look stuck when localhost was down).
    /// </summary>
    private void TryPullLatestPasswordFromHrmQuick()
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(2500));
            var ok = Task.Run(() => _controller.ForceSyncSettingsAsync(cts.Token))
                .Wait(TimeSpan.FromSeconds(3));
            if (!ok)
            {
                // timed out or still running — leave local password as-is
            }
        }
        catch
        {
            /* keep local password */
        }
    }

    private void SyncSettingsNow()
    {
        DesktopNotify.Success($"Syncing from {_settings.HrmBaseUrl}…");
        _ = Task.Run(async () =>
        {
            var ok = await _controller.ForceSyncSettingsAsync().ConfigureAwait(false);
            await Application.Current.Dispatcher.InvokeAsync(() =>
            {
                if (ok) DesktopNotify.Success("Settings + exit password synced.");
                else
                    DesktopNotify.Failed(
                        $"Sync failed. Is HRM running at {_settings.HrmBaseUrl}? " +
                        "Staging and localhost have separate passwords — point the agent at the same host you edited.");
            });
        });
    }

    /// <param name="refreshFromHrm">
    /// When false (URL switch), use last local password only — current host may be offline.
    /// </param>
    private bool ConfirmAdminPassword(string purpose, bool refreshFromHrm = true)
    {
        if (refreshFromHrm)
            TryPullLatestPasswordFromHrmQuick();

        var expected = string.IsNullOrWhiteSpace(_settings.AgentExitPassword)
            ? "InteractAdmin"
            : _settings.AgentExitPassword.Trim();

        // Password dialog must run on WPF dispatcher (tray callback is WinForms).
        string? input = null;
        Application.Current.Dispatcher.Invoke(() =>
        {
            input = SimplePrompt.AskPassword("Admin password required", purpose.Trim());
        });

        if (input == null) return false;
        if (string.Equals(input.Trim(), expected, StringComparison.Ordinal))
            return true;
        DesktopNotify.Failed(
            $"Wrong password (agent @ {_settings.HrmBaseUrl}). " +
            "Try last password you set on this PC, or Sync settings after HRM is reachable.");
        return false;
    }

    private string? AskOnUi(string title, string message, string defaultValue)
    {
        string? input = null;
        Application.Current.Dispatcher.Invoke(() =>
        {
            input = SimplePrompt.Ask(title, message, defaultValue);
        });
        return input;
    }

    private void TryExitWithPassword()
    {
        if (!ConfirmAdminPassword("Enter admin password to EXIT Interact Presence:"))
            return;
        _controller.Stop();
        Application.Current.Shutdown();
    }

    private void DisableAutoStartWithPassword()
    {
        if (!ConfirmAdminPassword("Enter admin password to disable login auto-start:"))
            return;
        if (AutoStartHelper.TryDisable())
            DesktopNotify.Success("Auto-start disabled.");
        else
            DesktopNotify.Failed("Could not remove startup shortcut.");
        RefreshAutoStartLabel();
    }

    private void PromptEmployeeId()
    {
        if (!ConfirmAdminPassword("Enter admin password to set Employee ID:"))
            return;
        var input = AskOnUi(
            "Interact Presence",
            "Employee ID:",
            _settings.EmployeeId ?? "");
        if (string.IsNullOrWhiteSpace(input)) return;
        _settings.EmployeeId = input.Trim();
        _settings.Save();
        DesktopNotify.Success($"Employee ID set to {_settings.EmployeeId}");
    }

    private void PromptHrmUrl()
    {
        // Local password only — current HRM may be unreachable.
        if (!ConfirmAdminPassword("Enter admin password to change HRM URL:", refreshFromHrm: false))
            return;
        var input = AskOnUi(
            "Interact Presence",
            "HRM base URL:\n• Staging: https://192.168.10.6:8443\n• Local: http://localhost:3000",
            _settings.HrmBaseUrl ?? "");
        if (string.IsNullOrWhiteSpace(input)) return;
        ApplyHrmUrl(input.Trim());
    }

    private void SetHrmUrlWithPassword(string url, string label)
    {
        // Do NOT sync from current URL first — that froze the tray when localhost was down.
        if (!ConfirmAdminPassword(
                $"Enter admin password to switch HRM to {label}:",
                refreshFromHrm: false))
            return;
        ApplyHrmUrl(url);
    }

    private void ApplyHrmUrl(string url)
    {
        var cleaned = url.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(cleaned)) return;
        _settings.HrmBaseUrl = cleaned;
        _settings.Save();
        DesktopNotify.Success($"HRM pointed at: {cleaned} — syncing password…");
        _ = Task.Run(async () =>
        {
            var ok = await _controller.ForceSyncSettingsAsync().ConfigureAwait(false);
            await Application.Current.Dispatcher.InvokeAsync(() =>
            {
                if (ok) DesktopNotify.Success($"Password/settings loaded from {cleaned}");
                else DesktopNotify.Failed($"Could not load settings from {cleaned}");
            });
        });
    }

    private void CheckUpdates()
    {
        if (!ConfirmAdminPassword("Enter admin password to check for updates:"))
            return;
        _ = Task.Run(async () =>
        {
            await AgentUpdater.CheckAndUpdateAsync(_settings, force: true).ConfigureAwait(false);
        });
        DesktopNotify.Success("Checking for agent updates…");
    }

    private void OpenHrm()
    {
        if (!ConfirmAdminPassword("Enter admin password to open HRM:"))
            return;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = _settings.HrmBaseUrl,
                UseShellExecute = true,
            });
        }
        catch { /* ignore */ }
    }

    public void Dispose()
    {
        try { _menu.Close(); } catch { /* ignore */ }
        _notify.Visible = false;
        _notify.ContextMenuStrip = null;
        _menu.Dispose();
        _notify.Dispose();
    }
}
