namespace Epixs.PrintBridge.Core;

/// <summary>Daily rolling text log in %ProgramData%\EPIXS\PrintBridge\logs\bridge-yyyyMMdd.log.</summary>
public static class Log
{
    private const int KeepDays = 60;
    private static readonly object Gate = new();

    public static void Info(string message) => Write("INFO ", message);

    public static void Warn(string message) => Write("WARN ", message);

    public static void Error(string message, Exception? ex = null) =>
        Write("ERROR", ex is null ? message : $"{message}{Environment.NewLine}{ex}");

    public static string TodayFile => Path.Combine(AppPaths.LogDir, $"bridge-{DateTime.Now:yyyyMMdd}.log");

    public static void DeleteOldLogs()
    {
        try
        {
            var cutoff = DateTime.Now.AddDays(-KeepDays);
            foreach (var file in Directory.EnumerateFiles(AppPaths.LogDir, "bridge-*.log"))
            {
                if (File.GetLastWriteTime(file) < cutoff)
                    File.Delete(file);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Warn($"Could not clean old logs: {ex.Message}");
        }
    }

    private static void Write(string level, string message)
    {
        var now = DateTime.Now;
        var line = $"{now:yyyy-MM-dd HH:mm:ss.fff} {level} {message}{Environment.NewLine}";
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(AppPaths.LogDir);
                File.AppendAllText(Path.Combine(AppPaths.LogDir, $"bridge-{now:yyyyMMdd}.log"), line);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Logging must never take the bridge down.
            }
        }
    }
}
