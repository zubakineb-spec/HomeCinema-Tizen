param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [string]$PackagePath = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command tizen -ErrorAction SilentlyContinue)) {
    throw 'Tizen Studio CLI (tizen) not found in PATH.'
}

if (-not $PackagePath) {
    $Package = Get-ChildItem -Path '.\dist' -Filter 'HomeCinema-Tizen-v*.wgt' -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $Package) { throw 'No .wgt package found in .\dist. Run BUILD-SAMSUNG-WGT.ps1 first.' }
    $PackagePath = $Package.FullName
} else {
    $PackagePath = (Resolve-Path $PackagePath).Path
}

$PackageDir = Split-Path $PackagePath -Parent
$PackageName = Split-Path $PackagePath -Leaf

Write-Host 'Connected targets:'
if (Get-Command sdb -ErrorAction SilentlyContinue) { & sdb devices }

Write-Host "Installing $PackageName to target $Target ..."
& tizen install -t $Target --name $PackageName -- $PackageDir
if ($LASTEXITCODE -ne 0) { throw "tizen install failed: $LASTEXITCODE" }

Write-Host 'Installation completed.'
