using System.Printing;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

/// <summary>Follows a spooled document in the Windows print queue until it leaves the spooler.</summary>
public static class SpoolerJobTracker
{
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);
    private const int MaxConsecutiveQueueFailures = 5;

    public readonly record struct Outcome(bool Success, string? ErrorMessage);

    private enum JobPresence { Gone, Present, Completed, Unknown }

    /// <param name="onProgress">Called with (problem message or null) while the job is still in the queue.</param>
    public static Outcome Track(string printerName, string documentName, Action<string?> onProgress, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + Timeout;
        var queueFailures = 0;
        var wasBeingDeleted = false;
        string? lastProblem = null;

        while (true)
        {
            var (presence, problem, deleting) = Observe(printerName, documentName);

            switch (presence)
            {
                case JobPresence.Gone:
                    // Some drivers hand the job straight to the device; not finding it means it left the spooler.
                    return wasBeingDeleted
                        ? new Outcome(false, "Print job was cancelled")
                        : new Outcome(true, null);
                case JobPresence.Completed:
                    return new Outcome(true, null);
                case JobPresence.Unknown:
                    if (++queueFailures >= MaxConsecutiveQueueFailures)
                    {
                        Log.Warn($"Print queue \"{printerName}\" could not be read; assuming {documentName} was printed.");
                        return new Outcome(true, null);
                    }
                    break;
                default:
                    queueFailures = 0;
                    wasBeingDeleted = deleting;
                    if (problem != lastProblem)
                    {
                        if (problem is not null)
                            Log.Warn($"{documentName}: {problem}");
                        else if (lastProblem is not null)
                            Log.Info($"{documentName}: printer problem cleared, printing continues");
                        lastProblem = problem;
                    }
                    onProgress(problem);
                    break;
            }

            if (DateTime.UtcNow >= deadline)
                return new Outcome(false, lastProblem ?? "Printer did not finish the job within 5 minutes");

            if (ct.WaitHandle.WaitOne(PollInterval))
                return new Outcome(false, "Print bridge was stopped before the job finished");
        }
    }

    private static (JobPresence Presence, string? Problem, bool Deleting) Observe(string printerName, string documentName)
    {
        try
        {
            using var access = PrintQueueAccess.Open(printerName);
            var queue = access.Queue;
            using var jobs = queue.GetPrintJobInfoCollection();
            foreach (var job in jobs)
            {
                using (job)
                {
                    if (!IsOurJob(job.Name, documentName))
                        continue;

                    if ((job.IsCompleted || job.IsPrinted) && !job.IsInError)
                        return (JobPresence.Completed, null, false);

                    var problem = JobProblem(job) ?? PrinterStatusService.ProblemOf(queue)?.Message;
                    return (JobPresence.Present, problem, job.IsDeleting || job.IsDeleted);
                }
            }
            return (JobPresence.Gone, null, false);
        }
        catch (PrintSystemException ex)
        {
            Log.Warn($"Could not read print queue \"{printerName}\": {ex.Message}");
            return (JobPresence.Unknown, null, false);
        }
    }

    private static bool IsOurJob(string? jobName, string documentName) =>
        !string.IsNullOrEmpty(jobName) &&
        (jobName.Equals(documentName, StringComparison.OrdinalIgnoreCase) ||
         jobName.Contains(documentName, StringComparison.OrdinalIgnoreCase) ||
         // Some spoolers truncate long document names.
         (jobName.Length >= 20 && documentName.StartsWith(jobName, StringComparison.OrdinalIgnoreCase)));

    private static string? JobProblem(PrintSystemJobInfo job)
    {
        if (job.IsPaperOut)
            return "Printer out of paper – load a new media set";
        if (job.IsOffline)
            return "Printer is offline – check the power and USB cable";
        if (job.IsUserInterventionRequired)
            return "Printer needs attention";
        if (job.IsInError)
            return "Printer reports an error";
        if (job.IsBlocked)
            return "Print job is blocked";
        if (job.IsPaused)
            return "Print job is paused in Windows";
        return null;
    }
}
