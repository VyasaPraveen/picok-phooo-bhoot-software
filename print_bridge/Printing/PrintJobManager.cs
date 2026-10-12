using System.Collections.Concurrent;
using System.Drawing.Imaging;
using System.Security.Cryptography;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

/// <summary>
/// In-memory job store plus a single worker thread, so jobs print strictly one after another.
/// Photos are deleted from disk as soon as their job is done or failed.
/// </summary>
public sealed class PrintJobManager : IDisposable
{
    private static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    private readonly SettingsStore _settings;
    private readonly ConcurrentDictionary<string, PrintJob> _jobs = new(StringComparer.Ordinal);
    private readonly BlockingCollection<PrintJob> _queue = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly Thread _worker;
    private readonly System.Threading.Timer _cleanup;

    public PrintJobManager(SettingsStore settings)
    {
        _settings = settings;
        _worker = new Thread(WorkerLoop) { IsBackground = true, Name = "EPIXS print worker" };
        // STA: some drivers show UI (e.g. "Save as" for virtual printers) during StartDoc.
        _worker.SetApartmentState(ApartmentState.STA);
        _worker.Start();
        _cleanup = new System.Threading.Timer(_ => PurgeOldJobs(), null, TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(10));
    }

    public event Action? JobsChanged;

    public static string NewJobId() => "j_" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));

    public static string IncomingPath(string jobId) => Path.Combine(AppPaths.IncomingDir, jobId + ".img");

    public PrintJob Enqueue(string jobId, string orderId, MediaInfo media, string finish, int copies, bool reprint, string imagePath, bool isTest = false)
    {
        var job = new PrintJob(jobId, orderId, media.Key, finish, copies, reprint, isTest, imagePath);
        _jobs[job.JobId] = job;
        Log.Info($"Job {job.JobId} queued: order {orderId}, {media.Key}|{finish}, {copies} cop{(copies == 1 ? "y" : "ies")}{(reprint ? ", reprint" : "")}{(isTest ? ", test sheet" : "")}");
        _queue.Add(job);
        JobsChanged?.Invoke();
        return job;
    }

    /// <summary>Renders a test sheet for the media and queues it like a normal job.</summary>
    public PrintJob EnqueueTestSheet(MediaInfo media, string finish)
    {
        var jobId = NewJobId();
        var path = IncomingPath(jobId);
        using (var sheet = TestSheetRenderer.Render(media, finish, DateTime.Now))
            sheet.Save(path, ImageFormat.Png);
        return Enqueue(jobId, "TEST", media, finish, 1, false, path, isTest: true);
    }

    public PrintJob? Get(string jobId) => _jobs.TryGetValue(jobId, out var job) ? job : null;

    public IReadOnlyList<PrintJobSnapshot> Recent() =>
        _jobs.Values.Select(j => j.Snapshot()).OrderByDescending(j => j.CreatedAt).ToList();

    public int JobsToday()
    {
        var today = DateTime.Now.Date;
        return _jobs.Values.Count(j => !j.IsTest && j.CreatedAt.LocalDateTime.Date == today);
    }

    private void WorkerLoop()
    {
        try
        {
            foreach (var job in _queue.GetConsumingEnumerable(_stop.Token))
                Process(job);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void Process(PrintJob job)
    {
        var copiesText = job.Copies == 1 ? "1 copy" : $"{job.Copies} copies";
        try
        {
            var media = MediaCatalog.Find(job.Media)!;
            var target = PrintTargetResolver.Resolve(_settings.Snapshot(), media, job.Finish);
            var printerName = target.Printer.PrinterName;
            SetStatus(job, JobStatus.Printing, $"Printing {copiesText}", printerName);
            Log.Info($"Job {job.JobId} printing on {target.Description}");

            PhotoPrinter.Print(target, job.ImagePath, job.Copies, job.DocumentName);
            Log.Info($"Job {job.JobId} spooled as \"{job.DocumentName}\"");

            var outcome = SpoolerJobTracker.Track(printerName, job.DocumentName, problem =>
            {
                if (problem is null)
                    SetStatus(job, JobStatus.Printing, $"Printing {copiesText}");
                else
                    SetStatus(job, JobStatus.Error, problem);
            }, _stop.Token);

            if (outcome.Success)
            {
                SetStatus(job, JobStatus.Done, job.IsTest ? "Test sheet printed" : $"Printed {copiesText}");
                Log.Info($"Job {job.JobId} done");
            }
            else
            {
                SetStatus(job, JobStatus.Error, outcome.ErrorMessage ?? "Printing failed");
                Log.Warn($"Job {job.JobId} failed: {outcome.ErrorMessage}");
            }
        }
        catch (PrintFailedException ex)
        {
            SetStatus(job, JobStatus.Error, ex.Message);
            Log.Warn($"Job {job.JobId} failed: {ex.Message}");
        }
        catch (Exception ex)
        {
            SetStatus(job, JobStatus.Error, "Printing failed – see the bridge log");
            Log.Error($"Job {job.JobId} failed unexpectedly", ex);
        }
        finally
        {
            DeleteImage(job);
        }
    }

    private void SetStatus(PrintJob job, string status, string message, string? printerName = null)
    {
        if (job.Update(status, message, printerName))
        {
            if (JobStatus.IsFinal(status))
                DeleteImage(job);
            JobsChanged?.Invoke();
        }
    }

    private static void DeleteImage(PrintJob job)
    {
        try
        {
            if (File.Exists(job.ImagePath))
                File.Delete(job.ImagePath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not delete photo for job {job.JobId}: {ex.Message}");
        }
    }

    private void PurgeOldJobs()
    {
        var cutoff = DateTimeOffset.UtcNow - Retention;
        var removed = 0;
        foreach (var (id, job) in _jobs)
        {
            if (JobStatus.IsFinal(job.Status) && job.UpdatedAt < cutoff && _jobs.TryRemove(id, out _))
                removed++;
        }
        if (removed > 0)
            JobsChanged?.Invoke();
    }

    public void Dispose()
    {
        _stop.Cancel();
        _queue.CompleteAdding();
        _worker.Join(TimeSpan.FromSeconds(5));
        _cleanup.Dispose();
        foreach (var job in _jobs.Values)
            DeleteImage(job);
        _stop.Dispose();
    }
}
