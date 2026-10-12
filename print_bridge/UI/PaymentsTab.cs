using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Payments;

namespace Epixs.PrintBridge.UI;

internal sealed class PaymentsTab : TabPage, IRefreshable
{
    private const string SecretSavedHint = "saved – type a new secret to replace it";

    private readonly BridgeServices _services;
    private readonly ComboBox _provider;
    private readonly TextBox _keyId;
    private readonly TextBox _keySecret;
    private readonly TextBox _businessName;
    private readonly NumericUpDown _timeout;
    private readonly NumericUpDown _autoPay;
    private readonly Label _result;
    private readonly ListView _sessions;
    private readonly Button _markPaid;
    private readonly Button _testKeys;

    public PaymentsTab(BridgeServices services)
    {
        _services = services;
        Text = "Payments";
        UseVisualStyleBackColor = true;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(16, 12, 16, 12) };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var form = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 6) };
        form.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        form.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        _provider = UiKit.DropDown(200, PaymentProviders.All);
        _keyId = new TextBox { Width = 320 };
        _keySecret = new TextBox { Width = 320, UseSystemPasswordChar = true };
        _businessName = new TextBox { Width = 320, MaxLength = 80 };
        _timeout = new NumericUpDown { Minimum = 60, Maximum = 3600, Increment = 30, Width = 100 };
        _autoPay = new NumericUpDown { Minimum = 0, Maximum = 3600, Width = 100 };

        AddField(form, "Provider", _provider);
        AddField(form, "Razorpay Key Id", _keyId);
        AddField(form, "Razorpay Key Secret", _keySecret);
        AddField(form, "Business name (shown in UPI apps)", _businessName);
        AddField(form, "QR valid for (seconds)", _timeout);
        AddField(form, "Simulator auto-pay after (seconds, 0 = manual)", _autoPay);
        root.Controls.Add(form);

        var buttons = UiKit.Row();
        buttons.Controls.Add(UiKit.Button("Save", (_, _) => Save()));
        _testKeys = UiKit.Button("Test Razorpay keys", async (_, _) => await TestKeysAsync());
        buttons.Controls.Add(_testKeys);
        _result = UiKit.Label(string.Empty, 10f, color: UiKit.Muted);
        buttons.Controls.Add(_result);
        root.Controls.Add(buttons);

        _sessions = UiKit.List(("Time", 90), ("Order", 150), ("Amount", 90), ("Status", 90), ("Payment ID", 190), ("Provider", 90), ("Payer", 170));
        _sessions.SelectedIndexChanged += (_, _) => UpdateMarkPaid();
        root.Controls.Add(_sessions);

        var bottom = UiKit.Row();
        _markPaid = UiKit.Button("Mark paid (simulator)", async (_, _) => await MarkPaidAsync());
        _markPaid.Enabled = false;
        bottom.Controls.Add(_markPaid);
        bottom.Controls.Add(UiKit.Label("Razorpay needs the QR Codes feature enabled on your account (KYC complete).", 9.5f, color: UiKit.Muted));
        root.Controls.Add(bottom);

        Controls.Add(root);
        LoadSettings();
    }

    public void RefreshView()
    {
        var rows = _services.Payments.Recent().Select(s => (
            s.QrId,
            new[]
            {
                s.CreatedAt.LocalDateTime.ToString("HH:mm:ss"),
                s.OrderId,
                $"₹{s.Amount / 100m:0.00}",
                s.Status,
                s.PaymentId ?? string.Empty,
                s.Provider,
                s.PayerVpa ?? s.Message ?? string.Empty,
            },
            (Color?)(s.Status switch
            {
                QrStatus.Paid => UiKit.Good,
                QrStatus.Error => UiKit.Bad,
                QrStatus.Pending => null,
                _ => UiKit.Muted,
            })));
        UiKit.Fill(_sessions, rows);
        UpdateMarkPaid();
    }

    private void LoadSettings()
    {
        var p = _services.Settings.Snapshot().Payments;
        _provider.SelectedItem = p.Provider;
        _keyId.Text = p.RazorpayKeyId;
        _keySecret.Text = string.Empty;
        _keySecret.PlaceholderText = string.IsNullOrEmpty(p.RazorpayKeySecretProtected) ? "not set" : SecretSavedHint;
        _businessName.Text = p.BusinessName;
        _timeout.Value = Math.Clamp(p.QrTimeoutSeconds, (int)_timeout.Minimum, (int)_timeout.Maximum);
        _autoPay.Value = Math.Clamp(p.SimulatorAutoPaySeconds, (int)_autoPay.Minimum, (int)_autoPay.Maximum);
    }

    private void Save()
    {
        var provider = (_provider.SelectedItem as string) ?? PaymentProviders.None;
        var keyId = _keyId.Text.Trim();
        var newSecret = _keySecret.Text.Trim();
        var current = _services.Settings.Snapshot().Payments;

        if (provider == PaymentProviders.Razorpay &&
            (keyId.Length == 0 || (newSecret.Length == 0 && string.IsNullOrEmpty(current.RazorpayKeySecretProtected))))
        {
            UiKit.ShowError(FindForm(), "Enter the Razorpay Key Id and Key Secret (Razorpay Dashboard → Account & Settings → API Keys).");
            return;
        }
        if (keyId.Length > 0 && !keyId.StartsWith("rzp_", StringComparison.Ordinal))
        {
            UiKit.ShowError(FindForm(), "The Razorpay Key Id normally starts with rzp_live_ or rzp_test_.");
            return;
        }

        _services.Settings.Update(s =>
        {
            s.Payments.Provider = provider;
            s.Payments.RazorpayKeyId = keyId;
            if (newSecret.Length > 0)
                s.Payments.RazorpayKeySecretProtected = SecretProtector.Protect(newSecret);
            s.Payments.BusinessName = _businessName.Text.Trim();
            s.Payments.QrTimeoutSeconds = (int)_timeout.Value;
            s.Payments.SimulatorAutoPaySeconds = (int)_autoPay.Value;
        });
        _services.Payments.ReloadProvider();
        Log.Info($"Payment settings saved: provider {provider}{(newSecret.Length > 0 ? ", key secret updated" : string.Empty)}");

        LoadSettings();
        var status = _services.Payments.Status;
        _result.Text = $"Saved. {status.Message}";
        _result.ForeColor = status.Ready || status.Provider == "none" ? UiKit.Good : UiKit.Bad;
    }

    private async Task TestKeysAsync()
    {
        var keyId = _keyId.Text.Trim();
        var secret = _keySecret.Text.Trim();
        if (secret.Length == 0)
            secret = SecretProtector.Unprotect(_services.Settings.Snapshot().Payments.RazorpayKeySecretProtected) ?? string.Empty;
        if (keyId.Length == 0 || secret.Length == 0)
        {
            UiKit.ShowError(FindForm(), "Enter the Razorpay Key Id and Key Secret first.");
            return;
        }

        _testKeys.Enabled = false;
        _result.Text = "Contacting Razorpay…";
        _result.ForeColor = UiKit.Muted;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
            var (ok, message) = await RazorpayProvider.TestKeysAsync(keyId, secret, cts.Token);
            _result.Text = message;
            _result.ForeColor = ok ? UiKit.Good : UiKit.Bad;
            Log.Info($"Razorpay key test: {(ok ? "success" : "failed")} – {message}");
        }
        catch (OperationCanceledException)
        {
            _result.Text = "Razorpay did not respond in time";
            _result.ForeColor = UiKit.Bad;
        }
        finally
        {
            _testKeys.Enabled = true;
        }
    }

    private async Task MarkPaidAsync()
    {
        if (_sessions.SelectedItems.Count == 0 || _sessions.SelectedItems[0].Tag is not string qrId)
            return;
        _markPaid.Enabled = false;
        var ok = await _services.Payments.MarkSimulatorPaidAsync(qrId);
        _result.Text = ok ? $"{qrId} marked as paid." : "Only pending simulator QRs can be marked as paid.";
        _result.ForeColor = ok ? UiKit.Good : UiKit.Bad;
        RefreshView();
    }

    private void UpdateMarkPaid()
    {
        var selected = _sessions.SelectedItems.Count > 0 ? _sessions.SelectedItems[0].Tag as string : null;
        var session = selected is null ? null : _services.Payments.Find(selected)?.Snapshot();
        _markPaid.Enabled = session is { IsSimulator: true, Status: QrStatus.Pending };
    }

    private static void AddField(TableLayoutPanel form, string caption, Control input)
    {
        var label = UiKit.Label(caption, 10f);
        label.Anchor = AnchorStyles.Left;
        form.Controls.Add(label);
        input.Margin = new Padding(3, 4, 3, 4);
        form.Controls.Add(input);
    }
}
