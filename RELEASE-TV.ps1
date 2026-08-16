param(
    [string]$RC = 'rc3.14',
    [string]$CertificateProfile = 'HomeCinemaTV-FRESH',
    [string]$TvIp = '192.168.0.103',
    [switch]$Install,
    [switch]$SkipLocalTests
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail([string]$Message) { throw $Message }
function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host "`n=== $Name ==="
    & $Action
}

$Version = (Get-Content (Join-Path $PSScriptRoot 'VERSION') -Raw).Trim()
if (-not $Version) { Fail 'VERSION_EMPTY' }
if ($RC -notmatch '^rc\d+\.\d+$') { Fail "INVALID_RC=$RC" }

$SourceSha = ''
if (Get-Command git -ErrorAction SilentlyContinue) {
    $SourceSha = (& git -C $PSScriptRoot rev-parse HEAD 2>$null).Trim()
}
if (-not $SourceSha) { $SourceSha = 'unknown' }

$ReleaseName = "HomeCinema-Tizen-v$Version-$RC.wgt"
$Desktop = [Environment]::GetFolderPath('Desktop')
$Target = Join-Path $Desktop $ReleaseName
$ManifestTarget = [System.IO.Path]::ChangeExtension($Target, '.json')

Write-Host '=== HOME CINEMA TV RELEASE ==='
Write-Host "VERSION=$Version"
Write-Host "RC=$RC"
Write-Host "SOURCE_SHA=$SourceSha"
Write-Host "INSTALL_REQUESTED=$([bool]$Install)"
Write-Host "TARGET=$Target"

if (-not $SkipLocalTests) {
    Run-Step 'LOCAL RELEASE GATES' {
        if (Get-Command node -ErrorAction SilentlyContinue) {
            $JsFiles = @(
                'tv-app/js/app.js',
                'tv-app/js/config.js',
                'tv-app/js/rc-release.js',
                'tv-app/js/rc32-player-navigation.js',
                'tv-app/js/rc37-enhancements.js',
                'tv-app/js/rc38-search-surface.js',
                'tv-app/js/rc39-cinematic-ui.js',
                'tv-app/js/rc310-series-page.js',
                'tv-app/js/rc314-audio-metadata.js',
                'tools/player-state-smoke.js',
                'tools/progress-consistency-smoke.js',
                'tools/player-lifecycle-smoke.js',
                'tools/player-exit-navigation-smoke.js',
                'tools/root-back-exit-smoke.js',
                'tools/rc311-series-back-smoke.js',
                'tools/rc312-icon-smoke.js',
                'tools/rc313-seek-surface-smoke.js',
                'tools/rc314-audio-metadata-smoke.js',
                'tools/rc37-enhancements-smoke.js',
                'tools/player-ux-rc37-smoke.js',
                'tools/search-player-surface-smoke.js',
                'tools/cinematic-ui-smoke.js',
                'tools/rc310-series-page-smoke.js'
            )
            foreach ($Rel in $JsFiles) {
                $Path = Join-Path $PSScriptRoot $Rel
                if (-not (Test-Path $Path)) { Fail "RELEASE_GATE_FILE_MISSING=$Rel" }
                & node --check $Path
                if ($LASTEXITCODE -ne 0) { Fail "NODE_CHECK_FAILED=$Rel" }
            }
            foreach ($Smoke in @(
                'tools/player-state-smoke.js',
                'tools/progress-consistency-smoke.js',
                'tools/player-lifecycle-smoke.js',
                'tools/player-exit-navigation-smoke.js',
                'tools/root-back-exit-smoke.js',
                'tools/rc311-series-back-smoke.js',
                'tools/rc312-icon-smoke.js',
                'tools/rc313-seek-surface-smoke.js',
                'tools/rc314-audio-metadata-smoke.js',
                'tools/rc37-enhancements-smoke.js',
                'tools/player-ux-rc37-smoke.js',
                'tools/search-player-surface-smoke.js',
                'tools/cinematic-ui-smoke.js',
                'tools/rc310-series-page-smoke.js'
            )) {
                & node (Join-Path $PSScriptRoot $Smoke)
                if ($LASTEXITCODE -ne 0) { Fail "SMOKE_FAILED=$Smoke" }
            }
        } else {
            Write-Warning 'Node.js not found; JavaScript release gates skipped locally.'
        }

        if (Get-Command go -ErrorAction SilentlyContinue) {
            Push-Location (Join-Path $PSScriptRoot 'native-qnap-d1')
            try {
                & go test ./...
                if ($LASTEXITCODE -ne 0) { Fail 'GO_TEST_FAILED' }
            } finally { Pop-Location }
        } else {
            Write-Warning 'Go not found; QNAP tests skipped locally.'
        }
    }
}

