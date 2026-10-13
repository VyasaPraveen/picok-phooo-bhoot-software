using System.Collections.Concurrent;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Payments;

public sealed record PaymentsStatus(string Provider, bool Ready, string Message);

/// <summary>
/// Owns the active payment provider and all QR sessions (in memory). Upstream status checks are
/// rate-limited to one every 2 s per QR; the tablet's polling is answered from the cached result.
/// </summary>
public sealed class PaymentService : IDisposable
{
    public const long MinAmount = 100;           // ₹1
    public const long MaxAmount = 10_000_000;    // ₹1,00,000 (UPI per-transaction ceiling)
    private const int RazorpayMinTimeoutSeconds = 180;
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    private readonly SettingsStore _settings;
    private readonly SimulatorProvider _simulator;
    private readonly ConcurrentDictionary<string, QrSession> _sessions = new(StringComparer.Ordinal);
    private readonly System.Threading.Timer _sweeper;
    private readonly object _providerGate = new();
    private IPaymentProvider? _provider;
    private PaymentsStatus _status = new("none", false, "Payments disabled");

    public PaymentService(SettingsStore settings)
    {
        _settings = settings;
        _simulator = new SimulatorProvider(() => _settings.Snapshot().Payments.SimulatorAutoPaySeconds);
        ReloadProvider();
        _sweeper = new System.Threading.Timer(_ => _ = SweepAsync(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
    }

    public event Action? SessionsChanged;

    public PaymentsStatus Status
    {
        get { lock (_providerGate) return _status; }
    }

    /// <summary>Re-reads the provider settings. Existing QR sessions keep the provider that created them.</summary>
    public void ReloadProvider()
    {
        var p = _settings.Snapshot().Payments;
        lock (_providerGate)
        {
            switch (p.Provider)
            {
                case PaymentProviders.Simulator:
                    _provider = _simulator;
                    var auto = p.SimulatorAutoPaySeconds > 0 ? $"auto-pays after {p.SimulatorAutoPaySeconds} s" : "manual \"Mark paid\" only";
                    _status = new PaymentsStatus("simulator", true, $"Simulator – test payments, {auto}");
                    break;
                case PaymentProviders.Razorpay:
                    var secret = SecretProtector.Unprotect(p.RazorpayKeySecretProtected);
                    if (string.IsNullOrEmpty(p.RazorpayKeyId) || string.IsNullOrEmpty(secret))
                    {
                        _provider = null;
                        _status = new PaymentsStatus("razorpay", false,
                            string.IsNullOrEmpty(p.RazorpayKeySecretProtected) || string.IsNullOrEmpty(p.RazorpayKeyId)
                                ? "Razorpay keys not set"
                                : "Razorpay key secret could not be decrypted – enter it again");
                    }
                    else
                    {
                        _provider = new RazorpayProvider(p.RazorpayKeyId, secret);
                        var mode = p.RazorpayKeyId.StartsWith("rzp_live_", StringComparison.Ordinal) ? "live" :
                                   p.RazorpayKeyId.StartsWith("rzp_test_", StringComparison.Ordinal) ? "test" : "custom";
                        _status = new PaymentsStatus("razorpay", true, $"Razorpay {mode} keys");
                    }
                    break;
                default:
                    _provider = null;
                    _status = new PaymentsStatus("none", false, "Payments disabled");
                    break;
            }
        }
    }

    public async Task<QrSession> CreateAsync(string orderId, long amount, string description, CancellationToken ct)
    {
        IPaymentProvider provider;
        lock (_providerGate)
            provider = _provider ?? throw new PaymentNotAvailableException(_status.Message);

        var p = _settings.Snapshot().Payments;
        var timeout = provider is RazorpayProvider ? Math.Max(p.QrTimeoutSeconds, RazorpayMinTimeoutSeconds) : p.QrTimeoutSeconds;
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(timeout);
        expiresAt = DateTimeOffset.FromUnixTimeSeconds(expiresAt.ToUnixTimeSeconds());

        var created = await provider.CreateQrAsync(new QrCreateRequest(orderId, amount, description, p.BusinessName, expiresAt), ct);
        var session = new QrSession(provider, created.QrId, orderId, amount, description, expiresAt, created.UpiString, created.ImagePng);
        _sessions[session.QrId] = session;
        Log.Info($"QR created: {session.QrId} ({provider.Name}) order {orderId}, amount {FormatRupees(amount)}, expires {expiresAt:O}");
        SessionsChanged?.Invoke();
        return session;
    }

    /// <summary>
    /// Re-attaches a QR created before the bridge restarted (cloud mode keeps its id in the database), so
    /// its payment can still be checked and closed. Returns null when the current provider did not create it.
    /// </summary>
    public QrSession? Resume(string qrId, string orderId, long amount, string description, DateTimeOffset expiresAt, string? upiString)
    {
        if (Find(qrId) is { } existing)
            return existing;

        IPaymentProvider? provider;
        lock (_providerGate)
            provider = _provider;
        var simulatorQr = qrId.StartsWith("qr_sim_", StringComparison.Ordinal);
        if (provider is null || (provider is SimulatorProvider) != simulatorQr)
            return null;

        var image = upiString is null ? [] : QrImage.Png(upiString);
        var session = new QrSession(provider, qrId, orderId, amount, description, expiresAt, upiString, image);
        session = _sessions.GetOrAdd(qrId, session);
        Log.Info($"QR resumed after restart: {qrId} ({provider.Name}) order {orderId}, amount {FormatRupees(amount)}, expires {expiresAt:O}");
        SessionsChanged?.Invoke();
        return session;
    }

    public QrSession? Find(string qrId) => _sessions.TryGetValue(qrId, out var s) ? s : null;

    /// <summary>Returns the session, refreshing it from the gateway at most once every 2 s.</summary>
    public async Task<QrSession?> GetAsync(string qrId, CancellationToken ct)
    {
        var session = Find(qrId);
        if (session is null)
            return null;
        await RefreshAsync(session, force: false, ct);
        return session;
    }

    /// <summary>Closes the QR. Checks for a payment before and after closing; a paid QR stays paid.</summary>
    public async Task<QrSession?> CloseAsync(string qrId, CancellationToken ct)
    {
        var session = Find(qrId);
        if (session is null)
            return null;

        await session.Gate.WaitAsync(ct);
        try
        {
            if (session.IsFinal)
                return session;

            if (await TryCheckAsync(session, ct) is { Paid: true } before)
            {
                SetPaid(session, before);
                return session;
            }

            try
            {
                await session.Provider.CloseAsync(session, ct);
            }
            catch (PaymentException ex)
            {
                Log.Warn($"QR {session.QrId}: close request failed: {ex.Message}");
            }

            var after = await TryCheckAsync(session, ct);
            if (after is { Paid: true })
            {
                SetPaid(session, after);
            }
            else if (after is null)
            {
                session.SetStatus(QrStatus.Error, "Could not confirm the payment status – check the payment dashboard");
                Log.Warn($"QR {session.QrId}: close could not confirm payment status");
            }
            else
            {
                session.SetStatus(QrStatus.Closed);
                Log.Info($"QR closed: {session.QrId} order {session.OrderId}, amount {FormatRupees(session.Amount)}, no payment");
            }
            SessionsChanged?.Invoke();
            return session;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    /// <summary>Operator "Mark paid" for simulator QRs.</summary>
    public async Task<bool> MarkSimulatorPaidAsync(string qrId)
    {
        var session = Find(qrId);
        if (session is null || session.Provider is not SimulatorProvider || session.IsFinal || !_simulator.MarkPaid(qrId))
            return false;
        await RefreshAsync(session, force: true, CancellationToken.None);
        return true;
    }

    public IReadOnlyList<QrSessionSnapshot> Recent() =>
        _sessions.Values.Select(s => s.Snapshot()).OrderByDescending(s => s.CreatedAt).ToList();

    private async Task RefreshAsync(QrSession session, bool force, CancellationToken ct)
    {
        if (session.IsFinal || (!force && DateTimeOffset.UtcNow - session.LastCheckedAt < CheckInterval))
            return;

        await session.Gate.WaitAsync(ct);
        try
        {
            if (session.IsFinal || (!force && DateTimeOffset.UtcNow - session.LastCheckedAt < CheckInterval))
                return;

            var check = await TryCheckAsync(session, ct);
            var expired = DateTimeOffset.UtcNow >= session.ExpiresAt;
            var before = session.Snapshot();

            if (check is { Paid: true })
            {
                SetPaid(session, check);
            }
            else if (check is null)
            {
                if (expired)
                    session.SetStatus(QrStatus.Error, "Could not confirm the payment status – check the payment dashboard");
                else
                    session.SetMessage("Payment gateway not reachable, retrying");
            }
            else if (expired)
            {
                session.SetStatus(QrStatus.Expired);
                Log.Info($"QR expired: {session.QrId} order {session.OrderId}, amount {FormatRupees(session.Amount)}, no payment");
            }
            else
            {
                session.SetStatus(QrStatus.Pending);
            }

            if (session.Snapshot() != before)
                SessionsChanged?.Invoke();
        }
        finally
        {
            session.Gate.Release();
        }
    }

    /// <summary>One gateway check; null when the gateway could not be asked.</summary>
    private static async Task<PaymentCheck?> TryCheckAsync(QrSession session, CancellationToken ct)
    {
        try
        {
            return await session.Provider.CheckAsync(session, ct);
        }
        catch (PaymentException ex)
        {
            Log.Warn($"QR {session.QrId}: payment check failed: {ex.Message}");
            return null;
        }
        finally
        {
            session.LastCheckedAt = DateTimeOffset.UtcNow;
        }
    }

    private void SetPaid(QrSession session, PaymentCheck check)
    {
        session.MarkPaid(check);
        Log.Info($"QR paid: {session.QrId} order {session.OrderId}, payment {check.PaymentId}, amount {FormatRupees(check.AmountPaid ?? session.Amount)}" +
                 (check.PayerVpa is null ? string.Empty : $", payer {check.PayerVpa}"));
        SessionsChanged?.Invoke();
    }

    /// <summary>Expires pending QRs nobody is polling any more and drops sessions older than 24 h.</summary>
    private async Task SweepAsync()
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var session in _sessions.Values)
            {
                if (!session.IsFinal && now >= session.ExpiresAt)
                    await RefreshAsync(session, force: false, CancellationToken.None);

                if (now - session.CreatedAt > Retention && _sessions.TryRemove(session.QrId, out _))
                {
                    _simulator.Forget(session.QrId);
                    SessionsChanged?.Invoke();
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error("Payment sweep failed", ex);
        }
    }

    public static string FormatRupees(long paise) => $"₹{paise / 100m:0.00} ({paise} paise)";

    public void Dispose() => _sweeper.Dispose();
}

public sealed class PaymentNotAvailableException(string message) : Exception(message);
