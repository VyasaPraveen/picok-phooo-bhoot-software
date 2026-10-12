using System.Drawing.Printing;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

public sealed class PrintFailedException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Printer + page settings to use for one media/finish combination.</summary>
public sealed record PrintTarget(PrinterSettings Printer, PageSettings Page, string Description);

public static class PrintTargetResolver
{
    private const int PaperTolerance = 15; // 1/100 inch

    /// <summary>
    /// Uses the "{media}|{finish}" profile when configured (printer, captured driver DEVMODE, paper size);
    /// otherwise the Windows default printer with a paper size matching the media.
    /// </summary>
    public static PrintTarget Resolve(BridgeSettings settings, MediaInfo media, string finish)
    {
        var key = MediaCatalog.ProfileKey(media.Key, finish);
        settings.Profiles.TryGetValue(key, out var profile);

        var printerName = profile?.PrinterName;
        if (string.IsNullOrWhiteSpace(printerName))
        {
            printerName = PrinterStatusService.DefaultPrinterName();
            if (string.IsNullOrEmpty(printerName))
                throw new PrintFailedException($"No printer set up for {key} and Windows has no default printer");
            profile = null;
        }

        var printer = new PrinterSettings { PrinterName = printerName, Copies = 1 };
        if (!printer.IsValid)
            throw new PrintFailedException($"Printer \"{printerName}\" is not installed");

        var page = printer.DefaultPageSettings;
        var notes = new List<string> { profile is null ? $"no {key} profile, default printer" : $"profile {key}" };

        var devModeApplied = false;
        if (profile?.DevModeBase64 is { Length: > 0 } devModeBase64)
        {
            if (profile.DevModePrinterName is { Length: > 0 } capturedFor &&
                !string.Equals(capturedFor, printerName, StringComparison.OrdinalIgnoreCase))
            {
                notes.Add("driver settings ignored (captured for another printer)");
            }
            else
            {
                try
                {
                    var devMode = Convert.FromBase64String(devModeBase64);
                    if (!DevModeHelper.LooksValid(devMode))
                        throw new FormatException("DEVMODE is truncated");
                    DevModeHelper.Apply(printer, page, devMode);
                    devModeApplied = true;
                    notes.Add("driver settings applied");
                }
                catch (Exception ex) when (ex is FormatException or ArgumentException or System.ComponentModel.Win32Exception)
                {
                    Log.Warn($"Saved driver settings for {key} could not be applied: {ex.Message}");
                    notes.Add("driver settings invalid");
                }
            }
        }

        var namedPaper = profile?.PaperSizeName;
        if (!string.IsNullOrWhiteSpace(namedPaper))
        {
            var paper = printer.PaperSizes.Cast<PaperSize>()
                .FirstOrDefault(p => string.Equals(p.PaperName, namedPaper, StringComparison.OrdinalIgnoreCase));
            if (paper is not null)
            {
                page.PaperSize = paper;
                notes.Add($"paper \"{paper.PaperName}\"");
            }
            else
            {
                notes.Add($"paper \"{namedPaper}\" not offered by driver");
                SelectMatchingPaper(printer, page, media, notes);
            }
        }
        else if (!devModeApplied)
        {
            SelectMatchingPaper(printer, page, media, notes);
        }
        else
        {
            notes.Add($"paper \"{page.PaperSize.PaperName}\" from driver settings");
        }

        return new PrintTarget(printer, page, $"{printerName} ({string.Join(", ", notes)})");
    }

    public static bool Matches(PaperSize paper, MediaInfo media) =>
        (Near(paper.Width, media.SheetWidth) && Near(paper.Height, media.SheetHeight)) ||
        (Near(paper.Width, media.SheetHeight) && Near(paper.Height, media.SheetWidth));

    private static void SelectMatchingPaper(PrinterSettings printer, PageSettings page, MediaInfo media, List<string> notes)
    {
        if (Matches(page.PaperSize, media))
        {
            notes.Add($"paper \"{page.PaperSize.PaperName}\" (current)");
            return;
        }

        var match = printer.PaperSizes.Cast<PaperSize>().FirstOrDefault(p => Matches(p, media));
        if (match is not null)
        {
            page.PaperSize = match;
            notes.Add($"paper \"{match.PaperName}\" (matched)");
        }
        else
        {
            notes.Add($"no {media.Key} paper size, using \"{page.PaperSize.PaperName}\"");
        }
    }

    private static bool Near(int a, int b) => Math.Abs(a - b) <= PaperTolerance;
}
