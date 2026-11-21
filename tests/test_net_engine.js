"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const ZeqNet = require("../sdk/zeq-net.js");
const { encodeCommands } = require("../sdk/zeq-replay.js");

const root = path.resolve(__dirname, "..");
const engine = path.join(root, "doomgeneric", "doomgeneric-headless");
const wad = process.env.ZEQ_DOOM1_WAD || path.join(root, "doomgeneric", "doom1.wad");
const loader = "/lib64/ld-linux-x86-64.so.2";
const session = "0123456789abcdef0123456789abcdef";
let nextPort = 19100 + (process.pid % 500) * 10;

function records(stdout) {
  return stdout.split("\n").filter((line) => line.startsWith("ZEQJ")).map((line) => JSON.parse(line.slice(4)));
}
function commandStream(player, count) {
  const commands = [];
  for (let tic = 0; tic < count; tic++) {
    commands.push({
      gametic: tic,
      forwardmove: player === 0 ? (tic < 70 ? 25 : tic % 17 < 8 ? 12 : 0) : (tic % 31 < 15 ? -18 : 8),
      sidemove: player === 0 ? (tic % 29 < 10 ? 9 : 0) : (tic < 85 ? 20 : -12),
      angleturn: player === 0 ? (tic % 37 < 12 ? 75 : 0) : (tic < 45 ? 100 : tic % 23 < 8 ? -120 : 0),
      buttons: (player === 0 && tic >= 12 && tic < 22) || (player === 1 && tic >= 35 && tic < 43) ? 1 : 0
    });
  }
  return encodeCommands(commands);
}
function launch(player, port, input, extraEnv = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `zeq-net-p${player}-`));
  const args = ["-iwad", wad, "-warp", "1", "1", "-skill", "3", "-nosound", "-nomusic", "-config", "default.cfg"];
  const prefix = process.platform === "linux" && fs.existsSync(loader)
    ? ["/usr/bin/stdbuf", "-o0", "-e0", loader, engine]
    : [engine];
  const { maxTic = 140, connectHost = "127.0.0.1", ...environment } = extraEnv;
  const child = spawn(prefix[0], [...prefix.slice(1), ...args], {
    cwd,
    env: {
      ...process.env,
      ZEQ_RUN_ID: session,
      ZEQ_NET_SESSION: session,
      ZEQ_MAX_TIC: String(maxTic),
      ZEQ_CHECKPOINT_INTERVAL: "1",
      ZEQ_RULESET: "1",
      ZEQ_REALTIME: "0",
      ...(player === 0 ? { ZEQ_NET_LISTEN: String(port) } : { ZEQ_NET_CONNECT: `${connectHost}:${port}` }),
      ...environment
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (Buffer.byteLength(stdout) > 64 * 1024 * 1024) child.kill("SIGKILL");
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-65536); });
  child.stdin.end(input);
  const done = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      fs.rmSync(cwd, { recursive: true, force: true });
      resolve({ code, signal, stdout, stderr, records: records(stdout) });
    });
  });
  return { child, done, getStdout: () => stdout, getStderr: () => stderr };
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function nonLoopbackIPv4() {
  if (process.env.ZEQ_NET_LAN_HOST) return process.env.ZEQ_NET_LAN_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (!address.internal && (address.family === "IPv4" || address.family === 4)) return address.address;
    }
  }
  return null;
}
async function waitForStartup(run) {
  const deadline = Date.now() + 10000;
  while (!run.getStdout().includes("D_CheckNetGame: Checking network game status")) {
    if (run.child.exitCode !== null || run.child.signalCode !== null) throw new Error(`listener exited before startup: ${run.getStdout()} ${run.getStderr()}`);
    if (Date.now() > deadline) {
      run.child.kill("SIGKILL");
      throw new Error(`listener startup timed out: ${run.getStdout()} ${run.getStderr()}`);
    }
    await delay(10);
  }
  await delay(500);
}

