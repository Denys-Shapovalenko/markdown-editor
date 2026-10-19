namespace MarkdownEditor;

internal enum ConflictDecision { Cancel, SaveCopy, Reload }
internal static class VersionDialogs
{
    public static ConflictDecision Conflict(IWin32Window owner, string ours, string theirs)
    {
        using var form = new Form { Text = "Файл змінився на диску", Width = 1050, Height = 700, StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false };
        var text = new Label { Text = "Порівняйте версії. «Перечитати» збереже поточні правки окремою чернеткою відновлення.", Dock = DockStyle.Top, Height = 44, Padding = new Padding(12) };
        var split = new SplitContainer { Size = new Size(1000, 600), Dock = DockStyle.Fill, SplitterDistance = 500 };
        AddPreview(split.Panel1, "Версія в редакторі", ours); AddPreview(split.Panel2, "Версія на диску", theirs);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 55, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        var result = ConflictDecision.Cancel;
        foreach (var (caption, decision) in new[] { ("Скасувати", ConflictDecision.Cancel), ("Зберегти копію…", ConflictDecision.SaveCopy), ("Перечитати файл", ConflictDecision.Reload) })
        {
            var button = new Button { Text = caption, AutoSize = true, Height = 32 };
            button.Click += (_, _) => { result = decision; form.Close(); }; buttons.Controls.Add(button);
            if (decision == ConflictDecision.Cancel) form.CancelButton = button;
        }
        form.Controls.Add(split); form.Controls.Add(text); form.Controls.Add(buttons); form.ShowDialog(owner); return result;
    }
    private static void AddPreview(Control parent, string caption, string text)
    {
        var box = new TextBox { Text = text, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 10), AccessibleName = caption };
        parent.Controls.Add(box); parent.Controls.Add(new Label { Text = caption, Dock = DockStyle.Top, Height = 30, Padding = new Padding(8) });
    }
    public static RecoveryEntry? Recover(IWin32Window owner, IReadOnlyList<RecoveryEntry> entries, Action<RecoveryEntry> remove)
    {
        using var form = new Form { Text = "Чернетки відновлення", Width = 900, Height = 620, StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false };
        var list = new ListBox { Dock = DockStyle.Top, Height = 130, AccessibleName = "Чернетки" };
        var available = entries.ToList();
        void Populate() { list.Items.Clear(); foreach (var entry in available) list.Items.Add($"{entry.Draft.UpdatedUtc.ToLocalTime():g} — {entry.Draft.Path ?? "Без назви"}"); if (list.Items.Count > 0) list.SelectedIndex = 0; }
        var preview = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 10), AccessibleName = "Вміст чернетки" };
        list.SelectedIndexChanged += (_, _) => preview.Text = list.SelectedIndex < 0 ? "" : available[list.SelectedIndex].Draft.Markdown;
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 55, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        RecoveryEntry? selected = null;
        var defer = new Button { Text = "Відкласти", AutoSize = true }; defer.Click += (_, _) => form.Close(); form.CancelButton = defer;
        var restore = new Button { Text = "Відновити", AutoSize = true }; restore.Click += (_, _) => { if (list.SelectedIndex >= 0) { selected = available[list.SelectedIndex]; form.Close(); } }; form.AcceptButton = restore;
        var delete = new Button { Text = "Видалити чернетку", AutoSize = true }; delete.Click += (_, _) => {
            if (list.SelectedIndex < 0 || MessageBox.Show(form, "Видалити цю чернетку остаточно?", "Видалення чернетки", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            var entry = available[list.SelectedIndex]; remove(entry); available.Remove(entry); Populate();
        };
        buttons.Controls.AddRange([defer, restore, delete]); form.Controls.Add(preview); form.Controls.Add(list); form.Controls.Add(buttons); Populate(); form.ShowDialog(owner); return selected;
    }
    public static string? FileName(IWin32Window owner, string current)
    {
        using var form = new Form { Text = "Нове ім’я вкладення", Width = 500, Height = 210, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MinimizeBox = false, MaximizeBox = false };
        var input = new TextBox { Text = current, Dock = DockStyle.Top, AccessibleName = "Нове ім’я файла" };
        var note = new Label { Text = "Оновляться посилання в поточному документі. Старий файл залишиться для Undo та інших документів.", Dock = DockStyle.Top, Height = 62, Padding = new Padding(8) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40, FlowDirection = FlowDirection.RightToLeft };
        var ok = new Button { Text = "Створити копію з новим ім’ям", DialogResult = DialogResult.OK, AutoSize = true }; form.AcceptButton = ok;
        var cancel = new Button { Text = "Скасувати", DialogResult = DialogResult.Cancel, AutoSize = true }; form.CancelButton = cancel;
        buttons.Controls.AddRange([cancel, ok]); form.Controls.Add(input); form.Controls.Add(note); form.Controls.Add(buttons);
        return form.ShowDialog(owner) == DialogResult.OK ? input.Text : null;
    }
}
