param([switch]$FrameworkDependent)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'src\MarkdownEditor\MarkdownEditor.csproj'
$output = Join-Path $PSScriptRoot 'artifacts\win-x64'
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.cache\dotnet'
$env:NUGET_PACKAGES = Join-Path $PSScriptRoot '.cache\nuget'
$selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }
dotnet publish $project -c Release -r win-x64 --self-contained $selfContained -o $output -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Output "Ready: $(Join-Path $output 'MarkdownEditor.exe')"
