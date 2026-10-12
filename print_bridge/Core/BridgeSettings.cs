namespace Epixs.PrintBridge.Core;

public sealed class BridgeSettings
{
    public int HttpPort { get; set; } = AppInfo.DefaultHttpPort;

    public string PairingKey { get; set; } = string.Empty;

    public bool DiscoveryEnabled { get; set; } = true;

    /// <summary>Print profiles keyed "{media}|{finish}", e.g. "4x6|gloss".</summary>
    public Dictionary<string, PrintProfile> Profiles { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public PaymentSettings Payments { get; set; } = new();
}

public sealed class PrintProfile
{
    public string PrinterName { get; set; } = string.Empty;

    /// <summary>Optional exact name from the driver's PrinterSettings.PaperSizes.</summary>
    public string? PaperSizeName { get; set; }

    /// <summary>Optional private driver DEVMODE captured from the driver's own settings dialog.</summary>
    public string? DevModeBase64 { get; set; }

    /// <summary>Printer the DEVMODE was captured for; a DEVMODE is never applied to a different printer.</summary>
    public string? DevModePrinterName { get; set; }
}

public static class PaymentProviders
{
    public const string None = "None";
    public const string Simulator = "Simulator";
    public const string Razorpay = "Razorpay";

    public static readonly IReadOnlyList<string> All = [None, Simulator, Razorpay];
}

public sealed class PaymentSettings
{
    public string Provider { get; set; } = PaymentProviders.None;

    public string RazorpayKeyId { get; set; } = string.Empty;

    /// <summary>DPAPI-protected (current user) Razorpay key secret, base64. Never stored in plain text.</summary>
    public string RazorpayKeySecretProtected { get; set; } = string.Empty;

    public string BusinessName { get; set; } = "Photo Booth";

    public int QrTimeoutSeconds { get; set; } = 300;

    public int SimulatorAutoPaySeconds { get; set; } = 8;
}
