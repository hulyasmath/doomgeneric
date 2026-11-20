/*
 * Doom host description for zeq-host-v1, derived from PR #3.
 * It translates real doomgeneric events into contract decisions. It neither
 * enforces those decisions in Doom nor proves that event readings are truthful.
 */
(function (global) {
"use strict";

const EVENT = Object.freeze({ PHASE_SHOT: 1, PHASE_HIT: 2, PHASE_KILL: 3, LEVEL: 4, DAMAGE: 5, DEATH: 6, SAVE: 7, LOAD: 8, WEAPON_FIRED: 9,
  PROJECTILE_IMPACT: 10, EXPLOSION: 11, IMPULSE_INTEGRATED: 12, COOLDOWN_STARTED: 13, RULESET: 14 });
const RULESET_IDS = Object.freeze({ 0: "vanilla", 1: "physics", 2: "arcade" });

const WEAPON = Object.freeze({ name: "doom.weapon", version: "1",
  states: { ready: { initial: true }, cooling: {} },
  transitions: [
    { from: "ready", to: "cooling", operator: "weapon fired", condition: "input.weapon >= 0 && input.tic >= 0", proof_required: true },
    { from: "cooling", to: "ready", operator: "cooldown elapsed", condition: "input.tic >= input.ready_tic", proof_required: true },
  ] });
const PLAYER = Object.freeze({ name: "doom.player", version: "1",
  states: { alive: { initial: true }, hurt: {}, dead: { terminal: true } },
  transitions: [
    { from: "alive", to: "hurt", operator: "damage taken", condition: "input.damage > 0 && input.health_estimate > 0", proof_required: true },
    { from: "alive", to: "dead", operator: "killed", condition: "input.health_estimate <= 0", proof_required: true },
    { from: "hurt", to: "dead", operator: "killed", condition: "input.health_estimate <= 0", proof_required: true },
  ] });
const RULESET = Object.freeze({ name: "doom.ruleset", version: "1",
  states: { undeclared: { initial: true }, vanilla: {}, physics: {}, arcade: {} },
  transitions: [
    { from: "undeclared", to: "vanilla", operator: "ruleset declared", condition: "input.ruleset == 0", proof_required: true },
    { from: "undeclared", to: "physics", operator: "ruleset declared", condition: "input.ruleset == 1", proof_required: true },
    { from: "undeclared", to: "arcade", operator: "ruleset declared", condition: "input.ruleset == 2", proof_required: true },
    { from: "vanilla", to: "physics", operator: "ruleset changed", condition: "input.ruleset == 1", proof_required: true },
    { from: "vanilla", to: "arcade", operator: "ruleset changed", condition: "input.ruleset == 2", proof_required: true },
    { from: "physics", to: "vanilla", operator: "ruleset changed", condition: "input.ruleset == 0", proof_required: true },
    { from: "physics", to: "arcade", operator: "ruleset changed", condition: "input.ruleset == 2", proof_required: true },
    { from: "arcade", to: "vanilla", operator: "ruleset changed", condition: "input.ruleset == 0", proof_required: true },
    { from: "arcade", to: "physics", operator: "ruleset changed", condition: "input.ruleset == 1", proof_required: true },
  ] });
const LEVEL = Object.freeze({ name: "doom.level", version: "1",
  states: { menu: { initial: true }, playing: {} },
  transitions: [
    { from: "menu", to: "playing", operator: "level entered", condition: "input.episode >= 1 && input.map >= 1", proof_required: true },
    /* Narrow shareware profile: next map, a new game at map 1, or secret-map entry/exit. */
    { from: "playing", to: "playing", operator: "next level", condition: "(input.episode == input.last_episode && input.map == input.last_map + 1) || input.map == 1 || input.map == 9 || input.last_map == 9", proof_required: true },
  ] });
const RUN = Object.freeze({ name: "doom.run", version: "1",
  states: { clean: { initial: true }, resumed: { terminal: true } },
  transitions: [{ from: "clean", to: "resumed", operator: "save loaded", condition: "input.loads >= 1", proof_required: true }] });

const tic = (e) => (e.gametic ?? e.tic);
function hostSpec({ health = 100 } = {}) {
  return {
    name: "doom",
    contracts: { weapon: WEAPON, player: PLAYER, ruleset: RULESET, level: LEVEL, run: RUN },
    memory: { readyTic: 0, healthEstimate: health, lastFireTic: -1, pending: null, ruleset: -1, episode: 0, map: 0, loads: 0, saves: 0, phaseKills: 0 },
    kind: (e) => e.type,
    validate: (e) => (Number.isInteger(e.type) && Number.isInteger(tic(e)) && Number.isInteger(e.value) ? true : "a Doom event is {type, gametic, phase, value}, all integers"),
    on: {
      [EVENT.COOLDOWN_STARTED]: (e, h) => {
        if (tic(e) === h.memory.lastFireTic) h.memory.readyTic = e.value;
        else h.memory.pending = { tic: tic(e), value: e.value };
      },
      [EVENT.WEAPON_FIRED]: async (e, h) => {
        const m = h.memory, t = tic(e);
        if (h.state("weapon") === "cooling") { const back = await h.fire("weapon", "ready", { tic: t, ready_tic: m.readyTic }); if (!back.fired) return back; }
        const shot = await h.fire("weapon", "cooling", { weapon: e.value, tic: t });
        if (shot.fired) { m.lastFireTic = t; if (m.pending && m.pending.tic === t) m.readyTic = m.pending.value; }
        m.pending = null;
        return shot;
      },
      [EVENT.DAMAGE]: async (e, h) => {
        const m = h.memory;
        if (h.state("player") === "dead") return null;
        m.healthEstimate -= e.value;
        if (m.healthEstimate <= 0) return h.fire("player", "dead", { health_estimate: m.healthEstimate });
        return h.state("player") === "alive" ? h.fire("player", "hurt", { damage: e.value, health_estimate: m.healthEstimate }) : null;
      },
      [EVENT.RULESET]: (e, h) => {
        const to = RULESET_IDS[e.value];
        if (!to) throw new RangeError(`unknown Doom ruleset id ${e.value}`);
        const m = h.memory;
        if (m.ruleset === e.value || h.state("ruleset") === to) { m.ruleset = e.value; return null; }
        m.ruleset = e.value;
        return h.fire("ruleset", to, { ruleset: e.value });
      },
      [EVENT.LEVEL]: async (e, h) => {
        const m = h.memory, episode = e.value >> 8, map = e.value & 255;
        const r = await h.fire("level", "playing", { episode, map, last_episode: m.episode, last_map: m.map });
        if (r.fired) { m.episode = episode; m.map = map; }
        return r;
      },
      [EVENT.SAVE]: (e, h) => { h.memory.saves += 1; },
      [EVENT.LOAD]: (e, h) => { h.memory.loads += 1; return h.state("run") === "clean" ? h.fire("run", "resumed", { loads: h.memory.loads }) : null; },
      [EVENT.PHASE_KILL]: (e, h) => { h.memory.phaseKills = e.value; },
      [EVENT.DEATH]: (e, h) => {
        if (h.state("player") === "dead") return null;
        h.memory.healthEstimate = 0;
        return h.fire("player", "dead", { health_estimate: 0 });
      },
    },
  };
}

async function createDoomBridge(zeq, options) {
  const ZeqHost = typeof module !== "undefined" && module.exports ? require("../../zeq-host.js") : global.ZeqHost;
  if (!ZeqHost) throw new Error("doom-zeq: load zeq-host.js first");
  const host = await ZeqHost.attach(zeq, hostSpec(options));
  const onEvent = (event) => host.send(event).catch((e) => { if (e.code === "bad-event") throw new TypeError(e.detail); throw e; });
  return Object.freeze({ host, weapon: host.contracts.weapon, player: host.contracts.player, ruleset: host.contracts.ruleset, level: host.contracts.level, run: host.contracts.run, onEvent,
    get healthEstimate() { return host.memory.healthEstimate; }, fired: () => host.decisions() });
}

const api = Object.freeze({ EVENT, RULESET_IDS, WEAPON, PLAYER, RULESET, LEVEL, RUN, hostSpec, createDoomBridge });
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqDoom = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
