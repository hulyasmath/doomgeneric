/*
 * zeq-browser-v1: contract client for an external Zeq machine.
 * Derived from PR #2. HTTP is restricted to loopback; other hosts require HTTPS.
 * Keys remain in caller memory and are never persisted by this module.
 */
(function (global) {
"use strict";

const FORMAT = "zeq-browser-v1";
class ZeqRefusal extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = "ZeqRefusal"; this.code = code; this.detail = String(detail); }
}
const refuse = (code, detail) => { throw new ZeqRefusal(code, detail); };
function checkUrl(text) {
  if (typeof text !== "string") refuse("bad-url", "http(s) URL of a machine");
  let url;
  try { url = new URL(text); } catch (_) { refuse("bad-url", "http(s) URL of a machine"); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol === "http:" && !loopback) refuse("bad-url", "cleartext HTTP is allowed only for a loopback machine");
  if (url.protocol !== "http:" && url.protocol !== "https:") refuse("bad-url", "http(s) URL of a machine");
  if (url.username || url.password || url.search || url.hash) refuse("bad-url", "the machine URL must not contain credentials, a query, or a fragment");
  return text.replace(/\/$/, "");
}

async function connect({ url, key, fetchImpl }) {
  const doFetch = fetchImpl || global.fetch.bind(global);
  const base = checkUrl(url);
  if (typeof key !== "string" || key.length < 8) refuse("no-key", "a key the machine's owner issued for this page");
  async function call(method, route, body) {
    let reply;
    try { reply = await doFetch(base + route, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (err) { refuse("machine-unreachable", `${err.message}; is the machine served, and is this page's origin allowed?`); }
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
  return Object.freeze({ format: FORMAT, url: base, machine: record.zid || null, version: health.version,
    readContract: (id) => call("GET", `/contracts/${encodeURIComponent(id)}`), contract });
}

const api = Object.freeze({ format: FORMAT, ZeqRefusal, connect });
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqBrowser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
