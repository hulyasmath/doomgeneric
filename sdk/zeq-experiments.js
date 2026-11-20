"use strict";
// Versioned scenarios, bounded conditions, sweeps, cancellation, and reproduction packages.
(function (root, factory) {
  const security = typeof module === "object" && module.exports ? require("./zeq-security.js") : root.ZeqSecurity;
  const api = factory(security);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqExperiments = api;
})(typeof window !== "undefined" ? window : globalThis, function (Security) {
  const FORMAT = "zeq-experiment-v1", SCENARIO = "zeq-scenario-v1", CONDITION = "zeq-condition-v1";
  const MAX_JSON = 1048576, MAX_SCHEDULE = 100000, MAX_RUNS = 1024;
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const id = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value);
  const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  function integer(value, name, minimum, maximum, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`invalid ${name}`);
    return value;
  }
  function canonicalBounded(value, limit = MAX_JSON) {
    const text = Security.canonical(value);
    if (new TextEncoder().encode(text).length > limit) throw new RangeError("canonical value size limit");
    return text;
  }
  function parameters(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("parameters must be an object");
    for (const [key, entry] of Object.entries(value)) {
      if (!id(key) || !Number.isSafeInteger(entry)) throw new TypeError("scenario parameters must be named safe integers");
    }
    canonicalBounded(value, 65536); return Object.freeze({ ...value });
  }
  function compileSchedule(events, maxTic) {
    if (events === undefined) events = [];
    if (!Array.isArray(events) || events.length > MAX_SCHEDULE) throw new RangeError("invalid schedule length");
    const byTic = Array.from({ length: maxTic }, () => []);
    const normalized = events.map((event, ordinal) => {
      if (!event || typeof event !== "object" || !Object.hasOwn(event, "command")) throw new TypeError("schedule event command required");
      const tic = integer(event.tic, "schedule tic", 0, maxTic - 1);
      const command = event.command;
      canonicalBounded(command, 65536);
      return Object.freeze({ tic, ordinal, command });
    }).sort((a, b) => a.tic - b.tic || a.ordinal - b.ordinal);
    for (const event of normalized) byTic[event.tic].push(event.command);
    return { normalized: normalized.map(event => Object.freeze({ tic: event.tic, command: event.command })), byTic };
  }
  function validateScenario(definition) {
    if (!definition || definition.format !== SCENARIO || !id(definition.id) || !/^\d{1,10}$/.test(definition.version || "")) throw new TypeError("invalid scenario identity");
    const tickRate = integer(definition.tick_rate, "tick_rate", 1, 1000);
    const maxTic = integer(definition.max_tic, "max_tic", 1, 1000000);
    const checkpointInterval = integer(definition.checkpoint_interval, "checkpoint_interval", 1, maxTic);
    if (!/^[0-9a-f]{32}$/.test(definition.seed || "")) throw new TypeError("scenario seed must be 16 public bytes of hex");
    const baseParameters = parameters(definition.parameters || {});
    const schedule = compileSchedule(definition.schedule, maxTic);
    const normalized = { ...definition, tick_rate: tickRate, max_tic: maxTic, checkpoint_interval: checkpointInterval, parameters: baseParameters, schedule: schedule.normalized };
    canonicalBounded(normalized);
    return { definition: normalized, schedule: schedule.byTic, baseParameters };
  }
  function adapterIdentity(value) {
    if (!value || !id(value.name) || !/^\d{1,10}$/.test(value.version || "") || !digest(value.source_sha256)) throw new TypeError("adapter source identity required");
    const result = { name: value.name, version: value.version, source_sha256: value.source_sha256 };
    canonicalBounded(result, 4096); return Object.freeze(result);
  }
  function cancelled(options) { return typeof options.shouldCancel === "function" && options.shouldCancel() === true; }

  async function runScenario(adapter, scenario, options = {}) {
    const checked = validateScenario(scenario), identity = adapterIdentity(options.adapterIdentity);
    const selected = parameters({ ...checked.baseParameters, ...(options.parameters || {}) });
    for (const key of Object.keys(options.parameters || {})) if (!Object.hasOwn(checked.baseParameters, key)) throw new TypeError(`undeclared scenario parameter ${key}`);
    const maxMilliseconds = integer(options.maxMilliseconds, "maxMilliseconds", 1, 600000, 60000);
    const started = clock(), checkpoints = [], commands = [];
    let session, status = "ok", failure = null, cancellationTic = null, numericalStatus = "not-applicable";
    try {
      if (!adapter || typeof adapter.create !== "function") throw new TypeError("scenario adapter.create required");
      session = await adapter.create({ scenario: checked.definition, parameters: selected, schedule: checked.schedule.map(list => list.map(command => command)) });
      if (!session || typeof session.step !== "function" || typeof session.stateHash !== "function") throw new TypeError("adapter session requires step and stateHash");
      for (let tic = 0; tic < checked.definition.max_tic; tic++) {
        if (cancelled(options)) { status = "cancelled"; cancellationTic = tic; break; }
        if (clock() - started > maxMilliseconds) { status = "budget-exceeded"; failure = "time budget exceeded"; cancellationTic = tic; break; }
        const due = checked.schedule[tic];
        await session.step(tic, due.map(command => command));
        for (const command of due) commands.push(command);
        const completed = tic + 1;
        if (completed % checked.definition.checkpoint_interval === 0 || completed === checked.definition.max_tic) {
          const stateHash = await session.stateHash();
          if (!digest(stateHash)) throw new TypeError("adapter returned invalid canonical state hash");
          checkpoints.push({ gametic: String(completed), state_sha256: stateHash });
        }
      }
      if (session.numericalStatus !== undefined) {
        if (typeof session.numericalStatus !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(session.numericalStatus)) throw new TypeError("invalid numerical status");
        numericalStatus = session.numericalStatus;
      }
    } catch (error) {
      status = "failed"; failure = String(error?.message || error).slice(0, 512);
    } finally { if (session && typeof session.close === "function") await session.close(); }
    return { parameters: selected, status, failure, cancellation_tic: cancellationTic === null ? null : String(cancellationTic), checkpoints, numerical_status: numericalStatus, input_sha256: await Security.sha256(Security.canonical(commands)), adapter: identity };
  }

  function sweepParameters(base, axes) {
    if (!axes || typeof axes !== "object" || Array.isArray(axes)) throw new TypeError("sweep axes must be an object");
    const names = Object.keys(axes).sort();
    if (names.length > 16) throw new RangeError("sweep axis limit");
    for (const name of names) {
      if (!Object.hasOwn(base, name) || !Array.isArray(axes[name]) || !axes[name].length || axes[name].length > 64) throw new TypeError("invalid or undeclared sweep axis");
      parameters(Object.fromEntries([[name, 0]]));
      if (axes[name].some(value => !Number.isSafeInteger(value)) || new Set(axes[name]).size !== axes[name].length) throw new TypeError("sweep values must be distinct safe integers");
    }
    const combinations = [];
    function visit(index, current) {
      if (combinations.length >= MAX_RUNS) throw new RangeError("parameter sweep run limit");
      if (index === names.length) { combinations.push({ ...current }); return; }
      const name = names[index];
      for (const value of axes[name]) visit(index + 1, { ...current, [name]: value });
    }
    visit(0, {});
    if (!combinations.length) throw new RangeError("empty parameter sweep");
    return combinations;
  }

  async function runExperiment(adapter, scenario, options = {}) {
    const checked = validateScenario(scenario), identity = adapterIdentity(options.adapterIdentity);
    const combinations = options.sweep ? sweepParameters(checked.baseParameters, options.sweep) : [{}];
    const runs = [];
    for (const selected of combinations) {
      if (cancelled(options)) { runs.push({ parameters: { ...checked.baseParameters, ...selected }, status: "cancelled", failure: "cancelled before run", cancellation_tic: "0", checkpoints: [], numerical_status: "not-applicable", input_sha256: await Security.sha256("[]"), adapter: identity }); break; }
      runs.push(await runScenario(adapter, scenario, { ...options, parameters: selected, adapterIdentity: identity }));
      if (options.stopOnFailure && runs.at(-1).status !== "ok") break;
    }
    const scenarioSha256 = await Security.sha256(Security.canonical(checked.definition));
    const status = runs.every(run => run.status === "ok") && runs.length === combinations.length ? "ok" : runs.some(run => run.status === "failed") ? "failed" : runs.some(run => run.status === "budget-exceeded") ? "budget-exceeded" : "cancelled";
    const body = {
      format: FORMAT, status, scenario: checked.definition, scenario_sha256: scenarioSha256,
      source: { sdk: FORMAT, adapter: identity }, runs,
      reproduction: { mode: "exact-canonical-state-sha256", scenario_sha256: scenarioSha256, adapter: identity, instruction: "Supply the same scenario, parameters, ordered commands, and a compatible source-identified adapter; compare every checkpoint and numerical status." },
      limitations: "Package integrity and adapter reproduction do not prove physical accuracy, host honesty, or competitive legitimacy."
    };
    canonicalBounded(body, 16 * MAX_JSON);
    return { ...body, status, experiment_sha256: await Security.sha256(Security.canonical(body)) };
  }

  async function validatePackage(pkg) {
    try {
      if (!pkg || pkg.format !== FORMAT || !digest(pkg.experiment_sha256)) return { ok: false, why: "invalid experiment identity" };
      const checked = validateScenario(pkg.scenario), source = adapterIdentity(pkg.source?.adapter);
      const { experiment_sha256, ...body } = pkg;
      if (!["ok", "failed", "budget-exceeded", "cancelled"].includes(pkg.status)) return { ok: false, why: "invalid experiment status" };
      if (await Security.sha256(Security.canonical(body)) !== experiment_sha256) return { ok: false, why: "experiment digest mismatch" };
      if (await Security.sha256(Security.canonical(checked.definition)) !== pkg.scenario_sha256) return { ok: false, why: "scenario digest mismatch" };
      if (!Array.isArray(pkg.runs) || !pkg.runs.length || pkg.runs.length > MAX_RUNS) return { ok: false, why: "invalid run list" };
      for (const run of pkg.runs) {
        if (!run || !digest(run.input_sha256) || !Array.isArray(run.checkpoints) || !["ok", "failed", "budget-exceeded", "cancelled"].includes(run.status)) return { ok: false, why: "invalid run record" };
        parameters(run.parameters); canonicalBounded(run.adapter, 4096);
        if (Security.canonical(run.adapter) !== Security.canonical(source)) return { ok: false, why: "run adapter identity mismatch" };
        for (const checkpoint of run.checkpoints) if (!/^\d+$/.test(checkpoint.gametic) || !digest(checkpoint.state_sha256)) return { ok: false, why: "invalid checkpoint" };
      }
      return { ok: true, runs: pkg.runs.length, experiment_sha256, adapter: source };
    } catch (error) { return { ok: false, why: error.message }; }
  }

  async function reproduceExperiment(adapter, pkg, options = {}) {
    const valid = await validatePackage(pkg);
    if (!valid.ok) return { status: "invalid-package", comparisons: [], ...valid };
    const identity = adapterIdentity(options.adapterIdentity);
    if (Security.canonical(identity) !== Security.canonical(pkg.source.adapter)) return { status: "adapter-mismatch", ok: false, comparisons: [], why: "source identity differs; an explicit migration/comparison adapter is required" };
    const comparisons = [];
    for (const expected of pkg.runs) {
      if (expected.status !== "ok") {
        comparisons.push({ parameters: expected.parameters, status: "not-rerun", reason: `recorded status ${expected.status}` });
        continue;
      }
      const actual = await runScenario(adapter, pkg.scenario, { parameters: expected.parameters, adapterIdentity: identity, maxMilliseconds: options.maxMilliseconds, shouldCancel: options.shouldCancel });
      const exact = actual.status === expected.status && actual.input_sha256 === expected.input_sha256 && actual.numerical_status === expected.numerical_status && Security.canonical(actual.checkpoints) === Security.canonical(expected.checkpoints);
      const comparison = { parameters: expected.parameters, status: exact ? "match" : "mismatch", expected_status: expected.status, actual_status: actual.status, expected_checkpoints: expected.checkpoints.length, actual_checkpoints: actual.checkpoints.length, numerical_status: actual.numerical_status };
      if (!exact && typeof options.explainNumerical === "function") comparison.explanation = String(await options.explainNumerical(expected, actual)).slice(0, 2048);
      comparisons.push(comparison);
      if (!exact && options.stopOnMismatch) break;
    }
    return { ok: comparisons.every(item => item.status === "match"), status: comparisons.some(item => item.status === "mismatch") ? "mismatch" : comparisons.every(item => item.status === "match") ? "match" : "partial", mode: "exact-canonical-state-sha256", experiment_sha256: pkg.experiment_sha256, comparisons };
  }

  function evaluateCondition(condition, context) {
    let nodes = 0;
    const blocked = new Set(["__proto__", "prototype", "constructor"]);
    function walk(node, depth) {
      if (++nodes > 256 || depth > 32 || !node || typeof node !== "object" || Array.isArray(node) || node.format !== CONDITION || !id(node.op)) throw new TypeError("invalid or unbounded condition");
      const op = node.op;
      if (op === "literal") { canonicalBounded(node.value, 65536); return node.value; }
      if (op === "get") {
        if (!Array.isArray(node.path) || !node.path.length || node.path.length > 16 || node.path.some(part => typeof part !== "string" || blocked.has(part))) throw new TypeError("invalid condition path");
        let value = context;
        for (const part of node.path) { if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined; value = value[part]; }
        return value;
      }
      if (op === "not") return !walk(node.argument, depth + 1);
      if (op === "and" || op === "or") {
        if (!Array.isArray(node.arguments) || !node.arguments.length || node.arguments.length > 32) throw new TypeError("invalid logical condition");
        return op === "and" ? node.arguments.every(item => walk(item, depth + 1)) : node.arguments.some(item => walk(item, depth + 1));
      }
      if (["eq", "ne", "lt", "le", "gt", "ge"].includes(op)) {
        const left = walk(node.left, depth + 1), right = walk(node.right, depth + 1);
        if (left === undefined || right === undefined) return false;
        if (op === "eq") return Security.canonical(left) === Security.canonical(right);
        if (op === "ne") return Security.canonical(left) !== Security.canonical(right);
        if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) return false;
        return op === "lt" ? left < right : op === "le" ? left <= right : op === "gt" ? left > right : left >= right;
      }
      throw new TypeError("unsupported condition operator");
    }
    return walk(condition, 0) === true;
  }
  const literal = value => ({ format: CONDITION, op: "literal", value });
  const get = path => ({ format: CONDITION, op: "get", path });
  const comparison = (op, left, right) => ({ format: CONDITION, op, left, right });

  async function observeContracts(contracts, event, context, options = {}) {
    if (!Array.isArray(contracts) || contracts.length > 1024) throw new RangeError("invalid contract count");
    const granted = new Set(options.capabilities || []);
    const decisions = [];
    for (const contract of contracts) {
      if (!contract || !id(contract.id) || !contract.when || !contract.action || !id(contract.action.type)) throw new TypeError("invalid contract definition");
      canonicalBounded(contract, 65536);
      const matched = evaluateCondition(contract.when, { ...context, event });
      const capability = contract.action.capability || null;
      const allowed = matched && (!capability || granted.has(capability));
      const decision = { contract: contract.id, matched, capability, status: !matched ? "not-matched" : allowed ? "proposed" : "capability-refused", proposal: allowed ? contract.action : null };
      if (allowed && typeof options.propose === "function") {
        decision.host_result = await options.propose(contract.action, event);
        canonicalBounded(decision.host_result, 65536);
      }
      decisions.push(decision);
    }
    return { format: "zeq-contract-observation-v1", decisions, scope: "ordered proposals only; the authoritative host decides whether to act" };
  }

  return Object.freeze({ FORMAT, SCENARIO, CONDITION, validateScenario, compileSchedule, runScenario, runExperiment, validatePackage, reproduceExperiment, evaluateCondition, literal, get, comparison, observeContracts });
});
