param(
    [string]$CertificateProfile = 'HomeCinemaTV-FRESH',
    [string]$TvIp = '192.168.0.103'
)

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/zubakineb-spec/HomeCinema-Tizen.git'
$ExpectedSha = '641dc642678012830b87b3af8e84b43e1af52208'
$ExpectedVersion = '0.3.18'
$RC = 'rc3.35'
$WorkRoot = Join-Path $env:TEMP ('HomeCinema-RC335-' + [Guid]::NewGuid().ToString('N'))
$Repo = Join-Path $WorkRoot 'repo'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Wgt = Join-Path $Desktop "HomeCinema-Tizen-v$ExpectedVersion-$RC.wgt"
$Manifest = [System.IO.Path]::ChangeExtension($Wgt, '.json')
$Log = Join-Path $Desktop 'HomeCinema-RC3.35-TV-INSTALL.log'

function Fail([string]$Message) { throw $Message }
function CheckMarker([string]$Text,[string]$Marker,[string]$Name) {
    if ($Text -notmatch [regex]::Escape($Marker)) { Fail "$Name=$Marker" }
}

New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
Start-Transcript -Path $Log -Force | Out-Null

try {
    Write-Host '=================================================='
    Write-Host 'HOME CINEMA v0.3.18 RC3.35 - SMART CREDITS + NEXT EPISODE'
    Write-Host 'TV ONLY - QNAP RC3.34 IS PRESERVED'
    Write-Host 'NO UNINSTALL - APP DATA IS PRESERVED'
    Write-Host '=================================================='
    Write-Host "SOURCE_SHA=$ExpectedSha"
    Write-Host "TV=$TvIp"
    Write-Host "CERTIFICATE_PROFILE=$CertificateProfile"
    Write-Host "LOG=$Log"

    foreach ($p in @('C:\tizen-studio\tools','C:\tizen-studio\tools\ide\bin')) {
        if (Test-Path $p) { $env:PATH = "$p;$env:PATH" }
    }

    foreach ($cmd in @('git','tizen','sdb')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "REQUIRED_COMMAND_NOT_FOUND=$cmd" }
    }

    Write-Host "`n=== 1. GET EXACT RC3.35 SOURCE ==="
    & git clone --quiet $RepoUrl $Repo
    if ($LASTEXITCODE -ne 0) { Fail "GIT_CLONE_FAILED=$LASTEXITCODE" }
    & git -C $Repo checkout --quiet $ExpectedSha
    if ($LASTEXITCODE -ne 0) { Fail "GIT_CHECKOUT_FAILED=$LASTEXITCODE" }
    $actual = (& git -C $Repo rev-parse HEAD).Trim()
    if ($actual -ne $ExpectedSha) { Fail "SOURCE_SHA_MISMATCH=$actual" }
    $version = (Get-Content (Join-Path $Repo 'VERSION') -Raw).Trim()
    if ($version -ne $ExpectedVersion) { Fail "VERSION_MISMATCH=$version" }
    Write-Host 'SOURCE_VERIFY=PASS'
    Write-Host 'INTERNAL_VERSION=0.3.18_PRESERVED'

    Write-Host "`n=== 2. RC3.35 SOURCE + PLAYER BASELINE GATES ==="
    $smart = Get-Content (Join-Path $Repo 'tv-app\js\rc315-skip-credits.js') -Raw -Encoding UTF8
    foreach ($marker in @(
        "FALLBACK_PROMPT_MS=25000",
        "FALLBACK_AUTOPLAY_MS=7000",
        "CREDITS_AUTOPLAY_SECONDS=7",
        "AUTOPLAY_KEY='homecinema.autoplay.next'",
        'credits_start_ms',
        '/api/next?source_url=',
        'rc335NextEpisodePanel',
        '▶ Следующая серия',
        'Смотреть титры',
        'function handoffToNext()',
        'data-play-source',
        'lastPlaybackRatio=1',
        'seekTo(target',
        'HOME_CINEMA_RC335',
        'rc3.35-smart-credits-next'
    )) { CheckMarker $smart $marker 'RC335_MARKER_MISSING' }

    $css = Get-Content (Join-Path $Repo 'tv-app\css\rc315-skip-credits.css') -Raw -Encoding UTF8
    foreach ($marker in @('.rc335-next-episode-panel','.rc335-next-primary','.rc335-next-secondary')) {
        CheckMarker $css $marker 'RC335_CSS_MARKER_MISSING'
    }

    $seek = Get-Content (Join-Path $Repo 'tv-app\js\rc32-player-navigation.js') -Raw -Encoding UTF8
    foreach ($marker in @('function clearScrubVisuals()','seekWatchdog=nativeSetTimeout(done,1800)','SCRUB_FRAME_MS=80','SCRUB_STEP=10000')) {
        CheckMarker $seek $marker 'RC325_PLAYER_BASELINE_MISSING'
    }
    if ($smart -match 'jumpForward\(' -or $smart -match 'jumpBackward\(') { Fail 'RC335_PLAYER_OWNERSHIP_REGRESSION' }
    Write-Host 'RC335_SOURCE_GATE=PASS'
    Write-Host 'PLAYER_BASELINE=RC3.25_PRESERVED'
    Write-Host 'QNAP_BASELINE=RC3.34_PRESERVED'

    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Host "`n=== 3. RC3.35 SMOKE TEST ==="
        Push-Location $Repo
        try {
            & node 'tools\rc335-smart-next-smoke.js'
            if ($LASTEXITCODE -ne 0) { Fail "RC335_SMOKE_FAILED=$LASTEXITCODE" }
        } finally { Pop-Location }
    } else {
        Write-Warning 'Node.js not found; GitHub CI smoke gate is the source of truth.'
    }

    Write-Host "`n=== 4. BUILD, SIGN AND INSTALL RC3.35 ==="
    Push-Location $Repo
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\RELEASE-TV.ps1' -RC $RC -CertificateProfile $CertificateProfile -TvIp $TvIp -Install
        if ($LASTEXITCODE -ne 0) { Fail "RELEASE_TV_FAILED=$LASTEXITCODE" }
    } finally { Pop-Location }

    if (-not (Test-Path $Wgt)) { Fail "WGT_NOT_FOUND=$Wgt" }

    Write-Host "`n=== 5. VERIFY INSTALLED RELEASE PACKAGE CONTENT ==="
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Wgt)
    try {
        function ReadZipText([string]$Name) {
            $entry = $zip.Entries | Where-Object { $_.FullName -eq $Name } | Select-Object -First 1
            if (-not $entry) { Fail "WGT_ENTRY_MISSING=$Name" }
            $stream = $entry.Open()
            try {
                $reader = New-Object System.IO.StreamReader($stream)
                try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally { $stream.Dispose() }
        }
        $wgtSmart = ReadZipText 'js/rc315-skip-credits.js'
        $wgtCss = ReadZipText 'css/rc315-skip-credits.css'
        $wgtNav = ReadZipText 'js/rc32-player-navigation.js'
        foreach ($marker in @('/api/next?source_url=','rc335NextEpisodePanel','▶ Следующая серия','Смотреть титры','function handoffToNext()','HOME_CINEMA_RC335','rc3.35-smart-credits-next')) {
            CheckMarker $wgtSmart $marker 'WGT_RC335_MARKER_MISSING'
        }
        foreach ($marker in @('.rc335-next-episode-panel','.rc335-next-primary','.rc335-next-secondary')) {
            CheckMarker $wgtCss $marker 'WGT_RC335_CSS_MARKER_MISSING'
        }
        foreach ($marker in @('function clearScrubVisuals()','seekWatchdog=nativeSetTimeout(done,1800)','SCRUB_FRAME_MS=80','SCRUB_STEP=10000')) {
            CheckMarker $wgtNav $marker 'WGT_RC325_BASELINE_MISSING'
        }
    } finally { $zip.Dispose() }

    $hash = (Get-FileHash $Wgt -Algorithm SHA256).Hash
    $size = (Get-Item $Wgt).Length

    Write-Host ''
    Write-Host '=================================================='
    Write-Host 'HOME_CINEMA_RC335_TV_INSTALL=PASS'
    Write-Host "SOURCE_SHA=$ExpectedSha"
    Write-Host "VERSION=$ExpectedVersion"
    Write-Host 'TV_UPDATE=PASS'
    Write-Host 'QNAP_UPDATE=NOT_REQUIRED'
    Write-Host 'SKIP_CREDITS=CHAPTER_AWARE'
    Write-Host 'NEXT_EPISODE=IN_PLAYER'
    Write-Host 'NEXT_EPISODE_AUTOPLAY=7_SECONDS_WHEN_ENABLED'
    Write-Host 'NO_CHAPTER_FALLBACK=LAST_25_SECONDS'
    Write-Host 'PLAYER_BASELINE=RC3.25_PRESERVED'
    Write-Host 'ARTWORK_BASELINE=RC3.34_PRESERVED'
    Write-Host 'APP_DATA_CLEAR=NOT_ATTEMPTED'
    Write-Host "WGT=$Wgt"
    Write-Host "WGT_SIZE=$size"
    Write-Host "WGT_SHA256=$hash"
    Write-Host "MANIFEST=$Manifest"
    Write-Host "LOG=$Log"
    Write-Host 'NEXT=Test one episode with credits and a following episode on the TV.'
    Write-Host '=================================================='
}
catch {
    Write-Host ''
    Write-Host '=================================================='
    Write-Host 'HOME_CINEMA_RC335_TV_INSTALL=FAIL'
    Write-Host "ERROR=$($_.Exception.Message)"
    Write-Host 'QNAP_UPDATE=NOT_ATTEMPTED'
    Write-Host 'TV_UNINSTALL=NOT_ATTEMPTED'
    Write-Host 'APP_DATA_CLEAR=NOT_ATTEMPTED'
    Write-Host "LOG=$Log"
    Write-Host '=================================================='
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch {}
    try { Remove-Item $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
