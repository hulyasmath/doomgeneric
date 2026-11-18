#!/usr/bin/env python3

import json
import math
import sys
from pathlib import Path

import mpmath as mp

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import zeq_time as z

ROOT = Path(__file__).resolve().parent.parent
VECTORS = json.loads((ROOT / "vectors" / "zeq-time-v1.json").read_text())


def check_instant(actual_tick, actual_phase, expected):
    assert actual_tick == int(expected["tick"])
    assert actual_phase == int(expected["phase64"])
    actual = z.metrics(actual_phase)
    for key, value in actual.items():
        assert value == expected[key], (key, value, expected[key])


for vector in VECTORS["nanoseconds"]:
    check_instant(*z.split64(int(vector["ns"])), vector)
for vector in VECTORS["tics"]:
    check_instant(*z.from_tic(int(vector["gametic"]), int(vector["tick_rate"])), vector)
for vector in VECTORS["lapse"]:
    check_instant(0, int(vector["phase64"]), {"tick": "0", **vector})

assert z.split64(10**12)[0] == 1287
assert z.split64(-1)[0] == -1
assert z.round_div(1, 2) == 0
assert z.round_div(3, 2) == 2
assert z.round_div(-1, 2) == 0
assert z.round_div(-3, 2) == -2
for invalid in ((-1, 35), (0, 0)):
    try:
        z.from_tic(*invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid tic accepted")
assert z.isqrt(2**64 - 1) == 2**32 - 1

mp.mp.dps = 80
for i in range(0, 4097, 37):
    reference = mp.sin(2 * mp.pi * mp.mpf(i) / 4096) * z.Q30
    assert abs(z.sine_table()[i] - reference) <= 1
# Linear interpolation on [i/4096,(i+1)/4096] has the standard
# |sin| * h^2 / 8 error bound, plus at most one Q30 rounding unit.
interpolation_bound = (2 * mp.pi / 4096) ** 2 * z.Q30 / 8 + 1
for phase in (0, 1 << 62, 1 << 63, 3 << 62, 2**64 - 1, 1234567890123456789):
    reference = mp.sin(2 * mp.pi * mp.mpf(phase) / 2**64) * z.Q30
    assert abs(z.sin_q30(phase) - reference) <= interpolation_bound

# Continuous reference identities; these do not claim exact rational sine/sqrt.
mean_n2 = mp.quad(lambda t: 1 - (mp.mpf(129) / 100000) * mp.sin(2 * mp.pi * t), [0, 1])
log_closure = mp.log(mp.sqrt(1 - (mp.mpf(129) / 100000) * mp.sin(2 * mp.pi))) - mp.log(1)
assert abs(mean_n2 - 1) < mp.mpf("1e-50")
assert log_closure == 0

print(f"Python OK: {len(VECTORS['nanoseconds'])} ns + {len(VECTORS['tics'])} tic + {len(VECTORS['lapse'])} lapse vectors; independent math and negative tests OK")
