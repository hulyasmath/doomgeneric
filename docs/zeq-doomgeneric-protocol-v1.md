# Zeq × doomgeneric Protocol Specification

**Protocol family:** `zeq-doom-v1`  
**Document status:** Versioned reference protocol; section 18 records tested implementation scope
**Engine baseline:** `c8e4f18c11175a1c69e203a292e4bcdbf874a538`  
**Upstream merge base:** `e257a09527062bfb986b6e5e0780839b6cbd5b71`  
**Authoritative framework references:** uploaded `zeq(1).py` and `zeq(1).html`

This document governs new Zeq work in the real doomgeneric C engine. It does not authorize replacing Doom, changing its 35 Hz simulation, or describing a planned feature as implemented. The key words MUST, MUST NOT, SHOULD, and MAY are normative.

Program scope and repository ownership are defined in [Zeq Program Roadmap v1](zeq-roadmap-v1.md). Developers integrating an engine other than Doom must start with [Zeq SDK Third-Party Integration Guide v1](zeq-sdk-integration-v1.md); this Doom protocol is a reference profile, not a requirement to adopt Doom data structures.

## 1. Scope and non-negotiable boundaries

The implementation MUST retain doomgeneric's renderer, collision model, gameplay simulation, demo support, and shareware content. Zeq time and physics belong in explicit engine integration points, not in a parallel reimplementation.

The optional browser/Node sidecar is telemetry and verification infrastructure. If it is absent, Doom MUST remain playable and the browser-local ledger MUST remain authoritative for local play. Browser/WASM transport uses JSON-RPC 2.0 over WebSocket; ordinary raw TCP socket behavior MUST NOT be assumed in a browser.

The following claims are prohibited:

- competitive-legitimacy, anti-cheat, or memory-tamper-proof claims;
- cloud synchronization or remote multiplayer claims without a real implementation;
- absolute write-once storage claims for an ordinary append-only file;
- claims that a signature makes content trustworthy or safe;
- claims that time, sine, square root, or transcendental physics are all exact rational arithmetic;
- claims that carrier stamping, a thrust multiplier, or a HUD pulse implements lapse dynamics;
- claims that the Doom adaptation validates the model experimentally.

## 2. Format versions and legacy compatibility

| Name | Version | Purpose |
|---|---:|---|
| `zeq-time-v1` | 1 | Exact Zeqond time, Q64 phase, and Doom-tic conversion |
| `zeq-wire-v1` | 1 | JSON-RPC 2.0 sidecar transport |
| `zeq-event-v2` | 2 | Versioned, canonical, hash-chained event records |
| `zeq-snapshot-v2` | 2 | Live telemetry snapshots; not rollback state |
| `zeq-run-v1` | 1 | Engine/WAD/ruleset/run identity |
| `zeq-input-v1` | 1 | Canonical per-tic `ticcmd_t` input |
| `zeq-doom-state-v1` | 1 | Canonical deterministic state serialization |
| `zeq-state-hash-v1` | 1 | Per-tic or checkpoint state commitments |
| `zeq-proof-v2` | 2 | Offline-verifiable session, input, and replay evidence |
| `zeq-attestation-v1` | 1 | Optional reviewer signature over an exported result |
| `zeq-doom-save-v1` | 1 | Authenticated save plaintext carried by ZEQC3 |
| `zeq-mod-manifest-v1` | 1 | Signed mod file manifest |
| `ZEQ-PARCEL-v2` | 2 | Expiring, replay-protected Doom parcel profile |
| `zeq-net-session-v1` | 1 | Canonical deterministic network session descriptor |
| `zeq-doom-net-v1` | 1 | Native two-process binary command/hash/rollback protocol |
| `zeq-pixel-v1` | 1 | Optional deterministic opaque raster primitives and occupancy |
| `zeq-pixel-conformance-v1` | 1 | Fixed-scene native/JavaScript/WASM pixel comparison record |
| `zeq-pk3-v1` | 1 | Bounded stored/deflated regular-file package with manifest-defined order |
| `zeq-texture-validation-v1` | 1 | Checked Doom texture/patch/flat/palette/colormap resource bounds |
| `zeq-doom-visual-v1` | 1 | Real indexed-frame visual commitments separate from gameplay state |
| `zeq-bot-schedule-v1` | 1 | Deterministic outer 20 Hz command scheduler for a 35 Hz host |
| `zeq-mcp-v1` | 1 | Local headless automation interface |

Existing records retain their original meanings:

- `zeq-proof-v1` remains readable by the existing verifier and MUST NOT be silently redefined.
- Native `ZEQ_SNAPSHOT_VERSION 1` and event types 1–8 are legacy telemetry. New work uses `zeq-snapshot-v2` and `zeq-event-v2` alongside an explicit migration boundary.
- The approximately `0.777 s` clock, `1287/35000` phase calculation, ±2.4% carrier, player-thrust multiplier, and phase-damage bonus belong only to `zeq-arcade-legacy-v1`.
- A decoder MUST reject an unknown major format version. It MUST NOT guess a record's semantics from similarly named fields.

## 3. Exact timebase

### 3.1 Constants

```text
ZEQOND_NS = 777000777
TAU_Q     = 777000777 / 1000000000 seconds
F0        = 1000000000 / 777000777 Hz
ALPHA     = 129 / 100000 = 0.00129
TWO64     = 18446744073709551616
```

`F0` is displayed as approximately `1.287000000001287 Hz`; that decimal is not a replacement for the rational. The exact constant `777000777 ns` takes precedence over rounded prose such as `0.777 s` and over the legacy HITE display string.

### 3.2 Nanosecond instants

For integer nanoseconds `ns`:

```text
tick(ns)    = floor(ns / ZEQOND_NS)
remainder   = ns - tick(ns) * ZEQOND_NS
phase_q(ns) = remainder / ZEQOND_NS
phase64(ns) = floor(remainder * TWO64 / ZEQOND_NS)
```

For nonnegative `ns`, `tick` is an unsigned count and `0 <= remainder < ZEQOND_NS`. For signed universal-time calculations, floor division and a nonnegative remainder MUST be used; C truncation toward zero is not floor division for negative inputs.

`split64(ns)` returns `(tick, phase64)`. Its in-memory representation is a 64-bit tick and a 64-bit unsigned phase. On the wire both are canonical decimal strings. `split64` is a time representation, not a networking protocol.

Portable C MUST avoid overflowing `remainder << 64`. It MAY use the reference two-step 34/30-bit decomposition, a checked 128-bit integer, or another implementation that produces identical results. JavaScript uses `BigInt`; Python uses arbitrary-precision integers. Using a rounded quanta-per-nanosecond multiplier is prohibited for authoritative timestamps.

### 3.3 Doom's rational tic clock

Doom remains exactly 35 simulation tics per second. For nonnegative integer `gametic = g`, authoritative simulation time is the rational:

```text
time_seconds = g / 35
numerator    = g * 1000000000
denominator  = 35
D            = denominator * ZEQOND_NS

zeqond_at_tic(g) = floor(numerator / D)
phase64_at_tic(g) = floor((numerator mod D) * TWO64 / D)
```

