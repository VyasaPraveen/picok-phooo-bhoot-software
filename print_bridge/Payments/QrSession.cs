namespace Epixs.PrintBridge.Payments;

public static class QrStatus
{
    public const string Pending = "pending";
    public const string Paid = "paid";
    public const string Expired = "expired";
    public const string Closed = "closed";
    public const string Error = "error";

    public static bool IsFinal(string status) => status is Paid or Expired or Closed;
}

public sealed record QrSessionSnapshot(
    string QrId,
    string Provider,
    string OrderId,
    long Amount,
    string Description,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    string Status,
    string? PaymentId,
    string? Method,
    string? PayerVpa,
    string? Message,
    bool IsSimulator);

/// <summary>One dynamic QR created through the bridge. Kept in memory only.</summary>
public sealed class QrSession
{
    private readonly object _gate = new();
    private string _status = QrStatus.Pending;
    private string? _paymentId;
    private string? _method;
    private string? _payerVpa;
    private string? _message;

    public QrSession(IPaymentProvider provider, string qrId, string orderId, long amount, string description,
        DateTimeOffset expiresAt, string? upiString, byte[] imagePng)
    {
        Provider = provider;
        QrId = qrId;
        OrderId = orderId;
        Amount = amount;
        Description = description;
        CreatedAt = DateTimeOffset.UtcNow;
        ExpiresAt = expiresAt;
        UpiString = upiString;
        ImagePng = imagePng;
    }

    public IPaymentProvider Provider { get; }
    public string QrId { get; }
    public string OrderId { get; }
    public long Amount { get; }
    public string Description { get; }
    public DateTimeOffset CreatedAt { get; }
    public DateTimeOffset ExpiresAt { get; }
    public string? UpiString { get; }
    public byte[] ImagePng { get; }

    /// <summary>Serialises upstream calls for this QR.</summary>
    public SemaphoreSlim Gate { get; } = new(1, 1);

    /// <summary>Last time the gateway was asked about this QR (rate limiting).</summary>
    public DateTimeOffset LastCheckedAt { get; set; } = DateTimeOffset.MinValue;

    public string Status
    {
        get { lock (_gate) return _status; }
    }

    public bool IsFinal => QrStatus.IsFinal(Status);

    public void MarkPaid(PaymentCheck check)
    {
        lock (_gate)
        {
            _status = QrStatus.Paid;
            _paymentId = check.PaymentId;
            _method = check.Method ?? "upi";
            _payerVpa = check.PayerVpa;
            _message = null;
        }
    }

    public void SetStatus(string status, string? message = null)
    {
        lock (_gate)
        {
            _status = status;
            _message = message;
        }
    }

    public void SetMessage(string? message)
    {
        lock (_gate)
            _message = message;
    }

    public QrSessionSnapshot Snapshot()
    {
        lock (_gate)
            return new QrSessionSnapshot(QrId, Provider.Name, OrderId, Amount, Description, CreatedAt, ExpiresAt,
                _status, _paymentId, _method, _payerVpa, _message, Provider is SimulatorProvider);
    }
}
