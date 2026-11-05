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
        var seen = false;
        string? lastProblem = null;

        while (true)
        {
            var (presence, problem, deleting) = Observe(printerName, documentName);

            switch (presence)
            {
                case JobPresence.Gone:
                    // Some drivers hand the job straight to the device; not finding it means it left the spooler.
                    // The spooler does not give us the job id, so a job that was never seen (fast hand-off)
                    // is still reported as printed; it is logged so the operator can check the tray if in doubt.
                    if (!seen && !wasBeingDeleted)
                        Log.Info($"{documentName} left the queue before it was seen; assuming it was printed.");
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
                    seen = true;
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
                return CancelAfterTimeout(printerName, documentName, lastProblem);

            if (ct.WaitHandle.WaitOne(PollInterval))
                return new Outcome(false, "Print bridge was stopped before the job finished");
        }
    }

    /// <summary>
    /// Deletes the job from the Windows queue after the timeout, so it cannot print later and be printed
    /// twice after a reprint.
    /// </summary>
    private static Outcome CancelAfterTimeout(string printerName, string documentName, string? lastProblem)
    {
        var prefix = lastProblem is null ? string.Empty : $"{lastProblem}. ";
        var cancelled = TryCancel(printerName, documentName);
        if (cancelled is null)
            return new Outcome(true, null); // it left the queue at the last moment
        if (cancelled == true)
        {
            Log.Warn($"{documentName}: cancelled in the Windows queue after waiting {Timeout.TotalMinutes:0} minutes");
            return new Outcome(false, $"{prefix}Cancelled after waiting 5 minutes for the printer – nothing was printed; reprint from the staff menu");
        }
        Log.Warn($"{documentName}: could not be cancelled in the Windows queue after the timeout");
        return new Outcome(false, $"{prefix}Printer did not finish within 5 minutes and the job could not be cancelled – it may still print; check the tray before reprinting");
    }

    /// <summary>True when the job was deleted (or is being deleted), false when it could not be, null when it was already gone.</summary>
    private static bool? TryCancel(string printerName, string documentName)
    {
        try
        {
            using (var access = PrintQueueAccess.Open(printerName))
            {
                using var jobs = access.Queue.GetPrintJobInfoCollection();
                var found = false;
                foreach (var job in jobs)
                {
                    using (job)
                    {
                        if (!IsOurJob(job.Name, documentName))
                            continue;
                        found = true;
                        job.Cancel();
                    }
                }
                if (!found)
                    return null;
            }

            // Confirm: the job must be gone or marked as deleting.
            for (var i = 0; i < 5; i++)
            {
                Thread.Sleep(PollInterval);
                var (presence, _, deleting) = Observe(printerName, documentName);
                if (presence is JobPresence.Gone || deleting)
                    return true;
            }
            return false;
        }
        catch (Exception ex) when (ex is PrintSystemException or InvalidOperationException)
        {
            Log.Warn($"Could not cancel {documentName} in print queue \"{printerName}\": {ex.Message}");
            return false;
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
