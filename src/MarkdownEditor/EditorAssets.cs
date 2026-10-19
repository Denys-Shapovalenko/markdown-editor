using System.Reflection;

namespace MarkdownEditor;

// Resolve resources by their manifest names, without assembly paths or loose files.
// This also works when the application assembly lives inside a single-file EXE.
internal sealed class EditorAssets
{
    private readonly Assembly assembly = typeof(EditorAssets).Assembly;
    private readonly Dictionary<string, string> resources;

    public EditorAssets()
    {
        resources = assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith("Editor/", StringComparison.Ordinal))
            .ToDictionary(name => name[7..].Replace('\\', '/'), name => name, StringComparer.Ordinal);
        foreach (var required in new[] { "index.html", "editor.css", "editor.js", "markdown.js", "icons.js", "vendor/marked.js", "vendor/marked.LICENSE" })
            if (!resources.ContainsKey(required)) throw new IOException($"У збірці відсутній ресурс редактора: {required}");
    }

    public (Stream Content, string ContentType)? Open(Uri uri)
    {
        if (uri.Scheme != "https" || uri.Host != "editor.local" || !uri.IsDefaultPort) return null;
        var path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (!resources.TryGetValue(path, out var name)) return null;
        var stream = assembly.GetManifestResourceStream(name) ?? throw new IOException($"Ресурс недоступний: {path}");
        var type = Path.GetExtension(path) switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            _ => "text/plain; charset=utf-8"
        };
        return (stream, type);
    }
}
