#!/bin/bash
# Teste do instalador Mac num Mac de verdade (GitHub Actions, Apple
# Silicon e Intel). Faz o que um colega faria e confere cada ponto:
#   1. dados do usuário + cópia manual antiga já existentes;
#   2. instala, instala de novo (= atualizar);
#   3. extensão, plugin, PlayerDebugMode, cópia antiga removida, dados intactos;
#   4. legendas de ponta a ponta: ffmpeg igual ao que o painel baixa,
#      fala gerada pelo `say`, whisper-cli transcreve num caminho com acento;
#   5. desinstala e confere que os dados continuam.
#
#   installer/mac/test-install.sh <Motion-Film-Mac-<v>.zip>
set -euxo pipefail

ZIP="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VERSION=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$ROOT/motion-film/CSXS/manifest.xml" | head -1)
EXT="/Library/Application Support/Adobe/CEP/extensions/motion-film"
PLUGIN="/Users/Shared/Mótion Figma Layers/Plugin Figma"
DATA="$HOME/Documents/Mótion Film Packs"
OLD_USER_COPY="$HOME/Library/Application Support/Adobe/CEP/extensions/motion-film"
export MF_NO_FINDER=1
fail() { echo "FALHOU: $*"; exit 1; }

# 1. estado de quem já usava
mkdir -p "$DATA/packs/abc"
echo '{"version":1,"values":{"motionfilm-accent":"#ff0000"}}' > "$DATA/settings.json"
echo '{"id":"abc"}' > "$DATA/packs/abc/meta.json"
SUM_BEFORE=$(find "$DATA" -type f -exec shasum {} \; | sort | shasum)
mkdir -p "$OLD_USER_COPY/CSXS"
echo '<ExtensionManifest ExtensionBundleVersion="0.9.0"/>' > "$OLD_USER_COPY/CSXS/manifest.xml"

WORK="$(mktemp -d)"
ditto -x -k "$ZIP" "$WORK"
DIR="$WORK/Motion-Film-Mac-$VERSION"
INSTALL_PKG="$DIR/Instalar-Motion-Film-$VERSION.pkg"
UNINSTALL_PKG="$DIR/Desinstalar-Motion-Film.pkg"
[ -f "$INSTALL_PKG" ] && [ -f "$UNINSTALL_PKG" ] && [ -f "$DIR/INSTALAR-MAC.txt" ] || fail "zip incompleto"
pkgutil --check-signature "$INSTALL_PKG" || true   # sem assinatura (esperado)

# 2. instalar + atualizar
sudo -E installer -pkg "$INSTALL_PKG" -target /
sudo -E installer -pkg "$INSTALL_PKG" -target /

# 3. conferências
grep -q "ExtensionBundleVersion=\"$VERSION\"" "$EXT/CSXS/manifest.xml" || fail "manifest/versão"
[ -f "$EXT/client/index.html" ] && [ -f "$EXT/host/host.jsx" ] || fail "arquivos da extensão"
[ ! -e "$EXT/README.md" ] && [ ! -e "$EXT/.debug" ] || fail "arquivo de dev no pacote"
[ -x "$EXT/bin/mac/whisper-cli" ] || fail "whisper-cli não executável"
lipo -archs "$EXT/bin/mac/whisper-cli" | grep -q arm64 || fail "sem arm64"
lipo -archs "$EXT/bin/mac/whisper-cli" | grep -q x86_64 || fail "sem x86_64"
[ -f "$PLUGIN/manifest.json" ] && [ -f "$PLUGIN/code.js" ] && [ -f "$PLUGIN/ui.html" ] || fail "plugin do Figma"
[ ! -e "$OLD_USER_COPY" ] || fail "cópia antiga do usuário não removida"
[ ! -e "/Library/Application Support/Motion Film Installer" ] || fail "pasta de preparo ficou"
ls -d "$EXT".* 2>/dev/null && fail "sobrou .new/.old"
for v in 9 10 11 12 13 14 15 16; do
  [ "$(defaults read "/Library/Preferences/com.adobe.CSXS.$v" PlayerDebugMode)" = "1" ] || fail "PlayerDebugMode $v (sistema)"
done
[ "$(defaults read com.adobe.CSXS.11 PlayerDebugMode 2>/dev/null || echo none)" = "1" ] || echo "aviso: PlayerDebugMode do usuário não gravado (vale o do sistema)"
SUM_AFTER=$(find "$DATA" -type f -exec shasum {} \; | sort | shasum)
[ "$SUM_BEFORE" = "$SUM_AFTER" ] || fail "dados do usuário mudaram"
# arquivos legíveis por qualquer usuário (o After Effects roda como o usuário)
[ -z "$(find "$EXT" "$PLUGIN" ! -perm -o+r)" ] || fail "arquivo sem permissão de leitura"

# 4. legendas de ponta a ponta (mesmos binários/URLs do painel)
"$EXT/bin/mac/whisper-cli" --help > /dev/null 2>&1 || "$EXT/bin/mac/whisper-cli" -h > /dev/null 2>&1 || fail "whisper-cli não roda"
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
URL=$(sed -n 's/.*CAPTIONS_FFMPEG_MAC_URL = "\([^"]*\)".*/\1/p' "$ROOT/motion-film/client/panel.js")
TOOLS="$HOME/Documents/Mótion Film Tools"
mkdir -p "$TOOLS/ffmpeg" "$TOOLS/models" "$TOOLS/temp"
curl -fL "$URL$ARCH.gz" -o "$WORK/ffmpeg.gz"
gunzip -c "$WORK/ffmpeg.gz" > "$TOOLS/ffmpeg/ffmpeg"
chmod 755 "$TOOLS/ffmpeg/ffmpeg"
"$TOOLS/ffmpeg/ffmpeg" -hide_banner -version | head -1
say -o "$WORK/fala.aiff" "Hello world. This is a caption test." || say -v Samantha -o "$WORK/fala.aiff" "Hello world. This is a caption test."
WAV="$TOOLS/temp/audio-1.wav"
"$TOOLS/ffmpeg/ffmpeg" -nostdin -y -ss 0 -to 10 -i "$WORK/fala.aiff" -ar 16000 -ac 1 -c:a pcm_s16le "$WAV"
curl -fL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin" -o "$TOOLS/models/ggml-tiny.en.bin"
"$EXT/bin/mac/whisper-cli" -m "$TOOLS/models/ggml-tiny.en.bin" -f "$WAV" -l en -ojf -of "$TOOLS/temp/transcript-1"
python3 - "$TOOLS/temp/transcript-1.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
text = "".join(t.get("text", "") for s in d["transcription"] for t in s.get("tokens", []))
print("transcrição:", text)
assert "hello" in text.lower() and "caption" in text.lower(), text
assert any("offsets" in t for s in d["transcription"] for t in s["tokens"]), "sem offsets"
PY

# 5. desinstalar
sudo -E installer -pkg "$UNINSTALL_PKG" -target /
[ ! -e "$EXT" ] || fail "extensão não removida"
[ ! -e "$PLUGIN" ] || fail "plugin não removido"
SUM_UNINST=$(find "$DATA" -type f -exec shasum {} \; | sort | shasum)
[ "$SUM_BEFORE" = "$SUM_UNINST" ] || fail "desinstalar mexeu nos dados"
echo "OK: instalador Mac $VERSION aprovado em $(uname -m)"
