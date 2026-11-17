/*
 * ZEQ GAME SDK / 0.1.0
 * Portable sidecar runtime for the 12-vector Zeq framework.
 *
 * Three independent modules, no dependencies:
 *   ZeqSDK.carrier  - exact integer carrier / Zeqond math (any tick rate)
 *   ZeqSDK.ledger   - SHA-256 hash-chained tamper-evident event chain
 *   ZeqSDK.bridge   - JSON-RPC 2.0 sidecar link over WebSocket
 *
 * The bridge is strictly optional: a game that never connects loses
 * nothing. Everything below works offline and locally first.
 */
(function (global) {
"use strict";

const ZEQ_CARRIER_NUM = 1287;   // carrier numerator: 1.287 Hz
const ZEQ_WINDOW_LO = 0.185;    // aligned window, normalized phase
const ZEQ_WINDOW_HI = 0.315;
const ZEQ_ZEQOND_NUM = 777;     // one Zeqond = 0.777 s
const SDK_VERSION = "0.1.0";

/* ------------------------------------------------------------------ *
 * carrier - exact integer timebase math.
 *
 * phase(tic, tickRate) advances 1287/1000 of a cycle per second for
 * ANY tick rate, so the carrier is exactly 1.287 Hz whether the host
 * simulates at 35 Hz (Doom), 60 Hz, or anything else.
 * ------------------------------------------------------------------ */
const carrier = {
  period(tickRate) { return tickRate * 1000; },
  phase(gametic, tickRate = 35) {
    const period = carrier.period(tickRate);
    return Number((BigInt(gametic) * BigInt(ZEQ_CARRIER_NUM)) % BigInt(period));
  },
  window(tickRate = 35) {
    const period = carrier.period(tickRate);
    return [Math.round(ZEQ_WINDOW_LO * period), Math.round(ZEQ_WINDOW_HI * period)];
  },
  aligned(gametic, tickRate = 35) {
    const phase = carrier.phase(gametic, tickRate);
    const [lo, hi] = carrier.window(tickRate);
    return phase >= lo && phase <= hi;
  },
  /* Display-grade pulse R(t) in permille (1000 = unity). The engine
   * computes its own fixed-point equivalent from the same integer
   * phase; this is for HUDs and telemetry only. */
  pulsePermille(gametic, tickRate = 35) {
    const phase = carrier.phase(gametic, tickRate);
    const angle = (2 * Math.PI * phase) / carrier.period(tickRate);
    return Math.round(1000 + 24 * Math.sin(angle));
  },
  /* Chrono-tactical Zeqond clock: one Zeqond every 0.777 s. */
  zeqond(gametic, tickRate = 35) {
    return Number((BigInt(gametic) * BigInt(ZEQ_ZEQOND_NUM)) / BigInt(tickRate * 1000));
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
  carrier,
  ledger,
  bridge: createBridge(),
  createBridge
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqSDK = api;

})(typeof window !== "undefined" ? window : globalThis);
