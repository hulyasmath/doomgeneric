/*
 * zeq-link-v1: the mathematics comes from the machine.
 *
 * The framework generates its mathematics from the shelf. This SDK does not
 * re-derive it. A host declares what it needs as questions in the machine's
 * own grammar (a pack); a Zeq machine answers each one through its five steps,
 * seals it, and exports the sealed answer as code: the equation as a function,
 * the proven value, a self-test, the envelope and the machine's public record.
 * `build` collects that into a folder with a manifest; `load` hands a host
 * only functions whose file hash, self-test and both signatures hold.
 *
 * Two transports reach a machine:
 *   machine({ dir })      the machine's own file, run in the folder it was born in
 *   remote({ url, key })  the machine's wire (POST /ask, /export, /verify, GET /find)
 *
 * Nothing here computes physics. A generated function is the machine's logic
 * with SI at its door, exactly as the machine exported it; only its sealed
 * value is proven, and a new proven value comes from asking the machine again.
 * At run time a host needs no machine and no network: load() is offline.
 *
 * Secrets: the machine's PIN stays in the file the owner names (ZEQ_PIN_FILE)
 * and a wire key stays in the caller's memory; neither is written to a pack,
 * a manifest or generated code.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const FORMAT = "zeq-link-v1";
const PACK_FORMAT = "zeq-pack-v1";
const MANIFEST_FORMAT = "zeq-generated-v1";
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_ENTRIES = 256, MAX_QUESTION = 4096, MAX_OUTPUT = 16 * 1024 * 1024;
const LANGS = { javascript: "js", c: "c", python: "py" };

class ZeqRefusal extends Error {
  constructor(code, detail, step = null) { super(`${code}: ${detail}`); this.name = "ZeqRefusal"; this.code = code; this.detail = String(detail); this.step = step; }
}
const refuse = (code, detail, step) => { throw new ZeqRefusal(code, detail, step); };
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
function canonical(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new TypeError("canonical numbers are safe integers; carry others as text"); return String(v); }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  throw new TypeError("unsupported canonical value");
}

/* A machine's answer, or its refusal with the step that stopped it. */
function readAnswer(record) {
  const a = record && record.answer;
  if (!a || typeof a !== "object") refuse("bad-reply", "the machine's reply carries no answer");
  if (a.verification === "refused" || a.refused) {
    const text = String(a.refused || "refused");
    refuse("machine-refused", text, (/^(FORM|BIND|COMPUTE|MEASURE|SEAL)\b/.exec(text) || [])[1] || null);
  }
  if (!a.sealed || !a.sealed.signature) refuse("unsealed", "the answer is not sealed by a machine", "SEAL");
  return a;
}

/* ---- transports ----------------------------------------------------------------------- */

/* The machine's own file, in the folder where that machine was born. */
function machine({ dir, file = "zeq.py", python = "python3", pinFile = process.env.ZEQ_PIN_FILE, timeoutMs = 120000 }) {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, file))) refuse("no-machine", `${file} not found in ${root}`);
  if (!fs.existsSync(path.join(root, "machine.json"))) refuse("no-machine", `no machine is born in ${root}; its owner runs --genesis there first`);
  const env = { ...process.env };
  if (pinFile) env.ZEQ_PIN_FILE = pinFile;
  function run(args) {
    const r = spawnSync(python, [file, ...args], { cwd: root, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: MAX_OUTPUT });
    if (r.error) refuse("machine-unreachable", r.error.message);
    return r;
  }
  return Object.freeze({
    transport: "file",
    async ask(question) {
      const r = run(["--ask", question, "--json"]);
      let record;
      try { record = JSON.parse(r.stdout); } catch (_) { refuse("bad-reply", (r.stderr || r.stdout || "").trim().split("\n").pop() || "no JSON from the machine"); }
      return readAnswer(record);
    },
    async exportCode(sealed, lang = "javascript") {
      if (!LANGS[lang]) refuse("bad-language", `one of ${Object.keys(LANGS).join(", ")}`);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-link-"));
      try {
        const envelope = path.join(tmp, "envelope.json"), out = path.join(tmp, `out.${LANGS[lang]}`);
        fs.writeFileSync(envelope, JSON.stringify(sealed), { mode: 0o600 });
        const r = run(["--export", envelope, "--lang", lang, "--out", out]);
        if (!fs.existsSync(out)) refuse("export-refused", (r.stdout + r.stderr).trim().split("\n").pop() || "the machine made no code");
        return fs.readFileSync(out, "utf8");
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    },
    async find(term) { return run(["--find", term]).stdout; },
  });
}

