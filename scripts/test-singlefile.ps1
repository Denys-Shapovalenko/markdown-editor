param([string]$Exe = (Join-Path $PSScriptRoot '..\artifacts\win-x64-compact\MarkdownEditor.exe'))
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Exe).Path
$runFolder = Join-Path $PSScriptRoot ('..\artifacts\singlefile-smoke\' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
$runFolder = (Resolve-Path -LiteralPath $runFolder).Path
$isolatedExe = Join-Path $runFolder 'MarkdownEditor.exe'
Copy-Item -LiteralPath $source -Destination $isolatedExe
$results = Join-Path $runFolder 'results'
$app = Start-Process -FilePath $isolatedExe -WorkingDirectory $runFolder -ArgumentList @('--smoke-test', ('"{0}"' -f $results)) -WindowStyle Hidden -PassThru
if (-not $app.WaitForExit(45000)) {
    Stop-Process -Id $app.Id -ErrorAction SilentlyContinue
    throw 'Single-file smoke test timed out.'
}
if ($app.ExitCode -ne 0) { throw "Application exit code: $($app.ExitCode)" }
$resultFile = Join-Path $results 'result.json'
$result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $result.success) { throw "Smoke test failed: $(ConvertTo-Json $result -Compress)" }
Write-Output "Passed with only the EXE copied into: $runFolder"
Write-Output (ConvertTo-Json $result -Compress)