Implementations MUST use this direct rational form. They MUST NOT floor each Doom tic to whole nanoseconds and then accumulate the rounded values. Intermediate products require checked wide arithmetic.

Wall-clock time may drive menus, telemetry batching, and presentation, but MUST NOT alter deterministic gameplay. A headless driver's outer scheduler MAY run at 20 Hz while executing the exact required number of 35 Hz Doom tics.

### 3.4 Genesis and monotonic clocks

A machine clock counts elapsed monotonic nanoseconds from a recorded genesis. It does not use a jumpable wall clock for ordering. Re-anchoring creates a new clock identity and MUST NOT rewrite existing records. Before genesis, elapsed machine time is zero. Universal Unix-grid time and genesis-relative machine time are distinct fields and MUST NOT be interchanged.

## 4. Canonical data and arithmetic

### 4.1 Canonical JSON

Signed, hashed, exported, and networked payloads use UTF-8 JSON canonicalized with RFC 8785 (JCS), with these additional restrictions:

- protocol quantities are decimal strings, not JSON floating-point numbers;
- unsigned integers match `0|[1-9][0-9]*`; signed integers add an optional leading `-` and disallow `-0`;
- fixed-point values are decimal strings containing raw integer units, with the scale named by the schema;
- hashes and binary keys are lowercase hexadecimal unless a schema explicitly names base64;
- human-readable text is Unicode NFC;
- duplicate keys, invalid UTF-8, fields excluded by a closed schema, NaN, infinity, exponents, and non-integer numeric encodings are rejected;
- array order is semantic and MUST NOT be sorted during canonicalization;
- JSON-RPC request IDs are strings.

JSON-RPC transport envelopes are not signed unless a method explicitly includes them. Signature coverage always includes the signed object's `format` and complete declared body and always excludes the `signature` field itself.

### 4.2 Integer and fixed-point rules

Doom's existing signed 16.16 `fixed_t` remains the engine representation. Zeq calculations use checked integers or rationals and convert at explicit boundaries.

- Overflow, division by zero, invalid scale conversion, and out-of-range values fail closed; wrapping is not a valid Zeq calculation.
- `floor_div` and Euclidean remainder are defined for signed inputs.
- Phase and Q64 conversion round downward by definition.
- Multiplication of two Q30 values uses a signed wide intermediate, round-to-nearest with ties-to-even, then a Q30 result.
- Conversion to Doom 16.16 uses round-to-nearest with ties-to-even unless a named vanilla operation requires Doom's original truncation. Vanilla paths remain byte-for-byte unchanged.
- Rounding residuals used in impulse accounting are signed integers and are recorded when the event schema requires them.

### 4.3 Deterministic sine and square root

Host `sin`, `cos`, `sqrt`, and floating-point arithmetic MUST NOT determine cross-platform game state.

`zeq-time-v1` defines a committed 4097-entry sine table at phases `i/4096`, including the repeated endpoint. Entries are signed Q30 values generated once using high-precision arithmetic and round-to-nearest, ties-to-even. Runtime sine uses the table and linear interpolation with the low 52 phase bits and wide integer intermediates. Cosine uses a quarter-cycle phase shift.

```text
sin_q30(phi64) = deterministic_table_interpolation(phi64)
cos_q30(phi64) = sin_q30(phi64 + 2^62 mod 2^64)
lapse2_q30     = 2^30 - round_ties_even(129 * sin_q30(phi64) / 100000)
lapse_q30      = floor_sqrt(lapse2_q30 << 30)
R_q30          = 2^30 + round_ties_even(129 * sin_q30(phi64) / 100000)
PI_Q40         = 3454217652358
D_cycle_q40    = round_ties_even(-129 * PI_Q40 * cos_q30(phi64)
                                  / (100000 * lapse2_q30))
```

`PI_Q40` is `round(pi * 2^40)`. Both `R` and `N²` consume the same Q64 phase and Q30 sine. `D_cycle_q40` represents `D_cycle * 2^40`; its derivation cancels the Q30 cosine and lapse scales. All intermediate products and divisions use checked wide integers.

The table and integer square root are deterministic approximations, not exact rational evaluations of transcendental functions. Shared C, JavaScript, and Python vectors MUST cover table generation, interpolation, rounding, square root, overflow, and boundary phases.

## 5. Carrier and lapse model

For phase `phi` in Zeqond cycles:

```text
R(phi)       = 1 + ALPHA * sin(2*pi*phi)
N2(phi)      = 1 - ALPHA * sin(2*pi*phi)
N(phi)       = sqrt(N2(phi))
D_cycle(phi) = -ALPHA * pi * cos(2*pi*phi) / N2(phi)
```

`D_cycle` is `d ln N / d(phi)`. For time in seconds:

```text
d ln N / dt_seconds = D_cycle(phi) * F0
```

`R` is a display/stamp quantity. `N`, `N²`, and `D_cycle` are the lapse quantities. They are separate definitions and MUST NOT be substituted for one another.

On a static Doom background, the scalar mechanical analogue used for force-driven motion is written with coordinate time `t` measured in Zeqond cycles:

```text
dx/dt = u
du/dt = D_cycle(phi) * u + N2(phi) * F/m
```

There is no expanding-background `-3Hv` term in Doom. This is a model-dependent game adaptation of the framework equation, not a claim that Doom is a relativistic physical simulator.

One Doom tic has exact duration `h = 1000000000 / (35 * ZEQOND_NS)` Zeqonds. If `v_tic` is Doom momentum in map units per tic, then `u = v_tic / h`. If `A_tic` is the vanilla acceleration increment for one tic, then `A_t = A_tic / h²`. The Zeq midpoint step is:

```text
u_mid  = u_n + (h/2) * (D_n * u_n + N2_n * A_t_n)
u_next = u_n + h * (D_mid * u_mid + N2_mid * A_t_mid)
x_next = x_n + h * u_mid
v_tic_next = h * u_next
```

All conversions and evaluations use the checked rational/Q30/Q40 rules. `D_n` and `D_mid` use exact tic and half-tic phases; `N2` is evaluated at the same corresponding phases. Vanilla mode bypasses this integrator and retains the original Doom update exactly.

For Zeq rulesets, force and acceleration MUST be evaluated inside the integration step. A final position, velocity, thrust, damage value, or rendered number MUST NOT simply be multiplied by `R`. Collision detection and constraint response retain Doom's algorithms; the carrier does not modify map geometry.

For a stationary object with `v = 0` and `F = 0`, both acceleration terms are zero and the carrier MUST leave it unchanged bit for bit. With `ALPHA = 0`, `R = N = N² = 1` and `D_cycle = 0`, so the unmodulated equation is recovered.

## 6. Rulesets

### `doom-vanilla-v1`

- `ALPHA = 0` for gameplay;
- Zeq force terms, cooldown restrictions, arcade damage, and arcade movement bonuses are disabled;
- telemetry MAY observe but MUST NOT affect gameplay;
- stock demos and saves retain their original behavior and compatibility rules.

