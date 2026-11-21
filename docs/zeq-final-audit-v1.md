# Zeq × doomgeneric final audit v1

Date: 2026-11-21

## 1. Verdict and claim boundary

The defined reference-host and portable-SDK roadmap is **implemented and locally tested within the profiles listed below**. The playable Doom host is a broad reference demonstration of the framework's exact arithmetic, explicit units, host-owned simulation, replay/evidence, content, renderer, networking, numerical, experiment, lifecycle, and multi-host contracts. It is not unconditional proof of mathematical correctness, physical accuracy, security, determinism on every platform, or competitive legitimacy.

The final executable source snapshot audited here is `f3b0b06b2ade79af7130c695bee3f8e0fc522eae`. Later audit-documentation commits do not change that executable snapshot. Remote delivery requires a separate fetch-back and complete-tree comparison; a commit response alone is not acceptance evidence.

## 2. Final artifact and preview identities

| Item | Audited identity |
|---|---|
| Executable source | `f3b0b06b2ade79af7130c695bee3f8e0fc522eae` |
| Browser toolchain | Emscripten `3.1.64-git`, revision `a1fe3902bf73a3802eae0357d273d0e37ea79898` |
| Native toolchain | Debian GCC `12.2.0-14+deb12u1` |
| Browser WASM SHA-256 | `857c4aa11ce6f6a1d7bac191d74c916210feff679a0bda26dc919962c9ec60da` |
| Native engine SHA-256 | `f69a91dd30b94ac0efcb0242a1d48bc4c8619841ef789365d8026a56ce886084` |
| Browser manifest | 20 inventoried artifacts, zero stale artifacts |
| Fresh-checkout browser comparison | All 21 files including manifests matched; zero missing, extra, or mismatched files |
| Current saved preview | `56dbada`, application version `1a1fe005-0842-8836-8000-0000745eb074`, big version 14 |

The current preview was copied from the exact tested `dist/` tree and independently retested. Saving a preview is not public website publication. Native binaries retain absolute build paths in debug information, so path-independent native binary reproducibility is not claimed.

Historical WASM identities `829cb412…` and `d8704d9b…`, native identities `8c0490e5…` and `4057f89b…`, and preview `b6533c9` belong to earlier snapshots. They were not hand-edited into the current manifests.

## 3. Networking defect found and resolved

The final audit initially failed the impaired native pair. One peer emitted `snapshot-restore`; another reproduced run emitted `rollback-restore-hash-mismatch`. The earlier successful soak was not reused as passing evidence.

Diagnosis found a real boundary mismatch between Doom's deferred thinker removal and the rollback trailer:

1. Doom clears a special thinker's function and unlinks it on the next thinker pass.
2. A pre-tic snapshot can still contain that linked thinker, while `P_ArchiveSpecials` does not serialize it.
3. The rollback ordering trailer counted it, producing more ordering entries than restored thinkers.
4. Canonical prev/next links also had to use the nearest serialized neighbors so the restored state reproduced the preceding canonical hash.

The correction shares one archive-membership predicate across canonical pointer identities and rollback ordering. The network descriptor now reports engine build `doomgeneric-zeq-phase6-v2`, so a peer using the former transient-state encoding is refused rather than silently joined. The impaired acceptance case now enables pre-tic boundary verification on both peers.

Final evidence:

- Complete matrix passed: 140 direct tics, 140 one-host non-loopback TCP tics, 180 impaired tics, identity/protocol/input refusal, and deliberate bidirectional desync detection.
- Impaired matrix run produced matching confirmed chains with real rollback, misprediction, resimulation, drops, duplicates, and delay.
- A 2,000-tic impaired soak passed with matching confirmed chains. The peers reported 238 and 343 rollbacks, 411 and 568 mispredictions, and 1,328 and 1,983 resimulated tics respectively.
- Before final descriptor/boundary-test normalization, the corrected implementation also passed 30 short impaired runs and five full 180-tic impaired runs. These repetitions are regression evidence, not a proof that all possible schedules are safe.

The transport remains native-only and limited to two fresh-E1M1 processes. No physical two-machine Wi-Fi test, browser multiplayer, Internet matchmaking, peer authentication, encryption, or hostile-LAN security is claimed.

## 4. Final regression evidence

| Area | Final result |
|---|---|
| Native replay | Real `ticcmd_t` replay matched independently; altered input diverged; input/state tamper was refused; signed third-run verification passed |
| Deterministic bot | 20 Hz scheduler feeding the ordinary 35 Hz host; real-engine replay matched across 20 checkpoints; pause/resume/stop neutral behavior passed |
| MCP | Initialize/tools, read-only defaults, offline/live runs, stop/status/state, signed match, real verification, and secret rejection passed |
| Complete native networking | Direct, one-host non-loopback, impaired, refusal, and desync cases passed |
| Visual resources | Three real host frames passed; malformed PNAMES, TEXTURE1, PATCH, FLAT, PLAYPAL, and COLORMAP inputs were refused |
| Pixel profile | Native C99/i128, JavaScript BigInt, and WASM bytes matched, including occupancy and repeat runs |
| Pixel sweep | 1×1, 17×13, 127×63, and 320×200 matched across all three targets within declared host-specific budgets |
| Browser capsule/security | Typed desktop/mobile PIN entry, wrong-PIN/tamper/truncation refusal, legacy restore, export verification, and self-tests passed |
| Browser content | Signed content, ordered multi-PWAD loading, whole-batch prevalidation, and malformed/refusal cases passed |
| Browser controls | Desktop and emulated mobile/coarse-pointer controls, top-layer joystick/fire controls, and expanded fallback passed |
| Browser machine | 24 checks, real WASM play, 24 real engine events, 13 accepted events, and 23 audited test-chain rows passed; key was not persisted |
| SDK guide | Desktop/mobile guide layout and disclosure interactions passed |
| Promoted preview | Capsule/gameplay and controls passed with zero console errors and zero failed HTTP responses |

