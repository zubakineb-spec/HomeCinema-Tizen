param(
    [Parameter(Mandatory = $true)]
    [string]$IconPath,
    [int]$CanvasSize = 117,
    [int]$TileWidth = 110,
    [int]$TileHeight = 62,
    [int]$CornerRadius = 7
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $IconPath)) { throw "ICON_NOT_FOUND=$IconPath" }
if ($CanvasSize -le 0 -or $TileWidth -le 0 -or $TileHeight -le 0) {
    throw "INVALID_ICON_GEOMETRY canvas=$CanvasSize tile=${TileWidth}x${TileHeight}"
}
if ($TileWidth -gt $CanvasSize -or $TileHeight -gt $CanvasSize) {
    throw "ICON_TILE_EXCEEDS_CANVAS canvas=$CanvasSize tile=${TileWidth}x${TileHeight}"
}
if ($CornerRadius -lt 0 -or ($CornerRadius * 2) -gt [Math]::Min($TileWidth, $TileHeight)) {
    throw "INVALID_ICON_CORNER_RADIUS=$CornerRadius"
}

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath([System.Drawing.RectangleF]$Rect, [float]$Radius) {
    $Path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($Radius -le 0) {
        $Path.AddRectangle($Rect)
        return $Path
    }

    $Diameter = $Radius * 2
    $Arc = New-Object System.Drawing.RectangleF($Rect.X, $Rect.Y, $Diameter, $Diameter)
    $Path.AddArc($Arc, 180, 90)
    $Arc.X = $Rect.Right - $Diameter
    $Path.AddArc($Arc, 270, 90)
    $Arc.Y = $Rect.Bottom - $Diameter
    $Path.AddArc($Arc, 0, 90)
    $Arc.X = $Rect.Left
    $Path.AddArc($Arc, 90, 90)
    $Path.CloseFigure()
    return $Path
}

$Resolved = (Resolve-Path $IconPath).Path
$Temp = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($Resolved),
    ([System.IO.Path]::GetFileNameWithoutExtension($Resolved) + '.normalized.tmp.png')
)

$Source = $null
$Canvas = $null
$Graphics = $null
$ClipPath = $null

try {
    $Source = [System.Drawing.Image]::FromFile($Resolved)
    $Canvas = New-Object System.Drawing.Bitmap($CanvasSize, $CanvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $Graphics = [System.Drawing.Graphics]::FromImage($Canvas)
    $Graphics.Clear([System.Drawing.Color]::Transparent)
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Samsung dev-install package icons are fixed to a 117x117 test canvas.
    # Render a 16:9 visual tile inside that canvas so the launcher appearance
    # matches the wide tiles used by published Samsung TV apps more closely.
    $X = [float](($CanvasSize - $TileWidth) / 2.0)
    $Y = [float](($CanvasSize - $TileHeight) / 2.0)
    $Destination = New-Object System.Drawing.RectangleF($X, $Y, [float]$TileWidth, [float]$TileHeight)

    $TileAspect = $TileWidth / [double]$TileHeight
    $SourceAspect = $Source.Width / [double]$Source.Height

    if ($SourceAspect -gt $TileAspect) {
        $CropHeight = [double]$Source.Height
        $CropWidth = $CropHeight * $TileAspect
        $CropX = ($Source.Width - $CropWidth) / 2.0
        $CropY = 0.0
    } else {
        $CropWidth = [double]$Source.Width
        $CropHeight = $CropWidth / $TileAspect
        $CropX = 0.0
        $CropY = ($Source.Height - $CropHeight) / 2.0
    }

    $SourceRect = New-Object System.Drawing.RectangleF([float]$CropX, [float]$CropY, [float]$CropWidth, [float]$CropHeight)
    $ClipPath = New-RoundedRectanglePath $Destination ([float]$CornerRadius)
    $Graphics.SetClip($ClipPath)
    $Graphics.DrawImage($Source, $Destination, $SourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    $Graphics.ResetClip()

    $Canvas.Save($Temp, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    if ($ClipPath) { $ClipPath.Dispose() }
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
Write-Host "ICON_TILE=${TileWidth}x${TileHeight}"
Write-Host "ICON_TILE_ASPECT=16:9"
Write-Host "ICON_CORNER_RADIUS=$CornerRadius"
Write-Host "ICON_PATH=$Resolved"
