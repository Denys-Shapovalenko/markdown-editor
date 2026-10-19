using System.Net;
using System.Text.RegularExpressions;

namespace MarkdownEditor;

internal static class DocumentImages
{
    private static readonly Regex ImageSourcePattern = new("\\bsrc=\"([^\"]*)\"", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase) { [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp", [".svg"] = "image/svg+xml", [".bmp"] = "image/bmp" };
    public static string? Resolve(string? documentPath, string relative)
    {
        if (documentPath is null || string.IsNullOrWhiteSpace(relative)) return null;
        var decoded = Uri.UnescapeDataString(relative.Split('?', '#')[0]);
        if (decoded.IndexOf(':') >= 0 || decoded.StartsWith("/", StringComparison.Ordinal) || decoded.StartsWith("\\", StringComparison.Ordinal)) return null;
        var root = Path.GetDirectoryName(Path.GetFullPath(documentPath))!;
        var full = Path.GetFullPath(Path.Combine(root, decoded.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !Types.ContainsKey(Path.GetExtension(full))) return null;
        // Do not follow junctions/symlinks out of the document folder.
        var current = full;
        while (!string.Equals(current, root, StringComparison.OrdinalIgnoreCase))
        {
            if ((File.Exists(current) || Directory.Exists(current)) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint)) return null;
            current = Path.GetDirectoryName(current)!;
        }
        return full;
    }
    public static (byte[] Bytes, string Type)? Read(string? documentPath, string relative)
    {
        var full = Resolve(documentPath, relative);
        if (full is null || !File.Exists(full)) return null;
        using var stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > 20 * 1024 * 1024) throw new IOException("Зображення перевищує ліміт 20 MiB.");
        var bytes = new byte[(int)stream.Length]; Compatibility.ReadExactly(stream, bytes); return (bytes, Types[Path.GetExtension(full)]);
    }
    public static string Relative(string documentPath, string fullPath) => string.Join("/", Compatibility.RelativePath(Path.GetDirectoryName(Path.GetFullPath(documentPath))!, fullPath).Split(Path.DirectorySeparatorChar).Select(Uri.EscapeDataString));
    public static string Import(string documentPath, string sourcePath)
    {
        if (!Types.ContainsKey(Path.GetExtension(sourcePath))) throw new IOException("Непідтримуваний формат зображення.");
        if (new FileInfo(sourcePath).Length > 20 * 1024 * 1024) throw new IOException("Зображення перевищує ліміт 20 MiB.");
        var relative = Relative(documentPath, sourcePath);
        if (Resolve(documentPath, relative) is not null) return relative;
        var folder = Path.Combine(Path.GetDirectoryName(documentPath)!, "images");
        if (Directory.Exists(folder) && File.GetAttributes(folder).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Папка images не повинна бути символічним посиланням.");
        Directory.CreateDirectory(folder);
        var target = Path.Combine(folder, Path.GetFileNameWithoutExtension(sourcePath) + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + Path.GetExtension(sourcePath));
        File.Copy(sourcePath, target, false); return Relative(documentPath, target);
    }
    public static string RenameCopy(string documentPath, string relative, string newName)
    {
        var original = Resolve(documentPath, relative) ?? throw new IOException("Виберіть локальне вкладення з папки документа.");
        if (newName != Path.GetFileName(newName) || newName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || string.IsNullOrWhiteSpace(newName) || !string.Equals(Path.GetExtension(original), Path.GetExtension(newName), StringComparison.OrdinalIgnoreCase)) throw new IOException("Вкажіть ім’я без шляху та зі збереженням розширення.");
        var target = Path.Combine(Path.GetDirectoryName(original)!, newName);
        if (string.Equals(target, original, StringComparison.OrdinalIgnoreCase)) return relative;
        File.Copy(original, target, false); return Relative(documentPath, target);
    }
    public static void CopyForSaveAs(string originalDocument, string targetDocument, IEnumerable<string> images)
    {
        foreach (var relative in images.Distinct())
        {
            var original = Resolve(originalDocument, relative); var target = Resolve(targetDocument, relative);
            if (original is null || target is null || !File.Exists(original) || string.Equals(original, target, StringComparison.OrdinalIgnoreCase)) continue;
            if (File.Exists(target))
            {
                if (!Compatibility.BytesEqual(File.ReadAllBytes(original), File.ReadAllBytes(target))) throw new IOException($"Інше вкладення вже існує: {target}. Виберіть іншу папку для збереження.");
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(original, target, false);
        }
    }
    public static string EmbedHtml(string html, string? documentPath)
    {
        return ImageSourcePattern.Replace(html, match => {
            var src = WebUtility.HtmlDecode(match.Groups[1].Value);
            var image = Read(documentPath, src);
            return image is { } found ? $"src=\"data:{found.Type};base64,{Convert.ToBase64String(found.Bytes)}\"" : "";
        });
    }
}
