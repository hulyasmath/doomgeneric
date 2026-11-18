/*
 * ZEQ GAME SDK / 0.3.0
 * Portable sidecar runtime for the 12-vector Zeq framework.
 *
 * Four independent modules, no external dependencies:
 *   ZeqSDK.time     - exact zeq-time-v1, Q64 and deterministic lapse math
 *   ZeqSDK.physics  - zeq-physics-v1 midpoint, impulses, and cooldowns
 *   ZeqSDK.carrier  - backwards-compatible legacy arcade approximation
 *   ZeqSDK.ledger   - SHA-256 hash-chained tamper-evident event chain
 *   ZeqSDK.bridge   - JSON-RPC 2.0 sidecar link over WebSocket
 *
 * The bridge is strictly optional: a game that never connects loses
 * nothing. Everything below works offline and locally first.
 */
(function (global) {
"use strict";

const ZEQ_CARRIER_NUM = 1287;
const ZEQ_WINDOW_LO = 0.185;
const ZEQ_WINDOW_HI = 0.315;
const ZEQ_ZEQOND_NUM = 777;
const SDK_VERSION = "0.3.0";
const tableApi = typeof module !== "undefined" && module.exports
  ? require("./zeq-time-table.js")
  : global.ZeqTimeTable;
const physicsTable = typeof module !== "undefined" && module.exports
  ? require("./zeq-physics-table.js")
  : global.ZeqPhysicsTable;
if (!tableApi || !Array.isArray(tableApi.sineQ30) || tableApi.sineQ30.length !== 4097) {
  throw new Error("zeq-time-table.js must load before zeq-game-sdk.js");
}
if (!physicsTable || physicsTable.format !== "zeq-physics-v1") {
  throw new Error("zeq-physics-table.js must load before zeq-game-sdk.js");
}

/* The original 0.1 API is retained under its honest legacy name. */
const legacyCarrier = {
  period(tickRate) { return tickRate * 1000; },
  phase(gametic, tickRate = 35) {
    const period = legacyCarrier.period(tickRate);
    return Number((BigInt(gametic) * BigInt(ZEQ_CARRIER_NUM)) % BigInt(period));
  },
  window(tickRate = 35) {
    const period = legacyCarrier.period(tickRate);
    return [Math.round(ZEQ_WINDOW_LO * period), Math.round(ZEQ_WINDOW_HI * period)];
  },
  aligned(gametic, tickRate = 35) {
    const phase = legacyCarrier.phase(gametic, tickRate);
    const [lo, hi] = legacyCarrier.window(tickRate);
    return phase >= lo && phase <= hi;
  },
  pulsePermille(gametic, tickRate = 35) {
    const phase = legacyCarrier.phase(gametic, tickRate);
    const angle = (2 * Math.PI * phase) / legacyCarrier.period(tickRate);
    return Math.round(1000 + 24 * Math.sin(angle));
  },
  zeqond(gametic, tickRate = 35) {
    return Number((BigInt(gametic) * BigInt(ZEQ_ZEQOND_NUM)) / BigInt(tickRate * 1000));
  }
};

/* Exact zeq-time-v1. All authoritative quantities use BigInt and decimal
 * strings. Host Math.sin/Math.sqrt never enter these calculations. */
const ZEQOND_NS = 777000777n;
const TWO64 = 18446744073709551616n;
const Q30 = 1073741824n;
const PI_Q40 = 3454217652358n;
const PHASE_MASK = TWO64 - 1n;

function checkedBigInt(value, name) {
  let result;
  try { result = BigInt(value); } catch (_) { throw new TypeError(`${name} must be an integer`); }
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds safe numeric input; use a string or BigInt`);
  return result;
}
function roundDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  let q = n / denominator;
  const r = n % denominator;
  if (r * 2n > denominator || (r * 2n === denominator && (q & 1n))) q++;
  return negative ? -q : q;
}
function phase64Ratio(remainder, denominator) {
  if (denominator <= 0n || remainder < 0n || remainder >= denominator) throw new RangeError("invalid phase ratio");
  return (remainder * TWO64) / denominator;
}
function fromNs(value) {
  const ns = checkedBigInt(value, "ns");
  let tick = ns / ZEQOND_NS;
  let remainder = ns % ZEQOND_NS;
  if (remainder < 0n) { remainder += ZEQOND_NS; tick--; }
  return time.atPhase64(tick, phase64Ratio(remainder, ZEQOND_NS));
}
function fromTic(value, tickRate = 35) {
  const gametic = checkedBigInt(value, "gametic");
  const rate = checkedBigInt(tickRate, "tickRate");
  if (gametic < 0n || rate <= 0n) throw new RangeError("invalid tic clock");
  const numerator = gametic * 1000000000n;
  const denominator = rate * ZEQOND_NS;
  return time.atPhase64(numerator / denominator, phase64Ratio(numerator % denominator, denominator));
}
function sinQ30(value) {
  const phase64 = checkedBigInt(value, "phase64") & PHASE_MASK;
  const index = Number(phase64 >> 52n);
  const fraction = phase64 & ((1n << 52n) - 1n);
  const base = BigInt(tableApi.sineQ30[index]);
  const delta = BigInt(tableApi.sineQ30[index + 1]) - base;
  return base + roundDiv(delta * fraction, 1n << 52n);
}
function cosQ30(value) { return sinQ30((checkedBigInt(value, "phase64") + (1n << 62n)) & PHASE_MASK); }
function isqrt(value) {
  if (value < 0n) throw new RangeError("negative square root");
  if (value < 2n) return value;
  let x = 1n << ((BigInt(value.toString(2).length) + 1n) >> 1n);
  while (true) {
    const y = (x + value / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
function fixedQ30(q) { return Number(q) / Number(Q30); }

const time = {
  format: "zeq-time-v1",
  constants: Object.freeze({ ZEQOND_NS, ALPHA_NUM: 129n, ALPHA_DEN: 100000n, TWO64, Q30, PI_Q40 }),
  roundDiv,
  split64(value) { const t = fromNs(value); return [t.zeqond, t.phase64]; },
  fromNs,
  fromTic,
  sinQ30,
  cosQ30,
  isqrt,
  atPhase64(tickValue, phaseValue) {
    const tick = checkedBigInt(tickValue, "tick");
    const phase64 = checkedBigInt(phaseValue, "phase64") & PHASE_MASK;
    const sine = sinQ30(phase64);
    const cosine = cosQ30(phase64);
    const lapse2 = Q30 - roundDiv(129n * sine, 100000n);
    const lapse = isqrt(lapse2 << 30n);
    const carrier = Q30 + roundDiv(129n * sine, 100000n);
    const derivative = roundDiv(-129n * PI_Q40 * cosine, 100000n * lapse2);
    return Object.freeze({
      format: "zeq-time-v1",
      zeqond: tick.toString(),
      phase64: phase64.toString(),
      phase64Hex: `0x${phase64.toString(16).padStart(16, "0")}`,
      phase: fixedQ30(phase64) / fixedQ30(TWO64),
      sinQ30: sine.toString(),
      cosQ30: cosine.toString(),
      carrierQ30: carrier.toString(),
      lapse2Q30: lapse2.toString(),
      lapseQ30: lapse.toString(),
      dlnCycleQ40: derivative.toString(),
      carrier: fixedQ30(carrier),
      lapse2: fixedQ30(lapse2),
      lapse: fixedQ30(lapse),
      dlnCycle: fixedQ30(derivative) / 1099511627776
    });
  },
  selfTest() {
    const failures = [];
    for (const vector of tableApi.smoke) {
      let actual;
      try { actual = vector.ns !== undefined ? fromNs(vector.ns) : fromTic(vector.gametic, vector.tick_rate); }
      catch (error) { failures.push({ vector, error: String(error) }); continue; }
      for (const [jsKey, vectorKey] of [["zeqond", "tick"], ["phase64", "phase64"], ["sinQ30", "sin_q30"], ["cosQ30", "cos_q30"], ["carrierQ30", "carrier_q30"], ["lapse2Q30", "lapse2_q30"], ["lapseQ30", "lapse_q30"], ["dlnCycleQ40", "dln_cycle_q40"]]) {
        if (actual[jsKey] !== String(vector[vectorKey])) failures.push({ vector, field: jsKey, expected: String(vector[vectorKey]), actual: actual[jsKey] });
      }
    }
    return { ok: failures.length === 0, count: tableApi.smoke.length, failures };
  }
};

/* Exact zeq-physics-v1. Doom momentum remains signed 16.16 integer data;
 * every force is evaluated inside the tic and its deterministic substeps. */
const Q40 = 1099511627776n;
const H_NUM = 1000000000n;

function metricsAlpha(phase64, alphaNum) {
  if (alphaNum === 0n) return { lapse2: Q30, derivative: 0n };
  if (alphaNum !== 129n) throw new RangeError("unsupported alpha");
  const values = time.atPhase64(0, phase64);
  return { lapse2: BigInt(values.lapse2Q30), derivative: BigInt(values.dlnCycleQ40) };
}

function integrateTic(gameticValue, velocityValue, options = {}) {
  const gametic = checkedBigInt(gameticValue, "gametic");
  const initial = checkedBigInt(velocityValue, "velocity");
  const acceleration = checkedBigInt(options.acceleration || 0, "acceleration");
  const impulse = checkedBigInt(options.impulse || 0, "impulse");
  const tickRate = checkedBigInt(options.tickRate === undefined ? 35 : options.tickRate, "tickRate");
  const alphaNum = checkedBigInt(options.alphaNum === undefined ? 129 : options.alphaNum, "alphaNum");
  const substeps = checkedBigInt(options.substeps === undefined ? (impulse ? 32 : 1) : options.substeps, "substeps");
  if (gametic < 0n || tickRate <= 0n || substeps <= 0n || substeps > 1024n) throw new RangeError("invalid integration domain");
  if (alphaNum !== 0n && alphaNum !== 129n) throw new RangeError("unsupported alpha");
  const hDen = tickRate * ZEQOND_NS;
  let velocity = initial;
  let midpointSum = 0n;
  let appliedForce = 0n;
  let appliedDrag = 0n;
  for (let k = 0n; k < substeps; k++) {
    const startPhase = fromTic(gametic * substeps + k, tickRate * substeps).phase64;
    const middlePhase = fromTic(2n * (gametic * substeps + k) + 1n, 2n * tickRate * substeps).phase64;
    let accelerationTic = acceleration;
    if (impulse) {
      const halfPhase = ((2n * k + 1n) << 63n) / (2n * substeps);
      accelerationTic += roundDiv(PI_Q40 * impulse * sinQ30(halfPhase), 2n * Q40 * Q30);
    }
    const start = metricsAlpha(startPhase, alphaNum);
    const middle = metricsAlpha(middlePhase, alphaNum);
    const midpoint = velocity
      + roundDiv(H_NUM * start.derivative * velocity, 2n * substeps * hDen * Q40)
      + roundDiv(start.lapse2 * accelerationTic, 2n * substeps * Q30);
    midpointSum += midpoint;
    const drag = roundDiv(H_NUM * middle.derivative * midpoint, substeps * hDen * Q40);
    const force = roundDiv(middle.lapse2 * accelerationTic, substeps * Q30);
    velocity += drag + force;
    appliedDrag += drag;
    appliedForce += force;
  }
  const position = roundDiv(midpointSum, substeps);
  return Object.freeze({
    format: "zeq-physics-v1",
    gametic: gametic.toString(), tickRate: tickRate.toString(), alphaNum: alphaNum.toString(),
    initialVelocity: initial.toString(), acceleration: acceleration.toString(), impulse: impulse.toString(),
    substeps: substeps.toString(), positionDelta: position.toString(), velocity: velocity.toString(),
    deltaVelocity: (velocity - initial).toString(), positionResidual: (midpointSum - position * substeps).toString(),
    appliedForce: appliedForce.toString(), appliedDrag: appliedDrag.toString(),
    startPhase64: fromTic(gametic, tickRate).phase64,
    endPhase64: fromTic(gametic + 1n, tickRate).phase64
  });
}

function cooldownReadyTic(startValue, numeratorValue, denominatorValue, tickRateValue = 35) {
  const start = checkedBigInt(startValue, "startTic");
  const numerator = checkedBigInt(numeratorValue, "durationNum");
  const denominator = checkedBigInt(denominatorValue, "durationDen");
  const tickRate = checkedBigInt(tickRateValue, "tickRate");
  if (start < 0n || numerator <= 0n || denominator <= 0n || tickRate <= 0n) throw new RangeError("invalid cooldown");
  const scaled = numerator * tickRate * ZEQOND_NS;
  const divisor = denominator * H_NUM;
  return (start + (scaled + divisor - 1n) / divisor).toString();
}

const physics = {
  format: "zeq-physics-v1",
  impulseFormat: "zeq-impulse-half-sine-v1",
  impulseSubsteps: 32,
  weaponDurations: physicsTable.weapon_durations,
  integrateTic,
  cooldownReadyTic,
  selfTest() {
    const failures = [];
    const fields = [["gametic", "gametic"], ["tickRate", "tick_rate"], ["alphaNum", "alpha_num"], ["initialVelocity", "initial_velocity"], ["acceleration", "acceleration"], ["impulse", "impulse"], ["substeps", "substeps"], ["positionDelta", "position_delta"], ["velocity", "velocity"], ["deltaVelocity", "delta_velocity"], ["positionResidual", "position_residual"], ["appliedForce", "applied_force"], ["appliedDrag", "applied_drag"], ["startPhase64", "start_phase64"], ["endPhase64", "end_phase64"]];
    for (const vector of physicsTable.integration) {
      try {
        const actual = integrateTic(vector.gametic, vector.initial_velocity, {
          acceleration: vector.acceleration, impulse: vector.impulse, substeps: vector.substeps,
          alphaNum: vector.alpha_num, tickRate: vector.tick_rate
        });
        for (const [actualKey, vectorKey] of fields) {
          if (actual[actualKey] !== String(vector[vectorKey])) failures.push({ vector, field: actualKey, expected: String(vector[vectorKey]), actual: actual[actualKey] });
        }
      } catch (error) { failures.push({ vector, error: String(error) }); }
    }
    for (const vector of physicsTable.cooldowns) {
      try {
        const actual = cooldownReadyTic(vector.start_tic, vector.duration_num, vector.duration_den, vector.tick_rate);
        if (actual !== String(vector.ready_tic)) failures.push({ vector, field: "readyTic", expected: String(vector.ready_tic), actual });
      } catch (error) { failures.push({ vector, error: String(error) }); }
    }
    const probe = physicsTable.integration.find((v) => v.initial_velocity === "1234567" && v.alpha_num === "129");
    if (probe) {
      const actual = integrateTic(probe.gametic, probe.initial_velocity, { tickRate: probe.tick_rate });
      const end = time.atPhase64(0, actual.endPhase64);
      const stamped = roundDiv(BigInt(probe.initial_velocity) * BigInt(end.carrierQ30), Q30).toString();
      if (stamped === actual.positionDelta) failures.push({ negative: "final-value R stamp was not distinguished" });
    }
    return { ok: failures.length === 0, count: physicsTable.integration.length + physicsTable.cooldowns.length, failures };
  }
};

/* ------------------------------------------------------------------ *
 * ledger - SHA-256 hash-chained event chain.
 *
 * Record payload is byte-compatible with the Doom web shell so chains
 * can be compared across hosts: {seq,type,tic,phase,value,previousHash}
 * ------------------------------------------------------------------ */
const ZERO_HASH = "0".repeat(64);

async function sha256Hex(text) {
  const digest = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ledgerPayload(record) {
  return JSON.stringify({
    seq: record.seq, type: record.type, tic: record.tic,
    phase: record.phase, value: record.value, previousHash: record.previousHash
  });
}

function createLedger(initial) {
  const records = Array.isArray(initial) ? initial.slice() : [];
  return {
    records,
    async append(event) {
      const previousHash = records.length ? records[records.length - 1].hash : ZERO_HASH;
      const record = {
        seq: records.length, type: event.type, tic: event.tic,
        phase: event.phase, value: event.value, previousHash
      };
      record.hash = await sha256Hex(ledgerPayload(record));
      records.push(record);
      return record;
    },
    async verify() {
      let previousHash = ZERO_HASH;
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.seq !== i || record.previousHash !== previousHash) return { ok: false, at: i };
        if (await sha256Hex(ledgerPayload(record)) !== record.hash) return { ok: false, at: i };
        previousHash = record.hash;
      }
      return { ok: true, count: records.length, tip: previousHash };
    },
    export(extra = {}) {
      return Object.assign({
        format: "zeq-ledger-v1",
        hash: "SHA-256",
        scope: "Integrity of this local event chain only; not proof of competitive legitimacy.",
        events: records
      }, extra);
    }
  };
}

const ledger = { create: createLedger, ZERO_HASH, payloadOf: ledgerPayload };

/* ------------------------------------------------------------------ *
 * bridge - JSON-RPC 2.0 sidecar link over WebSocket.
 *
 * A browser game cannot open raw TCP; Emscripten maps sockets to
 * WebSocket for the same reason, so this IS the portable transport.
 * A native build can speak the identical protocol through any
 * WebSocket-capable pipe. States: offline -> connecting -> online.
 * ------------------------------------------------------------------ */
function createBridge() {
  let socket = null;
  let state = "offline";
  let config = {
    url: "ws://127.0.0.1:7770/zeq",
    game: "unknown",
    client: `zeq-game-sdk/${SDK_VERSION}`,
    reconnect: true
  };
  let nextId = 1;
  let attempts = 0;
  let reconnectTimer = 0;
  let manualClose = false;
  const pending = new Map();          // id -> {resolve, reject, timer}
  const eventQueue = [];              // notifications waiting for a socket
  let droppedEvents = 0;
  const MAX_QUEUE = 4096;

  const bridge = {
    get state() { return state; },
    get dropped() { return droppedEvents; },
    session: null,
    onstate: null,

    configure(options = {}) {
      Object.assign(config, options);
      if (typeof options.onstate === "function") bridge.onstate = options.onstate;
      return bridge;
    },

    connect() {
      manualClose = false;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      setState("connecting");
      try { socket = new WebSocket(config.url); }
      catch (_) { setState("offline"); scheduleReconnect(); return; }

      socket.onopen = () => {
        attempts = 0;
        bridge.rpc("zeq.hello", { client: config.client, game: config.game, sdk: SDK_VERSION })
          .then((session) => { bridge.session = session; setState("online"); flush(); })
          .catch(() => { setState("online"); flush(); });
      };
      socket.onmessage = (message) => {
        let packet;
        try { packet = JSON.parse(message.data); } catch (_) { return; }
        if (packet.id === undefined || !pending.has(packet.id)) return;
        const slot = pending.get(packet.id);
        pending.delete(packet.id);
        clearTimeout(slot.timer);
        if (packet.error) slot.reject(new Error(packet.error.message || "kernel error"));
        else slot.resolve(packet.result);
      };
      socket.onclose = () => {
        socket = null;
        bridge.session = null;
        for (const [, slot] of pending) { clearTimeout(slot.timer); slot.reject(new Error("link closed")); }
        pending.clear();
        setState("offline");
        if (!manualClose && config.reconnect) scheduleReconnect();
      };
      socket.onerror = () => { /* onclose follows */ };
    },

    close() {
      manualClose = true;
      clearTimeout(reconnectTimer);
      if (socket) socket.close();
      setState("offline");
    },

    rpc(method, params, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error("sidecar offline")); return; }
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("kernel timeout")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },

    notify(method, params) {
      const line = JSON.stringify({ jsonrpc: "2.0", method, params });
      if (socket && socket.readyState === WebSocket.OPEN && state === "online") socket.send(line);
      else if (eventQueue.length < MAX_QUEUE) eventQueue.push(line);
      else droppedEvents++;
    },

    /* Telemetry verbs. Events are engine facts; never dropped silently
     * before the 4096-deep buffer fills. Snapshots are samples and may
     * be rate-limited by the caller. */
    event(record) { bridge.notify("zeq.event", record); },
    snapshot(fields) { bridge.notify("zeq.snapshot", fields); },
    verify() { return bridge.rpc("zeq.verify", {}); },
    exportRun(name) { return bridge.rpc("zeq.export", { name }); }
  };

  function flush() { while (eventQueue.length && socket && socket.readyState === WebSocket.OPEN) socket.send(eventQueue.shift()); }
  function scheduleReconnect() {
    if (manualClose || !config.reconnect || attempts >= 8) return;
    const wait = Math.min(15000, 1000 * 2 ** attempts++);
    reconnectTimer = setTimeout(() => bridge.connect(), wait);
  }
  function setState(next) {
    if (state === next) return;
    state = next;
    if (bridge.onstate) { try { bridge.onstate(state, bridge.session); } catch (_) {} }
  }

  return bridge;
}

const api = {
  version: SDK_VERSION,
  carrier: legacyCarrier,
  legacyCarrier,
  time,
  physics,
  ledger,
  bridge: createBridge(),
  createBridge
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqSDK = api;

})(typeof window !== "undefined" ? window : globalThis);
