/*
 * zeq-panel: a browser game or simulation on a Zeq machine, in three lines.
 *
 *   <script src="zeq-browser.js"></script>
 *   <script src="zeq-host.js"></script>
 *   <script src="zeq-panel.js"></script>
 *   <script>
 *     const panel = ZeqPanel.mount({ host: { name: "my-game", contracts: {...}, on: {...} } });
 *     // in the game, wherever something happens:
 *     panel.send({ kind: "use" });
 *   </script>
 *
 * The panel asks the player for the URL of a machine and a key its owner issued
 * for this page. Until they connect, send() does nothing and the game plays the
 * same. After, every event is decided by that machine and recorded on its chain.
 * The game never waits for the machine.
 *
 * The key stays in memory: it is cleared from the field and never stored.
 * Needs zeq-browser.js and zeq-host.js loaded first.
 */
(function (global) {
"use strict";

const FORMAT = "zeq-panel-v1";

/* mount({ host, url, readout, hook, parent }) -> { send, connect, idle, state, host } */
function mount(options) {
  const { ZeqBrowser, ZeqHost, document: doc } = global;
  if (!ZeqBrowser || !ZeqHost) throw new Error("zeq-panel: load zeq-browser.js and zeq-host.js first");
  if (!options || !options.host) throw new Error("zeq-panel: host, the same description ZeqHost.attach takes");
  const state = { connected: false, machine: null, last: "", error: "" };
  let host = null;

  const panel = doc.createElement("section");
  panel.id = "zeq-machine";
  panel.setAttribute("aria-label", "Zeq machine");
  panel.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:50;width:290px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#07100b;color:#bfe8cb;border:1px solid #1f3a2a;padding:8px";
  const field = "width:100%;box-sizing:border-box;background:#0d1a12;color:inherit;border:1px solid #1f3a2a;padding:3px;font:inherit";
  const el = (tag, id, css) => { const e = doc.createElement(tag); e.id = id; if (css) e.style.cssText = css; return e; };
  const title = doc.createElement("b"); title.textContent = "ZEQ MACHINE "; title.style.color = "#5fd08a";
  const status = el("span", "zm-status");
  const form = el("div", "zm-form");
  const url = el("input", "zm-url", field + ";margin:4px 0"); url.value = options.url || "http://127.0.0.1:8777"; url.setAttribute("aria-label", "machine URL"); url.autocomplete = "off";
  const key = el("input", "zm-key", field + ";margin:0 0 4px"); key.type = "password"; key.placeholder = "key issued for this page"; key.setAttribute("aria-label", "key"); key.autocomplete = "off";
  const button = el("button", "zm-connect", "font:inherit;background:#12301f;color:inherit;border:1px solid #1f3a2a;padding:3px 8px;cursor:pointer"); button.type = "button"; button.textContent = "connect";
  const readout = el("div", "zm-readout", "margin-top:4px;white-space:pre-wrap");
  form.append(url, key, button); panel.append(title, status, form, readout);

  const describe = options.readout || ((h) => Object.entries(h.states()).map(([k, v]) => `${k} ${v}`).join("  "));
  function render() {
    status.textContent = state.connected ? `on ${String(state.machine).slice(0, 12)}…` : state.error ? "refused" : "not connected";
    readout.textContent = state.error ? state.error
      : state.connected ? `events ${host.stats.events}  accepted ${host.stats.accepted}  refused ${host.stats.refused}\n${describe(host)}\n${state.last}` : "";
  }
  const fail = (error) => { state.error = `${error.code || error.name}: ${error.detail || error.message}`; render(); };

  async function connect() {
    state.error = "";
    try {
      const zeq = await ZeqBrowser.connect({ url: url.value.trim(), key: key.value });
      key.value = "";
      host = await ZeqHost.attach(zeq, options.host);
      state.connected = true; state.machine = zeq.machine || "machine";
      form.style.display = "none";
    } catch (error) { state.error = `${error.code || error.name}: ${error.detail || error.message}`; }
    render();
  }
  /* The game calls this with every event. Not connected: nothing happens. */
  function send(event) {
    if (!host) return Promise.resolve(null);
    return host.send(event).then((result) => {
      if (result && result.contract) state.last = `${result.contract} ${result.verdict}${result.why ? ` (${result.why})` : ""}`;
      render(); return result;
    }, (error) => { fail(error); return null; });
  }
  /* A host that already emits events through one global function can name it here. */
  if (options.hook) global[options.hook] = send;

  const place = () => { (options.parent || doc.body).appendChild(panel); button.addEventListener("click", connect); render(); };
  if (doc.body || options.parent) place(); else doc.addEventListener("DOMContentLoaded", place);
  return Object.freeze({ format: FORMAT, send, connect, state, idle: () => (host ? host.idle() : Promise.resolve()), host: () => host });
}

global.ZeqPanel = Object.freeze({ format: FORMAT, mount });
})(typeof globalThis !== "undefined" ? globalThis : this);