/* The machine's wire. The key is the caller's; it is sent only as the bearer of each request. */
function remote({ url, key, fetchImpl = globalThis.fetch }) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) refuse("bad-url", "http(s) URL of a machine");
  if (typeof key !== "string" || !key) refuse("no-key", "a key the machine's owner issued");
  const base = url.replace(/\/$/, "");
  async function call(method, route, body) {
    let reply;
    try { reply = await fetchImpl(base + route, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (err) { refuse("machine-unreachable", err.message); }
    const text = await reply.text();
    if (!reply.ok) refuse("machine-refused", `${reply.status} ${text.slice(0, 300)}`);
    return text;
  }
  return Object.freeze({
    transport: "wire",
    async ask(question) { return readAnswer(JSON.parse(await call("POST", "/ask", { question }))); },
    async exportCode(sealed, lang = "javascript") {
      if (!LANGS[lang]) refuse("bad-language", `one of ${Object.keys(LANGS).join(", ")}`);
      const text = await call("POST", "/export", { sealed, lang });
      try { const j = JSON.parse(text); return typeof j === "string" ? j : j.code || j.source || text; } catch (_) { return text; }
    },
    async find(term) { return call("GET", `/find?q=${encodeURIComponent(term)}`); },
    async verify(sealed) { return JSON.parse(await call("POST", "/verify", { sealed })); },
    async health() { return JSON.parse(await call("GET", "/health")); },
    async record() { return JSON.parse(await call("GET", "/record")); },
    /* State contracts: the machine holds the definition, evaluates every condition and chains every fire. */
    contracts: Object.freeze({
      async deploy(definition) { return JSON.parse(await call("POST", "/contracts", { definition })); },
      async list() { return JSON.parse(await call("GET", "/contracts")); },
      async get(id) { return JSON.parse(await call("GET", `/contracts/${encodeURIComponent(id)}`)); },
      async fire(id, to, input = {}, dryRun = false) { return JSON.parse(await call("POST", `/contracts/${encodeURIComponent(id)}/fire`, { to, input, dry_run: dryRun })); },
    }),
    /* Reactors: a digital twin whose solver is the machine's door; every step asked, sealed, linked and gated. */
    reactors: Object.freeze({
      async deploy(definition) { return JSON.parse(await call("POST", "/reactors", { definition })); },
      async list() { return JSON.parse(await call("GET", "/reactors")); },
      async get(id) { return JSON.parse(await call("GET", `/reactors/${encodeURIComponent(id)}`)); },
      async step(id, env = {}) { return JSON.parse(await call("POST", `/reactors/${encodeURIComponent(id)}/step`, { env })); },
      async close(id) { return JSON.parse(await call("POST", `/reactors/${encodeURIComponent(id)}/close`, {})); },
    }),
  });
}

/*
 * Serve a born machine on this device's loopback and return a link to it.
 * The key is one its owner issued (`--key issue NAME write`), read from the
 * file the owner names; it is held in memory and never written anywhere.
 * stop() ends the served process.
 */
async function serve({ dir, keyFile, port = 8777, file = "zeq.py", python = "python3", pinFile = process.env.ZEQ_PIN_FILE, waitMs = 60000, origins }) {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, "machine.json"))) refuse("no-machine", `no machine is born in ${root}`);
  let key;
  try { key = fs.readFileSync(keyFile, "utf8").trim(); } catch (_) { refuse("no-key", "keyFile: a key the machine's owner issued"); }
  const env = { ...process.env };
  if (pinFile) env.ZEQ_PIN_FILE = pinFile;
  if (origins) env.ZEQ_ORIGINS = [].concat(origins).join(",");      // browser origins the machine will answer
  const child = spawn(python, [file, "--serve", String(port)], { cwd: root, env, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`, link = remote({ url, key });
  const stop = () => { try { child.kill(); } catch (_) { /* already gone */ } };
  const until = Date.now() + waitMs;
  for (;;) {
    try { const h = await link.health(); if (h.status === "ok") break; } catch (_) { /* not up yet */ }
    if (child.exitCode !== null || Date.now() > until) { stop(); refuse("machine-unreachable", "the machine did not come up on the wire"); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return Object.freeze({ link, url, stop });
}

/* ---- packs ------------------------------------------------------------------------------ */

function validatePack(pack) {
  if (!pack || pack.format !== PACK_FORMAT) refuse("bad-pack", `format must be ${PACK_FORMAT}`);
  if (!NAME.test(pack.name || "")) refuse("bad-pack", "pack name: lower case letters, digits and _");
  if (!Array.isArray(pack.entries) || !pack.entries.length || pack.entries.length > MAX_ENTRIES) refuse("bad-pack", `1..${MAX_ENTRIES} entries`);
  const seen = new Set();
  for (const e of pack.entries) {
    if (!e || !NAME.test(e.name || "")) refuse("bad-pack", `entry name ${JSON.stringify(e && e.name)}`);
    if (seen.has(e.name)) refuse("bad-pack", `duplicate entry ${e.name}`);
    seen.add(e.name);
    if (typeof e.question !== "string" || !e.question.includes("?") || e.question.length > MAX_QUESTION) refuse("bad-pack", `${e.name}: a question in the machine's grammar, TARGET ? ...`);
  }
  return pack;
}

/* The function the machine wrote: its name is the target, its parameters the bound symbols in order. */
function signatureOf(source, target) {
  const m = new RegExp(`^function\\s+(${target.replace(/[^A-Za-z0-9_]/g, "\\$&")})\\s*\\(([^)]*)\\)`, "m").exec(source);
  if (!m) refuse("export-shape", `the export defines no function ${target}; a solver or a proven value alone is not loadable as a function`);
  return m[2].split(",").map((s) => s.trim()).filter(Boolean);
}

