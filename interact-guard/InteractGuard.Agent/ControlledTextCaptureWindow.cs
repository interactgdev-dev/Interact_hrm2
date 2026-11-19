using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using WpfBrushes = System.Windows.Media.Brushes;

namespace InteractGuard;

/// <summary>
/// Custom-app TEST: characters typed into THIS Guard TextBox only.
/// Chunks upload to HRM Keyboard activity (is_simulation) with app title.
/// Does NOT capture Chrome / Notepad / other apps.
/// </summary>
public sealed class ControlledTextCaptureWindow : Window
{
    public const string ControlledAppName = "InteractGuard.ControlledTextBox";

    private readonly AppSettings _settings;
    private readonly StringBuilder _capturedCharacters = new();
    private readonly List<(string token, DateTime at)> _pending = new();
    private readonly object _gate = new();
    private readonly DispatcherTimer _flushTimer;
    private readonly System.Windows.Controls.TextBox _inputTextBox;
    private readonly System.Windows.Controls.TextBox _capturedTextBox;
    private readonly TextBlock _statusBlock;
    private readonly TextBlock _appTitleBlock;
    private bool _uploading;

    public ControlledTextCaptureWindow(AppSettings settings)
    {
        _settings = settings;
        Title = "Interact Guard — Controlled TextBox (custom app only)";
        Width = 520;
        Height = 380;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = WpfBrushes.White;

        var root = new StackPanel { Margin = new Thickness(20) };

        _appTitleBlock = new TextBlock
        {
            Text = $"App title: {Title}",
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 10),
            TextWrapping = TextWrapping.Wrap,
        };
        root.Children.Add(_appTitleBlock);

        root.Children.Add(new TextBlock
        {
            Text = "Type here (only this box → chunks → admin Keystrokes sequence):",
            Margin = new Thickness(0, 0, 0, 5),
        });

        _inputTextBox = new System.Windows.Controls.TextBox
        {
            Height = 35,
            FontSize = 18,
        };
        _inputTextBox.PreviewTextInput += InputTextBox_PreviewTextInput;
        // Space often bypasses PreviewTextInput — capture via PreviewKeyDown.
        _inputTextBox.PreviewKeyDown += InputTextBox_PreviewKeyDown;
        root.Children.Add(_inputTextBox);

        root.Children.Add(new TextBlock
        {
            Text = "Captured characters (this window):",
            Margin = new Thickness(0, 20, 0, 5),
        });

        _capturedTextBox = new System.Windows.Controls.TextBox
        {
            Height = 100,
            FontSize = 18,
            IsReadOnly = true,
            TextWrapping = TextWrapping.Wrap,
        };
        root.Children.Add(_capturedTextBox);

        _statusBlock = new TextBlock
        {
            Text = "Chunks upload every ~2s to Guard Screenshots → Keyboard activity (TEST).",
            Margin = new Thickness(0, 12, 0, 0),
            FontSize = 11,
            Foreground = WpfBrushes.DimGray,
            TextWrapping = TextWrapping.Wrap,
        };
        root.Children.Add(_statusBlock);

        root.Children.Add(new TextBlock
        {
            Text =
                "Scope: Guard custom TextBox only. Other apps are not monitored by this window.",
            Margin = new Thickness(0, 8, 0, 0),
            FontSize = 11,
            Foreground = WpfBrushes.DimGray,
            TextWrapping = TextWrapping.Wrap,
        });

