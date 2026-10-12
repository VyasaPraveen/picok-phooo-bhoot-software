using System.Diagnostics;
using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Printing;

namespace Epixs.PrintBridge.UI;

internal sealed class JobsTab : TabPage, IRefreshable
{
    private readonly BridgeServices _services;
    private readonly ListView _jobs;

    public JobsTab(BridgeServices services)
    {
        _services = services;
        Text = "Jobs";
        UseVisualStyleBackColor = true;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(16, 12, 16, 12) };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        root.Controls.Add(UiKit.Label("Print jobs from the last 24 hours. Customer photos are deleted from this PC as soon as a job finishes.", 9.5f, color: UiKit.Muted));

        _jobs = UiKit.List(("Time", 90), ("Order", 150), ("Media", 70), ("Finish", 70), ("Copies", 60), ("Status", 80), ("Message", 330), ("Printer", 200));
        root.Controls.Add(_jobs);

        var buttons = UiKit.Row();
        buttons.Controls.Add(UiKit.Button("Open log folder", (_, _) => OpenLogs()));
        root.Controls.Add(buttons);

        Controls.Add(root);
    }

    public void RefreshView()
    {
        var rows = _services.Jobs.Recent().Select(j => (
            j.JobId,
            new[]
            {
                j.CreatedAt.LocalDateTime.ToString("HH:mm:ss"),
                j.IsTest ? "Test sheet" : j.OrderId + (j.Reprint ? " (reprint)" : string.Empty),
                j.Media,
                j.Finish,
                j.Copies.ToString(),
                j.Status,
                j.Message,
                j.PrinterName ?? string.Empty,
            },
            (Color?)(j.Status switch
            {
                JobStatus.Done => UiKit.Good,
                JobStatus.Error => UiKit.Bad,
                _ => null,
            })));
        UiKit.Fill(_jobs, rows);
    }

    private static void OpenLogs()
    {
        Directory.CreateDirectory(AppPaths.LogDir);
        Process.Start(new ProcessStartInfo { FileName = AppPaths.LogDir, UseShellExecute = true })?.Dispose();
    }
}
