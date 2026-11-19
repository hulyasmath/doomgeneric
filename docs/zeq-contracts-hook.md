# Doom on a Zeq Machine: the Contracts Hook

Status: implemented (19 November 2026). Run through the real native engine against a live machine, and through the browser page's own scripts with the real engine's events. Not yet run inside the built WASM game.

## What this is

A proof of concept for the Zeq SDK inside a real game. The Doom engine is not changed. It already emits every event as `{type, gametic, phase, value}`. The hook passes those events to the SDK, and a Zeq machine decides them as state contracts and records each decision on its chain, stamped with its Zeqond.

The SDK itself is engine-neutral. It lives in `hulyasmath/zeq-doomgeneric` and is copied here by version (`sdk/zq/VERSION`). Only the mapping from Doom's events to contracts is Doom-specific.

## What was added

| File | Role |
|---|---|
| `sdk/zq/` | The SDK, copied: `zeq.js`, `zeq-link.js`, `examples/doom/doom-zeq.js`. Do not edit here. |
| `sdk/zeq-contracts.js` | The hook for the native engine: runs the headless engine through `zeq-replay.js` and feeds its events to the contracts |
| `web/zeq.js` | One addition in `queueEngineEvent`: each event is passed to `window.ZeqHostHook` if a page defines it. The game never waits on it. |
| `web/zeq-machine.js` | The browser game's panel: a machine URL and a key, then every engine event is decided on that machine. Loaded by `web/shell.html`, shipped by `build-web.sh`. |
| `sdk/tests/test_contracts_doom.js` | The native test |
| `sdk/tests/test_browser_machine.js` | The browser test |

## The rules

| Doom event | Contract | Transition |
|---|---|---|
| `WEAPON_FIRED` (9), value = weapon | `doom.weapon` | ready → cooling |
| `COOLDOWN_STARTED` (13), value = ready tic | `doom.weapon` | sets the tic from which cooling → ready may fire. The engine emits it just before the `WEAPON_FIRED` of the same tic, so it takes effect after that shot. |
| `DAMAGE` (5), value = damage | `doom.player` | alive → hurt, or → dead at zero health |
| `DEATH` (6) | `doom.player` | → dead |

The machine evaluates every condition. A shot fired before the weapon's ready tic is refused by the machine, with the condition that failed.

## Run it

```sh
# once: a machine and a key (in a folder holding zeq.py)
python3 zeq.py --genesis
python3 zeq.py --key issue doom write

# the real engine, decided on that machine
sh build-headless.sh                     # needs doom1.wad in doomgeneric/
node sdk/zeq-contracts.js --machine /path/to/machine --key /path/to/keyfile --max-tic 700 --hold-fire
```

## Test

```sh
node sdk/tests/test_contracts_doom.js                    # 4 checks offline
ZEQ_MACHINE_DIR=… ZEQ_KEY_FILE=… ZEQ_PIN_FILE=… node sdk/tests/test_contracts_doom.js
```

With a machine: 10 checks. Records in exactly the shape the headless engine prints are decided on the live machine: a shot at tic 35 fires, one at tic 40 is refused (ready at 49), one at 49 fires, 20 then 90 damage take the player to hurt and then dead, and both contracts hold their rows.

With the built engine and `doom1.wad` as well: 19 checks. The real C engine plays E1M1 for 700 tics with fire held, under the `zeq-physics-v1` ruleset.

| Measured in the real run | Result |
|---|---|
| Events the engine emitted | 71: one level event, 35 `COOLDOWN_STARTED`, 35 `WEAPON_FIRED` |
| Shots (pistol, one every 20 tics from tic 14) | 35 |
| Shots the machine accepted | 35 of 35: the engine obeys its own cooldown |
| Rows on the weapon contract's chain | 69: each shot after the first is cooling → ready, then ready → cooling |
| Zeqonds on the chain | never decreasing |
| Player contract | still alive |
| Same match under the vanilla ruleset | no cooldown events, so no decisions: the hook adds nothing where the ruleset emits nothing |

The existing replay suite (`test_replay.js`) passes on the same build.

**What the real run found.** The first real run accepted 1 shot of 35. The bridge had been written against a hand-made stream in which the cooldown event followed its shot. The real engine emits it just before. The machine was right to refuse; the bridge was wrong. It is fixed in the SDK, and the SDK's own suite now carries the engine's recorded order.

## The browser game

The page shows a small **ZEQ MACHINE** panel. The player enters the URL of a machine and a key its owner issued for the page:

```sh
python3 zeq.py --key issue doom-browser write 1        # a write key, good for one day
ZEQ_ORIGINS=http://localhost:8765 python3 zeq.py --serve 8777   # the origin the game is served from
```

- The machine answers a page only if its origin is listed in `ZEQ_ORIGINS`.
- The owner's key never reaches the browser. The page's key is cleared from the field on connect and kept in memory only. Revoke it with `--key revoke`.
- Before connecting, the hook returns at once and costs nothing.
- Events are decided in the order the engine emitted them, without the game waiting.

**Browser test, 20 checks.** A real Chromium page loads the page's own scripts (`zeq-browser.js`, the Doom rules, `zeq-machine.js`). It is handed the real engine's 71 events exactly where `web/zeq.js` hands them over.

| Measured in the browser run | Result |
|---|---|
| Shots the machine accepted | 35 of 35 |
| Shots refused | 0 |
| Rows on the machine's chain for that contract | 69 |
| Key found in storage, cookie, address or markup | no |

**What that test does not include.** The events come from the native headless engine, which is the same C code as the browser game, but the WASM game itself was not built or run: that needs Emscripten 3.1.64, which is not installed here. So `web/zeq.js` calling the hook inside a running browser game is checked by reading the source, not by playing it. The repository's existing browser suites (`test_browser.js`, `test_browser_replay.js`) need that build too and were not run.

## Not done

- The browser panel has not been exercised inside the built WASM game (see above).
- The run used a scratch development machine. A published proof should use the owner's machine.
- Only two rules are mapped (weapon and player). Health pickups, doors, kills and level completion are not.
- A contract proves what the machine decided and when. It does not prove a player was honest.
- `doom1.wad` is not in the repository. It is the shareware file with SHA-256 `1d7d43be…cac771`, placed in `doomgeneric/` for the build.