        var row = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            Margin = new Thickness(0, 12, 0, 0),
        };
        var clearBtn = new System.Windows.Controls.Button
        {
            Content = "Clear local",
            Padding = new Thickness(10, 4, 10, 4),
            Margin = new Thickness(0, 0, 8, 0),
        };
        clearBtn.Click += (_, _) =>
        {
            lock (_gate) _pending.Clear();
            _capturedCharacters.Clear();
            _capturedTextBox.Text = "";
            _inputTextBox.Clear();
            _inputTextBox.Focus();
            _statusBlock.Text = "Local buffer cleared (uploaded chunks stay in admin).";
        };
        var flushBtn = new System.Windows.Controls.Button
        {
            Content = "Upload chunk now",
            Padding = new Thickness(10, 4, 10, 4),
        };
        flushBtn.Click += (_, _) => _ = FlushPendingAsync(force: true);
        row.Children.Add(clearBtn);
        row.Children.Add(flushBtn);
        root.Children.Add(row);

        Content = root;

        _flushTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _flushTimer.Tick += async (_, _) => await FlushPendingAsync(force: false);
        _flushTimer.Start();

        Loaded += (_, _) =>
        {
            _appTitleBlock.Text = $"App title: {Title}";
            _inputTextBox.Focus();
        };
        Closed += (_, _) =>
        {
            _flushTimer.Stop();
            _ = FlushPendingAsync(force: true);
        };
    }

    private void InputTextBox_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.Space)
        {
            AppendToken(" ", "[space]");
            // let TextBox also insert space
        }
        else if (e.Key == Key.Return)
        {
            AppendToken("\n", "[enter]");
        }
        else if (e.Key == Key.Tab)
        {
            AppendToken("\t", "[tab]");
            e.Handled = true;
        }
    }

    private void InputTextBox_PreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Text)) return;
        // Space handled in PreviewKeyDown
        if (e.Text == " ") return;
        AppendToken(e.Text, e.Text);
    }

    private void AppendToken(string displayChar, string token)
    {
        _capturedCharacters.Append(displayChar == "\n" ? "↵" : displayChar == "\t" ? "⇥" : displayChar);
        _capturedTextBox.Text = _capturedCharacters.ToString();
        lock (_gate)
        {
            _pending.Add((token, DateTime.Now));
        }
        _appTitleBlock.Text = $"App title: {Title}";
    }

    private async Task FlushPendingAsync(bool force)
    {
        if (_uploading) return;
        List<(string token, DateTime at)> chunk;
        lock (_gate)
        {
            if (_pending.Count == 0) return;
            if (!force && _pending.Count < 1) return;
            chunk = _pending.ToList();
            _pending.Clear();
        }

        _uploading = true;
        try
        {
            var (ok, detail) = await PostChunkAsync(chunk).ConfigureAwait(true);
            _statusBlock.Text = ok
                ? $"Uploaded {chunk.Count} char(s) · {detail} · app: {ControlledAppName}"
                : $"Upload failed: {detail}";
            _statusBlock.Foreground = ok ? WpfBrushes.DarkGreen : WpfBrushes.DarkRed;
        }
        finally
        {
            _uploading = false;
        }
    }

    private async Task<(bool ok, string detail)> PostChunkAsync(
        List<(string token, DateTime at)> chunk)
    {
        var empId = (_settings.EmployeeId ?? "").Trim();
        if (string.IsNullOrEmpty(empId))
            return (false, "Bind employee first");

        var baseUrl = (_settings.HrmBaseUrl ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(baseUrl))
            return (false, "HRM URL missing");

        var periodStart = chunk[0].at;
        var periodEnd = chunk[^1].at;
        if (periodEnd < periodStart) periodEnd = periodStart;
        var events = new List<object>();
        for (var i = 0; i < chunk.Count; i++)
        {
            events.Add(new
            {
                ord = i,
                token = chunk[i].token,
                captured_at = chunk[i].at.ToString("o"),
                app_name = ControlledAppName,
                window_title = Title,
            });
        }

        var seq = string.Join(" → ", chunk.Select(c =>
            c.token == " " ? "[space]" : c.token));

        var payload = new
        {
            is_simulation = true,
            mode = "TEST_SIMULATION",
            batch_id = "ctrl-" + Guid.NewGuid().ToString("N"),
            employee_id = empId,
            employee_name = _settings.EmployeeName,
            pseudonym = _settings.Pseudonym,
            machine_id = MachineIdentity.GetOrCreate(),
            hostname = MachineIdentity.Hostname,
            windows_user = MachineIdentity.WindowsUser,
            period_start = periodStart.ToString("o"),
            period_end = periodEnd.ToString("o"),
            segments = new[]
            {
                new
                {
                    app_name = ControlledAppName,
                    app_path = (string?)null,
                    key_down_count = chunk.Count,
                    typing_active_ms = Math.Max(0, (int)(periodEnd - periodStart).TotalMilliseconds),
                    keyboard_idle_ms = 0,
                    simulation_events = events,
                    simulation_sequence = seq,
                },
            },
        };

        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(25) };
            using var res = await http
                .PostAsJsonAsync($"{baseUrl}/api/guard/keyboard-activity", payload)
                .ConfigureAwait(true);
            var body = await res.Content.ReadAsStringAsync().ConfigureAwait(true);
            if (!res.IsSuccessStatusCode)
            {
                var tip = body.Length > 160 ? body[..160] + "…" : body;
                return (false, $"HTTP {(int)res.StatusCode} {tip}");
            }
            return (true, $"batch ok · {DateTime.Now:HH:mm:ss}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public static void ShowOrActivate(AppSettings settings)
    {
        var app = System.Windows.Application.Current;
        if (app == null) return;

        void Open()
        {
            foreach (Window w in app.Windows)
            {
                if (w is ControlledTextCaptureWindow existing)
                {
                    existing.Activate();
                    existing._inputTextBox.Focus();
                    return;
                }
            }

            new ControlledTextCaptureWindow(settings).Show();
        }

        if (app.Dispatcher.CheckAccess()) Open();
        else app.Dispatcher.Invoke(Open);
    }
}