### `zeq-physics-v1`

- exact `777000777 ns` timebase;
- deterministic Q64/Q30 arithmetic;
- lapse terms integrated into force-driven movement;
- finite-interval kinetic impulses;
- exact Zeqond cooldown thresholds;
- no legacy phase-damage or legacy movement multiplier.

### `zeq-arcade-legacy-v1`

- preserves the existing approximately `0.777 s` and ±2.4% arcade behavior only for compatibility;
- MUST be labeled arcade/legacy in UI, saves, logs, and exports;
- MUST NOT be described as lapse physics or mixed into a `zeq-physics-v1` replay.

Cosmetic phase effects and optional arcade phase damage have independent feature flags. A run descriptor records the ruleset and every gameplay-affecting option. A replay MUST reject a mismatched ruleset rather than silently adapting it.

## 7. Kinetic impulses and cooldowns

### 7.1 Impulses

Impulse is momentum transfer:

```text
J = integral F dt
delta_p = J
```

The framework's half-sine reference, `J = 2*F_peak*tau/pi`, is the `ALPHA = 0` conformance vector; `F_peak` is peak force and is distinct from carrier frequency `F0`. It is not permission to multiply an instantaneous Doom knockback value by a carrier sample.

Damage and explosion kicks in `zeq-physics-v1` use `zeq-impulse-half-sine-v1` by default. For original base impulse `J_base` and interval `tau`, `F(t) = F_peak*sin(pi*t/tau)` with `F_peak = pi*J_base/(2*tau)`, so the unmodulated impulse integral equals `J_base`. The default interval is one Doom tic; any collision-shortened interval is explicit. Source, inflictor, target, start tic, start phase, mass, base impulse, interval, and rounding residual are recorded. The engine integrates the same velocity-dependent and `N²` force terms used for other motion. Contact/collision constraint impulses retain Doom's collision response and are not independently carrier-stamped.

Firing phase, projectile impact phase, and explosion-propagation phase are separate observations. A weapon event MUST NOT reuse the firing phase as the impact phase. The impulse log records the actual integration interval and the final fixed-point result; it does not claim that a single phase sample represents the integral.

### 7.2 Zeqond cooldowns

A cooldown has a ruleset-scoped identifier, start tic, positive rational duration in Zeqonds, and ready tic. For an integer duration of `k` Zeqonds starting at a Doom tic boundary:

```text
ready_tic = start_tic + ceil(k * 35 * ZEQOND_NS / 1000000000)
```

For a rational duration `k = n/d`, compute `ceil(n * 35 * ZEQOND_NS / (d * 1000000000))` with checked integers. Readiness is `gametic >= ready_tic`. This is the first Doom tic at or after the exact requested threshold; it does not round the threshold down.

Cooldown state is serialized in Zeq saves and canonical rollback state. Cooldowns do not restrict input in vanilla mode. HUD countdowns are informational and MUST NOT be the authoritative readiness check.

## 8. Engine integration boundaries

Phase 1 implements only time, arithmetic, schemas, and shared vectors. Later phases use these existing engine paths:

- `G_BuildTiccmd`: capture exact deterministic inputs after the command is built;
- `P_XYMovement`, `P_ZMovement`, and `P_MobjThinker`: integrate force, gravity, velocity, and momentum;
- `P_DamageMobj`: identify source, inflictor, target, base damage impulse, and event tic;
- `P_RadiusAttack`: integrate explosion impulses independently from weapon firing;
- `P_FireWeapon` and weapon readiness state: observe firing and enforce ruleset cooldowns;
- `p_saveg.c`: begin canonical serialization, while explicitly adding every omitted deterministic subsystem;
- `W_AddFile`: permit content only after manifest, trust, path, size, and digest verification.

No Phase 1 arithmetic change may silently activate new gameplay. Feature activation requires the ruleset and phase-specific acceptance tests.

## 9. Run, input, and canonical state

### 9.1 `zeq-run-v1`

A run descriptor contains:

```json
{
  "format": "zeq-run-v1",
  "run_id": "128-bit lowercase hex",
  "engine_commit": "40-character lowercase hex",
  "engine_build_sha256": "64-character lowercase hex",
  "wad_sha256": "64-character lowercase hex",
  "ruleset": "doom-vanilla-v1 | zeq-physics-v1 | zeq-arcade-legacy-v1",
  "compatibility": "integer string",
  "tick_rate": "35",
  "initial_rng": "integer string",
  "settings_sha256": "64-character lowercase hex",
  "time_origin": {"kind": "doom-tic", "gametic": "0"}
}
```

Additional gameplay-affecting fields MUST be included in canonical `settings_sha256` content. Build identity and WAD identity are provenance, not evidence that runtime memory was uncompromised.

### 9.2 `zeq-input-v1`

One record per player and simulation tic captures the actual `ticcmd_t` values used by the engine:

```text
format, run_id, player, gametic,
forwardmove, sidemove, angleturn, chatchar, buttons, consistancy,
buttons2, inventory, lookfly, arti
```

Signed fields use signed decimal strings; byte fields use unsigned decimal strings. Capture occurs at `G_BuildTiccmd` or the equivalent actual-input boundary, not from raw keyboard events. Playback consumes these records without reading local devices. Hashes cover the canonical record; input compression MUST be deterministic and lossless.

The current binary record is exactly 24 bytes: `ZEQI` at 0, little-endian `uint32 gametic` at 4, signed forward/side bytes at 8/9, little-endian signed `int16 angleturn` at 10, chat/buttons/consistancy/buttons2 bytes at 12–15, little-endian signed `int32 inventory` at 16, lookfly/arti bytes at 20/21, and zero reserved bytes at 22/23. A fresh deployment uses a contiguous zero-based command origin. Native replay injects the complete command at `G_BuildTiccmd`; the original `RunTic` remains authoritative.

### 9.3 `zeq-doom-state-v1`

Canonical state is little-endian for fixed-width binary fields and canonical JSON for the outer descriptor. Integers have explicit signedness and width; pointers, padding, host byte order, uninitialized bytes, wall clocks, rendering caches, audio, HUD animation, and sidecar transport state are excluded.

Symbolic IDs replace host pointers and action addresses. The current serializer normalizes mobj traversal stamps, the prediction-history-only `ticcmd_t.consistancy` diagnostic, mobj sector/blockmap links (`snext`, `sprev`, `bnext`, `bprev`), and the renderer/automap-owned `ML_MAPPED` bit while retaining gameplay line flags; ordinary save/load and rollback snapshots keep the original fields. Thinker-list links and exact mixed mobj/special order are not normalized away. Cosmetic screen wipes use a separate deterministic display RNG stream and MUST NOT advance the gameplay `rndindex`. Browser and native checkpoints are compared at equal completed-tic counts from the same exported input artifact.

Serialization MUST cover every gameplay-relevant subsystem, including:

