using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Application = System.Windows.Application;

namespace InteractGuard;

public sealed class TrayHost : IDisposable
{
    private readonly AppSettings _settings;
    private readonly GuardController _controller;
    private readonly NotifyIcon _icon;
    private string _status = "Starting…";

    public TrayHost(AppSettings settings, GuardController controller)
    {
        _settings = settings;
        _controller = controller;
        _controller.StatusChanged += s =>
        {
            _status = s;
            try { _icon.Text = Truncate($"Interact Guard — {s}"); } catch { /* ignore */ }
        };

        _icon = new NotifyIcon
        {
            Text = "Interact Guard",
            Visible = true,
            Icon = LoadAppIcon(),
            ContextMenuStrip = BuildMenu(),
        };

        _controller.NotifyUser += (title, body, success) =>
        {
            try
            {
                // Screenshot soft notices use white ResultToast only — skip dark Win balloon.
                var t = (title ?? "").Trim();
                if (t.StartsWith("Screenshot", StringComparison.OrdinalIgnoreCase))
                    return;

                _icon.BalloonTipTitle = title;
                _icon.BalloonTipText = body;
                _icon.BalloonTipIcon = success ? ToolTipIcon.Info : ToolTipIcon.Warning;
                _icon.ShowBalloonTip(6000);
            }
            catch
            {
                /* ignore */
            }
        };
    }

    private static Icon LoadAppIcon()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe) && File.Exists(exe))
                return Icon.ExtractAssociatedIcon(exe) ?? SystemIcons.Application;

            var beside = Path.Combine(AppContext.BaseDirectory, "InteractGuard.ico");
            if (File.Exists(beside))
                return new Icon(beside);
        }
        catch
        {
            /* fallback */
        }
        return SystemIcons.Application;
    }

    public void Show() { /* tray only */ }

    public void ShowBalloon(string title, string body, bool success)
    {
        try
        {
            _icon.BalloonTipTitle = title;
            _icon.BalloonTipText = body;
            _icon.BalloonTipIcon = success ? ToolTipIcon.Info : ToolTipIcon.Warning;
            _icon.ShowBalloonTip(8000);
        }
        catch
        {
            /* ignore */
        }
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Status (Admin password)…", null, (_, _) => TryShowStatus());
        menu.Items.Add(
            "TEST: Keyboard pipeline sim…",
            null,
            (_, _) => _ = TryRunKeyboardSimulationAsync());
        menu.Items.Add(
            "TEST: Controlled TextBox capture…",
            null,
            (_, _) => TryOpenControlledTextCapture());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit (Admin password)…", null, (_, _) => TryExit());
        return menu;
    }

    private void TryOpenControlledTextCapture()
    {
        // Local TEST window only — captures PreviewTextInput inside Guard's own TextBox.
        try
        {
            ControlledTextCaptureWindow.ShowOrActivate(_settings);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message,
                "Controlled TextBox capture",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private async Task TryRunKeyboardSimulationAsync()
    {
        if (!AskAdminPassword("Interact Guard — TEST / SIMULATION")) return;
        try
        {
            var (ok, detail) = await _controller.RunKeyboardPipelineSimulationAsync()
                .ConfigureAwait(true);
            MessageBox.Show(
                ok
                    ? $"TEST/SIMULATION succeeded.\n\n{detail}\n\n" +
                      "Open Admin → Guard Screenshots → Keyboard activity.\n" +
                      "Look for app InteractGuard.SIMULATION and the synthetic sequence."
                    : $"TEST/SIMULATION failed.\n\n{detail}",
                "Keyboard pipeline TEST",
                MessageBoxButtons.OK,
                ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Keyboard pipeline TEST", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private bool AskAdminPassword(string title)
    {
        var pwd = SimplePrompt.AskPassword(title, "Admin password");
        if (pwd == _settings.AdminExitPassword) return true;
        MessageBox.Show("Incorrect password.", "Interact Guard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return false;
    }

    private void TryShowStatus()
    {
        if (!AskAdminPassword("Interact Guard — Status")) return;
        var detail =
            $"{_status}\n\n" +
            $"HRM: {_settings.HrmBaseUrl}\n" +
            $"Employee: {_settings.EmployeeId ?? "(not bound)"}\n" +
            $"Screenshots: {(_settings.ScreenshotCaptureEnabled ? "On — upload to HRM then cleared from PC (never kept local)" : "Off (admin)")}\n" +
            $"Keyboard metrics: {(_controller.KeyboardMetricsCollecting ? "On (counts only)" : "Off")}\n" +
            $"Admin monitoring: {(_settings.AdminEnabled ? "On" : "Off")}\n" +
            $"Version: {AppSettings.Version}";
        MessageBox.Show(detail, "Interact Guard Status", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void TryExit()
    {
        if (!AskAdminPassword("Exit Interact Guard")) return;
        Application.Current?.Shutdown();
    }

    private static string Truncate(string s) => s.Length <= 60 ? s : s[..57] + "…";

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
