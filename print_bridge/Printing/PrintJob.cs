namespace Epixs.PrintBridge.Printing;

public static class JobStatus
{
    public const string Queued = "queued";
    public const string Printing = "printing";
    public const string Done = "done";
    public const string Error = "error";

    public static bool IsFinal(string status) => status is Done or Error;
}

public sealed record PrintJobSnapshot(
    string JobId,
    string OrderId,
    string Media,
    string Finish,
    int Copies,
    bool Reprint,
    bool IsTest,
    string Status,
    string Message,
    string? PrinterName,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed class PrintJob
{
    private readonly object _gate = new();
    private string _status = JobStatus.Queued;
    private string _message = "Waiting to print";
    private string? _printerName;
    private DateTimeOffset _updatedAt;

    public PrintJob(string jobId, string orderId, string media, string finish, int copies, bool reprint, bool isTest, string imagePath)
    {
        JobId = jobId;
        OrderId = orderId;
        Media = media;
        Finish = finish;
        Copies = copies;
        Reprint = reprint;
        IsTest = isTest;
        ImagePath = imagePath;
        CreatedAt = DateTimeOffset.UtcNow;
        _updatedAt = CreatedAt;
    }

    public string JobId { get; }
    public string OrderId { get; }
    public string Media { get; }
    public string Finish { get; }
    public int Copies { get; }
    public bool Reprint { get; }
    public bool IsTest { get; }
    public DateTimeOffset CreatedAt { get; }

    /// <summary>Received photo on disk; deleted as soon as the job is done or failed.</summary>
    public string ImagePath { get; }

    public string DocumentName => $"EPIXS-{SafeName(OrderId)}-{JobId}";

    public string Status
    {
        get { lock (_gate) return _status; }
    }

    public DateTimeOffset UpdatedAt
    {
        get { lock (_gate) return _updatedAt; }
    }

    /// <summary>Sets status/message. Returns true when something changed.</summary>
    public bool Update(string status, string message, string? printerName = null)
    {
        lock (_gate)
        {
            if (printerName is not null)
                _printerName = printerName;
            if (_status == status && _message == message)
                return false;
            _status = status;
            _message = message;
            _updatedAt = DateTimeOffset.UtcNow;
            return true;
        }
    }

    public PrintJobSnapshot Snapshot()
    {
        lock (_gate)
            return new PrintJobSnapshot(JobId, OrderId, Media, Finish, Copies, Reprint, IsTest,
                _status, _message, _printerName, CreatedAt, _updatedAt);
    }

    private static string SafeName(string value)
    {
        var chars = value.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or '.' ? c : '_').ToArray();
        var s = new string(chars);
        return s.Length > 40 ? s[..40] : s;
    }
}
