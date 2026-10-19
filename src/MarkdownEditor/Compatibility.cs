namespace MarkdownEditor;

internal static class Compatibility
{
    public static void ReadExactly(Stream stream, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = stream.Read(buffer, offset, buffer.Length - offset);
            if (read == 0) throw new EndOfStreamException();
            offset += read;
        }
    }

    public static bool StartsWith(byte[] bytes, params byte[] prefix)
    {
        if (bytes.Length < prefix.Length) return false;
        for (var index = 0; index < prefix.Length; index++)
            if (bytes[index] != prefix[index]) return false;
        return true;
    }

    public static bool BytesEqual(byte[] left, byte[] right)
    {
        if (left.Length != right.Length) return false;
        for (var index = 0; index < left.Length; index++)
            if (left[index] != right[index]) return false;
        return true;
    }

    public static string RelativePath(string directory, string path)
    {
        var fullDirectory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(path);
        var relative = new Uri(fullDirectory).MakeRelativeUri(new Uri(fullPath)).ToString();
        return Uri.UnescapeDataString(relative).Replace('/', Path.DirectorySeparatorChar);
    }

    public static void ReplaceFile(string source, string target)
    {
        if (File.Exists(target)) File.Replace(source, target, null);
        else File.Move(source, target);
    }

    public static async Task<T> WithTimeout<T>(Task<T> task, TimeSpan timeout)
    {
        if (await Task.WhenAny(task, Task.Delay(timeout)).ConfigureAwait(true) != task)
            throw new TimeoutException("The editor did not respond before the operation timed out.");
        return await task.ConfigureAwait(true);
    }
}
