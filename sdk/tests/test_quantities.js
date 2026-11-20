"use strict";
const assert = require("node:assert/strict");
const Q = require("../zeq-quantities.js");
const q = (value, unit, uncertainty) => Q.fromUnit(Q.rational(...value), unit, uncertainty ? Q.rational(...uncertainty) : null);
const plain = result => ({ value: [result.value.n.toString(), result.value.d.toString()], dimensions: result.dimensions, uncertainty: result.uncertainty ? [result.uncertainty.n.toString(), result.uncertainty.d.toString()] : null });
const distance = Q.evaluateEquation("uniform_distance", { velocity: q([5, 1], "mps"), time: q([3, 1], "s") });
assert.deepEqual(plain(distance.value).value, ["15", "1"]);
assert.equal(distance.value.dimensions.length, 1);
const zeqonds = Q.convert(q([3, 1], "zeqond"), "ns");
assert.deepEqual(plain(zeqonds).value, ["2331002331", "1"]);
const measured = Q.evaluate("distance / time", { distance: q([10, 1], "m", [1, 10]), time: q([2, 1], "s", [1, 100]) });
assert.equal(measured.value.n, 5n);
assert.ok(measured.uncertainty.n > 0n);
const interval = Q.interval(measured);
assert.ok(Q.compare(interval.low, Q.rational(0)) > 0);
const uncertain = Q.quantity(Q.rational(1), {}, Q.rational(2));
const productInterval = Q.interval(Q.binaryQuantity(uncertain, uncertain, "*"));
assert.ok(Q.compare(productInterval.low, Q.rational(-3)) <= 0 && Q.compare(productInterval.high, Q.rational(9)) >= 0);
const squaredInterval = Q.interval(Q.evaluate("measurement^2", { measurement: uncertain }));
assert.ok(Q.compare(squaredInterval.low, Q.rational(0)) <= 0 && Q.compare(squaredInterval.high, Q.rational(9)) >= 0);
assert.throws(() => Q.evaluate("measurement^-1", { measurement: uncertain }), /contains zero/);
assert.equal(Q.evaluate("2 * kg * (3 * mps)^2 / 2").value.n, 9n);
assert.throws(() => Q.evaluate("1 * m + 1 * s"), /dimensions/);
assert.throws(() => Q.convert(q([1], "m"), "s"), /dimensions/);
assert.throws(() => Q.evaluate("unknown(1)"), /not allowed/);
assert.throws(() => Q.evaluate("constructor"), /unknown name/);
assert.throws(() => Q.evaluate("1 +"), /operand/);
assert.throws(() => Q.evaluate("1 / (2 * s - 2 * s)"), /zero/);
assert.throws(() => Q.evaluate("2^65"), /exponent/);
assert.throws(() => Q.evaluate("1".repeat(4097)), /length/);
assert.throws(() => Q.evaluateEquation("uniform_distance", { velocity: q([1], "mps"), time: q([1], "s"), extra: q([1], "m") }), /unexpected/);
const vectors = [
  { expression: "1 * km + 25 * cm", expected: ["4001", "4"], dimensionless: false },
  { expression: "f0 * tau", expected: ["1", "1"], dimensionless: true },
  { expression: "1000 * ms / (1 * s)", expected: ["1", "1"], dimensionless: true }
];
for (const vector of vectors) {
  const result = Q.evaluate(vector.expression);
  assert.deepEqual(plain(result).value, vector.expected);
  assert.equal(Object.values(result.dimensions).every(value => value === 0), vector.dimensionless);
}
console.log(JSON.stringify({ ok: true, format: Q.FORMAT, exactRational: true, dimensionalChecks: true, uncertaintyInterval: true, intervalContainment: true, registeredEquations: Q.equations.size, units: Q.units.size, hostileExpressionsRefused: 9, sharedVectors: vectors.length }, null, 2));