- level/map identity, level time, completed flags, and total time;
- players, weapons, pending weapons, ammo, armor, powers, cards, cheats, and player timers;
- all thinkers and mobj types in deterministic order, including momentum, targets, thresholds, states, tics, flags, health, and spawn data;
- projectiles, explosion state, item respawn state, and removed-object ordering where it affects future allocation;
- sectors, lines, specials, switches, doors, lifts, floors, ceilings, lights, plats, and active special lists;
- RNG indices and every other random/stateful gameplay source;
- demo/input position, game state, episode/map/skill, deathmatch flags, and netgame-relevant ordering;
- Zeq ruleset, cooldowns, integrator residuals, and pending finite-interval impulses.

A save-game byte dump is not automatically a canonical state. `p_saveg.c` is a starting point, and conformance tests MUST demonstrate that restoring the state reproduces future tics.

### 9.4 `zeq-state-hash-v1`

```json
{
  "format": "zeq-state-hash-v1",
  "run_id": "128-bit lowercase hex",
  "gametic": "integer string",
  "state_format": "zeq-doom-state-v1",
  "state_sha256": "64-character lowercase hex",
  "previous_state_sha256": "64-character lowercase hex or null"
}
```

`state_sha256` is SHA-256 over the exact canonical state bytes. The optional previous hash chains checkpoints; it does not make the state correct. State hashes may be recorded every tic for short runs and at declared checkpoints for long runs. A checkpoint interval is part of the run evidence.

## 10. Events, snapshots, and sidecar wire

### 10.1 `zeq-event-v2`

Every event body contains:

```text
format, session_id, sequence, run_id, gametic,
zeqond, phase64, ruleset, kind, payload, previous_record_sha256
```

`record_sha256 = SHA256(JCS(body_without_record_sha256))`. The stored record adds `record_sha256`. Sequence starts at zero and increases by one within a session. The first previous hash is null; subsequent records use the preceding record hash. Event payloads have versioned per-kind schemas and reject unknown required fields.

Initial kinds are `session-open`, `session-close`, `level-enter`, `level-exit`, `weapon-fired`, `projectile-impact`, `impulse-integrated`, `cooldown-started`, `cooldown-ready`, `capsule-saved`, `state-checkpoint`, and `engine-diagnostic`. Legacy numeric type IDs are not reused as v2 semantics.

### 10.2 `zeq-snapshot-v2`

Snapshots contain `format`, `session_id`, `sequence`, `run_id`, `gametic`, `zeqond`, `phase64`, `ruleset`, `map`, and a versioned `player` object. Raw fixed-point positions, angles, momentum, health, armor, ammo, weapon, and cooldown state use integer strings.

A snapshot is sampled telemetry. It is not a complete canonical state, MUST NOT be used for rollback, and MUST NOT be presented as a state-hash proof. Browser snapshots are throttled; event delivery and game simulation MUST NOT depend on snapshot frequency.

### 10.3 `zeq-wire-v1`

Transport is JSON-RPC 2.0 over WebSocket at `ws://127.0.0.1:7770/zeq` by default. Loopback is the default, not a claim of authentication. Native hosts MAY use a local IPC adapter with identical method semantics.

Methods:

- `zeq.hello`: negotiate `zeq-wire-v1`, accepted record formats, client, game, and run identity;
- `zeq.event`: append one canonical event;
- `zeq.snapshot`: submit telemetry without blocking the game;
- `zeq.verify`: verify an explicitly selected local proof/log;
- `zeq.export`: export the selected session in `zeq-proof-v1` or `zeq-proof-v2`.

Requests use string IDs. Notifications have no ID and cannot receive responses. The browser queue is bounded, drop counts are reported, reconnect backoff is required, and no queue operation may block Doom. The sidecar mirrors telemetry; it is not a required gameplay service.

A later native C-to-Node connection MUST use the same versioned messages. A browser/WASM engine emits through its host bridge because browser raw TCP sockets are unavailable.

## 11. Proof, replay, and signed logs

### 11.1 `zeq-proof-v2`

A proof export contains:

```text
format, run, session_id, created_zeqond, events,
input_records_or_digest, state_hashes, checkpoint_interval,
chain_head_sha256, attestations, replay
```

`replay.status` is one of `not-run`, `match`, `mismatch`, or `unavailable`. A `match` requires a headless replay of the supplied inputs under the identified engine build, WAD, ruleset, settings, and initial RNG, with all compared state hashes equal. Missing inputs or incomplete state serialization cannot produce `match`.

Each attestation has `format = zeq-attestation-v1`, `reviewer_zid`, `reviewer_public_key`, `proof_chain_head_sha256`, `run_id`, `replay_status`, and `signature`. Ed25519 signs the canonical object excluding `signature`. An attestation is a reviewer's statement about the referenced result, not independent proof that the result is legitimate.

The verifier checks canonical encoding, schema versions, sequence continuity, event hashes, chain links, signatures when present, input hashes, and replay results. It reports the first failing record and exits nonzero. Legacy `zeq-proof-v1` verification remains available and keeps its original limited meaning.

### 11.2 Signed records and append-only logs

An unsigned hash chain detects post hoc edits that do not recompute a consistent replacement chain. It does not identify an author. A `signed` v2 log additionally uses Ed25519 over the canonical record body and binds the verifying key to an explicitly trusted machine record.

Signatures and trust anchors are separate: a self-signed record is self-consistent, not automatically trusted. Private seeds and signing keys never enter Doom, telemetry, exports, or logs.

The implementation may call its file an append-only hash-chained log. It MUST NOT claim physical WORM behavior on a rewritable filesystem. The standardized local integrity statement remains:

> Integrity of this local event chain only; not proof of competitive legitimacy.

A deterministic replay statement MAY say only that supplied inputs reproduced recorded states under the identified engine/WAD/ruleset and that no log edits were detected by the performed checks.

## 12. Sovereign saves and ZEQC3

### 12.1 Container

New save capsules use the framework's binary layout exactly:

```text
ZEQC3 [salt 16][iv 12][ciphertext][tag 16]
```

Key derivation is scrypt with `N = 2^17`, `r = 8`, `p = 1`, and `dklen = 32`. The scrypt salt is the UTF-8 bytes of the exact legacy HITE domain string `HULYAS.HITE.f=1.287Hz.tau=0.777s` followed by the 16-byte capsule salt. The HITE string is a compatibility constant, not a redefinition of the exact Zeqond.

Encryption is AES-256-GCM. The AAD is `ZEQC3 || salt`; the IV is 12 fresh cryptographically random bytes and the tag is 16 bytes. Implementations must permit the reference KDF memory requirements and MUST NOT silently lower the work factor. ZEQC2 and legacy `N = 2^15` capsules MAY be opened for migration and MUST be resealed to current ZEQC3 parameters before being labeled current.

### 12.2 `zeq-doom-save-v1` plaintext

The authenticated plaintext is canonical JSON containing:

```text
format, run, machine_zid, created_zeqond, created_phase64,
save_encoding, save_bytes, save_data, zeq_state
```

`save_encoding` is `doom-save-le-v1`; `save_data` is RFC 4648 base64 with canonical padding and no whitespace; `save_bytes` is its decoded length as an integer string. `zeq_state` includes cooldowns, finite-interval impulses, ruleset state, and arithmetic residuals not present in a vanilla save. Because these fields are inside AES-GCM plaintext, their integrity is authenticated without changing ZEQC3's external AAD.

