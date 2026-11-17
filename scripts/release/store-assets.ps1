# Generate Store tiles from the existing multi-resolution product icon.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$ruyinRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ruyinIcon = [IO.File]::ReadAllBytes((Join-Path $ruyinRoot 'apps/shell/icons/icon.ico'))
$ruyinCount = [BitConverter]::ToUInt16($ruyinIcon, 4)
$ruyinPng = $null
for ($ruyinIndex = 0; $ruyinIndex -lt $ruyinCount; $ruyinIndex++) {
  $ruyinEntry = 6 + 16 * $ruyinIndex
  if ($ruyinIcon[$ruyinEntry] -eq 0 -and $ruyinIcon[$ruyinEntry + 1] -eq 0) {
    $ruyinSize = [BitConverter]::ToUInt32($ruyinIcon, $ruyinEntry + 8)
    $ruyinOffset = [BitConverter]::ToUInt32($ruyinIcon, $ruyinEntry + 12)
    $ruyinPng = [byte[]]$ruyinIcon[$ruyinOffset..($ruyinOffset + $ruyinSize - 1)]
    break
  }
}
if (-not $ruyinPng) { throw 'Product icon must contain a 256px PNG frame' }
$ruyinAssetDir = Join-Path $ruyinRoot 'apps/shell/installer/appx'
New-Item -ItemType Directory -Force -Path $ruyinAssetDir | Out-Null
$ruyinStream = [IO.MemoryStream]::new($ruyinPng, $false)
$ruyinSource = [Drawing.Image]::FromStream($ruyinStream)
try {
  foreach ($ruyinTile in @(
    @('StoreLogo', 50, 50),
    @('Square150x150Logo', 150, 150),
    @('Square44x44Logo', 44, 44),
    @('Wide310x150Logo', 310, 150)
  )) {
    $ruyinBitmap = [Drawing.Bitmap]::new([int]$ruyinTile[1], [int]$ruyinTile[2])
    $ruyinGraphics = [Drawing.Graphics]::FromImage($ruyinBitmap)
    try {
      $ruyinGraphics.Clear([Drawing.Color]::Transparent)
      $ruyinGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $ruyinSide = [Math]::Min([int]$ruyinTile[1], [int]$ruyinTile[2])
      $ruyinGraphics.DrawImage($ruyinSource, [int](($ruyinTile[1] - $ruyinSide) / 2), 0, $ruyinSide, $ruyinSide)
      $ruyinBitmap.Save((Join-Path $ruyinAssetDir ($ruyinTile[0] + '.png')), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $ruyinGraphics.Dispose()
      $ruyinBitmap.Dispose()
    }
  }
} finally {
  $ruyinSource.Dispose()
  $ruyinStream.Dispose()
}
Write-Output '[store-assets] Generated four product tiles'
