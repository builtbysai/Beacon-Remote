#requires -Version 5.1
# Builds apps/windows-agent/beacon.ico (and the copy the session helper embeds) from the brand mark
# at apps/web/public/beacon-mark-192.png, as a multi-size icon with PNG frames.
# Run on Windows: ./scripts/Make-Icon.ps1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'apps/web/public/beacon-mark-192.png'))
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $graphics.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    [pscustomobject]@{ Size = $size; Data = $stream.ToArray() }
}
$source.Dispose()
$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $output
$writer.Write([uint16]0)              # reserved
$writer.Write([uint16]1)              # type: icon
$writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
    $dimension = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)   # width (0 means 256)
    $writer.Write([byte]$dimension)   # height
    $writer.Write([byte]0)            # palette colours
    $writer.Write([byte]0)            # reserved
    $writer.Write([uint16]1)          # colour planes
    $writer.Write([uint16]32)         # bits per pixel
    $writer.Write([uint32]$frame.Data.Length)
    $writer.Write([uint32]$offset)
    $offset += $frame.Data.Length
}
foreach ($frame in $frames) { $writer.Write($frame.Data) }
$writer.Flush()
foreach ($target in 'apps/windows-agent/beacon.ico', 'apps/windows-session/beacon.ico') {
    [System.IO.File]::WriteAllBytes((Join-Path $root $target), $output.ToArray())
    Write-Host "Wrote $target"
}
