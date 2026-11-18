# Zeq Game SDK

A small, dependency-free SDK that makes the Zeq framework portable: any game or
simulation can adopt exact Zeq time and deterministic lapse physics, the explicitly
labeled legacy carrier approximation, a hash-chained event ledger, and local proof
export — using Doom (`doomgeneric`) as the proof-of-concept launchpad.

The architecture is split cleanly in two:

```
┌────────────────────────────┐        ┌──────────────────────────────────┐
│  ENGINE INTEGRATION LAYER  │        │         SIDECAR RUNTIME          │
│                            │        │                                  │
│  your game / simulation    │        │  zeq-kernel.js  (Node.js, 0 dep) │
│   ├─ zeq_plugin.h   (C99)  │  JSON  │   ├─ machine.log.v2.jsonl        │
│   │   carrier math, event  │  RPC   │   │   hash-chained, append-only  │
│   │   ring, host-injected  │  over  │   ├─ per-session event store     │
│   │   sine                 │  WS    │   ├─ zeq-proof-v2 export         │
│   └─ zeq-game-sdk.js (JS) ─┼───────►│   └─ --verify offline checker    │
│        browser/WASM bridge │ ws://  │                                  │
│        ledger, queue, RPC  │ 127.0.0│  machine identity:               │
└────────────────────────────┘ .1:7770│  .zeq-machine.json (mode 0600)   │
                                      └──────────────────────────────────┘
```

The sidecar is **strictly optional**. If `zeq-kernel.js` is not running, the game
behaves exactly as before — the browser ledger in `localStorage` remains the
local-first record of play. The bridge only *mirrors* telemetry outward.

## Files

| File              | Language   | Role                                                        |
| ----------------- | ---------- | ----------------------------------------------------------- |
| `zeq_plugin.h`    | C99 header | Legacy engine integration: carrier math + event ring        |
| `zeq_time.c/.h`   | C99        | Exact time, split64/Q64, deterministic lapse diagnostics     |
| `zeq_physics.c/.h`| C99        | Midpoint integration, finite impulses, exact cooldowns       |
| `zeq-game-sdk.js` | JS (UMD)   | Exact time/physics, legacy carrier, ledger, WebSocket RPC    |
| `zeq-kernel.js`   | Node.js ≥18| Sidecar Runtime: append-only log, sessions, export, verifier |
| `zeq-replay.js`   | Node.js ≥18| Real headless input, canonical checkpoints, replay and proof |
| `zeq-mcp.js`      | Node.js ≥18| Local stdio MCP lifecycle, input, state, proof, verification |
| `vectors/`        | JSON       | Shared C/JavaScript/Python conformance vectors               |

The SDK has no npm dependencies. The Doom WASM reference integration has its own
Emscripten build step.

## Exact time and physics

`zeq-time-v1` defines the exact 777000777 ns Zeqond, split64 tick/phase conversion,
Q30 carrier/lapse values, and Q40 cycle derivative. `zeq-physics-v1` uses checked
fixed-point midpoint integration, deterministic substeps for finite impulses, and
exact rational cooldown-to-Doom-tic conversion. Generated lookup tables and shared
vectors keep the C, JavaScript, and Python implementations aligned without relying
on host transcendental functions for cross-runtime results.

The original approximate carrier remains available only under its legacy name:

## Legacy universal carrier math

Everything is defined from the engine's own tick counter, so the constants are
identical at **any** tick rate:

```
period(tickRate)      = tickRate * 1000
phase(gametic)        = (gametic * 1287) mod period          → carrier is exactly 1.287 Hz
window                = [0.185, 0.315] of the period          → [6475, 11025] at 35 Hz
pulse permille        = 1000 + 24 * sin(2π * phase / period)  → 976 … 1024
zeqond(gametic)       = gametic * 777 / period                → seconds of 0.777
```

- C: `zeq_phase()`, `zeq_aligned()`, `zeq_carrier_permille()`, `zeq_zeqond()` —
  all integer/fixed-point (Q16 sine; the host may inject its own sine table, as
  Doom does with `finesine[]`).
