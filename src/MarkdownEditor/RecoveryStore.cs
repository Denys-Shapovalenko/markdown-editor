using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace MarkdownEditor;

internal sealed record RecoveryDraft(int Version, string? Path, string Markdown, string SavedMarkdown, byte[]? DiskBytes, DateTime UpdatedUtc, int ProcessId, long ProcessStartedTicks);
internal sealed record RecoveryEntry(string File, RecoveryDraft Draft);

internal sealed class RecoveryStore
{
    private readonly string directory;
    private readonly string sessionFile;
    private static readonly JsonSerializerOptions JsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public RecoveryStore(string directory)
    {
        this.directory = System.IO.Path.GetFullPath(directory);
        sessionFile = System.IO.Path.Combine(this.directory, Guid.NewGuid().ToString("N") + ".json");
    }
    public void Write(RecoveryDraft draft) => WriteFile(sessionFile, draft);
    public void KeepCopy(RecoveryDraft draft) => WriteFile(System.IO.Path.Combine(directory, Guid.NewGuid().ToString("N") + ".json"), draft with { ProcessId = 0, ProcessStartedTicks = 0 });
    private static void Validate(RecoveryDraft draft)
    {
        if (draft.Version != 1 || draft.Markdown is null || draft.SavedMarkdown is null || Encoding.UTF8.GetByteCount(draft.Markdown) > DocumentFiles.MaxBytes || Encoding.UTF8.GetByteCount(draft.SavedMarkdown) > DocumentFiles.MaxBytes || draft.DiskBytes?.Length > DocumentFiles.MaxBytes)
            throw new IOException("Некоректна або завелика чернетка відновлення.");
    }
    private void WriteFile(string target, RecoveryDraft draft)
    {
        Validate(draft); Directory.CreateDirectory(directory);
        var temporary = target + ".tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(draft, JsonOptions);
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None)) { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
            Compatibility.ReplaceFile(temporary, target);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public void Clear() { if (File.Exists(sessionFile)) File.Delete(sessionFile); }
    public IReadOnlyList<RecoveryEntry> Available()
    {
        if (!Directory.Exists(directory)) return [];
        var result = new List<RecoveryEntry>();
        foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
        {
            if (file == sessionFile || !Guid.TryParseExact(System.IO.Path.GetFileNameWithoutExtension(file), "N", out _)) continue;
            try
            {
                if (new FileInfo(file).Length > 24 * 1024 * 1024) continue;
                var draft = JsonSerializer.Deserialize<RecoveryDraft>(File.ReadAllBytes(file));
                if (draft is null) continue; Validate(draft);
                if (IsAlive(draft)) continue;
                result.Add(new RecoveryEntry(file, draft));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { /* Keep unreadable drafts for manual recovery. */ }
        }
        return result.OrderByDescending(e => e.Draft.UpdatedUtc).ToArray();
    }
    private static bool IsAlive(RecoveryDraft draft)
    {
        if (draft.ProcessId <= 0) return false;
        try { using var process = Process.GetProcessById(draft.ProcessId); return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == draft.ProcessStartedTicks; }
        catch (ArgumentException) { return false; }
        catch (System.ComponentModel.Win32Exception) { return true; }
        catch (InvalidOperationException) { return false; }
    }
    public void Remove(RecoveryEntry entry)
    {
        var path = System.IO.Path.GetFullPath(entry.File);
        if (System.IO.Path.GetDirectoryName(path) != directory || !Guid.TryParseExact(System.IO.Path.GetFileNameWithoutExtension(path), "N", out _) || System.IO.Path.GetExtension(path) != ".json") throw new IOException("Некоректний шлях чернетки.");
        if (File.Exists(path)) File.Delete(path);
    }
}
