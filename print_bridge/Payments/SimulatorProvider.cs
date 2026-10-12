using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;

namespace Epixs.PrintBridge.Payments;

/// <summary>
/// Fake gateway for demos and testing. A QR becomes paid after the configured auto-pay delay,
/// or when the operator clicks "Mark paid" in the Payments tab.
/// </summary>
public sealed class SimulatorProvider : IPaymentProvider
{
    private const string Alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private readonly ConcurrentDictionary<string, SimulatedQr> _qrs = new(StringComparer.Ordinal);
    private readonly Func<int> _autoPaySeconds;

    public SimulatorProvider(Func<int> autoPaySeconds) => _autoPaySeconds = autoPaySeconds;

    public string Name => "simulator";

    public Task<QrCreated> CreateQrAsync(QrCreateRequest request, CancellationToken ct)
    {
        var qrId = "qr_sim_" + RandomNumberGenerator.GetString(Alphabet, 14);
        var rupees = (request.Amount / 100m).ToString("0.00", CultureInfo.InvariantCulture);
        var upi = $"upi://pay?pa=simulator@epixs&pn={Uri.EscapeDataString(request.BusinessName)}&am={rupees}" +
                  $"&tn={Uri.EscapeDataString(request.Description)}&tr={qrId}";

        var autoPay = _autoPaySeconds();
        _qrs[qrId] = new SimulatedQr(request.Amount, autoPay > 0 ? DateTimeOffset.UtcNow.AddSeconds(autoPay) : null);
        return Task.FromResult(new QrCreated(qrId, upi, QrImage.Png(upi)));
    }

    public Task<PaymentCheck> CheckAsync(QrSession session, CancellationToken ct)
    {
        if (!_qrs.TryGetValue(session.QrId, out var qr))
            return Task.FromResult(PaymentCheck.NotPaid);

        lock (qr)
        {
            if (!qr.Closed && (qr.ManuallyPaid || (qr.AutoPayAt is { } at && DateTimeOffset.UtcNow >= at)))
            {
                qr.PaymentId ??= "sim_pay_" + RandomNumberGenerator.GetString(Alphabet, 14);
                return Task.FromResult(new PaymentCheck(true, qr.PaymentId, "upi", "customer@simulator", qr.Amount));
            }
        }
        return Task.FromResult(PaymentCheck.NotPaid);
    }

    public Task CloseAsync(QrSession session, CancellationToken ct)
    {
        if (_qrs.TryGetValue(session.QrId, out var qr))
        {
            lock (qr)
            {
                // A payment that already arrived stays paid, like a real gateway.
                var alreadyPaid = qr.ManuallyPaid || (qr.AutoPayAt is { } at && DateTimeOffset.UtcNow >= at);
                if (!alreadyPaid)
                    qr.Closed = true;
            }
        }
        return Task.CompletedTask;
    }

    /// <summary>Operator "Mark paid". Returns false for unknown or closed QRs.</summary>
    public bool MarkPaid(string qrId)
    {
        if (!_qrs.TryGetValue(qrId, out var qr))
            return false;
        lock (qr)
        {
            if (qr.Closed)
                return false;
            qr.ManuallyPaid = true;
            return true;
        }
    }

    public void Forget(string qrId) => _qrs.TryRemove(qrId, out _);

    private sealed class SimulatedQr(long amount, DateTimeOffset? autoPayAt)
    {
        public long Amount { get; } = amount;
        public DateTimeOffset? AutoPayAt { get; } = autoPayAt;
        public bool ManuallyPaid { get; set; }
        public bool Closed { get; set; }
        public string? PaymentId { get; set; }
    }
}
