$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'src\MarkdownEditor\MarkdownEditor.csproj'
$launcherProject = Join-Path $PSScriptRoot 'src\MarkdownEditor.Launcher\MarkdownEditor.Launcher.csproj'
$folder = 'win-x64-framework48-single'
$output = Join-Path $PSScriptRoot "artifacts\$folder"
$staging = Join-Path $PSScriptRoot ('.cache\publish\' + [Guid]::NewGuid().ToString('N'))
$appStaging = Join-Path $staging 'app'
$launcherStaging = Join-Path $staging 'launcher'
$bundle = Join-Path $staging 'app-bundle.zip'
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.cache\dotnet'
$env:NUGET_PACKAGES = Join-Path $PSScriptRoot '.cache\nuget'
dotnet publish $project -c Release -o $appStaging -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Compress-Archive -Path (Join-Path $appStaging '*') -DestinationPath $bundle -CompressionLevel Optimal
dotnet publish $launcherProject -c Release -p:AppBundlePath=$bundle -o $launcherStaging -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Single-executable launcher build failed.' }
$launcherExe = Join-Path $launcherStaging 'MarkdownEditor.exe'
if (-not (Test-Path -LiteralPath $launcherExe -PathType Leaf)) { throw 'The launcher build did not produce MarkdownEditor.exe.' }
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $output 'MarkdownEditor.exe') -Force
$totalBytes = (Get-Item -LiteralPath (Join-Path $output 'MarkdownEditor.exe')).Length
Write-Output "Ready: $(Join-Path $output 'MarkdownEditor.exe')"
Write-Output ('Single EXE size: {0:N2} MiB' -f ($totalBytes / 1MB))
