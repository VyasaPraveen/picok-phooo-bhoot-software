namespace Epixs.PrintBridge.UI;

internal static class AppIcon
{
    private static Icon? _icon;

    /// <summary>The embedded app icon (blue circle with "P"), falling back to the system icon.</summary>
    public static Icon Get()
    {
        if (_icon is not null)
            return _icon;
        using var stream = typeof(AppIcon).Assembly.GetManifestResourceStream("Epixs.PrintBridge.app.ico");
        _icon = stream is null ? SystemIcons.Application : new Icon(stream);
        return _icon;
    }

    public static Icon Small() => new(Get(), SystemInformation.SmallIconSize);
}
