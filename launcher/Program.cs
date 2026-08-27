using System.Diagnostics;
using System.Runtime.InteropServices;

namespace TheHubLauncher;

internal static class Program
{
    private const uint ErrorIcon = 0x10;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint owner, string text, string caption, uint type);

    [STAThread]
    private static int Main()
    {
        var root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
        if (!File.Exists(electron))
        {
            ShowError("Electron is not installed. Run npm install in:\n\n" + root);
            return 1;
        }

        try
        {
            var start = new ProcessStartInfo
            {
                FileName = electron,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            start.ArgumentList.Add(".");
            using var process = Process.Start(start);
            if (process is null)
            {
                ShowError("Windows did not create the Hub process.");
                return 1;
            }

            if (!process.WaitForExit(60_000)) return 0;
            if (process.ExitCode == 0) return 0;

            ShowError(StartupFailure(root, process.ExitCode));
            return process.ExitCode;
        }
        catch (Exception error)
        {
            ShowError("The Hub could not be launched.\n\n" + error.Message);
            return 1;
        }
    }

    private static string StartupFailure(string root, int exitCode)
    {
        var log = Path.Combine(root, ".runtime", "desktop-startup.log");
        string? last = null;
        try
        {
            if (File.Exists(log)) last = File.ReadLines(log).LastOrDefault(line => line.Contains("startup_failed", StringComparison.Ordinal));
        }
        catch { }

        return last is null
            ? $"The Hub exited during startup (code {exitCode}).\n\nSee:\n{log}"
            : $"The Hub exited during startup (code {exitCode}).\n\n{last}\n\nFull log:\n{log}";
    }

    private static void ShowError(string message) => MessageBoxW(0, message, "The Hub", ErrorIcon);
}
