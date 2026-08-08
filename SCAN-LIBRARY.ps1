$ErrorActionPreference = 'Stop'
$r = Invoke-RestMethod -Method Post -Uri 'http://localhost:8096/api/scan'
$r | Format-List
