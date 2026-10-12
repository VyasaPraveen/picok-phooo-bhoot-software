using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.UI;

internal sealed class MainForm : Form
{
    private readonly TabControl _tabs;
    private readonly System.Windows.Forms.Timer _refreshTimer;
    private bool _exiting;

    public MainForm(BridgeServices services)
    {
        Text = AppInfo.Name;
        Icon = AppIcon.Get();
        Font = new Font("Segoe UI", 10f);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96f, 96f);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1080, 760);

        _tabs = new TabControl { Dock = DockStyle.Fill, Padding = new Point(14, 6) };
        _tabs.TabPages.Add(new StatusTab(services));
        _tabs.TabPages.Add(new ProfilesTab(services));
        _tabs.TabPages.Add(new PaymentsTab(services));
        _tabs.TabPages.Add(new JobsTab(services));
        _tabs.TabPages.Add(new SettingsTab(services));
        _tabs.SelectedIndexChanged += (_, _) => RefreshSelected();
        Controls.Add(_tabs);

        _refreshTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _refreshTimer.Tick += (_, _) => RefreshSelected();
        _refreshTimer.Start();

        services.Api.StateChanged += () => RefreshOnUiThread();
    }

    /// <summary>Raised when the window is closed with the X button (the bridge keeps running).</summary>
    public event Action? HiddenToTray;

    public void RefreshAll()
    {
        foreach (TabPage page in _tabs.TabPages)
            (page as IRefreshable)?.RefreshView();
    }

    public void CloseForExit()
    {
        _exiting = true;
        _refreshTimer.Stop();
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            HiddenToTray?.Invoke();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible)
            RefreshSelected();
    }

    private void RefreshSelected()
    {
        if (Visible && _tabs.SelectedTab is IRefreshable tab)
            tab.RefreshView();
    }

    private void RefreshOnUiThread()
    {
        if (IsDisposed || !IsHandleCreated)
            return;
        if (InvokeRequired)
            BeginInvoke(RefreshAll);
        else
            RefreshAll();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _refreshTimer.Dispose();
        base.Dispose(disposing);
    }
}
