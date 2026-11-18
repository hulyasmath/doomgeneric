#!/usr/bin/env node
"use strict";

// Local stdio MCP adapter. Secrets and executable paths are never RPC inputs.
const readline = require("node:readline");
const path = require("node:path");
const Replay = require("./zeq-replay.js");
const Security = require("./zeq-security.js");

const allowRun = process.argv.includes("--allow-run");
const allowInput = process.argv.includes("--allow-input");
const root = path.resolve(__dirname, "..");
let current = null;
let lastProof = null;
let lastInput = null;
let serial = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertNoSecrets(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) { for (const item of value) assertNoSecrets(item, depth + 1); return; }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["pin", "password", "passphrase", "privatekey", "signingkey", "privateseed", "machineseed", "machineequation", "seed"].includes(normalized)) throw fail(-32602, "secret material is forbidden on MCP");
    assertNoSecrets(child, depth + 1);
  }
}

function publicStatus() {
  if (!current) return { status: "not-run" };
  return {
    status: current.status, run_id: current.runId, replay: current.result && current.result.replay ? current.result.replay.status : "not-run",
    checkpoints: current.checkpoints.length, events: current.events.length,
    latest: current.checkpoints[current.checkpoints.length - 1] || null,
    error: current.error || null
  };
}

function requireCurrent() {
  if (!current) throw fail(-32602, "no run exists");
  return current;
}

async function call(name, args = {}) {
  assertNoSecrets(args);
  if (name === "zeq.run.start") {
    if (!allowRun) throw fail(-32600, "run control is disabled; restart with --allow-run");
    if (current && ["running", "verifying", "stopping"].includes(current.status)) throw fail(-32602, "a run is already active");
    const runId = require("node:crypto").randomBytes(16).toString("hex");
    const maxTic = args.maxTic === undefined ? 350 : args.maxTic;
    const checkpointInterval = args.checkpointInterval === undefined ? 35 : args.checkpointInterval;
    const run = { runId, status: "running", checkpoints: [], events: [], result: null, error: null, control: null, promise: null, options: { maxTic, checkpointInterval, ruleset: args.ruleset, skill: args.skill } };
    current = run;
    const hasOfflineInput = Array.isArray(args.commands) || args.input;
    run.promise = Replay.runHeadless({ root, runId, commands: args.commands, inputArtifact: args.input ? { ...args.input, run_id: runId } : undefined,
      realtime: hasOfflineInput ? false : true, maxTic, checkpointInterval, ruleset: args.ruleset, skill: args.skill,
      onControl(control) {
        run.control = control;
        control.child.stdout.setEncoding("utf8");
        let pending = "";
        control.child.stdout.on("data", (chunk) => {
          pending += chunk;
          let end;
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            if (!line.startsWith("ZEQJ")) continue;
            try {
              const record = JSON.parse(line.slice(4));
              if (record.kind === "checkpoint") run.checkpoints.push(record);
              if (record.kind === "engine-event") run.events.push(record);
            } catch (_) { /* final parser rejects malformed engine output */ }
          }
        });
      }
    }).then((result) => { run.result = result; run.status = "completed"; return result; })
      .catch((error) => { run.error = error.message; if (run.status !== "stopped") run.status = "error"; throw error; });
    run.promise.catch(() => {});
    return { status: run.status, run_id: runId, max_tic: String(maxTic), input_mode: hasOfflineInput ? "offline" : "live" };
  }
  if (name === "zeq.run.stop") {
    if (!allowRun) throw fail(-32600, "run control is disabled");
    const run = requireCurrent();
    if (run.status !== "running" || !run.control) return publicStatus();
    run.status = "stopping"; run.control.stop(); run.status = "stopped";
    return publicStatus();
  }
  if (name === "zeq.run.status") return publicStatus();
  if (name === "zeq.state.read") {
    const run = requireCurrent();
    return { run_id: run.runId, state: run.checkpoints[run.checkpoints.length - 1] || null, status: run.status };
  }
  if (name === "zeq.input.inject") {
    if (!allowInput) throw fail(-32600, "input injection is disabled; restart with --allow-input");
    const run = requireCurrent();
    if (run.status !== "running" || !run.control) throw fail(-32602, "run does not accept live input");
    run.control.inject(args.command || args);
    return { accepted: true, gametic: String((args.command || args).gametic) };
  }
  if (name === "zeq.proof.export") {
    if (!allowRun) throw fail(-32600, "replay reproduction is disabled");
    const run = requireCurrent();
    run.status = run.status === "running" ? "running" : "verifying";
    const recorded = await run.promise;
    run.status = "verifying";
    const reproduced = await Replay.runHeadless({ root, runId: run.runId, inputArtifact: recorded.inputArtifact, ...run.options });
    const comparison = Replay.compareReproduction(recorded, reproduced);
    const signer = await Security.createSigner("mcp-headless");
    const proof = await Replay.exportReplayProof(recorded, comparison, signer);
    proof.replay.engine_build_sha256 = reproduced.run.engine_build_sha256;
    lastProof = proof; lastInput = recorded.inputArtifact;
    run.result = { replay: comparison };
    run.status = "completed";
    return { proof, input: recorded.inputArtifact };
  }
  if (name === "zeq.verify") {
    if (!allowRun) throw fail(-32600, "replay verification is disabled");
    const proof = args.proof || lastProof;
    const input = args.input || lastInput;
    if (!proof || !input) throw fail(-32602, "no proof and input are available");
    const result = await Replay.verifyReplayProof(proof, { root, inputArtifact: input, trustedKeyIds: args.trustedKeyIds });
    return result;
  }
  throw fail(-32601, `unknown method: ${name}`);
}

