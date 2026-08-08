param(
    [string]$BaseUrl = "http://192.168.0.101:8096"
)

$ErrorActionPreference = "Stop"

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "FAIL: $Message" }
}

Write-Host "=== HOME CINEMA v0.3.8 ACCEPTANCE ==="

$health = Invoke-RestMethod "$BaseUrl/api/health"
$health | Format-List status,version,runtime,media_root,tmdb,ffmpeg,ffprobe,target_nas,target_tv
Assert-True ($health.status -eq "ok") "health status is not ok"
Assert-True ($health.version -eq "0.3.8") "expected version 0.3.8"
Assert-True ([bool]$health.tmdb) "TMDb is disabled"

Write-Host "`n=== SCAN ==="
$scan = Invoke-RestMethod -Method Post "$BaseUrl/api/scan"
$scan | Format-List
Assert-True ($scan.video_files -eq 90) "expected 90 video files"
Assert-True ($scan.movies -eq 8) "expected 8 movies"
Assert-True ($scan.shows -eq 11) "expected 11 shows"
Assert-True ($scan.episodes -eq 81) "expected 81 real episodes"
Assert-True ($scan.extras -eq 1) "expected 1 extra"

Write-Host "`n=== CATALOG ==="
$c = Invoke-RestMethod "$BaseUrl/api/catalog"
Assert-True ($c.movies.Count -eq 8) "catalog movie count differs"
Assert-True ($c.shows.Count -eq 11) "catalog show count differs"

$pasha = @($c.shows | Where-Object { $_.title -eq "Pasha" })
Assert-True ($pasha.Count -eq 1) "Pasha must resolve to exactly one show"
$p = Invoke-RestMethod "$BaseUrl/api/shows/$($pasha[0].id)"
Assert-True ($p.episodes.Count -eq 8) "Pasha must contain 8 real episodes"
Assert-True ($p.extras.Count -eq 1) "Pasha must contain 1 extra"
Assert-True ($p.extras[0].title -eq "Фильм о фильме") "Pasha extra title mismatch"
Assert-True ($p.extras[0].content_type -eq "extra") "Pasha bonus must be content_type=extra"
Assert-True ($p.extras[0].metadata_status -eq "local") "Pasha bonus must be local metadata"

$after = @($c.shows | Where-Object { $_.title -eq "After Life" })
Assert-True ($after.Count -eq 1) "After Life must resolve to exactly one show"
$a = Invoke-RestMethod "$BaseUrl/api/shows/$($after[0].id)"
$pending = @($a.episodes | Where-Object { $_.metadata_status -ne "matched" })
Assert-True ($pending.Count -eq 0) "After Life still has pending episodes"

Write-Host "`n=== HTTP RANGE / DIRECT PLAY ==="
$sample = $c.movies | Select-Object -First 1
Assert-True ([bool]$sample.source_url) "No movie source_url available for Range test"

# Windows PowerShell 5.1 treats Range as a restricted header for
# Invoke-WebRequest -Headers. HttpWebRequest.AddRange is the compatible API.
$req = [System.Net.HttpWebRequest]::Create([string]$sample.source_url)
$req.Method = "GET"
$req.AddRange(0, 1023)
$req.Timeout = 15000
$resp = $null
try {
    $resp = [System.Net.HttpWebResponse]$req.GetResponse()
    $statusCode = [int]$resp.StatusCode
    $contentRange = [string]$resp.Headers["Content-Range"]
    $acceptRanges = [string]$resp.Headers["Accept-Ranges"]
} finally {
    if ($null -ne $resp) { $resp.Close() }
}

Assert-True ($statusCode -eq 206) "Range request did not return HTTP 206"
Assert-True (-not [string]::IsNullOrWhiteSpace($contentRange)) "Content-Range header is missing"
Assert-True ($acceptRanges -match "bytes") "Accept-Ranges: bytes is missing"

Write-Host "Sample: $($sample.title)"
Write-Host "Status: $statusCode"
Write-Host "Content-Range: $contentRange"
Write-Host "Accept-Ranges: $acceptRanges"

Write-Host "`nHOME_CINEMA_ACCEPTANCE=PASS"
