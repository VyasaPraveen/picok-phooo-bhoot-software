using System.Net;
using Epixs.PrintBridge.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Epixs.PrintBridge.Api;

/// <summary>In-process Kestrel host for the LAN API, bound to http://0.0.0.0:{port}.</summary>
public sealed class ApiServer : IAsyncDisposable
{
    private readonly BridgeServices _services;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private WebApplication? _app;

    public ApiServer(BridgeServices services) => _services = services;

    public event Action? StateChanged;

    public int? RunningPort { get; private set; }

    public string? LastError { get; private set; }

    public bool IsRunning => RunningPort is not null;

    public async Task StartAsync(int port)
    {
        await _gate.WaitAsync();
        try
        {
            await StopCoreAsync();
            var app = Build(port);
            try
            {
                await app.StartAsync();
            }
            catch (Exception ex) when (ex is IOException or System.Net.Sockets.SocketException or InvalidOperationException)
            {
                await app.DisposeAsync();
                LastError = IsAddressInUse(ex)
                    ? $"Port {port} is already in use by another program"
                    : $"Could not start the server on port {port}: {ex.Message}";
                Log.Error(LastError);
                return;
            }

            _app = app;
            RunningPort = port;
            LastError = null;
            Log.Info($"HTTP server listening on http://0.0.0.0:{port}");
        }
        finally
        {
            _gate.Release();
            StateChanged?.Invoke();
        }
    }

    public async Task StopAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await StopCoreAsync();
        }
        finally
        {
            _gate.Release();
            StateChanged?.Invoke();
        }
    }

    private async Task StopCoreAsync()
    {
        if (_app is null)
            return;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await _app.StopAsync(timeout.Token);
        }
        finally
        {
            await _app.DisposeAsync();
            _app = null;
            Log.Info($"HTTP server on port {RunningPort} stopped");
            RunningPort = null;
        }
    }

    private WebApplication Build(int port)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            ContentRootPath = AppContext.BaseDirectory,
            ApplicationName = typeof(ApiServer).Assembly.GetName().Name,
        });

        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(new FileLoggerProvider());
        builder.Logging.SetMinimumLevel(LogLevel.Warning);

        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Any, port);
            options.AddServerHeader = false;
            // A little above the 30 MB image limit so the endpoint can answer with a JSON error.
            options.Limits.MaxRequestBodySize = ApiEndpoints.MaxImageBytes + 4 * 1024 * 1024;
        });
        builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = ApiEndpoints.MaxImageBytes + 2 * 1024 * 1024);

        var app = builder.Build();
        app.Use(ErrorBoundary);
        app.Use(RequireBridgeKey);
        ApiEndpoints.Map(app, _services);
        return app;
    }

    private static async Task ErrorBoundary(HttpContext context, Func<Task> next)
    {
        try
        {
            await next();
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // Client went away.
        }
        catch (Exception ex)
        {
            Log.Error($"Unhandled error for {context.Request.Method} {context.Request.Path}", ex);
            if (!context.Response.HasStarted)
            {
                context.Response.Clear();
                await ApiEndpoints.Error(StatusCodes.Status500InternalServerError, "Internal error in the print bridge").ExecuteAsync(context);
            }
        }
    }

    private async Task RequireBridgeKey(HttpContext context, Func<Task> next)
    {
        if (context.Request.Path.Equals("/api/ping", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        var provided = context.Request.Headers["X-Bridge-Key"].ToString();
        if (!PairingKey.Matches(provided, _services.Settings.PairingKey))
        {
            await ApiEndpoints.Error(StatusCodes.Status401Unauthorized, "Invalid bridge key").ExecuteAsync(context);
            return;
        }
        await next();
    }

    private static bool IsAddressInUse(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
        {
            if (e is System.Net.Sockets.SocketException { SocketErrorCode: System.Net.Sockets.SocketError.AddressAlreadyInUse or System.Net.Sockets.SocketError.AccessDenied })
                return true;
            if (e.GetType().Name == "AddressInUseException")
                return true;
        }
        return false;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _gate.Dispose();
    }
}
