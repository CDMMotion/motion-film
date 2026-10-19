# Publica uma versão no GitHub (padrão de atualização):
#
#   powershell -ExecutionPolicy Bypass -File installer\release.ps1 [-Notes "o que mudou"]
#
#   1. package.ps1 -> installer\dist\Motion-Film-Setup-<v>.exe + motion-film-v<v>.rar
#   2. commit de tudo que mudou + tag v<v> + push
#   3. gh release create v<v> com o .exe e o .rar anexados
#
# Requer: git, GitHub CLI (gh) logado (`gh auth login`), WinRAR.
# A versão vem do CSXS\manifest.xml -- suba ela ANTES (5 ocorrências).
param([string]$Notes = "")
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "$env:ProgramFiles\GitHub CLI\gh.exe" }
if (-not (Test-Path $gh)) { throw "GitHub CLI (gh) não encontrado" }

$manifest = [xml](Get-Content -Raw -Encoding UTF8 (Join-Path $root 'motion-film\CSXS\manifest.xml'))
$version = $manifest.ExtensionManifest.ExtensionBundleVersion
$tag = "v$version"

Push-Location $root
try {
  & git rev-parse -q --verify "refs/tags/$tag" | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "A tag $tag já existe -- suba a versão no manifest antes de lançar." }

  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'package.ps1')
  if ($LASTEXITCODE -ne 0) { throw "package.ps1 falhou" }

  & git add -A
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    & git commit -q -m "Mótion Film $version"
    if ($LASTEXITCODE -ne 0) { throw "git commit falhou" }
  }
  & git tag -a $tag -m "Mótion Film $version"
  & git push -q origin HEAD --follow-tags
  if ($LASTEXITCODE -ne 0) { throw "git push falhou" }

  $exe = Join-Path $here "dist\Motion-Film-Setup-$version.exe"
  $rarFile = Join-Path $root "motion-film-v$version.rar"
  if (-not $Notes) { $Notes = "Baixe Motion-Film-Setup-$version.exe, feche o After Effects e rode. Instala ou atualiza; Packs, cores e presets são mantidos." }
  & $gh release create $tag $exe $rarFile --title "Mótion Film $version" --notes $Notes
  if ($LASTEXITCODE -ne 0) { throw "gh release create falhou" }
  Write-Host "OK: release $tag publicada."
} finally { Pop-Location }