Native/browser replay compared equal canonical hashes at completed tics 35, 70, and 105. At tic 105, the complete 256,016-byte frame and 1,024,016-byte occupancy stream matched. Visual commitments remain separate from gameplay hashes.

The portable audit independently passed two C suites, four Python suites, and fourteen JavaScript suites. SDK-only bot/browser runs were not misreported as portable tests: those host integrations were run from the game repository. Pixel and WASM gates were subsequently rerun with the pinned compiler.

## 5. Roadmap disposition

| Phase | Status | Audited scope |
|---|---|---|
| 0–4 | Implemented and locally tested | Real doomgeneric C engine, exact time/physics paths, distinct rulesets, browser WASM, ZEQC3 saves, signed evidence, replay, MCP, and host integration |
| 5 | Implemented and locally tested within scope | Signed manifests/parcels, bounded stored/deflated PK3, scoped signed-PWAD loading, ordered multi-PWAD validation and append |
| 6 | Implemented and locally tested within scope | Native two-process TCP, prediction, retransmission, snapshots, rollback/resimulation, refusal, and desync diagnostics; final defect corrected above |
| 7 | Implemented and locally tested within scope | Real indexed Doom frames, strict pixel profile, resource validation, resolution sweep, and native/browser visual comparisons |
| 8 | Implemented and locally tested for this reference host | Clean builds, deterministic bot scheduling, fuzz/negative gates, observed performance budgets, manifests, and promoted preview |
| 9–10 | Portable profiles implemented and locally tested | Exact rational quantities, seven dimensional grades, units, intervals, equations, expressions, scientific Float64 numerical methods and structured statuses |
| 11–12 | Portable profiles implemented and locally tested | Scenarios, experiments, conditions, bounded contracts, lifecycle/ownership records, capabilities, and independent content verification |
| 13 | Second reference implemented and locally tested | `zeq-chamber-v1` in independent C99, JavaScript, and Python implementations, domain pack, and multi-host conformance matrix |

“Implemented” does not mean that every Doom mechanic uses Zeq physics. Vanilla mode remains a distinct ruleset, the original Doom simulation remains authoritative, and scientific Float64 solvers are non-authoritative diagnostics rather than deterministic gameplay arithmetic.

## 6. Repository and generated-output accounting

The last complete pre-audit remote baselines were:

- Game: `ffc50770871279fc593e8d782119bc1a52d4438d`, 322 tracked files, zero remote extras or blob mismatches.
- SDK: `fbcc447313be645a11bd344f44327ec2f533576c`, 77 remote files comprising 76 staged source/document files plus the existing `.gitignore`.

Seven SDK outputs are reproducible and intentionally excluded from source publication:

- `sdk/vectors/zeq-time-v1.json`
- `sdk/vectors/zeq-physics-v1.json`
- `sdk/tests/zeq_test_vectors.h`
- `sdk/tests/zeq_test_physics_vectors.h`
- `sdk/zeq_sine_q30.inc`
- `sdk/zeq-time-table.js`
- `sdk/zeq-physics-table.js`

All seven regenerated byte-for-byte in an isolated copy. This audit document adds one SDK source/document file, so the final intended SDK membership is 77 staged source/document files plus `.gitignore`, or 78 remote files, with the same seven generated outputs excluded. No Doom engine tree, browser shell, WAD, WASM, build product, save, capsule, Python cache, or generated vector/table belongs in the SDK-only repository.

Earlier remote transport normalized whitespace in `d_main.c` and `r_data.c` and removed one standalone comment marker in `r_data.c`; no executable statement changed. Those sources were normalized locally and kept separate from the earlier tested executable snapshot. The lifecycle module's `granted.some` transport error was corrected to the tested `grants.some`; the bad intermediate commit is not delivery evidence.

Final source and audit-document commits must be fetched from GitHub and compared using exact local Git blob SHA-1 identities, followed by complete intended-tree membership checks. Final remote heads are reported with that external verification rather than embedded self-referentially in this document.

## 7. Residual limitations and unsupported claims

- No independent third-party security, mathematical, or physical audit has been performed.
- No external-machine reproduction, physical two-machine LAN test, or physical iPhone/iPad certification has been performed; mobile results are browser emulation/layout and input automation.
- Native networking is not browser, Internet, authenticated, encrypted, or hostile-network multiplayer.
- Signatures and lifecycle records do not execute, isolate, sandbox, or attest plugin code. Content verification and capability checks do not create an execution sandbox.
- The chamber uses synthetic declared quantities; it is not a calibrated physical model.
- Residual and condition outputs in the numerical module are estimates/diagnostics, not unconditional error bounds. Scientific Float64 results are not claimed bitwise identical across CPUs, compilers, or browsers.
- Doom and chamber conformance does not establish arbitrary third-party engine compatibility. Every new host still needs an authoritative-state audit, adapter, vectors, and negative tests.
- The manifests inventory bytes; they are not independent provenance or correctness proofs. Signed events and hash chains do not establish competitive legitimacy.
- No claim is made that prior public repository exposure can be erased, or that a rewritable file provides physical WORM storage.

Within those limits, the audited game is a concrete and tested demonstration of how the mathematical framework integrates with an existing simulation without replacing its authoritative engine.
