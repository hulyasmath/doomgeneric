"use strict";
const assert = require("node:assert/strict");
const Bot = require("../zeq-bot.js");
const Replay = require("../zeq-replay.js");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
function runScheduler(seed, pause = false) {
  const scheduler = new Bot.Scheduler({ seed, maxDecisions: 1200 });
  const commands = [];
  const decisions = [];
  let pausedNeutral = true;
  for (let tic = 0; tic < 700; tic++) {
    if (pause && tic === 100) scheduler.setPaused(true);
    if (pause && tic === 170) scheduler.setPaused(false);
    for (const decision of scheduler.commandsForTic(tic)) decisions.push(decision);
    const command = scheduler.commandForTic(tic);
    if (pause && tic >= 100 && tic < 170) pausedNeutral &&= command.forwardmove === 0 && command.sidemove === 0 && command.angleturn === 0 && command.buttons === 0;
    commands.push({ gametic: tic, ...command });
  }
  const snapshot = scheduler.snapshot();
  scheduler.stop();
  assert.equal(scheduler.commandForTic(700).buttons, 0);
  assert.equal(scheduler.commandForTic(700).forwardmove, 0);
  return { commands, decisions, snapshot, pausedNeutral };
}
(async () => {
  assert.equal(Bot.due(0, 35, 20), 0);
  assert.equal(Bot.due(1, 35, 20), 1);
  assert.equal(Bot.due(2, 35, 20), 1);
  const first = runScheduler(0x12345678, true);
  const second = runScheduler(0x12345678, true);
  assert.deepEqual(first, second);
  assert.equal(first.pausedNeutral, true);
  assert.equal(first.decisions.length, 360); // 400 total slots minus forty paused slots.
  assert.ok(first.decisions.every((command, index) => command.scheduler_sequence >= 0 && (index === 0 || command.scheduler_sequence > first.decisions[index - 1].scheduler_sequence)));
  assert.ok(first.commands.every(command => command.forwardmove >= -128 && command.forwardmove <= 127 && command.angleturn >= -32768 && command.angleturn <= 32767));
  assert.notDeepEqual(first.commands, runScheduler(0x87654321, true).commands);
  const artifact = Replay.createInputArtifact(first.commands, "1234567890abcdef1234567890abcdef");
  const recorded = await Replay.runHeadless({ root: ROOT, runId: artifact.run_id, inputArtifact: artifact, ruleset: 1, skill: 2, maxTic: 700, checkpointInterval: 35 });
  const replayed = await Replay.runHeadless({ root: ROOT, runId: artifact.run_id, inputArtifact: artifact, ruleset: 1, skill: 2, maxTic: 700, checkpointInterval: 35 });
  assert.equal(Replay.compareReproduction(recorded, replayed).status, "match");
  assert.ok(recorded.events.length > 0);
  console.log(JSON.stringify({ ok: true, format: Bot.FORMAT, schedulerHz: 20, hostHz: 35, decisions: first.decisions.length, inputRecords: artifact.count, pauseResumeNeutral: first.pausedNeutral, stopNeutral: true, deterministicRepeat: true, realEngineReplay: "match", stateCheckpoints: recorded.stateHashes.length }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
