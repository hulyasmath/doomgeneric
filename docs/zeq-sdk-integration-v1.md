# Zeq SDK Third-Party Integration Guide v1

Audience: developers adding Zeq to an existing game or simulation
Status: current APIs are identified below; Phase 9–13 APIs are design targets, not shipped features

## 1. What the SDK is

The Zeq SDK is a set of optional modules for exact simulation time, deterministic fixed-point mechanics, replayable input/state evidence, signed local records, encrypted saves, verified content, and controlled automation. Doom is its first reference host. A third-party engine remains authoritative for its own simulation.

The SDK does not require a host to use Doom objects, a 35 Hz tick, a particular renderer, a particular entity model, a cloud account, or Zeq physics. Adopt only the modules needed by the application.

Current portable surfaces include:

- C99 exact time: `sdk/zeq_time.h` and `sdk/zeq_time.c`;
- C99 Doom-unit reference physics: `sdk/zeq_physics.h` and `sdk/zeq_physics.c`;
- cross-runtime JavaScript time/physics/ledger/bridge: `sdk/zeq-game-sdk.js`;
- signed records: `sdk/zeq-security.js`;
- ZEQC3 encrypted saves: `sdk/zeq-capsule.js`;
- signed content and sealed parcels: `sdk/zeq-content.js`;
- Doom replay/orchestration and local MCP: `sdk/zeq-replay.js` and `sdk/zeq-mcp.js`.

`sdk/zeq_plugin.h` is explicitly `0.1.1-legacy`. Its 1287/1000 carrier, 0.777 s Zeqond, and 24 permille pulse are compatibility approximations. New exact integrations must use `zeq-time-v1`, not this legacy header.

## 2. Choose an adoption profile before writing code

| Profile | Use | Authority and portability |
|---|---|---|
| `zeq-time-v1` | Exact Zeqond ticks, phase, lapse, stamps | Integer/rational/fixed-point; suitable for authoritative deterministic paths |
| `zeq-physics-v1` | Doom’s reference lapse integrator | Currently uses signed Doom 16.16 momentum units per tic; not a universal SI physics API |
| `zeq-arcade-legacy-v1` | Compatibility with the early arcade layer | Approximate legacy behavior; never mix with exact vectors |
| Vanilla host profile | Unmodified host mechanics | SDK may observe/replay without changing gameplay |
| Scientific numerical profile | Future Phase 9–10 analysis | Error-controlled, budgeted computation; not automatically bit-authoritative across hosts |
| Display/cosmetic profile | Future visual carrier or presentation | Must not feed authoritative state unless a separate ruleset explicitly does so |

Record the selected profile in every run descriptor. Never infer it from a UI label or assume that “Zeq enabled” uniquely identifies behavior.

## 3. Minimal host-adapter contract

The smallest useful integration has five boundaries. Names are illustrative host callbacks; they do not require a new engine framework.

```c
struct zeq_host_adapter {
    int32_t tick_rate;                 /* authoritative simulation rate */
    int64_t (*current_tick)(void *ctx); /* monotonic simulation tick */
    int (*read_input)(void *ctx, int64_t tick, void *command);
    int (*step_once)(void *ctx, const void *command);
    int (*canonical_state)(void *ctx, void *writer);
};
```

Requirements:

1. **Tick:** a monotonic integer count owned by the host simulation, not a rendered frame count.
2. **Input:** one complete authoritative command per simulation step, or an explicitly documented batching rule.
3. **Step:** exactly one authoritative state transition using the supplied command.
4. **State:** canonical serialization of every future-affecting field required by the chosen conformance level.
5. **Identity:** immutable engine/source/content/settings/ruleset descriptors for the run.

Do not call the SDK from multiple unsynchronized threads against mutable gameplay state. If the host is multithreaded, define a single simulation-owner thread or a deterministic message boundary. Worker completion order must not affect authoritative state.

## 4. Exact arithmetic rules

### 4.1 Constants and representations

```text
ZEQOND_NS = 777000777
ALPHA = 129 / 100000
Q30 = 1073741824
Q40 = 1099511627776
PI_Q40 = 3454217652358
TWO64 = 18446744073709551616
F0 = 1000000000 / 777000777       (exact rational)
TAU_Q = 777000777 / 1000000000    (seconds, exact rational)
```

Do not replace these with decimal floating-point approximations in protocol or gameplay code. Q64 phase is an unsigned 64-bit turn fraction: `0` is the cycle origin and `2^64` wraps to zero.

### 4.2 Convert host ticks to Zeq time