A Doom save is not a machine credential capsule and MUST NOT contain the machine equation, seed, private key, or PIN. A machine capsule's `ZEQ-CAPSULE-v3` plaintext remains distinct from `zeq-doom-save-v1`.

New PINs follow the framework policy: at least eight characters, not digits alone, and at least four distinct characters. Legacy capsules may still be opened under their existing PIN. Browser scrypt runs in a Worker and does not block rendering or Doom. PINs never enter the C engine, telemetry, RPC messages, logs, or proof exports. Wrong PINs, modified bytes, truncation, unsupported versions, and resource-limit failures all fail closed with no partially written save.

## 13. Signed mods

### 13.1 `zeq-mod-manifest-v1`

The signed body contains:

```text
format, mod_id, mod_version, name, engine_api,
rulesets, dependencies, files, signer_zid, signer_public_key
```

Each `files` entry contains `path`, `sha256`, and `bytes`. The Ed25519 signature covers the canonical body excluding `signature`. A verifier checks the signature and binds the signer key to an explicitly trusted machine/publisher record. Signature verification without a trust decision does not authorize loading.

### 13.2 Loader boundary

Every file digest and size MUST be verified before `W_AddFile` receives it. Verification and loading MUST use the same immutable byte sequence or an equivalent descriptor-based mechanism that prevents time-of-check/time-of-use replacement.

Paths are relative UTF-8/NFC, use `/`, and MUST NOT contain empty components, `.`, `..`, backslashes, drive prefixes, absolute roots, NUL, or symlink escapes. Initial limits are 1 MiB per manifest, 1024 files, 64 MiB per file, and 256 MiB total declared content.

The implemented content layer accepts either one PWAD or a `zeq-pk3-v1` package. Generic manifest/package limits are 1 MiB per manifest, 1024 entries, 64 MiB per file, and 256 MiB total actual uncompressed content. The Doom host further restricts an accepted package to one through sixteen `.wad` files. PK3 entries MUST be regular files using ZIP method 0 (stored) or 8 (deflated); directories, symbolic links/other non-regular Unix types, encryption, unsupported flags/methods, and nested `.pk3`/`.zip` archives are refused.

The bounded ZIP reader checks EOCD and central-directory extents, local/central names, declared and actual sizes, CRC-32, truncation, and trailing bytes. Deflated output is bounded while decompressing, not merely by trusting the declared size. Unsafe, absolute, duplicate, case-ambiguous, or non-NFC paths are refused. No archive entry is extracted to a filesystem. Manifest array order—not ZIP entry order—is the Doom PWAD load order, and the manifest file set must exactly match the package file set.

A valid signature proves possession of a signing key for the manifest. It does not prove that a mod is safe, compatible, or appropriate to trust.

### 13.3 Implemented scoped PWAD/PK3 reference-host profile

The current browser reference host accepts one `.wad` file or a bounded `.pk3` containing one through sixteen PWADs per manifest. It requires `engine_api = "doomgeneric-zeq-v1"`, an empty dependency list, and declaration of the active ruleset. Other manifests are refused before the engine handoff. This is not general PK3 lump/content semantics, dependency resolution, arbitrary code loading, or network-session content negotiation.

The SDK verifies the canonical Ed25519 signature, the user's explicit publisher-key trust decision, declared sizes, file SHA-256 digests, and package structure before the engine handoff. For a multi-PWAD package, every file first passes `ZEQ_ValidateVerifiedWad` in non-committing C validation mode. Only after the entire batch passes does the browser call `ZEQ_LoadVerifiedWad` in manifest order. This prevents a known malformed later file from causing an avoidable partial load; an unexpected allocation/engine failure during final append is not claimed to be transactional rollback.

For each PWAD, the engine copies the input before hashing or parsing, independently recomputes SHA-256 in C, and validates the `PWAD` signature, directory extent, and every lump position/size range. At most 64 MiB and 65536 lumps are accepted per PWAD by this adapter.

`W_AddMemoryFile` takes ownership of each verified allocation and installs it in Doom's ordinary lump directory. Its memory-backed `Read` implementation checks every offset/length against the immutable buffer; no pathname is reopened and no subsequent lump read uses the caller's temporary WASM allocation. The ordinary path-based `W_AddFile` behavior remains available for the base game.

Each attempt produces `zeq-content-load-evidence-v1` with schema version, status, explicit trust, active ruleset and compatibility, digest-verification result, mod ID/version, publisher key ID, package format, file count, manifest load order, current file index, content SHA-256, accepted WAD lump count, and total engine lump count where applicable. Browser records include this evidence in the signed local event chain. A load result does not change replay status: telemetry-only proofs remain `unavailable` unless actual reproduction is supplied.

The integration gate loads a real conformance-only marker PWAD and a two-PWAD PK3 through the visible form, reads exact bytes back through `W_ReadLump`, verifies that reversed ZIP order still follows manifest order, and checks ledger/proof consistency and continued gameplay. A signed batch with a malformed second PWAD is refused during prevalidation without installing its valid first PWAD. Wrong publisher trust, modified bytes, incompatible rulesets, malformed directories, an independent C digest mismatch, and duplicate loads fail closed with no unintended marker-lump installation.

## 14. Encrypted parcels

`ZEQ-PARCEL-v2` is the Doom profile of the framework's sealed-box construction. It deliberately adds mandatory expiry and replay semantics; it MUST NOT be passed to a v1-only verifier as though it were v1.

The signed body contains:

```text
format, from, to, name, bytes, expires_zeqond, box
```

`from` is a verifiable machine genesis record. `to` is the recipient ZID. `name` matches `[A-Za-z0-9][A-Za-z0-9._ -]{0,127}`. `bytes` is an integer string from zero through 1048576. `expires_zeqond` is an unsigned integer string.

The authenticated box header is:

```json
{
  "expires_zeqond": "integer string",
  "from": "sender ZID",
  "name": "parcel name",
  "to": "recipient ZID"
}
```

The box contains `eph_pub`, `nonce`, `tag`, `ct`, `header`, and `zeqond`. It uses ephemeral-static X25519, rejects small-order/all-zero shared secrets, derives a 32-byte key with HKDF-SHA256 using salt `zeq-e2ee-v1` and info `eph_pub || recipient_pub`, and encrypts with AES-256-GCM. AAD is exactly:

```text
"box:v1|" || eph_pub || "|" || decimal(zeqond) || "|" || canonical_header
```

The sender signs the canonical parcel body with Ed25519. Before accepting content, the recipient MUST verify the recipient ZID, sender record, signature, header, expiry, size, box authentication, and replay status. `expires_zeqond` must be greater than or equal to the sealing `box.zeqond`; a sealing tick more than 64 Zeqonds ahead of the recipient's monotonic machine tick is rejected. `parcel_id = SHA256(JCS(complete_parcel))`; `(recipient_zid, parcel_id)` is retained at least through expiry and rejected on repetition. Expired parcels, out-of-window future ticks, wrong recipients, modified headers, wrong keys, and tag failures open to nothing.

