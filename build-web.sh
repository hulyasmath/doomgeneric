#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
  dpkg-deb -x /tmp/freepats.deb /tmp/freepats-x
  cp -R /tmp/freepats-x/usr/share/midi/freepats freepats
  cp /tmp/freepats-x/usr/share/doc/freepats/copyright freepats/COPYRIGHT
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

copy_verified()
{
  source=$1
  destination=$2
  temporary="$destination.tmp"

  if [ ! -s "$source" ]; then
    echo "Refusing to copy empty or missing artifact: $source" >&2
    exit 1
  fi
  rm -f "$temporary"
  cp "$source" "$temporary"
  cmp "$source" "$temporary"
  mv -f "$temporary" "$destination"
}

# A release directory must not retain files from an older build.
rm -rf "$ROOT/dist"
mkdir -p "$ROOT/dist" "$ROOT/dist/sdk" "$ROOT/dist/sdk/zq/examples/doom"
SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf '%040d' 0)
printf '/* Generated build identity. */\nwindow.ZeqBuildInfo = Object.freeze({ sourceCommit: "%s" });\n' "$SOURCE_COMMIT" > "$ROOT/dist/sdk/zeq-build-info.js.tmp"
mv -f "$ROOT/dist/sdk/zeq-build-info.js.tmp" "$ROOT/dist/sdk/zeq-build-info.js"
copy_verified doomgeneric.html "$ROOT/dist/index.html"
copy_verified doomgeneric.js "$ROOT/dist/doomgeneric.js"
copy_verified doomgeneric.wasm "$ROOT/dist/doomgeneric.wasm"
copy_verified doomgeneric.data "$ROOT/dist/doomgeneric.data"
copy_verified "$ROOT/web/zeq.css" "$ROOT/dist/zeq.css"
copy_verified "$ROOT/web/zeq.js" "$ROOT/dist/zeq.js"
copy_verified "$ROOT/web/zeq-capsule-worker.js" "$ROOT/dist/zeq-capsule-worker.js"
copy_verified "$ROOT/web/zeq-machine.js" "$ROOT/dist/zeq-machine.js"
copy_verified "$ROOT/sdk/zq/zeq-browser.js" "$ROOT/dist/sdk/zq/zeq-browser.js"
copy_verified "$ROOT/sdk/zq/zeq-host.js" "$ROOT/dist/sdk/zq/zeq-host.js"
copy_verified "$ROOT/sdk/zq/zeq-panel.js" "$ROOT/dist/sdk/zq/zeq-panel.js"
copy_verified "$ROOT/sdk/zq/examples/doom/doom-zeq.js" "$ROOT/dist/sdk/zq/examples/doom/doom-zeq.js"
copy_verified "$ROOT/sdk/zeq-time-table.js" "$ROOT/dist/sdk/zeq-time-table.js"
copy_verified "$ROOT/sdk/zeq-physics-table.js" "$ROOT/dist/sdk/zeq-physics-table.js"
copy_verified "$ROOT/sdk/zeq-game-sdk.js" "$ROOT/dist/sdk/zeq-game-sdk.js"
copy_verified "$ROOT/sdk/zeq-security.js" "$ROOT/dist/sdk/zeq-security.js"
copy_verified "$ROOT/sdk/zeq-capsule.js" "$ROOT/dist/sdk/zeq-capsule.js"
copy_verified "$ROOT/sdk/zeq-content.js" "$ROOT/dist/sdk/zeq-content.js"
copy_verified "$ROOT/sdk/zeq-pixel.js" "$ROOT/dist/sdk/zeq-pixel.js"
ROOT="$ROOT" SOURCE_COMMIT="$SOURCE_COMMIT" EMCC_VERSION="$EMCC_VERSION" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT"])
dist = root / "dist"
artifacts = []
for path in sorted(p for p in dist.rglob("*") if p.is_file()):
    data = path.read_bytes()
    artifacts.append({
        "path": path.relative_to(dist).as_posix(),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    })
manifest = {
    "format": "zeq-release-manifest-v1",
    "target": "doomgeneric-browser-wasm",
    "sourceCommit": os.environ["SOURCE_COMMIT"],
    "toolchain": os.environ["EMCC_VERSION"],
    "artifacts": artifacts,
    "evidenceScope": "build identity and byte inventory only; test and delivery gates are separate",
}
(dist / "zeq-release-manifest.json").write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY
echo "Browser build written to $ROOT/dist (all copied artifacts verified byte-for-byte; release manifest generated)"
