param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

$Patch = Join-Path $PSScriptRoot "PATCH-v0.3.18-TIZEN4-HARDENING.ps1"
$Targets = @(
    (Join-Path $RepoRoot "tv-app\js\app.js"),
    (Join-Path $RepoRoot "tv-app\js\browser-avplay-shim.js")
)

if (-not (Test-Path $Patch)) { throw "BASE_PATCH_NOT_FOUND: $Patch" }

$PatchText = [IO.File]::ReadAllText($Patch)
$Eol = if ($PatchText.Contains("`r`n")) { "`r`n" } else { "`n" }
$Encoding = New-Object Text.UTF8Encoding($false)

Write-Host "=== EOL NORMALIZATION ==="
Write-Host ("PATCH_EOL=" + $(if ($Eol -eq "`r`n") { "CRLF" } else { "LF" }))

foreach ($Target in $Targets) {
    if (-not (Test-Path $Target)) { throw "TARGET_NOT_FOUND: $Target" }
    $Text = [IO.File]::ReadAllText($Target)
    $Text = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
    if ($Eol -eq "`r`n") { $Text = $Text.Replace("`n", "`r`n") }
    [IO.File]::WriteAllText($Target, $Text, $Encoding)
    Write-Host "NORMALIZED=$Target"
}

Write-Host "`n=== RUN BASE HARDENING ==="
& powershell.exe -ExecutionPolicy Bypass -File $Patch -RepoRoot $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "BASE_PATCH_FAILED=$LASTEXITCODE" }

Write-Host "TIZEN4_HARDENING_V2=PASS"
