param(
    [string]$Target = '',
    [string]$Serial = '',
    [string]$TvIp = '',
    [string]$PackagePath = '',
    [switch]$Run,
    [string]$AppId = 'HCINEMA001.HomeCinema'
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

if ($TvIp) {
    if (-not (Get-Command sdb -ErrorAction SilentlyContinue)) {
        throw 'sdb not found in PATH.'
    }
    & sdb connect $TvIp | Out-Host
    Start-Sleep -Milliseconds 600
}

if (-not $Serial -and $TvIp) {
    $DeviceLine = @(& sdb devices) |
        Where-Object { $_ -match [regex]::Escape($TvIp) -and $_ -match '\bdevice\b' } |
        Select-Object -First 1
    if (-not $DeviceLine) { throw "TV is not connected through SDB: $TvIp" }
    $Serial = (($DeviceLine -split '\s+')[0]).Trim()
}

if ($Serial) {
    Write-Host "Installing $PackageName to SDB device $Serial ..."
    & tizen install-permit -s $Serial | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "tizen install-permit failed: $LASTEXITCODE" }
    & tizen install -s $Serial --name $PackageName -- $PackageDir | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "tizen install failed: $LASTEXITCODE" }
    if ($Run) {
        & tizen run -s $Serial -p $AppId | Out-Host
        if ($LASTEXITCODE -ne 0) { Write-Warning "Install succeeded but run failed: $LASTEXITCODE" }
    }
    Write-Host 'Installation completed.'
    return
}

if ($Target) {
    Write-Host "Installing $PackageName to named target $Target ..."
    & tizen install -t $Target --name $PackageName -- $PackageDir | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "tizen install failed: $LASTEXITCODE" }
    if ($Run) {
        & tizen run -t $Target -p $AppId | Out-Host
        if ($LASTEXITCODE -ne 0) { Write-Warning "Install succeeded but run failed: $LASTEXITCODE" }
    }
    Write-Host 'Installation completed.'
    return
}

throw 'Specify -Serial, -TvIp, or legacy -Target. No installation was attempted.'
