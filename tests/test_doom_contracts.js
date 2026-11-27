"use strict";
/* Real native Doom events through the PR #3 adapter and a local test evaluator. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Hook = require("../sdk/zeq-contracts.js");
const TestMachine = require("../sdk/zq/tests/contract-test-machine.js");

(async () => {
  let checks = 0;
  assert.deepEqual(Hook.toEvent({ kind: "engine-event", type: 9, gametic: "35", phase: 123, value: 2 }), { type: 9, gametic: 35, phase: 123, value: 2 });
  assert.deepEqual(Hook.toEvent({ type: 5, tic: 60, phase: 0, value: 30 }), { type: 5, gametic: 60, phase: 0, value: 30 });
  assert.throws(() => Hook.toEvent({ type: "x", gametic: "1", phase: 0, value: 0 }), /not an engine event/);
  const shell = fs.readFileSync(path.join(__dirname, "..", "web", "zeq.js"), "utf8");
  assert.ok(/roomSend\("event", \{/.test(shell), "real engine records must reach the direct room transport");
  assert.ok(!shell.includes("ZeqHostHook"), "obsolete sidecar hook must not remain in gameplay observation");
  checks += 5;

  const root = path.join(__dirname, "..");
  if (!fs.existsSync(path.join(root, "doomgeneric", "doomgeneric-headless")) || !fs.existsSync(path.join(root, "doomgeneric", "doom1.wad"))) {
    console.log(`Doom contracts OK: ${checks} checks offline; real engine unavailable`); return;
  }
  const commands = Array.from({ length: 700 }, (_, gametic) => ({ gametic, forwardmove: 0, sidemove: 0, angleturn: 0, chatchar: 0, buttons: 1, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0 }));
  const machine = TestMachine.createMachine();
  const match = await Hook.runMatch(machine, { maxTic: 700, commands });
  const shots = match.decisions.filter((d) => d.type === Hook.EVENT.WEAPON_FIRED);
  const accepted = shots.filter((d) => d.fired);
  assert.ok(match.engineEvents > 0 && shots.length >= 30, `engine events=${match.engineEvents}, shots=${shots.length}`);
  assert.equal(accepted.length, shots.length, "every real engine shot agrees with the cooldown contract");
  assert.equal(match.weapon.fires, 2 * accepted.length - 1);
  assert.equal(match.weapon.rows.length, match.weapon.fires);
  assert.ok(match.weapon.rows.every((r, i) => i === 0 || r[0] >= match.weapon.rows[i - 1][0]));
  assert.equal(match.player.state, "alive");
  checks += 6;

  const vanilla = await Hook.runMatch(TestMachine.createMachine(), { maxTic: 700, commands, ruleset: 0 });
  assert.equal(vanilla.decisions.filter((d) => d.contract === "weapon" || d.contract === "player").length, 0);
  assert.equal(vanilla.weapon.fires, 0);
  checks += 2;
  console.log(`Doom contracts OK: ${checks} checks; real C engine, ${match.engineEvents} events, ${accepted.length}/${shots.length} shots accepted by the local test evaluator, ${match.weapon.fires} weapon rows; three-ruleset identity preserved`);
})().catch((error) => { console.error(error); process.exit(1); });
