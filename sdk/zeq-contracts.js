/*
 * Optional Doom contract audit over the engine's existing event records.
 * The contract machine observes completed native runs; it cannot change them.
 * Node usage: --url http://127.0.0.1:8777 --key /path/to/scoped-key-file.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ZeqBrowser = require("./zq/zeq-browser.js");
const Doom = require("./zq/examples/doom/doom-zeq.js");

function toEvent(record) {
  const gametic = Number(record.gametic ?? record.tic);
  const event = { type: Number(record.type), gametic, phase: Number(record.phase), value: Number(record.value) };
  if (![event.type, event.gametic, event.phase, event.value].every(Number.isInteger)) throw new TypeError("not an engine event: " + JSON.stringify(record).slice(0, 120));
  return event;
}

async function decide(zeq, records, options = {}) {
  const bridge = await Doom.createDoomBridge(zeq, options);
  const decisions = [];
  for (const record of records) {
    const event = toEvent(record);
    const result = await bridge.onEvent(event);
    if (result) decisions.push({ gametic: event.gametic, type: event.type, value: event.value, ...result });
  }
  const [weapon, player] = await Promise.all([bridge.weapon.read(), bridge.player.read()]);
  return { decisions, healthEstimate: bridge.healthEstimate,
    weapon: { id: bridge.weapon.id, state: weapon.state, fires: weapon.fires, definition_sha256: weapon.definition_sha256, rows: weapon.rows },
    player: { id: bridge.player.id, state: player.state, fires: player.fires, definition_sha256: player.definition_sha256, rows: player.rows } };
}

async function runMatch(zeq, engineOptions = {}) {
  const Replay = require("./zeq-replay.js");
  const recorded = await Replay.runHeadless(engineOptions);
  const outcome = await decide(zeq, recorded.events);
  return { run: recorded.run, engineEvents: recorded.events.length, checkpoints: recorded.stateHashes.length, ...outcome };
}

module.exports = { toEvent, decide, runMatch, EVENT: Doom.EVENT };

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const url = arg("--url", process.env.ZEQ_MACHINE_URL), keyFile = arg("--key", process.env.ZEQ_KEY_FILE);
  if (!url || !keyFile) { console.error("usage: node sdk/zeq-contracts.js --url http://127.0.0.1:8777 --key KEYFILE [--max-tic N] [--hold-fire]"); process.exit(2); }
  (async () => {
    const key = fs.readFileSync(path.resolve(keyFile), "utf8").trim();
    const zeq = await ZeqBrowser.connect({ url, key });
    const maxTic = Number(arg("--max-tic", 700)), options = { maxTic };
    if (process.argv.includes("--hold-fire")) options.commands = Array.from({ length: maxTic }, (_, gametic) => ({ gametic, forwardmove: 0, sidemove: 0, angleturn: 0, chatchar: 0, buttons: 1, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0 }));
    const out = await runMatch(zeq, options);
    console.log(JSON.stringify({ run_id: out.run.run_id, engine_events: out.engineEvents, decisions: out.decisions.length, accepted: out.decisions.filter((d) => d.fired).length, refused: out.decisions.filter((d) => !d.fired).length,
      weapon: { state: out.weapon.state, fires: out.weapon.fires }, player: { state: out.player.state, fires: out.player.fires }, health_estimate: out.healthEstimate }, null, 1));
  })().catch((error) => { console.error(error.message); process.exit(1); });
}
