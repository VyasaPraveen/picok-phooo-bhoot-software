using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Api;

/// <summary>Answers "EPIXS_BRIDGE_DISCOVER" broadcasts on UDP 8687 with the bridge's name and HTTP port.</summary>
public sealed class DiscoveryService : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly Func<int?> _httpPort;
    private readonly object _gate = new();
    private UdpClient? _udp;
    private CancellationTokenSource? _cts;

    public DiscoveryService(Func<int?> httpPort) => _httpPort = httpPort;

    public bool IsRunning
    {
        get { lock (_gate) return _udp is not null; }
    }

    public string? LastError { get; private set; }

    public void Start()
    {
        lock (_gate)
        {
            if (_udp is not null)
                return;
            try
            {
                var udp = new UdpClient(AddressFamily.InterNetwork);
                udp.Client.Bind(new IPEndPoint(IPAddress.Any, AppInfo.DiscoveryPort));
                _udp = udp;
                _cts = new CancellationTokenSource();
                LastError = null;
                _ = ListenAsync(udp, _cts.Token);
                Log.Info($"Discovery listening on UDP {AppInfo.DiscoveryPort}");
            }
            catch (SocketException ex)
            {
                LastError = $"UDP {AppInfo.DiscoveryPort} unavailable: {ex.Message}";
                Log.Error($"Discovery could not start: {LastError}");
            }
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            if (_udp is null)
                return;
            _cts?.Cancel();
            _udp.Dispose();
            _cts?.Dispose();
            _udp = null;
            _cts = null;
            Log.Info("Discovery stopped");
        }
    }

    private async Task ListenAsync(UdpClient udp, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            UdpReceiveResult received;
            try
            {
                received = await udp.ReceiveAsync(ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (SocketException ex) when (ex.SocketErrorCode == SocketError.ConnectionReset)
            {
                continue; // ICMP "port unreachable" from an earlier reply
            }
            catch (SocketException ex)
            {
                Log.Warn($"Discovery receive failed: {ex.Message}");
                continue;
            }

            if (received.Buffer.Length > 256)
                continue;
            var text = Encoding.ASCII.GetString(received.Buffer).Trim('\0', ' ', '\r', '\n', '\t');
            if (!string.Equals(text, AppInfo.DiscoveryRequest, StringComparison.Ordinal))
                continue;
            if (_httpPort() is not { } port)
                continue; // HTTP server is down; nothing useful to advertise

            var reply = JsonSerializer.SerializeToUtf8Bytes(
                new DiscoveryResponse(AppInfo.Name, AppInfo.MachineName, port, AppInfo.Version), JsonOptions);
            try
            {
                await udp.SendAsync(reply, received.RemoteEndPoint, ct);
            }
            catch (Exception ex) when (ex is SocketException or ObjectDisposedException or OperationCanceledException)
            {
                if (ct.IsCancellationRequested)
                    return;
                Log.Warn($"Discovery reply to {received.RemoteEndPoint} failed: {ex.Message}");
            }
        }
    }

    public void Dispose() => Stop();
}
