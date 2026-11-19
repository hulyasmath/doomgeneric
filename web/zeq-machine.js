/*
 * The browser game on a Zeq machine.
 *
 * A small panel: the player gives the URL of a machine and a key its owner
 * issued for this page. From then on every event the engine emits (web/zeq.js
 * passes each one to window.ZeqHostHook) is decided by that machine as a state
 * contract and recorded on its chain. The game never waits for the machine and
 * plays the same with or without it.
 *
 * Needs sdk/zq/zeq-browser.js and sdk/zq/examples/doom/doom-zeq.js loaded first.
 * The key stays in memory: it is cleared from the field and never stored.
 */
(function (global) {
"use strict";
if (!global.ZeqBrowser || !global.ZeqDoom) { console.warn("zeq-machine: the Zeq SDK is not loaded"); return; }
const doc = global.document;
const state = { connected: false, machine: null, accepted: 0, refused: 0, events: 0, weapon: "-", player: "-", health: 100, last: "", error: "" };
let bridge = null, queue = Promise.resolve();

const panel = doc.createElement("section");
panel.id = "zeq-machine";
panel.setAttribute("aria-label", "Zeq machine");
panel.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:50;width:290px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#07100b;color:#bfe8cb;border:1px solid #1f3a2a;padding:8px";
panel.innerHTML = '<b style="color:#5fd08a">ZEQ MACHINE</b> <span id="zm-status">not connected</span>'
  + '<div id="zm-form"><input id="zm-url" value="http://127.0.0.1:8777" aria-label="machine URL" autocomplete="off" style="width:100%;box-sizing:border-box;margin:4px 0;background:#0d1a12;color:inherit;border:1px solid #1f3a2a;padding:3px">'
  + '<input id="zm-key" type="password" placeholder="key issued for this page" aria-label="key" autocomplete="off" style="width:100%;box-sizing:border-box;margin:0 0 4px;background:#0d1a12;color:inherit;border:1px solid #1f3a2a;padding:3px">'
  + '<button id="zm-connect" type="button" style="font:inherit;background:#12301f;color:inherit;border:1px solid #1f3a2a;padding:3px 8px;cursor:pointer">connect</button></div>'
  + '<div id="zm-readout" style="margin-top:4px;white-space:pre-wrap"></div>';
const $ = (id) => panel.querySelector("#" + id);

function render() {
  $("zm-status").textContent = state.connected ? `on ${state.machine.slice(0, 12)}…` : state.error ? "refused" : "not connected";
  $("zm-readout").textContent = state.error ? state.error
    : state.connected ? `events ${state.events}  accepted ${state.accepted}  refused ${state.refused}\nweapon ${state.weapon}  player ${state.player}  health ${state.health}\n${state.last}` : "";
}

async function connect() {
  state.error = "";
  try {
    const zeq = await global.ZeqBrowser.connect({ url: $("zm-url").value.trim(), key: $("zm-key").value });
    $("zm-key").value = "";
    bridge = await global.ZeqDoom.createDoomBridge(zeq);
    state.connected = true; state.machine = zeq.machine || "machine"; state.weapon = bridge.weapon.state; state.player = bridge.player.state;
    $("zm-form").style.display = "none";
  } catch (error) { state.error = `${error.code || error.name}: ${error.detail || error.message}`; }
  render();
}

/* web/zeq.js calls this with every engine event. Events are decided in the order the engine emitted them. */
global.ZeqHostHook = function (event) {
  if (!bridge) return Promise.resolve(null);
  queue = queue.then(async () => {
    state.events++;
    const result = await bridge.onEvent(event);
    if (result) {
      if (result.fired) state.accepted++; else state.refused++;
      state.last = `tic ${event.gametic}: ${result.contract} ${result.verdict}${result.why ? ` (${result.why})` : ""}`;
    }
    state.weapon = bridge.weapon.state; state.player = bridge.player.state; state.health = bridge.health;
    render();
    return result;
  }).catch((error) => { state.error = `${error.code || error.name}: ${error.detail || error.message}`; render(); return null; });
  return queue;
};

/* for tests and for other panels: the state, the bridge, and a promise that settles when every queued event is decided */
global.ZeqMachinePanel = Object.freeze({ state, connect, idle: () => queue, bridge: () => bridge });
const mount = () => { doc.body.appendChild(panel); $("zm-connect").addEventListener("click", connect); render(); };
if (doc.body) mount(); else doc.addEventListener("DOMContentLoaded", mount);
})(window);
