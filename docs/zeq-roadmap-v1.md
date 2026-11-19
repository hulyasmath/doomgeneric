# Zeq Program Roadmap v1

Status: canonical planning document, 19 November 2026
Reference source snapshot: `7e7c61b229717b8653a550c7805ced801cb003e8`
Scope: Phases 0–13, repository ownership, release gates, and adoption boundaries

## 1. Purpose and non-negotiable rules

Zeq is being developed as a portable deterministic computation and local-evidence SDK. Doom is the first real reference host, not a JavaScript replacement for Doom and not the only intended application.

The program follows these rules:

1. Modify the real `doomgeneric` C engine. Do not recreate Doom in JavaScript or substitute another engine.
2. Keep the portable SDK independent of Doom mobjs, maps, renderer state, WAD loading, and `ticcmd_t`. Doom-specific adapters may translate to and from those structures.
3. Use exact integer, rational, and explicitly specified fixed-point arithmetic for authoritative deterministic gameplay. No host-dependent floating-point operation may silently enter that path.
4. Keep scientific numerical profiles separate from bit-authoritative gameplay profiles. Adaptive floating-point solvers can be reproducible and error-controlled without automatically being bit-identical across platforms.
5. Keep display time, monotonic local time, simulation ticks, and wall-clock timestamps distinct. Never use wall-clock time as simulation input.
6. Every replay, proof, manifest, parcel, or contract must have a versioned schema, bounded inputs, explicit identity, and negative tests.
7. Signatures prove key possession over specified bytes. They do not by themselves prove publisher trust, honest execution, competitive legitimacy, physical immutability, or real-world measurement accuracy.
8. No private key, PIN, machine seed, private save capsule, credential, or unredacted secret may enter Doom, telemetry, RPC, logs, proof exports, repositories, or release artifacts.
9. Do not claim a phase is complete until its implementation, tests, documentation, and release evidence all pass.
10. No repository deletion, history rewrite, visibility change, or other destructive remediation is part of this roadmap.

## 2. Repository ownership

### 2.1 `hulyasmath/doomgeneric`: game and reference integration

This repository owns:

- the complete upstream-derived Doom source tree and real engine modifications;
- exact Zeq time/physics integration in authoritative C gameplay paths;
- canonical Doom save-state hashing and replay;
- the native null/headless executable and native tests;
- the WebAssembly game, dark-green console shell, and browser tests;
- Doom content verification, WAD/PK3 adapters, rendering integrity, and networking;
- Doom-specific MCP process control and automation;
- the consolidated roadmap and reference-integration documentation;
- versioned records identifying which portable SDK release the game integrates.

It must remain buildable as a game/reference host. It is not the canonical place to develop engine-neutral SDK features independently of the SDK repository.

### 2.2 `hulyasmath/zeq-doomgeneric`: portable SDK

The existing repository name is retained for continuity. Its intended contents are SDK-only:

- portable C and JavaScript modules;
- canonical schemas, release manifests, and shared conformance vectors;
- exact arithmetic, units, numerical methods, contracts, security, content, and replay interfaces;
- engine-neutral adapter interfaces and small examples;
- Node, browser, native, property, fuzz, and interoperability tests;
- third-party integration guides and generated API documentation;
- the consolidated roadmap and SDK release notes.

It must not contain a second maintained Doom engine tree, game WADs, the game browser shell, Doom build products, or private identity material. Doom belongs in the reference-host repository and is consumed as an external conformance target.

### 2.3 Synchronization contract

A release aligns the repositories by SDK version and source identity, not by copying an entire repository over the other. Portable changes land in the SDK repository; Doom-only changes land in the game repository. Roadmap/status changes are mirrored. A game release records the SDK version, schema versions, source commit, and test evidence it consumes.

The current Phase 5 source snapshot predates this ownership split. Completing the split and verifying both remote trees is a repository-hardening deliverable, not evidence that later phases are implemented.

## 3. Status vocabulary

