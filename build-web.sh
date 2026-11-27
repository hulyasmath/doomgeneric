#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SDK_ROOT=${ZEQ_SDK_ROOT:-$ROOT}
if [ ! -f "$SDK_ROOT/docs/zeq-developer-manual-v1.md" ] || [ ! -d "$SDK_ROOT/projects" ]; then
  echo "Set ZEQ_SDK_ROOT to the complete portable SDK checkout for the on-site manual and project sources." >&2
  exit 1
fi
python3 "$ROOT/build-sdk-docs.py" --sdk-root "$SDK_ROOT"
CLEAN=1
if [ "${1:-}" = "--no-clean" ]; then CLEAN=0
elif [ "$#" -ne 0 ]; then echo "Usage: $0 [--no-clean]" >&2; exit 2; fi
EMSCRIPTEN_REQUIRED=3.1.64
# Generated vectors/tables are source-reproducible, not committed blobs.
python3 "$ROOT/sdk/zeq_time.py" --generate
python3 "$ROOT/sdk/zeq_physics.py" --generate
cd "$ROOT/doomgeneric"

WAD_SHA256=1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771
if [ ! -f doom1.wad ]; then
  echo "Fetching shareware doom1.wad..."
  curl -L --fail -o /tmp/doom-wad.tar.gz \
    https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/doom-wad-shareware_1.9.fixed.orig.tar.gz
  WAD_TMP=$(mktemp -d)
  tar -xzf /tmp/doom-wad.tar.gz -C "$WAD_TMP"
  WAD_SOURCE=$(find "$WAD_TMP" -type f -name doom1.wad -print -quit)
  if [ -z "$WAD_SOURCE" ]; then
    echo "doom1.wad not found in the verified shareware archive" >&2
    rm -rf "$WAD_TMP"
    exit 1
  fi
  cp "$WAD_SOURCE" doom1.wad
  rm -rf "$WAD_TMP"
fi
echo "$WAD_SHA256  doom1.wad" | sha256sum -c -

if [ ! -d freepats ]; then
  echo "Fetching freepats MIDI instruments..."
  curl -L --fail -o /tmp/freepats.deb \
    https://deb.debian.org/debian/pool/main/f/freepats/freepats_20060219-4_all.deb
  rm -rf /tmp/freepats-x && mkdir -p /tmp/freepats-x
  dpkg-deb -x /tmp/freepats-x/usr/share/midi/freepats freepats
  cp -R /tmp/freepats-x/usr/share/doc/freepats/copyright freepats/COPYRIGHT
fi
if [ ! -f timidity.cfg ]; then
  FREEPATS_CFG=$(find /tmp/freepats-x -name freepats.cfg | head -1)
  if [ -z "$FREEPATS_CFG" ]; then
    echo "freepats.cfg not found after extracting freepats" >&2
    exit 1
  fi
  sed 's#dir /usr/share/midi/freepats#dir freepats#' \
    "$FREEPATS_CFG" > timidity.cfg
fi

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "${EMSDK:-/tmp/emsdk}/emsdk_env.sh" ]; then
    cd "${EMSDK:-/tmp/emsdk}"
    . ./emsdk_env.sh >/dev/null 2>&1
  else
    echo "emcc 3.1.64 not found. Install Emscripten and source emsdk_env.sh first." >&2
    exit 1
  fi
fi
EMCC_VERSION=$(emcc --version 2>/dev/null | head -1)
case "$EMCC_VERSION" in
  *"$EMSCRIPTEN_REQUIRED"*) ;;
  *) echo "Pinned Emscripten $EMSCRIPTEN_REQUIRED required; found: $EMCC_VERSION" >&2; exit 1 ;;
esac
printf 'Verified compiler: %s\n' "$EMCC_VERSION"
cd "$ROOT/doomgeneric"
if [ "$CLEAN" -eq 1 ]; then make -f Makefile.emscripten clean; fi
make -f Makefile.emscripten -j2

SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf '%040d' 0)
REPOSITORY_HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf '%040d' 0)
python3 "$ROOT/assemble-web-release.py" \
  --sdk-root "$SDK_ROOT" \
  --engine-dir "$ROOT/doomgeneric" \
  --source-commit "$SOURCE_COMMIT" \
  --repository-head "$REPOSITORY_HEAD" \
  --toolchain "$EMCC_VERSION"