- JS: `ZeqSDK.carrier.*` — BigInt exact for phase/zeqond, display-grade
  `Math.sin` for pulse.

The C and JS implementations were conformance-tested to produce identical
values for Doom's 35 Hz tick (and for 60 Hz hosts).

## The bridge protocol (JSON-RPC 2.0 over WebSocket)

Browser WASM cannot open raw TCP sockets — Emscripten maps sockets onto
WebSocket — so the bridge is `ws://127.0.0.1:7770/zeq` (configurable).

| Method        | Kind         | Params                              | Result / effect |
| ------------- | ------------ | ----------------------------------- | --------------- |
| `zeq.hello`   | request      | `{client, game, sdk}`               | `{kernel, machineId, sessionId, runId, signer, logSeq, scope}` — opens a signed session |
| `zeq.event`   | notification | `{type, tic, phase, value}`         | appended to the signed log and session chain (no reply) |
| `zeq.snapshot`| notification | arbitrary field bag                 | appended as a signed `snapshot` record (no reply) |
| `zeq.verify`  | request      | `{}`                                | `{ok, count, tip, at, trust}` — re-verifies the signed session chain |
| `zeq.export`  | request      | `{name}`                            | writes `<name>-<timestamp>.zeqproof.json`; replies `{path, eventCount, tip, verified, replay}` |

Unknown methods with an `id` receive a JSON-RPC error; notifications (`id`
absent) are fire-and-forget.

## Running the sidecar

```sh
node zeq-kernel.js serve --port 7770 --dir .
# then, from the SDK browser client:
#   ZeqSDK.bridge.configure({ url: "ws://127.0.0.1:7770/zeq",
#                             game: "my-game", client: "my-shell/1.0" });
#   ZeqSDK.bridge.connect();
```

Verify any artifact offline:

```sh
node zeq-kernel.js --verify machine.log.jsonl        # INTEGRITY OK / CHAIN BROKEN
node zeq-kernel.js --verify run-….zeqproof.json      # same, for exports
```

## Real headless replay and MCP (Phase 4)

Build the native null-platform engine and run its regression suites:

```sh
sh build-headless.sh
node sdk/tests/test_replay.js
node sdk/tests/test_mcp.js
```

`doomgeneric-headless` runs the original C simulation at 35 Hz without rendering or
audio. `zeq-replay.js` writes bounded `zeq-input-v1` artifacts containing actual
24-byte little-endian `ticcmd_t` records. `G_BuildTiccmd` playback injects complete
commands; `RunTic` remains authoritative. Checkpoints serialize canonical gameplay
state with symbolic pointer/action IDs and SHA-256, not host addresses.

A replay is `match` only after a second real engine process consumes the same input
and reproduces every checkpoint. Altered input, broken input digests, incomplete
checkpoint sequences, and changed state hashes fail. `exportReplayProof` signs the
actual engine event chain and checkpoints as `zeq-proof-v2`; verification of a
claimed match performs another real run.

The local stdio MCP server exposes `zeq.run.start`, `zeq.run.stop`,
`zeq.run.status`, `zeq.input.inject`, `zeq.state.read`, `zeq.proof.export`, and
`zeq.verify`. Run control requires `--allow-run`; live input additionally requires
`--allow-input`. Clients cannot select executable/WAD paths, and PINs, private keys,
private seeds, and machine equations are rejected.

```sh
node sdk/zeq-mcp.js                       # read-only status/inspection default
node sdk/zeq-mcp.js --allow-run --allow-input
```

The current replay scope is a fresh single-player E1M1 run with the installed
shareware WAD. Browser/WASM checkpoint identity is tested separately, never inferred
from native-only results. With `dist/` served on port 8765, run:

```sh
node sdk/tests/test_browser_replay.js
node sdk/tests/test_browser.js
```

The first test exports the browser's actual contiguous 24-byte `ticcmd_t` records,
replays that artifact in the native C engine, and requires equal SHA-256 canonical
hashes at equal completed tics. It also verifies real movement, turning, firing,
input release, and the absence of browser/HTTP errors with rendering enabled. The
second covers ZEQC3 saves, wrong-PIN/tamper/truncation refusal, signed proof export,
legacy-save compatibility, controls, and mobile layout. These checks establish local
replay consistency only; they do not prove competitive legitimacy.

