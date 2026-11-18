#!/usr/bin/env python3

import json
import math
import sys
from pathlib import Path

import mpmath as mp

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import zeq_time as z
import zeq_physics as p

ROOT = Path(__file__).resolve().parent.parent
VECTORS = json.loads((ROOT / "vectors" / "zeq-physics-v1.json").read_text())

for expected in VECTORS["integration"]:
    actual = p.integrate_tic(
        int(expected["gametic"]), int(expected["initial_velocity"]),
        int(expected["acceleration"]), int(expected["impulse"]),
        int(expected["substeps"]), int(expected["alpha_num"]), int(expected["tick_rate"]),
    )
    assert actual == expected, (actual, expected)
for expected in VECTORS["cooldowns"]:
    actual = p.cooldown_ready_tic(int(expected["start_tic"]), int(expected["duration_num"]), int(expected["duration_den"]), int(expected["tick_rate"]))
    assert actual == int(expected["ready_tic"])
    independent = int(expected["start_tic"]) + math.ceil(int(expected["duration_num"]) * 35 * z.ZEQOND_NS / (int(expected["duration_den"]) * 1_000_000_000))
    assert actual == independent

for tic in (0, 1, 17, 777, 1000000):
    stationary = p.integrate_tic(tic, 0)
    assert stationary["position_delta"] == "0"
    assert stationary["velocity"] == "0"
    assert stationary["delta_velocity"] == "0"

for acceleration in (-2000000, -3, -1, 0, 1, 3, 2000000):
    result = p.integrate_tic(19, 100000, acceleration, alpha_num=0)
    assert result["velocity"] == str(100000 + acceleration)
    assert result["position_delta"] == str(100000 + z.round_div(acceleration, 2))

impulse = p.integrate_tic(71, 0, impulse=4_000_000, alpha_num=0)
impulse_error = abs(int(impulse["delta_velocity"]) - 4_000_000) / 4_000_000
# Midpoint sampling with 32 half-sine substeps has a published 0.05% gate.
assert impulse_error <= 0.0005, impulse_error
reference = 2 * (mp.pi * 4_000_000 / 2) * 1 / mp.pi
assert reference == 4_000_000

probe = next(v for v in VECTORS["integration"] if v["initial_velocity"] == "1234567" and v["alpha_num"] == "129")
r_stamp = z.round_div(int(probe["initial_velocity"]) * z.metrics(int(probe["end_phase64"]))["carrier_q30"], z.Q30)
assert r_stamp != int(probe["position_delta"]), "final R stamp must not pass as lapse integration"

assert z.from_tic(35, 70)[1] != z.from_tic(17, 35)[1]
for kwargs in ({"gametic": -1, "velocity": 0}, {"gametic": 0, "velocity": 0, "tick_rate": 0}, {"gametic": 0, "velocity": 0, "substeps": 0}, {"gametic": 0, "velocity": 0, "alpha_num": 1}):
    try:
        p.integrate_tic(**kwargs)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid integration accepted")
for args in [(-1, 1, 1), (0, 0, 1), (0, 1, 0)]:
    try:
        p.cooldown_ready_tic(*args)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid cooldown accepted")

# Autonomous oscillator reference: with dτ=N dφ, the equation in section 5
# becomes x''(τ)+ω²x=0. Compare the coordinate-time midpoint form with the
# independent proper-time solution. This is a model test, not a Doom replay.
mp.mp.dps = 60
alpha = mp.mpf(129) / 100000
omega = 2 * mp.pi
steps = 4096
dt = mp.mpf(1) / steps
x = mp.mpf(0)
u = omega
tau = mp.mpf(0)
for k in range(steps):
    phase = k * dt
    middle_phase = phase + dt / 2
    n_mid = mp.sqrt(1 - alpha * mp.sin(2 * mp.pi * middle_phase))
    d_mid = -alpha * mp.pi * mp.cos(2 * mp.pi * middle_phase) / (1 - alpha * mp.sin(2 * mp.pi * middle_phase))
    n_start = mp.sqrt(1 - alpha * mp.sin(2 * mp.pi * phase))
    d_start = -alpha * mp.pi * mp.cos(2 * mp.pi * phase) / (1 - alpha * mp.sin(2 * mp.pi * phase))
    u_mid = u + dt / 2 * (d_start * u - (1 - alpha * mp.sin(2 * mp.pi * phase)) * omega**2 * x)
    x_next = x + dt * u_mid
    u = u + dt * (d_mid * u_mid - n_mid**2 * omega**2 * (x + dt / 2 * u_mid))
    x = x_next
    tau += n_mid * dt
n_end = mp.sqrt(1 - alpha * mp.sin(2 * mp.pi))
reference_x = mp.sin(omega * tau)
reference_u = n_end * omega * mp.cos(omega * tau)
assert abs(x - reference_x) < mp.mpf("0.0001"), (x, reference_x)
assert abs(u - reference_u) < mp.mpf("0.001"), (u, reference_u)

for row in VECTORS["weapon_durations"]:
    assert abs(int(row["ready_tic_from_zero"]) - int(row["cadence_tics"])) <= 1

print(f"Python OK: {len(VECTORS['integration'])} integration + {len(VECTORS['cooldowns'])} cooldown vectors; impulse {impulse_error:.6%}, oscillator, R-stamp rejection, and negative tests OK")
