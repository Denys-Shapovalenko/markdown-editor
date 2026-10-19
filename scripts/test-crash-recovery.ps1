param([string]$Exe = (Join-Path $PSScriptRoot '..\artifacts\win-x64-framework48-single\MarkdownEditor.exe'))
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Exe).Path
$runFolder = Join-Path $PSScriptRoot ('..\artifacts\crash-recovery-test\' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runFolder -Force | Out-Null
$runFolder = (Resolve-Path -LiteralPath $runFolder).Path
$isolatedExe = Join-Path $runFolder 'MarkdownEditor.exe'
Copy-Item -LiteralPath $source -Destination $isolatedExe
$testRoot = Join-Path $runFolder 'test-data'
$session = Start-Process -FilePath $isolatedExe -WorkingDirectory $runFolder -ArgumentList @('--test-crash-session', ('"{0}"' -f $testRoot)) -WindowStyle Hidden -PassThru
$readyFile = Join-Path $testRoot 'crash-session-ready.json'
$deadline = [DateTime]::UtcNow.AddSeconds(60)
while (-not (Test-Path -LiteralPath $readyFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (-not (Test-Path -LiteralPath $readyFile)) {
    if (-not $session.HasExited) { Stop-Process -Id $session.Id -Force -ErrorAction SilentlyContinue }
    throw 'Application did not save its recovery draft and signal readiness within 60 seconds.'
}
$ready = Get-Content -LiteralPath $readyFile -Raw -Encoding UTF8 | ConvertFrom-Json
$child = Get-Process -Id ([int]$ready.pid) -ErrorAction Stop
if ($child.StartTime.ToUniversalTime().Ticks -ne [long]$ready.startTicks) { throw 'The signaled application process has been replaced.' }
$original = Join-Path $testRoot 'Original.md'
$originalBefore = Get-Content -LiteralPath $original -Raw -Encoding UTF8
Stop-Process -Id $child.Id -Force
$child.WaitForExit()
$recoveryDir = Join-Path $testRoot 'Recovery'
$drafts = @(Get-ChildItem -LiteralPath $recoveryDir -Filter '*.json' -File)
if ($drafts.Count -eq 0) { throw 'Crash did not leave a recovery draft.' }
$recover = Start-Process -FilePath $isolatedExe -WorkingDirectory $runFolder -ArgumentList @('--test-recover', ('"{0}"' -f $testRoot)) -WindowStyle Hidden -PassThru
if (-not $recover.WaitForExit(60000)) {
    Stop-Process -Id $recover.Id -Force -ErrorAction SilentlyContinue
    throw 'Recovery validation timed out.'
}
if ($recover.ExitCode -ne 0) { throw "Recovery validation exit code: $($recover.ExitCode)" }
$resultFile = Join-Path $testRoot 'recovery-result.json'
$result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $result.success -or -not $result.dirty -or -not $result.originalUnchanged -or $result.markdown -notmatch 'Unsaved edit') { throw "Recovery validation failed: $(ConvertTo-Json $result -Compress)" }
if ((Get-Content -LiteralPath $original -Raw -Encoding UTF8) -ne $originalBefore) { throw 'The original document changed during recovery.' }
Write-Output "Passed: forced process termination restored the unsaved edit; original file remained unchanged. ($runFolder)"