async function impairedProxy(targetPort, listenPort) {
  const stats = { frames: 0, dropped: 0, duplicated: 0, delayed: 0, delivered: 0, queued: 0, maxQueued: 0 };
  let clock = 0;
  const queues = [];
  const commandStats = new Map();
  const server = net.createServer((downstream) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
    function direction(source, destination, directionIndex) {
      let hello = Buffer.alloc(0);
      let frames = Buffer.alloc(0);
      let sequence = 0;
      source.on("data", (chunk) => {
        let rest = chunk;
        if (hello.length < 60) {
          const needed = 60 - hello.length;
          hello = Buffer.concat([hello, rest.subarray(0, needed)]);
          rest = rest.subarray(Math.min(needed, rest.length));
          if (hello.length === 60) destination.write(hello);
          if (!rest.length) return;
        }
        frames = Buffer.concat([frames, rest]);
        while (frames.length >= 5) {
          if (frames[0] !== 0x5a || frames[1] !== 0x4e) {
            stats.protocolError = true;
            destination.destroy();
            return;
          }
          const length = frames.readUInt16LE(3);
          if (frames.length < 5 + length) break;
          const frame = Buffer.from(frames.subarray(0, 5 + length));
          frames = frames.subarray(5 + length);
          const type = frame[2];
          sequence++;
          stats.frames++;
          const options = {
            sequence,
            sendTic: clock,
            delayTics: type === 1 ? 5 : 1,
            jitterTics: 3,
            dropEvery: type === 1 ? Number(process.env.ZEQ_NET_DROP_EVERY || 7) : 0,
            duplicateEvery: type === 3 ? 0 : 5,
            seed: 777000777 + directionIndex
          };
          const due = ZeqNet.scheduleImpairment(options);
          const commandKey = type === 1 ? `${directionIndex}:${frame.readUInt32LE(6)}` : null;
          if (commandKey) {
            const entry = commandStats.get(commandKey) || { dropped: 0, delivered: 0 };
            if (!due.length) entry.dropped++;
            commandStats.set(commandKey, entry);
          }
          if (!due.length) { stats.dropped++; continue; }
          if (due.length > 1) stats.duplicated++;
          if (due[0] > clock) stats.delayed++;
          for (const dueTic of due) queues.push({ dueTic, destination, frame, commandKey });
          stats.queued = queues.length;
          stats.maxQueued = Math.max(stats.maxQueued, queues.length);
        }
      });
    }
    direction(downstream, upstream, 0);
    direction(upstream, downstream, 1);
  });
  await new Promise((resolve, reject) => server.listen(listenPort, "127.0.0.1", resolve).once("error", reject));
  const timer = setInterval(() => {
    clock++;
    for (let i = queues.length - 1; i >= 0; i--) {
      if (queues[i].dueTic > clock) continue;
      const item = queues.splice(i, 1)[0];
      if (!item.destination.destroyed) {
        item.destination.write(item.frame); stats.delivered++;
        if (item.commandKey) commandStats.get(item.commandKey).delivered++;
      }
    }
    stats.queued = queues.length;
  }, 5);
  return {
    stats,
    starved: () => [...commandStats].filter(([, value]) => value.dropped > 0 && value.delivered === 0),
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => resolve()); server.closeAllConnections?.(); })
  };
}

async function runPair(options = {}) {
  const started = performance.now();
  const maxTic = options.maxTic || 140;
  const enginePort = nextPort++;
  const clientPort = nextPort++;
  const proxy = options.impaired ? await impairedProxy(enginePort, clientPort) : null;
  const host = launch(0, enginePort, commandStream(0, maxTic), { maxTic, ...(options.hostEnv || {}) });
  await waitForStartup(host);
  const client = launch(1, options.impaired ? clientPort : enginePort, options.clientInput || commandStream(1, maxTic), { maxTic, connectHost: options.connectHost || "127.0.0.1", ...(options.clientEnv || {}) });
  const timer = setTimeout(() => {
    console.error("pair timeout", proxy ? { ...proxy.stats, starved: proxy.starved().slice(0, 30) } : { direct: true });
    host.child.kill("SIGKILL"); client.child.kill("SIGKILL");
  }, Number(process.env.ZEQ_NET_TIMEOUT_MS || 90000));
  const results = await Promise.all([host.done, client.done]);
  clearTimeout(timer);
  if (proxy) await proxy.close();
  fs.writeFileSync("/tmp/zeq-net-host.log", results[0].stdout + "\n" + results[0].stderr);
  fs.writeFileSync("/tmp/zeq-net-client.log", results[1].stdout + "\n" + results[1].stderr);
  return { host: results[0], client: results[1], proxy,
    performance: { wallMs: Number((performance.now() - started).toFixed(3)), maxTic,
      outputBytes: Buffer.byteLength(results[0].stdout) + Buffer.byteLength(results[1].stdout),
      timeoutMs: Number(process.env.ZEQ_NET_TIMEOUT_MS || 90000), harnessOutputLimitBytes: 64 * 1024 * 1024 } };
}

