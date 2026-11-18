"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const ZeqSecurity = require("../zeq-security.js");

const kernel = path.resolve(__dirname, "../zeq-kernel.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-sidecar-v3-"));
let child;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function clientFrame(text, opcode = 1) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else throw new Error("test frame too large");
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  return Buffer.concat([header, mask, masked]);
}

async function connect(port) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  const pending = new Map();
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let serial = 0;
  let upgradeResolve;
  const ready = new Promise((resolve, reject) => {
    upgradeResolve = resolve;
    socket.once("error", reject);
    socket.once("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(`GET /zeq HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
  });
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString();
      assert.match(header, /HTTP\/1\.1 101/);
      buffer = buffer.subarray(end + 4);
      upgraded = true;
      resolveUpgrade();
    }
    while (buffer.length >= 2) {
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2)); offset = 10;
      }
      if (buffer.length < offset + length) return;
      const opcode = buffer[0] & 0x0f;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode === 1) {
        const packet = JSON.parse(payload.toString());
        const waiter = pending.get(packet.id);
        if (waiter) {
          pending.delete(packet.id);
          clearTimeout(waiter.timer);
          if (packet.error) waiter.reject(new Error(packet.error.message));
          else waiter.resolve(packet.result);
        }
      }
    }
  });
  function resolveUpgrade() { upgradeResolve(); }
  await ready;
  return {
    notify(method, params) { socket.write(clientFrame(JSON.stringify({ jsonrpc: "2.0", method, params }))); },
    request(method, params = {}) {
      const id = `test-${++serial}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.write(clientFrame(JSON.stringify({ jsonrpc: "2.0", id, method, params })));
      });
    },
    close() { socket.write(clientFrame("", 8)); socket.end(); }
  };
}

function runVerify(file) {
  return spawnSync(process.execPath, [kernel, "--verify", file], { encoding: "utf8" });
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function legacyRecords() {
  const records = [];
  for (let i = 0; i < 2; i++) {
    const record = { seq: i, kind: "event", ts: "2026-01-01T00:00:00.000Z", session: "legacy-test", body: { eventSeq: i }, previousHash: records.length ? records[records.length - 1].hash : "0".repeat(64) };
    const { hash, ...unsigned } = record;
    record.hash = crypto.createHash("sha256").update(stable(unsigned)).digest("hex");
    records.push(record);
  }
  return records;
}

(async () => {
  const port = await freePort();
  child = spawn(process.execPath, [kernel, "serve", "--port", String(port), "--dir", temp], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sidecar startup timeout: ${stderr}`)), 5000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("sidecar listening")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`sidecar exited ${code}: ${stderr}`)); });
  });

  const client = await connect(port);
  const hello = await client.request("zeq.hello", { game: "doomgeneric-web", client: "phase3-test", sdk: "test" });
  assert.equal(hello.signer.format, "zeq-trust-anchor-v1");
  client.notify("zeq.event", { type: 4, tic: 0, phase: 0, value: 101 });
  client.notify("zeq.event", { type: 9, tic: 1, phase: 37, value: 1 });
  client.notify("zeq.snapshot", { health: 100, gametic: 1 });
  const verified = await client.request("zeq.verify");
  assert.deepEqual({ ok: verified.ok, count: verified.count, trust: verified.trust }, { ok: true, count: 2, trust: "self-consistent-only" });
  const exported = await client.request("zeq.export", { name: "phase3" });
  assert.equal(exported.replay, "unavailable");
  const proof = JSON.parse(fs.readFileSync(exported.path, "utf8"));
  assert.equal(proof.format, "zeq-proof-v2");
  assert.equal(proof.events.length, 4);
  assert.deepEqual(proof.events.map((record) => record.sequence), [0, 1, 2, 3]);
  const proofVerdict = await ZeqSecurity.verifyProof(proof);
  assert.equal(proofVerdict.ok, true, JSON.stringify(proofVerdict));
  assert.equal(proofVerdict.replay, "unavailable");
  assert.equal(runVerify(exported.path).status, 0);

  const tamperedProof = { ...proof, events: proof.events.map((record) => ({ ...record, payload: { ...record.payload } })) };
  tamperedProof.events[1].payload.value = "999";
  const tamperedProofFile = path.join(temp, "tampered-proof.json");
  fs.writeFileSync(tamperedProofFile, JSON.stringify(tamperedProof));
  assert.notEqual(runVerify(tamperedProofFile).status, 0);

  client.close();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const logFile = path.join(temp, "machine.log.jsonl");
  assert.equal(runVerify(logFile).status, 0);
  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 5);
  const tamperedDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-sidecar-tamper-"));
  fs.copyFileSync(path.join(temp, "machine.anchor.json"), path.join(tamperedDir, "machine.anchor.json"));
  const tamperedLog = path.join(tamperedDir, "machine.log.jsonl");
  const changed = JSON.parse(lines[1]);
  changed.payload.value = "999";
  lines[1] = JSON.stringify(changed);
  fs.writeFileSync(tamperedLog, lines.join("\n") + "\n");
  assert.notEqual(runVerify(tamperedLog).status, 0);

  const legacy = { format: "zeq-proof-v1", session: "legacy-test", machine: "legacy", events: legacyRecords() };
  const legacyFile = path.join(temp, "legacy.zeqproof.json");
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  assert.equal(runVerify(legacyFile).status, 0);
  legacy.events[1].body.eventSeq = 99;
  const legacyBadFile = path.join(temp, "legacy-bad.zeqproof.json");
  fs.writeFileSync(legacyBadFile, JSON.stringify(legacy));
  assert.notEqual(runVerify(legacyBadFile).status, 0);

  const allOutput = fs.readFileSync(logFile, "utf8") + fs.readFileSync(exported.path, "utf8") + fs.readFileSync(path.join(temp, "machine.anchor.json"), "utf8");
  assert.doesNotMatch(allOutput, /PRIVATE KEY|correct-horse|pin|private_key/i);
  console.log("Sidecar OK: real WebSocket RPC, signed v2 export/log, offline tamper refusal, legacy v1 verification, replay unavailable");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (child && !child.killed) child.kill("SIGINT");
  fs.rmSync(temp, { recursive: true, force: true });
});
