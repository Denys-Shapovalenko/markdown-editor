using System.Text;

namespace MarkdownEditor;

internal sealed class DocumentConflictException(string message) : IOException(message);

internal static class DocumentFiles
{
    public const int MaxBytes = 5 * 1024 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);

    public static byte[] ReadBytes(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaxBytes) throw new IOException("Файл перевищує ліміт 5 MiB. Відкрийте менший документ.");
        var bytes = new byte[(int)stream.Length];
        Compatibility.ReadExactly(stream, bytes);
        return bytes;
    }

    public static string Decode(byte[] bytes)
    {
        try { return DecodeCore(bytes); }
        catch (DecoderFallbackException) { throw new IOException("Не вдалося прочитати кодування файла. Підтримуються UTF-8 та UTF-16 із BOM; перезбережіть файл у UTF-8."); }
    }

    private static string DecodeCore(byte[] bytes)
    {
        if (Compatibility.StartsWith(bytes, 0xff, 0xfe, 0, 0) || Compatibility.StartsWith(bytes, 0, 0, 0xfe, 0xff))
            throw new IOException("UTF-32 не підтримується. Перезбережіть файл у UTF-8.");
        if (Compatibility.StartsWith(bytes, 0xff, 0xfe)) return new UnicodeEncoding(false, true, true).GetString(bytes, 2, bytes.Length - 2);
        if (Compatibility.StartsWith(bytes, 0xfe, 0xff)) return new UnicodeEncoding(true, true, true).GetString(bytes, 2, bytes.Length - 2);
        var offset = Compatibility.StartsWith(bytes, 0xef, 0xbb, 0xbf) ? 3 : 0;
        var text = Utf8.GetString(bytes, offset, bytes.Length - offset);
        if (text.IndexOf('\0') >= 0) throw new IOException("Файл містить нульові символи. Переконайтеся, що це Markdown у UTF-8.");
        return text;
    }

    public static byte[] Save(string path, string markdown, byte[]? expectedBytes, bool checkConflict)
    {
        var bytes = Utf8.GetBytes(markdown);
        if (bytes.Length > MaxBytes) throw new IOException("Документ перевищує ліміт 5 MiB.");
        var fullPath = Path.GetFullPath(path);
        void CheckConflict()
        {
            if (checkConflict && (!File.Exists(fullPath) || expectedBytes is null || !Compatibility.BytesEqual(ReadBytes(fullPath), expectedBytes)))
                throw new DocumentConflictException("Файл змінився або був видалений іншою програмою.");
        }
        CheckConflict();
        var temporary = Path.Combine(Path.GetDirectoryName(fullPath)!, $".{Path.GetFileName(fullPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            CheckConflict();
            if (File.Exists(fullPath)) File.Replace(temporary, fullPath, null);
            else File.Move(temporary, fullPath);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return bytes;
    }
}
