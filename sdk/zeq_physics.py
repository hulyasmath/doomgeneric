#!/usr/bin/env python3
"""Shared zeq-physics-v1 reference and vector generator."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import zeq_time as z

FORMAT = "zeq-physics-v1"
IMPULSE_FORMAT = "zeq-impulse-half-sine-v1"
IMPULSE_SUBSTEPS = 32
H_NUM = 1_000_000_000
Q40 = 1 << 40
WEAPON_CADENCE_TICS = (22, 19, 39, 8, 20, 23, 60, 8, 55)
WEAPON_NAMES = ("fist", "pistol", "shotgun", "chaingun", "rocket", "plasma", "bfg", "chainsaw", "super-shotgun")


def metrics_alpha(phase64: int, alpha_num: int) -> tuple[int, int]:
    if alpha_num == 0:
        return z.Q30, 0
    if alpha_num != z.ALPHA_NUM:
        raise ValueError("unsupported alpha")
    values = z.metrics(phase64)
    return values["lapse2_q30"], values["dln_cycle_q40"]


def integrate_tic(
    gametic: int,
    velocity: int,
    acceleration: int = 0,
    impulse: int = 0,
    substeps: int | None = None,
    alpha_num: int = z.ALPHA_NUM,
    tick_rate: int = 35,
) -> dict[str, int | str]:
    if substeps is None:
        substeps = IMPULSE_SUBSTEPS if impulse else 1
    if gametic < 0 or tick_rate <= 0 or not 1 <= substeps <= 1024:
        raise ValueError("invalid integration domain")
    if alpha_num not in (0, z.ALPHA_NUM):
        raise ValueError("unsupported alpha")
    h_den = tick_rate * z.ZEQOND_NS
    initial_velocity = velocity
    midpoint_sum = 0
    applied_force = 0
    applied_drag = 0
    for k in range(substeps):
        start_phase = z.from_tic(gametic * substeps + k, tick_rate * substeps)[1]
        middle_phase = z.from_tic(2 * (gametic * substeps + k) + 1, 2 * tick_rate * substeps)[1]
        acceleration_tic = acceleration
        if impulse:
            half_phase = ((2 * k + 1) << 63) // (2 * substeps)
            impulse_force = z.round_div(z.PI_Q40 * impulse * z.sin_q30(half_phase), 2 * Q40 * z.Q30)
            acceleration_tic += impulse_force
        start_n2, start_d = metrics_alpha(start_phase, alpha_num)
        middle_n2, middle_d = metrics_alpha(middle_phase, alpha_num)
        midpoint = velocity + z.round_div(H_NUM * start_d * velocity, 2 * substeps * h_den * Q40)
        midpoint += z.round_div(start_n2 * acceleration_tic, 2 * substeps * z.Q30)
        midpoint_sum += midpoint
        drag = z.round_div(H_NUM * middle_d * midpoint, substeps * h_den * Q40)
        force = z.round_div(middle_n2 * acceleration_tic, substeps * z.Q30)
        velocity = velocity + drag + force
        applied_drag += drag
        applied_force += force
    position = z.round_div(midpoint_sum, substeps)
    return {
        "gametic": str(gametic),
        "tick_rate": str(tick_rate),
        "alpha_num": str(alpha_num),
        "initial_velocity": str(initial_velocity),
        "acceleration": str(acceleration),
        "impulse": str(impulse),
        "substeps": str(substeps),
        "position_delta": str(position),
        "velocity": str(velocity),
        "delta_velocity": str(velocity - initial_velocity),
        "position_residual": str(midpoint_sum - position * substeps),
        "applied_force": str(applied_force),
        "applied_drag": str(applied_drag),
        "start_phase64": str(z.from_tic(gametic, tick_rate)[1]),
        "end_phase64": str(z.from_tic(gametic + 1, tick_rate)[1]),
    }


def cooldown_ready_tic(start_tic: int, duration_num: int, duration_den: int, tick_rate: int = 35) -> int:
    if start_tic < 0 or tick_rate <= 0 or duration_num <= 0 or duration_den <= 0:
        raise ValueError("invalid cooldown")
    numerator = duration_num * tick_rate * z.ZEQOND_NS
    denominator = duration_den * 1_000_000_000
    return start_tic + (numerator + denominator - 1) // denominator


def weapon_durations() -> list[dict[str, int | str]]:
    rows = []
    for name, cadence in zip(WEAPON_NAMES, WEAPON_CADENCE_TICS):
        milli_zeqonds = z.round_div(cadence * H_NUM * 1000, 35 * z.ZEQOND_NS)
        rows.append({
            "weapon": name,
            "cadence_tics": str(cadence),
            "duration_num": str(milli_zeqonds),
            "duration_den": "1000",
            "ready_tic_from_zero": str(cooldown_ready_tic(0, milli_zeqonds, 1000)),
        })
    return rows


def generate(root: Path) -> None:
    cases = [
        (0, 0, 0, 0, None, z.ALPHA_NUM),
        (1, 0, 0, 0, None, z.ALPHA_NUM),
        (17, 0, 0, 0, None, 0),
        (17, 1234567, 0, 0, None, z.ALPHA_NUM),
        (17, 1234567, 0, 0, None, 0),
        (34, -7654321, 0, 0, None, z.ALPHA_NUM),
        (35, 100000, 2000000, 0, None, z.ALPHA_NUM),
        (35, 100000, 2000000, 0, None, 0),
        (70, -100000, -2000000, 0, None, z.ALPHA_NUM),
        (71, 0, 0, 4000000, IMPULSE_SUBSTEPS, z.ALPHA_NUM),
        (71, 0, 0, 4000000, IMPULSE_SUBSTEPS, 0),
        (777, 500000, -100000, -3000000, IMPULSE_SUBSTEPS, z.ALPHA_NUM),
        (1245, -500000, 100000, 3000000, IMPULSE_SUBSTEPS, z.ALPHA_NUM),
        (35000, 2000000, 0, 0, None, z.ALPHA_NUM),
        (1000000, -2000000, 300000, 0, None, z.ALPHA_NUM),
        (19, 0, 1, 0, None, 0),
        (19, 0, 3, 0, None, 0),
        (19, 0, 0, 1, IMPULSE_SUBSTEPS, 0),
        (19, 0, 0, -1, IMPULSE_SUBSTEPS, 0),
    ]
    physics = [integrate_tic(*case) for case in cases]
    cooldowns = []
    for start, n, d in [(0, 1, 1), (0, 777000777, 1000000000), (9, 699, 1000), (35, 1434, 1000), (100, 1, 3), (1000000, 60, 1)]:
        cooldowns.append({
            "start_tic": str(start), "tick_rate": "35", "duration_num": str(n),
            "duration_den": str(d), "ready_tic": str(cooldown_ready_tic(start, n, d)),
        })
    vectors = {
        "format": FORMAT,
        "impulse_format": IMPULSE_FORMAT,
        "constants": {"h": "1000000000/(35*777000777)", "impulse_substeps": str(IMPULSE_SUBSTEPS)},
        "integration": physics,
        "cooldowns": cooldowns,
        "weapon_durations": weapon_durations(),
    }
    (root / "vectors").mkdir(parents=True, exist_ok=True)
    (root / "vectors" / "zeq-physics-v1.json").write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    js = [
        "/* Generated by zeq_physics.py; do not edit. */",
        "(function (global) {",
        '"use strict";',
        f"const vectors = Object.freeze({json.dumps(vectors, separators=(',', ':'))});",
        'if (typeof module !== "undefined" && module.exports) module.exports = vectors;',
        "else global.ZeqPhysicsTable = vectors;",
        '})(typeof window !== "undefined" ? window : globalThis);',
        "",
    ]
    (root / "zeq-physics-table.js").write_text("\n".join(js))
    generate_c_header(root, vectors)
    print(f"generated {len(physics)} integration + {len(cooldowns)} cooldown vectors")


def generate_c_header(root: Path, vectors: dict) -> None:
    lines = ["/* Generated shared physics vectors; do not edit. */", "#ifndef ZEQ_TEST_PHYSICS_VECTORS_H", "#define ZEQ_TEST_PHYSICS_VECTORS_H", ""]
    lines.append("typedef struct { int64_t gametic; int32_t tick_rate; int32_t alpha; int32_t initial; int32_t acceleration; int32_t impulse; int32_t substeps; int32_t position; int32_t velocity; int32_t delta; int32_t residual; int32_t force; int32_t drag; uint64_t start_phase; uint64_t end_phase; } zeq_test_step_vector_t;")
    lines.append("static const zeq_test_step_vector_t zeq_test_steps[] = {")
    for row in vectors["integration"]:
        lines.append("    { INT64_C(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, UINT64_C(%s), UINT64_C(%s) }," % tuple(row[key] for key in ("gametic", "tick_rate", "alpha_num", "initial_velocity", "acceleration", "impulse", "substeps", "position_delta", "velocity", "delta_velocity", "position_residual", "applied_force", "applied_drag", "start_phase64", "end_phase64")))
    lines.extend(["};", "#define ZEQ_TEST_STEPS_COUNT (sizeof(zeq_test_steps) / sizeof(zeq_test_steps[0]))"])
    lines.append("typedef struct { int64_t start; int32_t tick_rate; int64_t numerator; int64_t denominator; int64_t ready; } zeq_test_cooldown_vector_t;")
    lines.append("static const zeq_test_cooldown_vector_t zeq_test_cooldowns[] = {")
    for row in vectors["cooldowns"]:
        lines.append(f"    {{ INT64_C({row['start_tic']}), {row['tick_rate']}, INT64_C({row['duration_num']}), INT64_C({row['duration_den']}), INT64_C({row['ready_tic']}) }},")
    lines.extend(["};", "#define ZEQ_TEST_COOLDOWNS_COUNT (sizeof(zeq_test_cooldowns) / sizeof(zeq_test_cooldowns[0]))", "", "#endif", ""])
    (root / "tests" / "zeq_test_physics_vectors.h").write_text("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true")
    args = parser.parse_args()
    if args.generate:
        generate(Path(__file__).resolve().parent)
    else:
        parser.print_help()
