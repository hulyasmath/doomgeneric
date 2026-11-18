#!/usr/bin/env node
/*
 * ZEQ KERNEL / 0.3.0
 * The sidecar runtime: a zero-dependency Node.js process that games
 * (browser WASM or native) talk to over JSON-RPC 2.0 on WebSocket.
 *
 *   node zeq-kernel.js serve [--port 7770] [--dir .]
 *   node zeq-kernel.js --verify run.json | machine.log.jsonl
 *
 * What it honestly is:
 *   - Append-only, hash-chained, Ed25519-signed v2 session logs with a
 *     persisted host-only signing key and a public self-declared anchor.
 *   - ZeqProof v2 export/verify plus legacy v1 offline verification.
 * What it is NOT:
 *   - Not proof of competitive legitimacy. It proves a local chain was
 *     not edited after the fact, nothing more.
 */
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ZeqSecurity = require("./zeq-security.js");
const ZeqSDK = require("./zeq-game-sdk.js");

const KERNEL_VERSION = "0.3.0";
const ZERO_HASH = "0".repeat(64);
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SCOPE = "Integrity of this local event chain only; not proof of competitive legitimacy.";

/* ---------------- canonical JSON + hashing ---------------- */

function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const hashRecord = (record) => {
  const { hash, ...unsigned } = record;
  return sha256(stable(unsigned));
};

/* ---------------- machine identity ---------------- */

function loadMachine(dir) {
  const file = path.join(dir, ".zeq-machine.json");
  try {
    const machine = JSON.parse(fs.readFileSync(file, "utf8"));
    if (machine && typeof machine.machineId === "string") return machine;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const machine = {
    machineId: crypto.randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    kernel: `zeq-kernel/${KERNEL_VERSION}`
  };
  fs.writeFileSync(file, JSON.stringify(machine, null, 2), { mode: 0o600, flag: "wx" });
  return machine;
}

function loadSigner(dir, machine) {
  const file = path.join(dir, ".zeq-machine-signing-key.pem");
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const pair = crypto.generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    fs.writeFileSync(file, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const publicRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const keyId = crypto.createHash("sha256").update(publicRaw).digest("hex");
  const anchor = Object.freeze({
    format: "zeq-trust-anchor-v1", machine_zid: machine.machineId,
    key_id: keyId, algorithm: "Ed25519",
    public_key: publicRaw.toString("base64"), trust: "self-declared"
  });
  fs.writeFileSync(path.join(dir, "machine.anchor.json"), JSON.stringify(anchor, null, 2), { mode: 0o644 });
  return {
    anchor,
    async sign(value) {
      return crypto.sign(null, Buffer.from(ZeqSecurity.canonical(value)), privateKey).toString("base64");
    }
  };
}

/* ---------------- append-only signed logs ---------------- */

function timeFields(gametic) {
  const time = ZeqSDK.time.fromTic(gametic, 35);
  return { gametic: String(gametic), zeqond: time.zeqond, phase64: time.phase64 };
}

async function openLog(dir, signer) {
  let file = path.join(dir, "machine.log.jsonl");
  if (fs.existsSync(file)) {
    const first = fs.readFileSync(file, "utf8").split("\n").find(Boolean);
    if (first) {
      const record = JSON.parse(first);
      if (record.format !== "zeq-event-v2") file = path.join(dir, "machine.log.v2.jsonl");
    }
  }
  let count = 0;
  let tip = ZERO_HASH;
  if (fs.existsSync(file)) {
    const records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const verdict = await verifySignedRecords(records, signer.anchor);
    if (!verdict.ok) throw new Error(`Existing signed log is invalid at ${verdict.at}: ${verdict.why}`);
    count = records.length;
    tip = records.length ? records[records.length - 1].record_sha256 : ZERO_HASH;
  }
  const stream = fs.createWriteStream(file, { flags: "a" });
  return {
    file,
    get tip() { return tip; },
    get seq() { return count; },
    append(session, fields) {
      const operation = session.queue.then(async () => {
        const record = await ZeqSecurity.appendRecord(session.records, signer, {
          session_id: session.id, run_id: session.run.run_id,
          ruleset: session.run.ruleset, ...fields
        });
        stream.write(JSON.stringify(record) + "\n");
        tip = record.record_sha256;
        count++;
        return record;
      });
      session.queue = operation.catch(() => {});
      return operation;
    },
    close() { stream.end(); }
  };
}

/* ---------------- minimal RFC 6455 server ---------------- */

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) header = Buffer.from([0x80 | opcode, length]);
  else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/* Incremental frame decoder; calls onMessage(text) / onClose(). */
function attachDecoder(socket, handlers) {
  let buffer = Buffer.alloc(0);
  let fragments = [];
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2)); offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      let payload = buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
      }
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) { handlers.onClose(); return; }
      if (opcode === 0x9) { socket.write(encodeFrame(0xA, payload)); continue; }
      if (opcode === 0xA) continue;
      fragments.push(payload);
      if (fin) {
        handlers.onMessage(Buffer.concat(fragments).toString("utf8"));
        fragments = [];
      }
    }
  });
}