The inbox limit is 1000 parcels and 64 MiB total serialized parcel data. No parcel is automatically executed or loaded as a mod. A parcel containing a mod must subsequently pass the independent signed-manifest and loader checks.

## 15. Deterministic networking and rollback

### 15.1 Implemented scope and identity

`zeq-doom-net-v1` is implemented in the native headless reference host. Two separate real Doom processes communicate over TCP; the listener is player 0 and the connector is player 1. `ZEQ_NET_LISTEN` and `ZEQ_NET_CONNECT` are mutually exclusive. `ZEQ_NET_SESSION`, falling back to `ZEQ_RUN_ID`, supplies the 128-bit lowercase hexadecimal session ID. `split64` supplies timestamps only: authoritative simulation order is `(gametic, player_id)`, never arrival time or wall-clock phase.

The canonical `zeq-net-session-v1` descriptor contains exactly:

```text
format, protocol, engine_api, engine_build, wad_sha256, content_sha256,
ruleset, episode, map, skill, settings_sha256, tick_rate, initial_rng,
session_id
```

`protocol` is `zeq-doom-net-v1`; integer fields are canonical decimal strings. `descriptor_sha256 = SHA256(JCS(descriptor))`. The current profile fixes fresh E1M1, zero-based skill 2 (command-line skill 3), tick rate 35, initial RNG 0, cooperative settings, and the identified unmodified shareware WAD. The peers refuse different session IDs or descriptor digests before gameplay checkpoints. These checks establish matching declared identity/settings, not human identity, remote attestation, or proof that either binary is honest.

### 15.2 Binary transport

The listener binds `127.0.0.1` by default. `ZEQ_NET_BIND=<numeric local IPv4>` explicitly selects a local listener interface and is valid only with `ZEQ_NET_LISTEN`; malformed addresses and `0.0.0.0` are refused. The connector accepts an IPv4 `host:port` endpoint through `ZEQ_NET_CONNECT`. The initial hello is exactly 60 bytes:

```text
0..7    ZEQNET6\0
8..9    little-endian uint16 protocol version = 1
10      player count = 2
11      assigned player = 0 or 1
12..27  raw 16-byte session ID
28..59  raw 32-byte descriptor SHA-256
```

Subsequent frames have a five-byte header: ASCII `ZN`, one-byte type, and little-endian `uint16` body length. Bodies are limited to 128 bytes and the receive buffer to 8192 bytes. Defined frames are:

| Type | Body length | Meaning |
|---:|---:|---|
| 1 | 19 | player byte, little-endian zero-based `uint32` tic, then the 14-byte complete `ticcmd_t` payload |
| 2 | 68 | little-endian one-based completed-tic count, then 64 lowercase ASCII hexadecimal SHA-256 bytes |
| 3 | 4 | little-endian `uint32` final tic count for clean completion |

The command payload is signed forward/side bytes, little-endian signed 16-bit angle turn, chat/buttons/consistancy/buttons2 bytes, little-endian signed 32-bit inventory, lookfly, and arti. Every command is authoritative for its sender only. Duplicate identical commands are idempotent; conflicting duplicates, invalid player/tic ranges, `BT_SPECIAL`, bad magic, wrong lengths, and oversized frames terminate with a structured network error. No frame carries executable content, a pathname, a secret, or arbitrary process memory.

This profile does not implement encryption, TLS, signed peer authentication, matchmaking, NAT traversal, relays, UDP, or browser raw sockets. TCP head-of-line blocking remains. Explicit non-loopback binding permits direct private-LAN TCP between machines that can route to the selected address; it does not make a hostile LAN safe. A test proxy can provide genuine transport impairment but does not turn the profile into a secure Internet service. Any such additions require separately versioned and tested protocols.

### 15.3 Prediction, acknowledgement, and rollback

Each process predicts at most 8 tics beyond its confirmed frontier. The command/snapshot window is 32 tics and each snapshot buffer is 262144 bytes. A missing remote command repeats the latest available remote simulation command with chat and special-command bits cleared, or zero if no earlier command exists. Local commands are never predicted from the remote peer.

A tic becomes confirmed only after both players' authoritative commands exist and the corrected state has been executed. Confirmed checkpoints use `zeq-state-hash-v1`, add `protocol`, `player`, and `confirmed: true`, and chain `previous_state_sha256`. The one-based wire hash tic corresponds to the zero-based executed command at `tic - 1`.

Prediction cannot advance beyond `peer_confirmed + 32`. Received peer checkpoint hashes act as confirmation acknowledgements. Rate-limited retransmission covers every local command not acknowledged by both local and peer confirmation, beginning at `min(local_confirmed, peer_confirmed)`; a recent-16-only range is not sufficient under sustained loss.

When a late remote simulation command differs from the prediction, the engine restores that tic's actual pre-tic snapshot and resimulates through the former predicted frontier. Snapshot restore uses Doom's real save unarchive functions plus explicit gameplay globals, Zeq save-extension state, stable symbolic target/tracer/attacker/body/brain/sound pointers, mobj `floorz`/`ceilingz`, exact mixed thinker order, and Zeq combat counters. Rollback after tic 0 must reproduce the preceding post-tic canonical hash before resimulation. Prediction-dependent `consistancy` diagnostics are excluded from misprediction comparison, rebound from restored Doom state before `RunTic`, and normalized only in canonical serialization; duplicate-frame identity still compares the complete original command.

Predicted and rolled-back engine events and impulse records are drained rather than appended to confirmed evidence. Only confirmed tics enter the network checkpoint chain. Rendering or interpolation MUST NOT feed back into simulation.

Peers compare confirmed canonical hashes whether the remote hash arrives before or after the local checkpoint. A mismatch emits `net-desync` with the completed tic and both hashes and stops with `canonical-hash-mismatch`. This is a desync diagnostic, not proof of cheating. Split64 time, a hash chain, or signed events alone do not provide determinism or rollback.

### 15.4 Current limits and acceptance

The implemented acceptance harness launches two actual native engines and checks 140 direct tics, 140 explicit non-loopback LAN-interface tics on one test host, plus 180 tics through a real TCP proxy with delay, jitter, loss, and duplicates. It requires identical linked confirmed hashes, genuine rollback/misprediction/resimulation, clean completion, descriptor/descriptor-digest agreement, and clean single-player regressions. Negative gates cover descriptor/session mismatch, protocol/player mismatch, malformed input, conflicting commands, bad magic, oversized frames, malformed/wildcard bind addresses, and deliberate hash corruption in both directions. The LAN case is genuine non-loopback TCP but is not evidence of a physical two-machine private-Wi-Fi run.

Current non-goals are browser multiplayer, more than two players, other maps or arbitrary initial saves, mid-game join, `BT_SPECIAL`, multi-file/PK3 session content, and production Internet security. Longer soak/fuzz/resource/performance testing and broader scenario coverage remain Phase 8 work. No competitive-legitimacy claim follows.

## 16. Headless mode and MCP

