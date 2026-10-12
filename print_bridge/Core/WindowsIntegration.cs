using System.ComponentModel;
using System.Diagnostics;
using Microsoft.Win32;

namespace Epixs.PrintBridge.Core;

/// <summary>"Start with Windows" (HKCU Run key) and Windows Firewall rules.</summary>
public static class WindowsIntegration
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "EPIXS Print Bridge";
    public const string MinimizedArgument = "--minimized";

    public static bool IsStartWithWindowsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
        return key?.GetValue(RunValueName) is string;
    }

    public static void SetStartWithWindows(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
        if (enabled)
            key.SetValue(RunValueName, $"\"{Environment.ProcessPath}\" {MinimizedArgument}");
        else if (key.GetValue(RunValueName) is not null)
            key.DeleteValue(RunValueName);
    }

    /// <summary>
    /// Adds inbound allow rules for the HTTP port (TCP) and discovery (UDP) through an elevated netsh.
    /// Returns false when the operator declined the UAC prompt.
    /// </summary>
    public static bool AddFirewallRules(int httpPort)
    {
        string tcpRule = "EPIXS Print Bridge (TCP)";
        string udpRule = "EPIXS Print Bridge discovery (UDP)";
        var commands = string.Join(" & ",
            $"netsh advfirewall firewall delete rule name=\"{tcpRule}\"",
            $"netsh advfirewall firewall delete rule name=\"{udpRule}\"",
            $"netsh advfirewall firewall add rule name=\"{tcpRule}\" dir=in action=allow protocol=TCP localport={httpPort} profile=any",
            $"netsh advfirewall firewall add rule name=\"{udpRule}\" dir=in action=allow protocol=UDP localport={AppInfo.DiscoveryPort} profile=any");

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c {commands}",
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        try
        {
            using var process = Process.Start(psi);
            var exited = process?.WaitForExit(30_000) ?? false;
            var exitCode = exited ? process!.ExitCode.ToString() : "unknown";
            Log.Info($"Firewall rules requested for TCP {httpPort} and UDP {AppInfo.DiscoveryPort} (netsh exit code {exitCode}).");
            return true;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            Log.Warn("Firewall rule change cancelled at the UAC prompt.");
            return false;
        }
    }
}
