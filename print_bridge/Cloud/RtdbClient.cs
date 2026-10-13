using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Cloud;

/// <summary>One server-sent event from a Realtime Database stream.</summary>
public sealed record RtdbEvent(string Name, string Path, JsonNode? Data);

/// <summary>Raised when a stream ends because the server sent auth_revoked (reconnect with a fresh token).</summary>
public sealed class RtdbAuthRevokedException() : Exception("Firebase revoked the stream's sign-in token");

/// <summary>Raised when a stream ends with "cancel" (read permission lost).</summary>
public sealed class RtdbStreamCancelledException() : Exception("Firebase closed the stream: permission denied");

/// <summary>
/// Realtime Database REST client: GET/PUT/PATCH/DELETE on {DB}/path.json?auth=idToken, and
/// server-sent-event streams. Works against the live database and the local emulator (?ns=).
/// </summary>
public sealed class RtdbClient
{
    private static readonly TimeSpan StreamIdleTimeout = TimeSpan.FromSeconds(90);

    private readonly SettingsStore _settings;
    private readonly CloudAuth _auth;
    private readonly HttpClient _http;
    private readonly HttpClient _streamHttp;

    public RtdbClient(SettingsStore settings, CloudAuth auth, HttpClient http, HttpClient streamHttp)
    {
        _settings = settings;
        _auth = auth;
        _http = http;
        _streamHttp = streamHttp;
    }

    public Task<JsonNode?> GetAsync(string path, CancellationToken ct) => SendAsync(HttpMethod.Get, path, null, ct);

    public Task<JsonNode?> PutAsync(string path, JsonNode body, CancellationToken ct) => SendAsync(HttpMethod.Put, path, body, ct);

    public Task<JsonNode?> PatchAsync(string path, JsonObject body, CancellationToken ct) => SendAsync(HttpMethod.Patch, path, body, ct);

    public Task<JsonNode?> DeleteAsync(string path, CancellationToken ct) => SendAsync(HttpMethod.Delete, path, null, ct);

    /// <summary>Server value placeholder resolved by Firebase to its own clock (epoch ms).</summary>
    public static JsonObject ServerTimestamp() => new() { [".sv"] = "timestamp" };

    /// <summary>Joins path segments, escaping each one for the URL.</summary>
    public static string Path(params string[] segments) =>
        "/" + string.Join("/", segments.Select(Uri.EscapeDataString));

