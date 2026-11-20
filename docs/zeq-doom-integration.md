# Doom contract observation on the portable host layer

Status: narrow proof of concept integrated into the reference host. Portable host/browser/panel APIs and the scoped Doom mapping are implemented and tested locally. External-machine-backed Doom runs are available through the panel and native adapter but were not reproduced in the delivery environment because no external Zeq machine or scoped key was available.

## Source and repository ownership

This work reviews and incorporates the useful scope of `hulyasmath/zeq-doomgeneric` PR #3 and the required host/browser/panel subset of its PR #2 base. It does not merge either pull request or adopt the companion Doom branch as a base: that branch predates the current controls and Phase 6 networking source.

- `sdk/zq/zeq-host.js`, `zeq-browser.js`, and `zeq-panel.js` are engine-neutral portable modules.
- `sdk/zq/examples/doom/doom-zeq.js` is a scoped Doom example, not a second engine.
- `sdk/zeq-contracts.js`, `web/zeq-machine.js`, and the event hook in `web/zeq.js` belong to the reference host.
- The ordinary source-controlled, multi-file WASM application remains authoritative. The PR's single-page packaging and in-page Worker shim are not adopted as the release architecture.

## What it demonstrates

A host description maps an existing engine's events to named state-contract transitions. `ZeqHost.attach` deploys the contracts, serializes event decisions in emission order, and exports `zeq-host-record-v1` records. `ZeqHost.audit` checks row links independently and can additionally compare them with the deciding machine.

This complements rather than replaces deterministic replay. Replay asks whether the same authoritative inputs reproduce canonical engine state. Contract observation asks what a separate machine decided about declared semantic events. Neither establishes player honesty or competitive legitimacy.

## Doom mapping

| Real engine event | Contract observation |
|---|---|
| `WEAPON_FIRED` (9) and `COOLDOWN_STARTED` (13) | `doom.weapon`: ready/cooling and exact ready-tic condition; supports the engine's cooldown-before-shot order |
| `DAMAGE` (5) and `DEATH` (6) | `doom.player`: alive/hurt/dead, using an explicitly labeled damage-derived health estimate |
| `RULESET` (14) | `doom.ruleset`: distinct Vanilla (0), Zeq Physics (1), and Legacy Arcade (2) states; unknown IDs fail |
| `LEVEL` (4) | `doom.level`: narrow shareware next-map/map-1/secret-map profile |
| `LOAD` (8) | `doom.run`: irreversible clean-to-resumed marker |

The health estimate starts at 100 and subtracts damage events. It is not synchronized with actual Doom health and does not model pickups, healing, armor, or every damage path. The level contract is not a general map graph. Doors, kills, item state, and comprehensive game semantics are not modeled.

## Authority and evidence limits

The browser hook runs after the existing local event ledger accepts an engine record. It is asynchronous; errors are reported by the panel and do not block play. A refused contract transition does not undo, reject, or roll back the already-emitted C engine event. This is independent adjudication/audit, not authoritative gameplay enforcement or anti-cheat.

Contract records are not canonical Doom snapshots and do not replace `ticcmd_t` replay. A machine decision proves, at most, what that machine decided from the supplied event. It does not prove that the event was truthful. The current browser shell remains single-player. Native Phase 6 predicted or rolled-back events are drained and must never be presented as confirmed contract evidence; any future networked contract bridge must consume confirmed events only.

## Connecting the browser panel

The **ZEQ CONTRACTS** section is in the telemetry layout, not over SAVE, joystick, or FIRE controls. Enter a machine URL and a scoped, expiring write key issued by the machine owner. Cleartext HTTP is accepted only for loopback (`127.0.0.1`, `localhost`, or `[::1]`); other hosts require HTTPS. The machine must allow the page's origin.

The key is held only in the connection closure, cleared from the input after every connection attempt, and never written to local/session storage, cookies, the URL, logs, replay input, or proof exports by this integration. Disconnecting is unnecessary for gameplay: before connection or after a failure, Doom continues normally.

For a native completed-run audit:

```sh
node sdk/zeq-contracts.js --url http://127.0.0.1:8777 --key /path/to/scoped-key-file --max-tic 700 --hold-fire
```

The native adapter observes a completed headless run; it does not control the engine or turn refusals into gameplay changes.

## Reproduced acceptance evidence

```sh
node sdk/zq/tests/test_doom.js
node tests/test_doom_contracts.js
node tests/test_browser_machine.js
```

Locally reproduced results:

- 12 portable contract claims with a clearly labeled local conformance evaluator: cooldown ordering and early-shot refusal, all three rulesets, unknown-ruleset failure, damage/death, level order, save loading, linked-record audit, and tamper detection;
- 12 native checks using the real C engine: 71 events and 35/35 shots accepted by the local evaluator, with 69 weapon rows; Vanilla emits no weapon decisions;
- 24 played-WASM/browser checks: real engine events travel through the actual panel and HTTP client, records audit, the key is not persisted, desktop controls work, and mobile joystick/FIRE remain topmost;
- the existing arithmetic, security, content, native replay, MCP, sidecar, Phase 6 networking, signed-PWAD, controls, and browser/native canonical replay gates pass.

`sdk/zq/tests/contract-test-machine.js` is a test stand-in, not a Zeq machine, signer, security boundary, or evidence of external-machine compatibility. PR-reported live-machine, driverless-car, single-page packaging, and alternate-toolchain results are not claimed as independently reproduced. To run the portable mapping against an external machine, set `ZEQ_MACHINE_URL` and `ZEQ_KEY_FILE` for `sdk/zq/tests/test_doom.js`; secrets must not be pasted into source, telemetry, or command logs.

## Remaining work

1. Reproduce the external-machine path with an owner-issued scoped key and publish machine/version-specific results.
2. Add authoritative health/state event mappings only through versioned engine changes and replay/network regression tests.
3. Define bounded scenario packages, resource budgets, cancellation, and a general level/scenario graph before claiming the full Phase 11 roadmap.
4. Test a materially different non-Doom host against the same portable contracts before claiming Phase 13 multi-engine validation.
