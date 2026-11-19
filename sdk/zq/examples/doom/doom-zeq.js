/*
 * Doom on Zeq: the reference host's own event stream driving state contracts.
 *
 * `hulyasmath/doomgeneric` already emits events from the real C engine as
 * {type, gametic, phase, value} (doomgeneric/zeq_doom.h). This bridge needs no
 * engine change: it turns those events into transitions of contracts that a
 * Zeq machine holds, decides and chains.
 *
 *   WEAPON_FIRED (9)      value = weapon id        weapon:  ready -> cooling
 *   COOLDOWN_STARTED (13) value = ready gametic    the tic from which the weapon may fire again.
 *                                                  The real engine emits it just before the WEAPON_FIRED
 *                                                  of the same tic, so it belongs to that shot and takes
 *                                                  effect after it; the other order is handled too.
 *   DAMAGE (5)            value = damage           player:  alive -> hurt, or -> dead
 *   DEATH (6)             value = map              player:  -> dead
 *   RULESET (14)          value = ruleset id       ruleset: which rules the match runs under, and every change of them
 *   LEVEL (4)             value = episode<<8|map   level:   a level may follow only the one before it; a warp is refused
 *   LOAD (8)                                       run:     clean -> resumed, for good: a run that loaded a save says so
 *
 * The mathematics a rule needs comes from the machine's generated functions
 * (Zeq.math), never from this file.
 *
 * Loads in Node (require) and in a browser (window.ZeqDoom): the `zeq` handle
 * comes from zeq.js or from zeq-browser.js, and the rules are the same.
 */
(function (global) {
"use strict";

const EVENT = Object.freeze({ PHASE_SHOT: 1, PHASE_HIT: 2, PHASE_KILL: 3, LEVEL: 4, DAMAGE: 5, DEATH: 6, SAVE: 7, LOAD: 8, WEAPON_FIRED: 9,
  PROJECTILE_IMPACT: 10, EXPLOSION: 11, IMPULSE_INTEGRATED: 12, COOLDOWN_STARTED: 13, RULESET: 14 });

/* The rules, in the framework's contract schema. Conditions use integers and no division, so every machine decides them alike. */
const WEAPON = Object.freeze({ name: "doom.weapon", version: "1",
  states: { ready: { initial: true }, cooling: {} },
  transitions: [
    { from: "ready", to: "cooling", operator: "weapon fired", condition: "input.weapon >= 0 && input.tic >= 0", proof_required: true },
    { from: "cooling", to: "ready", operator: "cooldown elapsed", condition: "input.tic >= input.ready_tic", proof_required: true },
  ] });
const PLAYER = Object.freeze({ name: "doom.player", version: "1",
  states: { alive: { initial: true }, hurt: {}, dead: { terminal: true } },
  transitions: [
    { from: "alive", to: "hurt", operator: "damage taken", condition: "input.damage > 0 && input.health > 0", proof_required: true },
    { from: "hurt", to: "alive", operator: "recovered", condition: "input.health >= 100" },
    { from: "alive", to: "dead", operator: "killed", condition: "input.health <= 0", proof_required: true },
    { from: "hurt", to: "dead", operator: "killed", condition: "input.health <= 0", proof_required: true },
  ] });

/*
 * Doom as a host description for zeq-host: which engine event moves which rule.
 * This is all a game writes. The queue, the machine calls and the record are zeq-host's.
 */
const tic = (e) => (e.gametic ?? e.tic);
function hostSpec({ health = 100 } = {}) {
  return {
    name: "doom",
    contracts: { weapon: WEAPON, player: PLAYER, ruleset: RULESET, level: LEVEL, run: RUN },
    memory: { readyTic: 0, health, lastFireTic: -1, pending: null, ruleset: -1, episode: 0, map: 0, loads: 0, saves: 0, phaseKills: 0 },
    kind: (e) => e.type,
    validate: (e) => (Number.isInteger(e.type) && Number.isInteger(tic(e)) && Number.isInteger(e.value) ? true : "a Doom event is {type, gametic, phase, value}, all integers"),
    on: {
      [EVENT.COOLDOWN_STARTED]: (e, h) => {
        if (tic(e) === h.memory.lastFireTic) h.memory.readyTic = e.value;      // announced after its shot
        else h.memory.pending = { tic: tic(e), value: e.value };               // announced before its shot (the real engine's order)
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
        m.health -= e.value;
        if (m.health <= 0) return h.fire("player", "dead", { health: m.health });
        return h.state("player") === "alive" ? h.fire("player", "hurt", { damage: e.value, health: m.health }) : null;
      },
      [EVENT.RULESET]: (e, h) => {
        const m = h.memory, to = e.value === 0 ? "vanilla" : "zeq";
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
      [EVENT.DEATH]: (e, h) => (h.state("player") === "dead" ? null : h.fire("player", "dead", { health: 0 })),
    },
  };
}

/* What a record of a match must be able to say about itself. */
const RULESET = Object.freeze({ name: "doom.ruleset", version: "1",
  states: { undeclared: { initial: true }, vanilla: {}, zeq: {} },
  transitions: [
    { from: "undeclared", to: "vanilla", operator: "ruleset declared", condition: "input.ruleset == 0", proof_required: true },
    { from: "undeclared", to: "zeq", operator: "ruleset declared", condition: "input.ruleset >= 1", proof_required: true },
    { from: "vanilla", to: "zeq", operator: "ruleset changed", condition: "input.ruleset >= 1", proof_required: true },
    { from: "zeq", to: "vanilla", operator: "ruleset changed", condition: "input.ruleset == 0", proof_required: true },
  ] });
const LEVEL = Object.freeze({ name: "doom.level", version: "1",
  states: { menu: { initial: true }, playing: {} },
  transitions: [
    { from: "menu", to: "playing", operator: "level entered", condition: "input.episode >= 1 && input.map >= 1", proof_required: true },
    /* the next map of the episode, a new game from map 1, or the way into and out of the secret map 9 */
    { from: "playing", to: "playing", operator: "next level", condition: "(input.episode == input.last_episode && input.map == input.last_map + 1) || input.map == 1 || input.map == 9 || input.last_map == 9", proof_required: true },
  ] });
const RUN = Object.freeze({ name: "doom.run", version: "1",
  states: { clean: { initial: true }, resumed: { terminal: true } },
  transitions: [{ from: "clean", to: "resumed", operator: "save loaded", condition: "input.loads >= 1", proof_required: true }] });

/* `zeq` is a handle from Zeq.local, Zeq.connect or ZeqBrowser.connect. */
async function createDoomBridge(zeq, options) {
  const ZeqHost = typeof module !== "undefined" && module.exports ? require("../../zeq-host.js") : global.ZeqHost;
  if (!ZeqHost) throw new Error("doom-zeq: load zeq-host.js first");
  const host = await ZeqHost.attach(zeq, hostSpec(options));
  /* Feed one engine event. Returns what the machine decided, or null when the event moves no contract. */
  const onEvent = (event) => host.send(event).catch((e) => { if (e.code === "bad-event") throw new TypeError(e.detail); throw e; });
  return Object.freeze({ host, weapon: host.contracts.weapon, player: host.contracts.player, ruleset: host.contracts.ruleset, level: host.contracts.level, run: host.contracts.run, onEvent, get health() { return host.memory.health; }, fired: () => host.decisions() });
}

const api = Object.freeze({ EVENT, WEAPON, PLAYER, RULESET, LEVEL, RUN, hostSpec, createDoomBridge });
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqDoom = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
