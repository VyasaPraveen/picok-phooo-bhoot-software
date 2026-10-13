using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Cloud;

/// <summary>A Firebase failure with a message that is safe to show to the operator.</summary>
public sealed class CloudException(string message, int? httpStatus = null, Exception? inner = null) : Exception(message, inner)
{
    public int? HttpStatus { get; } = httpStatus;

    /// <summary>True when the security rules refused the request.</summary>
    public bool IsPermissionDenied => HttpStatus is 401 or 403;
}

/// <summary>The saved anonymous identity no longer exists (deleted user, revoked refresh token).</summary>
public sealed class CloudIdentityLostException(string message) : Exception(message);

/// <summary>
/// Anonymous Firebase Auth over REST (docs/CLOUD_API.md, "Bridge sign-in over REST"). The refresh token is
/// stored DPAPI-protected in settings; the short-lived idToken is kept in memory and renewed 5 minutes
/// before it expires. Thread-safe.
/// </summary>
public sealed class CloudAuth
{
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    private readonly SettingsStore _settings;
    private readonly HttpClient _http;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _tokenGate = new();
    private string? _idToken;
    private DateTimeOffset _expiresAt;

    public CloudAuth(SettingsStore settings, HttpClient http)
    {
        _settings = settings;
        _http = http;
    }

    public string Uid => _settings.Snapshot().Cloud.Uid;

    public bool HasIdentity
    {
        get
        {
            var c = _settings.Snapshot().Cloud;
            return c.Uid.Length > 0 && c.RefreshTokenProtected.Length > 0;
        }
    }

    /// <summary>Returns a valid idToken, refreshing it when it expires within 5 minutes (or when forced).</summary>
    public async Task<string> GetIdTokenAsync(CancellationToken ct, bool forceRefresh = false)
    {
        if (!forceRefresh && CurrentToken() is { } token)
            return token;

        await _gate.WaitAsync(ct);
        try
        {
            if (!forceRefresh && CurrentToken() is { } again)
                return again;

            var cloud = _settings.Snapshot().Cloud;
            var refreshToken = SecretProtector.Unprotect(cloud.RefreshTokenProtected);
            if (refreshToken is null && cloud.RefreshTokenProtected.Length > 0)
            {
                // Saved by another Windows user (or copied from another PC): the identity is dropped next,
                // so keep the old file for support.
                var copy = _settings.Backup("signin");
                Log.Error("Cloud: the saved sign-in could not be decrypted (another Windows user?); this PC must be paired again. " +
                          $"Old settings kept in {copy ?? "(no copy)"}.");
            }
            if (string.IsNullOrEmpty(cloud.Uid) || string.IsNullOrEmpty(refreshToken))
                throw new CloudIdentityLostException("This PC is not signed in to the cloud");

            await RefreshAsync(cloud, refreshToken, ct);
            return CurrentToken() ?? throw new CloudException("Firebase returned no sign-in token");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Creates a new anonymous user and saves its uid and refresh token.</summary>
    public async Task SignUpAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var cloud = _settings.Snapshot().Cloud;
            var url = $"{IdentityBase(cloud)}/v1/accounts:signUp?key={Uri.EscapeDataString(cloud.ApiKey)}";
            var json = await PostAsync(url, JsonContent.Create(new JsonObject { ["returnSecureToken"] = true }), ct);

            var uid = Str(json, "localId");
            var idToken = Str(json, "idToken");
            var refresh = Str(json, "refreshToken");
            if (uid is null || idToken is null || refresh is null)
                throw new CloudException("Firebase sign-up returned an incomplete answer");

            _settings.Update(s =>
            {
                s.Cloud.Uid = uid;
                s.Cloud.RefreshTokenProtected = SecretProtector.Protect(refresh);
            });
            SetToken(idToken, Str(json, "expiresIn"));
            Log.Info($"Cloud: signed up anonymously as {uid}");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Forgets the in-memory token (after the connection settings or identity changed).</summary>
    public void Reset()
    {
        lock (_tokenGate)
        {
            _idToken = null;
            _expiresAt = DateTimeOffset.MinValue;
        }
    }

    private async Task RefreshAsync(CloudSettings cloud, string refreshToken, CancellationToken ct)
    {
        var url = $"{SecureTokenBase(cloud)}/v1/token?key={Uri.EscapeDataString(cloud.ApiKey)}";
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        });

        JsonObject json;
        try
        {
            json = await PostAsync(url, form, ct);
        }
        catch (CloudException ex) when (ex.HttpStatus == 400 && IsIdentityGone(ex.Message))
        {
            throw new CloudIdentityLostException($"The cloud sign-in of this PC is no longer valid ({ex.Message})");
        }

        var idToken = Str(json, "id_token") ?? throw new CloudException("Firebase token refresh returned no token");
        var newRefresh = Str(json, "refresh_token");
        var userId = Str(json, "user_id");
        if (userId is not null && !string.Equals(userId, cloud.Uid, StringComparison.Ordinal))
            throw new CloudIdentityLostException("Firebase returned a different user for this PC");
        if (!string.IsNullOrEmpty(newRefresh) && newRefresh != refreshToken)
            _settings.Update(s => s.Cloud.RefreshTokenProtected = SecretProtector.Protect(newRefresh));
        SetToken(idToken, Str(json, "expires_in"));
    }

