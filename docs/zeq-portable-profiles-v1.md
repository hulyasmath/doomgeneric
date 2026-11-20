# Zeq Portable Profiles v1

**Scope:** implemented portable Phase 9–13 modules and their exact limits.

**Evidence level:** source and local conformance tests are present; repository delivery and any external-machine validation are separate release gates.

These modules are optional. They do not require Doom, a browser, a particular tick rate, or a cloud service. A host remains authoritative for its own state and chooses only the profiles it needs.

## 1. Exact quantities: `zeq-quantity-v1`

`sdk/zeq-quantities.js` provides bounded normalized rational numbers, seven dimensional grades (`time`, `length`, `mass`, `current`, `temperature`, `amount`, `luminous`), explicit unit conversion, conservative symmetric uncertainty intervals, registered constants/equations, and a bounded expression parser.

- Normalized numerator and denominator magnitudes are bounded by signed 64-bit maximum; intermediate BigInt calculations must normalize within that bound or throw.
- Dimension exponents are bounded to `[-16,16]`; powers use integer exponents in `[-64,64]`.
- Expressions are at most 4096 characters and 32 recursive levels. Only numeric literals, registered names, supplied variables, parentheses, unary signs, `*`, `/`, `^`, `+`, and `-` are accepted. Calls, properties, assignments, unknown names, and `eval` are not supported.
- Exact Zeq constants are registered as `tau`, `f0`, and `alpha` with source/version identity.
- Division and negative powers reject intervals containing zero. Uncertain multiplication, division, and powers choose an interval around the nominal result that contains the computed corner/extremum interval.

```js
const Q = require("./sdk/zeq-quantities.js");
const threeZeqonds = Q.fromUnit(Q.rational(3n), "zeqond");
const milliseconds = Q.convert(threeZeqonds, "ms");
// milliseconds.value = 2331002331n / 1000000n exactly
const length = Q.fromUnit(Q.rational(10n), "m", Q.rational(1n, 10n));
const time = Q.fromUnit(Q.rational(2n), "s");
const velocity = Q.binaryQuantity(length, time, "/");
```

Exact arithmetic and dimensional consistency do not establish measurement accuracy or validate a physical model.

## 2. Scientific numerics: `zeq-numerics-v1`

`sdk/zeq-numerics.js` implements finite-difference weights/convergence, adaptive Dormand–Prince RK45, adaptive Simpson quadrature, Neumaier sums, adaptive series sums, bracketed bisection, partial-pivoting linear solves, symmetric Jacobi eigensystems, and explicit perturbed linear sensitivity.

Every operation returns `format`, `profile`, `method`, `status`, and budget evidence. The profile is **`scientific-float64-nonauthoritative`**: results are scientific diagnostics, not bit-authoritative cross-platform gameplay state. Statuses are `ok`, `invalid-input`, `refused`, `singular`, `diverged`, and `budget-exceeded`.

```js
const N = require("./sdk/zeq-numerics.js");
const result = N.integrateOde((t, y) => [-y[0]], { t: 0, y: [1] }, {
  end: 1, absoluteTolerance: 1e-9, relativeTolerance: 1e-9,
  maxSteps: 10000, maxOperations: 2000000, maxMilliseconds: 1000
});
if (result.status !== "ok") throw new Error(result.error);
```

Condition and residual fields are floating-point diagnostics. `residualDerived*ErrorEstimate` and `conditionBasedRelativeEstimate` are deliberately named estimates, not unconditional error bounds. Callback exceptions become structured `refused` results. Scientific Float64 methods must not be inserted into an authoritative deterministic replay path without a separate, versioned numerical contract and vectors.

## 3. Scenarios and experiments

`sdk/zeq-experiments.js` implements `zeq-scenario-v1`, `zeq-condition-v1`, and `zeq-experiment-v1`.

An adapter supplies:

