using System.Drawing.Printing;
using System.Globalization;
using System.Text.RegularExpressions;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

public sealed class PrintFailedException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Printer + page settings to use for one media/finish combination.</summary>
public sealed record PrintTarget(PrinterSettings Printer, PageSettings Page, string Description);

public static class PrintTargetResolver
{
    // 1/100 inch. Dye-sub drivers define borderless papers slightly oversized (e.g. 4.16 × 6.15 in for
    // 4×6); the closest booth sizes (3.5×5 vs 4×6) still differ by 0.5 in.
    private const int PaperTolerance = 30;

    // Paper names that mean "cut into strips" (cut, split, strip, 2 inch, 2x6, "x2" but not "152x203");
    // never auto-picked for full-sheet sizes, preferred for 2x6. Matched against the normalized name.
    private static readonly Regex CutPaperName = new(@"cut|split|strip|2inch|2x6|x2(?!\d)", RegexOptions.CultureInvariant);

    /// <summary>
    /// Uses the "{media}|{finish}" profile (printer, captured driver DEVMODE, paper size). There is no
    /// fallback: a size without a profile printer fails, so nothing ever goes to the Windows default printer.
    /// The chosen paper must match the media size, otherwise the job fails instead of printing on the wrong paper.
    /// </summary>
    public static PrintTarget Resolve(BridgeSettings settings, MediaInfo media, string finish)
    {
        var key = MediaCatalog.ProfileKey(media.Key, finish);
        if (!settings.Profiles.TryGetValue(key, out var profile) || string.IsNullOrWhiteSpace(profile.PrinterName))
            throw new PrintFailedException($"No printer set up for {key}. Set it on the Printer profiles tab.");

        var printerName = profile.PrinterName;
        var printer = new PrinterSettings { PrinterName = printerName, Copies = 1 };
        if (!printer.IsValid)
            throw new PrintFailedException($"Printer \"{printerName}\" is not installed");

        var page = printer.DefaultPageSettings;
        var notes = new List<string> { $"profile {key}" };

        var devModeApplied = false;
        if (profile.DevModeBase64 is { Length: > 0 } devModeBase64)
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

        // One spool page per copy (PhotoPrinter); driver-side copies would multiply them.
        printer.Copies = 1;
        printer.Collate = false;

        var namedPaper = profile.PaperSizeName;
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

        if (!Matches(page.PaperSize, media))
            throw PaperMismatch(media, page.PaperSize);

        return new PrintTarget(printer, page, $"{printerName} ({string.Join(", ", notes)})");
    }

    public static bool Matches(PaperSize paper, MediaInfo media) =>
        (Near(paper.Width, media.SheetWidth) && Near(paper.Height, media.SheetHeight)) ||
        (Near(paper.Width, media.SheetHeight) && Near(paper.Height, media.SheetWidth));

    /// <summary>
    /// Picks a driver paper of the media's size. 2x6 strips prefer the driver's cut/strip paper;
    /// all other sizes never take a cut paper. Fails when the driver has no suitable paper.
    /// </summary>
    private static void SelectMatchingPaper(PrinterSettings printer, PageSettings page, MediaInfo media, List<string> notes)
    {
        var strips = media.Key == "2x6";
        var candidates = printer.PaperSizes.Cast<PaperSize>()
            .Where(p => Matches(p, media) && (strips || !IsCutPaper(p)))
            .OrderByDescending(p => strips && IsCutPaper(p))
            .ThenByDescending(p => NameMentions(p, media))
            .ToList();

        var current = page.PaperSize;
        var currentOk = Matches(current, media) && (strips
            ? IsCutPaper(current) || !candidates.Any(IsCutPaper)
            : !IsCutPaper(current));
        if (currentOk)
        {
            notes.Add($"paper \"{current.PaperName}\" (current)");
            return;
        }

        var match = candidates.FirstOrDefault();
        if (match is null)
            throw PaperMismatch(media, current);
        page.PaperSize = match;
        notes.Add($"paper \"{match.PaperName}\" (matched)");
    }

    private static PrintFailedException PaperMismatch(MediaInfo media, PaperSize paper)
    {
        var w = (paper.Width / 100.0).ToString("0.##", CultureInfo.InvariantCulture);
        var h = (paper.Height / 100.0).ToString("0.##", CultureInfo.InvariantCulture);
        var expected = media.Key == "2x6" ? "a 4×6 sheet (2×6 cut)" : media.Label;
        return new PrintFailedException(
            $"The {media.Label} profile's paper is \"{paper.PaperName}\" ({w}x{h} in), not {expected}. Fix it on the Printer profiles tab.");
    }

    private static string NormalizedName(PaperSize paper) =>
        (paper.PaperName ?? string.Empty).ToLowerInvariant().Replace('×', 'x')
            .Replace(" ", string.Empty).Replace("-", string.Empty).Replace("_", string.Empty);

    private static bool IsCutPaper(PaperSize paper) => CutPaperName.IsMatch(NormalizedName(paper));

    /// <summary>True when the paper name spells out the media size, e.g. "PC (4x6)" or "6 x 4".</summary>
    private static bool NameMentions(PaperSize paper, MediaInfo media)
    {
        var name = NormalizedName(paper);
        var parts = media.Key.Split('x');
        return name.Contains(media.Key) || (parts.Length == 2 && name.Contains($"{parts[1]}x{parts[0]}"));
    }

    private static bool Near(int a, int b) => Math.Abs(a - b) <= PaperTolerance;
}