const definitions = [
  ["zeq.run.start", "Start a bounded real doomgeneric engine run", { maxTic: "number", checkpointInterval: "number", ruleset: "number", skill: "number", commands: "array", input: "object" }],
  ["zeq.run.stop", "Stop the active engine process", {}],
  ["zeq.run.status", "Read lifecycle and checkpoint status", {}],
  ["zeq.input.inject", "Inject one complete ticcmd_t into a live run", { command: "object" }],
  ["zeq.state.read", "Read the latest real engine checkpoint", {}],
  ["zeq.proof.export", "Reproduce the run and export signed proof-v2", {}],
  ["zeq.verify", "Verify signatures and independently reproduce a claimed match", { proof: "object", input: "object", trustedKeyIds: "array" }]
];

async function handle(packet) {
  if (packet.jsonrpc !== "2.0") throw fail(-32600, "JSON-RPC 2.0 required");
  if (packet.method === "initialize") return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "zeq-doomgeneric", version: "0.4.0" } };
  if (packet.method === "tools/list") return { tools: definitions.map(([name, description, properties]) => ({ name, description, inputSchema: { type: "object", properties: Object.fromEntries(Object.entries(properties).map(([key, type]) => [key, { type }])), additionalProperties: true } })) };
  if (packet.method === "tools/call") {
    if (!packet.params || typeof packet.params.name !== "string") throw fail(-32602, "tool name required");
    const result = await call(packet.params.name, packet.params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
  }
  return call(packet.method, packet.params || {});
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line) return;
  if (line.length > 1048576) { send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } }); return; }
  let packet;
  try { packet = JSON.parse(line); } catch (_) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
  if (packet.id === undefined) return;
  try { send({ jsonrpc: "2.0", id: packet.id, result: await handle(packet) }); }
  catch (error) { send({ jsonrpc: "2.0", id: packet.id, error: { code: error.code || -32603, message: error.message } }); }
});
lines.on("close", () => { if (current && current.control && current.status === "running") current.control.stop(); });
process.on("SIGINT", () => { if (current && current.control) current.control.stop(); process.exit(130); });