- **Implemented and tested:** code exists and the listed checks have passed in the stated environment.
- **Partial:** a useful milestone exists, but one or more required integration gates remain open.
- **Pending:** specified and accepted, but not implemented as a complete capability.
- **Proposed extension:** approved roadmap direction whose detailed public schemas and implementation may still change.
- **Not claimed:** a boundary that must not be inferred from a nearby working feature.

A browser preview is a test artifact, not public website publication. A committed source file is not proof that a clean WASM rebuild occurred. A successful SDK self-test is not proof that verified content has entered the engine.

## 4. Completed foundation: Phases 0–4

### Phase 0 — Specification and real-engine integration

**Status: implemented and tested for the original milestone.**

Deliverables include the real `doomgeneric` fork, native null platform, browser/WASM packaging, versioned protocol documents, legacy arcade compatibility, and the explicit distinction between exact Zeq time and the legacy approximation.

Acceptance boundary: the project runs the actual Doom engine with original shareware content. Browser glue does not own authoritative gameplay.

### Phase 1 — Exact time and deterministic arithmetic

**Status: implemented and tested.**

Core identities:

- `ZEQOND_NS = 777000777`;
- `F0 = 1000000000 / 777000777` as an exact rational;
- `TAU_Q = 777000777 / 1000000000` seconds as an exact rational;
- `ALPHA = 129 / 100000`;
- Q64 phase, Q30 trigonometric/lapse values, and Q40 logarithmic values;
- deterministic integer square root and checked rounding/division.

For an engine tick `g` at `tick_rate`:

```text
N = g × 1,000,000,000
D = tick_rate × 777,000,777
tick = floor(N / D)
phase64 = floor((N mod D) × 2^64 / D)
```

The carrier `R = 1 + α sin(2πφ)` is a display/stamp quantity. The physical lapse is `N² = 1 − α sin(2πφ)`. The carrier must not be used as an accidental velocity multiplier.

Acceptance boundary: shared C/JavaScript vectors cover boundaries, signs, rounding, invalid input, and overflow. Exact time does not depend on the engine frame rate or host wall clock.

### Phase 2 — Authoritative Zeq physics and weapons

**Status: implemented and tested for the selected Doom reference paths.**

Deliverables include deterministic midpoint integration, finite-interval half-sine impulses with 32 substeps, exact Zeqond weapon cooldowns, and explicit ruleset selection:

- `doom-vanilla-v1 = 0`;
- `zeq-physics-v1 = 1`;
- `zeq-arcade-legacy-v1 = 2`.

Acceptance boundary: changes occur in real C gameplay code, selected by immutable run settings. Vanilla remains available. This is not a claim that every Doom subsystem or every possible game mechanic has been converted to Zeq physics.

### Phase 3 — Saves, signed events, and local evidence

**Status: implemented and tested for local single-instance evidence.**

Deliverables include versioned records, Ed25519 signatures, SHA-256 state/event commitments, ZEQC3 encrypted saves, browser nonextractable keys, and the Node machine sidecar. Private Node key material remains in `.zeq-machine-signing-key.pem`, mode 0600, outside releases.

ZEQC3 uses:

```text
ZEQC3 || salt[16] || iv[12] || ciphertext || tag[16]
scrypt N=2^17, r=8, p=1, dklen=32
AES-256-GCM, AAD = ZEQC3 || salt
```

Required evidence wording: **“Integrity of this local event chain only; not proof of competitive legitimacy.”**

Not claimed: cloud identity, remote attestation, physical WORM storage, or protection against a host administrator who controls the entire execution environment.

### Phase 4 — Command replay and secured local MCP

**Status: implemented and tested for native replay and the current SDK/browser checks; clean rebuild requirements remain explicit.**

Replay captures complete authoritative engine commands. Doom input artifacts are exactly 24 bytes per record:

```text
0..3    ZEQI
4..7    little-endian uint32 gametic
8       signed forward
9       signed side
10..11  little-endian signed int16 angle turn
12      chat
13      buttons
14      consistancy
15      buttons2
16..19  little-endian signed int32 inventory
20      lookfly
21      arti
22..23  reserved zero
```

Playback injects commands at `G_BuildTiccmd`; the original `RunTic` remains authoritative. Canonical state uses Doom player/world/thinker/special archives with symbolic pointer/action IDs and SHA-256. Cosmetic rendering state is excluded or normalized without changing ordinary saves.

MCP over stdio provides run control, state reading, input injection, proof export, and verification. Run control requires `--allow-run`; live input additionally requires `--allow-input`. Clients cannot select arbitrary executables or WAD paths.

Replay status remains `not-run`, `match`, `mismatch`, or `unavailable`. Browser telemetry does not become a verified replay without actual reproduction.

Not claimed: deterministic multiplayer, rollback, a completed 20 Hz bot scheduler, or universal engine-independent replay merely because Doom replay works.

## 5. Current milestone and remaining original roadmap: Phases 5–8

### Phase 5 — Signed content and sealed parcels

**Status: partial. The SDK milestone is implemented and tested; engine loading is pending.**

Implemented SDK deliverables:

- `zeq-mod-manifest-v1` with a canonically signed body;
- Ed25519 publisher signatures, separate from explicit publisher trust;
- file path, size, and SHA-256 bindings;
- manifest limit 1 MiB, at most 1024 files, at most 64 MiB per file and 256 MiB total;
- `ZEQ-PARCEL-v2` using ephemeral-static X25519, all-zero shared-secret rejection, HKDF-SHA256 with salt `zeq-e2ee-v1`, and AES-256-GCM;
- recipient binding, expiry, authenticated headers, replay refusal, and bounded inboxes;
- `parcel_id = SHA256(JCS(complete_parcel))`;
- twelve SDK checks passing in Node and the browser test environment.

Remaining gates:

1. Verify a signed WAD and load the same verified bytes into the real engine with a TOCTOU-safe handoff.
2. Record publisher trust, content identity, ruleset compatibility, and load result in evidence.
3. Add a bounded PK3 reader only after signed WAD loading works; reject traversal, absolute paths, duplicate ambiguity, decompression bombs, and unsupported content.
4. Prove malformed manifests, wrong trust, hash mismatch, modified files, replayed parcels, expired parcels, wrong recipients, and resource-limit violations fail closed.

Not claimed: no verified immutable bytes have yet reached `W_AddFile`; PK3 is unsupported; parcels never execute or automatically load plaintext.

### Phase 6 — Deterministic networking and rollback

**Status: pending.**

Required work:

- versioned session descriptor with engine, WAD/content, ruleset, settings, map, seed, and protocol identities;
- deterministic command transport and explicit delay/jitter/loss handling;
- at least two real engine clients, not simulated peers in one script;
- matching canonical hashes over genuine network runs;
- bounded snapshots, prediction, rollback, resimulation, and desynchronization diagnostics;
- refusal or explicit degradation when a peer’s identity/settings do not match.

Acceptance gate: reproducible two-client tests with recorded commands and matching authoritative state. A hash chain, `split64`, or signed event stream alone is not netcode. No competitive-legitimacy claim follows.

### Phase 7 — Deterministic rasterization and visual integrity

**Status: pending.**

Required work:

- optional strict `zeq-pixel-v1` path isolated from Vanilla and physics behavior;
- per-pixel `(depth_q32, owner_id, layer_rank, claimed_mask)` occupancy/depth ownership;
- strict opaque write gate and deterministic depth/owner/layer tie-breaking;
- checked rational subpixel projection and column/span stepping;
- seam, overflow, degenerate geometry, viewport, and resolution tests;
- structural PATCH/PNAMES/TEXTURE1/TEXTURE2/flat validation before use;
- bounded palette, colormap, fuzz, and translucency behavior;
- native/WASM frame and occupancy comparisons using fixed inputs.