/* ---------------- kernel RPC ---------------- */

async function serve(options) {
  const dir = path.resolve(options.dir || ".");
  fs.mkdirSync(dir, { recursive: true });
  const machine = loadMachine(dir);
  const signer = loadSigner(dir, machine);
  const log = await openLog(dir, signer);
  const sessions = new Map();

  console.log(`[zeq-kernel] machine ${machine.machineId}`);
  console.log(`[zeq-kernel] signed append-only log ${log.file} (records ${log.seq}, tip ${log.tip.slice(0, 16)}…)`);

  async function handleRpc(session, packet, socket) {
    const reply = (result) =>
      socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: packet.id, result }))));
    const fail = (message) =>
      socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify({
        jsonrpc: "2.0", id: packet.id === undefined ? null : packet.id,
        error: { code: -32603, message }
      }))));

    switch (packet.method) {
      case "zeq.hello": {
        const params = packet.params || {};
        session.id = crypto.randomBytes(16).toString("hex");
        session.game = String(params.game || "unknown");
        session.client = String(params.client || "unknown");
        session.eventSeq = 0;
        session.gametic = 0;
        session.records = [];
        session.events = [];
        session.queue = Promise.resolve();
        const settingsHash = await ZeqSecurity.sha256(ZeqSecurity.canonical({ game: session.game, client: session.client, sdk: params.sdk || null }));
        session.run = {
          format: "zeq-run-v1", run_id: crypto.randomBytes(16).toString("hex"),
          engine_commit: "0".repeat(40), engine_build_sha256: "0".repeat(64),
          wad_sha256: "0".repeat(64), ruleset: "zeq-physics-v1", compatibility: "0",
          tick_rate: "35", initial_rng: "0", settings_sha256: settingsHash,
          time_origin: { kind: "doom-tic", gametic: "0" }
        };
        session.openRecord = await log.append(session, {
          ...timeFields(0), kind: "session-open",
          payload: { game: session.game, client: session.client, sdk: params.sdk || null }
        });
        sessions.set(session.id, session);
        console.log(`[zeq-kernel] session ${session.id} open (${session.game} via ${session.client})`);
        reply({
          kernel: `zeq-kernel/${KERNEL_VERSION}`,
          machineId: machine.machineId,
          sessionId: session.id,
          runId: session.run.run_id,
          signer: signer.anchor,
          logSeq: log.seq,
          scope: SCOPE
        });
        return;
      }
      case "zeq.event": {
        if (!session.id) return;
        const params = packet.params || {};
        const gametic = Number(params.tic);
        if (!Number.isSafeInteger(gametic) || gametic < 0) throw new Error("invalid event tic");
        session.gametic = gametic;
        const record = await log.append(session, {
          ...timeFields(gametic), kind: "engine-event",
          payload: {
            event_sequence: String(session.eventSeq++), type: String(params.type),
            legacy_phase: String(params.phase), value: String(params.value)
          }
        });
        session.events.push(record);
        return; // notification: no reply
      }
      case "zeq.snapshot": {
        if (!session.id) return;
        await log.append(session, {
          ...timeFields(session.gametic), kind: "snapshot", payload: packet.params || {}
        });
        return;
      }
      case "zeq.verify": {
        if (!session.id) return fail("no session");
        await session.queue;
        const verdict = await ZeqSecurity.verifyRecords(session.records, signer.anchor);
        reply({
          ok: verdict.ok, count: session.events.length,
          tip: session.records.length ? session.records[session.records.length - 1].record_sha256 : null,
          at: verdict.at, trust: verdict.trust
        });
        return;
      }
      case "zeq.export": {
        if (!session.id) return fail("no session");
        await session.queue;
        const params = packet.params || {};
        const name = String(params.name || session.game || "run").replace(/[^\w.-]+/g, "-").slice(0, 60) || "run";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = path.join(dir, `${name}-${stamp}.zeqproof.json`);
        const verdict = await ZeqSecurity.verifyRecords(session.records, signer.anchor);
        if (!verdict.ok) return fail(`signed chain broken at ${verdict.at}: ${verdict.why}`);
        const sealed = {
          format: "zeq-proof-v2", run: session.run, session_id: session.id,
          created_zeqond: timeFields(session.gametic).zeqond, events: session.records,
          input_records_or_digest: { status: "unavailable", reason: "The sidecar receives telemetry, not actual-tic Doom inputs." },
          state_hashes: [], checkpoint_interval: "0",
          chain_head_sha256: session.records.length ? session.records[session.records.length - 1].record_sha256 : null,
          attestations: [],
          replay: { status: "unavailable", reason: "No headless Doom reproduction was performed." },
          signer: signer.anchor, scope: SCOPE
        };
        fs.writeFileSync(file, JSON.stringify(sealed, null, 2), { flag: "wx" });
        console.log(`[zeq-kernel] export ${file} (${session.events.length} engine events, signed=true, replay=unavailable)`);
        reply({ path: file, eventCount: session.events.length, tip: sealed.chain_head_sha256, verified: true, replay: "unavailable", trust: verdict.trust });
        return;
      }
      default:
        if (packet.id !== undefined) fail(`unknown method ${packet.method}`);
    }
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ kernel: `zeq-kernel/${KERNEL_VERSION}`, machine: machine.machineId, ws: "/zeq" }));
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || !req.url.startsWith("/zeq")) { socket.destroy(); return; }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    const session = { id: null, events: [], records: [], queue: Promise.resolve() };
    attachDecoder(socket, {
      async onMessage(text) {
        let packet;
        try { packet = JSON.parse(text); } catch (_) { return; }
        try { await handleRpc(session, packet, socket); }
        catch (error) { console.error("[zeq-kernel] rpc fault", error); }
      },
      onClose() {
        const closing = session.id ? log.append(session, {
          ...timeFields(session.gametic), kind: "session-close", payload: { events: String(session.events.length) }
        }).then(() => {
          console.log(`[zeq-kernel] session ${session.id} close (${session.events.length} events)`);
          sessions.delete(session.id);
        }) : Promise.resolve();
        closing.finally(() => socket.end(encodeFrame(0x8, Buffer.alloc(0))));
      }
    });
    socket.on("error", () => {});
  });

  const port = options.port || 7770;
  server.listen(port, "127.0.0.1", () => {
    console.log(`[zeq-kernel] sidecar listening on ws://127.0.0.1:${port}/zeq`);
    console.log(`[zeq-kernel] ${SCOPE}`);
  });

  process.on("SIGINT", () => { log.close(); process.exit(0); });
}

