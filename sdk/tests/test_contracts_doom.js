"use strict";
/* The Doom hook: engine events decided as state contracts on a Zeq machine.
 * Needs a machine (ZEQ_MACHINE_DIR, ZEQ_KEY_FILE, ZEQ_PIN_FILE). The real-engine part also needs the built
 * headless engine and doom1.wad (sh build-headless.sh). Each part reports unavailable when its need is not met. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Hook = require("../zeq-contracts.js");
const Zeq = require("../zq/zeq.js");

(async () => {
  let checks = 0;
  /* offline: the engine's record shape maps to the SDK's event */
  assert.deepEqual(Hook.toEvent({ kind: "engine-event", type: 9, gametic: "35", phase: 123, value: 2 }), { type: 9, gametic: 35, phase: 123, value: 2 });
  assert.deepEqual(Hook.toEvent({ type: 5, tic: 60, phase: 0, value: 30 }), { type: 5, gametic: 60, phase: 0, value: 30 });
  assert.throws(() => Hook.toEvent({ type: "x", gametic: "1", phase: 0, value: 0 }), /not an engine event/);
  assert.ok(/window\.ZeqHostHook/.test(fs.readFileSync(path.join(__dirname, "..", "..", "web", "zeq.js"), "utf8")), "the browser game forwards its events");
  checks += 4;

  const dir = process.env.ZEQ_MACHINE_DIR, keyFile = process.env.ZEQ_KEY_FILE;
  if (!dir || !keyFile) { console.log(`Doom contracts OK: ${checks} checks offline; machine unavailable (set ZEQ_MACHINE_DIR, ZEQ_KEY_FILE, ZEQ_PIN_FILE)`); return; }
  const zeq = await Zeq.local({ dir, keyFile, port: Number(process.env.ZEQ_PORT || 8795) });
  let engine = "real engine unavailable (build it with sh build-headless.sh; it needs doom1.wad)";
  try {
    /* records exactly as the headless engine prints them and zeq-replay.js parses them */
    const E = Hook.EVENT, rec = (type, gametic, value) => ({ kind: "engine-event", type, gametic: String(gametic), phase: 0, value });
    const out = await Hook.decide(zeq, [rec(E.RULESET, 0, 1), rec(E.WEAPON_FIRED, 35, 1), rec(E.COOLDOWN_STARTED, 35, 49), rec(E.WEAPON_FIRED, 40, 1),
      rec(E.WEAPON_FIRED, 49, 1), rec(E.COOLDOWN_STARTED, 49, 63), rec(E.DAMAGE, 90, 20), rec(E.DAMAGE, 120, 90), rec(E.DEATH, 120, 1)]);
    const verdicts = out.decisions.map((d) => `${d.gametic}:${d.contract}:${d.verdict}`);
    assert.deepEqual(verdicts, ["35:weapon:fired", "40:weapon:won't_fire", "49:weapon:fired", "90:player:fired", "120:player:fired"]);
    assert.equal(out.weapon.state, "cooling"); assert.equal(out.weapon.fires, 3);
    assert.equal(out.player.state, "dead"); assert.equal(out.player.fires, 2); assert.equal(out.health, -10);
    assert.ok(out.player.rows.every((r) => Number.isInteger(r[0]) && /^[0-9a-f]{64}$/.test(r[1])));
    checks += 6;

    const root = path.join(__dirname, "..", "..");
    if (fs.existsSync(path.join(root, "doomgeneric", "doomgeneric-headless")) && fs.existsSync(path.join(root, "doomgeneric", "doom1.wad"))) {
      /* the real C engine: hold fire for 20 seconds of game time on E1M1 */
      const commands = []; for (let tic = 0; tic < 700; tic++) commands.push({ gametic: tic, forwardmove: 0, sidemove: 0, angleturn: 0, chatchar: 0, buttons: 1, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0 });
      const match = await Hook.runMatch(zeq, { maxTic: 700, commands });
      const engineShots = match.decisions.filter((d) => d.type === Hook.EVENT.WEAPON_FIRED);
      const accepted = engineShots.filter((d) => d.fired);
      assert.ok(match.engineEvents > 0, "the engine emitted events");
      assert.ok(engineShots.length >= 30, `the engine fired ${engineShots.length} shots in 700 tics`);
      assert.equal(accepted.length, engineShots.length, "the machine accepted every shot the real engine made: the engine obeys its own cooldown");
      // each shot after the first is two rows: cooling -> ready (the cooldown has elapsed), then ready -> cooling
      assert.equal(match.weapon.fires, 2 * accepted.length - 1);
      assert.equal(match.weapon.rows.length, match.weapon.fires);
      assert.ok(match.weapon.rows.every((r, i) => i === 0 || r[0] >= match.weapon.rows[i - 1][0]), "Zeqonds on the chain never decrease");
      assert.equal(match.player.state, "alive");
      checks += 7;
      // the same match with the vanilla ruleset emits no cooldown events, so nothing reaches the weapon contract
      const vanilla = await Hook.runMatch(zeq, { maxTic: 700, commands, ruleset: 0 });
      assert.equal(vanilla.decisions.length, 0); assert.equal(vanilla.weapon.fires, 0);
      checks += 2;
      const shots = accepted;
      engine = `real engine on E1M1, 700 tics: ${match.engineEvents} events, ${shots.length} of ${engineShots.length} shots accepted by the machine, ${match.weapon.fires} rows on the weapon chain; vanilla ruleset: no decisions`;
    }
  } finally { await zeq.close(); }
  console.log(`Doom contracts OK: ${checks} checks; engine-format stream decided on a live machine; ${engine}`);
})().catch((error) => { console.error(error); process.exit(1); });
