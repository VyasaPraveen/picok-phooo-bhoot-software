using System.Security;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.UI;

internal sealed class SettingsTab : TabPage, IRefreshable
{
    private readonly BridgeServices _services;
    private readonly NumericUpDown _port;
    private readonly Label _key;
    private readonly CheckBox _discovery;
    private readonly CheckBox _startWithWindows;
    private readonly Label _result;
    private bool _loading;
    private bool _portEdited;

    public SettingsTab(BridgeServices services)
    {
        _services = services;
        Text = "Settings";
        UseVisualStyleBackColor = true;

        var root = UiKit.Column();

        root.Controls.Add(UiKit.Label("Connection", 12f, FontStyle.Bold));
        var portRow = UiKit.Row();
        portRow.Controls.Add(UiKit.Label("HTTP port", 10f));
        _port = new NumericUpDown { Minimum = 1024, Maximum = 65535, Width = 100, Margin = new Padding(3, 4, 3, 3) };
        _port.ValueChanged += (_, _) => _portEdited |= !_loading;
        portRow.Controls.Add(_port);
        portRow.Controls.Add(UiKit.Button("Apply", async (_, _) => await ApplyPortAsync()));
        portRow.Controls.Add(UiKit.Label($"(default {AppInfo.DefaultHttpPort}; the server restarts)", 9.5f, color: UiKit.Muted));
        root.Controls.Add(portRow);

        var keyRow = UiKit.Row();
        keyRow.Controls.Add(UiKit.Label("Pairing key", 10f));
        _key = UiKit.Label("……", 14f, FontStyle.Bold, UiKit.Accent);
        _key.Font = new Font("Consolas", 14f, FontStyle.Bold);
        keyRow.Controls.Add(_key);
        keyRow.Controls.Add(UiKit.Button("Regenerate", (_, _) => RegenerateKey()));
        root.Controls.Add(keyRow);

        _discovery = new CheckBox { Text = $"Let tablets find this PC automatically (UDP {AppInfo.DiscoveryPort})", AutoSize = true, Margin = new Padding(3, 8, 3, 4) };
        _discovery.CheckedChanged += (_, _) =>
        {
            if (!_loading)
                _services.SetDiscoveryEnabled(_discovery.Checked);
        };
        root.Controls.Add(_discovery);

        var firewallRow = UiKit.Row();
        firewallRow.Controls.Add(UiKit.Button("Allow through Windows Firewall", async (_, _) => await AddFirewallRulesAsync()));
        firewallRow.Controls.Add(UiKit.Label("Needs administrator approval. Do this once so the tablet can reach this PC.", 9.5f, color: UiKit.Muted));
        root.Controls.Add(firewallRow);

        root.Controls.Add(UiKit.Label("This PC", 12f, FontStyle.Bold));
        _startWithWindows = new CheckBox { Text = "Start EPIXS Print Bridge when I sign in to Windows", AutoSize = true, Margin = new Padding(3, 4, 3, 4) };
        _startWithWindows.CheckedChanged += (_, _) => ToggleStartWithWindows();
        root.Controls.Add(_startWithWindows);

        var folders = UiKit.Row();
        folders.Controls.Add(UiKit.Button("Open settings and logs folder", (_, _) =>
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = AppPaths.DataDir, UseShellExecute = true })?.Dispose()));
        root.Controls.Add(folders);

        _result = UiKit.Label(string.Empty, 10f, color: UiKit.Muted);
        root.Controls.Add(_result);

        root.Controls.Add(UiKit.Label($"{AppInfo.Name} {AppInfo.Version} · data in {AppPaths.DataDir}", 9f, color: UiKit.Muted));

        Controls.Add(root);
        RefreshView();
    }

    public void RefreshView()
    {
        var settings = _services.Settings.Snapshot();
        _loading = true;
        try
        {
            if (!_portEdited)
                _port.Value = Math.Clamp(settings.HttpPort, (int)_port.Minimum, (int)_port.Maximum);
            _key.Text = settings.PairingKey;
            _discovery.Checked = settings.DiscoveryEnabled;
            _startWithWindows.Checked = WindowsIntegration.IsStartWithWindowsEnabled();
        }
        finally
        {
            _loading = false;
        }
    }

    private async Task ApplyPortAsync()
    {
        var port = (int)_port.Value;
        _portEdited = false;
        if (port == _services.Api.RunningPort)
        {
            ShowResult($"Already running on port {port}.", UiKit.Muted);
            return;
        }
        ShowResult($"Restarting the server on port {port}…", UiKit.Muted);
        await _services.ChangePortAsync(port);
        if (_services.Api.IsRunning)
            ShowResult($"Server running on port {port}. Update the address on the tablet and allow the new port through the firewall.", UiKit.Good);
        else
            ShowResult(_services.Api.LastError ?? "Server did not start", UiKit.Bad);
    }

    private void RegenerateKey()
    {
        var answer = MessageBox.Show(FindForm(),
            "Create a new pairing key? Tablets using the old key stop working until the new key is entered on them.",
            AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes)
            return;
        var key = PairingKey.Generate();
        _services.Settings.Update(s => s.PairingKey = key);
        Log.Info("Pairing key regenerated");
        RefreshView();
        ShowResult("New pairing key created. Enter it on the tablet.", UiKit.Good);
    }

    private void ToggleStartWithWindows()
    {
        if (_loading)
            return;
        try
        {
            WindowsIntegration.SetStartWithWindows(_startWithWindows.Checked);
            ShowResult(_startWithWindows.Checked ? "The bridge will start when you sign in." : "The bridge will no longer start automatically.", UiKit.Good);
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or SecurityException or IOException)
        {
            UiKit.ShowError(FindForm(), $"Could not change the startup setting: {ex.Message}");
        }
    }

    private async Task AddFirewallRulesAsync()
    {
        var port = _services.Api.RunningPort ?? _services.Settings.Snapshot().HttpPort;
        ShowResult("Waiting for administrator approval…", UiKit.Muted);
        try
        {
            var ok = await Task.Run(() => WindowsIntegration.AddFirewallRules(port));
            ShowResult(ok ? $"Firewall now allows TCP {port} and UDP {AppInfo.DiscoveryPort}." : "Firewall change was cancelled.", ok ? UiKit.Good : UiKit.Bad);
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            ShowResult($"Could not change the firewall: {ex.Message}", UiKit.Bad);
        }
    }

    private void ShowResult(string text, Color color)
    {
        _result.Text = text;
        _result.ForeColor = color;
    }
}