/* ---------------- verification ---------------- */

function verifyLegacyRecords(records) {
  let previous = records.length ? records[0].previousHash : ZERO_HASH;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.previousHash !== previous) return { ok: false, at: i, why: "chain link broken" };
    if (hashRecord(record) !== record.hash) return { ok: false, at: i, why: "hash mismatch" };
    previous = record.hash;
  }
  return { ok: true };
}

async function verifySignedRecords(records, anchor) {
  const sessions = new Map();
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.format !== "zeq-event-v2" || typeof record.session_id !== "string") return { ok: false, at: i, why: "not a signed v2 record" };
    if (!sessions.has(record.session_id)) sessions.set(record.session_id, []);
    sessions.get(record.session_id).push(record);
  }
  for (const sessionRecords of sessions.values()) {
    const verdict = await ZeqSecurity.verifyRecords(sessionRecords, anchor);
    if (!verdict.ok) {
      const at = records.indexOf(sessionRecords[verdict.at]);
      return { ...verdict, at };
    }
  }
  return { ok: true, count: records.length, tip: records.length ? records[records.length - 1].record_sha256 : null };
}

async function verifyFile(file) {
  const text = fs.readFileSync(file, "utf8");
  let records;
  let label;
  let verdict;
  let whole = null;
  try { whole = JSON.parse(text); } catch { /* newline-delimited log */ }
  if (whole && typeof whole === "object" && !Array.isArray(whole)) {
    const proof = whole;
    if (proof.format === "zeq-proof-v2") {
      verdict = await verifyProofForCli(proof);
      records = proof.events;
      label = `zeq-proof-v2 session ${proof.session_id} replay ${verdict.replay || "unavailable"}`;
    } else if (proof.format === "zeq-proof-v1" && Array.isArray(proof.events)) {
      records = proof.events;
      verdict = verifyLegacyRecords(records);
      label = `legacy zeq-proof-v1 session ${proof.session} machine ${proof.machine}`;
    } else throw new Error("not a zeq-proof-v1 or zeq-proof-v2 file");
  } else {
    records = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    label = path.basename(file);
    if (records.some((record) => record.format === "zeq-event-v2")) {
      const anchor = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "machine.anchor.json"), "utf8"));
      verdict = await verifySignedRecords(records, anchor);
      label += " / signed v2 per-session chains";
    } else verdict = verifyLegacyRecords(records);
  }
  if (verdict.ok) {
    const tip = records.length ? (records[records.length - 1].record_sha256 || records[records.length - 1].hash) : ZERO_HASH;
    console.log(`INTEGRITY OK  ${records.length} records  tip ${tip || ZERO_HASH}`);
    console.log(`  ${label}`);
    if (verdict.trust) console.log(`  trust: ${verdict.trust}`);
    console.log(`  scope: ${SCOPE}`);
    process.exit(0);
  } else {
    console.log(`CHAIN BROKEN at record ${verdict.at === undefined ? "proof" : verdict.at}: ${verdict.why}`);
    process.exit(1);
  }
}

async function verifyProofForCli(proof) {
  return ZeqSecurity.verifyProof(proof);
}

/* ---------------- CLI ---------------- */

const args = process.argv.slice(2);
if (args[0] === "serve") {
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port") options.port = Number(args[++i]);
    else if (args[i] === "--dir") options.dir = args[++i];
  }
  serve(options).catch((error) => { console.error(`[zeq-kernel] ${error.message}`); process.exit(1); });
} else if (args[0] === "--verify" && args[1]) {
  verifyFile(path.resolve(args[1])).catch((error) => { console.error(`FAIL ${args[1]}: ${error.message}`); process.exit(1); });
} else {
  console.log("usage:");
  console.log("  node zeq-kernel.js serve [--port 7770] [--dir .]");
  console.log("  node zeq-kernel.js --verify <run.zeqproof.json | machine.log.jsonl>");
  process.exit(args.length ? 1 : 0);
}
