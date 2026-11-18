"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sdk = require("../zeq-game-sdk.js");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "../vectors/zeq-physics-v1.json"), "utf8"));

for (const vector of vectors.integration) {
  const actual = sdk.physics.integrateTic(vector.gametic, vector.initial_velocity, {
    acceleration: vector.acceleration,
    impulse: vector.impulse,
    substeps: vector.substeps,
    alphaNum: vector.alpha_num,
    tickRate: vector.tick_rate
  });
  for (const [actualKey, expectedKey] of [["gametic", "gametic"], ["tickRate", "tick_rate"], ["alphaNum", "alpha_num"], ["initialVelocity", "initial_velocity"], ["acceleration", "acceleration"], ["impulse", "impulse"], ["substeps", "substeps"], ["positionDelta", "position_delta"], ["velocity", "velocity"], ["deltaVelocity", "delta_velocity"], ["positionResidual", "position_residual"], ["appliedForce", "applied_force"], ["appliedDrag", "applied_drag"], ["startPhase64", "start_phase64"], ["endPhase64", "end_phase64"]]) {
    assert.equal(actual[actualKey], String(vector[expectedKey]), `${actualKey}: ${JSON.stringify(vector)}`);
  }
}
for (const vector of vectors.cooldowns) {
  assert.equal(sdk.physics.cooldownReadyTic(vector.start_tic, vector.duration_num, vector.duration_den, vector.tick_rate), String(vector.ready_tic));
}
const stationary = sdk.physics.integrateTic(999, 0);
assert.equal(stationary.positionDelta, "0");
assert.equal(stationary.velocity, "0");
assert.equal(stationary.deltaVelocity, "0");
assert.equal(stationary.startPhase64, sdk.time.fromTic(999).phase64);
assert.notEqual(stationary.startPhase64, sdk.time.fromTic(999, 70).phase64, "half-tic phase must differ");
assert.throws(() => sdk.physics.integrateTic(-1, 0));
assert.throws(() => sdk.physics.integrateTic(0, 0, { tickRate: 0 }));
assert.throws(() => sdk.physics.integrateTic(0, 0, { substeps: 0 }));
assert.throws(() => sdk.physics.integrateTic(0, 0, { alphaNum: 1 }));
assert.throws(() => sdk.physics.cooldownReadyTic(-1, 1, 1));
assert.throws(() => sdk.physics.cooldownReadyTic(0, 0, 1));
assert.throws(() => sdk.physics.cooldownReadyTic(0, 1, 0));
assert.equal(sdk.physics.selfTest().ok, true, JSON.stringify(sdk.physics.selfTest().failures));
console.log(`JavaScript OK: ${vectors.integration.length} integration + ${vectors.cooldowns.length} cooldown vectors; half-tic, zero-force, R-stamp rejection, and negative tests OK`);
