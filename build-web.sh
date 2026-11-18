#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Generated vectors/tables are source-reproducible, not committed blobs.
python3 "$ROOT/sdk/zeq_time.py" --generate
python3 "$ROOT/sdk/zeq_physics.py" --generate
cd "$ROOT/doomgeneric"

WAD_SHA256=1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771
if [ ! -f doom1.wad ]; then
  echo "Fetching shareware doom1.wad..."
  curl -L --fail -o /tmp/doom-wad.tar.gz \
    https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/doom-wad-shareware_1.9.fixed.orig.tar.gz
  tar -xzf /tmp/doom-wad.tar.gz --wildcards '*/doom1.wad' --strip-components 2 || \
    tar -xzf /tmp/doom-wad.tar.gz
  find . -maxdepth 2 -name doom1.wad -exec mv {} . \; -quit
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
cd "$ROOT/doomgeneric"
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

mkdir -p "$ROOT/dist" "$ROOT/dist/sdk"
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
copy_verified "$ROOT/sdk/zeq-time-table.js" "$ROOT/dist/sdk/zeq-time-table.js"
copy_verified "$ROOT/sdk/zeq-physics-table.js" "$ROOT/dist/sdk/zeq-physics-table.js"
copy_verified "$ROOT/sdk/zeq-game-sdk.js" "$ROOT/dist/sdk/zeq-game-sdk.js"
copy_verified "$ROOT/sdk/zeq-security.js" "$ROOT/dist/sdk/zeq-security.js"
copy_verified "$ROOT/sdk/zeq-capsule.js" "$ROOT/dist/sdk/zeq-capsule.js"
copy_verified "$ROOT/sdk/zeq-content.js" "$ROOT/dist/sdk/zeq-content.js"
echo "Browser build written to $ROOT/dist (all copied artifacts verified byte-for-byte)"
