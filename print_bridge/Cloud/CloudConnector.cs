using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Epixs.PrintBridge.Api;
using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Payments;
using Epixs.PrintBridge.Printing;

namespace Epixs.PrintBridge.Cloud;

public enum CloudPhase { Off, SigningIn, Pairing, Connecting, Connected, Error }

/// <summary>What the Cloud tab shows.</summary>
public sealed record CloudStatus(
    CloudPhase Phase,
    string? PairingCode,
    string? BoothId,
    string? Error,
    string? LastJob,
    string? LastPayment,
    DateTimeOffset? LastContact);

/// <summary>
/// Cloud mode (docs/CLOUD_API.md): pairs this PC with a booth, then streams /booths/{b}/jobs, /payments and
/// /testPrints from the Firebase Realtime Database. Jobs go to the existing <see cref="PrintJobManager"/>,
/// payments to the existing <see cref="PaymentService"/>. Runs next to the LAN API; errors are logged and
/// shown, never thrown to the app.
/// </summary>
public sealed class CloudConnector : IAsyncDisposable
{
    public const int MaxCopies = 10;
    private const int MaxOrderIdLength = 64;
    private const int MaxDescriptionLength = 255;
    private const long MaxDataBase64Length = ApiEndpoints.MaxImageBytes / 3 * 4 + 4;
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan MaxRequestAge = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan PaymentPollInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PaymentRetryDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SpoolerGrace = TimeSpan.FromMinutes(6);
    private static readonly TimeSpan JobSweepInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan DisposeTimeout = TimeSpan.FromSeconds(10);
    private const string RestartedWhilePrinting = "The print PC restarted while printing – check whether it printed before reprinting";

    private readonly SettingsStore _settings;
    private readonly PrintJobManager _jobs;
    private readonly PaymentService _payments;
    private readonly PrinterStatusService _printerStatus;
    private readonly HttpClient _http;
    private readonly HttpClient _streamHttp;
    private readonly RtdbClient _db;
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly object _statusGate = new();
    private readonly ConcurrentDictionary<string, string> _problems = new(StringComparer.Ordinal);

    // Each kiosk/admin request is handled once per process, also across stream reconnects.
    private readonly ConcurrentDictionary<string, byte> _handled = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, TrackedJob> _tracked = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, PaymentWorker> _paymentWorkers = new(StringComparer.Ordinal);
    // "jobs:{b}" / "testPrints:{b}": jobs left "printing" by an earlier run were checked once in this process.
    private readonly ConcurrentDictionary<string, byte> _orphanChecks = new(StringComparer.Ordinal);
    private readonly AsyncSignal _jobsChanged = new();

    private CancellationTokenSource? _runCts;
    private Task? _runTask;
    private JobCrypto? _crypto;
    private long _serverOffsetMs;

    private CloudPhase _phase = CloudPhase.Off;
    private string? _pairingCode;
    private string? _boothId;
    private string? _error;
    private string? _lastJob;
    private string? _lastPayment;
    private DateTimeOffset? _lastContact;

