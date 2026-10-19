#!/bin/bash
# Compila o whisper-cli (motor das legendas, aba Captions) para Mac --
# o whisper.cpp não publica binário de Mac, só de Windows. Mesmo tag que
# o Windows baixa (CAPTIONS_WHISPER_ZIP_URL em client/panel.js), então a
# saída JSON é a mesma.
#
#   installer/mac/build-whisper.sh <tag> <pasta de saída>
#
# Binário universal (Apple Silicon + Intel), estático (só frameworks do
# sistema), com o shader Metal embutido no arm64. Assinatura ad-hoc
# (o Apple Silicon não roda binário sem assinatura nenhuma).
set -euxo pipefail

TAG="$1"
OUT="$2"
SRC="$(mktemp -d)/whisper.cpp"
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$SRC"

COMMON=(
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
  -DBUILD_SHARED_LIBS=OFF
  -DGGML_NATIVE=OFF
  -DWHISPER_BUILD_TESTS=OFF
  -DWHISPER_BUILD_SERVER=OFF
  -DWHISPER_BUILD_EXAMPLES=ON
  -DWHISPER_SDL2=OFF
  -DWHISPER_CURL=OFF
)

cmake -S "$SRC" -B "$SRC/build-arm64" "${COMMON[@]}" \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON
cmake --build "$SRC/build-arm64" --config Release -j 4 --target whisper-cli

# Intel: CPU + Accelerate (Metal em GPU AMD/Intel antiga não compensa).
# AVX2/FMA/F16C = Haswell (2013) em diante -- todo Mac Intel que roda o
# After Effects atual.
cmake -S "$SRC" -B "$SRC/build-x64" "${COMMON[@]}" \
  -DCMAKE_OSX_ARCHITECTURES=x86_64 -DGGML_METAL=OFF \
  -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON
cmake --build "$SRC/build-x64" --config Release -j 4 --target whisper-cli

mkdir -p "$OUT"
lipo -create "$SRC/build-arm64/bin/whisper-cli" "$SRC/build-x64/bin/whisper-cli" -output "$OUT/whisper-cli"
codesign --force --sign - "$OUT/whisper-cli"
lipo -info "$OUT/whisper-cli"
otool -L "$OUT/whisper-cli"
# Só bibliotecas do sistema podem aparecer (nada de /opt/homebrew etc.).
if otool -L "$OUT/whisper-cli" | tail -n +2 | grep -v -E '^\s+(/usr/lib/|/System/Library/)'; then
  echo "whisper-cli depende de biblioteca fora do sistema"; exit 1
fi
