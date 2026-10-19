#!/bin/bash
# Monta o instalador Mac. Precisa de macOS (pkgbuild/productbuild) --
# roda no GitHub Actions (.github/workflows/mac.yml), não no Windows.
#
#   installer/mac/build-pkg.sh <whisper-cli> <pasta de saída>
#
# Gera em <saída>:
#   Motion-Film-Mac-<v>.zip, com uma pasta Motion-Film-Mac-<v>/ contendo
#     Instalar-Motion-Film-<v>.pkg    instala OU atualiza (igual ao .exe)
#     Desinstalar-Motion-Film.pkg     remove (não apaga Documentos)
#     INSTALAR-MAC.txt
#
# O whisper-cli (legendas) vem de build-whisper.sh e vai para
# motion-film/bin/mac/ dentro da extensão.
set -euo pipefail

WHISPER="$1"
OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VERSION=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$ROOT/motion-film/CSXS/manifest.xml" | head -1)
[ -n "$VERSION" ] || { echo "versão não encontrada no manifest"; exit 1; }
echo "Versão $VERSION"

WORK="$(mktemp -d)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# ---------- payload (mesmas exclusões do build.ps1 do Windows)
PAY="$WORK/payload"
mkdir -p "$PAY"
rsync -a \
  --exclude '/.debug' --exclude '/README.md' --exclude '/bin/' \
  --exclude '/client/assets/kit-assets/' \
  --include '/client/assets/kit-previews/README.md' --exclude '/client/assets/kit-previews/*' \
  "$ROOT/motion-film/" "$PAY/motion-film/"
rsync -a "$ROOT/figma-plugin/" "$PAY/figma-plugin/"
mkdir -p "$PAY/motion-film/bin/mac"
cp "$WHISPER" "$PAY/motion-film/bin/mac/whisper-cli"
chmod 755 "$PAY/motion-film/bin/mac/whisper-cli"
chmod -R a+rX "$PAY"
xattr -cr "$PAY" 2>/dev/null || true

# ---------- páginas do instalador: versão preenchida, CSS e logo embutidos
RES="$WORK/resources"
mkdir -p "$RES"
python3 - "$HERE/resources" "$RES" "$VERSION" <<'PY'
import base64, sys, pathlib
src, dst, version = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
css = (src / "style.css").read_text("utf-8")
logo = "data:image/png;base64," + base64.b64encode((src / "logo.png").read_bytes()).decode()
for name in ("welcome.html", "conclusion.html", "uninstall.html"):
    html = (src / name).read_text("utf-8")
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>" + css + "</style>")
    html = html.replace('src="logo.png"', 'src="' + logo + '"').replace("__VERSION__", version)
    (dst / name).write_text(html, "utf-8")
PY

dist_xml() { # título, id, pkg, welcome, conclusão (vazio = sem), saída
  local conclusion=""
  [ -n "$5" ] && conclusion="<conclusion file=\"$5\" mime-type=\"text/html\"/>"
  sed -e "s|__TITLE__|$1|" -e "s|__PKGID__|$2|g" -e "s|__PKG__|$3|" -e "s|__WELCOME__|$4|" \
      -e "s|__CONCLUSION__|$conclusion|" -e "s|__VERSION__|$VERSION|g" "$HERE/distribution.xml" > "$6"
}

# ---------- Instalar
SCR="$WORK/scripts"
mkdir -p "$SCR"
cp "$HERE/scripts/postinstall" "$SCR/postinstall"
chmod 755 "$SCR/postinstall"
pkgbuild --root "$PAY" \
  --install-location "/Library/Application Support/Motion Film Installer/payload" \
  --scripts "$SCR" --identifier com.motionfilm.extension --version "$VERSION" \
  --ownership recommended "$WORK/motion-film-component.pkg"
dist_xml "Mótion Film $VERSION" com.motionfilm.extension motion-film-component.pkg welcome.html conclusion.html "$WORK/dist-install.xml"

PKGDIR="$WORK/Motion-Film-Mac-$VERSION"
mkdir -p "$PKGDIR"
productbuild --distribution "$WORK/dist-install.xml" --resources "$RES" --package-path "$WORK" \
  "$PKGDIR/Instalar-Motion-Film-$VERSION.pkg"

# ---------- Desinstalar (sem arquivos, só o script)
USCR="$WORK/uninstall-scripts"
mkdir -p "$USCR"
cp "$HERE/uninstall-scripts/postinstall" "$USCR/postinstall"
chmod 755 "$USCR/postinstall"
pkgbuild --nopayload --scripts "$USCR" --identifier com.motionfilm.uninstall --version "$VERSION" \
  "$WORK/motion-film-uninstall-component.pkg"
dist_xml "Desinstalar Mótion Film" com.motionfilm.uninstall motion-film-uninstall-component.pkg uninstall.html "" "$WORK/dist-uninstall.xml"
productbuild --distribution "$WORK/dist-uninstall.xml" --resources "$RES" --package-path "$WORK" \
  "$PKGDIR/Desinstalar-Motion-Film.pkg"

# ---------- zip para a Release
sed "s/__VERSION__/$VERSION/g" "$HERE/INSTALAR-MAC.txt" > "$PKGDIR/INSTALAR-MAC.txt"
rm -f "$OUT/Motion-Film-Mac-$VERSION.zip"
ditto -c -k --keepParent "$PKGDIR" "$OUT/Motion-Film-Mac-$VERSION.zip"
ls -la "$PKGDIR" "$OUT"
