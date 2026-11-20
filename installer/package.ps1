# Gera a versão para passar para outro computador (padrão de atualização):
#
#   powershell -ExecutionPolicy Bypass -File installer\package.ps1
#
#   1. roda build.ps1  -> installer\dist\Motion-Film-Setup-<v>.exe (o
#      instalador continua saindo, como arquivo separado da Release)
#   2. monta motion-film-v<v>.rar na raiz do projeto SEM instalador
#      (pedido do usuário: o .exe acusa vírus em alguns computadores):
#        motion-film\              a pasta da extensão, pronta para copiar em
#                                  %APPDATA%\Adobe\CEP\extensions (o mesmo
#                                  lugar onde o .exe instala)
#        Plugin Figma\             o plugin do Figma (figma-plugin\)
#        habilitar-extensoes.reg   libera extensões não assinadas (PlayerDebugMode)
#        INSTALAR.txt              (installer\INSTALAR.txt, versão preenchida)
#
# Regra que torna "Atualizar" seguro: NENHUM dado do usuário fica dentro
# da pasta da extensão. Packs e settings.json (cores, paletas, presets) e
# o wheel.json ficam em Documentos\Mótion Film Packs; trocar a pasta da
# extensão não apaga nada. Antes de lançar uma versão: subir a versão
# no CSXS\manifest.xml (todas as ocorrências) e o ?v= dos <script> alterados.
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

# Copia uma pasta do projeto para o stage com os mesmos filtros do
# instalador (build.ps1): sem arquivos de dev, sem mídia de packs antiga,
# e o MFHelper.exe recém-compilado no lugar do da pasta de dev.
function Stage-Folder([string]$pkg, [string]$destName) {
  $base = Join-Path $root $pkg
  $dest = Join-Path $stage $destName
  Get-ChildItem $base -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length + 1)
    if (@('.debug', 'README.md') -contains $rel) { return }
    if ($pkg -eq 'motion-film' -and $rel -match '^client\\assets\\(kit-assets\\|kit-previews\\(?!README\.md$))') { return }
    if ($pkg -eq 'motion-film' -and $rel -eq 'bin\win\MFHelper.exe') { return }
    $target = Join-Path $dest $rel
    New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
    Copy-Item $_.FullName $target
  }
}
Stage-Folder 'motion-film' 'motion-film'
New-Item -ItemType Directory -Force (Join-Path $stage 'motion-film\bin\win') | Out-Null
Copy-Item (Join-Path $here 'obj\MFHelper.exe') (Join-Path $stage 'motion-film\bin\win\MFHelper.exe')
Stage-Folder 'figma-plugin' 'Plugin Figma'
Copy-Item (Join-Path $here 'habilitar-extensoes.reg') $stage
$txt = [System.IO.File]::ReadAllText((Join-Path $here 'INSTALAR.txt'), [System.Text.Encoding]::UTF8).Replace('__VERSION__', $version)
[System.IO.File]::WriteAllText((Join-Path $stage 'INSTALAR.txt'), $txt, (New-Object System.Text.UTF8Encoding($true)))

$out = Join-Path $root "motion-film-v$version.rar"
if (Test-Path $out) { Remove-Item $out -Force }
Push-Location $stage
try {
  & $rar a -r -m5 -idq $out '*'
  if ($LASTEXITCODE -ne 0) { throw "Rar.exe falhou ($LASTEXITCODE)" }
} finally { Pop-Location }
& $rar t -idq $out
if ($LASTEXITCODE -ne 0) { throw "RAR gerado não passou no teste" }
Write-Host ("OK: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
