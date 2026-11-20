# Zeq Game SDK

A small, dependency-free SDK that makes the Zeq framework portable: any game or
simulation can adopt exact Zeq time and deterministic lapse physics, the explicitly
labeled legacy carrier approximation, a hash-chained event ledger, and local proof
export — using Doom (`doomgeneric`) as the proof-of-concept launchpad.

**Repository boundary:** the portable SDK is distributed from
`hulyasmath/zeq-doomgeneric`; the complete playable reference host remains in
`hulyasmath/doomgeneric`. The SDK repository is not a second Doom game mirror.
Portable modules, schemas, vectors, tests, and guides are versioned independently
and consumed by the reference host through an explicit release identity.

Read the [consolidated Phase 0–13 roadmap](../docs/zeq-roadmap-v1.md) and the
[third-party integration guide](../docs/zeq-sdk-integration-v1.md) before adopting
the SDK. Current time, replay, evidence, save, content, network-contract, and
narrow event-contract observation APIs are documented there with their exact
boundaries. Unit/dimensional analysis, scientific numerical methods, the general
scenario/experiment/plugin system, and second-engine validation remain Phase
9–13 work. The shipped `zeq-host-v1` observer is a proof of concept, not completion
of those programs.

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
| `zeq-content.js`  | JS (UMD)   | Signed mods, explicit publisher trust, sealed expiring parcels |
| `zeq-net.js`      | JS (UMD)   | Canonical session descriptors and deterministic test-link impairment scheduling; not a transport |
| `zeq_pixel.c/.h`  | C99 + i128 | Optional opaque raster, rational projection, occupancy, and canonical bytes |
| `zeq-pixel.js`    | JS (UMD)   | BigInt-equivalent `zeq-pixel-v1` reference implementation |
| `zq/zeq-host.js`  | JS (UMD)   | Ordered, engine-neutral event-to-contract adaptation and linked-record audit |
| `zq/zeq-browser.js` | JS (UMD) | HTTP(S) client for an owner-configured contract machine; scoped key held in memory |
| `zq/zeq-panel.js` | JS (browser) | Optional non-authoritative connection/status panel |
| `zq/examples/doom/doom-zeq.js` | JS (UMD) | Scoped Doom event mapping; an example, not part of the engine-neutral runtime |
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

## Clean checkout: generate, build, and test

The large sine and physics vectors are reproducible build products, not
hand-maintained source. From the SDK repository root, install the generator
and independent-vector test dependencies, regenerate every table, and run the
conformance suites in this order:

```sh
python3 -m pip install mpmath cryptography
python3 sdk/zeq_time.py --generate
python3 sdk/zeq_physics.py --generate

cc -std=c11 -O2 -Wall -Wextra -Werror -I sdk \
  sdk/tests/test_time.c sdk/zeq_time.c -o /tmp/zeq-test-time
/tmp/zeq-test-time
cc -std=c11 -O2 -Wall -Wextra -Werror -I sdk \
  sdk/tests/test_physics.c sdk/zeq_physics.c sdk/zeq_time.c -o /tmp/zeq-test-physics
/tmp/zeq-test-physics

python3 sdk/tests/test_time.py
python3 sdk/tests/test_physics.py
node sdk/tests/test_time.js
node sdk/tests/test_physics.js
python3 sdk/tests/test_security.py
python3 sdk/tests/test_content.py
node sdk/tests/test_security.js
node sdk/tests/test_content.js
node sdk/tests/test_net.js
node sdk/tests/test_pixel.js
node sdk/zq/tests/test_doom.js
node sdk/tests/test_sidecar.js
```

The C implementation requires checked compiler 128-bit integers. Node.js 20 or
later is recommended. The pixel conformance test also requires Emscripten (`emcc`, or `EMCC=/path/to/emcc`) so it can compare native C, JavaScript, and WASM bytes. The two Python vector tests regenerate the small checked-in
security/content fixtures independently; the JavaScript suites must reproduce
those exact bytes. `test_sidecar.js` creates temporary local identities and
removes them after the test. The real Doom replay and MCP suites are run from
the reference-host checkout as described below, not from this SDK-only tree.

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

From the separate `hulyasmath/doomgeneric` reference-host checkout, build the
native null-platform engine and run its regression suites:

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
from native-only results. With the reference host's `dist/` served on port 8765, run:

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

## Signed mods and sealed parcels (Phase 5 SDK milestone)

`zeq-content.js` runs in Node.js and the browser. It signs canonical
`zeq-mod-manifest-v1` bodies with Ed25519 and verifies each declared file's size
and SHA-256 digest only after the publisher key ID is explicitly trusted. A valid
signature without that trust decision is self-consistent, not authorized. Mod
paths are bounded relative UTF-8/NFC paths; traversal, absolute paths, duplicate
paths, and oversized content are rejected.

`ZEQ-PARCEL-v2` parcels combine signed machine records with ephemeral-static
X25519, HKDF-SHA256, and AES-256-GCM. Opening checks the recipient, sender
signature, authenticated header, expiry window, plaintext size, authentication
tag, and `(recipient_zid, parcel_id)` replay record. The bounded inbox holds at
most 1000 parcels and 64 MiB of serialized parcel data. Plaintext is returned as
data only; it is never executed or automatically loaded as a mod.

```sh
python3 sdk/tests/test_content.py   # independently generates the public vector
node sdk/tests/test_content.js      # 12 SDK checks + exact Python interop
```

