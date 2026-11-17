# ZEQ // DOOM PROTOCOL

The original Doom engine (doomgeneric) compiled to WebAssembly, with the Zeq layer
embedded in the engine itself — not a replacement game. Every demon, map, weapon,
and frame comes from the unmodified shareware `doom1.wad`; the upgrades hook into
real engine paths (`P_FireWeapon`, `P_DamageMobj`, `P_KillMobj`, `P_MovePlayer`,
`G_DoLoadLevel`, save/load).

## What the Zeq layer adds

- **1.287 Hz carrier** — computed from Doom tics with exact integer math:
  `phase = (gametic * 1287) % 35000`. The carrier also modulates player thrust by
  ±2.4% through Doom's fixed-point `finesine` table.
- **Phase-locked damage** — release a shot while the carrier crosses the mint
  window (φ ≈ 0.25, phase 6475–11025 of 35000) and confirmed hits deal +50%.
  Projectile phase state travels with the missile, so a delayed rocket or BFG
  impact is attributed to the shot that created it, not the latest trigger pull.
- **Engine event ledger** — phase shots/hits/kills, level entry, damage, deaths,
  and save/load events leave the engine through a ring buffer and are chained in
  the browser with SHA-256. Verification proves chain integrity only — it is not
  proof of a competitively legitimate run.
- **Sovereign save capsule** — one local Doom savegame (`.dsg`) stored in
  browser storage, restorable across page reloads, exportable as a file. Local
  only: no account, no cloud sync; export before clearing browser data.
- **Browser shell** — scalable 8:5 viewport, live carrier meter, telemetry rail,
  pointer-lock mouse aim, touch controls (44px targets, safe-area aware), and
  original MIDI music via bundled freepats instruments.

## Controls

WASD/arrows move and turn · click the viewport for mouse aim · LMB/Ctrl fire ·
Space use · 1–7 weapons · Tab automap · Shift run · Alt strafe · Esc Doom menu.
On touch screens: D-pad + MAP/USE/FIRE; drag the viewport to turn.

## Building the browser version

```sh
# requires Emscripten (emsdk) on PATH
sh build-web.sh        # builds doomgeneric + shell into dist/
cd dist && python3 -m http.server 8080
```

`build-web.sh` runs `make -f Makefile.emscripten` (SDL2/SDL2_mixer ports,
`--shell-file web/shell.html`, preloaded `doom1.wad` + timidity config + freepats)
and copies the result to `dist/`.

## Limitations (by design)

- Single-player only; no netcode.
- The ledger is tamper-evident, not tamper-proof; it cannot prove a clean run.
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
|DG_Init              |Initialize your platfrom (create window, framebuffer, etc...).
|DG_DrawFrame         |Frame is ready in DG_ScreenBuffer. Copy it to your platform's screen.
|DG_SleepMs           |Sleep in milliseconds.
|DG_GetTicksMs        |The ticks passed since launch in milliseconds.
|DG_GetKey            |Provide keyboard events.
|DG_SetWindowTitle    |Not required. This is for setting the window title as Doom sets this from WAD file.

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