/*
 * Ask the machine every question of the pack, export each sealed answer, and
 * write the folder: one file per entry and per language, and manifest.json.
 * Every refusal of the machine stops the build by name; nothing partial is kept.
 */
async function build(link, pack, outDir, { langs = ["javascript"] } = {}) {
  validatePack(pack);
  for (const l of langs) if (!LANGS[l]) refuse("bad-language", l);
  if (!langs.includes("javascript")) refuse("bad-language", "javascript is required: it is what load() verifies");
  const files = [], entries = [];
  for (const e of pack.entries) {
    let a;
    try { a = await link.ask(e.question); }
    catch (err) { if (err instanceof ZeqRefusal) refuse(err.code, `${e.name}: ${err.detail}`, err.step); throw err; }
    if (a.verification !== "verified" && a.verification !== "observable-differential") refuse("outside-gate", `${e.name}: the machine's verdict is ${a.verification}`, "MEASURE");
    const entry = { name: e.name, question: e.question, target: a.target, equations: a.equations, unit: a.unit, tiers: a.tiers || {},
      verification: a.verification, value_si: String(a.value_si), repro_digest: a.repro_digest, sealed_by: a.sealed.by, sealed_at_zeqond: a.sealed.zeqond,
      equation_zid: a.zid, engine: a.recipe && a.recipe.engine ? a.recipe.engine : null, files: {} };
    for (const lang of langs) {
      const source = await link.exportCode(a.sealed, lang);
      const file = `${e.name}.${LANGS[lang]}`;
      if (lang === "javascript") entry.params = signatureOf(source, a.target);
      entry.files[lang] = { file, sha256: sha256(source) };
      files.push([file, source]);
    }
    entries.push(entry);
  }
  const body = { format: MANIFEST_FORMAT, pack: pack.name, host: pack.host || null, entries };
  const manifest = { ...body, manifest_sha256: sha256(canonical(body)) };
  fs.mkdirSync(outDir, { recursive: true });
  for (const [file, source] of files) fs.writeFileSync(path.join(outDir, file), source);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  return manifest;
}

/* ---- load: offline, and only what verifies ------------------------------------------------- */

/*
 * Load a generated folder. For every entry: the file's hash is the manifest's,
 * the machine's own self-test passes (the function reproduces the sealed value),
 * and both Ed25519 signatures verify (the machine's public record and the
 * envelope). `trust` may name the machine ZIDs a host accepts; without it any
 * machine's valid signature loads, and the manifest says which machine it was.
 */
function load(dir, { trust } = {}) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); } catch (_) { refuse("no-manifest", `no manifest.json in ${dir}`); }
  if (manifest.format !== MANIFEST_FORMAT) refuse("bad-manifest", `format must be ${MANIFEST_FORMAT}`);
  const { manifest_sha256: claimed, ...body } = manifest;
  if (sha256(canonical(body)) !== claimed) refuse("tampered", "manifest.json does not hash to its own manifest_sha256");
  const out = {};
  for (const e of manifest.entries) {
    if (!NAME.test(e.name)) refuse("bad-manifest", `entry name ${e.name}`);
    const js = e.files.javascript;
    const file = path.join(dir, path.basename(js.file));
    let source;
    try { source = fs.readFileSync(file); } catch (_) { refuse("missing-file", js.file); }
    if (sha256(source) !== js.sha256) refuse("tampered", `${js.file} does not hash to the manifest`);
    if (trust && !trust.includes(e.sealed_by)) refuse("untrusted-machine", `${e.name} was sealed by ${e.sealed_by}`);
    const mod = require(path.resolve(file));
    const fn = mod[e.target];
    if (typeof fn !== "function" || typeof mod.selfTest !== "function" || typeof mod.verifyEnvelope !== "function") refuse("export-shape", `${js.file} is not a machine export of ${e.target}`);
    try { mod.selfTest(); } catch (err) { refuse("self-test-failed", `${e.name}: ${err.message}`); }
    if (mod.verifyEnvelope() !== true) refuse("bad-signature", `${e.name}: the envelope or the machine's record does not verify`);
    if (JSON.parse(mod.SIGNED).by !== e.sealed_by) refuse("tampered", `${e.name}: the envelope is not the manifest's machine's`);
    out[e.name] = Object.freeze({ call: fn, params: e.params, unit: e.unit, target: e.target, equations: e.equations, tiers: e.tiers, question: e.question,
      sealedValue: mod.SEALED_VALUE, sealedBy: e.sealed_by, sealedAtZeqond: e.sealed_at_zeqond, reproDigest: e.repro_digest, verification: e.verification });
  }
  return Object.freeze({ format: MANIFEST_FORMAT, pack: manifest.pack, manifestSha256: claimed, machines: [...new Set(manifest.entries.map((e) => e.sealed_by))], functions: Object.freeze(out) });
}

module.exports = Object.freeze({ format: FORMAT, packFormat: PACK_FORMAT, manifestFormat: MANIFEST_FORMAT, ZeqRefusal, machine, remote, serve, validatePack, build, load });