Visual hashes are separate from gameplay hashes and must state renderer, resolution, palette, content, and settings identity. Visual integrity is not proof of competitive legitimacy.

### Phase 8 — Engine, bot, build, and repository closeout

**Status: pending.**

Required work:

- complete Phase 5 loading hardening and remaining Phase 6/7 closeout items;
- a separate outer automation scheduler, proposed at 20 Hz, feeding ordinary commands while Doom remains 35 Hz;
- bot resource limits, deterministic seeds, stop/pause behavior, and replayable inputs;
- pinned and verified Emscripten toolchain with clean native/WASM rebuilds;
- synchronized source, tests, documentation, and release manifests;
- removal of stale transfer/build artifacts through ordinary reviewed file changes;
- final negative, fuzz, interoperability, and performance-budget reports.

Acceptance gate: clean checkout to tested native and browser artifacts with documented tool versions, plus remote blob/tree verification. A preview from older WASM must not be represented as a clean build of newer C source.

## 6. Portable SDK extensions: Phases 9–13

These phases expose relevant capabilities from the broader Zeq framework without requiring a host to adopt Doom’s architecture. Exact schemas and public APIs are versioned before implementation claims are made.

### Phase 9 — Arithmetic, units, equations, and measurement integrity

**Status: proposed extension; not implemented as the portable SDK layer.**

Deliverables:

- safe expression parsing with no `eval`, arbitrary calls, or unbounded grammar;
- dimensional grades and dimensional-consistency checks;
- exact SI/Zeqond-unit conversion where a conversion is defined;
- registered constants and equations with source/version identity;
- measurement uncertainty, intervals, significant bounds, and explicit refusal of invalid operations;
- shared vectors for rounding, unit conversion, singular/ill-posed equations, and hostile expressions.

Acceptance gate: third-party code can evaluate a bounded equation, prove its dimensions, convert declared units, and receive a structured result or refusal. No claim that a measurement is physically accurate merely because its arithmetic is exact.

### Phase 10 — Error-controlled numerical computation

**Status: proposed extension; not implemented as the portable SDK layer.**

Deliverables:

- finite-difference weights and convergence diagnostics;
- adaptive ODE integration, quadrature, sums, and root solving;
- linear systems, eigenvalues, conditioning, and sensitivity reports;
- tolerances, iteration/time/memory budgets, accepted/rejected steps, residual/error estimates, and divergence reporting;
- deterministic scheduling and result schemas for experiment packages.

Acceptance gate: reference problems include known analytical solutions and failure cases. Results report numerical status rather than silently returning a best-effort number. Scientific floating-point profiles remain distinct from fixed-point authoritative gameplay.

### Phase 11 — Contracts, scenarios, and reproducible experiments

**Status: proposed extension; not implemented as the portable SDK layer.**

Deliverables:

- bounded condition evaluation and explicit capabilities;
- versioned contracts, deterministic schedules, scenario definitions, seeds, and parameter sweeps;
- experiment packages containing source/settings identities, inputs, outputs, numerical status, and reproduction instructions;
- deterministic ordering, resource budgets, cancellation, and failure records.

Acceptance gate: another machine can validate a package, rerun it in a compatible host, and obtain the specified deterministic result or an explained numerical comparison. Contracts do not bypass engine authority or grant ambient access.

### Phase 12 — Scoped applications, plugins, and ownership

**Status: proposed extension; not implemented as the portable SDK layer.**

Deliverables:

- scoped application/plugin identities and explicit capability grants;
- signed install/enable/disable/update/revoke lifecycle records;
- ownership transfer, attestations, and optional authenticated local pairing;
- least-privilege host adapters and clear separation of content verification from execution permission;
- revocation and compatibility behavior that does not depend on hidden cloud state.

Acceptance gate: a host can deny every capability by default, grant a minimal set, and audit every lifecycle transition. Signing a plugin does not make its code safe; native code still requires an appropriate sandbox/process boundary.