    public CloudConnector(SettingsStore settings, PrintJobManager jobs, PaymentService payments, PrinterStatusService printerStatus)
    {
        _settings = settings;
        _jobs = jobs;
        _payments = payments;
        _printerStatus = printerStatus;
        _http = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) }) { Timeout = TimeSpan.FromSeconds(30) };
        _streamHttp = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) }) { Timeout = Timeout.InfiniteTimeSpan };
        Auth = new CloudAuth(settings, _http);
        _db = new RtdbClient(settings, Auth, _http, _streamHttp);
        _jobs.JobsChanged += _jobsChanged.Set;
    }

    public event Action? StatusChanged;

    public CloudAuth Auth { get; }

    public CloudStatus Status
    {
        get
        {
            lock (_statusGate)
            {
                var problem = _problems.Values.FirstOrDefault();
                var phase = _phase == CloudPhase.Connected && problem is not null ? CloudPhase.Error : _phase;
                return new CloudStatus(phase, _pairingCode, _boothId, _phase == CloudPhase.Error ? _error : problem,
                    _lastJob, _lastPayment, _lastContact);
            }
        }
    }

    /// <summary>Starts the connector when cloud mode is enabled in the settings.</summary>
    public async Task StartAsync()
    {
        await _lifecycle.WaitAsync().ConfigureAwait(false);
        try
        {
            StartCore();
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    /// <summary>Turns cloud mode on and shows a new pairing code (the current booth link is dropped).</summary>
    public Task PairAsync()
    {
        // The booth pinned another key while this PC is still paired: its device entry would re-link it
        // at once, so pair with a new cloud identity (the dashboard unpairs the old one).
        var freshIdentity = Status.Error == BridgeKeyMismatchException.Text;
        return RestartWithAsync(s =>
        {
            s.Cloud.Enabled = true;
            s.Cloud.BoothId = string.Empty;
            if (freshIdentity)
            {
                s.Cloud.Uid = string.Empty;
                s.Cloud.RefreshTokenProtected = string.Empty;
            }
        }, freshIdentity ? "pairing requested with a new cloud identity (the booth has another print key)" : "pairing requested");
    }

    /// <summary>Stops cloud mode and forgets the booth.</summary>
    public Task UnpairAsync() => RestartWithAsync(s =>
    {
        s.Cloud.Enabled = false;
        s.Cloud.BoothId = string.Empty;
    }, "unpaired on this PC");

    public Task ReconnectAsync() => RestartWithAsync(null, "reconnect requested");

    /// <summary>
    /// Saves the advanced connection settings. A different project or emulator means a different user
    /// database, so the sign-in and booth link are dropped and the PC must be paired again.
    /// </summary>
    public Task ApplyConnectionAsync(string databaseUrl, string apiKey, string? authEmulatorHost, string? databaseEmulatorHost) =>
        RestartWithAsync(s =>
        {
            var c = s.Cloud;
            var changed = !string.Equals(c.DatabaseUrl, databaseUrl.Trim().TrimEnd('/'), StringComparison.OrdinalIgnoreCase) ||
                          c.ApiKey != apiKey.Trim() ||
                          (c.AuthEmulatorHost ?? string.Empty) != (authEmulatorHost ?? string.Empty).Trim() ||
                          (c.DatabaseEmulatorHost ?? string.Empty) != (databaseEmulatorHost ?? string.Empty).Trim();
            c.DatabaseUrl = databaseUrl;
            c.ApiKey = apiKey;
            c.AuthEmulatorHost = authEmulatorHost;
            c.DatabaseEmulatorHost = databaseEmulatorHost;
            if (changed)
            {
                c.Uid = string.Empty;
                c.RefreshTokenProtected = string.Empty;
                c.BoothId = string.Empty;
            }
        }, "connection settings changed");

    // ConfigureAwait(false) in the lifecycle methods: the UI awaits them, and a continuation queued to a UI
    // thread that is shutting down would keep _lifecycle taken and hang DisposeAsync.
    private async Task RestartWithAsync(Action<BridgeSettings>? change, string reason)
    {
        await _lifecycle.WaitAsync().ConfigureAwait(false);
        try
        {
            Log.Info($"Cloud: {reason}");
            await StopCoreAsync().ConfigureAwait(false);
            if (change is not null)
                _settings.Update(change);
            Auth.Reset();
            StartCore();
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    private void StartCore()
    {
        _problems.Clear();
        if (!_settings.Snapshot().Cloud.Enabled)
        {
            SetPhase(CloudPhase.Off);
            return;
        }
        _runCts = new CancellationTokenSource();
        var token = _runCts.Token;
        _runTask = Task.Run(() => SuperviseAsync(token));
    }

    private async Task StopCoreAsync()
    {
        if (_runCts is null)
            return;
        await _runCts.CancelAsync().ConfigureAwait(false);
        try
        {
            if (_runTask is not null)
                await _runTask.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Log.Warn($"Cloud: connector stopped with an error: {ex.Message}");
        }
        _runCts.Dispose();
        _runCts = null;
        _runTask = null;
        SetPhase(CloudPhase.Off);
    }

    // ---------------------------------------------------------------- supervisor

    private async Task SuperviseAsync(CancellationToken ct)
    {
        var backoff = new Backoff();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var cloud = _settings.Snapshot().Cloud;
                if (!cloud.Enabled)
                {
                    SetPhase(CloudPhase.Off);
                    return;
                }

                if (cloud.BoothId.Length == 0)
                    await PairingAsync(ct);
                else
                    await ConnectedAsync(cloud.BoothId, ct);
                backoff.Reset();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (CloudIdentityLostException ex)
            {
                // The anonymous user is gone (e.g. deleted in Firebase). Start over with a new one and a new code.
                Log.Warn($"Cloud: {ex.Message}. This PC must be paired again.");
                _settings.Update(s =>
                {
                    s.Cloud.Uid = string.Empty;
                    s.Cloud.RefreshTokenProtected = string.Empty;
                    s.Cloud.BoothId = string.Empty;
                });
                Auth.Reset();
                SetError("The cloud sign-in of this PC was lost. Pair it with the booth again.");
                await DelayAsync(backoff.Next(), ct);
            }
            catch (Exception ex)
            {
                var message = Friendly(ex);
                if (ex is CloudException or TimeoutException or BridgeKeyMismatchException)
                    Log.Warn($"Cloud: {message}");
                else
                    Log.Error("Cloud: connector error", ex);
                SetError(message);
                await DelayAsync(backoff.Next(), ct);
            }
        }
    }

    // ---------------------------------------------------------------- pairing

    private async Task PairingAsync(CancellationToken ct)
    {
        _problems.Clear(); // problems of an earlier booth session no longer apply
        SetPhase(CloudPhase.SigningIn);
        if (!Auth.HasIdentity)
        {
            await Auth.SignUpAsync(ct);
        }
        else
        {
            try
            {
                await Auth.GetIdTokenAsync(ct);
            }
            catch (CloudIdentityLostException ex)
            {
                Log.Warn($"Cloud: {ex.Message}; signing up again.");
                _settings.Update(s =>
                {
                    s.Cloud.Uid = string.Empty;
                    s.Cloud.RefreshTokenProtected = string.Empty;
                });
                Auth.Reset();
                await Auth.SignUpAsync(ct);
            }
        }

        var uid = Auth.Uid;
        var devicePath = RtdbClient.Path("devices", uid);

        // Approved while the bridge was closed?
        if (BoothOf(await _db.GetAsync(devicePath, ct)) is { } approved)
        {
            SavePairedBooth(approved);
            return;
        }

        var code = await ClaimPairingCodeAsync(uid, ct);
        var paired = false;
        try
        {
            lock (_statusGate)
            {
                _pairingCode = code;
                _phase = CloudPhase.Pairing;
                _error = null;
            }
            RaiseStatusChanged();
            Log.Info($"Cloud: pairing code {code} – enter it in the admin dashboard (Devices → Pair). Cloud user id {uid}.");

            var device = new RtdbMirror();
            var found = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var watch = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var loop = StreamLoopAsync(devicePath, "device", device, _ =>
            {
                if (BoothOf(device.Snapshot()) is { } booth)
                    found.TrySetResult(booth);
            }, watch.Token);

            var first = await Task.WhenAny(found.Task, loop);
            await watch.CancelAsync();
            await IgnoreCancellation(loop);
            if (first != found.Task)
            {
                ct.ThrowIfCancellationRequested();
                throw new CloudException("Lost the connection while waiting for approval");
            }

            SavePairedBooth(found.Task.Result);
            paired = true;
        }
        finally
        {
            lock (_statusGate)
                _pairingCode = null;
            // The dashboard normally deletes the code; delete it here too (and when pairing was abandoned).
            await TryDeletePairingCodeAsync(code, paired);
        }
    }

    private async Task<string> ClaimPairingCodeAsync(string uid, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            var body = new JsonObject
            {
                ["uid"] = uid,
                ["role"] = "bridge",
                ["name"] = AppInfo.MachineName,
                ["createdAt"] = RtdbClient.ServerTimestamp(),
            };
            try
            {
                await _db.PutAsync(RtdbClient.Path("pairing", code), body, ct);
                return code;
            }
            catch (CloudException ex) when (ex.IsPermissionDenied && attempt < 20)
            {
                Log.Info($"Cloud: pairing code {code} is taken, picking another");
            }
        }
    }

    private async Task TryDeletePairingCodeAsync(string code, bool paired)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try
        {
            await _db.DeleteAsync(RtdbClient.Path("pairing", code), cts.Token);
        }
        catch (CloudException ex) when (ex.IsPermissionDenied && paired)
        {
            // Already deleted by the dashboard: the rules refuse deleting a missing node.
        }
        catch (Exception ex) when (ex is CloudException or CloudIdentityLostException or OperationCanceledException)
        {
            Log.Warn($"Cloud: could not delete pairing code {code}: {ex.Message}");
        }
    }

    private void SavePairedBooth(string boothId)
    {
        _settings.Update(s => s.Cloud.BoothId = boothId);
        Log.Info($"Cloud: paired with booth \"{boothId}\"");
    }

    private static string? BoothOf(JsonNode? device)
    {
        var booth = Str(device as JsonObject, "boothId")?.Trim();
        return string.IsNullOrEmpty(booth) ? null : booth;
    }

    // ---------------------------------------------------------------- connected session

    private async Task ConnectedAsync(string boothId, CancellationToken ct)
    {
        if (boothId.Length > 128 || boothId.IndexOfAny(['/', '.', '#', '$', '[', ']']) >= 0)
            throw new CloudException($"The booth id \"{boothId}\" is not valid");

        lock (_statusGate)
        {
            _phase = CloudPhase.Connecting;
            _boothId = boothId;
            _error = null;
        }
        _problems.Clear();
        RaiseStatusChanged();

        await Auth.GetIdTokenAsync(ct);
        var uid = Auth.Uid;
        var devicePath = RtdbClient.Path("devices", uid);
        var current = BoothOf(await _db.GetAsync(devicePath, ct));
        if (current != boothId)
        {
            HandleBoothChange(boothId, current);
            return;
        }

        _crypto ??= JobCrypto.LoadOrCreate(_settings);
        await HeartbeatAsync(boothId, ct);
        lock (_statusGate)
            _phase = CloudPhase.Connected;
        RaiseStatusChanged();
        Log.Info($"Cloud: connected to booth \"{boothId}\" as {uid}");

        using var session = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var token = session.Token;
        var device = new RtdbMirror();
        var jobs = new RtdbMirror();
        var payments = new RtdbMirror();
        var tests = new RtdbMirror();
        var boothChanged = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);

        var tasks = new List<Task>
        {
            StreamLoopAsync(devicePath, "device", device, _ =>
            {
                var b = BoothOf(device.Snapshot());
                if (b != boothId)
                    boothChanged.TrySetResult(b);
            }, token),
            StreamLoopAsync(RtdbClient.Path("booths", boothId, "jobs"), "jobs", jobs, keys => OnJobsChanged(boothId, jobs, keys, token), token),
            StreamLoopAsync(RtdbClient.Path("booths", boothId, "payments"), "payments", payments, keys => OnPaymentsChanged(boothId, payments, keys, token), token),
            StreamLoopAsync(RtdbClient.Path("booths", boothId, "testPrints"), "testPrints", tests, keys => OnTestPrintsChanged(boothId, tests, keys, token), token),
            HeartbeatLoopAsync(boothId, token),
            MirrorJobStatusLoopAsync(boothId, jobs, tests, token),
            JobSweepLoopAsync(boothId, jobs, tests, token),
        };

        var first = await Task.WhenAny(tasks.Append(boothChanged.Task));
        await session.CancelAsync();
        foreach (var task in tasks)
            await IgnoreCancellation(task);
        _problems.Clear();

        if (first == boothChanged.Task)
            HandleBoothChange(boothId, boothChanged.Task.Result);
        else
            await first; // rethrows the failure (e.g. lost identity) for the supervisor
    }

    private void HandleBoothChange(string oldBooth, string? newBooth)
    {
        if (newBooth is null)
        {
            Log.Warn($"Cloud: this PC was removed from booth \"{oldBooth}\" in the dashboard; showing a new pairing code");
            _settings.Update(s => s.Cloud.BoothId = string.Empty);
        }
        else
        {
            Log.Warn($"Cloud: the dashboard moved this PC from booth \"{oldBooth}\" to \"{newBooth}\"");
            _settings.Update(s => s.Cloud.BoothId = newBooth);
        }
        // Status updates for the old booth's jobs would only be refused now.
        foreach (var (localId, tracked) in _tracked)
        {
            if (tracked.BoothId == oldBooth)
                _tracked.TryRemove(localId, out _);
        }
        lock (_statusGate)
            _boothId = newBooth;
        RaiseStatusChanged();
    }

    /// <summary>Keeps one stream open (reconnecting with backoff) and feeds its mirror.</summary>
    private async Task StreamLoopAsync(string path, string label, RtdbMirror mirror, Action<IReadOnlyCollection<string>> onChange, CancellationToken ct)
    {
        var backoff = new Backoff();
        while (!ct.IsCancellationRequested)
        {
            var refreshToken = false;
            try
            {
                await _db.StreamAsync(path, e =>
                {
                    var touched = mirror.Apply(e);
                    backoff.Reset();
                    ClearProblem(label);
                    try
                    {
                        onChange(touched);
                    }
                    catch (Exception ex)
                    {
                        Log.Error($"Cloud: handling a {label} change failed", ex);
                    }
                    return Task.CompletedTask;
                }, ct);
                Log.Info($"Cloud: {label} stream closed by the server; reconnecting");
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (RtdbAuthRevokedException)
            {
                Log.Info($"Cloud: {label} stream token expired; reconnecting with a fresh token");
                refreshToken = true;
            }
            catch (RtdbStreamCancelledException ex)
            {
                SetProblem(label, "Firebase refused access. Is this PC still paired in the dashboard?");
                Log.Warn($"Cloud: {label} stream: {ex.Message}");
            }
            catch (Exception ex) when (ex is CloudException or TimeoutException)
            {
                SetProblem(label, Friendly(ex));
                Log.Warn($"Cloud: {label} stream: {Friendly(ex)}");
            }

            if (refreshToken)
            {
                try
                {
                    await Auth.GetIdTokenAsync(ct, forceRefresh: true);
                    continue;
                }
                catch (CloudException ex)
                {
                    SetProblem(label, ex.Message);
                    Log.Warn($"Cloud: token refresh failed: {ex.Message}");
                }
            }
            await DelayAsync(backoff.Next(), ct);
        }
    }

    private async Task HeartbeatLoopAsync(string boothId, CancellationToken ct)
    {
        while (true)
        {
            await Task.Delay(HeartbeatInterval, ct);
            try
            {
                await HeartbeatAsync(boothId, ct);
                ClearProblem("heartbeat");
            }
            catch (CloudException ex)
            {
                SetProblem("heartbeat", ex.Message);
                Log.Warn($"Cloud: heartbeat failed: {ex.Message}");
            }
        }
    }

    private async Task HeartbeatAsync(string boothId, CancellationToken ct)
    {
        var printer = await Task.Run(_printerStatus.GetStatus, ct);
        var pay = _payments.Status;
        var body = new JsonObject
        {
            ["name"] = AppInfo.MachineName,
            ["version"] = AppInfo.Version,
            ["publicKey"] = _crypto!.PublicKeySpki,
            ["lastSeen"] = RtdbClient.ServerTimestamp(),
            ["printer"] = new JsonObject
            {
                ["name"] = printer.Name,
                ["state"] = printer.State,
                ["message"] = printer.Message,
                ["jobsInQueue"] = printer.JobsInQueue,
            },
            ["payments"] = new JsonObject
            {
                ["provider"] = pay.Provider,
                ["ready"] = pay.Ready,
                ["message"] = pay.Message,
            },
        };
        var sentAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        JsonNode? result;
        try
        {
            result = await _db.PatchAsync(RtdbClient.Path("booths", boothId, "bridge"), body, ct);
        }
        catch (CloudException ex) when (ex.IsPermissionDenied)
        {
            // The rules pin bridge/publicKey: a different key means the booth belongs to another key now
            // (new Print PC paired, or this PC's key was re-created). Stop instead of failing its jobs.
            if (await IsKeyPinnedToAnotherAsync(boothId, ct))
                throw new BridgeKeyMismatchException();
            throw;
        }
        if (Num(result as JsonObject, "lastSeen") is { } serverNow)
            Interlocked.Exchange(ref _serverOffsetMs, serverNow - (sentAt + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 2);
        lock (_statusGate)
            _lastContact = DateTimeOffset.Now;
        RaiseStatusChanged();
    }

    /// <summary>True when /booths/{b}/bridge/publicKey is set to a key other than this PC's.</summary>
    private async Task<bool> IsKeyPinnedToAnotherAsync(string boothId, CancellationToken ct)
    {
        var pinned = await _db.GetAsync(RtdbClient.Path("booths", boothId, "bridge", "publicKey"), ct);
        return pinned is JsonValue v && v.TryGetValue<string>(out var key) && key.Length > 0 &&
               !string.Equals(key, _crypto!.PublicKeySpki, StringComparison.Ordinal);
    }

    /// <summary>Firebase's clock (epoch ms), estimated from the heartbeat's server timestamp.</summary>
    private long ServerNow => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + Interlocked.Read(ref _serverOffsetMs);

    private bool IsTooOld(JsonObject request) =>
        Num(request, "createdAt") is { } createdAt && createdAt > 0 && ServerNow - createdAt > (long)MaxRequestAge.TotalMilliseconds;

    // ---------------------------------------------------------------- print jobs

    private void OnJobsChanged(string boothId, RtdbMirror mirror, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        CheckOrphansOnce(boothId, "jobs", "job", mirror, ct);
        foreach (var key in keys)
        {
            var handledKey = $"job:{boothId}/{key}";
            if (_handled.ContainsKey(handledKey))
                continue;
            var job = mirror.Get(key);
            if (job is null || Str(job, "status") != JobStatus.Queued)
                continue;
            if (_handled.TryAdd(handledKey, 0))
                _ = Task.Run(() => HandleJobAsync(boothId, key, job, mirror, ct), CancellationToken.None);
        }
    }

    /// <summary>
    /// Every 30 s, picks up queued jobs and test prints that are not being handled (e.g. their claim failed),
    /// without waiting for the next change event or reconnect.
    /// </summary>
    private async Task JobSweepLoopAsync(string boothId, RtdbMirror jobs, RtdbMirror tests, CancellationToken ct)
    {
        while (true)
        {
            await Task.Delay(JobSweepInterval, ct);
            if (jobs.Loaded)
                OnJobsChanged(boothId, jobs, jobs.Keys(), ct);
            if (tests.Loaded)
                OnTestPrintsChanged(boothId, tests, tests.Keys(), ct);
        }
    }

    /// <summary>
    /// After the first full sync of a booth in this process: jobs still "printing" that this process never
    /// claimed were claimed before a restart. Their local print state is gone, so they are marked error.
    /// </summary>
    private void CheckOrphansOnce(string boothId, string collection, string kind, RtdbMirror mirror, CancellationToken ct)
    {
        var checkKey = $"{collection}:{boothId}";
        if (!mirror.Loaded || !_orphanChecks.TryAdd(checkKey, 0))
            return;

        var orphans = mirror.Snapshot()
            .Where(kv => kv.Value is JsonObject j && Str(j, "status") == JobStatus.Printing && !_handled.ContainsKey($"{kind}:{boothId}/{kv.Key}"))
            .Select(kv => kv.Key)
            .ToList();
        if (orphans.Count == 0)
            return;

        _ = Task.Run(async () =>
        {
            foreach (var key in orphans)
            {
                if (!_handled.TryAdd($"{kind}:{boothId}/{key}", 0))
                    continue;
                try
                {
                    await FailJobAsync(mirror, key, RtdbClient.Path("booths", boothId, collection, key),
                        $"{(kind == "job" ? "Job" : "Test print")} {key}", RestartedWhilePrinting, clearData: true, ct);
                }
                catch (Exception ex)
                {
                    _handled.TryRemove($"{kind}:{boothId}/{key}", out _);
                    _orphanChecks.TryRemove(checkKey, out _); // checked again on the next change
                    Log.Warn($"Cloud: could not mark {collection}/{key} as interrupted: {ex.Message}");
                }
            }
        }, CancellationToken.None);
    }

    private async Task HandleJobAsync(string boothId, string cloudId, JsonObject job, RtdbMirror mirror, CancellationToken ct)
    {
        var path = RtdbClient.Path("booths", boothId, "jobs", cloudId);
        var orderId = Str(job, "orderId")?.Trim() ?? string.Empty;
        var label = $"Job {cloudId} (order {orderId})";
        string? file = null;
        var claimed = false;
        try
        {
            // Encrypted for another print PC's key (enc.kid, newer kiosks): not ours to claim, fail or delete.
            if (Str(job["enc"] as JsonObject, "kid") is { Length: > 0 } kid &&
                !string.Equals(kid, _crypto!.KeyId, StringComparison.OrdinalIgnoreCase))
            {
                Log.Warn($"Cloud: {label} is encrypted for another print PC key ({kid}, this PC is {_crypto.KeyId}); left untouched");
                SetLastJob($"{label}: skipped – encrypted for another print PC");
                return;
            }

            if (IsTooOld(job))
            {
                await FailJobAsync(mirror, cloudId, path, label, "Expired", clearData: true, ct);
                return;
            }

            var media = MediaCatalog.Find(Str(job, "media"));
            var finish = MediaCatalog.NormalizeFinish(Str(job, "finish") ?? "gloss");
            var copies = Num(job, "copies") ?? 1;
            var enc = job["enc"] as JsonObject;
            var data = Str(job, "data");
            var problem =
                orderId.Length is 0 or > MaxOrderIdLength ? $"orderId is required (max {MaxOrderIdLength} characters)" :
                media is null ? "media must be one of 4x6, 2x6, 3.5x5, 5x7, 6x8" :
                finish is null ? "finish must be gloss or matte" :
                copies is < 1 or > MaxCopies ? $"copies must be between 1 and {MaxCopies}" :
                enc is null || string.IsNullOrEmpty(data) ? "The photo is missing from the print job" :
                data.Length > MaxDataBase64Length ? "Photo is larger than 30 MB" :
                null;
            if (problem is not null)
            {
                await FailJobAsync(mirror, cloudId, path, label, problem, clearData: true, ct);
                return;
            }

            byte[] plain;
            try
            {
                plain = _crypto!.Decrypt(Str(enc, "alg") ?? string.Empty, Str(enc, "key") ?? string.Empty,
                    Str(enc, "iv") ?? string.Empty, data!);
            }
            catch (Exception ex) when (ex is CryptographicException or FormatException)
            {
                Log.Warn($"Cloud: {label} could not be decrypted: {ex.Message}");
                if (await IsKeyPinnedToAnotherAsync(boothId, ct))
                {
                    // Most likely made for the booth's other key: leave it for that print PC.
                    Log.Warn($"Cloud: {label} left untouched: {BridgeKeyMismatchException.Text}");
                    SetProblem("key", BridgeKeyMismatchException.Text);
                    return;
                }
                await FailJobAsync(mirror, cloudId, path, label,
                    "The print PC could not decrypt the photo. Reload the kiosk so it picks up the print PC's current key.",
                    clearData: true, ct);
                return;
            }

            var localId = PrintJobManager.NewJobId();
            file = PrintJobManager.IncomingPath(localId);
            try
            {
                await File.WriteAllBytesAsync(file, plain, ct);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
            if (ApiEndpoints.ValidateImage(file) is { } bad)
            {
                await FailJobAsync(mirror, cloudId, path, label, bad, clearData: true, ct);
                return;
            }

            // Claim the job before printing: the photo leaves the cloud and a restart never prints it twice.
            try
            {
                await _db.PatchAsync(path, new JsonObject
                {
                    ["data"] = null,
                    ["enc"] = null,
                    ["status"] = JobStatus.Printing,
                    ["message"] = "Waiting for the printer",
                    ["updatedAt"] = RtdbClient.ServerTimestamp(),
                }, ct);
            }
            catch (CloudException ex) when (ex.HttpStatus is null && !ct.IsCancellationRequested)
            {
                // Timeout or dropped connection: the claim may have reached Firebase anyway.
                if (!await ClaimLandedAsync(path, ct))
                    throw;
                Log.Info($"Cloud: {label}: the claim went through although the request failed ({ex.Message})");
            }
            claimed = true;

            var local = _jobs.Enqueue(localId, orderId, media!, finish!, (int)copies, Bool(job, "reprint"), file);
            file = null; // owned by the print queue now
            _tracked[local.JobId] = new TrackedJob(path, label, boothId, cloudId, isTest: false) { SentStatus = JobStatus.Printing, SentMessage = "Waiting for the printer" };
            Log.Info($"Cloud: {label} → local job {local.JobId}, {media!.Key}|{finish}, {copies} cop{(copies == 1 ? "y" : "ies")}");
            SetLastJob($"{label}: printing");
            _jobsChanged.Set();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            if (!claimed)
                _handled.TryRemove($"job:{boothId}/{cloudId}", out _); // the next session picks it up again
        }
        catch (Exception ex)
        {
            if (!claimed)
                _handled.TryRemove($"job:{boothId}/{cloudId}", out _); // retried by the sweep or on the next reconnect
            if (ex is CloudException)
                Log.Warn($"Cloud: {label} could not be started: {ex.Message}");
            else
                Log.Error($"Cloud: {label} failed", ex);
            SetProblem("jobs", Friendly(ex));
            if (claimed)
                await TryFailClaimedAsync(mirror, cloudId, path, label, ct);
        }
        finally
        {
            if (file is not null)
                TryDelete(file);
        }
    }

    /// <summary>A job claimed ("printing") that could not be queued must not stay "printing" in the cloud.</summary>
    private async Task TryFailClaimedAsync(RtdbMirror mirror, string key, string path, string label, CancellationToken ct)
    {
        try
        {
            await FailJobAsync(mirror, key, path, label, "Printing could not start on the print PC – see the bridge log", clearData: false, ct);
        }
        catch (Exception ex) when (ex is CloudException or CloudIdentityLostException or OperationCanceledException)
        {
            Log.Warn($"Cloud: could not mark {label} as failed: {ex.Message}");
        }
    }

    /// <summary>
    /// After an ambiguous claim failure: true when Firebase shows the job claimed ("printing"), false when it
    /// is still queued or gone. Throws when it cannot be asked.
    /// </summary>
    private async Task<bool> ClaimLandedAsync(string path, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                var status = await _db.GetAsync($"{path}/status", ct);
                return status is JsonValue v && v.TryGetValue<string>(out var s) && s == JobStatus.Printing;
            }
            catch (CloudException ex) when (attempt < 3 && !ex.IsPermissionDenied)
            {
                await DelayAsync(TimeSpan.FromSeconds(2 * attempt), ct);
            }
        }
    }

    /// <summary>Marks a job/test print as failed – unless the kiosk/admin already deleted it (no ghost nodes).</summary>
    private async Task FailJobAsync(RtdbMirror mirror, string key, string path, string label, string message, bool clearData, CancellationToken ct)
    {
        if (mirror.Loaded && !mirror.Contains(key))
        {
            Log.Info($"Cloud: {label} was deleted in the cloud; not marking it as failed ({message})");
            return;
        }
        var body = new JsonObject
        {
            ["status"] = JobStatus.Error,
            ["message"] = message,
            ["updatedAt"] = RtdbClient.ServerTimestamp(),
        };
        if (clearData)
        {
            body["data"] = null;
            body["enc"] = null;
        }
        await _db.PatchAsync(path, body, ct);
        Log.Warn($"Cloud: {label} → error: {message}");
        SetLastJob($"{label}: error – {message}");
    }

    // ---------------------------------------------------------------- test prints

    private void OnTestPrintsChanged(string boothId, RtdbMirror mirror, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        CheckOrphansOnce(boothId, "testPrints", "test", mirror, ct);
        foreach (var key in keys)
        {
            var handledKey = $"test:{boothId}/{key}";
            if (_handled.ContainsKey(handledKey))
                continue;
            var test = mirror.Get(key);
            if (test is null || Str(test, "status") != JobStatus.Queued)
                continue;
            if (_handled.TryAdd(handledKey, 0))
                _ = Task.Run(() => HandleTestPrintAsync(boothId, key, test, mirror, ct), CancellationToken.None);
        }
    }

    private async Task HandleTestPrintAsync(string boothId, string cloudId, JsonObject test, RtdbMirror mirror, CancellationToken ct)
    {
        var path = RtdbClient.Path("booths", boothId, "testPrints", cloudId);
        var label = $"Test print {cloudId}";
        var claimed = false;
        try
        {
            if (IsTooOld(test))
            {
                await FailJobAsync(mirror, cloudId, path, label, "Expired", clearData: false, ct);
                return;
            }
            var media = MediaCatalog.Find(Str(test, "media") ?? "4x6");
            var finish = MediaCatalog.NormalizeFinish(Str(test, "finish") ?? "gloss");
            if (media is null || finish is null)
            {
                await FailJobAsync(mirror, cloudId, path, label, media is null ? "media must be one of 4x6, 2x6, 3.5x5, 5x7, 6x8" : "finish must be gloss or matte",
                    clearData: false, ct);
                return;
            }

            await _db.PatchAsync(path, new JsonObject
            {
                ["status"] = JobStatus.Printing,
                ["message"] = "Waiting for the printer",
                ["updatedAt"] = RtdbClient.ServerTimestamp(),
            }, ct);
            claimed = true;

            PrintJob local;
            try
            {
                local = _jobs.EnqueueTestSheet(media, finish);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Runtime.InteropServices.ExternalException)
            {
                Log.Warn($"Cloud: {label}: test sheet could not be created: {ex.Message}");
                await FailJobAsync(mirror, cloudId, path, label, $"Could not create the test sheet: {ex.Message}", clearData: false, ct);
                return;
            }
            _tracked[local.JobId] = new TrackedJob(path, label, boothId, cloudId, isTest: true) { SentStatus = JobStatus.Printing, SentMessage = "Waiting for the printer" };
            Log.Info($"Cloud: {label} → local job {local.JobId}, {media.Key}|{finish}");
            SetLastJob($"{label}: printing");
            _jobsChanged.Set();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            if (!claimed)
                _handled.TryRemove($"test:{boothId}/{cloudId}", out _);
        }
        catch (Exception ex)
        {
            if (!claimed)
                _handled.TryRemove($"test:{boothId}/{cloudId}", out _);
            Log.Warn($"Cloud: {label} could not be started: {ex.Message}");
            SetProblem("testPrints", Friendly(ex));
            if (claimed)
                await TryFailClaimedAsync(mirror, cloudId, path, label, ct);
        }
    }

    // ---------------------------------------------------------------- job status → cloud

    /// <summary>Mirrors the local print queue's status changes back to the cloud jobs/testPrints.</summary>
    private async Task MirrorJobStatusLoopAsync(string boothId, RtdbMirror jobs, RtdbMirror tests, CancellationToken ct)
    {
        while (true)
        {
            await _jobsChanged.WaitAsync(TimeSpan.FromSeconds(2), ct);
            foreach (var (localId, tracked) in _tracked)
            {
                var job = _jobs.Get(localId);
                if (job is null || tracked.BoothId != boothId)
                {
                    _tracked.TryRemove(localId, out _);
                    continue;
                }

                var s = job.Snapshot();
                // A job waiting behind another one is still "printing" for the kiosk.
                var (status, message) = s.Status == JobStatus.Queued ? (JobStatus.Printing, "Waiting for the printer") : (s.Status, s.Message);
                if (status != tracked.SentStatus || message != tracked.SentMessage)
                {
                    var mirror = tracked.IsTest ? tests : jobs;
                    if (!mirror.Loaded)
                        continue; // not synced yet after a reconnect
                    if (!mirror.Contains(tracked.Key))
                    {
                        // Deleted by the kiosk/admin: a PATCH would re-create it as a ghost node.
                        Log.Info($"Cloud: {tracked.Label} was deleted in the cloud; no more status updates ({status})");
                        _tracked.TryRemove(localId, out _);
                        continue;
                    }
                    try
                    {
                        await _db.PatchAsync(tracked.Path, new JsonObject
                        {
                            ["status"] = status,
                            ["message"] = message,
                            ["updatedAt"] = RtdbClient.ServerTimestamp(),
                        }, ct);
                    }
                    catch (CloudException ex)
                    {
                        Log.Warn($"Cloud: could not update {tracked.Label}: {ex.Message}");
                        if (ex.IsPermissionDenied)
                            _tracked.TryRemove(localId, out _); // no longer ours to update
                        else
                            SetProblem("jobs", ex.Message);
                        continue; // other jobs still get their updates; this one is retried on the next tick
                    }
                    tracked.SentStatus = status;
                    tracked.SentMessage = message;
                    ClearProblem("jobs");
                    Log.Info($"Cloud: {tracked.Label} → {status} ({message})");
                    SetLastJob($"{tracked.Label}: {status} – {message}");
                }

                // "error" is not final while the job is still in the Windows spooler (up to 5 minutes).
                if (status == JobStatus.Done || (status == JobStatus.Error && DateTimeOffset.UtcNow - s.UpdatedAt > SpoolerGrace))
                    _tracked.TryRemove(localId, out _);
            }
        }
    }

    // ---------------------------------------------------------------- payments

    private void OnPaymentsChanged(string boothId, RtdbMirror mirror, IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        foreach (var orderId in keys)
        {
            var workerKey = $"{boothId}/{orderId}";
            var payment = mirror.Get(orderId);
            if (_paymentWorkers.TryGetValue(workerKey, out var running))
            {
                running.Signal.Set();
                if (payment is null || RequestKey(payment) == running.RequestKey)
                    continue;
            }
            if (payment is null || Str(payment, "state") is not ("requested" or "pending" or "cancel" or "error"))
                continue;

            var requestKey = RequestKey(payment);
            if (!_handled.TryAdd($"pay:{workerKey}|{requestKey}", 0))
                continue;
            var worker = new PaymentWorker(requestKey);
            _paymentWorkers[workerKey] = worker;
            _ = Task.Run(async () =>
            {
                try
                {
                    await RunPaymentAsync(boothId, orderId, mirror, worker, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    _handled.TryRemove($"pay:{workerKey}|{requestKey}", out _); // the next session resumes it
                }
                catch (Exception ex)
                {
                    _handled.TryRemove($"pay:{workerKey}|{requestKey}", out _);
                    Log.Error($"Cloud: payment for order {orderId} failed", ex);
                    SetProblem("payments", Friendly(ex));
                }
                finally
                {
                    _paymentWorkers.TryRemove(new KeyValuePair<string, PaymentWorker>(workerKey, worker));
                }
            }, CancellationToken.None);
        }
    }

    /// <summary>A kiosk request is identified by its order id and createdAt.</summary>
    private static string RequestKey(JsonObject payment) => (Num(payment, "createdAt") ?? 0).ToString();

    private async Task RunPaymentAsync(string boothId, string orderId, RtdbMirror mirror, PaymentWorker worker, CancellationToken ct)
    {
        var path = RtdbClient.Path("booths", boothId, "payments", orderId);
        var p = mirror.Get(orderId);
        if (p is null)
            return;

        var amount = Num(p, "amount");
        var description = Str(p, "description")?.Trim();
        description = string.IsNullOrEmpty(description) ? $"Order {orderId}" : description.Length > MaxDescriptionLength ? description[..MaxDescriptionLength] : description;
        var label = $"Order {orderId}" + (amount is { } a ? $" {PaymentService.FormatRupees(a)}" : string.Empty);
        QrSession? session = null;
        var cancelRequested = false;
        string? errorShown = null;

        var published = false; // the QR of this session is written to the request
        // A QR created before a restart (state pending/cancel/error with a qrId): keep checking it.
        if (Str(p, "qrId") is { Length: > 0 } qrId && Str(p, "state") != "requested")
        {
            var cancelled = Str(p, "state") == "cancel";
            var known = _payments.Find(qrId);
            if (known is not null && known.OrderId != orderId)
            {
                // Resuming is for the same order only: another order's QR (maybe paid) must never settle this one.
                Log.Warn($"Cloud: {label}: QR {qrId} belongs to order {known.OrderId}; not resuming it");
                await PatchPaymentAsync(path, label, cancelled
                    ? new JsonObject { ["state"] = "closed", ["message"] = null }
                    : new JsonObject { ["state"] = "error", ["message"] = "This payment points to the QR code of another order. Start the payment again." },
                    ct);
                return;
            }

            var expiresAt = Num(p, "expiresAt") is { } ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : DateTimeOffset.UtcNow;
            session = known ?? _payments.Resume(qrId, orderId, amount ?? 0, description, expiresAt, Str(p, "upiString"));
            if (session is null)
            {
                const string unknownQr = "The payment provider on the print PC changed; this QR cannot be checked. Check the payment dashboard.";
                if (Num(p, "expiresAt") is { } exp && ServerNow > exp)
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "expired", ["message"] = null }, ct);
                else if (cancelled)
                    await PatchPaymentAsync(path, label, new JsonObject { ["message"] = unknownQr }, ct); // "error" may not replace "cancel"
                else
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "error", ["message"] = unknownQr }, ct);
                return;
            }
            published = true;
        }

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            p = mirror.Get(orderId);
            if (p is null || RequestKey(p) != worker.RequestKey)
            {
                // Deleted or replaced by a new request: close this QR so it cannot be paid any more.
                if (session is not null && !session.IsFinal)
                {
                    await _payments.CloseAsync(session.QrId, ct);
                    if (session.Status == QrStatus.Paid)
                        Log.Warn($"Cloud: {label}: QR {session.QrId} was paid but the request was replaced; reconcile with the payment dashboard");
                }
                return;
            }

            var state = Str(p, "state");
            if (state is "paid" or "expired" or "closed")
                return;
            cancelRequested |= state == "cancel";

            if (cancelRequested)
            {
                if (session is null)
                {
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "closed", ["message"] = null }, ct);
                    return;
                }
                await _payments.CloseAsync(session.QrId, ct);
                var closed = session.Snapshot();
                if (closed.Status == QrStatus.Paid)
                {
                    await PatchPaidAsync(path, label, closed, ct);
                    return;
                }
                if (closed.Status is QrStatus.Closed or QrStatus.Expired)
                {
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "closed", ["message"] = null }, ct);
                    return;
                }
                // Only closed/paid/expired may replace "cancel": show the problem in message, keep the state.
                errorShown = await ShowPaymentErrorAsync(path, label, closed.Message ?? "Could not close the QR", errorShown, ct, keepState: true);
                await WaitAsync(worker, mirror, orderId, PaymentRetryDelay, returnOnCancel: false, ct);
                continue;
            }

            if (session is null)
            {
                if (IsTooOld(p))
                {
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "expired", ["message"] = "Expired" }, ct);
                    return;
                }
                if (amount is not { } paise || paise < PaymentService.MinAmount || paise > PaymentService.MaxAmount)
                {
                    if (await PatchPaymentAsync(path, label, new JsonObject
                        {
                            ["state"] = "error",
                            ["message"] = $"amount must be whole paise between {PaymentService.MinAmount} and {PaymentService.MaxAmount}",
                        }, ct))
                        return;
                    await WaitAsync(worker, mirror, orderId, PaymentRetryDelay, returnOnCancel: true, ct); // refused: cancelled meanwhile?
                    continue;
                }

                try
                {
                    session = await _payments.CreateAsync(orderId, paise, description, ct);
                }
                catch (PaymentNotAvailableException ex)
                {
                    var message = _payments.Status.Provider == "none" ? "Payments are not set up on the print PC" : $"Payments are not ready on the print PC: {ex.Message}";
                    errorShown = await ShowPaymentErrorAsync(path, label, message, errorShown, ct);
                    await WaitAsync(worker, mirror, orderId, PaymentRetryDelay, returnOnCancel: true, ct);
                    continue;
                }
                catch (PaymentException ex)
                {
                    errorShown = await ShowPaymentErrorAsync(path, label, ex.Message, errorShown, ct);
                    await WaitAsync(worker, mirror, orderId, PaymentRetryDelay, returnOnCancel: true, ct);
                    continue;
                }

                // The kiosk may have cancelled (or replaced the request) while the QR was being created: then the
                // loop closes the QR (reporting "paid" if money already arrived) instead of showing it.
                p = mirror.Get(orderId);
                if (p is null || RequestKey(p) != worker.RequestKey || Str(p, "state") == "cancel")
                {
                    Log.Info($"Cloud: {label}: cancelled while QR {session.QrId} was being created; closing it");
                    continue;
                }
                if (await PatchPaymentAsync(path, label, PendingBody(session), ct))
                {
                    published = true;
                    errorShown = null;
                }
                continue; // refused: the loop re-reads the state (normally the kiosk's "cancel")
            }

            await _payments.GetAsync(session.QrId, ct); // checks the gateway at most every 2 s
            var s = session.Snapshot();
            switch (s.Status)
            {
                case QrStatus.Paid:
                    await PatchPaidAsync(path, label, s, ct);
                    return;
                case QrStatus.Expired:
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "expired", ["message"] = null }, ct);
                    return;
                case QrStatus.Closed:
                    await PatchPaymentAsync(path, label, new JsonObject { ["state"] = "closed", ["message"] = null }, ct);
                    return;
                case QrStatus.Error:
                    errorShown = await ShowPaymentErrorAsync(path, label, s.Message ?? "Payment status unknown", errorShown, ct);
                    break;
                default:
                    if (!published || errorShown is not null)
                    {
                        var body = published ? new JsonObject { ["state"] = "pending", ["message"] = null } : PendingBody(session);
                        if (await PatchPaymentAsync(path, label, body, ct))
                        {
                            published = true;
                            errorShown = null;
                        }
                    }
                    break;
            }
            await WaitAsync(worker, mirror, orderId, PaymentPollInterval, returnOnCancel: true, ct);
        }
    }

    private static JsonObject PendingBody(QrSession session) => new()
    {
        ["state"] = "pending",
        ["qrId"] = session.QrId,
        ["upiString"] = session.UpiString,
        ["imagePng"] = Convert.ToBase64String(session.ImagePng),
        ["expiresAt"] = session.ExpiresAt.ToUnixTimeMilliseconds(),
        ["message"] = null,
    };

    /// <summary>
    /// Shows a payment problem to the kiosk (state "error", or only the message with <paramref name="keepState"/>).
    /// Returns the message now shown; unchanged when the rules refused the write.
    /// </summary>
    private async Task<string?> ShowPaymentErrorAsync(string path, string label, string message, string? shown, CancellationToken ct, bool keepState = false)
    {
        if (message == shown)
            return shown;
        var body = keepState ? new JsonObject { ["message"] = message } : new JsonObject { ["state"] = "error", ["message"] = message };
        return await PatchPaymentAsync(path, label, body, ct) ? message : shown;
    }

    private Task PatchPaidAsync(string path, string label, QrSessionSnapshot s, CancellationToken ct) =>
        PatchPaymentAsync(path, label, new JsonObject
        {
            ["state"] = "paid",
            ["paymentId"] = s.PaymentId,
            ["payerVpa"] = s.PayerVpa,
            ["message"] = null,
        }, ct);

    /// <summary>
    /// Writes a payment update, retrying until it reaches Firebase (a "paid" must never be lost). Returns false
    /// without retrying when the security rules refuse it – e.g. "pending"/"error" over the kiosk's "cancel" –
    /// so the caller re-reads the state instead of looping. A refused "paid" keeps being retried.
    /// </summary>
    private async Task<bool> PatchPaymentAsync(string path, string label, JsonObject body, CancellationToken ct)
    {
        body["updatedAt"] = RtdbClient.ServerTimestamp();
        var state = Str(body, "state");
        var backoff = new Backoff();
        while (true)
        {
            try
            {
                await _db.PatchAsync(path, (JsonObject)body.DeepClone(), ct);
                ClearProblem("payments");
                break;
            }
            catch (CloudException ex) when (ex.IsPermissionDenied && state != "paid")
            {
                Log.Warn($"Cloud: {label}: Firebase refused writing {state ?? "the message"} (the kiosk probably cancelled); re-checking the request");
                return false;
            }
            catch (CloudException ex)
            {
                SetProblem("payments", ex.Message);
                Log.Warn($"Cloud: {label}: could not write payment state: {ex.Message}");
                await DelayAsync(backoff.Next(), ct);
            }
        }

        var detail = state switch
        {
            "pending" => $"pending, QR {Str(body, "qrId")}",
            "paid" => $"paid, payment {Str(body, "paymentId")}",
            "error" => $"error – {Str(body, "message")}",
            null => $"message – {Str(body, "message")}",
            _ => state,
        };
        Log.Info($"Cloud: {label} → {detail}");
        SetLastPayment($"{label}: {detail}");
        return true;
    }

    /// <summary>Waits for the delay, returning early (also right away) when the kiosk cancels or replaces the request.</summary>
    private static async Task WaitAsync(PaymentWorker worker, RtdbMirror mirror, string orderId, TimeSpan delay, bool returnOnCancel, CancellationToken ct)
    {
        var until = DateTime.UtcNow + delay;
        while (true)
        {
            var p = mirror.Get(orderId);
            if (p is null || RequestKey(p) != worker.RequestKey || (returnOnCancel && Str(p, "state") == "cancel"))
                return;
            if (DateTime.UtcNow >= until)
                return;
            await worker.Signal.WaitAsync(until - DateTime.UtcNow, ct);
        }
    }

    // ---------------------------------------------------------------- status

    private void SetPhase(CloudPhase phase)
    {
        lock (_statusGate)
        {
            _phase = phase;
            if (phase != CloudPhase.Error)
                _error = null;
            if (phase == CloudPhase.Off)
            {
                _pairingCode = null;
                _boothId = null;
            }
            else if (phase != CloudPhase.Pairing)
            {
                _pairingCode = null;
            }
        }
        RaiseStatusChanged();
    }

    private void SetError(string message)
    {
        lock (_statusGate)
        {
            _phase = CloudPhase.Error;
            _error = message;
        }
        RaiseStatusChanged();
    }

    private void SetProblem(string source, string message)
    {
        if (_problems.TryGetValue(source, out var existing) && existing == message)
            return;
        _problems[source] = message;
        RaiseStatusChanged();
    }

    private void ClearProblem(string source)
    {
        if (_problems.TryRemove(source, out _))
            RaiseStatusChanged();
    }

    private void SetLastJob(string text)
    {
        lock (_statusGate)
            _lastJob = $"{DateTime.Now:HH:mm:ss}  {text}";
        RaiseStatusChanged();
    }

    private void SetLastPayment(string text)
    {
        lock (_statusGate)
            _lastPayment = $"{DateTime.Now:HH:mm:ss}  {text}";
        RaiseStatusChanged();
    }

    private void RaiseStatusChanged()
    {
        try
        {
            StatusChanged?.Invoke();
        }
        catch (Exception ex)
        {
            Log.Warn($"Cloud: status listener failed: {ex.Message}");
        }
    }

    private static string Friendly(Exception ex) => ex switch
    {
        CloudException or TimeoutException or CloudIdentityLostException or PaymentException or BridgeKeyMismatchException => ex.Message,
        _ => "Unexpected error – see the bridge log",
    };

    // ---------------------------------------------------------------- helpers

    private static string? Str(JsonObject? o, string name) =>
        o?[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static long? Num(JsonObject? o, string name)
    {
        if (o?[name] is not JsonValue v)
            return null;
        if (v.TryGetValue<long>(out var l))
            return l;
        if (v.TryGetValue<double>(out var d) && double.IsFinite(d) && d == Math.Floor(d))
            return (long)d;
        return null;
    }

    private static bool Bool(JsonObject? o, string name) =>
        o?[name] is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    private static async Task DelayAsync(TimeSpan delay, CancellationToken ct) => await Task.Delay(delay, ct);

    private static async Task IgnoreCancellation(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            // Observed by the caller through Task.WhenAny when it matters.
        }
    }

    private static void TryDelete(string file)
    {
        try
        {
            File.Delete(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not delete {System.IO.Path.GetFileName(file)}: {ex.Message}");
        }
    }

    public async ValueTask DisposeAsync()
    {
        _jobs.JobsChanged -= _jobsChanged.Set;
        if (await _lifecycle.WaitAsync(DisposeTimeout).ConfigureAwait(false))
        {
            try
            {
                await StopCoreAsync().ConfigureAwait(false);
            }
            finally
            {
                _lifecycle.Release();
            }
        }
        else
        {
            // A pairing/restart is stuck: stop the connector without waiting for it so the app can exit.
            Log.Warn("Cloud: a connector restart did not finish in time; stopping anyway");
            try
            {
                _runCts?.Cancel();
            }
            catch (ObjectDisposedException)
            {
            }
        }
        _crypto?.Dispose();
        _http.Dispose();
        _streamHttp.Dispose();
    }

    private sealed class TrackedJob(string path, string label, string boothId, string key, bool isTest)
    {
        public string Path { get; } = path;
        public string Label { get; } = label;
        public string BoothId { get; } = boothId;
        /// <summary>Key under /jobs or /testPrints.</summary>
        public string Key { get; } = key;
        public bool IsTest { get; } = isTest;
        public string? SentStatus { get; set; }
        public string? SentMessage { get; set; }
    }

    private sealed class PaymentWorker(string requestKey)
    {
        public string RequestKey { get; } = requestKey;
        public AsyncSignal Signal { get; } = new();
    }
}

