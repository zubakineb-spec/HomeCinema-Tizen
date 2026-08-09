param(
    [string]$ExpectedHost = "192.168.0.101",
    [int]$HttpPort = 8096
)

$ErrorActionPreference = "Stop"
$BaseUrl = "http://$ExpectedHost`:$HttpPort"

function Get-DirectText([string]$Url) {
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = "GET"
    $req.Proxy = $null
    $req.KeepAlive = $false
    $req.Timeout = 5000
    $resp = [System.Net.HttpWebResponse]$req.GetResponse()
    try {
        $rd = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
        return $rd.ReadToEnd()
    } finally { $resp.Close() }
}

Write-Host "=== HOME CINEMA DLNA / SSDP PROBE ==="
Write-Host "Expected: HOME CINEMA at $BaseUrl"

$udp = New-Object System.Net.Sockets.UdpClient
$udp.Client.ReceiveTimeout = 4500
$target = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Parse("239.255.255.250")),1900
$search = "M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nMX: 2`r`nST: urn:schemas-upnp-org:device:MediaServer:1`r`n`r`n"
$bytes = [Text.Encoding]::ASCII.GetBytes($search)
[void]$udp.Send($bytes, $bytes.Length, $target)

$found = $false
$responses = New-Object System.Collections.Generic.List[string]
$remote = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any),0
try {
    while ($true) {
        $data = $udp.Receive([ref]$remote)
        $text = [Text.Encoding]::UTF8.GetString($data)
        $responses.Add($text) | Out-Null
        if ($text -match [regex]::Escape("$BaseUrl/dlna/device.xml") -or $text -match 'HomeCinema/') {
            $found = $true
            break
        }
    }
} catch [System.Net.Sockets.SocketException] {
    # Receive timeout is expected when no more SSDP responses arrive.
} finally { $udp.Close() }

Write-Host "SSDP responses: $($responses.Count)"
if (-not $found) {
    Write-Host "HOME_CINEMA_SSDP=NOT_FOUND"
    foreach ($x in $responses) { Write-Host "---"; Write-Host $x }
    throw "HOME CINEMA did not answer SSDP M-SEARCH"
}
Write-Host "HOME_CINEMA_SSDP=PASS"

$device = Get-DirectText "$BaseUrl/dlna/device.xml"
if ($device -notmatch '<friendlyName>HOME CINEMA</friendlyName>') { throw "DLNA device.xml has wrong friendlyName" }
if ($device -notmatch 'urn:schemas-upnp-org:device:MediaServer:1') { throw "MediaServer device type missing" }
Write-Host "DEVICE_DESCRIPTION=PASS"

$soap = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>0</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>'
$raw = [Text.Encoding]::UTF8.GetBytes($soap)
$req = [System.Net.HttpWebRequest]::Create("$BaseUrl/dlna/control/content")
$req.Method = "POST"
$req.Proxy = $null
$req.KeepAlive = $false
$req.ContentType = 'text/xml; charset="utf-8"'
$req.Headers.Add("SOAPAction", '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"')
$req.ContentLength = $raw.Length
$stream = $req.GetRequestStream()
$stream.Write($raw,0,$raw.Length)
$stream.Close()
$resp = [System.Net.HttpWebResponse]$req.GetResponse()
try {
    $rd = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $browse = $rd.ReadToEnd()
} finally { $resp.Close() }
if ($browse -notmatch 'Фильмы' -or $browse -notmatch 'Сериалы') { throw "DLNA root Browse does not contain Movies/Shows" }
Write-Host "CONTENT_DIRECTORY_BROWSE=PASS"

Write-Host ""
Write-Host "HOME_CINEMA_DLNA_WINDOWS_PROBE=PASS"
Write-Host "Samsung: Sources -> HOME CINEMA"
