/*
 * Doom on a Zeq machine: the real engine's events decided as state contracts.
 *
 * This is the hook between the reference host and the Zeq SDK (sdk/zq, copied
 * from hulyasmath/zeq-doomgeneric; see sdk/zq/VERSION). It changes nothing in
 * the engine. The headless engine already prints every event it emits as
 *   ZEQJ{"kind":"engine-event","type":9,"gametic":"35","phase":..,"value":2}
 * and zeq-replay.js already collects them. Here they are fed, in order, to the
 * SDK's Doom contracts on a machine, which decides each transition and chains
 * each fire on its Zeqond clock.
 *
 *   node sdk/zeq-contracts.js --machine DIR --key KEYFILE [--max-tic 700] [--hold-fire]
 *
 * Without input the player stands still and nothing is decided; --hold-fire holds the trigger.
 *
 * The browser game has the same hook: web/zeq.js calls window.ZeqHostHook
 * with each event, if a page defines it.
 */
"use strict";

const path = require("node:path");
const Zeq = require("./zq/zeq.js");
const Doom = require("./zq/examples/doom/doom-zeq.js");

/* An engine record (from the headless ZEQJ stream, or the browser ledger) as the SDK's event. */
function toEvent(record) {
  const gametic = Number(record.gametic ?? record.tic);
  const event = { type: Number(record.type), gametic, phase: Number(record.phase), value: Number(record.value) };
  if (![event.type, event.gametic, event.phase, event.value].every(Number.isInteger)) throw new TypeError("not an engine event: " + JSON.stringify(record).slice(0, 120));
  return event;
}

/* Feed engine events, in the order the engine emitted them, to the contracts on `zeq`. */
async function decide(zeq, records, options = {}) {
  const bridge = await Doom.createDoomBridge(zeq, options);
  const decisions = [];
  for (const record of records) {
    const event = toEvent(record);
    const result = await bridge.onEvent(event);
    if (result) decisions.push({ gametic: event.gametic, type: event.type, value: event.value, ...result });
  }
  const [weapon, player] = await Promise.all([bridge.weapon.read(), bridge.player.read()]);
  return { decisions, health: bridge.health,
    weapon: { id: bridge.weapon.id, state: weapon.state, fires: weapon.fires, definition_sha256: weapon.definition_sha256, rows: weapon.rows },
    player: { id: bridge.player.id, state: player.state, fires: player.fires, definition_sha256: player.definition_sha256, rows: player.rows } };
}

/* Run the real headless engine (zeq-replay.js) and decide the match it played. */
async function runMatch(zeq, engineOptions = {}) {
  const Replay = require("./zeq-replay.js");
  const recorded = await Replay.runHeadless(engineOptions);
  const outcome = await decide(zeq, recorded.events);
  return { run: recorded.run, engineEvents: recorded.events.length, checkpoints: recorded.stateHashes.length, ...outcome };
}

module.exports = { toEvent, decide, runMatch, EVENT: Doom.EVENT };

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const dir = arg("--machine", process.env.ZEQ_MACHINE_DIR), keyFile = arg("--key", process.env.ZEQ_KEY_FILE);
  if (!dir || !keyFile) { console.error("usage: node sdk/zeq-contracts.js --machine DIR --key KEYFILE [--max-tic N]"); process.exit(2); }
  (async () => {
    const zeq = await Zeq.local({ dir: path.resolve(dir), keyFile: path.resolve(keyFile), port: Number(arg("--port", 8794)) });
    try {
      const maxTic = Number(arg("--max-tic", 700)), options = { maxTic };
      if (process.argv.includes("--hold-fire")) options.commands = Array.from({ length: maxTic }, (_, gametic) => ({ gametic, forwardmove: 0, sidemove: 0, angleturn: 0, chatchar: 0, buttons: 1, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0 }));
      const out = await runMatch(zeq, options);
      console.log(JSON.stringify({ run_id: out.run.run_id, engine_events: out.engineEvents, decisions: out.decisions.length, accepted: out.decisions.filter((d) => d.fired).length, refused: out.decisions.filter((d) => !d.fired).length, weapon: { state: out.weapon.state, fires: out.weapon.fires }, player: { state: out.player.state, fires: out.player.fires }, health: out.health }, null, 1));
    } finally { await zeq.close(); }
  })().catch((error) => { console.error(error.message); process.exit(1); });
}
