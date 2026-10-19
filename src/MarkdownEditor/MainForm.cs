using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MarkdownEditor;

internal sealed class MainForm : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly string[] arguments;
    private readonly IDocumentDialogs dialogs;
    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> pending = new();
    private string? filePath;
    private byte[]? diskBytes;
    private bool dirty, ready, busy, allowClose;
    private readonly System.Windows.Forms.Timer startupTimer = new() { Interval = 30000 };
    private readonly System.Windows.Forms.Timer recoveryTimer = new() { Interval = 2000 };
    private readonly RecoveryStore recovery;
    private bool recoveryWriting;
    private bool recoveryWarning;
    private long documentEpoch;

    public MainForm(string[] args)
    {
        arguments = args;
        var testMode = args.Length == 2 && args[0] is "--smoke-test" or "--test-session" or "--test-recover";
        var dataRoot = testMode ? Path.GetFullPath(args[1]) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor");
        recovery = new RecoveryStore(Path.Combine(dataRoot, "Recovery"));
        dialogs = testMode ? new SmokeDocumentDialogs() : new WindowsDocumentDialogs();
        Text = "Без назви — Markdown Редактор";
        Width = 1160; Height = 850; MinimumSize = new Size(760, 500);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);
        Shown += async (_, _) => await InitializeAsync();
        FormClosing += OnFormClosing;
        startupTimer.Tick += (_, _) => { startupTimer.Stop(); if (!ready) ShowError("Редактор не запустився за 30 секунд. Перезапустіть програму й перевірте WebView2 Runtime."); };
        recoveryTimer.Tick += async (_, _) => await WriteRecoveryAsync();
    }

    private async Task InitializeAsync()
    {
        try
        {
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor", "WebView2");
            // Smoke tests keep their runtime data in the requested test folder.
            if (arguments.Length == 2 && arguments[0] is "--smoke-test" or "--test-session" or "--test-recover") profile = Path.Combine(Path.GetFullPath(arguments[1]), "profile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            var assets = new EditorAssets();
            core.AddWebResourceRequestedFilter("https://editor.local/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) =>
            {
                var resource = assets.Open(new Uri(e.Request.Uri));
                if (resource is null && e.ResourceContext == CoreWebView2WebResourceContext.Image)
                {
                    try
                    {
                        var image = DocumentImages.Read(filePath, new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
                        if (image is { } foundImage) resource = (new MemoryStream(foundImage.Bytes), foundImage.Type);
                    }
                    catch (IOException) { /* A missing/blocked image remains visible via its alt text. */ }
                    catch (UnauthorizedAccessException) { }
                }
                e.Response = resource is { } found
                    ? environment.CreateWebResourceResponse(found.Content, 200, "OK", $"Content-Type: {found.ContentType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
                    : environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not Found", "Content-Type: text/plain\r\nCache-Control: no-store");
            };
            core.NavigationStarting += (_, e) => { if (e.Uri != "https://editor.local/index.html") e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += Receive;
            core.ProcessFailed += (_, _) => ShowError("Процес редактора завершився. Не закривайте програму, якщо залишилися незбережені зміни; збереження зараз може бути недоступним.");
            startupTimer.Start();
            core.Navigate("https://editor.local/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowError("Не знайдено Microsoft Edge WebView2 Runtime. Встановіть Evergreen Runtime з https://developer.microsoft.com/microsoft-edge/webview2/ і запустіть програму знову.");
        }
        catch (Exception ex) { ShowError($"Не вдалося запустити редактор: {ex.Message}"); }
    }

    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != "https://editor.local/index.html") return;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var message = document.RootElement;
            var type = message.GetProperty("type").GetString();
            if (message.TryGetProperty("requestId", out var id) && pending.Remove(id.GetString()!, out var completion))
            { completion.SetResult(message.Clone()); return; }
            if (type == "ready")
            {
                ready = true; startupTimer.Stop();
                BeginInvoke(async () =>
                {
                    if (arguments.Length == 2 && arguments[0] == "--smoke-test") await SmokeTestAsync(arguments[1]);
                    else if (arguments.Length == 2 && arguments[0] == "--test-session")
                    {
                        Directory.CreateDirectory(arguments[1]);
                        var original = Path.Combine(Path.GetFullPath(arguments[1]), "Original.md");
                        if (!File.Exists(original)) File.WriteAllText(original, "# Baseline\n\nOriginal file\n");
                        var bytes = DocumentFiles.ReadBytes(original); await LoadAsync(DocumentFiles.Decode(bytes), original, bytes); recoveryTimer.Start();
                    }
                    else if (arguments.Length == 2 && arguments[0] == "--test-recover") await RecoverySmokeAsync(arguments[1]);
                    else
                    {
                        if (arguments.Length == 1) await RunActionAsync("openPath");
                        else await RecoverAsync(false);
                        recoveryTimer.Start();
                    }
                });
            }
            else if (type == "changed") { dirty = message.GetProperty("dirty").GetBoolean(); UpdateTitle(); }
            else if (type == "command")
            {
                var command = message.GetProperty("command").GetString()!;
                var context = message.Clone();
                BeginInvoke(async () => await RunActionAsync(command, context));
            }
            else if (type == "clipboardWrite")
            {
                var context = message.Clone();
                BeginInvoke(async () =>
                {
                    try
                    {
                        var data = new DataObject(); data.SetData(DataFormats.UnicodeText, context.GetProperty("text").GetString() ?? "");
                        data.SetData("text/markdown", context.GetProperty("markdown").GetString() ?? ""); Clipboard.SetDataObject(data, true);
                        if (context.TryGetProperty("cut", out var cut) && cut.GetBoolean()) await RequestAsync("cutConfirmed");
                    }
                    catch (Exception ex) { ShowError($"Не вдалося записати буфер обміну: {ex.Message}"); }
                });
            }
            else if (type == "error")
            {
                var errorText = message.GetProperty("message").GetString() ?? "Помилка редактора.";
                BeginInvoke(() => ShowError(errorText));
            }
        }
        catch (Exception ex) { ShowError($"Помилка обміну з редактором: {ex.Message}"); }
    }

    private void Send(object message) => web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    private async Task<JsonElement> RequestAsync(string type, object? payload = null)
    {
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        Send(new { type, requestId = id, payload });
        try
        {
            var response = await completion.Task.WaitAsync(TimeSpan.FromSeconds(20));
            if (response.TryGetProperty("error", out var error)) throw new IOException(error.GetString());
            return response;
        }
        finally { pending.Remove(id); }
    }

    private async Task RunActionAsync(string command, JsonElement? context = null)
    {
        if (busy || !ready) return;
        if (command is "paste" or "pasteMarkdown")
        {
            try
            {
                var text = Clipboard.ContainsText() ? Clipboard.GetText() : "";
                var html = Clipboard.ContainsText(TextDataFormat.Html) ? Clipboard.GetText(TextDataFormat.Html) : "";
                Clipboard.TryGetData<string>("text/markdown", out var markdown);
                markdown ??= "";
                await RequestAsync("clipboard", new { text, html, markdown, mode = command == "pasteMarkdown" ? "markdown" : "auto" });
            }
            catch (Exception ex) { ShowError($"Не вдалося прочитати буфер обміну: {ex.Message}"); }
            return;
        }
        busy = true; Send(new { type = "busy", value = true });
        try
        {
            switch (command)
            {
                case "save": await SaveAsync(false); break;
                case "saveAs": await SaveAsync(true); break;
                case "new":
                    if (await ConfirmDiscardAsync()) await LoadAsync("", null, null);
                    break;
                case "open":
                case "openPath":
                    if (!await ConfirmDiscardAsync()) break;
                    string? path = command == "openPath" ? arguments[0] : null;
                    if (path is null)
                    {
                        path = dialogs.Open(this);
                        if (path is null) break;
                    }
                    var bytes = DocumentFiles.ReadBytes(path);
                    await LoadAsync(DocumentFiles.Decode(bytes), path, bytes);
                    break;
                case "close":
                    if (await ConfirmDiscardAsync()) { recovery.Clear(); recoveryTimer.Stop(); allowClose = true; Close(); }
                    break;
                case "reload":
                    if (filePath is null) { ShowError("Спочатку відкрийте або збережіть документ."); break; }
                    await ResolveConflictAsync((await RequestAsync("export")).GetProperty("markdown").GetString()!);
                    break;
                case "testZoom" when dialogs is SmokeDocumentDialogs:
                    var zoom = context?.GetProperty("zoom").GetDouble() ?? 1;
                    if (zoom is 1 or 1.25 or 1.5) web.ZoomFactor = zoom;
                    break;
                case "recoverDocuments": await RecoverAsync(true); break;
                case "chooseImage":
                    if (filePath is null && !await SaveAsync(false)) break;
                    using (var imageDialog = new OpenFileDialog { Filter = "Зображення|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.bmp", Title = "Додати локальне зображення" })
                        if (imageDialog.ShowDialog(this) == DialogResult.OK)
                            await RequestAsync("imageChosen", new { path = DocumentImages.Import(filePath!, imageDialog.FileName) });
                    break;
                case "renameImage":
                    var relative = context?.GetProperty("path").GetString();
                    if (filePath is null || relative is null) break;
                    var current = DocumentImages.Resolve(filePath, relative) ?? throw new IOException("Виберіть локальне зображення.");
                    var newName = VersionDialogs.FileName(this, Path.GetFileName(current));
                    if (newName is not null) await RequestAsync("imageRenamed", new { oldPath = relative, path = DocumentImages.RenameCopy(filePath, relative, newName) });
                    break;
                case "print":
                    await RequestAsync("preparePrint"); await RequestAsync("awaitImages"); web.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.Browser); break;
                case "pdf":
                case "html":
                    using (var exportDialog = new SaveFileDialog { Filter = command == "pdf" ? "PDF (*.pdf)|*.pdf" : "HTML (*.html)|*.html", DefaultExt = command, AddExtension = true, OverwritePrompt = true, FileName = Path.GetFileNameWithoutExtension(filePath ?? "Документ") + "." + command, Title = "Експорт документа" })
                    {
                        if (exportDialog.ShowDialog(this) != DialogResult.OK) break;
                        if (command == "pdf")
                        {
                            await RequestAsync("preparePrint");
                            await RequestAsync("awaitImages");
                            if (!await web.CoreWebView2.PrintToPdfAsync(exportDialog.FileName)) throw new IOException("Не вдалося створити PDF.");
                        }
                        else
                        {
                            var exported = await RequestAsync("html");
                            var html = DocumentImages.EmbedHtml(exported.GetProperty("html").GetString()!, filePath);
                            File.WriteAllText(exportDialog.FileName, html, new System.Text.UTF8Encoding(false));
                        }
                        await RequestAsync("notice", new { message = "Експортовано: " + exportDialog.FileName });
                    }
                    break;
            }
        }
        catch (UnauthorizedAccessException) { ShowError("Немає доступу до файла або папки. Перевірте права доступу або скористайтеся «Зберегти як» і виберіть іншу папку."); }
        catch (Exception ex) { ShowError($"Операцію не завершено. {ex.Message}"); }
        finally { busy = false; if (!IsDisposed && web.CoreWebView2 is not null) Send(new { type = "busy", value = false }); }
    }

    private async Task LoadAsync(string markdown, string? path, byte[]? bytes)
    {
        // Relative image requests must resolve against the incoming document, not the previous file.
        var previousPath = filePath; var previousBytes = diskBytes;
        filePath = path; diskBytes = bytes;
        try { await RequestAsync("load", new { markdown, name = path is null ? "Без назви" : Path.GetFileName(path) }); }
        catch { filePath = previousPath; diskBytes = previousBytes; throw; }
        filePath = path; diskBytes = bytes; dirty = false; UpdateTitle();
        documentEpoch++;
        recovery.Clear();
    }

    private async Task<bool> SaveAsync(bool saveAs)
    {
        var snapshot = await RequestAsync("export");
        var markdown = snapshot.GetProperty("markdown").GetString()!;
        string? target = filePath;
        if (saveAs || target is null)
        {
            target = dialogs.Save(this, filePath);
            if (target is null) return false;
        }
        bool samePath = filePath is not null && string.Equals(Path.GetFullPath(target), Path.GetFullPath(filePath), StringComparison.OrdinalIgnoreCase);
        if (!string.Equals(Path.GetExtension(target), ".md", StringComparison.OrdinalIgnoreCase)) throw new IOException("Виберіть ім’я файла з розширенням .md.");
        if (!samePath && filePath is not null)
        {
            var attachments = await RequestAsync("attachments");
            DocumentImages.CopyForSaveAs(filePath, target, attachments.GetProperty("images").EnumerateArray().Select(value => value.GetString()!).ToArray());
        }
        try { diskBytes = DocumentFiles.Save(target, markdown, diskBytes, samePath); }
        catch (DocumentConflictException) { return await ResolveConflictAsync(markdown); }
        filePath = target;
        await RequestAsync("saved", new { name = Path.GetFileName(target) });
        dirty = false; documentEpoch++; recovery.Clear(); UpdateTitle(); return true;
    }

    private async Task<bool> ResolveConflictAsync(string ours)
    {
        if (filePath is null) return false;
        string theirs;
        try { theirs = DocumentFiles.Decode(DocumentFiles.ReadBytes(filePath)); }
        catch (IOException ex) { theirs = "Не вдалося прочитати файл: " + ex.Message; }
        var decision = dialogs is SmokeDocumentDialogs smoke ? smoke.ConflictAnswer : VersionDialogs.Conflict(this, ours, theirs);
        if (decision == ConflictDecision.SaveCopy)
        {
            var target = dialogs.Save(this, filePath);
            if (target is null) return false;
            if (string.Equals(Path.GetFullPath(target), Path.GetFullPath(filePath), StringComparison.OrdinalIgnoreCase)) throw new IOException("Для копії виберіть інше ім’я файла.");
            if (!string.Equals(Path.GetExtension(target), ".md", StringComparison.OrdinalIgnoreCase)) throw new IOException("Виберіть файл .md.");
            var attachments = await RequestAsync("attachments");
            DocumentImages.CopyForSaveAs(filePath, target, attachments.GetProperty("images").EnumerateArray().Select(value => value.GetString()!).ToArray());
            diskBytes = DocumentFiles.Save(target, ours, null, false); filePath = target;
            await RequestAsync("saved", new { name = Path.GetFileName(target) }); dirty = false; recovery.Clear(); UpdateTitle(); return true;
        }
        if (decision == ConflictDecision.Reload)
        {
            var bytes = DocumentFiles.ReadBytes(filePath); var source = DocumentFiles.Decode(bytes);
            recovery.KeepCopy(await CurrentDraftAsync()); await LoadAsync(source, filePath, bytes);
            await RequestAsync("notice", new { message = "Файл перечитано. Попередні правки доступні через «Відновити чернетку»." });
        }
        return false;
    }
    private async Task<RecoveryDraft> CurrentDraftAsync()
    {
        var path = filePath; var bytes = diskBytes;
        var snapshot = await RequestAsync("recovery");
        using var process = System.Diagnostics.Process.GetCurrentProcess();
        return new RecoveryDraft(1, path, snapshot.GetProperty("markdown").GetString()!, snapshot.GetProperty("savedMarkdown").GetString()!, bytes, DateTime.UtcNow, process.Id, process.StartTime.ToUniversalTime().Ticks);
    }
    private async Task WriteRecoveryAsync()
    {
        if (!ready || busy || !dirty || recoveryWriting) return;
        recoveryWriting = true;
        var epoch = documentEpoch;
        try { var draft = await CurrentDraftAsync(); if (epoch == documentEpoch && !busy && dirty) recovery.Write(draft); recoveryWarning = false; }
        catch (Exception ex)
        {
            if (!recoveryWarning) { recoveryWarning = true; Send(new { type = "notice", payload = new { message = "Чернетку відновлення не записано: " + ex.Message, error = true } }); }
        }
        finally { recoveryWriting = false; }
    }
    private async Task RecoverAsync(bool confirmCurrent)
    {
        var available = recovery.Available();
        if (available.Count == 0) { if (confirmCurrent) await RequestAsync("notice", new { message = "Чернеток для відновлення немає." }); return; }
        var entry = VersionDialogs.Recover(this, available, recovery.Remove);
        if (entry is null || (confirmCurrent && !await ConfirmDiscardAsync())) return;
        await RestoreDraftAsync(entry);
    }
    private async Task RestoreDraftAsync(RecoveryEntry entry)
    {
        await LoadAsync(entry.Draft.SavedMarkdown, entry.Draft.Path, entry.Draft.DiskBytes);
        await RequestAsync("restoreDraft", new { markdown = entry.Draft.Markdown, savedMarkdown = entry.Draft.SavedMarkdown });
        dirty = entry.Draft.Markdown != entry.Draft.SavedMarkdown;
        // Copy into this session before removing the previous recovery file.
        recovery.Write(await CurrentDraftAsync()); recovery.Remove(entry); UpdateTitle();
    }
    private async Task RecoverySmokeAsync(string directory)
    {
        try
        {
            var entry = recovery.Available().FirstOrDefault() ?? throw new IOException("Немає чернетки після аварійного завершення.");
            await RestoreDraftAsync(entry);
            var actual = (await RequestAsync("export")).GetProperty("markdown").GetString();
            if (actual != entry.Draft.Markdown || !dirty || File.ReadAllText(entry.Draft.Path!) != entry.Draft.SavedMarkdown) throw new IOException("Відновлення втратило правки або змінило оригінал.");
            File.WriteAllText(Path.Combine(directory, "recovery-result.json"), JsonSerializer.Serialize(new { success = true, dirty, originalUnchanged = true, markdown = actual }));
        }
        catch (Exception ex) { Environment.ExitCode = 1; File.WriteAllText(Path.Combine(directory, "recovery-result.json"), JsonSerializer.Serialize(new { success = false, error = ex.ToString() })); }
        finally { allowClose = true; Close(); }
    }

    private async Task<bool> ConfirmDiscardAsync()
    {
        var state = await RequestAsync("state");
        dirty = state.GetProperty("dirty").GetBoolean();
        if (!dirty) return true;
        return dialogs.ConfirmSave(this) switch
        {
            DialogResult.Yes => await SaveAsync(false),
            DialogResult.No => true,
            _ => false
        };
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (allowClose || !ready) return;
        e.Cancel = true;
        if (!busy) BeginInvoke(async () => await RunActionAsync("close"));
    }

    private void UpdateTitle() => Text = $"{(dirty ? "* " : "")}{(filePath is null ? "Без назви" : Path.GetFileName(filePath))} — Markdown Редактор";
    private void ShowError(string message) => MessageBox.Show(this, message, "Markdown Редактор", MessageBoxButtons.OK, MessageBoxIcon.Error);

    private async Task SmokeTestAsync(string directory)
    {
        Directory.CreateDirectory(directory);
        try
        {
            const string source = "# Перевірка\n\nТекст **жирний**.\n\n```js\nconst x = 1;\n```\n";
            await LoadAsync(source, null, null);
            await web.ExecuteScriptAsync("document.querySelector('#editor').append(Object.assign(document.createElement('p'), {textContent: 'Додано у WebView2'})); document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles:true}));");
            var result = await RequestAsync("export");
            var output = result.GetProperty("markdown").GetString()!;
            if (!output.Contains("Додано у WebView2") || !output.Contains("```js\nconst x = 1;\n```")) throw new Exception("Невірний експорт WebView2.");
            var smokeDialogs = (SmokeDocumentDialogs)dialogs;
            smokeDialogs.Answer = DialogResult.Cancel;
            if (await ConfirmDiscardAsync()) throw new Exception("Скасування не захистило документ.");
            smokeDialogs.Answer = DialogResult.Yes;
            smokeDialogs.SavePath = null;
            if (await ConfirmDiscardAsync()) throw new Exception("Скасування вибору шляху не захистило документ.");
            smokeDialogs.SavePath = Path.Combine(directory, "smoke.md");
            if (!await ConfirmDiscardAsync()) throw new Exception("Збереження перед продовженням не завершилося.");
            if (File.ReadAllText(smokeDialogs.SavePath) != output) throw new Exception("Невірний запис файла оболонкою.");
            var state = await RequestAsync("state");
            if (state.GetProperty("dirty").GetBoolean()) throw new Exception("Стан dirty не скинувся.");
            smokeDialogs.SavePath = Path.Combine(directory, "save-as.md");
            if (!await SaveAsync(true) || filePath != smokeDialogs.SavePath) throw new Exception("Зберегти як не змінило шлях.");
            await web.ExecuteScriptAsync("document.querySelector('#editor p').append(' Зміни'); document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles:true}));");
            await SaveAsync(false);
            if (!File.ReadAllText(smokeDialogs.SavePath).Contains("Зміни")) throw new Exception("Збереження у відкритий файл не працює.");
            await web.ExecuteScriptAsync("document.querySelector('#editor p').append(' Незбережені'); document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles:true}));");
            smokeDialogs.Answer = DialogResult.Cancel;
            await RunActionAsync("new");
            if (!dirty) throw new Exception("Новий документ відкинув зміни після скасування.");
            smokeDialogs.Answer = DialogResult.No;
            await RunActionAsync("new");
            if (dirty || filePath is not null) throw new Exception("Створення нового документа не скинуло стан.");
            smokeDialogs.OpenPath = Path.Combine(directory, "smoke.md");
            await RunActionAsync("open");
            if (filePath != smokeDialogs.OpenPath || dirty) throw new Exception("Відкриття файла не відновило стан.");
            var reopened = await RequestAsync("export");
            if (reopened.GetProperty("markdown").GetString() != output) throw new Exception("Повторне відкриття змінило Markdown.");
            // Exercise persistence and both conflict choices without displaying real dialogs.
            await web.ExecuteScriptAsync("document.querySelector('#editor p').append(' Recovery draft'); document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles:true}));");
            var draft = await CurrentDraftAsync(); recovery.KeepCopy(draft);
            var persisted = recovery.Available().Single();
            if (!persisted.Draft.Markdown.Contains("Recovery draft") || File.ReadAllText(filePath!).Contains("Recovery draft")) throw new Exception("Чернетка перезаписала оригінал.");
            await LoadAsync(persisted.Draft.SavedMarkdown, persisted.Draft.Path, persisted.Draft.DiskBytes);
            await RequestAsync("restoreDraft", new { markdown = persisted.Draft.Markdown, savedMarkdown = persisted.Draft.SavedMarkdown }); recovery.Remove(persisted);
            if (!(await RequestAsync("state")).GetProperty("dirty").GetBoolean()) throw new Exception("Відновлена чернетка має бути незбереженою.");
            File.WriteAllText(filePath!, "External version\n"); smokeDialogs.ConflictAnswer = ConflictDecision.Cancel;
            if (await SaveAsync(false) || File.ReadAllText(filePath!) != "External version\n") throw new Exception("Конфлікт не захистив зовнішню версію.");
            smokeDialogs.ConflictAnswer = ConflictDecision.SaveCopy; smokeDialogs.SavePath = Path.Combine(directory, "conflict-copy.md");
            if (!await SaveAsync(false) || !File.ReadAllText(smokeDialogs.SavePath).Contains("Recovery draft")) throw new Exception("Збереження копії при конфлікті не працює.");
            await web.ExecuteScriptAsync("document.querySelector('#editor p').append(' Before reload'); document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles:true}));");
            File.WriteAllText(filePath!, "New disk version\n"); smokeDialogs.ConflictAnswer = ConflictDecision.Reload;
            await SaveAsync(false);
            if ((await RequestAsync("export")).GetProperty("markdown").GetString() != "New disk version\n" || !recovery.Available().Any(e => e.Draft.Markdown.Contains("Before reload"))) throw new Exception("Перечитування не зберегло поточні правки.");
            var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
            File.WriteAllBytes(Path.Combine(directory, "pixel.png"), png);
            const string printSource = "# Export verification\n\nText **bold**\n\n![Pixel](pixel.png)\n\n| A | B |\n| --- | --- |\n| One | Two |\n";
            await LoadAsync(printSource, Path.Combine(directory, "print.md"), null);
            var htmlResult = await RequestAsync("html"); var html = DocumentImages.EmbedHtml(htmlResult.GetProperty("html").GetString()!, filePath);
            if (!html.Contains("data:image/png;base64,") || html.Contains("<script")) throw new Exception("Некоректний автономний HTML.");
            File.WriteAllText(Path.Combine(directory, "export.html"), html);
            await RequestAsync("preparePrint"); await RequestAsync("awaitImages");
            var pdf = Path.Combine(directory, "export.pdf");
            if (!await web.CoreWebView2.PrintToPdfAsync(pdf) || !System.Text.Encoding.ASCII.GetString(File.ReadAllBytes(pdf), 0, 4).Equals("%PDF")) throw new Exception("PDF не створено.");
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { success = true, runtime = web.CoreWebView2.Environment.BrowserVersionString, discardPrompts = smokeDialogs.Prompts, checks = "bridge, export, cancel, canceled-save, save-before-discard, save-as, save, new, reopen, persisted-recovery, conflict-cancel, conflict-copy, reload-with-backup, standalone-html, pdf" }));
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { success = false, error = ex.ToString() }));
            Environment.ExitCode = 1;
        }
        finally { allowClose = true; Close(); }
    }
}
