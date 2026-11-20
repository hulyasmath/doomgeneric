"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const Chamber = require("../reference/zeq-chamber.js");
const Experiments = require("../zeq-experiments.js");
const Security = require("../zeq-security.js");

const ROOT = path.resolve(__dirname, "../..");
const probe = `/tmp/zeq-chamber-probe-${process.pid}`;
let rng = 0x12345678;
function random() { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return rng >>> 0; }
function commands(count, extreme = false) {
  return Array.from({ length: count }, (_, tic) => extreme
    ? { ax: tic % 2 ? -127 : 127, ay: tic % 3 ? 127 : -127 }
    : { ax: Math.max(-127, (random() & 255) - 128),
        ay: Math.max(-127, (random() & 255) - 128) });
}
function digest(hex) { return crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex"); }
(async () => {
  const started = performance.now();
  let compiled = spawnSync("cc", ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror",
    path.join(__dirname, "zeq_chamber_probe.c"), path.join(ROOT, "sdk/reference/zeq_chamber.c"),
    "-I", path.join(ROOT, "sdk/reference"), "-o", probe], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);

  const cases = [];
  for (let index = 0; index < 32; index++) cases.push({ seed: random(), particles: 1 + index % 16,
    commands: commands(70 + index % 4 * 35, index % 5 === 0) });
  cases.push({ seed: 0, particles: 4, commands: commands(140, true) });
  const expected = cases.map(test => Chamber.replay(test.commands, test));
  const request = [];
  for (const test of cases) {
    const header = Buffer.alloc(16); header.write("ZEQCHRQ1"); header.writeUInt32LE(test.seed, 8);
    header.writeUInt16LE(test.commands.length, 12); header.writeUInt16LE(test.particles, 14);
    request.push(header);
    for (const command of test.commands) request.push(Buffer.from([command.ax & 255, command.ay & 255]));
  }
  const native = spawnSync(probe, [], { input: Buffer.concat(request), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(native.status, 0, native.stderr);
  const cHex = native.stdout.trim().split("\n");
  assert.equal(cHex.length, cases.length);
  cHex.forEach((hex, index) => assert.equal(hex, expected[index].state_hex, `C case ${index}`));

  const python = spawnSync("python3", [path.join(ROOT, "sdk/reference/zeq_chamber.py")], {
    input: JSON.stringify(cases[cases.length - 1]), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(python.status, 0, python.stderr);
  const pythonResult = JSON.parse(python.stdout);
  assert.equal(pythonResult.state_hex, expected[expected.length - 1].state_hex);
  assert.equal(pythonResult.state_sha256, digest(expected[expected.length - 1].state_hex));
  assert.deepEqual(pythonResult.checkpoints, expected[expected.length - 1].checkpoints);

  for (let index = 0; index < 1000; index++) {
    const test = cases[index % cases.length];
    const count = index % test.commands.length;
    const first = Chamber.replay(test.commands.slice(0, count), test);
    const second = Chamber.replay(test.commands.slice(0, count), test);
    assert.equal(first.state_hex, second.state_hex);
    assert.equal(first.state_sha256, undefined); // Hashing is deliberately an adapter operation.
    for (const particle of first.state.particles) {
      for (const key of ["x", "y"]) assert.ok(Math.abs(particle[key]) <= Chamber.LIMIT);
      for (const key of ["vx", "vy"]) assert.ok(Math.abs(particle[key]) <= Chamber.MAX_SPEED);
    }
  }
  assert.throws(() => new Chamber.Chamber({ particles: 0 }), /particle/);
  assert.throws(() => new Chamber.Chamber().step({ ax: 128 }), /acceleration/);
  assert.throws(() => new Chamber.Chamber().step({ ax: 1.5 }), /acceleration/);
  assert.throws(() => Chamber.replay("not-an-array"), /replay/);
  const initial = new Chamber.Chamber({ seed: 1, particles: 4 });
  assert.equal(initial.stateBytes().length, 88);
  assert.equal(new TextDecoder().decode(initial.stateBytes().subarray(0, 7)), "ZEQCHM1");

  const domain = JSON.parse(fs.readFileSync(path.join(ROOT, "sdk/domain-packs/chamber-conformance-v1.json"), "utf8"));
  assert.equal(Chamber.validateDomainPack(domain).ok, true);
  assert.equal(Chamber.validateDomainPack({ ...domain, constants: { ...domain.constants, scale: 1000 } }).ok, false);
  assert.equal(Chamber.validateDomainPack({ ...domain, provenance: { kind: "measured" } }).ok, false);
  const domainDigest = crypto.createHash("sha256").update(Security.canonical(domain)).digest("hex");

  // Use the non-Doom host through the general experiment/reproduction adapter.
  const scenario = { format: Experiments.SCENARIO, id: "chamber-reference", version: "1", tick_rate: 35,
    max_tic: 70, checkpoint_interval: 35, seed: "0123456789abcdef0123456789abcdef",
    parameters: { seed: 1234 }, schedule: Array.from({ length: 70 }, (_, tic) => ({ tic,
      command: { ax: tic % 7 - 3, ay: 2 - tic % 5 } })) };
  const sourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "sdk/reference/zeq-chamber.js"))).digest("hex");
  const adapterIdentity = { name: "zeq-chamber-javascript", version: "1", source_sha256: sourceSha256 };
  const adapter = { async create({ parameters, schedule }) {
    const simulation = new Chamber.Chamber({ seed: parameters.seed });
    return { numericalStatus: "not-applicable", async step(tic, inputs) {
      assert.equal(tic, simulation.tic);
      simulation.step(inputs[0] || {});
    }, async stateHash() { return Security.sha256(simulation.stateBytes()); }, async close() {} };
  } };
  const pkg = await Experiments.runExperiment(adapter, scenario, { adapterIdentity });
  assert.equal(pkg.status, "ok");
  assert.equal((await Experiments.validatePackage(pkg)).ok, true);
  assert.equal((await Experiments.reproduceExperiment(adapter, pkg, { adapterIdentity })).status, "match");

  console.log(JSON.stringify({ ok: true, format: Chamber.FORMAT, hosts: ["c99-exact-int32", "javascript-safe-integer", "python-exact-int"],
    differentialCases: cases.length, differentialFinalBytes: true, pythonCheckpoints: true,
    deterministicPropertyRuns: 1000, domainPack: domain.id, domainPackSha256: domainDigest,
    experimentPackage: pkg.experiment_sha256, reproduction: "match", doomImports: 0,
    wallMs: Number((performance.now() - started).toFixed(3)), physicalAccuracyClaim: false }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
