"use strict";
/* Conformance stand-in only: not a Zeq machine, signer, or security boundary. */
const crypto = require("node:crypto");
const http = require("node:http");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const TEST_ZID = `ZEQ7${"A".repeat(26)}`;

function createMachine() {
  const contracts = new Map();
  let sequence = 0, clock = 0;
  function evaluate(condition, input) {
    if (!condition) return true;
    /* Test definitions are trusted source. Production decisions belong to the real machine. */
    return Boolean(new Function("input", `"use strict"; return (${condition});`)(input));
  }
  function view(c) {
    return { id: c.id, name: c.definition.name, definition: c.definition, definition_sha256: c.definitionSha256,
      state: c.state, fires: c.rows.length, rows: c.rows.map((r) => r.slice()), prev: c.head, chain_valid: true };
  }
  async function deploy(definition) {
    const id = `contract-test-${++sequence}`;
    const initial = Object.keys(definition.states).find((s) => definition.states[s].initial);
    const c = { id, definition, definitionSha256: sha256(JSON.stringify(definition)), state: initial, rows: [], head: "0".repeat(64) };
    contracts.set(id, c);
    return view(c);
  }
  async function fire(id, to, input = {}, dryRun = false) {
    const c = contracts.get(id);
    if (!c) throw new Error("unknown test contract");
    const transition = c.definition.transitions.find((t) => t.from === c.state && t.to === to);
    if (!transition) return { verdict: "refused", state: c.state, detail: `no transition from ${c.state} to ${to}` };
    if (!evaluate(transition.condition, input)) return { verdict: "won't_fire", state: c.state, detail: `condition false: ${transition.condition}` };
    if (dryRun) return { verdict: "fires", state: c.state, detail: "would fire" };
    const previous = c.head;
    const stateHash = sha256(JSON.stringify({ id, from: c.state, to, input, fires: c.rows.length + 1 }));
    c.state = to;
    c.rows.push([++clock, stateHash, previous]);
    c.head = sha256(`${clock}|${stateHash}|${previous}`);
    return { verdict: "fired", state: c.state, detail: sha256(`${id}|${clock}`).slice(0, 16) };
  }
  async function contract(definition) {
    const d = await deploy(definition);
    const result = (r) => ({ fired: r.verdict === "fired", wouldFire: r.verdict === "fires", verdict: r.verdict, state: r.state,
      proof: r.verdict === "fired" ? r.detail : null, why: r.verdict === "fired" ? null : r.detail });
    return Object.freeze({ id: d.id, name: d.name, definitionSha256: d.definition_sha256,
      get state() { return contracts.get(d.id).state; },
      fire: async (to, input) => result(await fire(d.id, to, input, false)),
      dryRun: async (to, input) => result(await fire(d.id, to, input, true)),
      read: async () => view(contracts.get(d.id)) });
  }
  return Object.freeze({
    machine: TEST_ZID,
    contract,
    readContract: async (id) => view(contracts.get(id)),
    _deploy: deploy,
    _fire: fire,
    _get: (id) => view(contracts.get(id)),
    _list: () => [...contracts.keys()].map((id) => view(contracts.get(id))),
  });
}

async function serve(machine, { key = "contract-test-key", origin = null } = {}) {
  const send = (res, status, body, req) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (origin) { headers["Access-Control-Allow-Origin"] = origin; headers.Vary = "Origin"; }
    res.writeHead(status, headers); res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "60" });
      return res.end();
    }
    if (req.headers.authorization !== `Bearer ${key}`) return send(res, 403, { error: "key refused" }, req);
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", version: "contract-test-v1" }, req);
    if (req.method === "GET" && url.pathname === "/record") return send(res, 200, { zid: TEST_ZID }, req);
    if (req.method === "GET" && url.pathname === "/contracts") return send(res, 200, machine._list(), req);
    const match = /^\/contracts\/([^/]+)(\/fire)?$/.exec(url.pathname);
    if (req.method === "GET" && match && !match[2]) {
      try { return send(res, 200, machine._get(decodeURIComponent(match[1])), req); } catch (e) { return send(res, 404, { error: e.message }, req); }
    }
    if (req.method === "POST" && (url.pathname === "/contracts" || (match && match[2]))) {
      let text = "";
      req.on("data", (chunk) => { text += chunk; if (text.length > 1048576) req.destroy(); });
      return req.on("end", () => {
        try {
          const body = JSON.parse(text || "{}");
          const out = url.pathname === "/contracts" ? machine._deploy(body.definition) : machine._fire(decodeURIComponent(match[1]), body.to, body.input, body.dry_run);
          Promise.resolve(out).then((value) => send(res, 200, value, req), (error) => send(res, 400, { error: error.message }, req));
        } catch (error) { send(res, 400, { error: error.message }, req); }
      });
    }
    send(res, 404, { error: "not found" }, req);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, key, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { createMachine, serve, TEST_ZID };
