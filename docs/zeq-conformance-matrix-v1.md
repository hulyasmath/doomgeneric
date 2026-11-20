# Zeq Conformance and Support Matrix v1

**Evidence date:** 2026-11-20.

**Meaning:** “tested” identifies an actual local suite, not universal platform support or third-party certification.

## Hosts and runtimes

| Host/profile | C99 native | JavaScript | Python | WASM/browser | Evidence boundary |
|---|---|---|---|---|---|
| Doom `zeq-time-v1` / exact physics | Tested | Tested | Tested | Tested in real doomgeneric build | Shared vectors plus real native/browser replay |
| Doom `zeq-pixel-v1` | Tested | Tested BigInt | Not claimed | Tested | 1×1, 17×13, 127×63, 320×200 exact frame/occupancy/status bytes |
| Doom `zeq-doom-visual-v1` | Tested | Browser adapter | Not claimed | Tested | Real indexed Doom frames; matching native/browser state and visual checkpoints |
| Chamber `zeq-chamber-v1` | Tested | Tested | Tested | Not claimed | 33 differential cases, canonical bytes, replay, properties, experiment reproduction |
| Quantities `zeq-quantity-v1` | Not supplied | Tested | Not claimed | Browser-compatible UMD; browser suite not yet claimed | Exact rational/unit/equation/interval vectors |
| Numerics `zeq-numerics-v1` | Not supplied | Tested | Not claimed | Browser-compatible UMD; browser suite not yet claimed | Float64 scientific profile only |
| Experiments `zeq-experiment-v1` | Host adapter only | Tested | Host adapter only | Browser-compatible UMD; browser suite not yet claimed | Doom-independent adapter and chamber reproduction |
| Lifecycle `zeq-application-lifecycle-v1` | Host adapter only | Tested | Host adapter only | Browser-compatible UMD; browser suite not yet claimed | Local signed lifecycle/audit tests; no external-machine claim |

Two materially different hosts—the real Doom C simulation and the non-Doom chamber—now exercise portable exact arithmetic and canonical-state/replay contracts. Neither result implies that arbitrary third-party engines are compatible without adapters and vectors.

## Portable core suites

| Suite | Coverage |
|---|---|
| `test_time.c/.js/.py` | Exact conversion, split64, phase, rounding, overflow, shared vectors |
| `test_physics.c/.js/.py` | Midpoint integration, finite impulses, cooldowns, generated vectors |
| `test_security.js/.py` | Signatures, proof scope, tamper refusal, independent vectors |
| `test_content.js/.py` | Signed manifests, trust separation, sealed parcels, independent vectors |
| `test_content_packages.js` | Stored/deflated PK3, ordered manifests, adversarial paths, duplicates, nested archives, non-regular entries, bombs, CRC/local mismatches, 1,000 malformed inputs |
| `test_pixel.js` / `test_pixel_sweep.js` | Raster negatives, geometry, occupancy, resolutions, native/JS/WASM bytes, repeat runs and time budgets |
| `test_texture.js` | Checked PNAMES/TEXTURE/PATCH/flat/palette/colormap parsing and malformed refusal |
| `test_quantities.js` | Dimensions, exact conversion, uncertainty containment, singular cases, hostile expressions |
| `test_numerics.js` | Analytical references, all statuses, budgets, repeatability, 100 seeded linear systems |
| `test_experiments.js` | Sweeps, cancellation, failures, conditions, capability denial, package tamper/refusal, reproduction |
| `test_lifecycle.js` | Ownership, all lifecycle actions, scoped methods, independent content checks, semantic audit and tamper refusal |
| `test_chamber.js` | C/JavaScript/Python differential tests, 1,000 properties, domain pack, experiment reproduction |

## Build and network evidence

- Browser builds require Emscripten **3.1.64** and reject other versions. `build-web.sh` cleans by default; `--no-clean` is an explicit incremental exception.
- Native headless builds clean by default and print the selected compiler version.
- The native network profile is exactly two fresh-E1M1 processes over real TCP. Direct, impaired, refusal, desync, and one-host non-loopback cases are separate tests. A 2,000-tic impaired soak has matched confirmed chains with real drops, duplicates, delay, rollback, and resimulation.
- No physical two-machine Wi-Fi test, browser multiplayer, Internet matchmaking, peer authentication, TLS, or hostile-LAN security is claimed.
- Performance output reports observed wall time, bytes, queue counts, and explicit harness budgets. It is host-specific evidence, not a guarantee for low-powered devices.

## Support and deprecation

1. A consumer must select exact profile and schema versions; similarly named formats are not interchangeable.
2. Authoritative state/command/arithmetic changes require a new profile version and fresh vectors.
3. Unknown major versions, malformed encodings, and unsupported profiles fail closed.
4. A deprecated reader may be retained only with its original semantics and regression vectors; migration must produce the new format explicitly.
5. Security fixes and bounds tightening may reject formerly accepted hostile inputs without preserving their behavior.
6. A passing local matrix does not establish external-machine, hardware-device, physical-accuracy, security, or competitive-legitimacy certification.

## Residual validation gaps

- No independent third-party audit or external-machine reproduction has been performed.
- Mobile browser tests use emulation/layout and input automation on the test host, not a physical iPhone/iPad certification.
- The chamber’s Python and C adapters are reference implementations, not bindings generated from one common ABI.
- Float64 numerical agreement across browsers, CPUs, and compilers is not claimed as bitwise deterministic.
- Signed application records do not execute, isolate, or attest plugin code.
