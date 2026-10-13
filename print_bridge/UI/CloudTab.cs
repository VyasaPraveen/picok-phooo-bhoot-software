using Epixs.PrintBridge.Cloud;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.UI;

/// <summary>Cloud mode for the web (PWA) kiosk: pairing, connection state and the last job/payment.</summary>
internal sealed class CloudTab : TabPage, IRefreshable
{
    private readonly BridgeServices _services;
    private readonly Label _state;
    private readonly Label _codeCaption;
    private readonly Label _code;
    private readonly Label _codeHint;
    private readonly Label _error;
    private readonly Label _lastJob;
    private readonly Label _lastPayment;
    private readonly Label _lastContact;
    private readonly Button _pair;
    private readonly Button _unpair;
    private readonly Button _reconnect;
    private readonly Button _advancedToggle;
    private readonly TableLayoutPanel _advanced;
    private readonly TextBox _databaseUrl;
    private readonly TextBox _apiKey;
    private readonly TextBox _authEmulator;
    private readonly TextBox _databaseEmulator;
    private readonly Label _uid;
    private readonly Label _advancedResult;
    private bool _busy;

    public CloudTab(BridgeServices services)
    {
        _services = services;
        Text = "Cloud";
        UseVisualStyleBackColor = true;

        var root = UiKit.Column();

        root.Controls.Add(UiKit.Label(
            "Use this when the kiosk runs in a web browser (the Picok web app). Photos and UPI payments then reach this PC " +
            "through the internet. A tablet using the local network keeps working at the same time.", 10f, color: UiKit.Muted));
        root.Controls[^1].MaximumSize = new Size(900, 0);

        _state = UiKit.Label("…", 18f, FontStyle.Bold);
        root.Controls.Add(_state);

        _codeCaption = UiKit.Label("Pairing code", 10f, FontStyle.Bold, UiKit.Muted);
        root.Controls.Add(_codeCaption);
        _code = UiKit.Label("", 48f, FontStyle.Bold, UiKit.Accent);
        _code.Font = new Font("Consolas", 54f, FontStyle.Bold);
        root.Controls.Add(_code);
        _codeHint = UiKit.Label(
            "Open the admin dashboard, go to Devices → Pair, and type this code. This screen changes by itself once the booth owner approves it.",
            10.5f);
        _codeHint.MaximumSize = new Size(900, 0);
        root.Controls.Add(_codeHint);

        _error = UiKit.Label(string.Empty, 10.5f, color: UiKit.Bad);
        _error.MaximumSize = new Size(900, 0);
        root.Controls.Add(_error);

        var actions = UiKit.Row();
        _pair = UiKit.Button("Pair with booth", async (_, _) => await PairAsync());
        _unpair = UiKit.Button("Unpair", async (_, _) => await UnpairAsync());
        _reconnect = UiKit.Button("Reconnect", async (_, _) => await RunAsync(() => _services.Cloud.ReconnectAsync()));
        actions.Controls.Add(_pair);
        actions.Controls.Add(_unpair);
        actions.Controls.Add(_reconnect);
        root.Controls.Add(actions);

        var grid = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 10, 0, 8) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _lastJob = AddRow(grid, "Last print");
        _lastPayment = AddRow(grid, "Last payment");
        _lastContact = AddRow(grid, "Last contact");
        root.Controls.Add(grid);

        _advancedToggle = UiKit.Button("Advanced ▸", (_, _) => ToggleAdvanced());
        root.Controls.Add(_advancedToggle);

