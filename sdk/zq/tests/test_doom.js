"use strict";
/* PR #3 host mapping, corrected for three rulesets and damage-derived health.
 * Default: local conformance evaluator. Optional ZEQ_MACHINE_URL/ZEQ_KEY_FILE:
 * repeat against an external machine without printing or persisting its key. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ZeqHost = require("../zeq-host.js");
const ZeqBrowser = require("../zeq-browser.js");
const Doom = require("../examples/doom/doom-zeq.js");
const TestMachine = require("./contract-test-machine.js");

let claims = 0;
const claim = (label, ok, detail = "") => { assert.ok(ok, `${label}: ${detail}`); claims++; };
const ev = (type, gametic, value) => ({ type, gametic, phase: 0, value });

async function exercise(zeq) {
  const E = Doom.EVENT;
  const real = await Doom.createDoomBridge(zeq);
  const got = [];
  for (const e of [ev(E.RULESET, 0, 1), ev(E.LEVEL, 0, 0x101), ev(E.COOLDOWN_STARTED, 14, 34), ev(E.WEAPON_FIRED, 14, 1),
    ev(E.COOLDOWN_STARTED, 34, 54), ev(E.WEAPON_FIRED, 34, 1), ev(E.COOLDOWN_STARTED, 54, 74), ev(E.WEAPON_FIRED, 54, 1), ev(E.WEAPON_FIRED, 60, 1)]) got.push(await real.onEvent(e));
  claim("real cooldown-before-shot order accepts three spaced shots and refuses an early shot", got[3].fired && got[5].fired && got[7].fired && !got[8].fired && /ready_tic/.test(got[8].why));
  claim("the distinct physics ruleset is declared exactly", real.ruleset.state === "physics" && real.host.memory.ruleset === 1);

  const rules = await Doom.createDoomBridge(zeq);
  const states = [];
  for (const id of [0, 1, 2, 2, 0]) { const r = await rules.onEvent(ev(E.RULESET, id, id)); states.push(r ? r.state : rules.ruleset.state); }
  claim("vanilla, physics, and arcade remain three identities; repeats add no transition", states.join() === "vanilla,physics,arcade,arcade,vanilla" && (await rules.ruleset.read()).fires === 4);
  await assert.rejects(rules.onEvent(ev(E.RULESET, 8, 3)), /unknown Doom ruleset/);
  claim("an unknown ruleset fails instead of being collapsed into Zeq", true);

  const player = await Doom.createDoomBridge(zeq);
  const damage = [];
  for (const e of [ev(E.DAMAGE, 60, 30), ev(E.DAMAGE, 70, 40), ev(E.DAMAGE, 80, 45), ev(E.DEATH, 80, 1)]) damage.push(await player.onEvent(e));
  claim("damage-derived health estimate reaches dead; a later death event is idempotent", damage[0].fired && damage[0].state === "hurt" && damage[2].fired && damage[2].state === "dead" && damage[3] === null && player.healthEstimate === -15);

  const match = await Doom.createDoomBridge(zeq);
  const seen = [];
  for (const e of [ev(E.RULESET, 0, 2), ev(E.LEVEL, 0, 0x101), ev(E.LEVEL, 900, 0x102), ev(E.LEVEL, 1800, 0x105), ev(E.LEVEL, 2000, 0x103), ev(E.SAVE, 2050, 0), ev(E.LOAD, 2100, 0), ev(E.LOAD, 2200, 0)]) seen.push(await match.onEvent(e));
  claim("the narrow level graph refuses a warp and permits the next sequential map", seen[1].fired && seen[2].fired && !seen[3].fired && seen[4].fired);
  claim("save loading irreversibly marks a clean run as resumed", seen[6].fired && seen[6].state === "resumed" && seen[7] === null && match.host.memory.saves === 1);
  const record = await match.host.record();
  const offline = await ZeqHost.audit(null, record), online = await ZeqHost.audit(zeq, record);
  claim("five contract chains audit by links and against the deciding evaluator", offline.ok && !offline.machineChecked && online.ok && Object.keys(record.contracts).length === 5, online.problems.join());
  const forged = JSON.parse(JSON.stringify(record));
  forged.contracts.level.rows[0][1] = "0".repeat(64);
  claim("a changed chain row fails audit", !(await ZeqHost.audit(null, forged)).ok);
}

(async () => {
  for (const definition of [Doom.WEAPON, Doom.PLAYER, Doom.RULESET, Doom.LEVEL, Doom.RUN]) assert.deepEqual(ZeqHost.check(definition), []);
  claim("all five Doom contracts are well formed", true);
  const spec = Doom.hostSpec();
  claim("Doom is isolated to a scoped host description", Object.keys(spec.contracts).join() === "weapon,player,ruleset,level,run" && [3, 4, 5, 6, 7, 8, 9, 13, 14].every((k) => k in spec.on));
  const portable = fs.readdirSync(path.join(__dirname, "..")).filter((f) => f.endsWith(".js"));
  claim("portable runtime modules contain no Doom-specific adapter", portable.every((f) => !/doom/i.test(fs.readFileSync(path.join(__dirname, "..", f), "utf8"))));

  await exercise(TestMachine.createMachine());
  let mode = "local contract evaluator (not a Zeq machine)";
  if (process.env.ZEQ_MACHINE_URL && process.env.ZEQ_KEY_FILE) {
    const key = fs.readFileSync(process.env.ZEQ_KEY_FILE, "utf8").trim();
    const zeq = await ZeqBrowser.connect({ url: process.env.ZEQ_MACHINE_URL, key });
    await exercise(zeq);
    mode = "local evaluator and external machine";
  }
  console.log(`JavaScript OK: Doom contracts ${claims} claims; ${mode}`);
})().catch((error) => { console.error(error); process.exit(1); });
