using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.UI;

/// <summary>Keeps the bridge alive in the notification area; closing the window only hides it.</summary>
internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly MainForm _form;
    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _menu;
    private bool _trayHintShown;

    public TrayApplicationContext(BridgeServices services, bool startHidden)
    {
        _form = new MainForm(services);
        _form.HiddenToTray += OnHiddenToTray;
        _ = _form.Handle; // create the window handle so other threads can marshal to it while hidden

        _menu = new ContextMenuStrip();
        _menu.Items.Add("Open EPIXS Print Bridge", null, (_, _) => ShowMainWindow());
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Exit", null, (_, _) => Exit());

        _tray = new NotifyIcon
        {
            Icon = AppIcon.Small(),
            Text = AppInfo.Name,
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => ShowMainWindow();

        if (!startHidden)
            _form.Show();

        _form.BeginInvoke(new Action(async () =>
        {
            try
            {
                await services.StartAsync();
            }
            catch (Exception ex)
            {
                Log.Error("Bridge services failed to start", ex);
            }
            _form.RefreshAll();
        }));
    }

    /// <summary>Thread-safe: shows and activates the main window.</summary>
    public void ShowMainWindow()
    {
        if (_form.IsDisposed)
            return;
        if (_form.InvokeRequired)
        {
            _form.BeginInvoke(ShowMainWindow);
            return;
        }
        _form.Show();
        if (_form.WindowState == FormWindowState.Minimized)
            _form.WindowState = FormWindowState.Normal;
        _form.Activate();
        _form.BringToFront();
    }

    private void OnHiddenToTray()
    {
        if (_trayHintShown)
            return;
        _trayHintShown = true;
        _tray.ShowBalloonTip(4000, AppInfo.Name,
            "Still running in the background. Use the tray icon to open it, or right-click → Exit to stop printing.",
            ToolTipIcon.Info);
    }

    private void Exit()
    {
        var answer = MessageBox.Show(_form.Visible ? _form : null,
            "Stop the print bridge? The kiosk will not be able to print or take payments until it is started again.",
            AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes)
            return;

        _tray.Visible = false;
        _form.CloseForExit();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Dispose();
            _menu.Dispose();
            _form.Dispose();
        }
        base.Dispose(disposing);
    }
}
