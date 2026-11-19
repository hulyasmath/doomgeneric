/*
 * The browser game on a Zeq machine.
 *
 * Everything here is the SDK's own, game-neutral layer: zeq-panel asks the
 * player for a machine and a key, zeq-host decides the engine's events in
 * order, and Doom contributes only its host description (doom-zeq.js: which
 * engine event moves which rule). web/zeq.js passes every engine event to
 * window.ZeqHostHook. The game never waits for the machine and plays the same
 * with or without it.
 *
 * Needs sdk/zq/zeq-browser.js, zeq-host.js, zeq-panel.js and
 * sdk/zq/examples/doom/doom-zeq.js loaded first.
 */
(function (global) {
"use strict";
if (!global.ZeqPanel || !global.ZeqHost || !global.ZeqBrowser || !global.ZeqDoom) { console.warn("zeq-machine: the Zeq SDK is not loaded"); return; }
const panel = global.ZeqPanel.mount({
  host: global.ZeqDoom.hostSpec(),
  hook: "ZeqHostHook",
  readout: (h) => `weapon ${h.contracts.weapon.state}  player ${h.contracts.player.state}  health ${h.memory.health}\nruleset ${h.contracts.ruleset.state}  level E${h.memory.episode}M${h.memory.map}  run ${h.contracts.run.state}`,
});
/* for tests and for other panels: one flat view of the panel and the host */
const host = () => panel.host();
const state = Object.defineProperties({}, {
  connected: { enumerable: true, get: () => panel.state.connected }, machine: { enumerable: true, get: () => panel.state.machine },
  error: { enumerable: true, get: () => panel.state.error }, last: { enumerable: true, get: () => panel.state.last },
  events: { enumerable: true, get: () => (host() ? host().stats.events : 0) }, accepted: { enumerable: true, get: () => (host() ? host().stats.accepted : 0) },
  refused: { enumerable: true, get: () => (host() ? host().stats.refused : 0) },
  weapon: { enumerable: true, get: () => (host() ? host().contracts.weapon.state : "-") }, player: { enumerable: true, get: () => (host() ? host().contracts.player.state : "-") },
  health: { enumerable: true, get: () => (host() ? host().memory.health : 100) },
});
global.ZeqMachinePanel = Object.freeze({ state, connect: panel.connect, idle: panel.idle, host, bridge: () => (host() ? { weapon: host().contracts.weapon, player: host().contracts.player } : null) });
})(window);
