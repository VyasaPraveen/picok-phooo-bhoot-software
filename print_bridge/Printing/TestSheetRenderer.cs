using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Printing;

/// <summary>Draws a calibration sheet at 300 dpi: colour bars, grey ramp, 1-inch marker, edge marks and labels.</summary>
public static class TestSheetRenderer
{
    private const int Dpi = 300;

    public static Bitmap Render(MediaInfo media, string finish, DateTime timestamp)
    {
        var size = media.PixelSize;
        var bitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format24bppRgb);
        bitmap.SetResolution(Dpi, Dpi);

        using var g = Graphics.FromImage(bitmap);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.PageUnit = GraphicsUnit.Pixel;
        g.Clear(Color.White);

        var w = size.Width;
        var h = size.Height;
        var margin = Dpi / 4;
        var contentWidth = w - 2 * margin;

        DrawEdgeMarks(g, w, h);

        using var titleFont = new Font("Segoe UI", Dpi * 0.20f, FontStyle.Bold, GraphicsUnit.Pixel);
        using var textFont = new Font("Segoe UI", Dpi * 0.11f, FontStyle.Regular, GraphicsUnit.Pixel);
        using var smallFont = new Font("Segoe UI", Dpi * 0.07f, FontStyle.Regular, GraphicsUnit.Pixel);

        var y = margin + Dpi / 10;
        g.DrawString("EPIXS Print Bridge", titleFont, Brushes.Black, margin, y);
        y += (int)(Dpi * 0.32);
        g.DrawString($"Test sheet · {media.Label} · {MediaCatalog.FinishLabel(finish)}", textFont, Brushes.Black, margin, y);
        y += (int)(Dpi * 0.17);
        g.DrawString(timestamp.ToString("yyyy-MM-dd HH:mm:ss"), textFont, Brushes.DimGray, margin, y);
        y += (int)(Dpi * 0.25);

        // Colour bars.
        Color[] bars = [Color.White, Color.Yellow, Color.Cyan, Color.Lime, Color.Magenta, Color.Red, Color.Blue, Color.Black];
        var barHeight = (int)(Dpi * 0.8);
        DrawSwatches(g, bars, margin, y, contentWidth, barHeight);
        y += barHeight + Dpi / 10;

        // Grey ramp, 0–100 % in 11 steps.
        var ramp = Enumerable.Range(0, 11).Select(i => (int)Math.Round(255 * (10 - i) / 10.0)).Select(v => Color.FromArgb(v, v, v)).ToArray();
        var rampHeight = (int)(Dpi * 0.45);
        DrawSwatches(g, ramp, margin, y, contentWidth, rampHeight);
        y += rampHeight + Dpi / 25;
        for (var i = 0; i <= 10; i += 5)
        {
            var x = margin + contentWidth * i / 11 + 4;
            g.DrawString($"{i * 10}%", smallFont, Brushes.Black, x, y);
        }
        y += Dpi / 6;

        // 1-inch square marker with tick marks every 1/10 inch.
        if (y + Dpi + Dpi / 5 < h - margin)
        {
            using var pen = new Pen(Color.Black, 3);
            g.DrawRectangle(pen, margin, y, Dpi, Dpi);
            for (var t = 1; t < 10; t++)
            {
                var len = t == 5 ? Dpi / 8 : Dpi / 16;
                g.DrawLine(pen, margin + t * Dpi / 10, y, margin + t * Dpi / 10, y + len);
                g.DrawLine(pen, margin, y + t * Dpi / 10, margin + len, y + t * Dpi / 10);
            }
            g.DrawString("1 inch", textFont, Brushes.Black, margin + Dpi + Dpi / 10, y + Dpi / 2 - Dpi / 14);
        }

        if (media.Key == "2x6")
            DrawCutLine(g, w, h, smallFont);

        return bitmap;
    }

    private static void DrawSwatches(Graphics g, Color[] colors, int x, int y, int width, int height)
    {
        for (var i = 0; i < colors.Length; i++)
        {
            var left = x + width * i / colors.Length;
            var right = x + width * (i + 1) / colors.Length;
            using var brush = new SolidBrush(colors[i]);
            g.FillRectangle(brush, left, y, right - left, height);
        }
        using var outline = new Pen(Color.Black, 2);
        g.DrawRectangle(outline, x, y, width, height);
    }

    /// <summary>Hairline frame on the sheet edge plus corner marks; a borderless print shows all of them.</summary>
    private static void DrawEdgeMarks(Graphics g, int w, int h)
    {
        using var edge = new Pen(Color.Black, 4);
        g.DrawRectangle(edge, 2, 2, w - 4, h - 4);

        using var mark = new Pen(Color.Red, 6);
        var inset = Dpi / 8;
        var len = Dpi / 4;
        foreach (var (cx, cy, dx, dy) in new[] { (inset, inset, 1, 1), (w - inset, inset, -1, 1), (inset, h - inset, 1, -1), (w - inset, h - inset, -1, -1) })
        {
            g.DrawLine(mark, cx, cy, cx + dx * len, cy);
            g.DrawLine(mark, cx, cy, cx, cy + dy * len);
        }
    }

    private static void DrawCutLine(Graphics g, int w, int h, Font font)
    {
        using var pen = new Pen(Color.Red, 3) { DashStyle = DashStyle.Dash };
        g.DrawLine(pen, w / 2, 0, w / 2, h);
        var state = g.Save();
        g.TranslateTransform(w / 2f + 8, h - Dpi / 2f);
        g.RotateTransform(-90);
        g.DrawString("2-inch cut", font, Brushes.Red, 0, 0);
        g.Restore(state);
    }
}
