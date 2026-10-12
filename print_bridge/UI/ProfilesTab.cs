using System.ComponentModel;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Printing;

namespace Epixs.PrintBridge.UI;

/// <summary>One row per media|finish: printer, paper size and captured driver settings (DEVMODE).</summary>
internal sealed class ProfilesTab : TabPage
{
    private const string NotSet = "(not set – Windows default printer)";
    private const string AutoPaper = "(auto – match size)";

    private readonly BridgeServices _services;
    private readonly TableLayoutPanel _grid;
    private readonly List<ProfileRow> _rows = [];
    private readonly Label _result;
    private readonly ToolTip _tips = new();
    private List<string> _printers = [];
    private bool _loading;

    public ProfilesTab(BridgeServices services)
    {
        _services = services;
        Text = "Printer profiles";
        UseVisualStyleBackColor = true;

        var root = UiKit.Column(new Padding(16, 12, 16, 12));

        var help = UiKit.Label(
            "Choose the printer for each print size and finish. For the DNP DS-RX1HS: pick the DNP printer, then click " +
            "\"Driver settings…\" and in the DNP dialog set the paper size, turn on the 2-inch cut for the 2×6 profiles, " +
            "and choose Glossy or Matte for the overcoat. Click OK – the bridge stores those driver settings and uses them " +
            "for every print with that profile. Leave the paper size on automatic when you set it in the driver dialog.",
            9.5f, color: UiKit.Muted);
        help.MaximumSize = new Size(980, 0);
        root.Controls.Add(help);

        var toolbar = UiKit.Row();
        toolbar.Controls.Add(UiKit.Button("Refresh printer list", (_, _) => LoadPrinters()));
        root.Controls.Add(toolbar);

        _grid = new TableLayoutPanel { AutoSize = true, ColumnCount = 7, Margin = new Padding(0, 6, 0, 6) };
        for (var i = 0; i < 7; i++)
            _grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        foreach (var header in new[] { "Profile", "Printer", "Paper size", "Driver settings", "", "", "" })
            _grid.Controls.Add(UiKit.Label(header, 9.5f, FontStyle.Bold, UiKit.Muted));

        foreach (var (media, finish) in MediaCatalog.AllProfiles())
            _rows.Add(CreateRow(media, finish));
        root.Controls.Add(_grid);

        _result = UiKit.Label(string.Empty, 10f, color: UiKit.Muted);
        root.Controls.Add(_result);

        Controls.Add(root);
        LoadPrinters();
    }

    private ProfileRow CreateRow(MediaInfo media, string finish)
    {
        var row = new ProfileRow(media, finish)
        {
            Printer = UiKit.DropDown(270),
            Paper = UiKit.DropDown(200),
            DriverStatus = UiKit.Label("—", 9.5f, color: UiKit.Muted),
        };
        row.Printer.DropDownWidth = 360;
        row.Paper.DropDownWidth = 280;
        row.Printer.SelectedIndexChanged += (_, _) => OnPrinterChanged(row);
        row.Paper.SelectedIndexChanged += (_, _) => OnPaperChanged(row);

        row.DriverButton = UiKit.Button("Driver settings…", (_, _) => CaptureDriverSettings(row));
        var clear = UiKit.Button("Clear", (_, _) => ClearProfile(row));
        var test = UiKit.Button("Test print", (_, _) => TestPrint(row));
        _tips.SetToolTip(clear, "Remove this profile (printer, paper size and driver settings)");
        _tips.SetToolTip(row.DriverButton, "Open the printer driver's own settings dialog and store the result for this profile");

        _grid.Controls.Add(UiKit.Label($"{media.Label} · {MediaCatalog.FinishLabel(finish)}", 10f, FontStyle.Bold));
        _grid.Controls.Add(row.Printer);
        _grid.Controls.Add(row.Paper);
        _grid.Controls.Add(row.DriverButton);
        _grid.Controls.Add(row.DriverStatus);
        _grid.Controls.Add(clear);
        _grid.Controls.Add(test);
        return row;
    }

    private void LoadPrinters()
    {
        _printers = PrinterSettings.InstalledPrinters.Cast<string>().OrderBy(p => p, StringComparer.CurrentCultureIgnoreCase).ToList();
        var profiles = _services.Settings.Snapshot().Profiles;

        _loading = true;
        try
        {
            foreach (var row in _rows)
            {
                profiles.TryGetValue(row.Key, out var profile);
                row.Printer.Items.Clear();
                row.Printer.Items.Add(NotSet);
                row.Printer.Items.AddRange(_printers.Cast<object>().ToArray());
                if (profile is not null && !_printers.Contains(profile.PrinterName))
                    row.Printer.Items.Add(profile.PrinterName); // keep a configured but currently missing printer visible
                row.Printer.SelectedItem = profile?.PrinterName ?? NotSet;
                LoadPaperSizes(row, profile);
                ShowDriverStatus(row, profile);
            }
        }
        finally
        {
            _loading = false;
        }
    }

    private void LoadPaperSizes(ProfileRow row, PrintProfile? profile)
    {
        row.Paper.Items.Clear();
        row.Paper.Items.Add(AutoPaper);
        var printerName = profile?.PrinterName;
        var installed = printerName is not null && _printers.Contains(printerName);
        if (installed)
        {
            try
            {
                var settings = new PrinterSettings { PrinterName = printerName! };
                var names = settings.PaperSizes.Cast<PaperSize>().Select(p => p.PaperName)
                    .Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToArray();
                row.Paper.Items.AddRange(names.Cast<object>().ToArray());
            }
            catch (Exception ex) when (ex is InvalidPrinterException or Win32Exception)
            {
                Log.Warn($"Could not read paper sizes of \"{printerName}\": {ex.Message}");
            }
        }
        if (profile?.PaperSizeName is { } paper && !row.Paper.Items.Contains(paper))
            row.Paper.Items.Add(paper);
        row.Paper.SelectedItem = profile?.PaperSizeName ?? AutoPaper;
        row.Paper.Enabled = installed;
        row.DriverButton!.Enabled = installed;
    }

