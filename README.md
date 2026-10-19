# Markdown Editor for Windows

A visual editor for local Markdown (`.md`) files. The application combines a Windows Forms shell with an embedded HTML/CSS/JavaScript editor hosted in WebView2. Version 2 focuses on reliable editing, draft recovery, and protection against losing changes.

[Українська версія](README-UA.md)

## Download and run

Build the compact, single-file application with `./build.ps1`, then launch `artifacts\win-x64-compact\MarkdownEditor.exe`. The executable bundles the editor UI and its JavaScript dependencies. It requires the **.NET 10 Desktop Runtime (x64)** and **Microsoft Edge WebView2 Evergreen Runtime** to be installed. Editing works offline.

- [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

The default build is a compact framework-dependent EXE. Use `./build.ps1 -SelfContained` to produce a larger single-file EXE that also bundles .NET; WebView2 is still required. The self-contained build needs NuGet access on the first build.

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

Requirements: Windows x64, .NET 10 SDK, WebView2 Runtime, and Node.js 24 or later for browser tests and updating the vendored Markdown lexer.

```powershell
dotnet run --project src/MarkdownEditor/MarkdownEditor.csproj
./build.ps1

npm.cmd ci --ignore-scripts
npm.cmd run vendor
npm.cmd run test:unit
npm.cmd test
dotnet run --project tests/FileTests/FileTests.csproj
```

Browser tests use Microsoft Edge in headless mode. To smoke-test the real WinForms/WebView2 application from a clean folder:

```powershell
./scripts/test-singlefile.ps1
```

## Project structure

- `src/MarkdownEditor/` — Windows application and embedded editor.
- `tests/` — browser, file, and regression tests.
- `scripts/` — build and integration-test helpers.

The editor uses [Marked](https://marked.js.org/) to parse Markdown; it does not embed a separate WYSIWYG editor. WebView2 is provided by Microsoft. See the [WebView2 local content documentation](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content).

## Contributions and access

This repository is public for viewing and cloning. Write access is limited to the owner and collaborators explicitly invited by the owner. Public users may suggest changes through pull requests, but that does not grant permission to write to the repository or merge changes.
