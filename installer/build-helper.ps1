# Compila o helper do Windows (atalho global + popup Elastic):
#
#   powershell -ExecutionPolicy Bypass -File installer\build-helper.ps1 [-Out caminho.exe]
#
# installer\helper\MFHelper.cs -> motion-film\bin\win\MFHelper.exe (dev: o
# symlink usa esse), com o csc do .NET Framework 4.x que já vem no
# Windows. bin\ fica fora do git. O build.ps1 passa -Out installer\obj\...
# (com o AE aberto o .exe da pasta de dev está rodando e não pode ser
# sobrescrito) e põe essa cópia no instalador.
param([string]$Out = "")
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$src = Join-Path $here 'helper\MFHelper.cs'
$out = $Out
if (-not $out) { $out = Join-Path $root 'motion-film\bin\win\MFHelper.exe' }
New-Item -ItemType Directory -Force (Split-Path -Parent $out) | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$out" /r:System.Windows.Forms.dll /r:System.Drawing.dll $src
if ($LASTEXITCODE -ne 0) { throw "csc falhou ($LASTEXITCODE)" }
Write-Host "OK: $out"
