# Zeq Game SDK

A small, dependency-free SDK that makes the Zeq framework portable: any game or
simulation can adopt the Zeq carrier math, the hash-chained event ledger, and the
verifiable proof export — using Doom (`doomgeneric`) as the proof-of-concept
launchpad.

The architecture is split cleanly in two:

```
┌────────────────────────────┐        ┌──────────────────────────────────┐
│  ENGINE INTEGRATION LAYER  │        │         SIDECAR RUNTIME          │
│                            │        │                                  │
│  your game / simulation    │        │  zeq-kernel.js  (Node.js, 0 dep) │
│   ├─ zeq_plugin.h   (C99)  │  JSON  │   ├─ WORM machine.log.jsonl      │
│   │   carrier math, event  │  RPC   │   │   hash-chained, append-only  │
│   │   ring, host-injected  │  over  │   ├─ per-session event store     │
│   │   sine                 │  WS    │   ├─ zeq-proof-v1 export         │
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
| `zeq_plugin.h`    | C99 header | Engine Integration Layer: carrier math + event ring         |
| `zeq-game-sdk.js` | JS (UMD)   | Browser/WASM bridge: carrier, ledger, WebSocket JSON-RPC    |
| `zeq-kernel.js`   | Node.js ≥18| Sidecar Runtime: WORM log, sessions, proof export, verifier |

No npm install, no build step, no external dependencies anywhere.

## The universal carrier math

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
| `zeq.hello`   | request      | `{client, game, sdk}`               | `{kernel, machineId, sessionId, logSeq, scope}` — opens a session, appends `session-open` |
| `zeq.event`   | notification | `{type, tic, phase, value}`         | appended to the WORM log and the session chain (no reply) |
| `zeq.snapshot`| notification | arbitrary field bag                 | appended as a `snapshot` record (no reply) |
| `zeq.verify`  | request      | `{}`                                | `{ok, count, tip, at}` — re-verifies the session's hash chain |
| `zeq.export`  | request      | `{name}`                            | writes `<name>-<timestamp>.zeqproof.json`; replies `{path, eventCount, tip, verified}` |

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

## What a proof does and does not cover

Every record carries this scope string, and it is repeated here deliberately:

> **Integrity of this local event chain only; not proof of competitive legitimacy.**

A `zeq-proof-v1` file proves that a sequence of events was recorded by this
kernel on this machine without later modification (hash chain + machine
identity). It does **not** prove that the gameplay was fair, unassisted, or
competitively legitimate. There is no anti-cheat claim, no remote attestation,
and no cloud component.

## Doom reference mapping

The shipped `doomgeneric` fork wires the SDK concepts into the real engine:

| SDK concept            | Doom implementation                                             |
| ---------------------- | --------------------------------------------------------------- |
| tick source            | 35 Hz `gametic` (`doomgeneric_emscripten.c` frame pump)         |
| carrier / window       | `zeq_doom.c` (`ZEQ_Phase`, `ZEQ_PhaseAligned`, `ZEQ_CarrierPermille`, injects `finesine[]`) |
| event ring → JS        | `ZEQ_DrainEvents` polled by `web/zeq.js` → `queueEngineEvent`   |
| local ledger           | `web/zeq.js` (`zeq.doom.ledger.v1`, same record payload as SDK) |
| snapshots              | `pollSnapshot` reads 28 `HEAP32` fields via `ZEQ_SnapshotPtr`   |
| save capsule           | `.zeq`-style base64 + SHA-256 capsule (`zeq.doom.save.v1`)      |
| sidecar bridge         | `ZeqSDK.bridge` with `game: "doomgeneric-web"` (opt-in toggle)  |

## Honest status of the 12 vectors

The original design doc listed twelve integration vectors. This table states
what **this repository actually ships today** — no roadmap item is presented as
working code:

| # | Vector                        | Status        | Where |
| - | ----------------------------- | ------------- | ----- |
| 1 | WORM `machine.log.jsonl`      | **Implemented** | kernel: append-only, hash-chained, tamper-detecting |
| 2 | ZeqProof verifier             | **Implemented** | `zeq-proof-v1` export + `--verify` (export, clean log, and tampered log all tested) |
| 3 | `.zeq` save capsules          | **Implemented (Doom shell)** | base64 capsule + SHA-256 in `web/zeq.js`; not yet generalized into the SDK |
| 4 | HulyaPulse R(t)               | **Implemented** | pulse permille, C (Q16) and JS, cross-checked |
| 5 | Exact rational math           | **Implemented** | BigInt (JS) / int64 (C) phase and zeqond |
| 6 | Phase-locked impulses         | **Implemented** | window gate `[0.185, 0.315]`, Doom hold-input path |
| 7 | Zeqond cooldowns              | **Partial** | `zeqond()` time primitive ships; game-side cooldown policy is host-defined |
| 8 | split64 netcode               | **Roadmap** | no networking code ships; no multiplayer claims are made |
| 9 | Signed WAD/PK3 loader         | **Roadmap** | not implemented |
|10 | `boxSeal`/`boxOpen` parcels   | **Roadmap** | not implemented; would require real authenticated crypto before any claim |
|11 | MCP agent bridge              | **Roadmap** | not implemented |
|12 | Headless 20 Hz bot            | **Roadmap** | not implemented |

## Conformance test

```sh
gcc -std=c99 -Wall -Wextra -Wno-unused-function -I sdk your_test.c -o test
```

The header is header-only (all functions `static`); unused-function warnings on
the subset you don't call are expected and harmless.
