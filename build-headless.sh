#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLEAN=1
if [ "${1:-}" = "--no-clean" ]; then CLEAN=0
elif [ "$#" -ne 0 ]; then echo "Usage: $0 [--no-clean]" >&2; exit 2; fi
python3 "$ROOT/sdk/zeq_time.py" --generate
python3 "$ROOT/sdk/zeq_physics.py" --generate
cd "$ROOT/doomgeneric"
CC_VERSION=$(${CC:-cc} --version | head -1)
printf 'Native compiler: %s\n' "$CC_VERSION"
SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf '%040d' 0)
if [ "$CLEAN" -eq 1 ]; then make -f Makefile.headless clean; fi
make -f Makefile.headless -j2
cc -std=c99 -O2 zeq_sha256.c zeq_sha256_test.c -o build-headless/zeq-sha256-test
cc -std=c99 -O2 zeq_capture.c zeq_capture_test.c -o build-headless/zeq-capture-test
ROOT="$ROOT" SOURCE_COMMIT="$SOURCE_COMMIT" CC_VERSION="$CC_VERSION" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT"])
def artifact(relative):
    path = root / relative
    data = path.read_bytes()
    return {"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
manifest = {
    "format": "zeq-release-manifest-v1",
    "target": "doomgeneric-native-headless",
    "sourceCommit": os.environ["SOURCE_COMMIT"],
    "toolchain": os.environ["CC_VERSION"],
    "artifacts": [
        artifact("doomgeneric/doomgeneric-headless"),
        artifact("doomgeneric/doom1.wad"),
    ],
    "evidenceScope": "build identity and byte inventory only; test and delivery gates are separate",
}
(root / "doomgeneric/build-headless/zeq-release-manifest.json").write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY
echo "Native headless engine written to doomgeneric/doomgeneric-headless (release manifest generated)"
