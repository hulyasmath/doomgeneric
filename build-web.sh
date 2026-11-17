#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
sed 's#dir /usr/share/midi/freepats#dir freepats#' \
  /tmp/freepats-x/etc/timidity/freepats.cfg > timidity.cfg 2>/dev/null || \
  sed 's#dir /usr/share/midi/freepats#dir freepats#' \
  "$(dirname "$(find /tmp/freepats-x -name freepats.cfg | head -1)")/freepats.cfg" > timidity.cfg

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f /tmp/emsdk/emsdk_env.sh ]; then
    cd /tmp/emsdk
    . ./emsdk_env.sh >/dev/null 2>&1
  else
    echo "emcc not found. Install Emscripten and source emsdk_env.sh first." >&2
    exit 1
  fi
fi
cd "$ROOT/doomgeneric"
make -f Makefile.emscripten -j2
mkdir -p "$ROOT/dist"
cp doomgeneric.html "$ROOT/dist/index.html"
cp doomgeneric.js doomgeneric.wasm doomgeneric.data "$ROOT/dist/"
cp "$ROOT/web/zeq.css" "$ROOT/web/zeq.js" "$ROOT/dist/"
echo "Browser build written to $ROOT/dist"