For integer host tick `g` and positive `tick_rate`:

```text
numerator = g × 1,000,000,000
denominator = tick_rate × 777,000,777
zeq_tick = floor(numerator / denominator)
phase64 = floor((numerator mod denominator) × 2^64 / denominator)
```

The multiplication for phase requires a 128-bit intermediate or an exactly equivalent arbitrary-precision integer operation. Check input ranges and overflow. Do not compute phase by first converting to `double`.

C:

```c
zeq_instant_t instant;
if (!ZEQ_TimeFromTic(gametic, tick_rate, &instant)) {
    /* Reject invalid input or overflow; do not substitute wall time. */
}
```

JavaScript uses `BigInt` for exact protocol arithmetic. Converting a large integer to `Number` before the calculation can lose precision and is forbidden in authoritative paths.

### 4.3 Rounding and failure

Use the rounding rule exported by the selected schema. `ZEQ_RoundDivI64` reports validity separately through `ok`; a zero return can be a valid numerical result, so never use the numerical value alone as an error signal. Other exact functions return zero on invalid input or overflow as documented in their headers.

Every host binding must define:

- signed versus unsigned interpretation;
- endianness at serialization boundaries;
- floor versus nearest rounding;
- behavior on negative values;
- overflow and division-by-zero handling;
- fixed-point scale and unit per host tick.

Do not silently clamp overflow into a plausible gameplay value.

### 4.4 Lapse and carrier

```text
R(t)  = 1 + α sin(2πφ)    display/stamp carrier
N²(t) = 1 − α sin(2πφ)    physical lapse
```

`ZEQ_LapseAt`, `ZEQ_SinQ30`, `ZEQ_CosQ30`, `ZEQ_CarrierQ30`, `ZEQ_Lapse2Q30`, `ZEQ_LapseQ30`, and `ZEQ_DlnCycleQ40` expose the exact reference calculations. The carrier is not an automatic movement-speed multiplier. Do not feed display-only values into canonical gameplay.

## 5. Adding physics without taking over the engine

The existing `zeq-physics-v1` API is intentionally narrow and Doom-specific in its units:

```c
zeq_step_t step;
int ok = ZEQ_IntegrateTic(
    gametic, tick_rate,
    velocity, acceleration, impulse,
    &step
);
```

Inputs use Doom 16.16 momentum units per tic. `ZEQ_IntegrateTicAlpha` permits explicit `substeps` and `alpha_num` for conformance/testing; `ZEQ_IntegrateTic` selects the reference defaults. The finite-interval impulse profile is `zeq-impulse-half-sine-v1`, with 32 reference substeps.

A non-Doom host must not copy these calls and assume its coordinates are compatible. It must either:

1. use the algorithm only after a formally specified unit/scale mapping and new profile name; or
2. implement the host-specific integrator against shared exact primitives and publish its own vectors.

The future unit/dimensional layer is Phase 9. Until it ships, integrators must document their dimensions and scales directly. Do not label arbitrary host values “SI” or “Zeqond units” without a conversion definition.

`ZEQ_CooldownReadyTic` returns the first ready host tic for an exact rational Zeqond duration. Store the scheduled ready tic in canonical state if future behavior depends on it.

## 6. Run identity and settings

Every run needs a stable descriptor containing at least:

```json
{
  "engine": "host-source-or-build-identity",
  "protocol": "host-protocol-version",
  "ruleset": "host-ruleset-version",
  "tick_rate": 60,
  "content": "canonical-content-identity",
  "settings": {},
  "seed": "explicit-seed-or-null"
}
```

The JSON above is explanatory, not a new universal schema. Use the versioned schema supplied by the selected SDK release. A descriptor must distinguish all settings that can change authoritative output, including difficulty, compatibility flags, numerical profile, map/scenario, mods, and initial state.

For Doom, command-line `-skill` is one-based (1–5), while the C enum and descriptors are zero-based (0–4). This conversion is a concrete example of why adapters must test boundary values rather than assume conventions match.

## 7. Input capture and replay

### 7.1 Capture complete commands

Capture after input devices, menus, bot policy, network ordering, and host-specific command assembly have produced the actual authoritative command, but before the simulation consumes it. Do not record raw keyboard events and assume they reconstruct gameplay.

A replay package identifies:

- exact command schema and byte layout;
- host tick and ordering rule;
- initial state/scenario and run identity;
- all content and settings identities;
- expected state checkpoints or final hash;
- replay status and actual reproduction evidence.

