"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sdk = require("../zeq-game-sdk.js");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "../vectors/zeq-time-v1.json"), "utf8"));

function checkInstant(actual, expected) {
  assert.equal(actual.zeqond, String(expected.tick));
  assert.equal(actual.phase64, String(expected.phase64));
  for (const [actualKey, expectedKey] of [["sinQ30", "sin_q30"], ["cosQ30", "cos_q30"], ["carrierQ30", "carrier_q30"], ["lapse2Q30", "lapse2_q30"], ["lapseQ30", "lapse_q30"], ["dlnCycleQ40", "dln_cycle_q40"]]) {
    assert.equal(actual[actualKey], String(expected[expectedKey]));
  }
}

for (const vector of vectors.nanoseconds) checkInstant(sdk.time.fromNs(vector.ns), vector);
for (const vector of vectors.tics) checkInstant(sdk.time.fromTic(vector.gametic, vector.tick_rate), vector);
for (const vector of vectors.lapse) checkInstant(sdk.time.atPhase64(0, vector.phase64), { ...vector, tick: "0" });
assert.deepEqual(sdk.time.split64(1000000000000n), ["1287", vectors.nanoseconds.find((v) => v.ns === "1000000000000").phase64]);
assert.equal(sdk.time.roundDiv(1n, 2n), 0n);
assert.equal(sdk.time.roundDiv(3n, 2n), 2n);
assert.equal(sdk.time.roundDiv(-1n, 2n), 0n);
assert.equal(sdk.time.roundDiv(-3n, 2n), -2n);
assert.throws(() => sdk.time.fromTic(-1));
assert.throws(() => sdk.time.fromTic(0, 0));
assert.throws(() => sdk.time.roundDiv(1n, 0n));
assert.throws(() => sdk.time.fromNs(Number.MAX_SAFE_INTEGER + 1));
assert.equal(sdk.time.isqrt(0n), 0n);
assert.equal(sdk.time.isqrt(2n), 1n);
assert.equal(sdk.time.isqrt((1n << 64n) - 1n), 4294967295n);
assert.equal(sdk.time.selfTest().ok, true);
console.log(`JavaScript OK: ${vectors.nanoseconds.length} ns + ${vectors.tics.length} tic + ${vectors.lapse.length} lapse vectors; negative tests OK`);