    private async Task<JsonObject> PostAsync(string url, HttpContent content, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsync(url, content, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new CloudException("Cannot reach Firebase sign-in – check the internet connection", null, ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new CloudException("Firebase sign-in did not respond in time", null, ex);
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonObject? json = null;
            try
            {
                json = JsonNode.Parse(text) as JsonObject;
            }
            catch (JsonException)
            {
            }

            if (response.IsSuccessStatusCode && json is not null)
                return json;

            var code = json?["error"]?["message"]?.GetValue<string>() ?? $"HTTP {(int)response.StatusCode}";
            var message = code switch
            {
                _ when code.StartsWith("ADMIN_ONLY_OPERATION", StringComparison.Ordinal) ||
                       code.StartsWith("OPERATION_NOT_ALLOWED", StringComparison.Ordinal) =>
                    "Anonymous sign-in is not enabled in the Firebase project",
                _ when code.Contains("API key not valid", StringComparison.OrdinalIgnoreCase) ||
                       code.StartsWith("API_KEY_INVALID", StringComparison.Ordinal) =>
                    "The Firebase API key is not valid (Cloud tab → Advanced)",
                _ => code,
            };
            Log.Warn($"Cloud sign-in request failed: HTTP {(int)response.StatusCode} {code}");
            throw new CloudException(message, (int)response.StatusCode);
        }
    }

    private static bool IsIdentityGone(string code) =>
        code.StartsWith("TOKEN_EXPIRED", StringComparison.Ordinal) ||
        code.StartsWith("USER_DISABLED", StringComparison.Ordinal) ||
        code.StartsWith("USER_NOT_FOUND", StringComparison.Ordinal) ||
        code.StartsWith("INVALID_REFRESH_TOKEN", StringComparison.Ordinal) ||
        code.StartsWith("PROJECT_NUMBER_MISMATCH", StringComparison.Ordinal);

    private string? CurrentToken()
    {
        lock (_tokenGate)
            return _idToken is not null && DateTimeOffset.UtcNow < _expiresAt - RefreshMargin ? _idToken : null;
    }

    private void SetToken(string idToken, string? expiresIn)
    {
        var seconds = int.TryParse(expiresIn, out var s) && s > 0 ? s : 3600;
        lock (_tokenGate)
        {
            _idToken = idToken;
            _expiresAt = DateTimeOffset.UtcNow.AddSeconds(seconds);
        }
    }

    private static string? Str(JsonObject json, string name) => json[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static string IdentityBase(CloudSettings c) =>
        c.AuthEmulatorHost is { Length: > 0 } host ? $"http://{host}/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com";

    private static string SecureTokenBase(CloudSettings c) =>
        c.AuthEmulatorHost is { Length: > 0 } host ? $"http://{host}/securetoken.googleapis.com" : "https://securetoken.googleapis.com";
}
