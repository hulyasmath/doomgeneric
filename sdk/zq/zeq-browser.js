/*
 * zeq-browser: a browser game or page on a Zeq machine.
 *
 * The same handles as zeq.js gives a Node host, over the machine's wire with
 * fetch: contract(definition) and reactor(definition), plus ask and pulse.
 * Nothing is computed or decided here; the machine does both.
 *
 *   const zeq = await ZeqBrowser.connect({ url: "http://127.0.0.1:8777", key });
 *   const door = await zeq.contract(definition);
 *   await door.fire("open", { keys: 1 });        // { fired, state, proof, why }
 *
 * The key. A browser never holds the owner's key. The owner issues a scoped,
 * expiring one for the page (python3 zeq.py --key issue NAME write DAYS) and
 * revokes it when done. This client keeps it in memory only: never in
 * localStorage, a cookie, the address bar or a log.
 *
 * Origins. The machine answers a page only if its origin is listed in
 * ZEQ_ORIGINS, or, for a page with no origin (a local file or a sandboxed
 * frame), only on a request that carries a key.
 */
(function (global) {
"use strict";

const FORMAT = "zeq-browser-v1";
class ZeqRefusal extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = "ZeqRefusal"; this.code = code; this.detail = String(detail); }
}
const refuse = (code, detail) => { throw new ZeqRefusal(code, detail); };

async function connect({ url, key, fetchImpl }) {
  const doFetch = fetchImpl || global.fetch.bind(global);
  if (typeof url !== "string" || !/^https?:\/\/[^\s]+$/.test(url)) refuse("bad-url", "http(s) URL of a machine");
  if (typeof key !== "string" || key.length < 8) refuse("no-key", "a key the machine's owner issued for this page");
  const base = url.replace(/\/$/, "");
  async function call(method, route, body) {
    let reply;
    try { reply = await doFetch(base + route, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (err) { refuse("machine-unreachable", `${err.message}; is the machine served, and is this page's origin allowed (ZEQ_ORIGINS)?`); }
    const text = await reply.text();
    if (reply.status === 401 || reply.status === 403) refuse("key-refused", `${reply.status}: the key is wrong, revoked, expired, or its scope does not reach ${route}`);
    if (!reply.ok) refuse("machine-refused", `${reply.status} ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch (_) { return text; }
  }
  const health = await call("GET", "/health");
  if (!health || health.status !== "ok") refuse("machine-unreachable", "the machine did not answer /health");
  const record = await call("GET", "/record");

  async function contract(definition) {
    const d = await call("POST", "/contracts", { definition });
    if (!d.id) refuse("machine-refused", JSON.stringify(d).slice(0, 300));
    let state = d.state;
    const result = (r) => { state = r.state; return { fired: r.verdict === "fired", wouldFire: r.verdict === "fires", verdict: r.verdict, state: r.state,
      proof: r.verdict === "fired" ? r.detail : null, why: r.verdict === "fired" ? null : r.detail }; };
    const fire = async (to, input, dry) => result(await call("POST", `/contracts/${encodeURIComponent(d.id)}/fire`, { to, input: input || {}, dry_run: dry }));
    return Object.freeze({ id: d.id, name: d.name, definitionSha256: d.definition_sha256, get state() { return state; },
      fire: (to, input) => fire(to, input, false), dryRun: (to, input) => fire(to, input, true),
      read: async () => { const c = await call("GET", `/contracts/${encodeURIComponent(d.id)}`); state = c.state; return c; } });
  }
  async function reactor(definition) {
    const d = await call("POST", "/reactors", { definition });
    if (!d.id) refuse("machine-refused", JSON.stringify(d).slice(0, 300));
    const id = encodeURIComponent(d.id);
    return Object.freeze({ id: d.id,
      step: async (env) => { const r = await call("POST", `/reactors/${id}/step`, { env: env || {} }); const s = r.step || {};
        return { value: s.value, verified: s.verification === "verified", verification: s.verification, zeqond: s.zeqond, index: s.step_index, proof: s.proof, previous: s.prev_state_proof, status: r.status }; },
      read: () => call("GET", `/reactors/${id}`), close: () => call("POST", `/reactors/${id}/close`, {}) });
  }
  return Object.freeze({ format: FORMAT, url: base, machine: record.zid || null, version: health.version,
    ask: async (question) => { const r = await call("POST", "/ask", { question }); const a = r.answer || r; if (a.refused || a.verification === "refused") refuse("machine-refused", a.refused || "refused"); return a; },
    readContract: (id) => call("GET", `/contracts/${encodeURIComponent(id)}`), contract, reactor });
}

const api = Object.freeze({ format: FORMAT, ZeqRefusal, connect });
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqBrowser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
