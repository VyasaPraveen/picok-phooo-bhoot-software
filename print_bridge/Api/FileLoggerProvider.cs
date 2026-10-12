using Epixs.PrintBridge.Core;
using Microsoft.Extensions.Logging;

namespace Epixs.PrintBridge.Api;

/// <summary>Forwards ASP.NET Core warnings and errors to the bridge log file.</summary>
internal sealed class FileLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new FileLogger(categoryName);

    public void Dispose()
    {
    }

    private sealed class FileLogger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
                return;
            var message = $"[{category}] {formatter(state, exception)}";
            if (logLevel >= LogLevel.Error)
                Core.Log.Error(message, exception);
            else
                Core.Log.Warn(exception is null ? message : $"{message}: {exception.Message}");
        }
    }
}
