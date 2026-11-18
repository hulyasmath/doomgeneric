"use strict";

// Host adapter for the real doomgeneric C engine. No gameplay is simulated here.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const Security = require("./zeq-security.js");

const INPUT_BYTES = 24;
const INPUT_LIMIT = 200000;
const RULESETS = ["doom-vanilla-v1", "zeq-physics-v1", "zeq-arcade-legacy-v1"];
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

function integer(value, name, minimum, maximum, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`invalid ${name}`);
  return value;
}

function encodeCommand(command) {
  const record = Buffer.alloc(INPUT_BYTES);
  record.write("ZEQI", 0, "ascii");
  record.writeUInt32LE(integer(command.gametic, "gametic", 0, 1999999), 4);
  record.writeInt8(integer(command.forwardmove, "forwardmove", -128, 127), 8);
  record.writeInt8(integer(command.sidemove, "sidemove", -128, 127), 9);
  record.writeInt16LE(integer(command.angleturn, "angleturn", -32768, 32767), 10);
  record.writeUInt8(integer(command.chatchar, "chatchar", 0, 255), 12);
  record.writeUInt8(integer(command.buttons, "buttons", 0, 255), 13);
  record.writeUInt8(integer(command.consistancy, "consistancy", 0, 255), 14);
  record.writeUInt8(integer(command.buttons2, "buttons2", 0, 255), 15);
  record.writeInt32LE(integer(command.inventory, "inventory", -2147483648, 2147483647), 16);
  record.writeUInt8(integer(command.lookfly, "lookfly", 0, 255), 20);
  record.writeUInt8(integer(command.arti, "arti", 0, 255), 21);
  return record;
}

function encodeCommands(commands) {
  if (!Array.isArray(commands) || commands.length > INPUT_LIMIT) throw new RangeError("invalid input count");
  let previous = -1;
  const records = commands.map((command) => {
    if (!command || !Number.isSafeInteger(command.gametic) || command.gametic <= previous) throw new RangeError("input tics must strictly increase");
    previous = command.gametic;
    return encodeCommand(command);
  });
  return Buffer.concat(records);
}

function createInputArtifact(commands, runId) {
  const bytes = encodeCommands(commands);
  return {
    format: "zeq-input-v1", run_id: runId, tick_rate: "35",
    record_format: "zeq-ticcmd-le-v1", record_bytes: INPUT_BYTES,
    count: commands.length, encoding: "base64", data: bytes.toString("base64"), sha256: sha256(bytes)
  };
}

function decodeInputArtifact(artifact, expectedRunId) {
  if (!artifact || artifact.format !== "zeq-input-v1" || artifact.tick_rate !== "35" || artifact.record_format !== "zeq-ticcmd-le-v1" || artifact.record_bytes !== INPUT_BYTES || artifact.encoding !== "base64" || typeof artifact.data !== "string") throw new Error("invalid zeq-input-v1 artifact");
  if (!/^[0-9a-f]{32}$/.test(artifact.run_id) || (expectedRunId && artifact.run_id !== expectedRunId)) throw new Error("input run identity mismatch");
  if (!Number.isSafeInteger(artifact.count) || artifact.count < 0 || artifact.count > INPUT_LIMIT) throw new Error("invalid input count");
  const bytes = Buffer.from(artifact.data, "base64");
  if (bytes.toString("base64") !== artifact.data || bytes.length !== artifact.count * INPUT_BYTES || sha256(bytes) !== artifact.sha256) throw new Error("input digest or length mismatch");
  let previous = -1;
  for (let offset = 0; offset < bytes.length; offset += INPUT_BYTES) {
    if (bytes.toString("ascii", offset, offset + 4) !== "ZEQI" || bytes[offset + 22] || bytes[offset + 23]) throw new Error("invalid input record");
    const tic = bytes.readUInt32LE(offset + 4);
    if (tic <= previous || tic >= 2000000) throw new Error("input tics must strictly increase");
    previous = tic;
  }
  return bytes;
}

function engineIdentity(root) {
  const engine = path.join(root, "doomgeneric", "doomgeneric-headless");
  const wad = process.env.ZEQ_DOOM1_WAD || path.join(root, "doomgeneric", "doom1.wad");
  if (!fs.existsSync(engine) || !fs.existsSync(wad)) throw new Error("headless engine or DOOM1.WAD is not installed");
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  return { engine, wad, engineSha256: sha256(fs.readFileSync(engine)), wadSha256: sha256(fs.readFileSync(wad)), commit: /^[0-9a-f]{40}$/.test(commit) ? commit : "0".repeat(40) };
}

