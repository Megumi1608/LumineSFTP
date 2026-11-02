Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

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

$outer = New-RoundedPath 28 28 968 968 228
$rect = New-Object System.Drawing.Rectangle 28, 28, 968, 968
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $rect,
  [System.Drawing.Color]::FromArgb(255, 42, 42, 42),
  [System.Drawing.Color]::FromArgb(255, 5, 5, 5),
  58
)
$g.FillPath($bg, $outer)

$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(55, 255, 255, 255), 3)
$g.DrawPath($borderPen, $outer)

$glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 255, 255, 255))
$g.FillEllipse($glow, 120, -140, 820, 760)

$barBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 250, 248))
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$violet = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 168, 168, 164))
$dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 10, 10))

for ($i = 0; $i -lt 3; $i++) {
  $y = 262 + $i * 190
  $bar = New-RoundedPath 236 $y 552 132 32
  $g.FillPath($barBrush, $bar)
  $dot = if ($i -eq 1) { $violet } else { $dark }
  $g.FillEllipse($dot, 292, ($y + 51), 30, 30)
  $g.FillRectangle($dark, 596, ($y + 57), 118, 16)
}

# Small security badge in the lower-right corner.
$badge = New-RoundedPath 700 704 190 190 52
$g.FillPath($dark, $badge)
$badgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255, 255), 7)
$g.DrawPath($badgePen, $badge)
$lockPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255, 255), 18)
$lockPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$lockPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($lockPen, 762, 760, 66, 70, 180, 180)
$lockBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
$lockBody = New-RoundedPath 750 802 90 70 14
$g.FillPath($lockBrush, $lockBody)

New-Item -ItemType Directory -Force -Path build | Out-Null
$bmp.Save("$PSScriptRoot\..\build\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "wrote build/icon.png"
