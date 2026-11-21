# Zeq Program Roadmap v1

Status: canonical planning document, 20 November 2026
Reference source snapshot: the repository commit containing this document
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

The initial Phase 5 source snapshot predated this ownership split. The split and both remote tree verifications are complete; that repository-hardening work is not evidence that later phases are implemented.

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

Not claimed by Phase 4 alone: deterministic multiplayer, rollback, a completed 20 Hz bot scheduler, or universal engine-independent replay merely because Doom replay works. The separately gated Phase 6 native reference profile is described below.

## 5. Current milestone and remaining original roadmap: Phases 5–8

### Phase 5 — Signed content and sealed parcels

**Status: implemented and locally tested for the scoped signed-content profile. Single PWAD and bounded multi-PWAD PK3 loading, publisher trust, sealed parcels, adversarial limits, and engine evidence are covered. Arbitrary code mods, dependencies, and automatic parcel loading remain unsupported.**

Implemented SDK deliverables:

- `zeq-mod-manifest-v1` with a canonically signed body;
- Ed25519 publisher signatures, separate from explicit publisher trust;
- file path, size, and SHA-256 bindings;
- manifest limit 1 MiB, at most 1024 files, at most 64 MiB per file and 256 MiB total;
- `ZEQ-PARCEL-v2` using ephemeral-static X25519, all-zero shared-secret rejection, HKDF-SHA256 with salt `zeq-e2ee-v1`, and AES-256-GCM;
- recipient binding, expiry, authenticated headers, replay refusal, and bounded inboxes;
- `parcel_id = SHA256(JCS(complete_parcel))`;
- twelve SDK checks passing in Node and the browser test environment.

Implemented and tested reference-host deliverables:

- one signed PWAD or a `zeq-pk3-v1` package containing one to sixteen PWADs per accepted `doomgeneric-zeq-v1` manifest, no dependencies, and compatibility with the active ruleset;
- manifest-array load order independent of ZIP entry order, stored/deflated regular-file support, bounded actual output, CRC and local/central consistency checks, and refusal of traversal, absolute paths, duplicate/case ambiguity, nested archives, unsupported methods, and malformed or oversized content;
- whole-batch C validation before the first engine append, with explicit evidence rather than a rollback claim if a later allocation/engine failure were to occur;
- SDK verification of the canonical signature, explicit publisher trust, file size, and SHA-256 before the engine call;
- an engine-owned byte copy, independent C SHA-256 verification, and structural bounds checks for the PWAD header, directory, and every lump range;
- memory-backed Doom lump reads from the same owned bytes, without reopening a mutable pathname;
- `zeq-content-load-evidence-v1` records for publisher trust, content identity, ruleset compatibility, lump counts, and load result in the local evidence chain;
- browser integration tests covering a real marker-lump load/read-back and fail-closed wrong-trust, modified-byte, incompatible-ruleset, malformed-WAD, direct C digest-mismatch, and duplicate-load cases;
- native replay/MCP, browser/native canonical replay, gameplay, capsule-restore, desktop, and mobile regressions passing with zero browser console or HTTP errors.

Closeout evidence:

1. Portable stored/deflated PK3 and ordered-signature/digest tests pass, including 1,000 deterministic malformed-input cases and resource bounds.
2. The real browser loads two marker PWADs in manifest order and reads back both exact payloads.
3. A signed batch whose second PWAD is malformed is refused during prevalidation without installing the valid first PWAD.
4. Existing wrong-trust, changed-byte, incompatible-ruleset, malformed-WAD, direct-C digest, duplicate, and signed-evidence regressions still pass with zero console/HTTP errors.

Not claimed: arbitrary native/code mods, dependency resolution, automatic content execution, parcel auto-loading, transactional rollback after an unexpected engine append failure, or general PK3 content semantics. Signed content is session-local; signature validity is not publisher trust or a safety guarantee.

### Phase 6 — Deterministic networking and rollback

**Status: implemented and tested for the native two-client reference profile; browser networking and broader production/security hardening remain pending.**

Implemented reference-host deliverables:

- `zeq-net-session-v1` / `zeq-doom-net-v1` descriptor binding engine API/build, WAD/content, ruleset, episode/map/skill, settings, tick rate, initial RNG, and session identity;
- two separate native Doom processes with real player assignments and complete per-tic `ticcmd_t` exchange over real TCP sockets;
- a fixed 60-byte hello and bounded binary command/hash/completion frames, with malformed, oversized, wrong-protocol, wrong-player, and conflicting-duplicate refusal;
- deterministic impairment testing through an actual TCP proxy, including delay, jitter, command loss, and duplicates;
- 8-tic prediction, a 32-tic command/snapshot window, 262144-byte snapshot buffers, complete-command retransmission, and peer-checkpoint acknowledgement bounds;
- real pre-tic Doom snapshots, rollback, exact resimulation, restored Zeq extension/gameplay state, symbolic pointers, mobj heights, and mixed thinker order;
- confirmed canonical SHA-256 checkpoint chains only after both authoritative commands exist; predicted/rolled-back engine events are drained instead of entering confirmed evidence;
- local/remote confirmed-hash comparison and `net-desync` diagnostics in both sender directions;
- portable descriptor/digest and deterministic impairment-scheduling helpers in `sdk/zeq-net.js`, without embedding Doom or pretending to provide a transport.