The headless target runs the real C engine without rendering or audio. It accepts `zeq-run-v1` and `zeq-input-v1`, emits `zeq-state-hash-v1`, and exports `zeq-proof-v2`. Doom simulation remains 35 Hz even if an outer automation scheduler polls at 20 Hz.

`zeq-mcp-v1` uses local JSON-RPC over stdio with methods:

```text
zeq.run.start
zeq.run.stop
zeq.run.status
zeq.input.inject
zeq.state.read
zeq.proof.export
zeq.verify
```

Every method validates paths, sizes, run ownership, and lifecycle state. The interface never accepts a PIN, machine equation, private seed, or private key as a tool argument. `zeq.state.read` returns declared canonical state or a digest, not arbitrary process memory. Automation availability is not evidence of a bot's competitive legitimacy.

## 17. Conformance and negative tests

Phase gates require shared C, JavaScript, and Python vectors plus engine-level tests.

### Time and arithmetic

- `ns = 0`, `ZEQOND_NS - 1`, `ZEQOND_NS`, `10^12`, and signed `ns = -1` tick/phase vectors;
- 4000 split64 pseudorandom vectors from the framework reference;
- Doom tic boundaries, half-tics, whole Zeqonds, and long-run no-drift checks;
- Q30 table generation, interpolation, signed rounding, square root, overflow, and rejection vectors;
- bit-identical C/JS/Python results with no host-libm dependency.

### Physics

- `ALPHA = 0` reduces exactly to the unmodulated equation and vanilla replay states;
- a stationary zero-force object remains bit-for-bit unchanged;
- `<N²> = 1` under the declared high-precision reference quadrature and `ln N(1) - ln N(0) = 0`;
- the autonomous oscillator agrees with its proper-time reference within published fixed-point tolerances;
- the half-sine impulse matches `2*F_peak*tau/pi` at `ALPHA = 0` within the declared integration tolerance;
- a final-value `R` stamp fails the negative test and cannot be labeled lapse dynamics;
- firing, impact, and explosion events use distinct actual phases.

### Saves and logs

- ZEQC3 standard vectors, wrong PIN, weak-new-PIN refusal, tamper, truncation, legacy migration, and resource limits;
- no PIN/private key in engine memory input, telemetry, logs, or exported proofs;
- clean JSONL/proof verification and deliberate record/hash/signature/sequence tamper detection;
- replay `match` only after actual headless reproduction; omitted inputs produce `unavailable`, not success.

### Mods and parcels

- bad signature, untrusted signer, changed file, size mismatch, path traversal, symlink, duplicate lump, decompression bomb, and TOCTOU tests;
- wrong recipient, small-order key, changed header, changed Zeqond, expiry, replay, ciphertext/tag tamper, and inbox exhaustion tests;
- no content reaches `W_AddFile` before all applicable checks pass.

### Networking and rollback

- delayed, duplicated, reordered, and missing input tests;
- rollback restores every deterministic subsystem and reproduces the same state hashes;
- an injected one-byte deterministic state change produces a desync at the first affected checkpoint;
- transport loss does not change Doom's 35 Hz simulation or invent remote inputs.

## 18. Current reference implementation status

| Capability | Status |
|---|---|
| Real doomgeneric engine and shareware gameplay | Implemented and exercised in the WASM build |
| Optional browser/Node telemetry bridge | Implemented with signed v2 records; sidecar remains optional |
| Local hash-chain and offline tamper detection | Implemented with Ed25519 signatures and explicit trust status; limited integrity scope |
| Exact time, split64, shared rational vectors | Phase 1 implemented; native/reference suites and live same-tic browser comparison pass |
| Lapse physics | Phase 2 implemented in real mobj X/Y/Z movement under `zeq-physics-v1`; Doom collision and friction remain authoritative |
| Finite impulses | Phase 2 implemented in actual damage and radius-attack paths; 32 deterministic substeps; diagnostics remain outside the event hash chain |
| Exact cooldowns | Phase 2 implemented and enforced in `P_FireWeapon`; per-weapon Doom cadence converted to exact ready tics |
| Ruleset boundaries | Vanilla, Physics, and Legacy implemented; pending selection applies at deployment and saves restore their ruleset |
| Versioned Doom saves | Extension v2 implemented with old-save compatibility and original mobj records unchanged; sealed browser capsules use real ZEQC3 |
| Existing carrier movement/damage | Available only as explicitly labeled `zeq-arcade-legacy-v1` behavior |
| Browser input lifecycle | Reference-counted keyboard/touch holds; release, cancellation, lost capture, blur, page exit, and visibility cleanup implemented and exercised |
| Signed logs and proof verification | Phase 3 implemented and tested; telemetry-only browser/sidecar proofs keep replay unavailable unless real reproduction is supplied |
| ZEQC3 Doom saves | Phase 3 implemented; independent Python/JavaScript vectors, browser Worker, and fail-closed negative tests |
| Actual ticcmd capture/playback | Phase 4 implemented: final G_BuildTiccmd commands use bounded loss-visible capture; headless G_BuildTiccmd injects complete records |
| Canonical state checkpoints | Phase 4 native implementation tested through P_Archive* with deterministic pointer/action IDs, omitted gameplay globals, and SHA-256 known-answer tests |
| Replay comparison and proof | Phase 4 native implementation tested: second-process match, altered-input mismatch, tamper refusal, and third-run signed-proof verification; fresh E1M1 scope |
| Headless MCP | Phase 4 local stdio implementation tested: seven methods, lifecycle, live input, read-only defaults, and secret rejection |
| Browser/WASM replay identity | Phase 4 implemented and tested with the real renderer enabled: exported browser ticcmd records replay in the native engine and equal-tic canonical SHA-256 checkpoints match; this establishes local replay consistency, not competitive legitimacy |
| Signed mod manifests and file verification | Phase 5 SDK milestone implemented and tested in Node/browser with independent Python vectors; explicit publisher trust required |
| Expiring encrypted parcels | Phase 5 SDK milestone implemented and tested: authenticated encryption, expiry, bounded inbox, and replay refusal; plaintext is never executed or auto-loaded |
| Signed PWAD/PK3 loader | Phase 5 scoped reference profile implemented and tested: one PWAD or one to sixteen PWADs in bounded PK3, SDK authentication/trust, C-owned bytes, independent C SHA-256, structural checks, memory-backed reads, and evidence records |
| Multi-file order and batch safety | Implemented and tested: manifest order overrides ZIP order; whole-batch non-committing C validation precedes the first append; unexpected append-time allocation failure is not claimed to roll back |
| Native two-client netcode and rollback | Phase 6 reference profile implemented and tested: real TCP, complete commands, 8-tic prediction, bounded snapshots, retransmission, rollback/resimulation, matching confirmed hashes, refusal, and bidirectional desync detection |
| Explicit private-LAN interface binding | Implemented and tested on one host over non-loopback TCP with matching hashes; malformed/wildcard binds refused; no physical two-machine Wi-Fi result |
| Browser or secure public multiplayer | Pending: no browser transport, signed peer authentication, encryption/TLS, matchmaking, mid-game join, or more-than-two-player profile |
| Deterministic pixel/occupancy primitives | Phase 7 bounded slice implemented and tested with byte-identical native C, JavaScript BigInt, and WASM fixed-scene results; separate frame/occupancy hashes |
| Doom strict visual and texture profiles | Implemented and locally tested: checked texture/patch/flat/palette/colormap bounds plus final-indexed-frame `zeq-doom-visual-v1` commitments after palette, colormap, fuzz, translucency, HUD, and menus; Doom remains the display renderer and visual hashes are not gameplay proof |
| Portable quantities, scientific numerics, experiments, and lifecycle | Implemented and locally tested in engine-neutral JavaScript profiles; Float64 numerics are nonauthoritative, external-machine reproduction is open, and lifecycle records do not execute or sandbox code |
| Second non-Doom chamber and domain pack | Implemented and locally tested across C99/JavaScript/Python with exact canonical state/replay, differential/property tests, experiment reproduction, and synthetic provenance; no calibrated physical-accuracy claim |

