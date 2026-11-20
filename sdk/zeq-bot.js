"use strict";
// Engine-neutral deterministic outer scheduler. The host retains its own tick rate.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqBot = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FORMAT = "zeq-bot-schedule-v1";
  const BUTTON_ATTACK = 1;
  const BUTTON_USE = 2;
  const MAX_DECISIONS = 200000;
  function integer(value, name, minimum, maximum, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`invalid ${name}`);
    return value;
  }
  function due(hostTic, hostRate, botRate) {
    integer(hostTic, "host tic", 0, 2000000);
    return Math.floor((hostTic + 1) * botRate / hostRate);
  }
  class Scheduler {
    constructor(options = {}) {
      this.hostRate = integer(options.hostRate, "host rate", 1, 1000, 35);
      this.botRate = integer(options.botRate, "bot rate", 1, 1000, 20);
      this.seed = integer(options.seed, "seed", 0, 0xffffffff, 0x5eed1234) >>> 0;
      this.maxDecisions = integer(options.maxDecisions, "decision limit", 1, MAX_DECISIONS, MAX_DECISIONS);
      this.reset();
    }
    reset() {
      this.state = this.seed || 0x6d2b79f5;
      this.decisions = 0;
      this.paused = false;
      this.stopped = false;
      this.error = null;
      this.command = Object.freeze({ forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0, buttons2: 0, chatchar: 0, consistancy: 0, inventory: 0, lookfly: 0, arti: 0 });
    }
    random() {
      let value = this.state;
      value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
      this.state = value >>> 0;
      return this.state;
    }
    decide() {
      if (this.stopped || this.paused || this.error) return;
      if (this.decisions >= this.maxDecisions) {
        this.stopped = true;
        this.command = Object.freeze({ ...this.command, forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 });
        return;
      }
      const random = this.random();
      const phase = this.decisions % 16;
      const forwardmove = phase < 10 ? 25 : phase < 13 ? 0 : -18;
      const sidemove = phase === 12 ? 20 : phase === 13 ? -20 : 0;
      const angleturn = phase === 10 ? 420 : phase === 11 ? -420 : 0;
      const buttons = (phase % 4 === 0 ? BUTTON_ATTACK : 0) | (random % 23 === 0 ? BUTTON_USE : 0);
      this.command = Object.freeze({ ...this.command, forwardmove, sidemove, angleturn, buttons });
      this.decisions++;
    }
    setPaused(paused) {
      this.paused = paused === true;
      if (this.paused) this.command = Object.freeze({ ...this.command, forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 });
    }
    stop() {
      this.stopped = true;
      this.command = Object.freeze({ ...this.command, forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 });
    }
    commandsForTic(gametic) {
      integer(gametic, "gametic", 0, 1999999);
      const commands = [];
      const target = due(gametic, this.hostRate, this.botRate);
      if (this.paused || this.stopped || this.error) {
        if (this.paused && !this.stopped) this.decisions = Math.max(this.decisions, target);
        return commands;
      }
      while (this.decisions < target && !this.stopped && !this.error) {
        this.decide();
        if (!this.paused && !this.stopped && !this.error)
          commands.push({ ...this.command, scheduler_sequence: this.decisions - 1 });
      }
      return commands;
    }
    commandForTic(gametic) {
      this.commandsForTic(gametic);
      return this.paused || this.stopped ? { ...this.command, forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 } : { ...this.command };
    }
    snapshot() {
      return { format: FORMAT, host_rate: this.hostRate, bot_rate: this.botRate, seed: this.seed, rng_state: this.state, decisions: this.decisions, max_decisions: this.maxDecisions, paused: this.paused, stopped: this.stopped, error: this.error, command: { ...this.command } };
    }
  }
  return Object.freeze({ FORMAT, BUTTON_ATTACK, BUTTON_USE, MAX_DECISIONS, Scheduler, due });
});