Acceptance evidence:

- the direct case confirms 140 tics on both processes with identical linked hashes and explicit pre-tic boundary verification;
- the LAN case confirms 140 tics over real non-loopback TCP on one test host, using an explicitly selected local IPv4 interface; malformed and wildcard bind addresses are refused; a physical two-machine private-Wi-Fi run has not been performed;
- the impaired case confirms 180 tics with identical hashes and observed drops, duplicates, delays, mispredictions, rollbacks, and resimulation on real engine processes;
- descriptor and session mismatches are refused before checkpoints; wrong protocol/player, conflicting commands, bad frame magic, and oversized frames are refused;
- deliberate transmitted-hash corruption at tic 20 is detected in both directions;
- native replay, MCP, exact arithmetic/physics/content/security, clean WASM, browser controls, signed-PWAD, and browser/native canonical replay regressions pass.

Current scope and remaining hardening:

1. Native headless fresh-E1M1 only; the browser/WASM shell remains single-player.
2. Exactly two players, fixed tested shareware content/settings, no mid-game join or saved-game session resume, and no `BT_SPECIAL` commands.
3. The listener binds `127.0.0.1` by default. `ZEQ_NET_BIND=<numeric local IPv4>` explicitly selects another local interface for private-LAN transport; `0.0.0.0` and malformed addresses are refused. The one-host non-loopback test is not a physical two-machine Wi-Fi validation. The handshake compares session/descriptor identity but does not authenticate a person or cryptographic peer key and supplies no encryption, TLS, matchmaking, relay, or NAT traversal. Use only a trusted private LAN; do not present this profile as a secure public multiplayer service.
4. Longer soak tests, wider maps/rulesets/content, resource-exhaustion/fuzz testing, and performance budgets remain Phase 8 hardening.
5. Any future browser, UDP, signed-peer, or multi-file-content transport requires a new explicitly versioned and tested profile.

The native acceptance gate is therefore met without implying production Internet multiplayer or competitive legitimacy. A hash chain, `split64`, or signed event stream alone would not constitute netcode.

### Phase 7 — Deterministic rasterization and visual integrity

**Status: implemented and locally tested for `zeq-pixel-v1`, `zeq-texture-validation-v1`, and the scoped `zeq-doom-visual-v1` host profile. Doom remains the display renderer; visual evidence is not gameplay proof.**

Implemented and tested deliverables:

- optional engine-neutral C and JavaScript modules isolated from Vanilla, physics, replay, and canonical gameplay state;
- caller-owned per-pixel `(depth_q32, owner_id, layer_rank, claimed_mask)` occupancy plus RGBA8 color;
- strict opaque write gating, deterministic depth/layer/owner arbitration, claim-mask merging, and same-key color-conflict refusal;
- checked bounded-rational 1/256-subpixel projection and half-open clipped column/span stepping;
- canonical little-endian frame (`ZEQFRM1`) and occupancy (`ZEQOCC1`) byte streams with independent SHA-256 commitments;
- native C99/i128, JavaScript BigInt, and WASM equality at 1×1, 17×13, 127×63, and 320×200, including occupancy, status counts, clipping, ties, conflicts, repeated runs, and explicit time/storage budgets;
- checked structural PNAMES/TEXTURE1/TEXTURE2/PATCH/flat/PLAYPAL/COLORMAP validation before original Doom parser use, including zero-length namespace-marker handling;
- a four-frame real-host ring containing actual canonical frame/occupancy streams and independent visual hashes, with renderer, content, palette, resolution, and settings identity;
- strict opaque occupancy commits of Doom's final indexed frame only after palette, colormap, fuzz, translucency, HUD, and menu processing; no rendering-to-gameplay writeback;
- real native visual capture, malformed-WAD refusal, clean WASM rebuild, and browser/native equality for canonical state and visual checkpoints, including complete 256016-byte frame and 1024016-byte occupancy streams at tic 105.

Visual hashes are separate from gameplay hashes. The strict path does not replace Doom's renderer or prove arbitrary content correct, and visual integrity is not proof of competitive legitimacy.

### Phase 8 — Engine, bot, build, and repository closeout

