using System.Drawing.Printing;
using System.Printing;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

public static class PrinterState
{
    public const string Ready = "ready";
    public const string Printing = "printing";
    public const string Offline = "offline";
    public const string PaperOut = "paper_out";
    public const string Jammed = "jammed";
    public const string Error = "error";
    public const string NotFound = "not_found";
}

public sealed record PrinterStatus(string Name, bool Online, string State, string Message, int JobsInQueue);

/// <summary>Reports the state of the main photo printer (4x6|gloss profile printer, else Windows default).</summary>
public sealed class PrinterStatusService
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(1);

    private readonly SettingsStore _settings;
    private readonly object _gate = new();
    private PrinterStatus? _cached;
    private DateTime _cachedAt;

    public PrinterStatusService(SettingsStore settings) => _settings = settings;

    public PrinterStatus GetStatus()
    {
        lock (_gate)
        {
            if (_cached is not null && DateTime.UtcNow - _cachedAt < CacheFor)
                return _cached;
            _cached = Query(StatusPrinterName(_settings.Snapshot()));
            _cachedAt = DateTime.UtcNow;
            return _cached;
        }
    }

    public static string StatusPrinterName(BridgeSettings settings)
    {
        if (settings.Profiles.TryGetValue(MediaCatalog.ProfileKey("4x6", "gloss"), out var profile) &&
            !string.IsNullOrWhiteSpace(profile.PrinterName))
            return profile.PrinterName;
        return DefaultPrinterName();
    }

    public static string DefaultPrinterName()
    {
        var name = new PrinterSettings().PrinterName;
        return string.IsNullOrWhiteSpace(name) || name == "<no default printer>" ? string.Empty : name;
    }

    private static PrinterStatus Query(string printerName)
    {
        if (string.IsNullOrEmpty(printerName))
            return new PrinterStatus(string.Empty, false, PrinterState.NotFound, "No printer configured and no Windows default printer", 0);

        try
        {
            using var access = PrintQueueAccess.Open(printerName);
            var queue = access.Queue;
            var (state, message) = Map(queue);
            var online = state is not (PrinterState.Offline or PrinterState.NotFound);
            return new PrinterStatus(printerName, online, state, message, queue.NumberOfJobs);
        }
        catch (PrintQueueException)
        {
            return new PrinterStatus(printerName, false, PrinterState.NotFound, $"Printer \"{printerName}\" not found", 0);
        }
        catch (PrintSystemException ex)
        {
            Log.Warn($"Could not read status of printer \"{printerName}\": {ex.Message}");
            return new PrinterStatus(printerName, false, PrinterState.Error, "Could not read printer status", 0);
        }
    }

    /// <summary>Maps queue flags to a contract state and an operator-friendly message.</summary>
    internal static (string State, string Message) Map(PrintQueue q)
    {
        if (ProblemOf(q) is { } problem)
            return problem;
        var jobs = q.NumberOfJobs;
        if (q.IsPrinting || q.IsProcessing || jobs > 0)
            return (PrinterState.Printing, jobs > 0 ? $"Printing ({jobs} in queue)" : "Printing");
        return (PrinterState.Ready, "Ready");
    }

    /// <summary>Returns a problem state when the queue cannot print right now, otherwise null.</summary>
    internal static (string State, string Message)? ProblemOf(PrintQueue q)
    {
        if (q.IsNotAvailable || q.IsOffline)
            return (PrinterState.Offline, "Printer is offline – check the power and USB cable");
        if (q.IsOutOfPaper)
            return (PrinterState.PaperOut, "Printer out of paper – load a new media set");
        if (q.IsPaperJammed)
            return (PrinterState.Jammed, "Paper jam – open the printer and clear the paper");
        if (q.HasPaperProblem)
            return (PrinterState.PaperOut, "Paper or ribbon problem – check the media set");
        if (q.IsDoorOpened)
            return (PrinterState.Error, "Printer door is open");
        if (q.IsOutOfMemory)
            return (PrinterState.Error, "Printer is out of memory");
        if (q.NeedUserIntervention || q.IsManualFeedRequired)
            return (PrinterState.Error, "Printer needs attention");
        if (q.IsInError)
            return (PrinterState.Error, "Printer reports an error");
        if (q.IsPaused)
            return (PrinterState.Error, "Print queue is paused in Windows");
        return null;
    }
}