Doom’s `ZEQI` records are 24 bytes and are injected at `G_BuildTiccmd`. Another engine should define its own complete command structure rather than reuse Doom’s field meanings.

### 7.2 Canonical state

A canonical serializer must include future-affecting state and exclude presentation-only state. Typical authoritative fields include entities, velocities, timers, scheduler queues, gameplay RNG, triggers, scores, and pending commands. Typical exclusions include window size, audio buffers, cosmetic particles, wall-clock timestamps, and rendering caches.

Pointers and callback addresses are process-specific. Replace them with stable symbolic IDs and a versioned object/action table. Define entity traversal order explicitly. Normalize only fields proven not to affect future canonical state.

For Doom, replay canonicalization normalizes mobj `validcount`, omits global `validcount`, and masks `ML_MAPPED` only in canonical line serialization. Ordinary saves retain the original fields. Cosmetic wipe randomness uses a separate display RNG stream.

A hash is only as meaningful as its serializer and run identity. Publish canonicalization tests that mutate every included field and demonstrate a hash change, plus presentation-state mutations that demonstrate no gameplay-hash change.

### 7.3 Replay statuses and claims

Use only `not-run`, `match`, `mismatch`, or `unavailable` for replay reproduction status. A recorded hash without a rerun is not `match`. A live telemetry proof without reproduction remains `unavailable`.

## 8. Signed local evidence

`zeq-security.js` and the replay layer support canonical records, SHA-256 commitments, and Ed25519 signatures. Browser signing keys are nonextractable Web Crypto keys. Node’s private machine key remains only in the local protected sidecar.

The evidence scope must be stated exactly:

> Integrity of this local event chain only; not proof of competitive legitimacy.

Signatures do not prove that a publisher is trusted, that the executing binary was honest, or that inputs were produced by a human. Publisher trust is a separate explicit list/decision. Remote attestation and anti-cheat are not supplied by this module.

Keep secrets outside the host. Never include PINs, private keys, machine seeds, private save capsules, or credentials in commands, state snapshots, telemetry, RPC, logs, proof exports, or source archives.

## 9. Encrypted saves

ZEQC3 protects local save confidentiality and integrity with a PIN-derived key:

```text
ZEQC3 || salt[16] || iv[12] || ciphertext || authentication_tag[16]
KDF: scrypt N=2^17, r=8, p=1, dklen=32
Cipher: AES-256-GCM
AAD: ZEQC3 || salt
```

A PIN is a user secret, not simulation input. The host must never receive it through game commands or replay records. Use OS/user-session boundaries where available and document that a compromised host can capture user input.

Encrypted save support is not a canonical replay substitute. Replays require authoritative commands, initial state, and run identity.

## 10. Signed content and sealed parcels

### 10.1 Signed manifests

`zeq-mod-manifest-v1` binds publisher identity, relative file paths, sizes, and SHA-256 hashes. Verification checks canonical form, signature, limits, and file bytes. Current limits are 1 MiB manifest, 1024 files, 64 MiB/file, and 256 MiB total.

A valid signature is not publisher trust. A trusted manifest is not permission to execute native code. The host must separately decide which content types are allowed and how they are sandboxed.

The Doom reference host now implements and tests a narrow single-PWAD profile: one verified WAD per `doomgeneric-zeq-v1` manifest, no dependencies, active-ruleset compatibility, an engine-owned byte copy, independent C SHA-256 verification, structural WAD bounds checks, and memory-backed reads from those same bytes. Multi-file mods and PK3 remain unsupported. This adapter is Doom-specific, not part of the portable SDK; a third-party host must implement and test its own verified-byte handoff and content semantics rather than assume Doom's loader transfers to another engine.

### 10.2 Sealed parcels

`ZEQ-PARCEL-v2` provides recipient-bound, expiring, replay-refused local encrypted delivery using X25519, HKDF-SHA256, and AES-256-GCM. The parcel ID commits to the complete canonical parcel. Inboxes are bounded to 1000 parcels and 64 MiB serialized data.

Parcel plaintext is data. Never execute it or load it as a mod automatically. Opening a parcel does not grant capabilities, establish publisher trust, or validate its contents as safe code.

## 11. Automation and local MCP

Doom’s MCP implementation is a secured local process adapter, not a universal remote-control API. Run control requires `--allow-run`; live input requires `--allow-input`. Clients cannot choose arbitrary executable or WAD paths.

For another host:

- bind locally by default;
- require explicit opt-in for process control and live input;
- use an allowlisted host/scenario configuration;
- cap message size, command rate, queue depth, run duration, and output size;
- keep input and state schemas versioned;
- return structured errors and never leak secrets;
- record injected commands so the session can be replayed.

