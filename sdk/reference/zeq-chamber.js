/* zeq-chamber-v1: a non-Doom, exact-integer reference simulation.
 * Authoritative state is Q10 position/velocity in a bounded two-dimensional
 * chamber. Commands are the only external input; there is no renderer, wall
 * clock, floating point, random host API, or Doom dependency.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqChamber = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const FORMAT = "zeq-chamber-v1";
  const COMMAND_FORMAT = "zeq-chamber-command-v1";
  const SCALE = 1024, LIMIT = 1048576, MAX_SPEED = 65536;
  const MAX_PARTICLES = 16, MAX_TICS = 2000000;
  function integer(value, name, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`invalid ${name}`);
    return value;
  }
  function random(state) {
    let x = state >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return x >>> 0;
  }
  function clamp(value, min, max) { return value < min ? min : value > max ? max : value; }
  function reflect(position) {
    let result = position, bounces = 0;
    while (result < -LIMIT || result > LIMIT) {
      if (result > LIMIT) result = 2 * LIMIT - result;
      else result = -2 * LIMIT - result;
      if (++bounces > 8) throw new RangeError("chamber reflection budget exceeded");
    }
    return result;
  }
  function bytesHex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
  class Chamber {
    constructor(options = {}) {
      this.seed = integer(options.seed ?? 0x5eed1234, "seed", 0, 0xffffffff) >>> 0;
      this.count = integer(options.particles ?? 4, "particle count", 1, MAX_PARTICLES);
      this.tic = 0; this.rng = this.seed || 0x6d2b79f5;
      this.particles = [];
      for (let i = 0; i < this.count; i++) {
        this.rng = random(this.rng); const x = (this.rng % (LIMIT + 1)) - LIMIT / 2;
        this.rng = random(this.rng); const y = (this.rng % (LIMIT + 1)) - LIMIT / 2;
        this.rng = random(this.rng); const vx = (this.rng & 511) - 256;
        this.rng = random(this.rng); const vy = (this.rng & 511) - 256;
        this.particles.push(Object.freeze({ x, y, vx, vy }));
      }
      Object.freeze(this.particles);
    }
    step(command = {}) {
      integer(this.tic + 1, "tic", 1, MAX_TICS);
      const ax = integer(command.ax ?? 0, "x acceleration", -127, 127);
      const ay = integer(command.ay ?? 0, "y acceleration", -127, 127);
      const next = this.particles.map(particle => {
        const vx = clamp(particle.vx + ax, -MAX_SPEED, MAX_SPEED);
        const vy = clamp(particle.vy + ay, -MAX_SPEED, MAX_SPEED);
        return Object.freeze({ x: reflect(particle.x + vx), y: reflect(particle.y + vy), vx, vy });
      });
      this.particles = Object.freeze(next); this.tic++;
      return this.state();
    }
    state() {
      return { format: FORMAT, tic: this.tic, seed: this.seed, rng: this.rng,
        particles: this.particles.map(particle => ({ ...particle })) };
    }
    stateBytes() {
      const bytes = new Uint8Array(24 + this.count * 16);
      bytes.set(new TextEncoder().encode("ZEQCHM1\0"));
      const view = new DataView(bytes.buffer);
      view.setUint32(8, this.tic, true); view.setUint16(12, this.count, true);
      view.setUint32(16, this.seed, true); view.setUint32(20, this.rng, true);
      this.particles.forEach((particle, index) => {
        const offset = 24 + index * 16;
        for (const [field, shift] of [["x", 0], ["y", 4], ["vx", 8], ["vy", 12]])
          view.setInt32(offset + shift, particle[field], true);
      });
      return bytes;
    }
    stateHex() { return bytesHex(this.stateBytes()); }
  }
  function replay(commands, options = {}) {
    if (!Array.isArray(commands) || commands.length > MAX_TICS) throw new RangeError("invalid chamber replay length");
    const chamber = new Chamber(options);
    const checkpoints = [];
    const interval = integer(options.checkpointInterval ?? 35, "checkpoint interval", 1, MAX_TICS);
    for (const command of commands) {
      chamber.step(command);
      if (chamber.tic % interval === 0 || chamber.tic === commands.length)
        checkpoints.push({ tic: chamber.tic, state_hex: chamber.stateHex() });
    }
    return { format: FORMAT, command_format: COMMAND_FORMAT, state: chamber.state(),
      state_hex: chamber.stateHex(), checkpoints };
  }
  function validateDomainPack(pack) {
    const object = value => !!value && typeof value === "object" && !Array.isArray(value);
    const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
    if (!object(pack) || pack.format !== "zeq-domain-pack-v1" || !id(pack.id) || !id(pack.version)
      || pack.simulation !== FORMAT || !object(pack.provenance) || pack.provenance.kind !== "constructed-conformance"
      || typeof pack.provenance.description !== "string" || pack.provenance.description.length > 2048
      || !object(pack.constants) || pack.constants.scale !== SCALE || pack.constants.position_limit !== LIMIT
      || pack.constants.speed_limit !== MAX_SPEED || pack.constants.max_particles !== MAX_PARTICLES
      || pack.constants.max_tics !== MAX_TICS || pack.constants.host_rate !== 35
      || !object(pack.units) || pack.units.position !== "Q10-length" || pack.units.velocity !== "Q10-length/host-tic"
      || !object(pack.limits) || pack.limits.max_command_absolute !== 127
      || !Array.isArray(pack.evidence) || pack.evidence.length < 1 || pack.evidence.length > 64
      || pack.evidence.some(item => typeof item !== "string" || !item.length || item.length > 256))
      return { ok: false, why: "invalid or incompatible chamber domain pack" };
    return { ok: true, format: pack.format, id: pack.id, version: pack.version,
      physicalAccuracyClaim: false, provenance: "constructed-conformance" };
  }
  return Object.freeze({ FORMAT, COMMAND_FORMAT, SCALE, LIMIT, MAX_SPEED, MAX_PARTICLES,
    MAX_TICS, Chamber, replay, bytesHex, validateDomainPack });
});
