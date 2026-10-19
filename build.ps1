param([switch]$SelfContained, [switch]$FrameworkDependent)
$ErrorActionPreference = 'Stop'
if ($SelfContained -and $FrameworkDependent) { throw 'Choose either -SelfContained or -FrameworkDependent.' }
$project = Join-Path $PSScriptRoot 'src\MarkdownEditor\MarkdownEditor.csproj'
$folder = if ($SelfContained) { 'win-x64-singlefile-selfcontained' } else { 'win-x64-compact' }
$output = Join-Path $PSScriptRoot "artifacts\$folder"
$staging = Join-Path $PSScriptRoot ('.cache\publish\' + [Guid]::NewGuid().ToString('N'))
$env:DOTNET_CLI_HOME = Join-Path $PSScriptRoot '.cache\dotnet'
$env:NUGET_PACKAGES = Join-Path $PSScriptRoot '.cache\nuget'
$includeRuntime = if ($SelfContained) { 'true' } else { 'false' }
dotnet publish $project -c Release -r win-x64 --self-contained $includeRuntime -p:PublishSelfContained=$includeRuntime -o $staging -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$files = @(Get-ChildItem -LiteralPath $staging -Recurse -File)
if ($files.Count -ne 1 -or $files[0].Name -ne 'MarkdownEditor.exe') {
    $files | Select-Object FullName, Length | Out-Host
    throw 'The publish output must contain exactly one MarkdownEditor.exe.'
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath $files[0].FullName -Destination (Join-Path $output 'MarkdownEditor.exe') -Force
Write-Output "Ready: $(Join-Path $output 'MarkdownEditor.exe')"
Write-Output ('Size: {0:N2} MiB' -f ($files[0].Length / 1MB))
