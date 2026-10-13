using System.Text.Json;

namespace Epixs.PrintBridge.Core;

/// <summary>Thread-safe owner of settings.json. Readers get deep copies; writers go through <see cref="Update"/>.</summary>
public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly object _gate = new();
    private readonly string _path;
    private BridgeSettings _settings;

    private SettingsStore(string path, BridgeSettings settings)
    {
        _path = path;
        _settings = settings;
    }

    public event Action? Changed;

    public string PairingKey
    {
        get { lock (_gate) return _settings.PairingKey; }
    }

    public static SettingsStore Load(string path)
    {
        BridgeSettings settings;
        try
        {
            settings = File.Exists(path)
                ? JsonSerializer.Deserialize<BridgeSettings>(File.ReadAllText(path), JsonOptions) ?? new BridgeSettings()
                : new BridgeSettings();
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            Log.Error($"Settings file could not be read ({ex.Message}); starting with defaults.");
            TryBackupBrokenFile(path);
            settings = new BridgeSettings();
        }

        Normalize(settings);
        var store = new SettingsStore(path, settings);
        store.Save();
        return store;
    }

    public BridgeSettings Snapshot()
    {
        lock (_gate)
            return Clone(_settings);
    }

    public void Update(Action<BridgeSettings> mutate)
    {
        lock (_gate)
        {
            mutate(_settings);
            Normalize(_settings);
            Save();
        }
        Changed?.Invoke();
    }

    private void Save()
    {
        lock (_gate)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(_settings, JsonOptions));
                File.Move(tmp, _path, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Error($"Could not save settings: {ex.Message}");
            }
        }
    }

    private static void Normalize(BridgeSettings s)
    {
        if (s.HttpPort is < 1 or > 65535)
            s.HttpPort = AppInfo.DefaultHttpPort;
        if (!Core.PairingKey.IsWellFormed(s.PairingKey))
            s.PairingKey = Core.PairingKey.Generate();

        var profiles = new Dictionary<string, PrintProfile>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, profile) in s.Profiles ?? new Dictionary<string, PrintProfile>())
        {
            if (profile is null || string.IsNullOrWhiteSpace(profile.PrinterName))
                continue;
            profiles[key.Trim().ToLowerInvariant()] = profile;
        }
        s.Profiles = profiles;

        s.Payments ??= new PaymentSettings();
        var p = s.Payments;
        p.Provider = PaymentProviders.All.FirstOrDefault(x => string.Equals(x, p.Provider, StringComparison.OrdinalIgnoreCase))
                     ?? PaymentProviders.None;
        p.RazorpayKeyId = (p.RazorpayKeyId ?? string.Empty).Trim();
        p.RazorpayKeySecretProtected ??= string.Empty;
        p.BusinessName = string.IsNullOrWhiteSpace(p.BusinessName) ? "Photo Booth" : p.BusinessName.Trim();
        p.QrTimeoutSeconds = Math.Clamp(p.QrTimeoutSeconds, 60, 3600);
        p.SimulatorAutoPaySeconds = Math.Clamp(p.SimulatorAutoPaySeconds, 0, 3600);

        s.Cloud ??= new CloudSettings();
        var c = s.Cloud;
        c.DatabaseUrl = string.IsNullOrWhiteSpace(c.DatabaseUrl) ? CloudSettings.DefaultDatabaseUrl : c.DatabaseUrl.Trim().TrimEnd('/');
        c.ApiKey = string.IsNullOrWhiteSpace(c.ApiKey) ? CloudSettings.DefaultApiKey : c.ApiKey.Trim();
        c.AuthEmulatorHost = string.IsNullOrWhiteSpace(c.AuthEmulatorHost) ? null : c.AuthEmulatorHost.Trim();
        c.DatabaseEmulatorHost = string.IsNullOrWhiteSpace(c.DatabaseEmulatorHost) ? null : c.DatabaseEmulatorHost.Trim();
        c.Uid = (c.Uid ?? string.Empty).Trim();
        c.RefreshTokenProtected ??= string.Empty;
        c.BoothId = (c.BoothId ?? string.Empty).Trim();
        c.PrivateKeyProtected ??= string.Empty;
        c.PublicKeySpki ??= string.Empty;
    }

    private static BridgeSettings Clone(BridgeSettings s)
    {
        var clone = JsonSerializer.Deserialize<BridgeSettings>(JsonSerializer.Serialize(s, JsonOptions), JsonOptions)!;
        clone.Profiles = new Dictionary<string, PrintProfile>(clone.Profiles, StringComparer.OrdinalIgnoreCase);
        return clone;
    }

    /// <summary>
    /// Copies settings.json to settings.json.{tag}-{time}.bak before a saved secret is replaced
    /// (e.g. a DPAPI value another Windows user wrote). Returns the copy's path, or null.
    /// </summary>
    public string? Backup(string tag)
    {
        lock (_gate)
        {
            var copy = $"{_path}.{tag}-{DateTime.Now:yyyyMMddHHmmss}.bak";
            try
            {
                if (!File.Exists(_path))
                    return null;
                File.Copy(_path, copy, overwrite: true);
                return copy;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Warn($"Could not back up the settings file: {ex.Message}");
                return null;
            }
        }
    }

    private static void TryBackupBrokenFile(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Copy(path, $"{path}.broken-{DateTime.Now:yyyyMMddHHmmss}", overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not back up broken settings file: {ex.Message}");
        }
    }
}
