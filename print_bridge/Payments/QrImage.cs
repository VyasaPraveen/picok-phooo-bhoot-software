using QRCoder;

namespace Epixs.PrintBridge.Payments;

public static class QrImage
{
    /// <summary>PNG QR code for the given text (10 px per module, quiet zone included).</summary>
    public static byte[] Png(string text)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        using var png = new PngByteQRCode(data);
        return png.GetGraphic(10);
    }

    public static bool IsPng(byte[] data) =>
        data.Length > 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47;
}