**Status: the full local regression matrix, build-generated release manifests, clean-checkout native/browser builds, and promoted-preview tests have passed. Executable/browser source files are remotely fetch-verified through `49ff720a5147e012896fde5b23bed642348d9862`; complete-tree, SDK-only, and final audit closeout are recorded independently.**

Implemented or locally tested work:

- Phase 5 bounded PK3/multi-file hardening and Phase 7 real-host closeout have passed focused gates;
- `zeq-bot-schedule-v1` is a separate 20 Hz outer scheduler feeding ordinary commands while Doom remains 35 Hz;
- deterministic seeds, decision limits, stop/pause neutral commands, bounded fields, and real-engine replay are tested;
- `build-web.sh` requires Emscripten 3.1.64 and cleans by default; `build-headless.sh` also cleans and reports compiler identity;
- a 2,000-tic impaired TCP soak has matched confirmed hashes under observed rollback/resimulation and impairment;
- source and documentation are synchronized in the working release candidate; the complete local matrix and clean-checkout builds have passed; executable/browser remote blobs were fetched and compared through commit `49ff720a5147e012896fde5b23bed642348d9862`, with complete-tree acceptance performed after documentation publication;
- the browser build recreates `dist/` to exclude stale artifacts, and both build scripts emit `zeq-release-manifest-v1` artifact inventories;
- negative, fuzz, interoperability, and host-specific performance observations are reported in the [release evidence](zeq-release-evidence-v1.md), conformance matrix, and test output.

Acceptance gate: clean checkout to tested native and browser artifacts with documented tool versions, plus remote blob/tree verification. A preview from older WASM must not be represented as a clean build of newer C source.

## 6. Portable SDK extensions: Phases 9–13

These phases expose relevant capabilities from the broader Zeq framework without requiring a host to adopt Doom’s architecture. Exact schemas and public APIs are versioned before implementation claims are made.

### Phase 9 — Arithmetic, units, equations, and measurement integrity

**Status: implemented and locally tested for `zeq-quantity-v1`; no physical-accuracy or calibrated-measurement claim follows.**

Implemented deliverables:

- bounded normalized exact rationals and seven dimensional grades with consistency checks;
- explicit SI/Zeqond-unit conversion and registered constants/equations with source/version identity;
- conservative uncertainty intervals, invalid-operation refusal, and singular negative-power handling;
- a bounded expression parser with no `eval`, calls, properties, assignments, or unbounded grammar;
- shared vectors for conversion, rounding, uncertainty containment, dimensions, singular equations, and hostile expressions.

Acceptance evidence: third-party JavaScript can evaluate a bounded equation, check its dimensions, convert declared units, and receive an exact result or structured exception. The three-Zeqond conversion test produces exactly `2331002331/1000000 ms`. Exact arithmetic does not establish measurement accuracy or validate a physical model.

### Phase 10 — Error-controlled numerical computation

**Status: implemented and locally tested for `zeq-numerics-v1` under `scientific-float64-nonauthoritative`; bitwise cross-platform Float64 agreement is not claimed.**

Implemented deliverables:

- finite-difference weights and convergence diagnostics;
- adaptive Dormand–Prince RK45, quadrature, compensated/adaptive sums, and bracketed roots;
- partial-pivoting linear systems, symmetric eigensystems, conditioning, and sensitivity diagnostics;
- tolerances, operation/step/time budgets, accepted/rejected steps, residuals, and explicitly named error estimates;
- structured `ok`, `invalid-input`, `refused`, `singular`, `diverged`, and `budget-exceeded` results.

Acceptance evidence: analytical reference problems, failure/budget paths, repeatability, and 100 seeded linear systems pass locally. Residual- and condition-derived fields are diagnostics, not unconditional error bounds. Scientific floating-point results remain outside bit-authoritative gameplay unless a host defines a separate numerical contract.

### Phase 11 — Contracts, scenarios, and reproducible experiments

**Status: implemented and locally tested for the scoped portable experiment layer and the PR #3 observer; external-machine reproduction remains open.**

Implemented deliverables:

- bounded condition ASTs, explicit capabilities, and host-authoritative proposed contract actions;
- versioned scenarios, deterministic schedules, canonical safe-integer parameters, and lexicographically ordered sweeps;
- experiment packages binding source/settings identity, inputs, checkpoints, outputs, numerical status, and reproduction instructions;
- deterministic ordering, resource budgets, cancellation, failure records, package validation, and actual-rerun reproduction.

Acceptance evidence: portable tests cover sweeps, cancellation, failure records, capability denial, package tamper/refusal, and reproduction; the non-Doom chamber package reproduces with `match`. The PR #3 host/event-contract observer remains asynchronous observation rather than gameplay enforcement. A package does not prove host honesty, and another machine must run the source-identified adapter before cross-machine compatibility is claimed.

