# Zeq × doomgeneric release evidence v1

Date: 2026-11-21

Status: **local build, regression, and promoted-preview gates passed; executable/browser source delivery fetch-verified through `49ff720a5147e012896fde5b23bed642348d9862`; final complete-tree, SDK-only, and audit acceptance recorded separately**

This report records the scoped evidence for the real doomgeneric C/WebAssembly reference host and the portable SDK. It is not an external certification, a universal determinism claim, a physical-accuracy claim, or proof of competitive legitimacy.

## 1. Build identity and manifests

- The browser build requires and reports Emscripten **3.1.64** (`a1fe3902bf73a3802eae0357d273d0e37ea79898`). The clean build completed after restoring that exact compiler.
- The native build reports the selected C compiler; the release-candidate build used Debian GCC **12.2.0-14+deb12u1**.
- Both build scripts clean their native/WASM outputs by default. `--no-clean` is an explicit incremental exception, not a release-build mode.
- The browser build recreates `dist/`, preventing stale files from surviving a release build. Every copied browser artifact is compared byte-for-byte with its source.
- Each build writes a `zeq-release-manifest-v1` JSON inventory containing source commit, toolchain identity, artifact paths, byte lengths, and SHA-256 digests. The browser manifest is `dist/zeq-release-manifest.json`; the native manifest is `doomgeneric/build-headless/zeq-release-manifest.json`.
- A manifest inventories bytes; it does not by itself prove correctness, provenance, or remote delivery.

A fresh clone of code commit `40aee6fa0512e4ce7f46070291f1247af4b0f95d` built both targets and passed manifest validation plus the complete browser suite. The checkout downloaded and SHA-256-verified the shareware WAD; the already verified Freepats dependency was supplied as an ignored build dependency rather than treated as source. Browser WASM SHA-256 was `829cb4123f0fcb048538a8e24de9561e46e71d037d5ebcdc55cd38ec9db46edf`, matching the populated-tree build exactly. The first fresh-checkout attempt had exposed an incorrect WAD archive strip level; extraction now uses an isolated temporary directory, locates the actual `doom1.wad`, and verifies its pinned SHA-256 before compilation. Final artifact identities always come from the manifest generated for the actual delivered source commit.

The final executable source snapshot is `ed06c5465a9aabb90afee74a5be1f13b6f75bb96`. Populated-tree and fresh-checkout browser builds from that snapshot both produced WASM SHA-256 `d8704d9b499025eeee01479b1ae6784209adcfd9c83add7ad5b323e789e039ca`; the earlier `829cb412…` identity is historical and was not forced into the final manifests. The populated native engine SHA-256 was `8c0490e52dbb110e129073c53473aa4366837ad64e98ded01d98ca3f5597dff6`, while the fresh-checkout native engine was `4057f89b2be4315d761e92f1f4674251e9ca4405132c50253a314a458400fd0c`. Those native binaries differ because debug information contains absolute build paths; path-independent native binary reproducibility is not claimed.

Preview version `b6533c9` was promoted from the exact tested `dist/` bytes for `ed06c546…` and passed the promoted-preview gameplay/replay checks with zero console errors and zero failed HTTP responses. Saving this preview is not public website publication. Subsequent remote transport normalized whitespace in `doomgeneric/d_main.c` and `doomgeneric/r_data.c` and removed one standalone comment marker in `r_data.c`; no executable statement changed. Those normalized sources and later documentation commits do not retroactively change the executable snapshot, manifests, WASM identity, or preview provenance, and the preview was not rebuilt from them.

## 2. Regression matrix

The following suites completed locally against the release candidate:

| Area | Evidence |
|---|---|
| Exact time and physics | 4,010 ns vectors, 30 tic vectors, 263 lapse vectors, 19 integration vectors, 6 cooldown vectors, and negative cases |
| Security and saves | Signed proof/replay, ZEQC3, independent Python vectors, RFC 8032, typed desktop/mobile PIN entry, wrong-PIN/tamper/truncation refusal, and legacy-save migration |
| Signed content | Signed WAD/parcel verification plus stored/deflated PK3, manifest-defined load order, whole-batch C prevalidation, malformed-later-PWAD atomicity, and unsafe-package refusal |
| Package adversarial tests | 1,000 deterministic malformed-input cases; traversal, ambiguity, encryption, unsupported compression, nesting, non-regular entries, CRC/local-central mismatch, bombs, truncation, and limits; zero filesystem extraction writes |
| Texture/resource ingestion | 12 targeted negative cases and 20,000 fuzz cases; native C99 warnings-as-errors and ASan/UBSan targets; real engine malformed-resource refusal |
| Strict pixel profile | Native C99/i128, JavaScript BigInt, and WASM exact-byte agreement, including occupancy and status counts |
| Pixel resolution sweep | Exact agreement at 1×1, 17×13, 127×63, and 320×200; caller-owned storage and explicit time budgets |
| Real-host visual replay | Browser/native canonical hashes and visual checkpoint hashes match; complete 256,016-byte frame and 1,024,016-byte occupancy streams match at tic 105 |
| Replay | Real `ticcmd_t` capture, native reproduction, independent verification, altered-input mismatch, tamper refusal, and signed third-run verification |
| Bot scheduling | Deterministic 20 Hz outer scheduler feeding a 35 Hz real host; 360 decisions, 700 input records, pause/stop neutral behavior, and 20 matching real-engine checkpoints |
| Networking | Two real native processes over TCP; direct, one-host non-loopback LAN, impaired, refusal, and deliberate-desync cases |
| Quantities | Exact rationals, seven dimensional grades, 25 units, uncertainty containment, three registered equations, shared vectors, and hostile-expression refusal |
| Numerics | Analytical cases, adaptive/budget paths, all structured failure statuses, and 100 seeded linear systems under nonauthoritative Float64 semantics |
| Experiments and contracts | Canonical scenarios, schedules, sweeps, cancellation, failure records, reproduction packages, bounded conditions, capability denial, and tamper refusal |
| Application lifecycle | Signed install/enable/disable/update/transfer/attest/revoke records, semantic transition audit, ownership rules, content verification, and default-deny capabilities |
| Non-Doom chamber | 33 C/JavaScript differential cases, matching Python checkpoints/final state, 1,000 property/replay runs, and matching experiment reproduction |
| Browser integration | Gameplay, saves, desktop/mobile controls, fullscreen fallback, signed content, machine flow, SDK guide, contract observation, and canonical/visual replay |
| Release manifests | Source-commit/toolchain identity, exact artifact lengths/digests, required files, and zero stale or unlisted browser artifacts |
| MCP and sidecar | Secured stdio MCP, read-only defaults, real engine runs, signed evidence, live/offline behavior, and secret rejection |

The browser runs reported zero console errors and zero failed HTTP responses in the final clean-build suite. The SDK guide exposed seven repository/document links and three tested copyable snippets.

## 3. Performance and soak observations

These are local observations and regression budgets, not universal hardware guarantees:

- Pixel sweep: native approximately 20 ms and WASM approximately 372 ms for the reported sweep; configured budgets were 10,000 ms native, 20,000 ms per WASM run, and 120,000 ms for the build.
- Final impaired TCP soak: 2,000 confirmed tics on both processes with matching confirmed hash chains.
- Impairment actually exercised: 2,625 dropped frames, 3,956 duplicated frames, and 11,329 delayed frames.
- Player 0: 272 rollbacks, 451 mispredictions, and 1,471 resimulated tics.
- Player 1: 347 rollbacks, 619 mispredictions, and 2,024 resimulated tics.
- Soak wall time was approximately 12.68 seconds; harness output was 1,724,282 bytes against a 64 MiB output bound.

The LAN result uses a non-loopback interface on one host. It is not a physical two-machine Wi-Fi test.

## 4. Fixed-scene and second-host commitments

- Fixed-scene `zeq-pixel-v1` frame SHA-256: `afaf2f3df60e9d265ad30a4c7bbf24a99c6eb688dfd9230c63d8cb8181d523c6`.
- Fixed-scene occupancy SHA-256: `9cdc18f75e76bd7bb2b790890b805f05fe9513747eb3c35ef7179e019e8f0d7b`.
- Chamber domain-pack SHA-256: `2163630fb26ca3fef6e54c98f1ba71f53f7a721e74e0c0605d17fc53eddce5fd`.
- Chamber experiment package digest: `d5352cdd4102262ee2cf809ce03c178d16a9cd49a5b4163d9aaea1abe721aff7`.

Visual commitments are separate from canonical gameplay state. The chamber domain pack is synthetic constructed-conformance data, not calibrated physical measurements.

## 5. Delivery gates

A release is not called delivered until all applicable items are complete:

1. Build and test the committed tree from clean checkouts.
2. Commit the reviewed game/reference and SDK-only changes to their owning repositories.
3. Fetch every uploaded file from GitHub and compare its exact local `git hash-object` blob SHA.
4. Verify remote branch heads and tree membership; do not infer delivery from write responses.
5. Promote only the byte-verified browser build to the preview.
6. Exercise the promoted game on desktop and mobile emulation and record residual limitations.

## 6. Explicit residual limits

- The browser game remains single-player; networking is the native two-client reference profile.
- Native networking is limited to two players, fresh E1M1, tested settings/content, and the documented command profile. It supplies no encryption, peer authentication, matchmaking, NAT traversal, or hostile-LAN security.
- No mid-game network join, saved-game network resume, browser multiplayer, or Internet-multiplayer claim is made.
- Signatures and lifecycle records do not execute plugins or sandbox native code. A host-provided process/sandbox boundary remains necessary.
- Scientific Float64 solvers are nonauthoritative for gameplay; residual and condition results are diagnostics rather than unconditional error bounds.
- Exact arithmetic does not prove physical accuracy. Not every Doom mechanic or real-world model has been converted or calibrated.
- Cross-language and Doom/chamber evidence does not certify arbitrary third-party engines, arbitrary platforms, external-machine reproduction, or competitive legitimacy.
- Mobile browser emulation is not physical-device certification.

The defensible conclusion is a broad, tested reference demonstration with explicit contracts and limitations—not unconditional mathematical, physical, or security perfection.