The reference host browser ledger's **TEST PHASE 5 SDK** button runs the same 12-check suite.
The separate reference host now implements and tests a narrow single-PWAD loader:
SDK signature/trust/size/digest verification, an engine-owned copy, independent C
SHA-256 and structural checks, and memory-backed lump reads from the same bytes.
Multi-file load order and PK3 remain unsupported until their bounded mappings and
readers exist. Parcel plaintext is never executed or automatically loaded.

## Deterministic network contracts (Phase 6)

`zeq-net.js` validates canonical `zeq-net-session-v1` descriptors, computes their
SHA-256 identity, and supplies deterministic delay/jitter/drop/duplicate scheduling
for test links. It does not open sockets, simulate peers, or implement rollback.
The real reference-host gate launches two native Doom engines over TCP, exchanges
complete commands, restores actual engine snapshots, resimulates mispredictions,
and requires matching confirmed canonical hashes under direct and impaired
transport. The native listener defaults to loopback and accepts an explicit
numeric `ZEQ_NET_BIND` local IPv4 for private-LAN use; the one-host non-loopback
LAN case passes, but no physical two-machine Wi-Fi result is claimed. Browser
networking, signed peer authentication, encryption/TLS, matchmaking, and
production public multiplayer remain unsupported.

## Deterministic raster primitives (bounded Phase 7 slice)

`zeq_pixel.c/.h` and `zeq-pixel.js` implement optional `zeq-pixel-v1` opaque
raster primitives without Doom types. They provide caller-owned per-pixel
depth/owner/layer/claim state, deterministic arbitration, bounded rational
projection, clipped spans/columns, and canonical frame/occupancy serialization.
The fixed native-C/JavaScript/WASM fixture matches byte-for-byte and rejects
same-key color conflicts, transparent writes, malformed geometry, overflow, and
short buffers. Doom's normal renderer is unchanged. Host renderer integration,
texture/flat validation, palette/colormap/fuzz/translucency behavior, and the
complete visual-integrity profile remain pending. Visual hashes are separate
from gameplay hashes and are not competitive-legitimacy evidence.

## Event-contract observation (narrow Phase 11 proof of concept)

`zq/zeq-host.js` (`zeq-host-v1`) accepts an engine-neutral host description:
named contract definitions plus event handlers. `ZeqHost.attach(machine, spec)`
validates and deploys those definitions, serializes event decisions in emission
order, exposes decision/statistic views, and exports `zeq-host-record-v1`.
`ZeqHost.audit(machineOrNull, record)` checks linked contract rows offline and,
when a machine handle is supplied, compares them with `readContract`. The host
must supply truthful, ordered, fully described events; the adapter cannot prove
that they occurred or make a refused transition undo host behavior.

`zq/zeq-browser.js` (`zeq-browser-v1`) connects to an owner-configured HTTP(S)
contract machine using a scoped bearer key. Cleartext HTTP is allowed only for
loopback; non-loopback machines require HTTPS. URLs containing credentials,
queries, or fragments are refused. The key remains in caller memory and is not
persisted by the module. The external machine owns deployment, transition,
condition-evaluation, and record decisions; this client is not a signer or a
security boundary.

`zq/zeq-panel.js` (`zeq-panel-v1`) is an optional browser UI. Disconnected sends
resolve without effect, connection/decision failures are displayed, and gameplay
is never blocked. The integration clears the key input after every connection
attempt. Mount the panel into normal layout when an overlay could intercept host
controls.

The scoped example in `zq/examples/doom/doom-zeq.js` maps real Doom event IDs to
five narrow contracts: weapon cooldown, damage-derived player health estimate,
three distinct ruleset identities, a restricted shareware level graph, and a
save-load resumed marker. It does not provide authoritative health, general Doom
semantics, gameplay enforcement, anti-cheat, or the full Phase 11 scenario and
experiment system. The Doom example is deliberately separate from the portable
runtime modules.

```sh
node sdk/zq/tests/test_doom.js
```

The default test uses `sdk/zq/tests/contract-test-machine.js`, a conformance-only
in-memory evaluator and HTTP server. It is not a Zeq machine, signer, security
boundary, or proof of external-machine compatibility. Its `new Function`
condition evaluation is restricted to trusted test definitions; production
conditions remain the external machine's responsibility and must not use an
unrestricted evaluator. An owner-provided external machine can be tested with
`ZEQ_MACHINE_URL` and `ZEQ_KEY_FILE`; no external-machine result is implied by
the local suite. The real native and played-WASM reference-host adapters and
their tests remain in `hulyasmath/doomgeneric`.

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

The separately maintained `doomgeneric` reference host wires the SDK concepts into the real engine:

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
| 8 | Deterministic networking     | **Native reference + SDK contracts** | `zeq-net.js` descriptors/impairment tests; real two-process TCP rollback in the external Doom host; no browser/public multiplayer |
| 9 | Signed WAD/PK3 loader         | **Single-PWAD reference milestone** | SDK verification plus tested external single-PWAD engine loader; multi-file/PK3 unsupported |
|10 | `boxSeal`/`boxOpen` parcels   | **Implemented (SDK)** | Signed, encrypted, expiring, bounded, replay-protected parcels; plaintext is never executed |
|11 | MCP agent bridge              | **Implemented (local stdio)** | Seven lifecycle/input/state/proof methods; opt-in controls and secret rejection |
|12 | Headless 20 Hz bot            | **Roadmap** | Real 35 Hz headless replay is implemented; the separate 20 Hz bot scheduler is not |

## Conformance test

```sh
gcc -std=c99 -Wall -Wextra -Wno-unused-function -I sdk your_test.c -o test
```

The header is header-only (all functions `static`); unused-function warnings on
the subset you don't call are expected and harmless.