### Phase 12 — Scoped applications, plugins, and ownership

**Status: implemented and locally tested for signed metadata, scoped host capabilities, and ownership lifecycle; code execution, sandboxing, and authenticated pairing are not supplied.**

Implemented deliverables:

- scoped application/plugin descriptors and explicit default-deny capability grants;
- signed install/enable/disable/update/transfer/attest/revoke records with semantic transition audits;
- ownership transfer, independent asynchronous content verification, and terminal revocation;
- least-privilege host adapters that check authorization on every exposed call;
- compatibility and lifecycle state without hidden cloud dependency.

Acceptance evidence: local tests cover all lifecycle actions, correctly signed invalid transitions, tamper, ownership, default denial, independent content checks, and explicit unsafe-native enablement. No lifecycle method executes plugin code. Signing, attestations, or a sandbox label do not make native code safe; an actual process/sandbox boundary remains the host's responsibility.

### Phase 13 — Multi-engine conformance and domain packs

**Status: implemented and locally tested for the second-reference-host milestone and support matrix; arbitrary third-party engine compatibility and independent external reproduction are not claimed.**

Implemented deliverables:

- independent C99, JavaScript, and Python `zeq-chamber-v1` reference adapters with canonical state and replay;
- a materially different non-Doom Q10 bounded particle chamber with no Doom imports, renderer, wall clock, floating point, or host randomness;
- cross-language differential tests, 1,000 deterministic property/replay runs, malformed-input coverage, and experiment reproduction;
- a versioned synthetic `zeq-domain-pack-v1` with explicit provenance, units, constants, limits, and evidence;
- a tested-runtime/support matrix and explicit versioning/deprecation policy.

Acceptance evidence: 33 C/JavaScript cases match exact final canonical bytes, Python final state/checkpoints match, and the chamber experiment package reproduces. Doom and chamber demonstrate the portable conformance approach on materially different hosts; this is not proof that every engine or every portable vector has been integrated unchanged. Domain-pack values are constructed conformance data, not measured physical properties.

## 7. Dependency order and release gates

The implementation order was Phase 5, Phase 6, Phase 7, Phase 8 hardening, followed by Phases 9–13. The scoped signed-PWAD/PK3 loader, native two-process rollback profile, real-host visual profile, portable quantity/numerical/experiment/lifecycle modules, and second non-Doom reference simulation now have local implementation and focused test evidence. Phase 8's complete regression, clean-checkout builds, release manifests, stale-artifact review, and promoted-preview gates have passed. Preview version `b6533c9` contains the tested browser artifacts from executable source snapshot `ed06c5465a9aabb90afee74a5be1f13b6f75bb96`; saving that preview is not public website publication. Executable/browser source delivery has been fetch-verified through `49ff720a5147e012896fde5b23bed642348d9862`, while final complete-tree, SDK-only, and audit acceptance remain separate evidence steps. Browser networking, production Internet security, physical two-machine validation, external-machine experiment reproduction, plugin execution/sandboxing, and broader third-party host support remain outside the implemented profiles.

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

The project has a working real-Doom reference foundation through Phase 4; scoped Phase 5 signed single-PWAD and bounded multi-PWAD PK3 loading; a Phase 6 native two-process networking/rollback profile with matching canonical hashes under direct, impaired, and 2,000-tic soak runs; Phase 7 pixel, resource-validation, and real-host visual profiles; and locally tested Phase 9–13 portable quantity, numerical, experiment, lifecycle, second-host, and domain-pack modules. The PR #3 contract observer remains a narrow asynchronous observation profile within the broader experiment layer.

Phase 8's final scoped local closeout is complete at executable source `f3b0b06b2ade79af7130c695bee3f8e0fc522eae`; the [final audit](zeq-final-audit-v1.md) records the regression matrix, repaired pending-thinker rollback defect, exact remote-verification procedure, and residual limitations. Current browser WASM SHA-256 is `857c4aa11ce6f6a1d7bac191d74c916210feff679a0bda26dc919962c9ec60da`. Preview version `56dbada` was saved from the exact 21 tested browser files and retested; it is a preview, not public website publication. Browser networking, production network security, physical two-machine Wi-Fi validation, external-machine reproduction, plugin execution/sandboxing, physical mobile certification, arbitrary third-party engine compatibility, and unconditional mathematical/physical correctness are not claimed. The playable game is a substantial reference demonstration of the framework's explicit arithmetic and host-integration boundaries, not proof that every Doom mechanic or real-world model is Zeq-converted or physically validated.

This roadmap is the controlling scope document for subsequent implementation. More detailed protocol documents define exact bytes and APIs; if a status statement conflicts with tested code, the status must be corrected rather than the claim inflated.
