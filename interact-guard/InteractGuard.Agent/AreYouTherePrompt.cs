using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using Application = System.Windows.Application;
using Window = System.Windows.Window;
using Color = System.Windows.Media.Color;
using Brushes = System.Windows.Media.Brushes;
using Button = System.Windows.Controls.Button;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using Point = System.Windows.Point;
using ShapePath = System.Windows.Shapes.Path;

namespace InteractGuard;

public enum PresencePromptResult
{
    /// <summary>Employee clicked Here — proceed to camera verify.</summary>
    Here,
    /// <summary>5-minute timer expired with no click — send ticket.</summary>
    TimedOut,
}

/// <summary>
/// Idle prompt UI only (frosted glass + ring). Same window behavior as 1.2.10
/// floating card — not fullscreen — so armed Chrome face check is undisturbed.
/// </summary>
public static class AreYouTherePrompt
{
    public const int DefaultTimeoutSeconds = 5 * 60;

    private const double RingSize = 132;
    private const double RingStroke = 8;

    public static Task<PresencePromptResult> ShowAsync(int timeoutSeconds = DefaultTimeoutSeconds)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null)
            return Task.FromResult(PresencePromptResult.TimedOut);

        var tcs = new TaskCompletionSource<PresencePromptResult>();

        _ = dispatcher.InvokeAsync(() =>
        {
            try
            {
                ShowOnUi(timeoutSeconds, tcs);
            }
            catch
            {
                tcs.TrySetResult(PresencePromptResult.TimedOut);
            }
        });

        return tcs.Task;
    }

    private static void ShowOnUi(int timeoutSeconds, TaskCompletionSource<PresencePromptResult> tcs)
    {
        var total = Math.Max(30, timeoutSeconds);
        var remaining = total;
        var completed = false;

        void Complete(PresencePromptResult result)
        {
            if (completed) return;
            completed = true;
            tcs.TrySetResult(result);
        }

        var titleBlock = new TextBlock
        {
            Text = "Are you there?",
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 8),
        };

        var subtitle = new TextBlock
        {
            Text = "Click Here if you are at your seat. Camera will verify next.",
            FontSize = 13,
            Foreground = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B)),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(4, 0, 4, 16),
        };

        var timerBlock = new TextBlock
        {
            Text = FormatMmSs(remaining),
            FontSize = 26,
            FontWeight = FontWeights.Bold,
            Foreground = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var ringTrack = new Ellipse
        {
            Width = RingSize,
            Height = RingSize,
            Stroke = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)),
            StrokeThickness = RingStroke,
            Fill = Brushes.Transparent,
        };

        var ringArc = new ShapePath
        {
            Width = RingSize,
            Height = RingSize,
            Stroke = new SolidColorBrush(Color.FromRgb(0x14, 0xB8, 0xA6)),
            StrokeThickness = RingStroke,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            Fill = Brushes.Transparent,
            Data = BuildArcGeometry(1.0),
        };

        var ringGrid = new Grid
        {
            Width = RingSize,
            Height = RingSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 6),
        };
        ringGrid.Children.Add(ringTrack);
        ringGrid.Children.Add(ringArc);
        ringGrid.Children.Add(timerBlock);

        var hint = new TextBlock
        {
            Text = "Time left to respond",
            FontSize = 12,
            Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 18),
        };

        var hereBtn = new Button
        {
            Content = "Here",
            Width = 160,
            Height = 44,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Cursor = System.Windows.Input.Cursors.Hand,
            Background = new SolidColorBrush(Color.FromRgb(0x14, 0xB8, 0xA6)),
            Foreground = Brushes.White,
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Center,
            Template = BuildPillButtonTemplate(),
        };

        // Same footprint as original 1.2.10 floating card (not fullscreen).
        var root = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(0xF0, 0xFF, 0xFF, 0xFF)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0xDD, 0xE2, 0xE8, 0xF0)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(28, 24, 28, 24),
            CornerRadius = new CornerRadius(18),
            Effect = new DropShadowEffect
            {
                Color = Color.FromRgb(0x0F, 0x17, 0x2A),
                BlurRadius = 28,
                ShadowDepth = 6,
                Direction = 270,
                Opacity = 0.18,
            },
            Child = new StackPanel
            {
                Children = { titleBlock, subtitle, ringGrid, hint, hereBtn },
            },
        };

        var win = new Window
        {
            Title = "Interact Guard — Are you there?",
            Width = 420,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Topmost = true,
            ShowInTaskbar = true,
            ResizeMode = ResizeMode.NoResize,
            WindowStyle = WindowStyle.None,
            AllowsTransparency = true,
            Background = Brushes.Transparent,
            Content = root,
            ShowActivated = true,
        };

        var countdown = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        countdown.Tick += (_, _) =>
        {
            remaining--;
            var frac = Math.Max(0, remaining) / (double)total;
            timerBlock.Text = FormatMmSs(Math.Max(0, remaining));
            ringArc.Data = BuildArcGeometry(frac);
            if (remaining <= 60)
            {
                timerBlock.Foreground = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26));
                ringArc.Stroke = new SolidColorBrush(Color.FromRgb(0xF8, 0x71, 0x71));
            }
            if (remaining <= 0)
            {
                countdown.Stop();
                Complete(PresencePromptResult.TimedOut);
                try { win.Close(); } catch { /* ignore */ }
            }
        };

        hereBtn.Click += (_, _) =>
        {
            countdown.Stop();
            Complete(PresencePromptResult.Here);
            try { win.Close(); } catch { /* ignore */ }
        };

        win.Closed += (_, _) =>
        {
            countdown.Stop();
            Complete(PresencePromptResult.TimedOut);
        };

        win.Show();
        countdown.Start();
        try { win.Activate(); } catch { /* ignore */ }
    }

    private static Geometry BuildArcGeometry(double fraction)
    {
        fraction = Math.Clamp(fraction, 0, 1);
        var cx = RingSize / 2;
        var cy = RingSize / 2;
        var r = (RingSize - RingStroke) / 2;

        if (fraction >= 0.999)
            return new EllipseGeometry(new Point(cx, cy), r, r);

        if (fraction <= 0.001)
            return Geometry.Empty;

        const double startDeg = -90;
        var sweep = 360 * fraction;
        var start = Polar(cx, cy, r, startDeg);
        var end = Polar(cx, cy, r, startDeg + sweep);

        var fig = new PathFigure { StartPoint = start, IsClosed = false };
        fig.Segments.Add(new ArcSegment
        {
            Point = end,
            Size = new System.Windows.Size(r, r),
            IsLargeArc = sweep > 180,
            SweepDirection = SweepDirection.Clockwise,
        });
        var geo = new PathGeometry();
        geo.Figures.Add(fig);
        return geo;
    }

    private static Point Polar(double cx, double cy, double r, double deg)
    {
        var rad = deg * Math.PI / 180.0;
        return new Point(cx + r * Math.Cos(rad), cy + r * Math.Sin(rad));
    }

    private static ControlTemplate BuildPillButtonTemplate()
    {
        var template = new ControlTemplate(typeof(Button));
        var borderFactory = new FrameworkElementFactory(typeof(Border));
        borderFactory.SetValue(Border.CornerRadiusProperty, new CornerRadius(12));
        borderFactory.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Button.BackgroundProperty));
        borderFactory.SetValue(Border.PaddingProperty, new Thickness(12, 0, 12, 0));

        var contentFactory = new FrameworkElementFactory(typeof(ContentPresenter));
        contentFactory.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        contentFactory.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        borderFactory.AppendChild(contentFactory);

        template.VisualTree = borderFactory;
        return template;
    }

    private static string FormatMmSs(int totalSeconds)
    {
        var m = Math.Max(0, totalSeconds) / 60;
        var s = Math.Max(0, totalSeconds) % 60;
        return $"{m:00}:{s:00}";
    }
}
