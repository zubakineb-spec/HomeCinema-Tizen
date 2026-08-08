param(
    [Parameter(Mandatory = $true)]
    [string]$CertificateProfile
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command tizen -ErrorAction SilentlyContinue)) {
    throw 'Tizen Studio CLI (tizen) not found in PATH. Install Tizen Studio + Samsung TV Extension + Web CLI.'
}

$Project = (Resolve-Path '.\tv-app').Path
$BuildResult = Join-Path $Project '.buildResult'

Write-Host '[1/3] Building Tizen Web project...'
& tizen build-web -- $Project
if ($LASTEXITCODE -ne 0) { throw "tizen build-web failed: $LASTEXITCODE" }

if (-not (Test-Path $BuildResult)) {
    throw "Build result not found: $BuildResult"
}

Write-Host '[2/3] Packaging signed Samsung WGT...'
& tizen package -t wgt -s $CertificateProfile -- $BuildResult
if ($LASTEXITCODE -ne 0) { throw "tizen package failed: $LASTEXITCODE" }

$Package = Get-ChildItem -Path $BuildResult -Filter '*.wgt' -File -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $Package) { throw 'Signed .wgt package was not produced.' }

$ReleaseDir = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
$Version = (Get-Content (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
$Target = Join-Path $ReleaseDir ("HomeCinema-Tizen-v{0}.wgt" -f $Version)
Copy-Item $Package.FullName $Target -Force

Write-Host '[3/3] Package ready:'
Write-Host $Target
Get-FileHash -Algorithm SHA256 $Target | Format-List
