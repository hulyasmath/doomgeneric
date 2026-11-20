"use strict";
const assert = require("node:assert/strict");
const E = require("../zeq-experiments.js");
const Security = require("../zeq-security.js");
const identity = { name: "integer-test-adapter", version: "1", source_sha256: "a".repeat(64) };
const scenario = {
  format: E.SCENARIO, id: "ordered-counter", version: "1", tick_rate: 20, max_tic: 6,
  checkpoint_interval: 2, seed: "0123456789abcdef0123456789abcdef", parameters: { delta: 1 },
  schedule: [{ tic: 4, command: { add: -1 } }, { tic: 1, command: { add: 2 } }]
};
const adapter = {
  async create({ parameters, schedule }) {
    let value = 0;
    assert.equal(schedule[1][0].add, 2);
    return {
      numericalStatus: "not-applicable",
      async step(tic, commands) { value += parameters.delta + commands.reduce((sum, command) => sum + command.add, 0); },
      async stateHash() { return Security.sha256(Security.canonical({ value })); },
      async close() {}
    };
  }
};
(async () => {
  const pkg = await E.runExperiment(adapter, scenario, { adapterIdentity: identity, sweep: { delta: [1, 2] } });
  assert.equal(pkg.status, "ok");
  assert.equal(pkg.runs.length, 2);
  assert.equal(pkg.runs[0].checkpoints.length, 3);
  assert.equal(pkg.runs[0].checkpoints[0].gametic, "2");
  const repeat = await E.runExperiment(adapter, scenario, { adapterIdentity: identity, sweep: { delta: [1, 2] } });
  assert.equal(repeat.experiment_sha256, pkg.experiment_sha256);
  const packageValidation = await E.validatePackage(pkg);
  assert.equal(packageValidation.ok, true, packageValidation.why);
  const reproduced = await E.reproduceExperiment(adapter, pkg, { adapterIdentity: identity });
  assert.equal(reproduced.status, "match");
  assert.equal(reproduced.comparisons.length, 2);
  const wrongAdapter = await E.reproduceExperiment(adapter, pkg, { adapterIdentity: { ...identity, source_sha256: "b".repeat(64) } });
  assert.equal(wrongAdapter.status, "adapter-mismatch");
  const tampered = JSON.parse(JSON.stringify(pkg));
  tampered.runs[0].checkpoints[0].state_sha256 = "0".repeat(64);
  assert.equal((await E.validatePackage(tampered)).ok, false);
  const statusTampered = JSON.parse(JSON.stringify(pkg)); statusTampered.status = "cancelled";
  assert.equal((await E.validatePackage(statusTampered)).ok, false);
  let cancellationChecks = 0;
  const cancelled = await E.runScenario(adapter, scenario, { adapterIdentity: identity, shouldCancel: () => ++cancellationChecks > 2 });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellation_tic, "2");
  const failed = await E.runScenario({ create: async () => ({ step: async () => { throw new Error("host failure"); }, stateHash: async () => "0".repeat(64) }) }, scenario, { adapterIdentity: identity });
  assert.equal(failed.status, "failed");
  assert.match(failed.failure, /host failure/);
  assert.throws(() => E.validateScenario({ ...scenario, schedule: [{ tic: 6, command: {} }] }), /schedule tic/);
  const condition = E.comparison("ge", E.get(["event", "value"]), E.literal(3));
  assert.equal(E.evaluateCondition(condition, { event: { value: 3 } }), true);
  assert.equal(E.evaluateCondition(condition, { event: { value: 2 } }), false);
  assert.equal(E.evaluateCondition(E.comparison("lt", E.get(["missing"]), E.literal(1)), {}), false);
  assert.throws(() => E.evaluateCondition({ format: E.CONDITION, op: "get", path: ["constructor"] }, {}), /path/);
  const contracts = [
    { id: "read-only", when: condition, action: { type: "record" } },
    { id: "scoped-input", when: condition, action: { type: "input", capability: "input:write", amount: 1 } }
  ];
  const denied = await E.observeContracts(contracts, { value: 4 }, {});
  assert.equal(denied.decisions[0].status, "proposed");
  assert.equal(denied.decisions[1].status, "capability-refused");
  const allowed = await E.observeContracts(contracts, { value: 4 }, {}, { capabilities: ["input:write"], propose: async action => ({ accepted: action.type === "input" }) });
  assert.equal(allowed.decisions[1].host_result.accepted, true);
  console.log(JSON.stringify({ ok: true, format: E.FORMAT, scenario: E.SCENARIO, deterministicPackageDigest: pkg.experiment_sha256, sweepRuns: pkg.runs.length, reproduced: reproduced.status, cancellation: cancelled.status, failureRecord: failed.status, boundedConditions: true, defaultCapabilityDenial: true, tamperRefusal: true }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
