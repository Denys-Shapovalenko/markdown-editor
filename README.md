# Markdown Editor for Windows

A visual editor for local Markdown (`.md`) files. The application combines a Windows Forms shell with an embedded HTML/CSS/JavaScript editor hosted in WebView2. Version 2 focuses on reliable editing, draft recovery, and protection against losing changes.

[Українська версія](README-UA.md)

## Download and run

Build the compact single-executable application with `./build.ps1`, then launch `artifacts\win-x64-framework48-single\MarkdownEditor.exe`. It targets **.NET Framework 4.8**, included in Windows 10 version 1903 and later, and uses the **Microsoft Edge WebView2 Evergreen Runtime**. Editing works offline.

- [.NET Framework 4.8](https://dotnet.microsoft.com/download/dotnet-framework/net48) (install only on Windows versions that do not include it)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

The EXE contains the application and its dependencies in a compressed bundle; on first launch it extracts the app files to `%LocalAppData%\MarkdownEditor\Packages`. No separate .NET Runtime installation is needed on Windows 10 version 1903 and later. If WebView2 is missing, install its Evergreen Runtime.

## Features

- Open, edit, and save local Markdown files, with prompts before discarding unsaved changes.
- Format text and paragraphs; create nested ordered and unordered lists, checklists, code blocks, quotes, links, and images.
- Edit tables with the toolbar or context menu: add and remove rows and columns, move and select cells, and navigate with the keyboard.
- Undo and redo while preserving the cursor; search and replace; edit Markdown source; view a document outline.
- Recover drafts after a crash and handle files changed by another application.
- Print or export to PDF and standalone HTML.
- Keep unsupported Markdown blocks intact while editing the rest of a document.

The editor has a 5 MiB document size limit. External images are downloaded only when the user invokes the dedicated command.

## Build and test

Requirements: Windows x64, .NET 10 SDK, .NET Framework 4.8 targeting references (restored from NuGet), WebView2 Runtime, and Node.js 24 or later for browser tests and updating the vendored Markdown lexer.

```powershell
dotnet run --project src/MarkdownEditor/MarkdownEditor.csproj
./build.ps1

npm.cmd ci --ignore-scripts
npm.cmd run vendor
npm.cmd run test:unit
npm.cmd test
dotnet run --project tests/FileTests/FileTests.csproj
```

Browser tests use Microsoft Edge in headless mode. To smoke-test the real WinForms/WebView2 application from an isolated deployment folder:

```powershell
./scripts/test-deployment.ps1
```

## Project structure

- `src/MarkdownEditor/` — Windows application and embedded editor.
- `tests/` — browser, file, and regression tests.
- `scripts/` — build and integration-test helpers.

The editor uses [Marked](https://marked.js.org/) to parse Markdown; it does not embed a separate WYSIWYG editor. WebView2 is provided by Microsoft. See the [WebView2 local content documentation](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content).

## Contributions and access

This repository is public for viewing and cloning. Write access is limited to the owner and collaborators explicitly invited by the owner. Public users may suggest changes through pull requests, but that does not grant permission to write to the repository or merge changes.