$Normalizer = Join-Path $PSScriptRoot 'tools\NORMALIZE-TV-ICON.ps1'
$IconPath = Join-Path $PSScriptRoot 'tv-app\icon.png'
$IconBackup = Join-Path $env:TEMP ("HomeCinema-icon-" + [Guid]::NewGuid().ToString('N') + '.png')
if (-not (Test-Path $Normalizer)) { Fail "ICON_NORMALIZER_MISSING=$Normalizer" }
if (-not (Test-Path $IconPath)) { Fail "ICON_MISSING=$IconPath" }
Copy-Item $IconPath $IconBackup -Force

try {
    Run-Step 'NORMALIZE SAMSUNG PACKAGE ICON' {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Normalizer -IconPath $IconPath -CanvasSize 117 -TileWidth 110 -TileHeight 62 -CornerRadius 7
        if ($LASTEXITCODE -ne 0) { Fail "ICON_NORMALIZATION_FAILED=$LASTEXITCODE" }
    }

    Run-Step 'BUILD + SAMSUNG SIGN' {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'BUILD-SAMSUNG-WGT.ps1') -CertificateProfile $CertificateProfile
        if ($LASTEXITCODE -ne 0) { Fail "BUILD_FAILED=$LASTEXITCODE" }
    }
}
finally {
    if (Test-Path $IconBackup) {
        Copy-Item $IconBackup $IconPath -Force
        Remove-Item $IconBackup -Force -ErrorAction SilentlyContinue
    }
}

$Built = Join-Path $PSScriptRoot "dist\HomeCinema-Tizen-v$Version.wgt"
if (-not (Test-Path $Built)) { Fail "WGT_NOT_FOUND=$Built" }

Run-Step 'COPY RELEASE TO DESKTOP' {
    Copy-Item $Built $Target -Force
    if (-not (Test-Path $Target)) { Fail "DESKTOP_COPY_FAILED=$Target" }
}

