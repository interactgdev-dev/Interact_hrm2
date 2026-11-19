using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace InteractGuard.Setup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var uninstall = args.Any(a =>
            a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase) ||
            a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase) ||
            a.Equals("/u", StringComparison.OrdinalIgnoreCase));

        Application.Run(new SetupWizardForm(uninstall));
    }
}