function engineCommand(engine) {
  if (process.env.ZEQ_HEADLESS_LOADER) return { command: process.env.ZEQ_HEADLESS_LOADER, prefix: [engine] };
  try { fs.accessSync(engine, fs.constants.X_OK); return { command: engine, prefix: [] }; }
  catch (_) {
    const loader = "/lib64/ld-linux-x86-64.so.2";
    if (process.platform === "linux" && fs.existsSync(loader)) return { command: loader, prefix: [engine] };
    return { command: engine, prefix: [] };
  }
}

function parseRecords(stdout) {
  const records = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("ZEQJ")) continue;
    const record = JSON.parse(line.slice(4));
    if (record.kind === "input-error") throw new Error(`engine rejected input: ${record.reason}`);
    records.push(record);
  }
  return records;
}

function stateHashes(records, maxTic, interval) {
  const checkpoints = records.filter((record) => record.kind === "checkpoint");
  if (!checkpoints.length) throw new Error("engine emitted no checkpoints");
  let previous = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.format !== "zeq-state-hash-v1" || checkpoint.state_format !== "zeq-doom-state-v1" || !/^[0-9a-f]{64}$/.test(checkpoint.state_sha256)) throw new Error("invalid checkpoint format");
    if (!/^\d+$/.test(checkpoint.gametic) || Number(checkpoint.gametic) <= 0 || Number(checkpoint.gametic) > maxTic) throw new Error("invalid checkpoint tic");
    if (checkpoint.previous_state_sha256 !== previous) throw new Error("broken state hash chain");
    previous = checkpoint.state_sha256;
  }
  const expected = Math.floor(maxTic / interval) + (maxTic % interval ? 1 : 0);
  if (checkpoints.length !== expected || Number(checkpoints[checkpoints.length - 1].gametic) !== maxTic) throw new Error("incomplete checkpoint sequence");
  for (let i = 0; i < checkpoints.length; i++) {
    const expectedTic = Math.min(maxTic, (i + 1) * interval);
    if (Number(checkpoints[i].gametic) !== expectedTic) throw new Error("non-canonical checkpoint interval");
  }
  return checkpoints.map(({ gametic, state_sha256 }) => ({ gametic, state_sha256 }));
}

function createRun(identity, options, runId, inputSha256) {
  const ruleset = integer(options.ruleset, "ruleset", 0, 2, 1);
  const settings = { episode: 1, map: 1, skill: integer(options.skill, "skill", 0, 4, 2), ruleset, maxTic: integer(options.maxTic, "maxTic", 1, 200000, 350), checkpointInterval: integer(options.checkpointInterval, "checkpointInterval", 1, 200000, 1) };
  return {
    run: { format: "zeq-run-v1", run_id: runId, engine: "doomgeneric", engine_commit: identity.commit, engine_build_sha256: identity.engineSha256, wad_sha256: identity.wadSha256, ruleset: RULESETS[ruleset], compatibility: "0", tick_rate: "35", initial_rng: "0", settings_sha256: sha256(Security.canonical(settings)), time_origin: { kind: "doom-tic", gametic: "0" }, episode: "1", map: "1", skill: String(settings.skill), max_tic: String(settings.maxTic), input_sha256: inputSha256 },
    settings
  };
}

