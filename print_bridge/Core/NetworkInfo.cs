using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace Epixs.PrintBridge.Core;

public static class NetworkInfo
{
    private static readonly string[] VirtualAdapterHints = ["Hyper-V", "Virtual", "VMware", "VirtualBox", "vEthernet", "WSL", "Loopback"];

    /// <summary>
    /// IPv4 addresses of active LAN adapters, adapters with a default gateway first. Virtual adapters
    /// (Hyper-V, WSL, VMware…) are hidden unless they are the only ones.
    /// </summary>
    public static IReadOnlyList<string> GetLanIPv4Addresses()
    {
        var result = new List<(string Address, bool HasGateway, bool IsVirtual)>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up ||
                    nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
                    continue;

                var isVirtual = VirtualAdapterHints.Any(h =>
                    nic.Name.Contains(h, StringComparison.OrdinalIgnoreCase) ||
                    nic.Description.Contains(h, StringComparison.OrdinalIgnoreCase));
                var props = nic.GetIPProperties();
                var hasGateway = props.GatewayAddresses.Any(g =>
                    g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));

                foreach (var ua in props.UnicastAddresses)
                {
                    var ip = ua.Address;
                    if (ip.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(ip))
                        continue;
                    var b = ip.GetAddressBytes();
                    if (b[0] == 169 && b[1] == 254)
                        continue; // APIPA – no DHCP, not reachable from the tablet
                    result.Add((ip.ToString(), hasGateway, isVirtual));
                }
            }
        }
        catch (NetworkInformationException ex)
        {
            Log.Warn($"Could not list network adapters: {ex.Message}");
        }

        if (result.Any(r => !r.IsVirtual))
            result.RemoveAll(r => r.IsVirtual);
        return result.OrderByDescending(r => r.HasGateway).Select(r => r.Address).Distinct().ToList();
    }
}
