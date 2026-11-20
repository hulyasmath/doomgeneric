# ZEQ // DOOM PROTOCOL

The original Doom engine (doomgeneric) compiled to WebAssembly, with the Zeq layer
embedded in the engine itself — not a replacement game. Every demon, map, weapon,
and frame comes from the unmodified shareware `doom1.wad`; the upgrades hook into
real engine paths (`P_FireWeapon`, `P_DamageMobj`, `P_KillMobj`, `P_MovePlayer`,
`G_DoLoadLevel`, save/load).

## Program map and repository ownership

- **[Consolidated Phase 0–13 roadmap](docs/zeq-roadmap-v1.md)** — the controlling
  scope, dependency order, acceptance gates, and precise implementation status.
- **[Third-party SDK integration guide](docs/zeq-sdk-integration-v1.md)** — the
  engine-neutral adapter, arithmetic, units, replay, evidence, security, and
  conformance contract for existing games and simulations.
- **[Doom protocol specification](docs/zeq-doomgeneric-protocol-v1.md)** — exact
  wire formats and Doom-specific integration rules.
- **[Doom contract observation](docs/zeq-doom-integration.md)** — the reviewed
  PR #3 proof of concept, its reproduced tests, and its authority limits.

`hulyasmath/doomgeneric` owns the complete game and reference integration.
`hulyasmath/zeq-doomgeneric` is the portable SDK distribution: portable modules,
schemas, vectors, tests, and integration guides, without a second maintained Doom
game tree. The repositories align by SDK release identity, not by mirroring every
engine file into both projects.

Phases 0–4, the Phase 5 signed-content/sealed-parcel SDK milestone, the single
signed-PWAD reference-host loader, and the Phase 6 native two-client reference
profile are implemented and tested as described below. Multi-file/PK3 loading,
remaining Phase 5 hardening, browser networking, and broader network hardening
remain open. Phases 7–10 are pending; Phase 11 has only the narrow contract-
observation proof of concept described below, and the general Phase 11–13 programs
remain unfinished. The roadmap distinguishes partial, pending, and proposed work
so future framework capabilities are not presented as shipping features.

## What the Zeq layer adds

- **Exact zeq-time-v1 arithmetic (Phase 1)** — the real C engine computes the
  777000777 ns Zeqond clock, Q64 phase, Q30 carrier/lapse values, and Q40 cycle
  derivative from each Doom gametic. The browser independently repeats the
  calculation with BigInt JavaScript and compares the integer fields on the same
  tic. Generated sine tables and shared vectors keep C, JavaScript, and Python
  conformant; host `sin`/`sqrt` do not decide cross-runtime results.
- **Lapse-integrated gameplay (Phase 2)** — `zeq-physics-v1` evaluates force and
  acceleration inside deterministic midpoint integration for real mobj X/Y/Z
  movement. Doom still owns collision detection, sliding, floor/ceiling response,
  and friction. A stationary zero-force object remains unchanged.
- **Finite-interval impulses** — actual damage and radius-attack paths queue X/Y/Z
  impulses, which are integrated with ordinary acceleration over 32 deterministic
  substeps. They are not instantaneous momentum additions or final-value carrier
  multipliers.
- **Exact weapon cooldowns** — each weapon's original Doom attack cadence is
  converted to a rational Zeqond duration and an exact ready tic. `P_FireWeapon`
  enforces readiness; the HUD countdown is informational only.
- **Three explicit rulesets** — `doom-vanilla-v1` keeps original gameplay;
  `zeq-physics-v1` enables the Phase 2 paths without legacy bonuses; and
  `zeq-arcade-legacy-v1` preserves the approximate `1287/35000` carrier, ±2.4%
  thrust modulation, and optional +50% phase-hit damage as legacy behavior.
  Ruleset changes take effect at a new deployment; loading a save restores its
  saved ruleset.
- **Engine event ledger** — level, combat, firing, impact, explosion, impulse,
  cooldown, ruleset, death, and save/load events leave the engine through a ring
  buffer and are chained and signed by the browser or sidecar. Verification
  proves local chain integrity only, not competitive legitimacy. Detailed impulse
  telemetry is diagnostic and is outside the event hash chain. Replay remains
  `unavailable` until a real headless Doom run reproduces the recorded states.
