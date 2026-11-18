#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$ROOT/sdk/zeq_time.py" --generate
python3 "$ROOT/sdk/zeq_physics.py" --generate
cd "$ROOT/doomgeneric"
make -f Makefile.headless -j2
cc -std=c99 -O2 zeq_sha256.c zeq_sha256_test.c -o build-headless/zeq-sha256-test
cc -std=c99 -O2 zeq_capture.c zeq_capture_test.c -o build-headless/zeq-capture-test
echo "Native headless engine written to doomgeneric/doomgeneric-headless"
