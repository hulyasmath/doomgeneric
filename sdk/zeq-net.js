"use strict";

/*
 * Engine-neutral Phase 6 session contracts and deterministic transport
 * impairment scheduling. This module does not implement a game or a transport.
 * Real engines exchange their own authoritative commands and state hashes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZeqNet = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SESSION_FORMAT = "zeq-net-session-v1";
  const PROTOCOL = "zeq-doom-net-v1";
  const fields = [
    "format", "protocol", "engine_api", "engine_build", "wad_sha256",
    "content_sha256", "ruleset", "episode", "map", "skill",
    "settings_sha256", "tick_rate", "initial_rng", "session_id"
  ];

  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }

  function text(value, name, pattern, maximum = 128) {
    if (typeof value !== "string" || !value || value.length > maximum || (pattern && !pattern.test(value))) {
      throw new Error(`Invalid ${name}`);
    }
    return value;
  }

  function session(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Session descriptor must be an object");
    const output = {
      format: text(input.format, "format"),
      protocol: text(input.protocol, "protocol"),
      engine_api: text(input.engine_api, "engine_api"),
      engine_build: text(input.engine_build, "engine_build"),
      wad_sha256: text(input.wad_sha256, "wad_sha256", /^[0-9a-f]{64}$/, 64),
      content_sha256: text(input.content_sha256, "content_sha256", /^[0-9a-f]{64}$/, 64),
      ruleset: text(input.ruleset, "ruleset", /^[a-z0-9-]+$/),
      episode: text(input.episode, "episode", /^(0|[1-9][0-9]*)$/, 10),
      map: text(input.map, "map", /^(0|[1-9][0-9]*)$/, 10),
      skill: text(input.skill, "skill", /^(0|[1-9][0-9]*)$/, 10),
      settings_sha256: text(input.settings_sha256, "settings_sha256", /^[0-9a-f]{64}$/, 64),
      tick_rate: text(input.tick_rate, "tick_rate", /^(0|[1-9][0-9]*)$/, 10),
      initial_rng: text(input.initial_rng, "initial_rng", /^(0|[1-9][0-9]*)$/, 10),
      session_id: text(input.session_id, "session_id", /^[0-9a-f]{32}$/, 32)
    };
    if (output.format !== SESSION_FORMAT) throw new Error("Unsupported session format");
    if (output.protocol !== PROTOCOL) throw new Error("Unsupported network protocol");
    if (output.tick_rate === "0") throw new Error("tick_rate must be positive");
    return Object.freeze(output);
  }

  function descriptorBytes(input) {
    return new TextEncoder().encode(canonical(session(input)));
  }

  async function descriptorDigest(input) {
    const digest = await crypto.subtle.digest("SHA-256", descriptorBytes(input));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function integer(value, name, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
    return value;
  }

  // Integer hash used only to make test-link impairment reproducible. It is not
  // a security RNG, a game RNG, or a substitute for engine determinism.
  function scheduleImpairment(options) {
    const sequence = integer(options.sequence, "sequence", 0, 0x7fffffff);
    const sendTic = integer(options.sendTic, "sendTic", 0, 0x7fffffff);
    const delayTics = integer(options.delayTics || 0, "delayTics", 0, 10000);
    const jitterTics = integer(options.jitterTics || 0, "jitterTics", 0, 10000);
    const dropEvery = integer(options.dropEvery || 0, "dropEvery", 0, 1000000);
    const duplicateEvery = integer(options.duplicateEvery || 0, "duplicateEvery", 0, 1000000);
    const seed = integer(options.seed || 0, "seed", 0, 0xffffffff) >>> 0;
    if (dropEvery && sequence > 0 && sequence % dropEvery === 0) return Object.freeze([]);
    let mixed = (seed ^ Math.imul(sequence + 1, 0x9e3779b1)) >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
    mixed ^= mixed >>> 16;
    const jitter = jitterTics ? mixed % (2 * jitterTics + 1) - jitterTics : 0;
    const dueTic = Math.max(sendTic, sendTic + delayTics + jitter);
    const copies = duplicateEvery && sequence > 0 && sequence % duplicateEvery === 0 ? 2 : 1;
    return Object.freeze(Array.from({ length: copies }, () => dueTic));
  }

  return Object.freeze({
    SESSION_FORMAT, PROTOCOL, fields: Object.freeze(fields.slice()),
    canonical, session, descriptorBytes, descriptorDigest, scheduleImpairment
  });
});