## 19. Phase 0 privacy and claim review

The exposure audit covered all ten public Zeq commits and 22 unique historical blobs. No credentials, private keys, tokens, machine identities, private capsules, saves, sensitive filenames, or binary private artifacts were detected. Automated matches were manually classified as a public WAD checksum, a package URL, and filename references. This is a scoped source audit, not a guarantee that no sensitive value exists or that prior public exposure can be recalled.

Subsequent explicit authorization superseded the earlier push freeze for source delivery. Engine/reference-host source belongs in `hulyasmath/doomgeneric`; portable SDK source belongs in `hulyasmath/zeq-doomgeneric`; roadmap and integration documents are mirrored. Each uploaded file must be fetched back and compared with the exact local Git blob SHA. No repository deletion, history rewrite, visibility change, or claim that prior public exposure can be erased is authorized.

The upstream baseline remains `e257a09527062bfb986b6e5e0780839b6cbd5b71`. Large arithmetic vectors are regenerated by committed Python generators rather than treated as hand-written source. WADs, private capsules, keys, machine logs, and build outputs are excluded. The Phase 5 signed-content SDK and scoped single-PWAD/multi-PWAD-PK3 real-engine loader are implemented and locally tested; no parcel executes or automatically loads content. The Phase 6 native two-process reference profile is implemented and tested, including one-host explicit non-loopback TCP and a 2,000-tic impaired soak; physical two-machine Wi-Fi, browser networking, and production transport security remain future work. Phase 7 includes the tested portable pixel/occupancy profiles, resource validation, and scoped real-host visual commitments, not a Doom renderer replacement. Portable Phase 9–13 modules and the second non-Doom chamber are locally implemented/tested as described in the portable-profile guide and conformance matrix; external-machine certification, physical accuracy, and arbitrary-host compatibility are not implied.

## 20. Optional `zeq-pixel-v1` raster primitives

The portable `sdk/zeq_pixel.c/.h` and `sdk/zeq-pixel.js` modules implement a bounded conformance slice, not a Doom renderer replacement. They have no Doom types and are not linked into the ordinary Vanilla, Zeq Physics, or Legacy gameplay paths. C requires C99 plus GCC/Clang checked 128-bit intermediates; JavaScript uses BigInt.

A surface has caller-owned storage, dimensions in `1..4096`, and at most 16777216 pixels. Each pixel stores `depth_q32`, `owner_id`, signed `layer_rank`, `claimed_mask`, and `rgba8`. Empty pixels serialize as depth `UINT32_MAX`, owner zero, layer `INT32_MAX`, zero claims, and zero color.

Writes require nonzero owner and claim mask and alpha 255. Lower depth wins, then lower layer rank, then lower owner ID. Repeating an identical ownership/depth key with the same color merges claims; repeating it with another color is refused. Occluded and invalid writes do not replace the pixel. Span/column operations use clipped half-open integer ranges derived from rational endpoints, return accepted-write counts, return zero for degenerate/off-screen work, and return `-1` for malformed or reversed ranges. They do not roll back earlier accepted writes if a later pixel reports a conflict.

Projection uses exact bounded rational arithmetic at 1/256-subpixel scale:

```text
x = width/2 + focal*x/z
y = height/2 - focal*y/z
```

`z` and `focal` must be positive. Input numerators and denominators are bounded by 1000000000, denominators are positive, outputs are reduced rationals, and overflow/invalid inputs are refused. Inside/outside status is against `[0,width) × [0,height)`.

Canonical serialization is little-endian and row-major. Both forms start with an eight-byte magic, little-endian `uint32` width, and little-endian `uint32` height:

- `ZEQFRM1\0`: four RGBA8 bytes per pixel, with the in-memory integer defined as `0xRRGGBBAA`;
- `ZEQOCC1\0`: sixteen bytes per pixel containing depth, owner, layer, and claims as little-endian 32-bit fields.

`node sdk/tests/test_pixel.js` compiles and runs the same `zeq-pixel-conformance-v1` scene as native C, JavaScript, and WASM, compares every byte and expected status, and repeats native/WASM runs. The 9×7 fixture currently produces 268 frame bytes with SHA-256 `afaf2f3df60e9d265ad30a4c7bbf24a99c6eb688dfd9230c63d8cb8181d523c6` and 1024 occupancy bytes with SHA-256 `9cdc18f75e76bd7bb2b790890b805f05fe9513747eb3c35ef7179e019e8f0d7b`. These are test-fixture commitments, not hashes of normal Doom frames.

The portable sweep additionally covers 1×1, 17×13, 127×63, and 320×200 surfaces with explicit time/storage observations. The separate `zeq-texture-validation-v1` and `zeq-doom-visual-v1` host profiles now validate Doom resources and commit the final indexed frame after palette, colormap, fuzz, translucency, HUD, and menu processing. These paths do not replace Doom's renderer or feed visual state back into gameplay. Visual evidence separately identifies renderer, resolution, palette, content, and settings. Pixel, occupancy, or visual hashes never substitute for canonical gameplay hashes or establish competitive legitimacy.

## 21. Private-LAN command example

After building the same native revision on two trusted machines, replace the example addresses with each host's actual numeric private-LAN IPv4 address. On listener/player 0 (`192.168.1.10` in this example):

```sh
cd doomgeneric
ZEQ_NET_SESSION=00112233445566778899aabbccddeeff \
ZEQ_NET_LISTEN=26000 ZEQ_NET_BIND=192.168.1.10 ZEQ_MAX_TIC=1400 \
./doomgeneric-headless
```

On connector/player 1:

```sh
cd doomgeneric
ZEQ_NET_SESSION=00112233445566778899aabbccddeeff \
ZEQ_NET_CONNECT=192.168.1.10:26000 ZEQ_MAX_TIC=1400 \
./doomgeneric-headless
```

Both machines need the same engine/content/settings identity. Local firewall policy must permit the chosen TCP port. This example is unauthenticated and unencrypted, and its two-machine operation remains a user-side validation step until such a run is actually tested and recorded.
