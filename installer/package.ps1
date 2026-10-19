# Gera a versão para passar para outro computador (padrão de atualização):
#
#   powershell -ExecutionPolicy Bypass -File installer\package.ps1
#
#   1. roda build.ps1  -> installer\dist\Motion-Film-Setup-<v>.exe
#   2. monta motion-film-v<v>.rar na raiz do projeto com só:
#        Motion-Film-Setup-<v>.exe   instala OU atualiza (extensão CEP com
#                                    todas as janelas + plugin do Figma)
#        INSTALAR.txt                (installer\INSTALAR.txt, versão preenchida)
#
# Sem pastas para copiar à mão (pedido do usuário): o .exe faz tudo, inclusive
# remover uma cópia manual antiga em Program Files (pede administrador).
#
# Regra que torna "Atualizar" seguro: NENHUM dado do usuário fica dentro
# da pasta da extensão. Packs e settings.json (cores, paletas, presets)
# ficam em Documentos\Mótion Film Packs; o instalador só troca a pasta
# da extensão e a do plugin. Antes de lançar uma versão: subir a versão
# no CSXS\manifest.xml (as 5 ocorrências) e o ?v= dos <script> alterados.
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'build.ps1')
if ($LASTEXITCODE -ne 0) { throw "build.ps1 falhou" }

$manifest = [xml](Get-Content -Raw -Encoding UTF8 (Join-Path $root 'motion-film\CSXS\manifest.xml'))
$version = $manifest.ExtensionManifest.ExtensionBundleVersion

$rar = @("$env:ProgramFiles\WinRAR\Rar.exe", "${env:ProgramFiles(x86)}\WinRAR\Rar.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $rar) { throw "WinRAR (Rar.exe) não encontrado" }

$stage = Join-Path $here 'obj\package'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $here "dist\Motion-Film-Setup-$version.exe") $stage
$txt = [System.IO.File]::ReadAllText((Join-Path $here 'INSTALAR.txt'), [System.Text.Encoding]::UTF8).Replace('__VERSION__', $version)
[System.IO.File]::WriteAllText((Join-Path $stage 'INSTALAR.txt'), $txt, (New-Object System.Text.UTF8Encoding($true)))

$out = Join-Path $root "motion-film-v$version.rar"
if (Test-Path $out) { Remove-Item $out -Force }
Push-Location $stage
try {
  & $rar a -r -m5 -ep1 -idq $out '*'
  if ($LASTEXITCODE -ne 0) { throw "Rar.exe falhou ($LASTEXITCODE)" }
} finally { Pop-Location }
& $rar t -idq $out
if ($LASTEXITCODE -ne 0) { throw "RAR gerado não passou no teste" }
Write-Host ("OK: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