A future 20 Hz outer bot scheduler must feed ordinary host commands without changing Doom’s 35 Hz simulation. Similar adapters must preserve their host’s tick authority.

## 12. Future units and numerical modules

Phases 9–10 will add safe equations, dimensional analysis, SI/Zeqond conversion, uncertainty, intervals, ODE integration, quadrature, roots, linear algebra, conditioning, and sensitivity. These are not yet shipped portable APIs.

Design constraints for adopters:

1. Declare dimensions `(M, L, T, Θ)` and units at the interface.
2. Reject dimensional mismatch and unknown conversions; never guess.
3. Distinguish exact constants, measured values, approximations, and uncertain intervals.
4. Return residuals, error estimates, iteration counts, accepted/rejected steps, and termination status where applicable.
5. Set time, memory, iteration, and output budgets before evaluation.
6. Do not use `eval` or unrestricted expression evaluation.
7. Keep adaptive scientific floating-point computation out of authoritative cross-platform gameplay unless a separate deterministic numerical profile and vectors explicitly support it.

Exact arithmetic does not make a false physical model true. Error-controlled computation does not prove that input measurements are accurate.

## 13. Minimal adoption sequence

### Step 1 — Baseline the unmodified host

Record a fixed scenario and authoritative commands. Run it twice and identify all sources of variation. Add a canonical state serializer and stable source/content identity before changing mechanics.

### Step 2 — Adopt exact time only

Compile `zeq_time.c` into one host module, call `ZEQ_TimeFromTic`, and compare against the shared vectors. Keep the result observational until replay is stable.

### Step 3 — Add replay in the real host

Capture complete commands at the authoritative boundary, save initial/run identity, rerun the actual engine, and compare canonical hashes. Test frame-rate variation, pause/resume, malformed input, and truncated records.

### Step 4 — Select a named gameplay ruleset

Only then opt specific mechanics into exact Zeq physics. Preserve Vanilla or the original host behavior as a separate ruleset. Version every change that alters authoritative results.

### Step 5 — Add evidence and saves if needed

Sign public evidence records with keys held outside the host. Add ZEQC3 for local save protection where useful. Test wrong PIN, corruption, truncation, wrong run identity, and missing keys.

### Step 6 — Add content or automation explicitly

Verify content bytes and publisher trust before a bounded host-specific loader. Enable process/input control only with explicit capabilities. Keep all inputs replayable.

### Step 7 — Add advanced modules only when justified

Units, numerical solvers, contracts, plugins, and domain packs remain optional. Do not move them into the simulation hot path by default.

## 14. Conformance checklist

An integration is ready to claim a specific SDK profile only when it has:

- [ ] selected exact profile and schema versions;
- [ ] identified the authoritative tick, input, step, and state boundaries;
- [ ] passed shared arithmetic vectors, including negative and overflow cases;
- [ ] documented fixed-point scales, units, rounding, and serialization endianness;
- [ ] immutable run/settings/content identity;
- [ ] complete input capture and real-engine replay;
- [ ] canonical state mutation and exclusion tests;
- [ ] no rendering or wall-clock input to authoritative state;
- [ ] bounded files, messages, queues, and numerical work;
- [ ] malformed/adversarial negative tests;
- [ ] secret-redaction tests;
- [ ] native/browser/language interoperability for every claimed runtime;
- [ ] a clean build with pinned toolchain identity;
- [ ] documentation of unimplemented and unsupported behavior;
- [ ] no security, multiplayer, or physical-accuracy claims beyond the evidence.

Property and fuzz tests should include random integer boundaries, phase wrap, long runs, reordered entities, truncated buffers, duplicate IDs, path traversal, oversized inputs, signature/hash mismatch, replay divergence, and resource exhaustion. A fuzz crash or hang is a failed gate, not a test-only curiosity.

## 15. What not to infer

- Exact time alone does not make the whole engine deterministic.
- A deterministic replay does not prove fair competition.
- A signature does not establish publisher trust.
- A signed plugin is not sandboxed code.
- An encrypted parcel is not executable content permission.
- A local JSONL ledger is not physical WORM storage.
- A second scheduler does not justify changing the simulation tick rate.
- Doom’s fixed-point physics API is not yet a general dimensional physics engine.
- Future framework capabilities are not current portable SDK features.

The integration target is a small, explicit, testable adapter around an engine that already exists. The host keeps authority; Zeq supplies versioned arithmetic, reproducibility, and evidence contracts.
