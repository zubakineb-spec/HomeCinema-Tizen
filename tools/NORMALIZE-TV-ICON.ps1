param(
    [Parameter(Mandatory = $true)]
    [string]$IconPath,
    [int]$CanvasSize = 117,
    [int]$ArtworkSize = 92
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $IconPath)) { throw "ICON_NOT_FOUND=$IconPath" }
if ($CanvasSize -le 0 -or $ArtworkSize -le 0 -or $ArtworkSize -ge $CanvasSize) {
    throw "INVALID_ICON_GEOMETRY canvas=$CanvasSize artwork=$ArtworkSize"
}

Add-Type -AssemblyName System.Drawing

$Resolved = (Resolve-Path $IconPath).Path
$Temp = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($Resolved),
    ([System.IO.Path]::GetFileNameWithoutExtension($Resolved) + '.normalized.tmp.png')
)

$Source = $null
$Canvas = $null
$Graphics = $null

try {
    $Source = [System.Drawing.Image]::FromFile($Resolved)
    $Canvas = New-Object System.Drawing.Bitmap($CanvasSize, $CanvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $Graphics = [System.Drawing.Graphics]::FromImage($Canvas)
    $Graphics.Clear([System.Drawing.Color]::Transparent)
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $Scale = [Math]::Min($ArtworkSize / [double]$Source.Width, $ArtworkSize / [double]$Source.Height)
    $Width = [Math]::Max(1, [int][Math]::Round($Source.Width * $Scale))
    $Height = [Math]::Max(1, [int][Math]::Round($Source.Height * $Scale))
    $X = [int][Math]::Floor(($CanvasSize - $Width) / 2)
    $Y = [int][Math]::Floor(($CanvasSize - $Height) / 2)

    $Graphics.DrawImage($Source, $X, $Y, $Width, $Height)
    $Canvas.Save($Temp, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    if ($Graphics) { $Graphics.Dispose() }
    if ($Canvas) { $Canvas.Dispose() }
    if ($Source) { $Source.Dispose() }
}

$Check = $null
try {
    $Check = [System.Drawing.Image]::FromFile($Temp)
    if ($Check.Width -ne $CanvasSize -or $Check.Height -ne $CanvasSize) {
        throw "NORMALIZED_ICON_SIZE_INVALID=$($Check.Width)x$($Check.Height)"
    }
}
finally {
    if ($Check) { $Check.Dispose() }
}

Move-Item -Path $Temp -Destination $Resolved -Force
Write-Host "TV_ICON_NORMALIZED=PASS"
Write-Host "ICON_CANVAS=${CanvasSize}x${CanvasSize}"
Write-Host "ICON_ARTWORK=${ArtworkSize}x${ArtworkSize}_MAX"
Write-Host "ICON_PATH=$Resolved"
