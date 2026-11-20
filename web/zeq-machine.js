/* Optional Doom contract-audit panel. The real C engine remains authoritative. */
(function (global) {
"use strict";
if (!global.ZeqPanel || !global.ZeqHost || !global.ZeqBrowser || !global.ZeqDoom) { console.warn("zeq-machine: the Zeq contract SDK is not loaded"); return; }
const panel = global.ZeqPanel.mount({
  host: global.ZeqDoom.hostSpec(),
  hook: "ZeqHostHook",
  parent: global.document.querySelector(".telemetry"),
  readout: (h) => `weapon ${h.contracts.weapon.state}  player ${h.contracts.player.state}  health est. ${h.memory.healthEstimate}\nruleset ${h.contracts.ruleset.state}  level E${h.memory.episode}M${h.memory.map}  run ${h.contracts.run.state}`,
});
const host = () => panel.host();
const state = Object.defineProperties({}, {
  connected: { enumerable: true, get: () => panel.state.connected }, machine: { enumerable: true, get: () => panel.state.machine },
  error: { enumerable: true, get: () => panel.state.error }, last: { enumerable: true, get: () => panel.state.last },
  events: { enumerable: true, get: () => (host() ? host().stats.events : 0) }, accepted: { enumerable: true, get: () => (host() ? host().stats.accepted : 0) },
  refused: { enumerable: true, get: () => (host() ? host().stats.refused : 0) },
  weapon: { enumerable: true, get: () => (host() ? host().contracts.weapon.state : "-") }, player: { enumerable: true, get: () => (host() ? host().contracts.player.state : "-") },
  healthEstimate: { enumerable: true, get: () => (host() ? host().memory.healthEstimate : 100) },
});
global.ZeqMachinePanel = Object.freeze({ state, connect: panel.connect, idle: panel.idle, host, bridge: () => (host() ? { weapon: host().contracts.weapon, player: host().contracts.player } : null) });
})(window);
