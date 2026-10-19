namespace MarkdownEditor;

internal interface IDocumentDialogs
{
    DialogResult ConfirmSave(IWin32Window owner);
    string? Open(IWin32Window owner);
    string? Save(IWin32Window owner, string? currentPath);
}

internal sealed class WindowsDocumentDialogs : IDocumentDialogs
{
    public DialogResult ConfirmSave(IWin32Window owner) => MessageBox.Show(owner, "Зберегти зміни перед продовженням?", "Незбережені зміни", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
    public string? Open(IWin32Window owner)
    {
        using var dialog = new OpenFileDialog { Filter = "Markdown (*.md)|*.md", CheckFileExists = true, Title = "Відкрити Markdown" };
        return dialog.ShowDialog(owner) == DialogResult.OK ? dialog.FileName : null;
    }
    public string? Save(IWin32Window owner, string? currentPath)
    {
        using var dialog = new SaveFileDialog { Filter = "Markdown (*.md)|*.md", DefaultExt = "md", AddExtension = true, OverwritePrompt = true, FileName = currentPath is null ? "Документ.md" : Path.GetFileName(currentPath), Title = "Зберегти Markdown" };
        return dialog.ShowDialog(owner) == DialogResult.OK ? dialog.FileName : null;
    }
}

// Used only by the explicit --smoke-test mode; the normal application always uses system dialogs.
internal sealed class SmokeDocumentDialogs : IDocumentDialogs
{
    public ConflictDecision ConflictAnswer { get; set; } = ConflictDecision.Cancel;
    public DialogResult Answer { get; set; } = DialogResult.Cancel;
    public string? OpenPath { get; set; }
    public string? SavePath { get; set; }
    public int Prompts { get; private set; }
    public DialogResult ConfirmSave(IWin32Window owner) { Prompts++; return Answer; }
    public string? Open(IWin32Window owner) => OpenPath;
    public string? Save(IWin32Window owner, string? currentPath) => SavePath;
}
