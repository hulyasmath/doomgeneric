#!/usr/bin/env python3
"""Exact Zeq time and deterministic fixed-point reference, plus vector generator."""

from __future__ import annotations

import argparse
import functools
import json
import math
from pathlib import Path

import mpmath as mp

ZEQOND_NS = 777_000_777
ALPHA_NUM = 129
ALPHA_DEN = 100_000
TWO64 = 1 << 64
Q30 = 1 << 30
Q40 = 1 << 40
PI_Q40 = 3_454_217_652_358
PHASE_BITS = 12
PHASE_FRACTION_BITS = 52
TABLE_SIZE = 1 << PHASE_BITS


def round_div(numerator: int, denominator: int) -> int:
    """Round to nearest, ties to even, with a positive denominator."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    sign = -1 if numerator < 0 else 1
    n = abs(numerator)
    quotient, remainder = divmod(n, denominator)
    twice = remainder << 1
    if twice > denominator or (twice == denominator and quotient & 1):
        quotient += 1
    return sign * quotient


def phase64_ratio(remainder: int, denominator: int) -> int:
    if denominator <= 0 or not 0 <= remainder < denominator:
        raise ValueError("invalid phase ratio")
    return (remainder * TWO64) // denominator


def split64(ns: int) -> tuple[int, int]:
    tick, remainder = divmod(ns, ZEQOND_NS)
    return tick, phase64_ratio(remainder, ZEQOND_NS)


def from_tic(gametic: int, tick_rate: int = 35) -> tuple[int, int]:
    if gametic < 0 or tick_rate <= 0:
        raise ValueError("invalid tic clock")
    numerator = gametic * 1_000_000_000
    denominator = tick_rate * ZEQOND_NS
    tick, remainder = divmod(numerator, denominator)
    return tick, phase64_ratio(remainder, denominator)


@functools.lru_cache(maxsize=1)
def sine_table() -> tuple[int, ...]:
    mp.mp.dps = 100
    values = []
    for i in range(TABLE_SIZE + 1):
        value = mp.sin(2 * mp.pi * mp.mpf(i) / TABLE_SIZE) * Q30
        floor = int(mp.floor(value))
        fraction = value - floor
        if fraction > mp.mpf("0.5") or (fraction == mp.mpf("0.5") and floor & 1):
            floor += 1
        values.append(floor)
    return tuple(values)


def sin_q30(phase64: int) -> int:
    phase64 &= TWO64 - 1
    index = phase64 >> PHASE_FRACTION_BITS
    fraction = phase64 & ((1 << PHASE_FRACTION_BITS) - 1)
    table = sine_table()
    delta = table[index + 1] - table[index]
    return table[index] + round_div(delta * fraction, 1 << PHASE_FRACTION_BITS)


def cos_q30(phase64: int) -> int:
    return sin_q30((phase64 + (1 << 62)) & (TWO64 - 1))


def isqrt(value: int) -> int:
    if value < 0:
        raise ValueError("negative square root")
    return math.isqrt(value)


def metrics(phase64: int) -> dict[str, int]:
    sine = sin_q30(phase64)
    cosine = cos_q30(phase64)
    lapse2 = Q30 - round_div(ALPHA_NUM * sine, ALPHA_DEN)
    lapse = isqrt(lapse2 << 30)
    carrier = Q30 + round_div(ALPHA_NUM * sine, ALPHA_DEN)
    derivative = round_div(
        -ALPHA_NUM * PI_Q40 * cosine,
        ALPHA_DEN * lapse2,
    )
    return {
        "sin_q30": sine,
        "cos_q30": cosine,
        "carrier_q30": carrier,
        "lapse2_q30": lapse2,
        "lapse_q30": lapse,
        "dln_cycle_q40": derivative,
    }


def instant(ns: int) -> dict[str, str | int]:
    tick, phase = split64(ns)
    return {"ns": str(ns), "tick": str(tick), "phase64": str(phase), **metrics(phase)}


def tic_instant(gametic: int, tick_rate: int = 35) -> dict[str, str | int]:
    tick, phase = from_tic(gametic, tick_rate)
    return {
        "gametic": str(gametic),
        "tick_rate": str(tick_rate),
        "tick": str(tick),
        "phase64": str(phase),
        **metrics(phase),
    }


def generate(root: Path) -> None:
    ns_values = [0, 1, ZEQOND_NS - 1, ZEQOND_NS, ZEQOND_NS + 1, 10**12, -1, -ZEQOND_NS, -ZEQOND_NS - 1, 2**63 - 1]
    seed = 0x9E3779B97F4A7C15
    for _ in range(4000):
        seed = (seed * 6364136223846793005 + 1442695040888963407) % TWO64
        ns_values.append(seed >> 1)
    tic_values = [0, 1, 2, 17, 34, 35, 36, 70, 777, 1245, 35000, 1_000_000, 2**31 - 1, 2**40]
    for rate in (20, 35, 60, 144):
        tic_values.extend([rate - 1, rate, rate + 1, rate * 1000])
    phase_values = [0, 1, (1 << 62) - 1, 1 << 62, 1 << 63, 3 << 62, TWO64 - 1]
    seed = 0xD1B54A32D192ED03
    for _ in range(256):
        seed = (seed * 2862933555777941757 + 3037000493) % TWO64
        phase_values.append(seed)
    vectors = {
        "format": "zeq-time-v1",
        "constants": {
            "zeqond_ns": str(ZEQOND_NS),
            "alpha": "129/100000",
            "q30": str(Q30),
            "pi_q40": str(PI_Q40),
        },
        "sine_q30": list(sine_table()),
        "nanoseconds": [instant(value) for value in ns_values],
        "tics": [tic_instant(value) for value in tic_values],
        "lapse": [{"phase64": str(value), **metrics(value)} for value in phase_values],
    }
    (root / "vectors").mkdir(parents=True, exist_ok=True)
    (root / "vectors" / "zeq-time-v1.json").write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    inc = ["/* Generated by zeq_time.py; do not edit. */", "static const int32_t zeq_sine_table_q30[4097] = {"]
    for i in range(0, TABLE_SIZE + 1, 8):
        inc.append("    " + ", ".join(str(v) for v in sine_table()[i : i + 8]) + ",")
    inc.append("};")
    inc.append("")
    (root / "zeq_sine_q30.inc").write_text("\n".join(inc))
    smoke = vectors["nanoseconds"][:5] + vectors["tics"][:4]
    js = [
        "/* Generated by zeq_time.py; do not edit. */",
        "(function (global) {",
        '"use strict";',
        f"const sineQ30 = Object.freeze({json.dumps(list(sine_table()), separators=(',', ':'))});",
        f"const smoke = Object.freeze({json.dumps(smoke, separators=(',', ':'))});",
        "const api = Object.freeze({ sineQ30, smoke });",
        'if (typeof module !== "undefined" && module.exports) module.exports = api;',
        "else global.ZeqTimeTable = api;",
        '})(typeof window !== "undefined" ? window : globalThis);',
        "",
    ]
    (root / "zeq-time-table.js").write_text("\n".join(js))
    generate_c_header(root, vectors)
    print(f"generated {len(ns_values)} ns, {len(tic_values)} tic, {len(phase_values)} lapse vectors")


def generate_c_header(root: Path, vectors: dict) -> None:
    lines = ["/* Generated shared vectors; do not edit. */", "#ifndef ZEQ_TEST_VECTORS_H", "#define ZEQ_TEST_VECTORS_H", ""]
    lines.append("typedef struct { int64_t input; int64_t tick; uint64_t phase64; } zeq_test_time_vector_t;")
    for name, key in (("zeq_test_ns", "nanoseconds"), ("zeq_test_tic", "tics")):
        rows = vectors[key]
        lines.append(f"static const zeq_test_time_vector_t {name}[] = {{")
        for row in rows:
            field = "ns" if key == "nanoseconds" else "gametic"
            lines.append(f"    {{ INT64_C({row[field]}), INT64_C({row['tick']}), UINT64_C({row['phase64']}) }},")
        lines.append("};")
        lines.append(f"#define {name.upper()}_COUNT (sizeof({name}) / sizeof({name}[0]))")
    lines.append("typedef struct { uint64_t phase64; int32_t sine; int32_t cosine; int32_t carrier; int32_t lapse2; int32_t lapse; int64_t derivative; } zeq_test_lapse_vector_t;")
    lines.append("static const zeq_test_lapse_vector_t zeq_test_lapse[] = {")
    for row in vectors["lapse"]:
        lines.append(
            f"    {{ UINT64_C({row['phase64']}), {row['sin_q30']}, {row['cos_q30']}, {row['carrier_q30']}, {row['lapse2_q30']}, {row['lapse_q30']}, INT64_C({row['dln_cycle_q40']}) }},"
        )
    lines.append("};")
    lines.append("#define ZEQ_TEST_LAPSE_COUNT (sizeof(zeq_test_lapse) / sizeof(zeq_test_lapse[0]))")
    lines.extend(["", "#endif", ""])
    (root / "tests" / "zeq_test_vectors.h").write_text("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true")
    args = parser.parse_args()
    if args.generate:
        generate(Path(__file__).resolve().parent)
    else:
        parser.print_help()