/// <summary>
/// The booth's pinned bridge/publicKey is another key than this PC's (docs/CLOUD_API.md): the connector stops
/// working on the booth – it must not fail or delete jobs made for that key – until this PC is paired again.
/// </summary>
public sealed class BridgeKeyMismatchException() : Exception(Text)
{
    public const string Text = "This booth is linked to another Print PC key – pair this PC again from the dashboard";
}

/// <summary>Auto-reset signal for async loops.</summary>
internal sealed class AsyncSignal
{
    private readonly SemaphoreSlim _semaphore = new(0, 1);

    public void Set()
    {
        try
        {
            _semaphore.Release();
        }
        catch (SemaphoreFullException)
        {
        }
    }

    public Task<bool> WaitAsync(TimeSpan timeout, CancellationToken ct) =>
        _semaphore.WaitAsync(timeout <= TimeSpan.Zero ? TimeSpan.Zero : timeout, ct);
}

/// <summary>Reconnect delay: 1 s doubling to 60 s, with jitter.</summary>
internal sealed class Backoff
{
    private int _attempt;

    public TimeSpan Next()
    {
        var seconds = Math.Min(60, Math.Pow(2, Math.Min(_attempt++, 6)));
        return TimeSpan.FromSeconds(seconds * (0.8 + Random.Shared.NextDouble() * 0.4));
    }

    public void Reset() => _attempt = 0;
}
