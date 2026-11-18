"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

class Client {
  constructor(args) {
    this.child = spawn(process.execPath, [path.resolve(__dirname, "../zeq-mcp.js"), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    this.pending = new Map(); this.serial = 0; this.buffer = ""; this.stderr = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        const packet = JSON.parse(line);
        const waiter = this.pending.get(packet.id);
        if (!waiter) continue;
        this.pending.delete(packet.id); clearTimeout(waiter.timer);
        if (packet.error) waiter.reject(new Error(packet.error.message)); else waiter.resolve(packet.result);
      }
    });
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
  }
  request(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  async close() { this.child.kill("SIGTERM"); }
}

async function eventually(client, predicate) {
  for (let i = 0; i < 200; i++) {
    const status = await client.request("zeq.run.status");
    if (predicate(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("lifecycle timeout");
}

(async () => {
  const readonly = new Client([]);
  try {
    const initialized = await readonly.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    assert.equal(initialized.serverInfo.name, "zeq-doomgeneric");
    const tools = await readonly.request("tools/list");
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["zeq.run.start", "zeq.run.stop", "zeq.run.status", "zeq.input.inject", "zeq.state.read", "zeq.proof.export", "zeq.verify"]);
    await assert.rejects(readonly.request("zeq.run.start", { commands: [] }), /disabled/);
    await assert.rejects(readonly.request("zeq.input.inject", { command: { gametic: 0 } }), /disabled/);
    await assert.rejects(readonly.request("zeq.run.status", { nested: { privateKey: "must-not-appear" } }), /forbidden/);
    assert.ok(!readonly.stderr.includes("must-not-appear"));
  } finally { await readonly.close(); }

  const client = new Client(["--allow-run", "--allow-input"]);
  try {
    const commands = Array.from({ length: 70 }, (_, gametic) => ({ gametic, forwardmove: gametic < 35 ? 20 : 0, buttons: gametic >= 35 ? 1 : 0 }));
    const started = await client.request("zeq.run.start", { commands, maxTic: 70, checkpointInterval: 35 });
    assert.equal(started.status, "running");
    await eventually(client, (status) => status.status === "completed");
    const state = await client.request("zeq.state.read");
    assert.equal(state.state.gametic, "70");
    const exported = await client.request("zeq.proof.export");
    assert.equal(exported.proof.replay.status, "match");
    assert.equal(exported.proof.replay.compared_checkpoints, 2);
    const verified = await client.request("zeq.verify");
    assert.equal(verified.ok, true);
    assert.equal(verified.replay, "match");

    await client.request("zeq.run.start", { maxTic: 35, checkpointInterval: 35 });
    const injected = await client.request("zeq.input.inject", { command: { gametic: 5, forwardmove: 25 } });
    assert.equal(injected.accepted, true);
    await eventually(client, (status) => status.status === "completed");
    const liveProof = await client.request("zeq.proof.export");
    assert.equal(liveProof.proof.replay.status, "match");

    await client.request("zeq.run.start", { maxTic: 350, checkpointInterval: 35 });
    const stopped = await client.request("zeq.run.stop");
    assert.equal(stopped.status, "stopped");
    const final = await eventually(client, (status) => status.status === "stopped");
    assert.equal(final.replay, "not-run");
    await assert.rejects(client.request("zeq.run.status", { pin: "12345678" }), /forbidden/);
    await assert.rejects(client.request("zeq.run.status", { machine_equation: "secret" }), /forbidden/);
  } finally { await client.close(); }
  console.log("MCP OK: initialize/tools, read-only defaults, offline/live runs, stop/status/state, signed match, real verification, secret rejection");
})().catch((error) => { console.error(error); process.exitCode = 1; });