async function rawRefusal(kind, expectedReason) {
  const port = nextPort++;
  const host = launch(0, port, commandStream(0, 20), { maxTic: 20 });
  await waitForStartup(host);
  const socket = net.connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  const hello = await new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("raw hello timeout")), 10000);
    socket.on("data", function onData(chunk) {
      data = Buffer.concat([data, chunk]);
      if (data.length < 60) return;
      clearTimeout(timer);
      socket.off("data", onData);
      resolve(Buffer.from(data.subarray(0, 60)));
    });
    socket.once("error", reject);
  });
  assert.equal(hello.subarray(0, 7).toString(), "ZEQNET6");
  assert.equal(hello[7], 0);
  if (kind === "protocol") hello[8] = 9;
  else if (kind !== "player") hello[11] = 1; // Player mismatch deliberately remains 0.
  socket.write(hello);
  if (kind === "conflict" || kind === "malformed" || kind === "frame-limit") {
    if (kind === "conflict") {
      for (const forward of [1, 2]) {
        const frame = Buffer.alloc(24);
        frame[0] = 0x5a; frame[1] = 0x4e; frame[2] = 1;
        frame.writeUInt16LE(19, 3);
        frame[5] = 1; // Authoritative remote player.
        frame.writeUInt32LE(0, 6);
        frame.writeInt8(forward, 10);
        socket.write(frame);
      }
    } else if (kind === "frame-limit") {
      const frame = Buffer.from([0x5a, 0x4e, 1, 129, 0]);
      socket.write(frame);
    } else {
      socket.write(Buffer.from([0, 0, 0, 0, 0]));
    }
  }
  const timer = setTimeout(() => host.child.kill("SIGKILL"), 15000);
  const result = await host.done;
  clearTimeout(timer);
  socket.destroy();
  assert.ok(result.records.some((record) => record.kind === "net-error" && record.reason === expectedReason),
    `${kind}: ${result.stdout} ${result.stderr}`);
  assert.equal(result.records.filter((record) => record.kind === "checkpoint").length, 0);
  return { kind, reason: expectedReason };
}

function assertChain(run, maxTic) {
  const checkpoints = run.records.filter((record) => record.kind === "checkpoint");
  assert.equal(checkpoints.length, maxTic, run.stderr);
  let previous = null;
  checkpoints.forEach((checkpoint, index) => {
    assert.equal(checkpoint.gametic, String(index + 1));
    assert.equal(checkpoint.previous_state_sha256, previous);
    assert.equal(checkpoint.confirmed, true);
    assert.equal(checkpoint.protocol, "zeq-doom-net-v1");
    assert.match(checkpoint.state_sha256, /^[0-9a-f]{64}$/);
    previous = checkpoint.state_sha256;
  });
  return checkpoints.map((checkpoint) => checkpoint.state_sha256);
}
function assertNoErrors(run) {
  assert.deepEqual(run.records.filter((record) => record.kind === "input-error" || record.kind === "net-error" || record.kind === "net-desync"), [], run.stdout.slice(-4000));
  assert.equal(run.code, 0, run.stderr);
}