## What a proof does and does not cover

Every record carries this scope string, and it is repeated here deliberately:

> **Integrity of this local event chain only; not proof of competitive legitimacy.**

A `zeq-proof-v2` file verifies the canonical record sequence, hashes, chain links,
and Ed25519 signatures against its public anchor. A self-declared anchor is only
self-consistent unless explicitly trusted. This does **not** prove that gameplay
was fair, unassisted, or competitively legitimate. There is no anti-cheat claim,
remote attestation, or cloud component. The JSONL file is append-only and
hash-chained by the process, not physical WORM storage. Telemetry-only exports
keep replay `unavailable`; no headless Doom reproduction is implied.

## Doom reference mapping

The shipped `doomgeneric` fork wires the SDK concepts into the real engine:

| SDK concept            | Doom implementation                                             |
| ---------------------- | --------------------------------------------------------------- |
| tick source            | 35 Hz `gametic` (`doomgeneric_emscripten.c` frame pump)         |
| carrier / window       | `zeq_doom.c` (`ZEQ_Phase`, `ZEQ_PhaseAligned`, `ZEQ_CarrierPermille`, injects `finesine[]`) |
| event ring → JS        | `ZEQ_DrainEvents` polled by `web/zeq.js` → `queueEngineEvent`   |
| local ledger           | `web/zeq.js` (`zeq.doom.ledger.v1`, same record payload as SDK) |
| snapshots              | `pollExactSnapshot` reads snapshot v3 via `ZEQ_GetExactSnapshot`; impulse records use `ZEQ_GetImpulseRecord` |
| save capsule           | Real ZEQC3 encryption plus Doom save extension v2; browser-local persistence, export, and restore |
| sidecar bridge         | `ZeqSDK.bridge` with `game: "doomgeneric-web"` (opt-in toggle)  |

## Honest status of the 12 vectors

The original design doc listed twelve integration vectors. This table states
what **this repository actually ships today** — no roadmap item is presented as
working code:

| # | Vector                        | Status        | Where |
| - | ----------------------------- | ------------- | ----- |
| 1 | Signed `machine.log.jsonl`    | **Implemented** | Append-only, hash-chained, Ed25519-signed v2 per-session logs; rewritable file, not physical WORM |
| 2 | ZeqProof verifier             | **Implemented** | `zeq-proof-v2` export + `--verify`; legacy v1 verification retained |
| 3 | Doom save capsules            | **Implemented (Doom shell)** | Real ZEQC3, save extension v2, old-save compatibility, and fail-closed PIN/tamper handling |
| 4 | HulyaPulse R(t)               | **Implemented** | Exact Q30 diagnostics plus the explicitly labeled legacy pulse approximation |
| 5 | Exact rational math           | **Implemented** | BigInt (JS) / checked fixed-width integer (C), with shared vectors |
| 6 | Finite-interval impulses      | **Implemented (Doom Physics ruleset)** | Actual damage/explosion paths, X/Y/Z, 32 deterministic substeps |
| 7 | Zeqond cooldowns              | **Implemented (Doom Physics ruleset)** | Exact ready tics enforced in `P_FireWeapon` |
| 8 | split64 netcode               | **Roadmap** | no networking code ships; no multiplayer claims are made |
| 9 | Signed WAD/PK3 loader         | **Roadmap** | not implemented |
|10 | `boxSeal`/`boxOpen` parcels   | **Roadmap** | not implemented; would require real authenticated crypto before any claim |
|11 | MCP agent bridge              | **Implemented (local stdio)** | Seven lifecycle/input/state/proof methods; opt-in controls and secret rejection |
|12 | Headless 20 Hz bot            | **Roadmap** | Real 35 Hz headless replay is implemented; the separate 20 Hz bot scheduler is not |

## Conformance test

```sh
gcc -std=c99 -Wall -Wextra -Wno-unused-function -I sdk your_test.c -o test
```

The header is header-only (all functions `static`); unused-function warnings on
the subset you don't call are expected and harmless.