### Phase 13 — Multi-engine conformance and domain packs

**Status: proposed extension; not implemented.**

Deliverables:

- stable C, JavaScript, and Python adapter contracts;
- a second, non-Doom reference simulation with authoritative state and replay;
- cross-language vectors, property tests, fuzzing, and differential testing;
- optional validated domain packs for units, constants, equations, or simulation policies;
- compatibility/support matrix and deprecation policy.

Acceptance gate: at least two materially different hosts pass the same portable core vectors without importing Doom objects. Any domain pack identifies its data provenance, version, limits, and validation evidence.

## 7. Dependency order and release gates

The implementation order remains: finish Phase 5, then Phase 6, Phase 7, Phase 8, followed by Phases 9–13. Documentation may be prepared ahead of code, but future APIs remain labeled pending/proposed.

Every phase requires:

1. **Scope:** versioned public contract and explicit non-goals.
2. **Implementation:** real source in the owning repository; no documentation-only completion.
3. **Vectors:** normal, boundary, malformed, overflow, and adversarial cases.
4. **Interoperability:** all claimed runtimes/languages compared against shared vectors.
5. **Integration:** the real host path exercised, not only an isolated helper.
6. **Rebuild:** clean native and/or browser builds where applicable, with toolchain identity.
7. **Evidence:** test report with environment and limitations; no inflated security or determinism claim.
8. **Documentation:** developer guide, schema changes, migration notes, and status update.
9. **Delivery:** reviewed commits, both relevant repository entry points updated, remote blobs fetched and compared to local Git object SHAs.
10. **Regression:** earlier replay, save, content, security, and Vanilla tests still pass.

## 8. Original integration checklist traceability

| Original area | Roadmap disposition |
|---|---|
| Zeq view model | Phase 0/1 implemented as reference contract; portable API expansion in Phase 9 |
| Math helpers | Phase 1 exact primitives implemented; broader library in Phases 9–10 |
| Frames, gauges, boost | Reference concepts documented; engine-neutral policies in Phase 11 |
| Autopilot loop | Doom automation closes in Phase 8; reusable scenarios in Phase 11 |
| Engines list/limits | Doom rulesets exist; generalized host descriptors in Phases 9/11 |
| Targets, logs, clips, nearby | Doom telemetry/events exist; bounded engine-neutral modules in Phases 11–12 |
| Packages, contracts, apps, machines | Signed content begins in Phase 5; complete scopes in Phases 11–12 |
| Framework completeness | Phase 13 requires a second host and public compatibility matrix |

“Traceable” does not mean “already implemented.” The table prevents checklist items from being silently dropped or prematurely marked complete.

## 9. Adoption and complexity limits

The SDK must remain useful in small pieces. A third-party host may begin with exact time only, then add replay, evidence, content, or numerical modules independently. It need not adopt Zeq physics, Doom’s tick rate, Doom’s save format, Ed25519 identity, MCP, or a browser shell.

The preferred integration order is:

1. identify the authoritative host tick and state owner;
2. adopt exact time and shared vectors;
3. define settings/ruleset identity;
4. capture complete host input and canonical state;
5. replay in the real host;
6. add signed local evidence if useful;
7. add content, contracts, numerical, or application modules only when required.

Each added module must justify its state, schema, dependencies, resource cost, and failure behavior. No scientific solver belongs in a real-time gameplay hot path unless its budget and deterministic profile are explicitly designed for that use.

## 10. Current honest position

The project has a working real-Doom reference foundation through Phase 4 and a tested Phase 5 signed-content/sealed-parcel SDK milestone. Full signed engine content loading, deterministic networking/rollback, strict rendering integrity, Phase 8 closeout, and Phases 9–13 remain unfinished. Repository restructuring and clean WASM toolchain verification are release work, not completed game features.

This roadmap is the controlling scope document for subsequent implementation. More detailed protocol documents define exact bytes and APIs; if a status statement conflicts with tested code, the status must be corrected rather than the claim inflated.
