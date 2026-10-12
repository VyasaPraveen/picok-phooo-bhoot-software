using System.Text.Json.Serialization;

namespace Epixs.PrintBridge.Api;

// Request/response shapes of docs/BRIDGE_API.md. Property names serialise as camelCase.

public sealed record ErrorResponse(string Error);

public sealed record PingResponse(string App, string Version, string Name, bool RequiresKey);

public sealed record DiscoveryResponse(string App, string Name, int Port, string Version);

public sealed record StatusResponse(PrinterInfo Printer, PaymentsInfo Payments, IReadOnlyList<string> Profiles);

public sealed record PrinterInfo(string Name, bool Online, string State, string Message, int JobsInQueue);

public sealed record PaymentsInfo(string Provider, bool Ready, string Message);

public sealed class PrintMeta
{
    public string? OrderId { get; set; }
    public string? Media { get; set; }
    public string? Finish { get; set; }

    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public int? Copies { get; set; }

    public bool? Reprint { get; set; }
}

public sealed class TestPrintRequest
{
    public string? Media { get; set; }
    public string? Finish { get; set; }
}

public sealed record JobAccepted(string JobId, string Status);

public sealed record JobResponse(string JobId, string OrderId, string Status, string Message, int Copies, string UpdatedAt);

public sealed class QrCreateBody
{
    public string? OrderId { get; set; }

    [JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    public long? Amount { get; set; }

    public string? Description { get; set; }
}

public sealed record QrCreateResponse(string QrId, string Provider, long Amount, string? UpiString, string ImageUrl, string ExpiresAt);

public sealed record QrStatusResponse(string QrId, string Status, string? PaymentId, string? Method, long Amount, string? PayerVpa, string? Message);

internal static class Iso
{
    /// <summary>ISO-8601 UTC with a trailing Z, e.g. 2026-10-12T10:20:00Z.</summary>
    public static string Utc(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);
}
