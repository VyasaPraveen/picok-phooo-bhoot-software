namespace Epixs.PrintBridge.Core;

public static class AppInfo
{
    public const string Name = "EPIXS Print Bridge";
    public const string Version = "1.0.0";
    public const int DefaultHttpPort = 8686;
    public const int DiscoveryPort = 8687;
    public const string DiscoveryRequest = "EPIXS_BRIDGE_DISCOVER";

    public static string MachineName => Environment.MachineName;
}
