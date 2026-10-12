using Epixs.PrintBridge.Api;
using Epixs.PrintBridge.Payments;
using Epixs.PrintBridge.Printing;

namespace Epixs.PrintBridge.Core;

/// <summary>Composition root: owns settings, print queue, payments, HTTP server and discovery.</summary>
public sealed class BridgeServices : IAsyncDisposable
{
    public BridgeServices(SettingsStore settings)
    {
        Settings = settings;
        Jobs = new PrintJobManager(settings);
        PrinterStatus = new PrinterStatusService(settings);
        Payments = new PaymentService(settings);
        Api = new ApiServer(this);
        Discovery = new DiscoveryService(() => Api.RunningPort);
    }

    public SettingsStore Settings { get; }
    public PrintJobManager Jobs { get; }
    public PrinterStatusService PrinterStatus { get; }
    public PaymentService Payments { get; }
    public ApiServer Api { get; }
    public DiscoveryService Discovery { get; }

    public async Task StartAsync()
    {
        var s = Settings.Snapshot();
        await Api.StartAsync(s.HttpPort);
        ApplyDiscovery(s.DiscoveryEnabled);
    }

    /// <summary>Saves a new HTTP port and restarts the server on it.</summary>
    public async Task ChangePortAsync(int port)
    {
        Settings.Update(s => s.HttpPort = port);
        await Api.StartAsync(port);
    }

    public void SetDiscoveryEnabled(bool enabled)
    {
        Settings.Update(s => s.DiscoveryEnabled = enabled);
        ApplyDiscovery(enabled);
    }

    private void ApplyDiscovery(bool enabled)
    {
        if (enabled)
            Discovery.Start();
        else
            Discovery.Stop();
    }

    public async ValueTask DisposeAsync()
    {
        Discovery.Dispose();
        await Api.DisposeAsync();
        Payments.Dispose();
        Jobs.Dispose();
    }
}