    private async Task<JsonNode?> SendAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            var token = await _auth.GetIdTokenAsync(ct, forceRefresh: attempt > 0);
            using var request = new HttpRequestMessage(method, BuildUri(path, token));
            if (body is not null)
                request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, ct);
            }
            catch (HttpRequestException ex)
            {
                throw new CloudException("Cannot reach the cloud database – check the internet connection", null, ex);
            }
            catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
            {
                throw new CloudException("The cloud database did not respond in time", null, ex);
            }

            using (response)
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                if (response.IsSuccessStatusCode)
                    return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);

                var error = ErrorText(text) ?? $"HTTP {(int)response.StatusCode}";
                if (attempt == 0 && (int)response.StatusCode == 401 && error.Contains("expired", StringComparison.OrdinalIgnoreCase))
                    continue; // token expired early: refresh once and retry

                throw new CloudException(FriendlyError(error, method, path), (int)response.StatusCode);
            }
        }
    }

    /// <summary>
    /// Opens a stream and calls <paramref name="onEvent"/> for every put/patch until the connection ends.
    /// Throws <see cref="RtdbAuthRevokedException"/>, <see cref="RtdbStreamCancelledException"/>,
    /// <see cref="CloudException"/> or <see cref="TimeoutException"/> (no data for 90 s).
    /// </summary>
    public async Task StreamAsync(string path, Func<RtdbEvent, Task> onEvent, CancellationToken ct)
    {
        var token = await _auth.GetIdTokenAsync(ct);
        using var request = new HttpRequestMessage(HttpMethod.Get, BuildUri(path, token));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
        idle.CancelAfter(StreamIdleTimeout);

        HttpResponseMessage response;
        try
        {
            response = await _streamHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, idle.Token);
        }
        catch (HttpRequestException ex)
        {
            throw new CloudException("Cannot reach the cloud database – check the internet connection", null, ex);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException("The cloud database did not answer the stream request");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                throw new CloudException(FriendlyError(ErrorText(text) ?? $"HTTP {(int)response.StatusCode}", HttpMethod.Get, path),
                    (int)response.StatusCode);
            }

            // The idle timer restarts on every chunk received, not per line: the first put of a big node
            // can take longer than 90 s on a slow link while bytes keep arriving.
            await using var stream = new ActivityStream(await response.Content.ReadAsStreamAsync(ct),
                () => idle.CancelAfter(StreamIdleTimeout));
            using var reader = new StreamReader(stream, Encoding.UTF8);
            string? eventName = null;
            var data = new StringBuilder();

            while (true)
            {
                string? line;
                try
                {
                    line = await reader.ReadLineAsync(idle.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    throw new TimeoutException("The cloud stream went quiet for 90 s");
                }
                catch (IOException ex)
                {
                    throw new CloudException("The cloud stream was interrupted", null, ex);
                }

                if (line is null)
                    return; // server closed the stream; the caller reconnects

                if (line.Length == 0)
                {
                    if (eventName is not null)
                        await DispatchAsync(eventName, data.ToString(), onEvent);
                    eventName = null;
                    data.Clear();
                }
                else if (line.StartsWith("event:", StringComparison.Ordinal))
                {
                    eventName = line[6..].Trim();
                }
                else if (line.StartsWith("data:", StringComparison.Ordinal))
                {
                    if (data.Length > 0)
                        data.Append('\n');
                    data.Append(line[5..].TrimStart());
                }
            }
        }
    }

    private static async Task DispatchAsync(string name, string data, Func<RtdbEvent, Task> onEvent)
    {
        switch (name)
        {
            case "put":
            case "patch":
                JsonObject? payload;
                try
                {
                    payload = JsonNode.Parse(data) as JsonObject;
                }
                catch (JsonException ex)
                {
                    Log.Warn($"Cloud stream: unreadable {name} event ({ex.Message})");
                    return;
                }
                var path = payload?["path"] is JsonValue p && p.TryGetValue<string>(out var s) ? s : "/";
                await onEvent(new RtdbEvent(name, path, payload?["data"]?.DeepClone()));
                break;
            case "keep-alive":
                break;
            case "auth_revoked":
                throw new RtdbAuthRevokedException();
            case "cancel":
                throw new RtdbStreamCancelledException();
            default:
                Log.Warn($"Cloud stream: unknown event \"{name}\"");
                break;
        }
    }

    private Uri BuildUri(string path, string idToken)
    {
        var c = _settings.Snapshot().Cloud;
        var query = $"auth={Uri.EscapeDataString(idToken)}";
        string baseUrl;
        if (c.DatabaseEmulatorHost is { Length: > 0 } host)
        {
            baseUrl = $"http://{host}";
            query = $"ns={Uri.EscapeDataString(Namespace(c.DatabaseUrl))}&{query}";
        }
        else
        {
            baseUrl = c.DatabaseUrl;
        }
        return new Uri($"{baseUrl}{path}.json?{query}");
    }

    /// <summary>Database name used by the emulator: the first label of the database host.</summary>
    public static string Namespace(string databaseUrl) =>
        Uri.TryCreate(databaseUrl, UriKind.Absolute, out var uri) ? uri.Host.Split('.')[0] : "picok-booth-default-rtdb";

    private static string? ErrorText(string text)
    {
        try
        {
            return JsonNode.Parse(text)?["error"]?.GetValue<string>();
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return string.IsNullOrWhiteSpace(text) ? null : text.Length > 200 ? text[..200] : text;
        }
    }

    private static string FriendlyError(string error, HttpMethod method, string path)
    {
        var where = $"{method.Method} {path}";
        return error.Contains("Permission denied", StringComparison.OrdinalIgnoreCase)
            ? $"Firebase refused access ({where}). Is this PC still paired in the dashboard?"
            : $"Firebase error on {where}: {error}";
    }

    /// <summary>Read-only pass-through stream that reports every chunk of data received.</summary>
    private sealed class ActivityStream(Stream inner, Action onData) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) => Report(inner.Read(buffer, offset, count));

        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Report(await inner.ReadAsync(buffer.AsMemory(offset, count), cancellationToken).ConfigureAwait(false));

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            Report(await inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false));

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
                inner.Dispose();
            base.Dispose(disposing);
        }

        public override async ValueTask DisposeAsync()
        {
            await inner.DisposeAsync().ConfigureAwait(false);
            await base.DisposeAsync().ConfigureAwait(false);
        }

        private int Report(int read)
        {
            if (read > 0)
                onData();
            return read;
        }
    }
}
