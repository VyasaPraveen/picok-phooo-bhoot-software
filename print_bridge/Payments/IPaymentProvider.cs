namespace Epixs.PrintBridge.Payments;

public sealed record QrCreateRequest(string OrderId, long Amount, string Description, string BusinessName, DateTimeOffset ExpiresAt);

public sealed record QrCreated(string QrId, string? UpiString, byte[] ImagePng);

public sealed record PaymentCheck(bool Paid, string? PaymentId = null, string? Method = null, string? PayerVpa = null, long? AmountPaid = null)
{
    public static readonly PaymentCheck NotPaid = new(false);
}

/// <summary>A payment gateway able to create single-use dynamic UPI QR codes.</summary>
public interface IPaymentProvider
{
    /// <summary>Contract provider name: "razorpay" or "simulator".</summary>
    string Name { get; }

    Task<QrCreated> CreateQrAsync(QrCreateRequest request, CancellationToken ct);

    Task<PaymentCheck> CheckAsync(QrSession session, CancellationToken ct);

    Task CloseAsync(QrSession session, CancellationToken ct);
}

/// <summary>Gateway failure with a message safe to show to the tablet/operator.</summary>
public sealed class PaymentException(string message, Exception? inner = null) : Exception(message, inner);
