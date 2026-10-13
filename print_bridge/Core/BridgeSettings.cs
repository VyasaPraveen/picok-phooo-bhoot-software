namespace Epixs.PrintBridge.Core;

public sealed class BridgeSettings
{
    public int HttpPort { get; set; } = AppInfo.DefaultHttpPort;

    public string PairingKey { get; set; } = string.Empty;

    public bool DiscoveryEnabled { get; set; } = true;

    /// <summary>Print profiles keyed "{media}|{finish}", e.g. "4x6|gloss".</summary>
    public Dictionary<string, PrintProfile> Profiles { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public PaymentSettings Payments { get; set; } = new();

    public CloudSettings Cloud { get; set; } = new();
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

/// <summary>Cloud mode (docs/CLOUD_API.md): jobs and payments arrive through the Firebase Realtime Database.</summary>
public sealed class CloudSettings
{
    public const string DefaultDatabaseUrl = "https://picok-booth-default-rtdb.asia-southeast1.firebasedatabase.app";
    public const string DefaultApiKey = "AIzaSyCbUHG0KYPy4j0MWDwioWtvgGEHKEP-HZg";

    /// <summary>True while the bridge should pair with or stay connected to a booth.</summary>
    public bool Enabled { get; set; }

    public string DatabaseUrl { get; set; } = DefaultDatabaseUrl;

    /// <summary>Firebase Web API key (public by design; the security rules protect the data).</summary>
    public string ApiKey { get; set; } = DefaultApiKey;

    /// <summary>Testing only: Firebase Auth emulator "host:port", e.g. 127.0.0.1:9099.</summary>
    public string? AuthEmulatorHost { get; set; }

    /// <summary>Testing only: Realtime Database emulator "host:port", e.g. 127.0.0.1:9000.</summary>
    public string? DatabaseEmulatorHost { get; set; }

    /// <summary>Anonymous Firebase user id of this PC.</summary>
    public string Uid { get; set; } = string.Empty;

    /// <summary>DPAPI-protected Firebase refresh token, base64.</summary>
    public string RefreshTokenProtected { get; set; } = string.Empty;

    /// <summary>Booth this PC is paired with; empty when not paired.</summary>
    public string BoothId { get; set; } = string.Empty;

    /// <summary>DPAPI-protected RSA private key (PKCS#8), base64. Decrypts print files.</summary>
    public string PrivateKeyProtected { get; set; } = string.Empty;

    /// <summary>RSA public key (SPKI), base64. Published to /booths/{b}/bridge/publicKey.</summary>
    public string PublicKeySpki { get; set; } = string.Empty;
}
