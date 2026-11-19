using System.Windows.Forms;

namespace InteractGuard;

public static class SimplePrompt
{
    public static string? Ask(string title, string label, string defaultValue = "")
        => AskInternal(title, label, defaultValue, password: false);

    /// <summary>Admin password prompt — characters are masked (••••).</summary>
    public static string? AskPassword(string title, string label = "Admin password")
        => AskInternal(title, label, "", password: true);

    private static string? AskInternal(string title, string label, string defaultValue, bool password)
    {
        using var form = new Form
        {
            Text = title,
            Width = 420,
            Height = 160,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };
        var lbl = new Label { Left = 12, Top = 12, Width = 380, Text = label };
        var box = new TextBox
        {
            Left = 12,
            Top = 36,
            Width = 380,
            Text = defaultValue,
            UseSystemPasswordChar = password,
        };
        var ok = new Button { Text = "OK", Left = 220, Width = 80, Top = 75, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Left = 310, Width = 80, Top = 75, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange(new Control[] { lbl, box, ok, cancel });
        form.AcceptButton = ok;
        form.CancelButton = cancel;
        form.Shown += (_, _) => box.Focus();
        return form.ShowDialog() == DialogResult.OK ? box.Text : null;
    }
}
