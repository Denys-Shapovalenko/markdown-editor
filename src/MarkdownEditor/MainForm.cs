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

    public MainForm(string[] args)
    {
        arguments = args;
        dialogs = args.Length == 2 && args[0] == "--smoke-test" ? new SmokeDocumentDialogs() : new WindowsDocumentDialogs();
        Text = "Без назви — Markdown Редактор";
        Width = 1160; Height = 850; MinimumSize = new Size(760, 500);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);
        Shown += async (_, _) => await InitializeAsync();
        FormClosing += OnFormClosing;
        startupTimer.Tick += (_, _) => { startupTimer.Stop(); if (!ready) ShowError("Редактор не запустився за 30 секунд. Перезапустіть програму й перевірте WebView2 Runtime."); };
    }

    private async Task InitializeAsync()
    {
        try
        {
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarkdownEditor", "WebView2");
            // Smoke tests keep their runtime data in the requested test folder.
            if (arguments.Length == 2 && arguments[0] == "--smoke-test") profile = Path.Combine(Path.GetFullPath(arguments[1]), "profile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.SetVirtualHostNameToFolderMapping("editor.local", Path.Combine(AppContext.BaseDirectory, "Editor"), CoreWebView2HostResourceAccessKind.DenyCors);
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
                    else if (arguments.Length == 1) await RunActionAsync("openPath");
                });
            }
            else if (type == "changed") { dirty = message.GetProperty("dirty").GetBoolean(); UpdateTitle(); }
            else if (type == "command")
            {
                var command = message.GetProperty("command").GetString()!;
                BeginInvoke(async () => await RunActionAsync(command));
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

    private async Task RunActionAsync(string command)
    {
        if (busy || !ready) return;
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
                    if (await ConfirmDiscardAsync()) { allowClose = true; Close(); }
                    break;
            }
        }
        catch (UnauthorizedAccessException) { ShowError("Немає доступу до файла або папки. Перевірте права доступу або скористайтеся «Зберегти як» і виберіть іншу папку."); }
        catch (Exception ex) { ShowError($"Операцію не завершено. {ex.Message}"); }
        finally { busy = false; if (!IsDisposed && web.CoreWebView2 is not null) Send(new { type = "busy", value = false }); }
    }

    private async Task LoadAsync(string markdown, string? path, byte[]? bytes)
    {
        await RequestAsync("load", new { markdown, name = path is null ? "Без назви" : Path.GetFileName(path) });
        filePath = path; diskBytes = bytes; dirty = false; UpdateTitle();
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
        diskBytes = DocumentFiles.Save(target, markdown, diskBytes, samePath);
        filePath = target;
        await RequestAsync("saved", new { name = Path.GetFileName(target) });
        dirty = false; UpdateTitle(); return true;
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
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { success = true, runtime = web.CoreWebView2.Environment.BrowserVersionString, discardPrompts = smokeDialogs.Prompts, checks = "bridge, export, cancel, canceled-save, save-before-discard, save-as, save, new, reopen" }));
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(directory, "result.json"), JsonSerializer.Serialize(new { success = false, error = ex.ToString() }));
            Environment.ExitCode = 1;
        }
        finally { allowClose = true; Close(); }
    }
}
