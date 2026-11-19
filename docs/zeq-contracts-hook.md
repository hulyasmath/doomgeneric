# Doom on a Zeq Machine: the Contracts Hook

Status: hook implemented; tested with engine-format events against a live machine (19 November 2026). The run through the real engine is written and waits for a build with `doom1.wad`.

## What this is

A proof of concept for the Zeq SDK inside a real game. The Doom engine is not changed. It already emits every event as `{type, gametic, phase, value}`. The hook passes those events to the SDK, and a Zeq machine decides them as state contracts and records each decision on its chain, stamped with its Zeqond.

The SDK itself is engine-neutral. It lives in `hulyasmath/zeq-doomgeneric` and is copied here by version (`sdk/zq/VERSION`). Only the mapping from Doom's events to contracts is Doom-specific.

## What was added

| File | Role |
|---|---|
| `sdk/zq/` | The SDK, copied: `zeq.js`, `zeq-link.js`, `examples/doom/doom-zeq.js`. Do not edit here. |
| `sdk/zeq-contracts.js` | The hook for the native engine: runs the headless engine through `zeq-replay.js` and feeds its events to the contracts |
| `web/zeq.js` | One addition in `queueEngineEvent`: each event is passed to `window.ZeqHostHook` if a page defines it. The game never waits on it. |
| `sdk/tests/test_contracts_doom.js` | The test |

## The rules

| Doom event | Contract | Transition |
|---|---|---|
| `WEAPON_FIRED` (9), value = weapon | `doom.weapon` | ready → cooling |
| `COOLDOWN_STARTED` (13), value = ready tic | `doom.weapon` | sets the tic from which cooling → ready may fire |
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
node sdk/zeq-contracts.js --machine /path/to/machine --key /path/to/keyfile --max-tic 700
```

## Test

```sh
node sdk/tests/test_contracts_doom.js                    # 4 checks offline
ZEQ_MACHINE_DIR=… ZEQ_KEY_FILE=… ZEQ_PIN_FILE=… node sdk/tests/test_contracts_doom.js
```

With a machine: 10 checks. Records in exactly the shape the headless engine prints are decided on the live machine: a shot at tic 35 fires, one at tic 40 is refused (ready at 49), one at 49 fires, 20 then 90 damage take the player to hurt and then dead, and both contracts hold their rows.

With the built engine and the WAD as well: the test holds fire for 700 tics on E1M1 in the real C engine and requires that the machine decided at least one shot, with one chain row per shot.

## Not done

- The real-engine part has not been run. The build needs `doom1.wad`, and it was not available where this was written.
- The browser game forwards its events through `window.ZeqHostHook`, but no page here connects that hook to a machine yet.
- A contract proves what the machine decided and when. It does not prove a player was honest.