- **Signed event/proof formats (Phase 3)** — browser and Node records use
  `zeq-event-v2`, canonical JSON, SHA-256 chain links, and Ed25519 signatures.
  Public trust anchors are self-declared unless explicitly trusted. The sidecar
  private key stays in its mode-0600 key file; browser signing keys are
  nonextractable Web Crypto keys.
- **Real ZEQC3 save capsules (Phase 3)** — a local Doom savegame is sealed as
  `ZEQC3 [salt 16][iv 12][ciphertext][tag 16]` using scrypt
  `N=2^17, r=8, p=1`, the HITE domain prefix, and AES-256-GCM. Browser key
  derivation runs in a Worker. Wrong PINs, weak new PINs, tampering, and
  truncation fail closed. Extension v2 preserves the ruleset, global Doom clocks,
  cooldowns, and Zeq mobj state; old unextended saves load as Vanilla. Saves are
  local only: no account or cloud sync; export before clearing browser data.
- **Real headless replay and MCP (Phase 4)** — the native null-platform build runs
  the original C engine at 35 Hz, captures/accepts complete 24-byte `ticcmd_t`
  records, and hashes canonical gameplay state with SHA-256. A `match` requires a
  second real engine process to reproduce every checkpoint. Signed proof-v2 export
  and a local stdio MCP adapter implement run/stop/status, live input, state reads,
  proof export, and independent verification. MCP run/input controls are opt-in and
  reject PINs, private keys, private seeds, and machine equations. The current
  replay scope is fresh single-player E1M1. The separate browser-to-native gate
  exports actual browser input and requires equal canonical hashes at matching
  completed tics with the real renderer enabled.
- **Signed content and single-PWAD loading (Phase 5)** — `zeq-content.js`
  implements Ed25519-signed mod manifests, explicit publisher trust, bound file
  sizes and SHA-256 digests, safe relative paths, machine records, and expiring
  sealed parcels using X25519, HKDF-SHA256, and AES-256-GCM. Independent Python
  and JavaScript vectors match exactly. The reference host additionally accepts a
  compatible `doomgeneric-zeq-v1` manifest containing exactly one PWAD and no
  dependencies. After SDK verification, the C engine copies the bytes,
  independently recomputes SHA-256, bounds-checks the PWAD directory and every
  lump, and installs the same owned buffer through a memory-backed WAD reader.
  `zeq-content-load-evidence-v1` records trust, ruleset, content identity, and the
  result in the signed local evidence chain. Multi-file mods and PK3 remain
  pending; parcels never execute or automatically load plaintext.
- **Deterministic two-client networking and rollback (Phase 6 reference profile)** —
  two separate native headless Doom processes exchange complete authoritative
  `ticcmd_t` commands over real TCP. A versioned session descriptor binds engine,
  WAD/content, ruleset, map, skill, settings, tick rate, initial RNG, and session
  identity. Peers predict at most 8 tics inside a bounded 32-tic command/snapshot
  window, restore actual Doom save-state snapshots on misprediction, resimulate,
  and compare confirmed canonical SHA-256 checkpoints. Delay, jitter, loss, and
  duplicates are tested through a real TCP proxy; conflicting commands, malformed
  frames, mismatched sessions/descriptors, and state-hash divergence fail closed.
  This is a fresh-E1M1, two-player native conformance profile only: browser
  multiplayer, authenticated peer identity, TLS, Internet matchmaking, mid-game
  join, and more than two players are not supplied.
