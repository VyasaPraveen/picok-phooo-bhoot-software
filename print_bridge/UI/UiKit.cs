namespace Epixs.PrintBridge.UI;

/// <summary>Small helpers so every tab looks the same.</summary>
internal static class UiKit
{
    public static readonly Color Good = Color.FromArgb(30, 142, 62);
    public static readonly Color Warning = Color.FromArgb(176, 96, 0);
    public static readonly Color Bad = Color.FromArgb(197, 34, 31);
    public static readonly Color Muted = Color.FromArgb(95, 99, 104);
    public static readonly Color Accent = Color.FromArgb(0, 105, 170);

    public static Label Label(string text, float size = 10f, FontStyle style = FontStyle.Regular, Color? color = null) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font("Segoe UI", size, style),
        ForeColor = color ?? SystemColors.ControlText,
        Margin = new Padding(3, 4, 3, 4),
    };

    public static Button Button(string text, EventHandler onClick)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(8, 3, 8, 3),
            Margin = new Padding(3, 3, 6, 3),
            UseVisualStyleBackColor = true,
        };
        button.Click += onClick;
        return button;
    }

    public static ComboBox DropDown(int width, IEnumerable<object>? items = null)
    {
        var combo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = width, Margin = new Padding(3, 4, 3, 3) };
        if (items is not null)
            combo.Items.AddRange(items.ToArray());
        return combo;
    }

    public static TableLayoutPanel Column(Padding? padding = null) => new()
    {
        Dock = DockStyle.Fill,
        ColumnCount = 1,
        AutoScroll = true,
        Padding = padding ?? new Padding(16),
        GrowStyle = TableLayoutPanelGrowStyle.AddRows,
    };

    public static FlowLayoutPanel Row() => new()
    {
        AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink,
        FlowDirection = FlowDirection.LeftToRight,
        WrapContents = true,
        Margin = new Padding(0, 4, 0, 4),
    };

    public static ListView List(params (string Title, int Width)[] columns)
    {
        var list = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            FullRowSelect = true,
            MultiSelect = false,
            HideSelection = false,
            GridLines = true,
            Font = new Font("Segoe UI", 9.5f),
        };
        foreach (var (title, width) in columns)
            list.Columns.Add(title, width);
        return list;
    }

    /// <summary>Replaces the rows of a list view, keeping the selected row (by key) selected.</summary>
    public static void Fill(ListView list, IEnumerable<(string Key, string[] Cells, Color? Color)> rows)
    {
        var selectedKey = list.SelectedItems.Count > 0 ? list.SelectedItems[0].Name : null;
        var topKey = list.Items.Count > 0 ? list.TopItem?.Name : null;
        list.BeginUpdate();
        try
        {
            list.Items.Clear();
            foreach (var (key, cells, color) in rows)
            {
                var item = new ListViewItem(cells) { Name = key, Tag = key };
                if (color is { } c)
                    item.ForeColor = c;
                list.Items.Add(item);
                if (key == selectedKey)
                    item.Selected = true;
            }
            if (topKey is not null && list.Items.ContainsKey(topKey))
                list.TopItem = list.Items[topKey];
        }
        finally
        {
            list.EndUpdate();
        }
    }

    public static void ShowError(IWin32Window? owner, string message) =>
        MessageBox.Show(owner, message, Core.AppInfo.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);

    public static void ShowInfo(IWin32Window? owner, string message) =>
        MessageBox.Show(owner, message, Core.AppInfo.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
}

/// <summary>Tabs that update themselves from live state on the main window's timer.</summary>
internal interface IRefreshable
{
    void RefreshView();
}