(async () => {
  assert.ok(fs.existsSync(engine) && fs.existsSync(wad), "build-headless.sh and doom1.wad are required");
  const report = { ok: false };

  if (!process.env.ZEQ_NET_CASE || process.env.ZEQ_NET_CASE === "direct") {
  const direct = await runPair({ maxTic: 140,
    hostEnv: { ZEQ_NET_VERIFY_BOUNDARIES: "1" },
    clientEnv: { ZEQ_NET_VERIFY_BOUNDARIES: "1" } });
  assertNoErrors(direct.host);
  assertNoErrors(direct.client);
  const directHashes = assertChain(direct.host, 140);
  const directClientHashes = assertChain(direct.client, 140);
  if (JSON.stringify(directHashes) !== JSON.stringify(directClientHashes)) {
    fs.writeFileSync("/tmp/zeq-net-host.log", direct.host.stdout + "\n" + direct.host.stderr);
    fs.writeFileSync("/tmp/zeq-net-client.log", direct.client.stdout + "\n" + direct.client.stderr);
  }
  assert.deepEqual(directHashes, directClientHashes);
  for (const run of [direct.host, direct.client]) {
    const descriptorRecord = run.records.find((record) => record.kind === "net-descriptor");
    const descriptor = ZeqNet.session(descriptorRecord.descriptor);
    assert.equal(await ZeqNet.descriptorDigest(descriptor), descriptorRecord.descriptor_sha256);
    assert.ok(run.records.some((record) => record.kind === "net-summary" && record.confirmed_tics === 140));
  }
  const defaultListener = direct.host.records.find((record) => record.kind === "net-listen");
  assert.equal(defaultListener.bind, "127.0.0.1");
  assert.equal(defaultListener.bind_scope, "loopback-default");
  report.direct = { tics: 140, matchingHashes: true, listener: defaultListener.bind_scope, performance: direct.performance };
  }

  if (!process.env.ZEQ_NET_CASE || process.env.ZEQ_NET_CASE === "lan") {
  const lanHost = nonLoopbackIPv4();
  if (!lanHost) throw new Error("set ZEQ_NET_LAN_HOST to a non-loopback local IPv4 address for the LAN transport gate");
  assert.equal(net.isIPv4(lanHost), true);
  const lan = await runPair({ maxTic: 140, connectHost: lanHost,
    hostEnv: { ZEQ_NET_BIND: lanHost, ZEQ_NET_VERIFY_BOUNDARIES: "1" },
    clientEnv: { ZEQ_NET_VERIFY_BOUNDARIES: "1" } });
  assertNoErrors(lan.host);
  assertNoErrors(lan.client);
  assert.deepEqual(assertChain(lan.host, 140), assertChain(lan.client, 140));
  const listener = lan.host.records.find((record) => record.kind === "net-listen");
  assert.equal(listener.bind, lanHost);
  assert.equal(listener.bind_scope, "explicit-non-loopback");
  const invalidBind = launch(0, nextPort++, commandStream(0, 20), { maxTic: 20, ZEQ_NET_BIND: "not-an-ip" });
  const invalidTimer = setTimeout(() => invalidBind.child.kill("SIGKILL"), 15000);
  const invalidResult = await invalidBind.done;
  clearTimeout(invalidTimer);
  assert.ok(invalidResult.records.some((record) => record.kind === "net-error" && record.reason === "listen"));
  assert.equal(invalidResult.records.filter((record) => record.kind === "checkpoint").length, 0);
  const wildcardBind = launch(0, nextPort++, commandStream(0, 20), { maxTic: 20, ZEQ_NET_BIND: "0.0.0.0" });
  const wildcardTimer = setTimeout(() => wildcardBind.child.kill("SIGKILL"), 15000);
  const wildcardResult = await wildcardBind.done;
  clearTimeout(wildcardTimer);
  assert.ok(wildcardResult.records.some((record) => record.kind === "net-error" && record.reason === "listen"));
  report.lan = { tics: 140, matchingHashes: true, transport: "real non-loopback TCP on one test host",
    bindScope: listener.bind_scope, malformedBindRefused: true, wildcardBindRefused: true,
    physicalTwoMachineWiFiTest: false };
  }

  if (!process.env.ZEQ_NET_CASE || process.env.ZEQ_NET_CASE === "impaired") {
  const impairedTics = Number(process.env.ZEQ_NET_IMPAIRED_TICS || 180);
  const impaired = await runPair({ maxTic: impairedTics, impaired: true });
  assertNoErrors(impaired.host);
  assertNoErrors(impaired.client);
  assert.deepEqual(assertChain(impaired.host, impairedTics), assertChain(impaired.client, impairedTics));
  assert.ok(impaired.proxy.stats.dropped > 0);
  assert.ok(impaired.proxy.stats.duplicated > 0);
  assert.ok(impaired.proxy.stats.delayed > 0);
  const summaries = [impaired.host, impaired.client].map((run) => run.records.find((record) => record.kind === "net-summary"));
  assert.ok(summaries.every((summary) => summary && summary.confirmed_tics === impairedTics));
  assert.ok(summaries.some((summary) => summary.rollbacks > 0 && summary.mispredictions > 0 && summary.resimulated_tics > 0));
  assert.ok([...impaired.host.records, ...impaired.client.records].some((record) => record.kind === "net-rollback"));
  report.impaired = { ...impaired.proxy.stats, summaries, matchingHashes: true, performance: impaired.performance };
  }

  if (!process.env.ZEQ_NET_CASE || process.env.ZEQ_NET_CASE === "refusal") {
  const mismatch = await runPair({ maxTic: 20, clientEnv: { ZEQ_NET_ENGINE_BUILD: "intentional-mismatch" } });
  for (const run of [mismatch.host, mismatch.client]) {
    assert.ok(run.records.some((record) => record.kind === "net-error" && record.reason === "session-descriptor-mismatch"));
    assert.equal(run.records.filter((record) => record.kind === "checkpoint").length, 0);
  }
  const sessionMismatch = await runPair({ maxTic: 20,
    clientEnv: { ZEQ_NET_SESSION: "fedcba9876543210fedcba9876543210" } });
  for (const run of [sessionMismatch.host, sessionMismatch.client]) {
    assert.ok(run.records.some((record) => record.kind === "net-error" && record.reason === "session-identity-mismatch"));
    assert.equal(run.records.filter((record) => record.kind === "checkpoint").length, 0);
  }
  const invalidInput = await runPair({ maxTic: 20, clientInput: Buffer.alloc(24) });
  assert.ok(invalidInput.client.records.some((record) => record.kind === "input-error" && record.reason === "invalid-record"));
  assert.ok(invalidInput.client.records.some((record) => record.kind === "net-error" && record.reason === "input-stream"));
  assert.ok(!invalidInput.client.records.some((record) => record.kind === "net-summary"));
  const rawCases = [
    await rawRefusal("protocol", "protocol-or-player-mismatch"),
    await rawRefusal("player", "protocol-or-player-mismatch"),
    await rawRefusal("conflict", "conflicting-command"),
    await rawRefusal("malformed", "frame-magic"),
    await rawRefusal("frame-limit", "frame-limit")
  ];
  report.identityRefusal = { descriptor: true, session: true, invalidInput: true, rawCases };
  }

  if (!process.env.ZEQ_NET_CASE || process.env.ZEQ_NET_CASE === "desync") {
  const corrupt = await runPair({ maxTic: 35, hostEnv: { ZEQ_NET_CORRUPT_HASH_AT: "20" } });
  assert.ok(corrupt.client.records.some((record) => record.kind === "net-desync" && record.confirmed_tic === 20));
  assert.ok(corrupt.client.records.some((record) => record.kind === "net-error" && record.reason === "canonical-hash-mismatch"));
  // Exercise the opposite sender and both early/late peer-hash arrival paths.
  const reverseCorrupt = await runPair({ maxTic: 35, clientEnv: { ZEQ_NET_CORRUPT_HASH_AT: "20" } });
  assert.ok(reverseCorrupt.host.records.some((record) => record.kind === "net-desync" && record.confirmed_tic === 20));
  assert.ok(reverseCorrupt.host.records.some((record) => record.kind === "net-error" && record.reason === "canonical-hash-mismatch"));
  report.desyncDiagnostic = { tic: 20, detected: true, bothDirections: true };
  }

  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