        _advanced = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Visible = false, Margin = new Padding(0, 4, 0, 4) };
        _advanced.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _advanced.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _databaseUrl = AddField(_advanced, "Database URL", 560);
        _apiKey = AddField(_advanced, "Web API key", 420);
        _authEmulator = AddField(_advanced, "Auth emulator (testing only)", 200);
        _databaseEmulator = AddField(_advanced, "Database emulator (testing only)", 200);
        _advanced.Controls.Add(UiKit.Label("Cloud id of this PC", 10f));
        _uid = UiKit.Label("—", 10f, color: UiKit.Muted);
        _advanced.Controls.Add(_uid);
        _advanced.Controls.Add(new Label { AutoSize = true });
        var save = UiKit.Row();
        save.Controls.Add(UiKit.Button("Save advanced settings", async (_, _) => await SaveAdvancedAsync()));
        save.Controls.Add(UiKit.Label("Changing these signs this PC out; pair it again afterwards.", 9.5f, color: UiKit.Muted));
        _advanced.Controls.Add(save);
        root.Controls.Add(_advanced);

        _advancedResult = UiKit.Label(string.Empty, 10f, color: UiKit.Muted);
        root.Controls.Add(_advancedResult);

        Controls.Add(root);
        LoadAdvanced();
        RefreshView();
    }

    public void RefreshView()
    {
        var status = _services.Cloud.Status;
        var cloud = _services.Settings.Snapshot().Cloud;
        var (text, color) = Describe(status);
        _state.Text = text;
        _state.ForeColor = color;

        var pairing = status.Phase == CloudPhase.Pairing && status.PairingCode is not null;
        _codeCaption.Visible = pairing;
        _code.Visible = pairing;
        _codeHint.Visible = pairing;
        _code.Text = pairing ? $"{status.PairingCode![..3]} {status.PairingCode[3..]}" : string.Empty;

        _error.Text = status.Error is null ? string.Empty : status.Error;
        _error.Visible = status.Error is not null;

        _pair.Enabled = !_busy && (!cloud.Enabled || cloud.BoothId.Length == 0 || IsKeyMismatch(status)) && status.Phase != CloudPhase.Pairing;
        _unpair.Enabled = !_busy && cloud.Enabled;
        _reconnect.Enabled = !_busy && cloud.Enabled;

        _lastJob.Text = status.LastJob ?? "—";
        _lastPayment.Text = status.LastPayment ?? "—";
        _lastContact.Text = status.LastContact is { } at ? at.ToString("HH:mm:ss") : "—";
        _uid.Text = cloud.Uid.Length > 0 ? cloud.Uid : "— (created when you pair)";
    }

    /// <summary>One line for the Status tab.</summary>
    public static (string Text, Color Color) Describe(CloudStatus status) => status.Phase switch
    {
        CloudPhase.Off => ("Not paired", UiKit.Muted),
        CloudPhase.SigningIn => ("Signing in…", UiKit.Muted),
        CloudPhase.Pairing => ("Waiting for approval", UiKit.Warning),
        CloudPhase.Connecting => ($"Connecting to booth {status.BoothId}…", UiKit.Muted),
        CloudPhase.Connected => ($"Connected to booth {status.BoothId}", UiKit.Good),
        _ => (status.BoothId is null ? "Error" : $"Error – booth {status.BoothId}", UiKit.Bad),
    };

    /// <summary>The booth pinned another Print PC key: pairing again (new code) is the fix, so it stays possible.</summary>
    private static bool IsKeyMismatch(CloudStatus status) => status.Error == BridgeKeyMismatchException.Text;

    private async Task PairAsync()
    {
        var cloud = _services.Settings.Snapshot().Cloud;
        if (cloud.Enabled && cloud.BoothId.Length > 0 && !IsKeyMismatch(_services.Cloud.Status))
            return;
        await RunAsync(() => _services.Cloud.PairAsync());
    }

    private async Task UnpairAsync()
    {
        var answer = MessageBox.Show(FindForm(),
            "Unpair this PC from the booth? The web kiosk will not be able to print or take UPI payments through this PC " +
            "until it is paired again. Also remove this PC in the admin dashboard (Devices).",
            AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes)
            return;
        await RunAsync(() => _services.Cloud.UnpairAsync());
    }

    private async Task SaveAdvancedAsync()
    {
        var url = _databaseUrl.Text.Trim();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            UiKit.ShowError(FindForm(), "The database URL must start with https://");
            return;
        }
        if (_apiKey.Text.Trim().Length < 10)
        {
            UiKit.ShowError(FindForm(), "Enter the Firebase Web API key.");
            return;
        }
        if (!IsHostPortOrEmpty(_authEmulator.Text) || !IsHostPortOrEmpty(_databaseEmulator.Text))
        {
            UiKit.ShowError(FindForm(), "Emulator addresses must look like 127.0.0.1:9099, or be left empty.");
            return;
        }

        await RunAsync(() => _services.Cloud.ApplyConnectionAsync(url, _apiKey.Text.Trim(),
            EmptyToNull(_authEmulator.Text), EmptyToNull(_databaseEmulator.Text)));
        LoadAdvanced();
        _advancedResult.Text = "Saved.";
    }

    private async Task RunAsync(Func<Task> action)
    {
        _busy = true;
        RefreshView();
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            Log.Error("Cloud tab action failed", ex);
            UiKit.ShowError(FindForm(), $"That did not work: {ex.Message}");
        }
        finally
        {
            _busy = false;
            RefreshView();
        }
    }

    private void ToggleAdvanced()
    {
        _advanced.Visible = !_advanced.Visible;
        _advancedToggle.Text = _advanced.Visible ? "Advanced ▾" : "Advanced ▸";
        if (_advanced.Visible)
            LoadAdvanced();
    }

    private void LoadAdvanced()
    {
        var c = _services.Settings.Snapshot().Cloud;
        _databaseUrl.Text = c.DatabaseUrl;
        _apiKey.Text = c.ApiKey;
        _authEmulator.Text = c.AuthEmulatorHost ?? string.Empty;
        _databaseEmulator.Text = c.DatabaseEmulatorHost ?? string.Empty;
    }

    private static bool IsHostPortOrEmpty(string text)
    {
        var t = text.Trim();
        if (t.Length == 0)
            return true;
        var colon = t.LastIndexOf(':');
        return colon > 0 && int.TryParse(t[(colon + 1)..], out var port) && port is > 0 and <= 65535 &&
               Uri.CheckHostName(t[..colon]) != UriHostNameType.Unknown;
    }

    private static string? EmptyToNull(string text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static Label AddRow(TableLayoutPanel grid, string caption)
    {
        grid.Controls.Add(UiKit.Label(caption, 10.5f, FontStyle.Bold, UiKit.Muted));
        var value = UiKit.Label("—", 10.5f);
        grid.Controls.Add(value);
        return value;
    }

    private static TextBox AddField(TableLayoutPanel grid, string caption, int width)
    {
        grid.Controls.Add(UiKit.Label(caption, 10f));
        var box = new TextBox { Width = width, Margin = new Padding(3, 4, 3, 3) };
        grid.Controls.Add(box);
        return box;
    }
}
