using System.Text;
using MarkdownEditor;

var directory = Path.GetFullPath(Path.Combine("artifacts", "file-tests", Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(directory);
int passed = 0;
void Check(bool condition) { if (!condition) throw new Exception("Assertion failed"); passed++; }
void Throws(Action action) { try { action(); } catch (Exception e) when (e is IOException or DecoderFallbackException) { passed++; return; } throw new Exception("Expected file operation failure"); }
var text = "# Привіт\r\n\r\n**Український текст**\r\n";
Check(DocumentFiles.Decode(Encoding.UTF8.GetBytes(text)) == text);
Check(DocumentFiles.Decode(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(text)).ToArray()) == text);
Check(DocumentFiles.Decode(Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(text)).ToArray()) == text);
Check(DocumentFiles.Decode(Encoding.BigEndianUnicode.GetPreamble().Concat(Encoding.BigEndianUnicode.GetBytes(text)).ToArray()) == text);
Throws(() => DocumentFiles.Decode(new byte[] { 0xff, 0xff, 0x80 }));
Throws(() => DocumentFiles.Decode(new byte[] { 0xff, 0xfe, 0, 0, 1, 0, 0, 0 }));
var path = Path.Combine(directory, "test.md");
var original = DocumentFiles.Save(path, text, null, false);
Check(DocumentFiles.Decode(DocumentFiles.ReadBytes(path)) == text);
var updated = DocumentFiles.Save(path, text + "Зміни", original, true);
Check(DocumentFiles.ReadBytes(path).SequenceEqual(updated));
File.WriteAllText(path, "Зовнішні зміни");
Throws(() => DocumentFiles.Save(path, "Overwrite", updated, true));
Check(File.ReadAllText(path) == "Зовнішні зміни");
File.Delete(path);
Throws(() => DocumentFiles.Save(path, text, updated, true));
Throws(() => DocumentFiles.ReadBytes(Path.Combine(directory, "missing.md")));
Throws(() => DocumentFiles.Save(Path.Combine(directory, "missing", "file.md"), text, null, false));
Throws(() => DocumentFiles.Save(path, new string('x', DocumentFiles.MaxBytes + 1), null, false));
Check(Directory.GetFiles(directory, "*.tmp").Length == 0);
Console.WriteLine($"Passed {passed} file/encoding/conflict assertions.");
