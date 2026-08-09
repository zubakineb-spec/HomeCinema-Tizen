param(
    [string]$BaseUrl = "http://192.168.0.101:8096"
)

$ErrorActionPreference = "Stop"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "FAIL: $Message" }
}

function Get-JsonDirect {
    param([string]$Url)

    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $resp = $null
        $reader = $null
        try {
            $req = [System.Net.HttpWebRequest]::Create($Url)
            $req.Method = "GET"
            $req.Proxy = $null
            $req.KeepAlive = $false
            $req.Timeout = 15000
            $req.ReadWriteTimeout = 15000
            $req.UserAgent = "HomeCinema-Acceptance/0.3.9"

            $resp = [System.Net.HttpWebResponse]$req.GetResponse()
            if ([int]$resp.StatusCode -ne 200) {
                throw "HTTP $([int]$resp.StatusCode) from $Url"
            }

            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
            $text = $reader.ReadToEnd()
            return ($text | ConvertFrom-Json)
        }
        catch {
            $lastError = $_
            if ($attempt -lt 3) { Start-Sleep -Milliseconds (500 * $attempt) }
        }
        finally {
            if ($null -ne $reader) { $reader.Close() }
            if ($null -ne $resp) { $resp.Close() }
        }
    }

    throw "Direct LAN GET failed after 3 attempts: $Url ; $($lastError.Exception.Message)"
}

function Test-Range {
    param([string]$Url)
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = "GET"
    $req.Proxy = $null
    $req.KeepAlive = $false
    $req.AddRange(0, 1023)
    $req.Timeout = 15000
    $req.ReadWriteTimeout = 15000
    $resp = $null
    try {
        $resp = [System.Net.HttpWebResponse]$req.GetResponse()
        $status = [int]$resp.StatusCode
        $contentRange = [string]$resp.Headers["Content-Range"]
        $acceptRanges = [string]$resp.Headers["Accept-Ranges"]
        return ($status -eq 206 -and $contentRange -and $acceptRanges -match "bytes")
    }
    finally {
        if ($null -ne $resp) { $resp.Close() }
    }
}

function Confirm-Step {
    param([string]$Prompt)
    while ($true) {
        $answer = (Read-Host "$Prompt [да/нет]").Trim().ToLowerInvariant()
        if ($answer -in @("да","д","yes","y")) { return $true }
        if ($answer -in @("нет","н","no","n")) { return $false }
    }
}

Write-Host "=== HOME CINEMA NAS PLAYBACK ACCEPTANCE ==="
Write-Host "API transport: direct LAN, proxy disabled, keep-alive disabled"

$health = Get-JsonDirect "$BaseUrl/api/health"
Assert-True ($health.status -eq "ok") "Home Cinema health is not ok"
Assert-True ($health.version -eq "0.3.8") "Expected runtime version 0.3.8"
Assert-True ([bool]$health.tmdb) "TMDb is disabled"

$c = Get-JsonDirect "$BaseUrl/api/catalog"
Assert-True ($c.movies.Count -ge 1) "No movies in catalog"
Assert-True ($c.shows.Count -ge 1) "No shows in catalog"

$movie = @($c.movies | Where-Object { $_.title -eq "Evil Dead Burn" } | Select-Object -First 1)
if ($movie.Count -eq 0) { $movie = @($c.movies | Select-Object -First 1) }
$movie = $movie[0]

$after = @($c.shows | Where-Object { $_.title -eq "After Life" } | Select-Object -First 1)
Assert-True ($after.Count -eq 1) "After Life was not found"
$afterDetails = Get-JsonDirect "$BaseUrl/api/shows/$($after[0].id)"
$episode = @($afterDetails.episodes | Sort-Object season,episode | Select-Object -First 1)
Assert-True ($episode.Count -eq 1) "No After Life episode found"
$episode = $episode[0]

$pasha = @($c.shows | Where-Object { $_.title -eq "Pasha" } | Select-Object -First 1)
Assert-True ($pasha.Count -eq 1) "Pasha was not found"
$pashaDetails = Get-JsonDirect "$BaseUrl/api/shows/$($pasha[0].id)"
$extra = @($pashaDetails.extras | Where-Object { $_.title -eq "Фильм о фильме" } | Select-Object -First 1)
Assert-True ($extra.Count -eq 1) "Pasha extra 'Фильм о фильме' was not found"
$extra = $extra[0]

$targets = @(
    [pscustomobject]@{ Kind="Фильм"; Title=$movie.title; Url=$movie.source_url },
    [pscustomobject]@{ Kind="Серия"; Title=("After Life S{0:D2}E{1:D2}" -f [int]$episode.season,[int]$episode.episode); Url=$episode.source_url },
    [pscustomobject]@{ Kind="Доп. материал"; Title="Pasha — Фильм о фильме"; Url=$extra.source_url }
)

