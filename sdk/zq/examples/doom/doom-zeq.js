/*
 * Doom on Zeq: the reference host's own event stream driving state contracts.
 *
 * `hulyasmath/doomgeneric` already emits events from the real C engine as
 * {type, gametic, phase, value} (doomgeneric/zeq_doom.h). This bridge needs no
 * engine change: it turns those events into transitions of contracts that a
 * Zeq machine holds, decides and chains.
 *
 *   WEAPON_FIRED (9)      value = weapon id        weapon:  ready -> cooling
 *   COOLDOWN_STARTED (13) value = ready gametic    remembered as the tic the weapon is ready
 *   DAMAGE (5)            value = damage           player:  alive -> hurt, or -> dead
 *   DEATH (6)             value = map              player:  -> dead
 *
 * The mathematics a rule needs comes from the machine's generated functions
 * (Zeq.math), never from this file.
 */
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

/* `zeq` is a handle from Zeq.local or Zeq.connect. */
async function createDoomBridge(zeq, { health = 100 } = {}) {
  const weapon = await zeq.contract(WEAPON), player = await zeq.contract(PLAYER);
  let readyTic = 0, hp = health;
  const fired = [];
  const note = (event, contract, r) => { const out = { contract, ...r }; fired.push({ tic: event.gametic ?? event.tic, type: event.type, ...out }); return out; };
  /* Feed one engine event. Returns what the machine decided, or null when the event moves no contract. */
  async function onEvent(event) {
    const tic = event.gametic ?? event.tic;
    if (!Number.isInteger(event.type) || !Number.isInteger(tic) || !Number.isInteger(event.value)) throw new TypeError("a Doom event is {type, gametic, phase, value}, all integers");
    switch (event.type) {
      case EVENT.COOLDOWN_STARTED: readyTic = event.value; return null;
      case EVENT.WEAPON_FIRED: {
        if (weapon.state === "cooling") { const back = note(event, "weapon", await weapon.fire("ready", { tic, ready_tic: readyTic })); if (!back.fired) return back; }
        return note(event, "weapon", await weapon.fire("cooling", { weapon: event.value, tic }));
      }
      case EVENT.DAMAGE: {
        if (player.state === "dead") return null;
        hp -= event.value;
        if (hp <= 0) return note(event, "player", await player.fire("dead", { health: hp }));
        return player.state === "alive" ? note(event, "player", await player.fire("hurt", { damage: event.value, health: hp })) : null;
      }
      case EVENT.DEATH: return player.state === "dead" ? null : note(event, "player", await player.fire("dead", { health: 0 }));
      default: return null;
    }
  }
  return Object.freeze({ weapon, player, onEvent, get health() { return hp; }, fired: () => fired.slice() });
}

module.exports = Object.freeze({ EVENT, WEAPON, PLAYER, createDoomBridge });
