#!/bin/bash
# Instala/atualiza o Mótion Film no Mac pelo Terminal, sem o aviso do
# Gatekeeper (arquivo baixado pelo curl não fica em "quarentena"):
#
#   curl -fsSL https://raw.githubusercontent.com/CDMMotion/motion-film/main/installer/mac/get.sh | bash
#
# Baixa o Motion-Film-Mac-<v>.zip da Release mais nova e roda o mesmo
# .pkg do instalador (pede a senha do Mac).
set -euo pipefail

API="https://api.github.com/repos/CDMMotion/motion-film/releases/latest"
URL=$(curl -fsSL "$API" | grep -o '"browser_download_url": *"[^"]*Motion-Film-Mac-[^"]*\.zip"' | head -1 | sed 's/.*"\(https[^"]*\)"$/\1/')
if [ -z "$URL" ]; then
  echo "Não achei o instalador Mac na última versão em github.com/CDMMotion/motion-film/releases"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Baixando $(basename "$URL")..."
curl -fL --progress-bar "$URL" -o "$TMP/mf.zip"
ditto -x -k "$TMP/mf.zip" "$TMP/x"
PKG=$(find "$TMP/x" -name 'Instalar-Motion-Film-*.pkg' | head -1)
[ -n "$PKG" ] || { echo "Pacote não encontrado no zip"; exit 1; }

if pgrep -qf "Adobe After Effects"; then
  echo "Aviso: o After Effects está aberto. Feche e abra de novo depois da instalação."
fi
echo "Instalando (o Mac vai pedir a sua senha)..."
sudo installer -pkg "$PKG" -target / < /dev/tty
echo "Pronto. Abra o After Effects: Window > Extensions > Mótion Film"
