using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Application = System.Windows.Application;
using Window = System.Windows.Window;
using Color = System.Windows.Media.Color;
using Brushes = System.Windows.Media.Brushes;

namespace InteractGuard;

/// <summary>
/// Non-blocking frosted-glass toast after silent face check (camera stays hidden).
/// </summary>
public static class ResultToast
{
    public static void Show(string title, string message, bool success)
    {
        try
        {
            var dispatcher = Application.Current?.Dispatcher;
            if (dispatcher == null) return;

            _ = dispatcher.InvokeAsync(() =>
            {
                // Soft skip (amber) vs hard error (red) vs success (teal).
                var softSkip = !success &&
                    (title ?? "").Contains("skipped", StringComparison.OrdinalIgnoreCase);
                var accent = success
                    ? Color.FromRgb(0x14, 0xB8, 0xA6)
                    : softSkip
                        ? Color.FromRgb(0xD9, 0x77, 0x06)
                        : Color.FromRgb(0xDC, 0x26, 0x26);

                var root = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0xE8, 0xFF, 0xFF, 0xFF)),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0xDD, 0xE2, 0xE8, 0xF0)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(16),
                    Padding = new Thickness(18, 14, 18, 14),
                    Effect = new DropShadowEffect
                    {
                        Color = Color.FromRgb(0x0F, 0x17, 0x2A),
                        BlurRadius = 28,
                        ShadowDepth = 6,
                        Direction = 270,
                        Opacity = 0.16,
                    },
                    Child = new Border
                    {
                        BorderBrush = new SolidColorBrush(accent),
                        BorderThickness = new Thickness(0, 0, 0, 3),
                        Padding = new Thickness(0, 0, 0, 2),
                        Child = new StackPanel
                        {
                            Children =
                            {
                                new TextBlock
                                {
                                    Text = title,
                                    FontSize = 14,
                                    FontWeight = FontWeights.SemiBold,
                                    Foreground = new SolidColorBrush(accent),
                                    Margin = new Thickness(0, 0, 0, 4),
                                },
                                new TextBlock
                                {
                                    Text = message,
                                    FontSize = 13,
                                    Foreground = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)),
                                    TextWrapping = TextWrapping.Wrap,
                                },
                            },
                        },
                    },
                };

                var win = new Window
                {
                    Title = "Interact Guard",
                    Width = 380,
                    SizeToContent = SizeToContent.Height,
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Topmost = true,
                    ShowInTaskbar = false,
                    ResizeMode = ResizeMode.NoResize,
                    WindowStyle = WindowStyle.None,
                    AllowsTransparency = true,
                    Background = Brushes.Transparent,
                    Content = root,
                    ShowActivated = true,
                };

                win.Loaded += (_, _) =>
                {
                    var work = SystemParameters.WorkArea;
                    win.Left = work.Right - win.ActualWidth - 24;
                    win.Top = work.Bottom - win.ActualHeight - 24;
                };

                win.Show();

                var closer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(7) };
                closer.Tick += (_, _) =>
                {
                    closer.Stop();
                    try { win.Close(); } catch { /* ignore */ }
                };
                closer.Start();
            });
        }
        catch
        {
            /* never break face loop */
        }
    }
}