```js
const adapter = {
  async create({ scenario, parameters, schedule }) {
    return {
      numericalStatus: "not-applicable", // or a declared numerical status
      async step(tic, commands) { /* advance the real host exactly one step */ },
      async stateHash() { /* SHA-256 of complete canonical state */ },
      async close() {}
    };
  }
};
```

`runScenario`, `runExperiment`, `validatePackage`, and `reproduceExperiment` provide canonical safe-integer parameters, deterministic schedule ordering, lexicographically ordered parameter sweeps (at most 1024 runs), time/cancellation handling, source-identified adapter records, and package/checkpoint/status hashing. Reproduction compares every checkpoint and numerical status; it reports `match` only after an actual rerun.

Condition ASTs support bounded `literal`, `get`, `not`, `and`, `or`, `eq`, `ne`, `lt`, `le`, `gt`, and `ge`. Prototype-related path components are refused. `observeContracts` returns proposed actions or explicit capability refusal; only the host may accept and apply an action.

The package binds source identity and inputs; it does not prove host honesty, physical accuracy, or competitive legitimacy. A different machine must run the same source-identified adapter before cross-machine compatibility can be claimed.

## 4. Applications and ownership

`sdk/zeq-lifecycle.js` implements `zeq-application-v1`, `zeq-application-lifecycle-v1`, and `zeq-application-state-v1`.

Descriptors bind application ID/version, content SHA-256, host compatibility, execution profile, requested capabilities, and an optional named sandbox/process boundary. Signed records cover install, enable, disable, update, transfer, attest, and revoke.

- Install/update require an independent asynchronous content-verification callback.
- Grants must be subsets of requested capabilities and are denied by default.
- Update disables the application. Revocation is terminal and clears grants.
- Only the current owner can transition ownership/lifecycle state; transfer requires a distinct public owner anchor.
- `native-unsafe` enablement requires an explicit host decision. This is not sandboxing.
- `auditState` verifies signatures, hashes, links, sequence, ownership, state transitions, update identity/version/grants, and the exported final state.
- `scopedHost` exposes only explicitly mapped methods and checks authorization on every call.

No lifecycle method executes plugin code. A signature, attestation, sandbox label, or ownership record does not make native code safe. Optional authenticated local pairing is not supplied by this module.

## 5. Second reference simulation: `zeq-chamber-v1`

`sdk/reference/zeq-chamber.js`, `zeq_chamber.py`, and `zeq_chamber.c/.h` implement a bounded two-dimensional particle chamber without Doom imports. It uses exact Q10 integer positions and per-host-tic velocities, seeded xorshift32 initialization, complete per-tic `(ax, ay)` commands, saturating velocity bounds, deterministic wall reflection, and canonical little-endian `ZEQCHM1\0` state bytes.

The C adapter exposes `zeq_chamber_init`, `zeq_chamber_step`, `zeq_chamber_state_size`, and `zeq_chamber_canonical` with structured status codes. JavaScript and Python expose `Chamber` and `replay`; Python additionally returns SHA-256 directly. JavaScript hashing remains an adapter operation through `zeq-security.js`.

This is a deliberately small conformance host, not a game engine, calibrated physical model, or replacement for Doom. Its test suite compares C99, JavaScript, and Python final canonical bytes, Python checkpoints, 1,000 deterministic property/replay runs, malformed inputs, C short buffers, domain-pack refusal, and experiment-package reproduction.

## 6. Domain packs and support policy

`sdk/domain-packs/chamber-conformance-v1.json` is a validated synthetic domain pack. It identifies format, ID, version, simulation, provenance, units, constants, limits, and evidence. It explicitly declares constructed conformance data and no physical-accuracy claim.

Profile compatibility requires an exact major-format/profile match and passing shared vectors. A change to authoritative arithmetic, command/state bytes, lifecycle rules, or security semantics requires a new profile version rather than silent reinterpretation. Deprecated readers may remain for migration only when their old semantics are preserved and tested. Unsupported major versions fail closed.

See `zeq-conformance-matrix-v1.md` for tested runtimes and residual limits.
