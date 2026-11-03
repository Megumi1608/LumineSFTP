Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'build/luminecloud-logo.png'
$assetDir = Join-Path $root 'src/renderer/src/assets'
$assetPath = Join-Path $assetDir 'luminecloud-cloud.png'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

$source = [System.Drawing.Bitmap]::new($sourcePath)

# Find the visible logo bounds so the cloud is not lost inside its transparent padding.
$minX = $source.Width
$minY = $source.Height
$maxX = -1
$maxY = -1
for ($y = 0; $y -lt $source.Height; $y++) {
  for ($x = 0; $x -lt $source.Width; $x++) {
    if ($source.GetPixel($x, $y).A -gt 16) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

$pad = 8
$minX = [Math]::Max(0, $minX - $pad)
$minY = [Math]::Max(0, $minY - $pad)
$maxX = [Math]::Min($source.Width - 1, $maxX + $pad)
$maxY = [Math]::Min($source.Height - 1, $maxY + $pad)
$crop = [System.Drawing.Rectangle]::new($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))

$cloud = [System.Drawing.Bitmap]::new($crop.Width, $crop.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($cloud)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($source, [System.Drawing.Rectangle]::new(0, 0, $crop.Width, $crop.Height), $crop, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$cloud.Save($assetPath, [System.Drawing.Imaging.ImageFormat]::Png)

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$size = 1024
$icon = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

$frame = New-RoundedPath 28 28 968 968 228
$frameBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 11, 11))
$g.FillPath($frameBrush, $frame)
$framePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 31, 31, 31), 3)
$g.DrawPath($framePen, $frame)

$targetWidth = 700
$targetHeight = [int][Math]::Round($targetWidth * $cloud.Height / $cloud.Width)
$targetX = [int](($size - $targetWidth) / 2)
$targetY = [int](($size - $targetHeight) / 2)
$attributes = New-Object System.Drawing.Imaging.ImageAttributes
$attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
$g.DrawImage(
  $cloud,
  [System.Drawing.Rectangle]::new($targetX, $targetY, $targetWidth, $targetHeight),
  0,
  0,
  $cloud.Width,
  $cloud.Height,
  [System.Drawing.GraphicsUnit]::Pixel,
  $attributes
)

$icon.Save((Join-Path $root 'build/icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$icon.Dispose()
$cloud.Dispose()
$source.Dispose()
Write-Output "wrote build/icon.png and $assetPath"
