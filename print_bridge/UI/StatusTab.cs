using System.Runtime.InteropServices;
using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Printing;

namespace Epixs.PrintBridge.UI;

internal sealed class StatusTab : TabPage, IRefreshable
{
    private readonly BridgeServices _services;
    private readonly Label _address;
    private readonly Label _key;
    private readonly Label _server;
    private readonly Label _printer;
    private readonly Label _payments;
    private readonly Label _jobsToday;
    private readonly Label _discovery;
    private readonly Label _cloud;
    private readonly ComboBox _media;
    private readonly ComboBox _finish;
    private readonly Label _testResult;
    private bool _printerQueryRunning;

    public StatusTab(BridgeServices services)
    {
        _services = services;
        Text = "Status";
        UseVisualStyleBackColor = true;

        var root = UiKit.Column();

        root.Controls.Add(UiKit.Label("Type this address and pairing key into the kiosk tablet (Settings → Print bridge):", 11f, color: UiKit.Muted));

        root.Controls.Add(UiKit.Label("Bridge address", 10f, FontStyle.Bold, UiKit.Muted));
        _address = UiKit.Label("…", 26f, FontStyle.Bold, UiKit.Accent);
        root.Controls.Add(_address);

        root.Controls.Add(UiKit.Label("Pairing key", 10f, FontStyle.Bold, UiKit.Muted));
        _key = UiKit.Label("……", 34f, FontStyle.Bold, UiKit.Accent);
        _key.Font = new Font("Consolas", 36f, FontStyle.Bold);
        root.Controls.Add(_key);

        var grid = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 14, 0, 8) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _server = AddRow(grid, "Server");
        _printer = AddRow(grid, "Printer");
        _payments = AddRow(grid, "Payments");
        _discovery = AddRow(grid, "Discovery");
        _cloud = AddRow(grid, "Cloud (web kiosk)");
        _jobsToday = AddRow(grid, "Jobs today");
        root.Controls.Add(grid);

        var actions = UiKit.Row();
        actions.Controls.Add(UiKit.Button("Copy address", (_, _) => CopyAddress()));
        actions.Controls.Add(UiKit.Label("   Test print:", 10f));
        _media = UiKit.DropDown(130, MediaCatalog.All.Select(m => (object)m.Key));
        _media.SelectedIndex = 0;
        _finish = UiKit.DropDown(100, MediaCatalog.Finishes);
        _finish.SelectedIndex = 0;
        actions.Controls.Add(_media);
        actions.Controls.Add(_finish);
        actions.Controls.Add(UiKit.Button("Test print", (_, _) => TestPrint()));
        root.Controls.Add(actions);

        _testResult = UiKit.Label(string.Empty, 10f, color: UiKit.Muted);
        root.Controls.Add(_testResult);

        Controls.Add(root);
    }

    public void RefreshView()
    {
        var settings = _services.Settings.Snapshot();
        var port = _services.Api.RunningPort ?? settings.HttpPort;
        var addresses = NetworkInfo.GetLanIPv4Addresses();
        _address.Text = addresses.Count == 0
            ? "No network connection"
            : string.Join(Environment.NewLine, addresses.Select(a => $"{a}:{port}"));
        _key.Text = settings.PairingKey;

        if (_services.Api.IsRunning)
            SetState(_server, $"● Running on port {_services.Api.RunningPort}", UiKit.Good);
        else
            SetState(_server, $"● Not running – {_services.Api.LastError ?? "starting…"}", UiKit.Bad);

        var pay = _services.Payments.Status;
        SetState(_payments, pay.Message, pay.Ready ? UiKit.Good : (pay.Provider == "none" ? UiKit.Muted : UiKit.Bad));

        if (!settings.DiscoveryEnabled)
            SetState(_discovery, "Off – enter the address on the tablet by hand", UiKit.Muted);
        else if (_services.Discovery.IsRunning)
            SetState(_discovery, $"On (UDP {AppInfo.DiscoveryPort}) – the tablet can find this PC automatically", UiKit.Good);
        else
            SetState(_discovery, _services.Discovery.LastError ?? "Not running", UiKit.Bad);

        var cloud = _services.Cloud.Status;
        var (cloudText, cloudColor) = CloudTab.Describe(cloud);
        if (cloud.Phase == Cloud.CloudPhase.Pairing && cloud.PairingCode is not null)
            cloudText += $" – pairing code {cloud.PairingCode} (see the Cloud tab)";
        else if (cloud.Error is not null)
            cloudText += $" – {cloud.Error}";
        SetState(_cloud, cloudText, cloudColor);

        _jobsToday.Text = _services.Jobs.JobsToday().ToString();
        RefreshPrinterAsync();
    }

    private async void RefreshPrinterAsync()
    {
        if (_printerQueryRunning)
            return;
        _printerQueryRunning = true;
        try
        {
            var status = await Task.Run(_services.PrinterStatus.GetStatus);
            var color = status.State switch
            {
                PrinterState.Ready or PrinterState.Printing => UiKit.Good,
                PrinterState.NotFound => UiKit.Bad,
                _ => UiKit.Warning,
            };
            var name = string.IsNullOrEmpty(status.Name) ? string.Empty : $"{status.Name} – ";
            if (!IsDisposed)
                SetState(_printer, $"{name}{status.Message}", color);
        }
        catch (Exception ex)
        {
            Log.Warn($"Printer status refresh failed: {ex.Message}");
        }
        finally
        {
            _printerQueryRunning = false;
        }
    }

    private void CopyAddress()
    {
        var port = _services.Api.RunningPort ?? _services.Settings.Snapshot().HttpPort;
        var first = NetworkInfo.GetLanIPv4Addresses().FirstOrDefault();
        if (first is null)
        {
            UiKit.ShowError(FindForm(), "This PC has no network connection.");
            return;
        }
        Clipboard.SetText($"{first}:{port}");
        _testResult.Text = $"Copied {first}:{port}";
    }

    private void TestPrint()
    {
        var media = MediaCatalog.Find(_media.SelectedItem as string)!;
        var finish = (string)_finish.SelectedItem!;
        try
        {
            var job = _services.Jobs.EnqueueTestSheet(media, finish);
            _testResult.Text = $"Test sheet for {media.Key}|{finish} queued ({job.JobId}). Progress is shown on the Jobs tab.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ExternalException)
        {
            UiKit.ShowError(FindForm(), $"Could not create the test sheet: {ex.Message}");
        }
    }

    private static Label AddRow(TableLayoutPanel grid, string caption)
    {
        grid.Controls.Add(UiKit.Label(caption, 11f, FontStyle.Bold, UiKit.Muted));
        var value = UiKit.Label("…", 11f);
        grid.Controls.Add(value);
        return value;
    }

    private static void SetState(Label label, string text, Color color)
    {
        label.Text = text;
        label.ForeColor = color;
    }
}
