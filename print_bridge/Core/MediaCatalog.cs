namespace Epixs.PrintBridge.Core;

/// <param name="Key">Contract media key, e.g. "4x6".</param>
/// <param name="Label">Operator-facing label.</param>
/// <param name="SheetWidth">Physical sheet width in 1/100 inch (portrait).</param>
/// <param name="SheetHeight">Physical sheet height in 1/100 inch (portrait).</param>
public sealed record MediaInfo(string Key, string Label, int SheetWidth, int SheetHeight)
{
    /// <summary>Sheet size in pixels at 300 dpi (portrait).</summary>
    public Size PixelSize => new(SheetWidth * 3, SheetHeight * 3);
}

public static class MediaCatalog
{
    public static readonly IReadOnlyList<MediaInfo> All =
    [
        new("4x6", "4×6", 400, 600),
        // 2x6 strips are printed as a full 4x6 sheet; the printer's 2-inch cut splits it.
        new("2x6", "2×6 strips", 400, 600),
        new("3.5x5", "3.5×5", 350, 500),
        new("5x7", "5×7", 500, 700),
        new("6x8", "6×8", 600, 800),
    ];

    public static readonly IReadOnlyList<string> Finishes = ["gloss", "matte"];

    public static MediaInfo? Find(string? media) =>
        All.FirstOrDefault(m => string.Equals(m.Key, media?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static string? NormalizeFinish(string? finish)
    {
        var f = finish?.Trim().ToLowerInvariant();
        return f is not null && Finishes.Contains(f) ? f : null;
    }

    public static string ProfileKey(string media, string finish) => $"{media}|{finish}".ToLowerInvariant();

    public static IEnumerable<(MediaInfo Media, string Finish)> AllProfiles()
    {
        foreach (var media in All)
            foreach (var finish in Finishes)
                yield return (media, finish);
    }

    public static string FinishLabel(string finish) => finish == "matte" ? "Matte" : "Gloss";
}
