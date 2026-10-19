# Gera installer\dist\Motion-Film-Setup-<versao>.exe
#
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#
# Usa só o que já vem no Windows: o csc.exe do .NET Framework 4.x e
# System.IO.Compression. Empacota motion-film\ (sem os arquivos de dev:
# .debug e README.md) + figma-plugin\ num zip embutido no .exe.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem, System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$obj  = Join-Path $here 'obj'
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $obj, $dist | Out-Null

# Versão = ExtensionBundleVersion do manifesto (e valida o XML de cara).
$manifest = [xml](Get-Content -Raw -Encoding UTF8 (Join-Path $root 'motion-film\CSXS\manifest.xml'))
$version = $manifest.ExtensionManifest.ExtensionBundleVersion
Write-Host "Versão $version"

# ---------- payload.zip (entradas sempre com "/")
$zipPath = Join-Path $obj 'payload.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$exclude = @('.debug', 'README.md')
$fs = [System.IO.File]::Open($zipPath, 'CreateNew')
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
foreach ($pkg in 'motion-film', 'figma-plugin') {
  $base = Join-Path $root $pkg
  Get-ChildItem $base -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length + 1)
    if ($exclude -contains $rel) { return }
    # Media left over from the old in-extension pack store (packs now live in
    # Documents\Mótion Film Packs) -- never ship someone's pack media.
    if ($pkg -eq 'motion-film' -and $rel -match '^client\\assets\\(kit-assets\\|kit-previews\\(?!README\.md$))') { return }
    $entryName = $pkg + '/' + ($rel -replace '\\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
}
$zip.Dispose(); $fs.Dispose()
Write-Host ("payload.zip: {0:N1} MB" -f ((Get-Item $zipPath).Length / 1MB))

# ---------- ícone (.ico com PNG 256 dentro, aceito desde o Vista)
$icoPath = Join-Path $obj 'icon.ico'
$sizes = 256, 48, 32, 16
$pngs = foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $s / 256.0
  $r = 56 * $k
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $w = $s - 1
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($w - $r, 0, $r, $r, 270, 90)
  $path.AddArc($w - $r, $w - $r, $r, $r, 0, 90); $path.AddArc(0, $w - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 240, 17))), $path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(17, 17, 17)), ([Math]::Max(1.5, 18 * $k))
  $pen.LineJoin = 'Round'
  foreach ($dy in 0, 44, 88) {
    $pts = @(
      (New-Object System.Drawing.PointF (128 * $k), ((52 + $dy) * $k)),
      (New-Object System.Drawing.PointF (206 * $k), ((92 + $dy) * $k)),
      (New-Object System.Drawing.PointF (128 * $k), ((132 + $dy) * $k)),
      (New-Object System.Drawing.PointF (50 * $k), ((92 + $dy) * $k))
    )
    if ($dy -eq 0) { $g.DrawPolygon($pen, $pts) } else { $g.DrawLines($pen, @($pts[3], $pts[2], $pts[1])) }
  }
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  , $ms.ToArray()
}
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$b); $bw.Write([byte]$b); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())

# ---------- compila
$src = [System.IO.File]::ReadAllText((Join-Path $here 'Installer.cs'), [System.Text.Encoding]::UTF8).Replace('__VERSION__', $version)
$srcPath = Join-Path $obj 'Installer.gen.cs'
[System.IO.File]::WriteAllText($srcPath, $src, (New-Object System.Text.UTF8Encoding($true)))

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$fw = Split-Path $csc
$out = Join-Path $dist "Motion-Film-Setup-$version.exe"
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$out" "/win32icon:$icoPath" "/resource:$zipPath,payload.zip" `
  "/r:$fw\System.IO.Compression.dll" "/r:$fw\System.Windows.Forms.dll" "/r:$fw\System.Drawing.dll" $srcPath
if ($LASTEXITCODE -ne 0) { throw "csc falhou ($LASTEXITCODE)" }
Write-Host ("OK: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
