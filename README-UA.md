# Markdown Редактор для Windows

Візуальний редактор локальних файлів Markdown (`.md`). Застосунок поєднує оболонку Windows Forms із вбудованим HTML/CSS/JavaScript-редактором на WebView2. Версія 2 зосереджена на надійному редагуванні, відновленні чернеток і захисті від втрати змін.

[English version](README.md)

## Завантаження та запуск

Зберіть компактний застосунок одним EXE командою `./build.ps1`, а потім запустіть `artifacts\win-x64-framework48-single\MarkdownEditor.exe`. Він працює на **.NET Framework 4.8**, який входить до Windows 10 версії 1903 і новіших, і використовує **Microsoft Edge WebView2 Evergreen Runtime**. Редагувати документи можна без інтернету.

- [.NET Framework 4.8](https://dotnet.microsoft.com/download/dotnet-framework/net48) (встановлювати лише на версіях Windows, де його немає)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

EXE містить застосунок і залежності в стисненому архіві; під час першого запуску файли розпаковуються в `%LocalAppData%\MarkdownEditor\Packages`. У Windows 10 версії 1903 і новіших окремо встановлювати .NET Runtime не потрібно. Якщо WebView2 відсутній, встановіть його Evergreen Runtime.

## Можливості

- Відкриття, редагування та збереження локальних Markdown-файлів із попередженням перед відкиданням незбережених змін.
- Форматування тексту й абзаців; вкладені нумеровані та марковані списки, чеклісти, блоки коду, цитати, посилання та зображення.
- Редагування таблиць через тулбар або контекстне меню: додавання й видалення рядків і стовпців, переміщення та виділення клітинок, навігація клавіатурою.
- Скасування та повтор дій зі збереженням позиції курсора; пошук і заміна; редагування Markdown-джерела; зміст документа.
- Відновлення чернеток після збою та обробка файлів, змінених іншою програмою.
- Друк і експорт у PDF та автономний HTML.
- Збереження непідтримуваних блоків Markdown без змін під час редагування решти документа.

Максимальний розмір документа — 5 MiB. Зовнішні зображення завантажуються лише за окремою командою користувача.

## Збірка та перевірки

Потрібні Windows x64, .NET 10 SDK, цільові файли .NET Framework 4.8 (відновлюються з NuGet), WebView2 Runtime і Node.js 24 або новіший для браузерних тестів та оновлення вбудованого Markdown-лексера.

```powershell
dotnet run --project src/MarkdownEditor/MarkdownEditor.csproj
./build.ps1

npm.cmd ci --ignore-scripts
npm.cmd run vendor
npm.cmd run test:unit
npm.cmd test
dotnet run --project tests/FileTests/FileTests.csproj
```

Браузерні тести працюють у Microsoft Edge в headless-режимі. Щоб перевірити WinForms/WebView2 в ізольованій папці розгортання:

```powershell
./scripts/test-deployment.ps1
```

## Структура проєкту

- `src/MarkdownEditor/` — застосунок для Windows і вбудований редактор.
- `tests/` — браузерні, файлові та регресійні тести.
- `scripts/` — допоміжні скрипти збірки й інтеграційних тестів.

Для розбору Markdown редактор використовує [Marked](https://marked.js.org/); окремого WYSIWYG-рушія в ньому немає. WebView2 надає Microsoft. Документація: [локальний вміст у WebView2](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content).

## Контриб’ютори та доступ

Репозиторій відкритий для перегляду й клонування. Право запису мають лише власник і контриб’ютори, яких він запросив. Користувачі можуть запропонувати зміни через pull request, але це не надає їм права запису в репозиторій або злиття змін.
