"""Portable zeq-chamber-v1 reference adapter. No Doom or floating-point state."""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from dataclasses import dataclass
from typing import Iterable, Mapping

FORMAT = "zeq-chamber-v1"
COMMAND_FORMAT = "zeq-chamber-command-v1"
SCALE = 1024
LIMIT = 1048576
MAX_SPEED = 65536
MAX_PARTICLES = 16
MAX_TICS = 2000000


def _integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"invalid {name}")
    return value


def _random(state: int) -> int:
    value = state & 0xFFFFFFFF
    value ^= (value << 13) & 0xFFFFFFFF
    value ^= value >> 17
    value ^= (value << 5) & 0xFFFFFFFF
    return value & 0xFFFFFFFF


def _reflect(position: int) -> int:
    result = position
    bounces = 0
    while result < -LIMIT or result > LIMIT:
        result = 2 * LIMIT - result if result > LIMIT else -2 * LIMIT - result
        bounces += 1
        if bounces > 8:
            raise ValueError("chamber reflection budget exceeded")
    return result


@dataclass(frozen=True)
class Particle:
    x: int
    y: int
    vx: int
    vy: int


class Chamber:
    def __init__(self, seed: int = 0x5EED1234, particles: int = 4) -> None:
        self.seed = _integer(seed, "seed", 0, 0xFFFFFFFF)
        self.count = _integer(particles, "particle count", 1, MAX_PARTICLES)
        self.tic = 0
        self.rng = self.seed or 0x6D2B79F5
        initial = []
        for _ in range(self.count):
            self.rng = _random(self.rng)
            x = self.rng % (LIMIT + 1) - LIMIT // 2
            self.rng = _random(self.rng)
            y = self.rng % (LIMIT + 1) - LIMIT // 2
            self.rng = _random(self.rng)
            vx = (self.rng & 511) - 256
            self.rng = _random(self.rng)
            vy = (self.rng & 511) - 256
            initial.append(Particle(x, y, vx, vy))
        self.particles = tuple(initial)

    def step(self, command: Mapping[str, int] | None = None) -> dict:
        command = command or {}
        _integer(self.tic + 1, "tic", 1, MAX_TICS)
        ax = _integer(command.get("ax", 0), "x acceleration", -127, 127)
        ay = _integer(command.get("ay", 0), "y acceleration", -127, 127)
        following = []
        for particle in self.particles:
            vx = max(-MAX_SPEED, min(MAX_SPEED, particle.vx + ax))
            vy = max(-MAX_SPEED, min(MAX_SPEED, particle.vy + ay))
            following.append(Particle(_reflect(particle.x + vx), _reflect(particle.y + vy), vx, vy))
        self.particles = tuple(following)
        self.tic += 1
        return self.state()

    def state(self) -> dict:
        return {"format": FORMAT, "tic": self.tic, "seed": self.seed, "rng": self.rng,
                "particles": [{"x": p.x, "y": p.y, "vx": p.vx, "vy": p.vy} for p in self.particles]}

    def state_bytes(self) -> bytes:
        result = bytearray(b"ZEQCHM1\0")
        result.extend(struct.pack("<IHHII", self.tic, self.count, 0, self.seed, self.rng))
        for particle in self.particles:
            result.extend(struct.pack("<iiii", particle.x, particle.y, particle.vx, particle.vy))
        return bytes(result)

    def state_hex(self) -> str:
        return self.state_bytes().hex()

    def state_sha256(self) -> str:
        return hashlib.sha256(self.state_bytes()).hexdigest()


def replay(commands: Iterable[Mapping[str, int]], seed: int = 0x5EED1234,
           particles: int = 4, checkpoint_interval: int = 35) -> dict:
    _integer(checkpoint_interval, "checkpoint interval", 1, MAX_TICS)
    chamber = Chamber(seed, particles)
    checkpoints = []
    count = 0
    for command in commands:
        count += 1
        _integer(count, "replay length", 0, MAX_TICS)
        chamber.step(command)
        if chamber.tic % checkpoint_interval == 0:
            checkpoints.append({"tic": chamber.tic, "state_hex": chamber.state_hex()})
    if not checkpoints or checkpoints[-1]["tic"] != chamber.tic:
        checkpoints.append({"tic": chamber.tic, "state_hex": chamber.state_hex()})
    return {"format": FORMAT, "command_format": COMMAND_FORMAT, "state": chamber.state(),
            "state_hex": chamber.state_hex(), "state_sha256": chamber.state_sha256(),
            "checkpoints": checkpoints}


def _main() -> None:
    request = json.load(sys.stdin)
    result = replay(request["commands"], request.get("seed", 0x5EED1234),
                    request.get("particles", 4), request.get("checkpoint_interval", 35))
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    _main()
