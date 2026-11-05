using System.ComponentModel;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Text;
using static Epixs.PrintBridge.Printing.NativeMethods;

namespace Epixs.PrintBridge.Printing;

/// <summary>
/// Captures and restores the driver's private DEVMODE. Photo printer drivers (Citizen, DNP and others)
/// keep settings such as the 2-inch cut and the gloss/matte overcoat in the private part of the DEVMODE,
/// which the managed printing API cannot set directly.
/// </summary>
public static class DevModeHelper
{
    // DEVMODEW field offsets.
    private const int OffsetDmSize = 68;
    private const int OffsetDmDriverExtra = 70;
    private const int OffsetDmCopies = 86;
    private const int OffsetDmCollate = 100;
    private const int OffsetDmFormName = 102;
    private const int CchDeviceName = 32;

    /// <summary>
    /// Opens the driver's own document-properties dialog, starting from <paramref name="current"/>
    /// (or the printer's defaults). Returns the edited DEVMODE bytes, or null if the operator cancelled.
    /// Must be called on the UI thread.
    /// </summary>
    public static byte[]? EditInDriverDialog(IntPtr owner, string printerName, byte[]? current)
    {
        var settings = new PrinterSettings { PrinterName = printerName };
        if (!settings.IsValid)
            throw new InvalidOperationException($"Printer \"{printerName}\" is not installed.");

        var hDevModeIn = current is { Length: > 0 } ? ToHGlobal(current) : settings.GetHdevmode();
        var hPrinter = IntPtr.Zero;
        var outBuffer = IntPtr.Zero;
        try
        {
            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), $"Could not open printer \"{printerName}\".");

            var size = DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            if (size <= 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "The printer driver did not report its settings size.");

            outBuffer = Marshal.AllocHGlobal(size);
            var pIn = GlobalLock(hDevModeIn);
            int result;
            try
            {
                result = DocumentProperties(owner, hPrinter, printerName, outBuffer, pIn,
                    DM_IN_BUFFER | DM_IN_PROMPT | DM_OUT_BUFFER);
            }
            finally
            {
                GlobalUnlock(hDevModeIn);
            }

            if (result < 0)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "The printer driver settings dialog failed.");
            if (result != IDOK)
                return null;

            var length = DevModeLength(outBuffer, size);
            var bytes = new byte[length];
            Marshal.Copy(outBuffer, bytes, 0, length);
            return bytes;
        }
        finally
        {
            if (outBuffer != IntPtr.Zero)
                Marshal.FreeHGlobal(outBuffer);
            if (hPrinter != IntPtr.Zero)
                ClosePrinter(hPrinter);
            GlobalFree(hDevModeIn);
        }
    }

    /// <summary>
    /// Applies a captured DEVMODE to the printer settings and the page settings used for printing.
    /// Copies are always forced to 1 (uncollated): the bridge spools one page per copy, so copies saved
    /// in the driver dialog would multiply the prints.
    /// </summary>
    public static void Apply(PrinterSettings settings, PageSettings page, byte[] devMode)
    {
        var hDevMode = ToHGlobal(WithSingleCopy(devMode));
        try
        {
            settings.SetHdevmode(hDevMode);
            page.SetHdevmode(hDevMode);
        }
        finally
        {
            GlobalFree(hDevMode);
        }
        settings.Copies = 1;
        settings.Collate = false;
    }

    /// <summary>A copy of the DEVMODE with dmCopies = 1 and dmCollate = DMCOLLATE_FALSE.</summary>
    public static byte[] WithSingleCopy(byte[] devMode)
    {
        var copy = (byte[])devMode.Clone();
        if (copy.Length >= OffsetDmCopies + 2)
            BitConverter.TryWriteBytes(copy.AsSpan(OffsetDmCopies, 2), (short)1);
        if (copy.Length >= OffsetDmCollate + 2)
            BitConverter.TryWriteBytes(copy.AsSpan(OffsetDmCollate, 2), (short)0);
        return copy;
    }

    /// <summary>The dmCopies field of a DEVMODE, or null if it is too short.</summary>
    public static int? ReadCopies(byte[] devMode) =>
        devMode.Length >= OffsetDmCopies + 2 ? BitConverter.ToInt16(devMode, OffsetDmCopies) : null;

    /// <summary>The form (paper) name stored in a DEVMODE, for display.</summary>
    public static string? ReadFormName(byte[] devMode)
    {
        if (devMode.Length < OffsetDmFormName + CchDeviceName * 2)
            return null;
        var name = Encoding.Unicode.GetString(devMode, OffsetDmFormName, CchDeviceName * 2);
        var nul = name.IndexOf('\0');
        name = (nul >= 0 ? name[..nul] : name).Trim();
        return name.Length > 0 ? name : null;
    }

    public static bool LooksValid(byte[] devMode) =>
        devMode.Length >= OffsetDmDriverExtra + 2 &&
        BitConverter.ToUInt16(devMode, OffsetDmSize) + BitConverter.ToUInt16(devMode, OffsetDmDriverExtra) <= devMode.Length;

    private static int DevModeLength(IntPtr devMode, int bufferSize)
    {
        int dmSize = (ushort)Marshal.ReadInt16(devMode, OffsetDmSize);
        int dmDriverExtra = (ushort)Marshal.ReadInt16(devMode, OffsetDmDriverExtra);
        var length = dmSize + dmDriverExtra;
        return length > 0 && length <= bufferSize ? length : bufferSize;
    }

    private static IntPtr ToHGlobal(byte[] data)
    {
        var handle = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)data.Length);
        if (handle == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Out of memory allocating printer settings.");
        var pointer = GlobalLock(handle);
        try
        {
            Marshal.Copy(data, 0, pointer, data.Length);
        }
        finally
        {
            GlobalUnlock(handle);
        }
        return handle;
    }
}