Write-Host "`n=== DIRECT PLAY TRANSPORT ==="
foreach ($t in $targets) {
    $ok = Test-Range $t.Url
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host ("{0}: {1} => Range {2}" -f $t.Kind,$t.Title,$mark)
    Assert-True $ok ("HTTP Range failed for " + $t.Title)
}

Write-Host "`nОткрываю существующий Home Cinema на NAS: $BaseUrl/"
Start-Process ($BaseUrl + "/")

Write-Host "`nПроверяем NAS/web-player после web UI hotfix."
Write-Host "Контрольный фильм: $($movie.title)"
Write-Host "Контрольная серия: After Life S$('{0:D2}' -f [int]$episode.season)E$('{0:D2}' -f [int]$episode.episode)"
Write-Host "Контрольный бонус: Pasha — Фильм о фильме"

$checks = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Name, [bool]$Pass) {
    $checks.Add([pscustomobject]@{ Name=$Name; Pass=$Pass }) | Out-Null
}

Add-Check "Главная страница загружается, постеры и метаданные видны" (Confirm-Step "Главная страница отображается нормально?")
Add-Check "Полка фильмов прокручивается дальше первых четырех карточек" (Confirm-Step "Фильмы прокручиваются стрелкой/колесом дальше первых 4 карточек?")
Add-Check "Полка сериалов прокручивается дальше первых четырех карточек" (Confirm-Step "Сериалы прокручиваются стрелкой/колесом дальше первых 4 карточек?")
Add-Check "Список серий прокручивается" (Confirm-Step "В карточке сериала список серий прокручивается и доступны серии ниже видимой области?")
Add-Check "Фильм запускается и играет не менее 30 секунд" (Confirm-Step "Запустите '$($movie.title)'. Видео и звук идут не менее 30 секунд?")
Add-Check "В web-player видны кнопки управления" (Confirm-Step "В плеере видны Назад, -10 сек, Пауза/Play, +10 сек, Аудио, CC и полноэкранный режим?")
Add-Check "Пауза и продолжение" (Confirm-Step "Пауза и повторное воспроизведение работают?")
Add-Check "Перемотка вперед" (Confirm-Step "+10 сек работает и воспроизведение продолжается?")
Add-Check "Перемотка назад" (Confirm-Step "-10 сек работает и воспроизведение продолжается?")
Add-Check "Клик по полосе прогресса перематывает" (Confirm-Step "Клик по полосе прогресса переводит фильм на выбранную позицию?")
Add-Check "Продолжить просмотр появляется" (Confirm-Step "Нажмите Назад. Карточка 'Продолжить просмотр' появилась для фильма?")
Add-Check "Возобновление с сохраненной позиции" (Confirm-Step "Запустите фильм из 'Продолжить просмотр'. Он продолжился примерно с сохраненной позиции?")
Add-Check "Серия After Life запускается" (Confirm-Step "Откройте After Life и первую серию. Воспроизведение работает?")
Add-Check "Pasha extra виден отдельно" (Confirm-Step "В Pasha виден отдельный блок 'Доп. материалы' с 'Фильм о фильме'?")
Add-Check "Pasha extra воспроизводится" (Confirm-Step "Запустите 'Фильм о фильме'. Видео и звук работают?")
Add-Check "Кнопка CC отрабатывает" (Confirm-Step "Кнопка CC реагирует: переключает доступные субтитры либо сообщает, что браузер их не обнаружил?")

$failed = @($checks | Where-Object { -not $_.Pass })
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$report = Join-Path $desktop ("HomeCinema-Playback-Acceptance-" + $stamp + ".txt")

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Home Cinema NAS Playback Acceptance") | Out-Null
$lines.Add("Date: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) | Out-Null
$lines.Add("BaseUrl: " + $BaseUrl) | Out-Null
$lines.Add("Runtime: " + $health.version) | Out-Null
$lines.Add("") | Out-Null
foreach ($x in $checks) {
    $status = if ($x.Pass) { "PASS" } else { "FAIL" }
    $lines.Add("[$status] $($x.Name)") | Out-Null
}
$lines.Add("") | Out-Null
if ($failed.Count -eq 0) {
    $lines.Add("HOME_CINEMA_PLAYBACK_ACCEPTANCE=PASS") | Out-Null
} else {
    $lines.Add("HOME_CINEMA_PLAYBACK_ACCEPTANCE=FAIL") | Out-Null
}
$lines | Set-Content -Path $report -Encoding UTF8

Write-Host "`nОтчет: $report"
if ($failed.Count -eq 0) {
    Write-Host "HOME_CINEMA_PLAYBACK_ACCEPTANCE=PASS"
    exit 0
}

Write-Host "HOME_CINEMA_PLAYBACK_ACCEPTANCE=FAIL"
$failed | Format-Table -Auto Name,Pass
exit 1
