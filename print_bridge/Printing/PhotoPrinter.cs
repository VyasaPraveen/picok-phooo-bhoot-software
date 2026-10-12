using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;

namespace Epixs.PrintBridge.Printing;

/// <summary>Prints one image borderless (cover-fit) as a single spool job with one page per copy.</summary>
public static class PhotoPrinter
{
    /// <param name="controller">Print controller; defaults to a silent <see cref="StandardPrintController"/> (no progress dialog).</param>
    public static void Print(PrintTarget target, string imagePath, int copies, string documentName, PrintController? controller = null)
    {
        Bitmap? image = null;
        var pagesPrinted = 0;
        var orientationChecked = false;

        using var document = new PrintDocument
        {
            DocumentName = documentName,
            PrinterSettings = target.Printer,
            OriginAtMargins = false,
            PrintController = controller ?? new StandardPrintController(),
        };
        document.DefaultPageSettings = target.Page;

        document.BeginPrint += (_, _) =>
        {
            image = LoadBitmap(imagePath);
            pagesPrinted = 0;
            orientationChecked = false;
        };

        document.PrintPage += (_, e) =>
        {
            var graphics = e.Graphics!;
            var bounds = e.PageBounds; // full sheet, 1/100 inch

            if (!orientationChecked)
            {
                if (NeedsRotation(image!.Size, bounds.Size))
                    image.RotateFlip(RotateFlipType.Rotate90FlipNone);
                orientationChecked = true;
            }

            // With OriginAtMargins = false the origin sits at the printable-area corner;
            // shift back to the physical sheet corner so the image covers the whole page.
            graphics.TranslateTransform(-e.PageSettings.HardMarginX, -e.PageSettings.HardMarginY);
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.SmoothingMode = SmoothingMode.HighQuality;

            var source = CoverCrop(image!.Size, bounds.Size);
            using var attributes = new ImageAttributes();
            attributes.SetWrapMode(WrapMode.TileFlipXY); // avoids a faint halo along the edges
            graphics.DrawImage(image, bounds, source.X, source.Y, source.Width, source.Height, GraphicsUnit.Pixel, attributes);

            pagesPrinted++;
            e.HasMorePages = pagesPrinted < copies;
        };

        document.EndPrint += (_, _) =>
        {
            image?.Dispose();
            image = null;
        };

        try
        {
            document.Print();
        }
        catch (InvalidPrinterException ex)
        {
            throw new PrintFailedException($"Printer \"{target.Printer.PrinterName}\" is not available", ex);
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            throw new PrintFailedException("Printing was cancelled", ex);
        }
        catch (Win32Exception ex)
        {
            throw new PrintFailedException($"Windows could not print: {ex.Message}", ex);
        }
        finally
        {
            image?.Dispose();
        }
    }

    /// <summary>True when image and page orientations differ (square images never rotate).</summary>
    public static bool NeedsRotation(Size image, Size page)
    {
        if (image.Width == image.Height || page.Width == page.Height)
            return false;
        return image.Width > image.Height != page.Width > page.Height;
    }

    /// <summary>Largest centred source rectangle with the page's aspect ratio (scale to fill, crop the rest).</summary>
    public static RectangleF CoverCrop(Size image, Size page)
    {
        var imageAspect = (double)image.Width / image.Height;
        var pageAspect = (double)page.Width / page.Height;
        if (imageAspect > pageAspect)
        {
            var width = image.Height * pageAspect;
            return new RectangleF((float)((image.Width - width) / 2), 0, (float)width, image.Height);
        }
        var height = image.Width / pageAspect;
        return new RectangleF(0, (float)((image.Height - height) / 2), image.Width, (float)height);
    }

    private static Bitmap LoadBitmap(string path)
    {
        // Copy into a stand-alone bitmap so the file is not locked and can be deleted right after printing.
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var decoded = Image.FromStream(stream, useEmbeddedColorManagement: true, validateImageData: true);
        var bitmap = new Bitmap(decoded.Width, decoded.Height, PixelFormat.Format24bppRgb);
        bitmap.SetResolution(300, 300);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.Clear(Color.White); // flatten any transparency onto white paper
            g.DrawImage(decoded, 0, 0, decoded.Width, decoded.Height);
        }
        ApplyExifOrientation(decoded, bitmap);
        return bitmap;
    }

    private static void ApplyExifOrientation(Image source, Bitmap target)
    {
        const int OrientationTag = 0x0112;
        if (!source.PropertyIdList.Contains(OrientationTag))
            return;
        var value = source.GetPropertyItem(OrientationTag)?.Value;
        if (value is not { Length: > 0 })
            return;
        var flip = value[0] switch
        {
            2 => RotateFlipType.RotateNoneFlipX,
            3 => RotateFlipType.Rotate180FlipNone,
            4 => RotateFlipType.Rotate180FlipX,
            5 => RotateFlipType.Rotate90FlipX,
            6 => RotateFlipType.Rotate90FlipNone,
            7 => RotateFlipType.Rotate270FlipX,
            8 => RotateFlipType.Rotate270FlipNone,
            _ => RotateFlipType.RotateNoneFlipNone,
        };
        if (flip != RotateFlipType.RotateNoneFlipNone)
            target.RotateFlip(flip);
    }
}
