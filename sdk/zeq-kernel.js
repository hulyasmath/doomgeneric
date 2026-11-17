#!/usr/bin/env node
/*
 * ZEQ KERNEL / 0.1.0
 * The sidecar runtime: a zero-dependency Node.js process that games
 * (browser WASM or native) talk to over JSON-RPC 2.0 on WebSocket.
 *
 *   node zeq-kernel.js serve [--port 7770] [--dir .]
 *   node zeq-kernel.js --verify run.json | machine.log.jsonl
 *
 * What it honestly is:
 *   - WORM audit log (machine.log.jsonl), append-only, hash-chained
 *     with a persisted local machine identity.
 *   - ZeqProof export/verify of a session's event chain.
 * What it is NOT:
 *   - Not proof of competitive legitimacy. It proves a local chain was
 *     not edited after the fact, nothing more.
 */
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KERNEL_VERSION = "0.1.0";
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
  } catch (_) { /* create below */ }
  const machine = {
    machineId: crypto.randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    kernel: `zeq-kernel/${KERNEL_VERSION}`
  };
  fs.writeFileSync(file, JSON.stringify(machine, null, 2), { mode: 0o600 });
  return machine;
}

/* ---------------- WORM log ---------------- */

function openLog(dir) {
  const file = path.join(dir, "machine.log.jsonl");
  let seq = 0;
  let tip = ZERO_HASH;
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        seq = Math.max(seq, record.seq + 1);
        tip = record.hash || tip;
      } catch (_) { /* keep reading; verify reports the break */ }
    }
  }
  const stream = fs.createWriteStream(file, { flags: "a" });
  return {
    file,
    get tip() { return tip; },
    get seq() { return seq; },
    append(kind, session, body) {
      const record = {
        seq, kind, ts: new Date().toISOString(),
        session: session || null, body: body || {},
        previousHash: tip
      };
      record.hash = hashRecord(record);
      stream.write(JSON.stringify(record) + "\n");
      tip = record.hash;
      seq++;
      return record;
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

function serve(options) {
  const dir = path.resolve(options.dir || ".");
  fs.mkdirSync(dir, { recursive: true });
  const machine = loadMachine(dir);
  const log = openLog(dir);
  const sessions = new Map();

  console.log(`[zeq-kernel] machine ${machine.machineId}`);
  console.log(`[zeq-kernel] worm log ${log.file} (seq ${log.seq}, tip ${log.tip.slice(0, 16)}…)`);

  function handleRpc(session, packet, socket) {
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
        session.id = crypto.randomBytes(8).toString("hex");
        session.game = String(params.game || "unknown");
        session.client = String(params.client || "unknown");
        session.eventSeq = 0;
        session.openRecord = log.append("session-open", session.id, {
          game: session.game, client: session.client, sdk: params.sdk || null
        });
        sessions.set(session.id, session);
        console.log(`[zeq-kernel] session ${session.id} open (${session.game} via ${session.client})`);
        reply({
          kernel: `zeq-kernel/${KERNEL_VERSION}`,
          machineId: machine.machineId,
          sessionId: session.id,
          logSeq: log.seq,
          scope: SCOPE
        });
        return;
      }
      case "zeq.event": {
        if (!session.id) return;
        const params = packet.params || {};
        const record = log.append("event", session.id, {
          eventSeq: session.eventSeq++,
          type: params.type, tic: params.tic, phase: params.phase, value: params.value
        });
        session.events.push(record);
        return; // notification: no reply
      }
      case "zeq.snapshot": {
        if (!session.id) return;
        log.append("snapshot", session.id, packet.params || {});
        return;
      }
      case "zeq.verify": {
        if (!session.id) return fail("no session");
        const verdict = verifyRecords(session.events);
        reply({ ok: verdict.ok, count: session.events.length, tip: session.events.length ? session.events[session.events.length - 1].hash : ZERO_HASH, at: verdict.at });
        return;
      }
      case "zeq.export": {
        if (!session.id) return fail("no session");
        const params = packet.params || {};
        const name = String(params.name || session.game || "run").replace(/[^\w.-]+/g, "-").slice(0, 60) || "run";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = path.join(dir, `${name}-${stamp}.zeqproof.json`);
        const verdict = verifyRecords(session.events);
        const sealed = {
          format: "zeq-proof-v1",
          kernel: `zeq-kernel/${KERNEL_VERSION}`,
          machine: machine.machineId,
          session: session.id,
          game: session.game,
          exportedAt: new Date().toISOString(),
          eventCount: session.events.length,
          anchor: session.events.length ? session.events[0].previousHash : ZERO_HASH,
          tip: session.events.length ? session.events[session.events.length - 1].hash : ZERO_HASH,
          verified: verdict.ok,
          scope: SCOPE,
          events: session.events
        };
        fs.writeFileSync(file, JSON.stringify(sealed, null, 2));
        console.log(`[zeq-kernel] export ${file} (${session.events.length} events, verified=${verdict.ok})`);
        reply({ path: file, eventCount: sealed.eventCount, tip: sealed.tip, verified: sealed.verified });
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
    const session = { id: null, events: [] };
    attachDecoder(socket, {
      onMessage(text) {
        let packet;
        try { packet = JSON.parse(text); } catch (_) { return; }
        try { handleRpc(session, packet, socket); }
        catch (error) { console.error("[zeq-kernel] rpc fault", error); }
      },
      onClose() {
        if (session.id) {
          log.append("session-close", session.id, { events: session.events.length });
          console.log(`[zeq-kernel] session ${session.id} close (${session.events.length} events)`);
          sessions.delete(session.id);
        }
        socket.end(encodeFrame(0x8, Buffer.alloc(0)));
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

function verifyRecords(records) {
  let previous = records.length ? records[0].previousHash : ZERO_HASH;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.previousHash !== previous) return { ok: false, at: i, why: "chain link broken" };
    if (hashRecord(record) !== record.hash) return { ok: false, at: i, why: "hash mismatch" };
    previous = record.hash;
  }
  return { ok: true };
}

function verifyFile(file) {
  const text = fs.readFileSync(file, "utf8");
  let records;
  let label;
  let whole = null;
  try { whole = JSON.parse(text); } catch { /* newline-delimited log */ }
  if (whole && typeof whole === "object" && !Array.isArray(whole)) {
    const proof = whole;
    if (proof.format !== "zeq-proof-v1" || !Array.isArray(proof.events)) {
      console.error(`FAIL ${file}: not a zeq-proof-v1 file`);
      process.exit(1);
    }
    records = proof.events;
    label = `zeq-proof-v1 session ${proof.session} machine ${proof.machine}`;
  } else {
    records = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    label = "machine.log.jsonl";
  }
  const verdict = verifyRecords(records);
  if (verdict.ok) {
    const tip = records.length ? records[records.length - 1].hash : ZERO_HASH;
    console.log(`INTEGRITY OK  ${records.length} records  tip ${tip}`);
    console.log(`  ${label}`);
    console.log(`  scope: ${SCOPE}`);
    process.exit(0);
  } else {
    console.log(`CHAIN BROKEN at record ${verdict.at}: ${verdict.why}`);
    process.exit(1);
  }
}

/* ---------------- CLI ---------------- */

const args = process.argv.slice(2);
if (args[0] === "serve") {
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port") options.port = Number(args[++i]);
    else if (args[i] === "--dir") options.dir = args[++i];
  }
  serve(options);
} else if (args[0] === "--verify" && args[1]) {
  verifyFile(path.resolve(args[1]));
} else {
  console.log("usage:");
  console.log("  node zeq-kernel.js serve [--port 7770] [--dir .]");
  console.log("  node zeq-kernel.js --verify <run.zeqproof.json | machine.log.jsonl>");
  process.exit(args.length ? 1 : 0);
}