async function runHeadless(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const identity = engineIdentity(root);
  const runId = options.runId || crypto.randomBytes(16).toString("hex");
  if (!/^[0-9a-f]{32}$/.test(runId)) throw new Error("invalid run identity");
  let liveCommands = [];
  let bytes;
  if (options.inputArtifact) bytes = decodeInputArtifact(options.inputArtifact, runId);
  else if (options.input) bytes = Buffer.from(options.input);
  else if (options.commands) { bytes = encodeCommands(options.commands); liveCommands = options.commands.slice(); }
  else bytes = null;
  const initialDigest = bytes ? sha256(bytes) : null;
  const descriptor = createRun(identity, options, runId, initialDigest);
  const { settings } = descriptor;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-headless-"));
  const launch = engineCommand(identity.engine);
  const args = [...launch.prefix, "-iwad", identity.wad, "-warp", "1", "1", "-skill", String(settings.skill + 1), "-nosound", "-nomusic", "-config", "default.cfg"];
  const child = spawn(launch.command, args, { cwd, env: { ...process.env, ZEQ_RUN_ID: runId, ZEQ_MAX_TIC: String(settings.maxTic), ZEQ_CHECKPOINT_INTERVAL: String(settings.checkpointInterval), ZEQ_RULESET: String(settings.ruleset), ZEQ_REALTIME: options.realtime ? "1" : "0" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let stopped = false;
  let lastTic = -1;
  if (typeof options.onControl === "function") options.onControl({
    child,
    stop() { stopped = true; child.kill("SIGTERM"); },
    inject(command) {
      if (bytes) throw new Error("offline input stream is immutable");
      const record = encodeCommand(command);
      if (command.gametic <= lastTic) throw new Error("input tics must strictly increase");
      lastTic = command.gametic;
      liveCommands.push({ ...command });
      if (liveCommands.length > INPUT_LIMIT) throw new Error("input limit");
      child.stdin.write(record);
    }
  });
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stopped = true; child.kill("SIGKILL"); reject(new Error("headless engine timeout")); }, options.timeoutMs || (options.realtime ? 600000 : 120000));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 67108864) { stopped = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-65536); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      try {
        if (stopped || code !== 0) throw new Error(`headless engine stopped: code=${code} signal=${signal} ${stderr.slice(-1000)}`);
        const records = parseRecords(stdout);
        const hashes = stateHashes(records, settings.maxTic, settings.checkpointInterval);
        const commands = bytes ? null : liveCommands;
        const inputArtifact = bytes ? {
          format: "zeq-input-v1", run_id: runId, tick_rate: "35", record_format: "zeq-ticcmd-le-v1", record_bytes: INPUT_BYTES,
          count: bytes.length / INPUT_BYTES, encoding: "base64", data: bytes.toString("base64"), sha256: sha256(bytes)
        } : createInputArtifact(commands, runId);
        descriptor.run.input_sha256 = inputArtifact.sha256;
        resolve({ run: descriptor.run, settings, inputArtifact, records, checkpoints: records.filter((r) => r.kind === "checkpoint"), events: records.filter((r) => r.kind === "engine-event"), stateHashes: hashes });
      } catch (error) { reject(error); }
      finally { fs.rmSync(cwd, { recursive: true, force: true }); }
    });
  });
  if (bytes) child.stdin.end(bytes);
  return completed;
}

function compareReproduction(recorded, reproduced) {
  const inputMatches = recorded.inputArtifact.sha256 === reproduced.inputArtifact.sha256;
  const hashesMatch = JSON.stringify(recorded.stateHashes) === JSON.stringify(reproduced.stateHashes);
  return { status: inputMatches && hashesMatch ? "match" : "mismatch", mode: "headless", input_sha256: recorded.inputArtifact.sha256, compared_checkpoints: Math.min(recorded.stateHashes.length, reproduced.stateHashes.length), state_hashes: reproduced.stateHashes, engine_build_sha256: reproduced.run.engine_build_sha256 };
}

function exactTime(gametic) {
  const numerator = BigInt(gametic) * 1000000000n;
  const denominator = 35n * 777000777n;
  return { zeqond: (numerator / denominator).toString(), phase64: (((numerator % denominator) << 64n) / denominator).toString() };
}

async function exportReplayProof(recorded, comparison, signer) {
  const events = recorded.events.map((event) => ({
    ...exactTime(event.gametic), gametic: String(event.gametic), ruleset: recorded.run.ruleset,
    kind: "engine-diagnostic", payload: { type: event.type, phase: event.phase, value: event.value }
  }));
  return Security.createProof({ signer, run: recorded.run, sessionId: `headless-${recorded.run.run_id}`, events,
    inputRecordsOrDigest: { sha256: recorded.inputArtifact.sha256, count: recorded.inputArtifact.count, record_format: recorded.inputArtifact.record_format },
    stateHashes: recorded.stateHashes, checkpointInterval: recorded.settings.checkpointInterval,
    createdZeqond: exactTime(recorded.settings.maxTic).zeqond,
    replay: { status: comparison.status, mode: "headless", input_sha256: comparison.input_sha256, compared_checkpoints: comparison.compared_checkpoints } });
}

async function verifyReplayProof(proof, options = {}) {
  return Security.verifyProof(proof, { trustedKeyIds: options.trustedKeyIds, replayAdapter: async (claimed) => {
    const reproduced = await runHeadless({ root: options.root, runId: claimed.run.run_id, inputArtifact: options.inputArtifact, ruleset: RULESETS.indexOf(claimed.run.ruleset), skill: Number(claimed.run.skill), maxTic: Number(claimed.run.max_tic), checkpointInterval: Number(claimed.checkpoint_interval) });
    return { status: "match", state_hashes: reproduced.stateHashes, compared_checkpoints: reproduced.stateHashes.length };
  } });
}

module.exports = { INPUT_BYTES, RULESETS, encodeCommand, encodeCommands, createInputArtifact, decodeInputArtifact, runHeadless, stateHashes, compareReproduction, exportReplayProof, verifyReplayProof, exactTime, sha256 };
