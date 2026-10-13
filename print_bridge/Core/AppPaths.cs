namespace Epixs.PrintBridge.Core;

public static class AppPaths
{
    public const string DataDirArgument = "--data-dir=";

    /// <summary>%ProgramData%\EPIXS\PrintBridge – settings and logs (or the folder given with --data-dir=).</summary>
    public static string DataDir { get; private set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "EPIXS", "PrintBridge");

    /// <summary>Developer/testing option: keeps settings and logs in another folder. Call before anything is logged.</summary>
    public static void UseDataDirFromArgs(IEnumerable<string> args)
    {
        var arg = args.LastOrDefault(a => a.StartsWith(DataDirArgument, StringComparison.OrdinalIgnoreCase));
        var dir = arg?[DataDirArgument.Length..].Trim().Trim('"');
        if (!string.IsNullOrEmpty(dir))
            DataDir = Path.GetFullPath(dir);
    }

    public static string SettingsFile => Path.Combine(DataDir, "settings.json");

    public static string LogDir => Path.Combine(DataDir, "logs");

    /// <summary>
    /// Customer photos waiting to print. Kept in the user's private profile (not ProgramData) so other
    /// Windows accounts cannot read them; each file is deleted as soon as its job finishes.
    /// </summary>
    public static string IncomingDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EPIXS", "PrintBridge", "incoming");

    public static void EnsureCreated()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(IncomingDir);
    }

    /// <summary>Removes photos left behind by a crash or power loss.</summary>
    public static void PurgeIncoming()
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(IncomingDir))
            {
                try { File.Delete(file); }
                catch (IOException ex) { Log.Warn($"Could not delete leftover photo {Path.GetFileName(file)}: {ex.Message}"); }
                catch (UnauthorizedAccessException ex) { Log.Warn($"Could not delete leftover photo {Path.GetFileName(file)}: {ex.Message}"); }
            }
        }
        catch (DirectoryNotFoundException)
        {
        }
    }
}