Run-Step 'VERIFY WGT' {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.Drawing
    $Zip = [System.IO.Compression.ZipFile]::OpenRead($Target)
    try {
        $Entries = @($Zip.Entries | ForEach-Object { $_.FullName })
        foreach ($Required in @(
            'config.xml',
            'author-signature.xml',
            'signature1.xml',
            'index.html',
            'icon.png',
            'js/app.js',
            'js/config.js',
            'js/rc-release.js',
            'js/rc32-player-navigation.js',
            'js/rc37-enhancements.js',
            'js/rc38-search-surface.js',
            'js/rc39-cinematic-ui.js',
            'js/rc310-series-page.js',
            'js/rc314-audio-metadata.js',
            'css/rc37-enhancements.css',
            'css/rc39-cinematic-ui.css',
            'css/rc310-home-series.css'
        )) {
            if ($Entries -notcontains $Required) { Fail "WGT_MISSING_ENTRY=$Required" }
        }

        function Read-ZipText([string]$Name) {
            $Entry = $Zip.Entries | Where-Object { $_.FullName -eq $Name } | Select-Object -First 1
            if (-not $Entry) { Fail "WGT_ENTRY_NOT_FOUND=$Name" }
            $Stream = $Entry.Open()
            try {
                $Reader = New-Object System.IO.StreamReader($Stream)
                try { return $Reader.ReadToEnd() } finally { $Reader.Dispose() }
            } finally { $Stream.Dispose() }
        }

        $ConfigXml = Read-ZipText 'config.xml'
        $EscapedVersion = [regex]::Escape($Version)
        if ($ConfigXml -notmatch ('version="' + $EscapedVersion + '"')) { Fail 'WGT_VERSION_CHECK_FAILED' }

        $IconEntry = $Zip.Entries | Where-Object { $_.FullName -eq 'icon.png' } | Select-Object -First 1
        if (-not $IconEntry) { Fail 'WGT_ICON_MISSING' }
        $IconStream = $IconEntry.Open()
        $IconImage = $null
        try {
            $IconImage = [System.Drawing.Image]::FromStream($IconStream)
            if ($IconImage.Width -ne 117 -or $IconImage.Height -ne 117) {
                Fail "WGT_ICON_SIZE_INVALID=$($IconImage.Width)x$($IconImage.Height)"
            }
        } finally {
            if ($IconImage) { $IconImage.Dispose() }
            $IconStream.Dispose()
        }

        $PlayerNav = Read-ZipText 'js/rc32-player-navigation.js'
        if ($PlayerNav -notmatch 'resetInactivePlayerNavigation') { Fail 'WGT_PLAYER_EXIT_NAVIGATION_FIX_MISSING' }
        if ($PlayerNav -notmatch 'SCRUB_STEP_MEDIUM=30000' -or $PlayerNav -notmatch 'SCRUB_STEP_FAST=60000') { Fail 'WGT_RC37_SCRUB_ACCELERATION_MISSING' }
        if ($PlayerNav -notmatch 'function clearScrubVisuals\(\)' -or $PlayerNav -notmatch 'seekWatchdog=nativeSetTimeout\(done,1800\)') { Fail 'WGT_RC313_SEEK_SURFACE_FIX_MISSING' }

        $Release = Read-ZipText 'js/rc-release.js'
        if ($Release -notmatch 'getCurrentApplication\(\)\.exit\(\)') { Fail 'WGT_ROOT_BACK_EXIT_MISSING' }
        if ($Release -notmatch 'function seriesPageOpen\(\)' -or $Release -notmatch '!seriesPageOpen\(\)') { Fail 'WGT_RC311_SERIES_BACK_GUARD_MISSING' }

        $Enhancements = Read-ZipText 'js/rc37-enhancements.js'
        foreach ($Marker in @('/api/diagnostics','/api/history','/api/next','homecinema.favorites','homecinema.progress.queue')) {
            if ($Enhancements -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC37_MARKER_MISSING=$Marker" }
        }

        $SearchSurface = Read-ZipText 'js/rc38-search-surface.js'
        foreach ($Marker in @("input.blur()","input.style.visibility='hidden'","overlay.classList.add('hidden')",'MutationObserver')) {
            if ($SearchSurface -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC38_SEARCH_SURFACE_MARKER_MISSING=$Marker" }
        }

        $Cinematic = Read-ZipText 'js/rc39-cinematic-ui.js'
        foreach ($Marker in @("rc3.9-cinematic-ui","item.backdrop_url||item.poster_url",'cin-card-rating','MutationObserver')) {
            if ($Cinematic -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC39_CINEMATIC_MARKER_MISSING=$Marker" }
        }

        $Compact = Read-ZipText 'css/rc310-home-series.css'
        foreach ($Marker in @('height:610px','.hero-actions{display:none!important}','.media-title,.media-meta,.kind{display:none!important}','.series310-page','.series310-season-rail','.series310-episode-rail')) {
            if ($Compact -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC310_COMPACT_CSS_MARKER_MISSING=$Marker" }
        }

        $SeriesPage = Read-ZipText 'js/rc310-series-page.js'
        foreach ($Marker in @("rc3.10-series-page",'[data-card-type="show"]','/api/shows/','data-series310-season','data-play-source','playerVisible()')) {
            if ($SeriesPage -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC310_SERIES_PAGE_MARKER_MISSING=$Marker" }
        }

        $RouteConfig = Read-ZipText 'js/config.js'
        if ($RouteConfig -notmatch 'js/rc314-audio-metadata\.js') { Fail 'WGT_RC314_AUDIO_LAYER_NOT_LOADED' }
        $AudioMetadata = Read-ZipText 'js/rc314-audio-metadata.js'
        foreach ($Marker in @('audio_tracks','HOME_CINEMA_AUDIO_PROFILES','details.join','channelLabel','codecLabel')) {
            if ($AudioMetadata -notmatch [regex]::Escape($Marker)) { Fail "WGT_RC314_AUDIO_MARKER_MISSING=$Marker" }
        }
    } finally { $Zip.Dispose() }
}

$File = Get-Item $Target
$Hash = Get-FileHash $Target -Algorithm SHA256
$Manifest = [ordered]@{
    product = 'Home Cinema'
    version = $Version
    rc = $RC
    package = $ReleaseName
    source_sha = $SourceSha
    size = $File.Length
    sha256 = $Hash.Hash
    certificate_profile = $CertificateProfile
    icon_canvas = '117x117'
    icon_tile = '110x62'
    icon_tile_aspect = '16:9'
    seek_surface_fix = 'rc3.13'
    audio_metadata = 'rc3.14-compact'
    built_utc = [DateTime]::UtcNow.ToString('o')
    installed = $false
}

if ($Install) {
    Run-Step 'INSTALL TO SAMSUNG TV' {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'INSTALL-SAMSUNG-WGT.ps1') -TvIp $TvIp -PackagePath $Target -Run
        if ($LASTEXITCODE -ne 0) { Fail "TV_INSTALL_FAILED=$LASTEXITCODE" }
    }
    $Manifest.installed = $true
}

$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $ManifestTarget -Encoding UTF8

Write-Host ''
Write-Host '=============================================='
Write-Host 'HOME_CINEMA_TV_RELEASE=PASS'
Write-Host "VERSION=$Version"
Write-Host "RC=$RC"
Write-Host "SOURCE_SHA=$SourceSha"
Write-Host "WGT=$Target"
Write-Host "WGT_SIZE=$($File.Length)"
Write-Host "WGT_SHA256=$($Hash.Hash)"
Write-Host "ICON_CANVAS=117x117"
Write-Host "ICON_TILE=110x62"
Write-Host "ICON_TILE_ASPECT=16:9"
Write-Host 'SEEK_SURFACE_FIX=rc3.13'
Write-Host 'AUDIO_METADATA=rc3.14-compact'
Write-Host "MANIFEST=$ManifestTarget"
Write-Host "TV_INSTALL=$([bool]$Install)"
Write-Host '=============================================='

explorer.exe "/select,`"$Target`""
