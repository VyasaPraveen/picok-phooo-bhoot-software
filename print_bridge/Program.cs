using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.UI;

namespace Epixs.PrintBridge;

internal static class Program
{
    private const string MutexName = @"Local\EPIXS.PrintBridge.SingleInstance";
    private const string ShowEventName = @"Local\EPIXS.PrintBridge.Show";

    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out var isFirstInstance);
        if (!isFirstInstance)
        {
            // Bring the running instance to the front instead of starting a second bridge.
            if (EventWaitHandle.TryOpenExisting(ShowEventName, out var show))
            {
                using (show)
                    show.Set();
            }
            return;
        }

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);

        ApplicationConfiguration.Initialize();
        AppPaths.UseDataDirFromArgs(args);
        AppPaths.EnsureCreated();
        AppPaths.PurgeIncoming();
        Log.DeleteOldLogs();
        Log.Info($"{AppInfo.Name} {AppInfo.Version} starting on {AppInfo.MachineName}");

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Error("Unhandled UI error", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Unhandled error", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("Unobserved task error", e.Exception);
            e.SetObserved();
        };

        var settings = SettingsStore.Load(AppPaths.SettingsFile);
        var services = new BridgeServices(settings);
        var startHidden = args.Contains(WindowsIntegration.MinimizedArgument, StringComparer.OrdinalIgnoreCase);

        using var context = new TrayApplicationContext(services, startHidden);
        var registration = ThreadPool.RegisterWaitForSingleObject(showEvent,
            (_, _) => context.ShowMainWindow(), null, Timeout.Infinite, executeOnlyOnce: false);

        Application.Run(context);

        registration.Unregister(null);
        // Run off the UI thread: the message loop has ended, so UI-context continuations would deadlock.
        Task.Run(() => services.DisposeAsync().AsTask()).GetAwaiter().GetResult();
        AppPaths.PurgeIncoming();
        Log.Info($"{AppInfo.Name} stopped");
        mutex.ReleaseMutex();
    }
}
