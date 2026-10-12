using System.Printing;

namespace Epixs.PrintBridge.Printing;

/// <summary>Opens a System.Printing queue for a Windows printer name (local or \\server\share).</summary>
internal sealed class PrintQueueAccess : IDisposable
{
    private readonly PrintServer _server;

    private PrintQueueAccess(PrintServer server, PrintQueue queue)
    {
        _server = server;
        Queue = queue;
    }

    public PrintQueue Queue { get; }

    /// <exception cref="PrintQueueException">The printer does not exist.</exception>
    public static PrintQueueAccess Open(string printerName)
    {
        PrintServer server;
        string queueName;
        if (printerName.StartsWith(@"\\", StringComparison.Ordinal) && printerName.IndexOf('\\', 2) is var split and > 2)
        {
            server = new PrintServer(printerName[..split]);
            queueName = printerName[(split + 1)..];
        }
        else
        {
            server = new LocalPrintServer();
            queueName = printerName;
        }

        try
        {
            return new PrintQueueAccess(server, server.GetPrintQueue(queueName));
        }
        catch
        {
            server.Dispose();
            throw;
        }
    }

    public void Dispose()
    {
        Queue.Dispose();
        _server.Dispose();
    }
}