    private void ShowDriverStatus(ProfileRow row, PrintProfile? profile)
    {
        if (profile?.DevModeBase64 is { Length: > 0 } b64)
        {
            row.DriverStatus!.Text = "captured ✓";
            row.DriverStatus.ForeColor = UiKit.Good;
            string? form = null;
            try
            {
                form = DevModeHelper.ReadFormName(Convert.FromBase64String(b64));
            }
            catch (FormatException)
            {
            }
            _tips.SetToolTip(row.DriverStatus, form is null ? "Driver settings stored" : $"Driver settings stored (paper: {form})");
        }
        else
        {
            row.DriverStatus!.Text = "—";
            row.DriverStatus.ForeColor = UiKit.Muted;
            _tips.SetToolTip(row.DriverStatus, "Driver defaults");
        }
    }

    private void OnPrinterChanged(ProfileRow row)
    {
        if (_loading)
            return;
        var selected = row.Printer.SelectedItem as string;
        PrintProfile? updated = null;
        _services.Settings.Update(s =>
        {
            if (selected is null || selected == NotSet)
            {
                s.Profiles.Remove(row.Key);
                return;
            }
            if (s.Profiles.TryGetValue(row.Key, out var existing) && existing.PrinterName == selected)
            {
                updated = existing;
                return;
            }
            // New printer: paper names and driver settings belong to the old driver, so start fresh.
            updated = new PrintProfile { PrinterName = selected };
            s.Profiles[row.Key] = updated;
        });
        Log.Info($"Profile {row.Key}: printer set to {(updated?.PrinterName ?? "(default printer)")}");

        _loading = true;
        try
        {
            LoadPaperSizes(row, updated);
            ShowDriverStatus(row, updated);
        }
        finally
        {
            _loading = false;
        }
    }

    private void OnPaperChanged(ProfileRow row)
    {
        if (_loading)
            return;
        var paper = row.Paper.SelectedItem as string;
        _services.Settings.Update(s =>
        {
            if (s.Profiles.TryGetValue(row.Key, out var profile))
                profile.PaperSizeName = paper is null || paper == AutoPaper ? null : paper;
        });
    }

    private void CaptureDriverSettings(ProfileRow row)
    {
        var profile = CurrentProfile(row);
        if (profile is null)
        {
            UiKit.ShowError(FindForm(), "Choose a printer for this profile first.");
            return;
        }

        byte[]? current = null;
        if (profile.DevModeBase64 is { Length: > 0 } b64 &&
            string.Equals(profile.DevModePrinterName ?? profile.PrinterName, profile.PrinterName, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                current = Convert.FromBase64String(b64);
            }
            catch (FormatException)
            {
                current = null;
            }
        }

        byte[]? captured;
        try
        {
            captured = DevModeHelper.EditInDriverDialog(FindForm()?.Handle ?? Handle, profile.PrinterName, current);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or ExternalException)
        {
            UiKit.ShowError(FindForm(), $"Could not open the driver settings: {ex.Message}");
            return;
        }
        if (captured is null)
            return; // cancelled

        _services.Settings.Update(s =>
        {
            if (s.Profiles.TryGetValue(row.Key, out var p))
            {
                p.DevModeBase64 = Convert.ToBase64String(captured);
                p.DevModePrinterName = p.PrinterName;
            }
        });
        Log.Info($"Profile {row.Key}: driver settings captured for \"{profile.PrinterName}\" ({captured.Length} bytes, paper {DevModeHelper.ReadFormName(captured) ?? "?"})");
        ShowDriverStatus(row, CurrentProfile(row));
        _result.Text = $"Driver settings stored for {row.Key}.";
    }

    private void ClearProfile(ProfileRow row)
    {
        if (CurrentProfile(row) is null)
            return;
        _services.Settings.Update(s => s.Profiles.Remove(row.Key));
        Log.Info($"Profile {row.Key} cleared");
        _loading = true;
        try
        {
            row.Printer.SelectedItem = NotSet;
            LoadPaperSizes(row, null);
            ShowDriverStatus(row, null);
        }
        finally
        {
            _loading = false;
        }
        _result.Text = $"{row.Key} cleared – it will use the Windows default printer.";
    }

    private void TestPrint(ProfileRow row)
    {
        try
        {
            var job = _services.Jobs.EnqueueTestSheet(row.Media, row.Finish);
            _result.Text = $"Test sheet for {row.Key} queued ({job.JobId}). Progress is shown on the Jobs tab.";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ExternalException)
        {
            UiKit.ShowError(FindForm(), $"Could not create the test sheet: {ex.Message}");
        }
    }

    private PrintProfile? CurrentProfile(ProfileRow row) =>
        _services.Settings.Snapshot().Profiles.TryGetValue(row.Key, out var p) ? p : null;

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _tips.Dispose();
        base.Dispose(disposing);
    }

    private sealed class ProfileRow(MediaInfo media, string finish)
    {
        public MediaInfo Media { get; } = media;
        public string Finish { get; } = finish;
        public string Key { get; } = MediaCatalog.ProfileKey(media.Key, finish);
        public required ComboBox Printer { get; init; }
        public required ComboBox Paper { get; init; }
        public required Label DriverStatus { get; init; }
        public Button? DriverButton { get; set; }
    }
}
