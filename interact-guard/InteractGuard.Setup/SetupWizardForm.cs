using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;

namespace InteractGuard.Setup;

public sealed class SetupWizardForm : Form
{
    public const string AppProductName = "Interact Guard";
    public const string Version = "1.2.63";
    public const string Publisher = "Interact Global";
    public static readonly string InstallDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "InteractGuard");
    public const string UninstallRegPath =
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\InteractGuard";

    private readonly bool _uninstallMode;
    private readonly Label _title;
    private readonly Label _body;
    private readonly ProgressBar _progress;
    private readonly Button _back;
    private readonly Button _next;
    private readonly Button _cancel;
    private int _step; // 0 welcome, 1 ready, 2 working, 3 done

    public SetupWizardForm(bool uninstallMode)
    {
        _uninstallMode = uninstallMode;
        Text = uninstallMode ? $"{AppProductName} Uninstall" : $"{AppProductName} Setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10f);
        BackColor = Color.White;
        // ClientSize = usable area (avoids title-bar clipping buttons)
        ClientSize = new Size(560, 400);
        Padding = new Padding(0);

        var banner = new Panel
        {
            Dock = DockStyle.Top,
            Height = 72,
            BackColor = Color.FromArgb(45, 27, 78),
        };
        var bannerLabel = new Label
        {
            Text = uninstallMode ? $"Remove {AppProductName}" : $"Welcome to {AppProductName} Setup",
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 14f),
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(20, 0, 0, 0),
        };
        banner.Controls.Add(bannerLabel);

        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 64,
            BackColor = Color.FromArgb(248, 250, 252),
            Padding = new Padding(16, 12, 16, 12),
        };

        _cancel = new Button
        {
            Text = "Cancel",
            Width = 96,
            Height = 36,
            FlatStyle = FlatStyle.System,
            Margin = new Padding(8, 2, 0, 2),
        };
        _next = new Button
        {
            Text = uninstallMode ? "Uninstall" : "Install",
            Width = 104,
            Height = 36,
            FlatStyle = FlatStyle.System,
            Margin = new Padding(8, 2, 0, 2),
        };
        _back = new Button
        {
            Text = "< Back",
            Width = 96,
            Height = 36,
            Enabled = false,
            FlatStyle = FlatStyle.System,
            Margin = new Padding(8, 2, 0, 2),
        };

        var btnRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Padding = new Padding(0),
            Margin = new Padding(0),
        };
        btnRow.Controls.Add(_cancel);
        btnRow.Controls.Add(_next);
        btnRow.Controls.Add(_back);
        footer.Controls.Add(btnRow);

        var bodyPanel = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(28, 20, 28, 12),
            BackColor = Color.White,
        };

        _title = new Label
        {
            Dock = DockStyle.Top,
            Height = 32,
            Font = new Font("Segoe UI Semibold", 12f),
            Text = uninstallMode ? "Uninstall Interact Guard" : "Install Interact Guard",
            TextAlign = ContentAlignment.MiddleLeft,
        };
        _body = new Label
        {
            Dock = DockStyle.Fill,
            Text = "",
        };
        _progress = new ProgressBar
        {
            Dock = DockStyle.Bottom,
            Height = 18,
            Style = ProgressBarStyle.Marquee,
            Visible = false,
            Margin = new Padding(0, 8, 0, 0),
        };

        bodyPanel.Controls.Add(_body);
        bodyPanel.Controls.Add(_progress);
        bodyPanel.Controls.Add(_title);

        _back.Click += (_, _) => GoBack();
        _next.Click += async (_, _) => await GoNextAsync();
        _cancel.Click += (_, _) => Close();

        // Add order: fill first, then bottom/top docks
        Controls.Add(bodyPanel);
        Controls.Add(footer);
        Controls.Add(banner);

        ShowWelcome();
    }

    private void ShowWelcome()
    {
        _step = 0;
        if (_uninstallMode)
        {
            _title.Text = "Remove Interact Guard from this PC";
            _body.Text =
                "This will stop the agent, remove the Windows service, delete program files, " +
                "and remove the entry from Add or remove programs.\n\n" +
                $"Install location:\n{InstallDir}";
            _next.Text = "Uninstall";
            _back.Enabled = false;
        }
        else
        {
            _title.Text = "Ready to install Interact Guard";
            _body.Text =
                "Interact Guard will be installed for all users.\n\n" +
                $"Location:\n{InstallDir}\n\n" +
                "After install it appears in Add or remove programs and registers with HRM Admin.\n" +
                "Monitoring starts only when Admin turns the agent ON.";
            _next.Text = "Install";
            _back.Enabled = false;
        }
        _progress.Visible = false;
        _cancel.Enabled = true;
    }

    private void GoBack() => ShowWelcome();

    private async Task GoNextAsync()
    {
        if (_step >= 2) { Close(); return; }

        _step = 2;
        _next.Enabled = false;
        _back.Enabled = false;
        _cancel.Enabled = false;
        _progress.Visible = true;
        _title.Text = _uninstallMode ? "Uninstalling…" : "Installing…";
        _body.Text = "Please wait.";

        try
        {
            if (_uninstallMode)
                await Task.Run(InstallerActions.Uninstall);
            else
                await Task.Run(InstallerActions.Install);

            _step = 3;
            _progress.Visible = false;
            _title.Text = "Completed";
            _body.Text = _uninstallMode
                ? "Interact Guard was completely removed."
                : "Interact Guard installed successfully.\n\nYou can close this window. The agent is starting in the background.";
            _next.Text = "Finish";
            _next.Enabled = true;
            _cancel.Visible = false;

            if (!_uninstallMode)
            {
                MessageBox.Show(
                    "Interact Guard is installed on this PC.\n\n" +
                    "The agent is running in the system tray.",
                    "Installed",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch (Exception ex)
        {
            _progress.Visible = false;
            _title.Text = "Something went wrong";
            _body.Text = ex.Message;
            _next.Text = "Close";
            _next.Enabled = true;
            _cancel.Visible = false;
            _step = 3;
        }
    }
}

public static class InstallerActions
{
    public static void Install()
    {
        var payload = FindPayloadDir();
        if (payload == null || !File.Exists(Path.Combine(payload, "InteractGuard.exe")))
            throw new InvalidOperationException(
                "Install files not found. Keep the Setup.exe next to the 'payload' folder (from the installer zip).");

        Directory.CreateDirectory(SetupWizardForm.InstallDir);
        CopyDirectory(payload, SetupWizardForm.InstallDir);

        // Copy this Setup.exe as Uninstall helper
        var setupSrc = Environment.ProcessPath!;
        var setupDst = Path.Combine(SetupWizardForm.InstallDir, "Setup.exe");
        File.Copy(setupSrc, setupDst, true);
        foreach (var side in new[] { "Setup.dll", "Setup.deps.json", "Setup.runtimeconfig.json" })
        {
            var s = Path.Combine(AppContext.BaseDirectory, side);
            if (File.Exists(s))
                File.Copy(s, Path.Combine(SetupWizardForm.InstallDir, side), true);
        }

        // Machine-wide writable data for WebView2 (never Program Files / systemprofile)
        var programData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "InteractGuard");
        Directory.CreateDirectory(programData);
        Directory.CreateDirectory(Path.Combine(programData, "WebView2"));
        // Users group SID S-1-5-32-545 — modify so interactive user Edge can write
        Run("icacls.exe", $"\"{programData}\" /grant *S-1-5-32-545:(OI)(CI)M /T /C");

        // Seed settings (do not overwrite existing)
        var data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractGuard");
        Directory.CreateDirectory(data);
        var settings = Path.Combine(data, "settings.json");
        if (!File.Exists(settings))
        {
            var seed =
                """
                {
                  "HrmBaseUrl": "https://192.168.10.6:8443",
                  "AdminEnabled": false,
                  "IdleSecondsBeforeCheck": 120,
                  "AdminExitPassword": "InteractAdmin"
                }
                """;
            File.WriteAllText(settings, seed);
            try { File.WriteAllText(Path.Combine(programData, "settings.json"), seed); } catch { /* ignore */ }
        }

        using (var run = Registry.LocalMachine.CreateSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run"))
        {
            run?.SetValue("InteractGuard", $"\"{Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.exe")}\"");
            run?.SetValue("InteractGuardWatchdog", $"\"{Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.Watchdog.exe")}\"");
        }

        using (var key = Registry.LocalMachine.CreateSubKey(SetupWizardForm.UninstallRegPath))
        {
            if (key != null)
            {
                key.SetValue("DisplayName", SetupWizardForm.AppProductName);
                key.SetValue("DisplayVersion", SetupWizardForm.Version);
                key.SetValue("Publisher", SetupWizardForm.Publisher);
                key.SetValue("InstallLocation", SetupWizardForm.InstallDir);
                key.SetValue("DisplayIcon", Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.exe") + ",0");
                key.SetValue("UninstallString", $"\"{setupDst}\" /uninstall");
                key.SetValue("QuietUninstallString", $"\"{setupDst}\" /uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }
        // Windows Service: SYSTEM heartbeat + relaunch agent into user session (not Session 0 UI)
        var svc = Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.Service.exe");
        if (File.Exists(svc))
        {
            Run("sc.exe", "stop InteractGuard");
            Run("sc.exe", "delete InteractGuard");
            Thread.Sleep(1000);
            Run("sc.exe", $"create InteractGuard binPath= \"{svc}\" start= auto DisplayName= \"Interact Guard\"");
            Run("sc.exe", "failure InteractGuard reset= 0 actions= restart/5000/restart/5000/restart/5000");
            Run("sc.exe", "start InteractGuard");
        }

        // Force "Installed" toast on next agent start (every Setup install)
        try
        {
            var notice = Path.Combine(data, "installed-notice.shown");
            if (File.Exists(notice)) File.Delete(notice);
        }
        catch { /* ignore */ }

        // Start in the interactive installer session (admin user) — not via SYSTEM service
        Start(Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.Watchdog.exe"));
        Start(Path.Combine(SetupWizardForm.InstallDir, "InteractGuard.exe"));
    }

    public static void Uninstall()
    {
        Run("sc.exe", "stop InteractGuard");
        Run("sc.exe", "delete InteractGuard");

        foreach (var name in new[] { "InteractGuard", "InteractGuard.Watchdog", "InteractGuard.Service", "Setup" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                try { p.Kill(true); } catch { /* ignore */ }
            }
        }
        Thread.Sleep(800);

        using (var run = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true))
        {
            run?.DeleteValue("InteractGuard", false);
            run?.DeleteValue("InteractGuardWatchdog", false);
        }
        Registry.LocalMachine.DeleteSubKeyTree(SetupWizardForm.UninstallRegPath, false);

        try
        {
            if (Directory.Exists(SetupWizardForm.InstallDir))
                Directory.Delete(SetupWizardForm.InstallDir, true);
        }
        catch
        {
            // Retry after short delay (files unlocking)
            Thread.Sleep(1500);
            if (Directory.Exists(SetupWizardForm.InstallDir))
                Directory.Delete(SetupWizardForm.InstallDir, true);
        }

        var data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InteractGuard");
        if (Directory.Exists(data))
            Directory.Delete(data, true);

        var programData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "InteractGuard");
        if (Directory.Exists(programData))
        {
            try { Directory.Delete(programData, true); } catch { /* may be in use */ }
        }
    }

    private static string? FindPayloadDir()
    {
        var baseDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candidates = new[]
        {
            Path.Combine(baseDir, "payload"),
            Path.Combine(Directory.GetParent(baseDir)?.FullName ?? baseDir, "payload"),
            Path.Combine(Path.GetDirectoryName(Environment.ProcessPath!) ?? baseDir, "payload"),
        };
        return candidates.FirstOrDefault(d => Directory.Exists(d) && File.Exists(Path.Combine(d, "InteractGuard.exe")));
    }

    private static void CopyDirectory(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, file);
            var dest = Path.Combine(dst, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.Copy(file, dest, true);
        }
    }

    private static void Start(string exe)
    {
        if (!File.Exists(exe)) return;
        Process.Start(new ProcessStartInfo(exe)
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(exe)!,
        });
    }

    private static void Run(string file, string args)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            p?.WaitForExit(15000);
        }
        catch
        {
            /* ignore */
        }
    }
}