- **Portable contract observation (reviewed PR #3 proof of concept)** — an
  engine-neutral host layer maps real Doom events into weapon, player, ruleset,
  level, and save-load contract decisions. The browser's optional ZEQ CONTRACTS
  panel connects to an owner-configured external machine with a scoped key;
  the native adapter can audit a completed headless run. Three ruleset identities
  remain distinct. This is asynchronous observation, not gameplay enforcement:
  refusals do not undo C events, health is damage-derived only, and external-
  machine-backed runs remain unverified in the delivery environment.
- **Browser shell** — scalable viewport, live same-tic conformance panel,
  ruleset/cooldown/impulse diagnostics, pointer-lock mouse aim, resilient keyboard,
  standard-gamepad and analog touch controls, and original MIDI music via bundled
  freepats instruments. Touch controls stay inside the fullscreen layer, with an
  expanded fallback for browsers without element fullscreen. Holds and analog
  sources are released on key/pointer release, cancellation, lost capture,
  controller disconnect, blur, page exit, orientation change, or visibility loss.

## Controls

WASD/arrows move and turn · click the viewport for mouse aim · LMB/Ctrl fire ·
Space use · 1–7 weapons · Tab automap · Shift run · Alt strafe · Esc Doom menu.
Standard gamepads: left stick moves/strafes, right stick turns, A uses, X or RT
fires, Y opens the map, and the D-pad moves/turns. On iPhones, iPads, and other
touch screens, drag the round joystick to move/turn and use MAP/USE/FIRE with
independent simultaneous touches. FULL expands the real viewport and controls.

## Building the browser version

```sh
# requires Emscripten (emsdk) on PATH
sh build-web.sh        # builds doomgeneric + shell into dist/
cd dist && python3 -m http.server 8080
```

`build-web.sh` runs `make -f Makefile.emscripten` (SDL2/SDL2_mixer ports,
`--shell-file web/shell.html`, preloaded `doom1.wad` + timidity config + freepats)
and copies the result plus the browser SDK modules to `dist/`. Every copied
artifact must be nonempty and match its source byte-for-byte or the build fails.

Regenerate the shared tables/vectors and run all native/reference conformance
suites with:

```sh
python3 sdk/zeq_time.py --generate
python3 sdk/zeq_physics.py --generate
python3 sdk/tests/test_time.py
python3 sdk/tests/test_physics.py
cc -std=c99 -Wall -Wextra -Werror -I sdk \
  sdk/tests/test_time.c sdk/zeq_time.c -o /tmp/zeq-test-time
/tmp/zeq-test-time
cc -std=c99 -Wall -Wextra -Werror -I sdk \
  sdk/tests/test_physics.c sdk/zeq_physics.c sdk/zeq_time.c -o /tmp/zeq-test-physics
/tmp/zeq-test-physics
node sdk/tests/test_time.js
node sdk/tests/test_physics.js
python3 sdk/tests/test_content.py
node sdk/tests/test_content.js
```

The Phase 5 content tests cover signed manifests, explicit trust, bound file
hashes, path refusal, sealed-parcel opening, expiry/replay/recipient failures,
and authenticated-data tampering. The Python test independently generates the
public deterministic test vector; the JavaScript test must reproduce its exact
canonical parcel and ID and reject tag tampering and replay. The checked-in
vector keys are public test keys only, never production credentials.

The browser's **RUN CONFORMANCE TEST** control runs 34 time/physics checks and
reports the latest live same-tic C/WASM-versus-JavaScript comparison.

## Building and testing real headless replay

```sh
sh build-headless.sh
node sdk/tests/test_replay.js
node sdk/tests/test_mcp.js
node sdk/tests/test_net.js
node sdk/zq/tests/test_doom.js
node tests/test_doom_contracts.js
node tests/test_net_engine.js
```

The replay tests execute actual movement/fire commands, compare two independent
processes, require an altered command to mismatch, reject input/state tampering,
and verify a signed proof with a third real run. The MCP tests cover initialize and
tool discovery, read-only defaults, offline/live input, stop/status/state, proof
export, verification, and secret rejection. With the browser preview served on
port 8765, `node sdk/tests/test_browser_replay.js` additionally exports actual
browser `ticcmd_t` records, replays them in the native C engine, and requires the
WASM/native canonical hashes to match. The test also drives movement, turning,
and firing with the real renderer enabled. `node tests/test_browser_content.js`
signs a conformance-only PWAD, exercises the visible load form, reads its marker
lump back through Doom, and requires wrong-trust, modified-byte,
incompatible-ruleset, malformed-WAD, independent C digest-mismatch, and duplicate
loads to fail closed. `node tests/test_browser_controls.js` additionally drives
keyboard, standard-gamepad, analog joystick, simultaneous touch/fire, disconnect,
pointer-cancellation, iPhone/iPad layout, native fullscreen, and expanded-fallback
checks. The Phase 6 engine gate launches two actual native engines, verifies exact
confirmed checkpoint chains for 140 direct tics and 180 delayed/jittered/lossy/
duplicated tics, requires genuine rollback and resimulation, refuses identity and
protocol mismatches, and detects deliberate hash corruption in either direction.
`node tests/test_browser_machine.js` plays the real WASM build through the
contract panel and HTTP client against a labeled local conformance evaluator,
audits the resulting records, checks key non-persistence, and verifies mobile
control layering. It is not an external-machine test.
Build scripts regenerate all large arithmetic vectors from the committed Python
generators; generated outputs and WAD/build artifacts are not source-controlled.

## Limitations (by design)

- The browser game is single-player. Phase 6 networking exists only in the native
  headless two-process reference profile, not in the live browser shell.
- Network sessions start fresh on shareware E1M1 with exactly two players.
  `BT_SPECIAL` commands, mid-game join, saved-game resume, PK3/multi-file network
  content, and more than two players are unsupported. The TCP handshake checks a
  shared session ID and descriptor digest but does not authenticate a person or
  protect transport; do not expose it as a secure public multiplayer service.
- Phase 5 loads exactly one verified PWAD per accepted manifest in the reference
  host. Multi-file mods and PK3 are unsupported. Parcels never execute content.
- The ledger is tamper-evident, not tamper-proof; it cannot prove a clean run.
- Contract observation covers five narrow rules and is not authoritative
  enforcement, anti-cheat, comprehensive Doom semantics, or proof of honest input.
  External-machine compatibility is exposed but not locally reproduced without
  an owner-provided machine and scoped key.
- Saves and settings live in this browser only.
- Shareware episode (Knee-Deep in the Dead) from the unmodified id Software WAD.

---

# doomgeneric
The purpose of doomgeneric is to make porting Doom easier.
Of course Doom is already portable but with doomgeneric it is possible with just a few functions.

To try it you will need a WAD file (game data). If you don't own the game, shareware version is freely available (doom1.wad).

# porting
Create a file named doomgeneric_yourplatform.c and just implement these functions to suit your platform.
* DG_Init
* DG_DrawFrame
* DG_SleepMs
* DG_GetTicksMs
* DG_GetKey

|Functions            |Description|
|---------------------|-----------|
|DG_Init              |Initialize your platfrom (create window, framebuffer, etc...).|
|DG_DrawFrame         |Frame is ready in DG_ScreenBuffer. Copy it to your platform's screen.|
|DG_SleepMs           |Sleep in milliseconds.|
|DG_GetTicksMs        |The ticks passed since launch in milliseconds.|
|DG_GetKey            |Provide keyboard events.|
|DG_SetWindowTitle    |Not required. This is for setting the window title as Doom sets this from WAD file.|

### main loop
At start, call doomgeneric_Create().

In a loop, call doomgeneric_Tick().

In simplest form:
```
int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);

    while (1)
    {
        doomgeneric_Tick();
    }
    
    return 0;
}
```

# sound
Sound is much harder to implement! If you need sound, take a look at SDL port. It fully supports sound and music! Where to start? Define FEATURE_SOUND, assign DG_sound_module and DG_music_module.

# platforms
Ported platforms include Windows, X11, SDL, emscripten. Just look at (doomgeneric_win.c, doomgeneric_xlib.c, doomgeneric_sdl.c).
Makefiles provided for each platform.

## emscripten
You can try it directly here:
https://ozkl.github.io/doomgeneric/

emscripten port is based on SDL port, so it supports sound and music! For music, timidity backend is used.

## Windows
![Windows](screenshots/windows.png)

## X11 - Ubuntu
![Ubuntu](screenshots/ubuntu.png)

## X11 - FreeBSD
![FreeBSD](screenshots/freebsd.png)

## SDL
![SDL](screenshots/sdl.png)
