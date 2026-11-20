/*
 * zeq-host-v1: ordered, engine-neutral event-to-contract adaptation.
 * Derived from the agnostic-SDK PR #2, reviewed for PR #3.
 * The host observes events; it does not make them true or undo host behavior.
 */
(function (global) {
"use strict";

const FORMAT = "zeq-host-v1";
const RECORD_FORMAT = "zeq-host-record-v1";
class ZeqRefusal extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = "ZeqRefusal"; this.code = code; this.detail = String(detail); }
}
const refuse = (code, detail) => { throw new ZeqRefusal(code, detail); };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function check(definition) {
  const problems = [];
  if (!isObject(definition)) return ["a definition is an object: { name, states, transitions }"];
  if (typeof definition.name !== "string" || !definition.name) problems.push("name: a non-empty string");
  const states = isObject(definition.states) ? definition.states : null;
  if (!states || !Object.keys(states).length) problems.push("states: at least one state");
  else {
    const initial = Object.keys(states).filter((s) => states[s] && states[s].initial);
    if (initial.length !== 1) problems.push(`states: exactly one initial state, found ${initial.length}`);
  }
  if (!Array.isArray(definition.transitions) || !definition.transitions.length) problems.push("transitions: at least one transition");
  else definition.transitions.forEach((t, i) => {
    const at = `transitions[${i}]`;
    if (!isObject(t)) { problems.push(`${at}: an object`); return; }
    if (states && !(t.from in states)) problems.push(`${at}: from "${t.from}" is not a state`);
    if (states && !(t.to in states)) problems.push(`${at}: to "${t.to}" is not a state`);
    if (states && states[t.from] && states[t.from].terminal) problems.push(`${at}: leaves the terminal state "${t.from}"`);
    if (typeof t.operator !== "string" || !t.operator) problems.push(`${at}: operator, the name of the move`);
    if (t.condition !== undefined) {
      if (typeof t.condition !== "string") problems.push(`${at}: condition is text`);
      else {
        if (/\//.test(t.condition)) problems.push(`${at}: condition divides; multiply both sides instead, so every machine decides alike`);
        if (/\d\.\d/.test(t.condition)) problems.push(`${at}: condition uses a fraction; use integers`);
      }
    }
  });
  return problems;
}

async function attach(zeq, spec) {
  if (!zeq || typeof zeq.contract !== "function") refuse("no-machine", "zeq: a contract-capable machine handle");
  if (!isObject(spec) || !isObject(spec.contracts) || !Object.keys(spec.contracts).length) refuse("bad-host", "contracts: at least one named contract definition");
  if (!isObject(spec.on) || !Object.keys(spec.on).length) refuse("bad-host", "on: at least one event handler");
  const kindOf = typeof spec.kind === "function" ? spec.kind : (e) => e.kind;
  for (const [key, def] of Object.entries(spec.contracts)) { const p = check(def); if (p.length) refuse("bad-contract", `${key}: ${p.join("; ")}`); }
  for (const [kind, h] of Object.entries(spec.on)) {
    if (typeof h === "function") continue;
    if (!isObject(h) || !(h.contract in spec.contracts) || typeof h.to !== "string") refuse("bad-host", `on.${kind}: a function, or { contract, to, input }`);
    if (!(h.to in spec.contracts[h.contract].states)) refuse("bad-host", `on.${kind}: "${h.to}" is not a state of ${h.contract}`);
  }
  const contracts = {};
  for (const [key, def] of Object.entries(spec.contracts)) contracts[key] = await zeq.contract(def);
  const memory = Object.assign({}, spec.memory || {});
  const stats = { events: 0, accepted: 0, refused: 0, fires: 0 };
  const decisions = [];
  let current = null, queue = Promise.resolve(), sequence = 0;

  async function fire(contract, to, input) {
    const c = contracts[contract];
    if (!c) refuse("bad-host", `no contract named ${contract}`);
    const r = await c.fire(to, input || {});
    const out = Object.assign({ contract }, r);
    if (r.fired) stats.fires++;
    if (current) { if (r.fired) current.fired++; else current.refused++; }
    decisions.push(Object.assign({ sequence: current ? current.sequence : null, kind: current ? current.kind : null }, out));
    return out;
  }
  const handle = Object.freeze({ fire, memory, contracts, state: (contract) => { const c = contracts[contract]; if (!c) refuse("bad-host", `no contract named ${contract}`); return c.state; } });

  async function decide(event) {
    if (!isObject(event)) refuse("bad-event", "an event is an object");
    if (spec.validate) { const why = spec.validate(event); if (typeof why === "string") refuse("bad-event", why); }
    const kind = kindOf(event);
    const h = spec.on[kind];
    stats.events++;
    if (h === undefined) return null;
    const mine = current = { sequence: sequence++, kind, fired: 0, refused: 0 };
    try {
      let r = typeof h === "function" ? await h(event, handle) : await fire(h.contract, h.to, typeof h.input === "function" ? h.input(event, memory) : (h.input || {}));
      if (r === undefined) r = null;
      return r;
    } finally { if (mine.refused) stats.refused++; else if (mine.fired) stats.accepted++; current = null; }
  }
  function send(event) {
    const result = queue.then(() => decide(event));
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function record() {
    await queue;
    const out = {};
    for (const [key, c] of Object.entries(contracts)) { const r = await c.read(); out[key] = { id: c.id, name: r.definition.name, definition_sha256: r.definition_sha256, state: r.state, fires: r.fires, rows: r.rows, head: r.prev }; }
    return { format: RECORD_FORMAT, host: spec.name || "host", machine: zeq.machine || null, stats: Object.assign({}, stats), contracts: out };
  }
  return Object.freeze({ format: FORMAT, name: spec.name || "host", contracts, memory, stats, send, record, idle: () => queue, decisions: () => decisions.slice(),
    states: () => Object.fromEntries(Object.entries(contracts).map(([k, c]) => [k, c.state])) });
}

async function sha256Hex(text) {
  if (typeof require === "function") { try { return require("node:crypto").createHash("sha256").update(text).digest("hex"); } catch (_) { /* browser */ } }
  const d = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function audit(zeq, record) {
  const problems = [], seen = {};
  if (!isObject(record) || record.format !== RECORD_FORMAT || !isObject(record.contracts)) return { ok: false, problems: [`not a ${RECORD_FORMAT} record`], contracts: {} };
  for (const [key, c] of Object.entries(record.contracts)) {
    const note = (text) => problems.push(`${key}: ${text}`);
    if (!Array.isArray(c.rows) || c.rows.length !== c.fires) { note("the rows are not one per fire"); continue; }
    let linked = true;
    for (let i = 0; i < c.rows.length; i++) {
      const [z, state, prev] = c.rows[i], next = await sha256Hex(`${z}|${state}|${prev}`);
      if (i + 1 < c.rows.length ? c.rows[i + 1][2] !== next : c.head !== next) { linked = false; note(`row ${i} does not link to ${i + 1 < c.rows.length ? "the next row" : "the head"}`); break; }
      if (i && c.rows[i - 1][0] > z) { linked = false; note(`row ${i} is earlier than the row before it`); break; }
    }
    seen[key] = { rows: c.rows.length, linked, machine: null };
    if (!zeq) continue;
    let live;
    try { live = await zeq.readContract(c.id); } catch (e) { note(`the machine does not hold contract ${c.id}`); seen[key].machine = false; continue; }
    const same = live.definition_sha256 === c.definition_sha256 && live.rows.length >= c.rows.length && c.rows.every((r, i) => r.join("|") === live.rows[i].join("|"));
    if (live.definition_sha256 !== c.definition_sha256) note("the machine holds a different definition");
    else if (!same) note("the machine's chain does not begin with these rows");
    if (live.chain_valid !== true) note("the machine does not call its chain valid");
    seen[key].machine = same && live.chain_valid === true;
  }
  return { ok: problems.length === 0, problems, contracts: seen, machineChecked: !!zeq };
}

const api = Object.freeze({ format: FORMAT, recordFormat: RECORD_FORMAT, ZeqRefusal, attach, check, audit });
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqHost = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
