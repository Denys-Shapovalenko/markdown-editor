using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
    private const string AppName = "MarkdownEditor.exe";
    private static readonly string[] TestModes = { "--smoke-test", "--test-session", "--test-recover" };

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            ClearPreviousErrorLog();
            var appFolder = ExtractBundle();
            var appPath = Path.Combine(appFolder, AppName);
            var start = new ProcessStartInfo
            {
                FileName = appPath,
                WorkingDirectory = appFolder,
                Arguments = string.Join(" ", args.Select(QuoteArgument)),
                UseShellExecute = false
            };
            using var app = Process.Start(start) ?? throw new IOException("Не вдалося запустити Markdown Редактор.");
            if (args.Length > 0 && TestModes.Contains(args[0], StringComparer.Ordinal))
            {
                if (!app.WaitForExit(60000))
                {
                    try { app.Kill(); } catch (InvalidOperationException) { }
                    throw new TimeoutException("Перевірка редактора не завершилася за 60 секунд.");
                }
                return app.ExitCode;
            }
            return 0;
        }
        catch (Exception ex)
        {
            try
            {
                var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor", "launcher-error.log");
                Directory.CreateDirectory(Path.GetDirectoryName(log)!);
                File.WriteAllText(log, ex.ToString(), Encoding.UTF8);
            }
            catch { }
            if (args.Length == 0 || !TestModes.Contains(args[0], StringComparer.Ordinal))
                MessageBox.Show("Не вдалося запустити Markdown Редактор.\r\n\r\n" + ex.Message, "Markdown Редактор", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void ClearPreviousErrorLog()
    {
        try
        {
            var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor", "launcher-error.log");
            if (File.Exists(log)) File.Delete(log);
        }
        catch { }
    }

    private static string ExtractBundle()
    {
        using var bundle = Assembly.GetExecutingAssembly().GetManifestResourceStream("MarkdownEditor.bundle.zip")
            ?? throw new InvalidOperationException("У програмі відсутні вбудовані файли редактора.");
        using var sha = SHA256.Create();
        var hash = BitConverter.ToString(sha.ComputeHash(bundle)).Replace("-", "").ToLowerInvariant();
        bundle.Position = 0;

        var packages = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor", "Packages");
        var target = Path.Combine(packages, hash);
        if (File.Exists(Path.Combine(target, AppName))) return target;

        Directory.CreateDirectory(packages);
        var temporary = target + ".tmp-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(temporary);
        try
        {
            using (var archive = new ZipArchive(bundle, ZipArchiveMode.Read, leaveOpen: false))
            {
                foreach (var entry in archive.Entries)
                {
                    var relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    var destination = Path.GetFullPath(Path.Combine(temporary, relative));
                    if (!destination.StartsWith(temporary + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Архів містить некоректний шлях.");
                    if (entry.Name.Length == 0 || entry.FullName.EndsWith("/", StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    using var input = entry.Open();
                    using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    input.CopyTo(output);
                }
            }
            if (!File.Exists(Path.Combine(temporary, AppName))) throw new InvalidDataException("В архіві відсутній виконуваний файл редактора.");
            try { Directory.Move(temporary, target); }
            catch (IOException) when (File.Exists(Path.Combine(target, AppName))) { Directory.Delete(temporary, recursive: true); }
            return target;
        }
        catch
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, recursive: true);
            throw;
        }
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && !value.Any(char.IsWhiteSpace) && value.IndexOf('"') < 0) return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }
}
