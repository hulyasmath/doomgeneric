"use strict";
// Bounded exact rational quantities, units, expressions, and registered equations.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqQuantities = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FORMAT = "zeq-quantity-v1";
  const DIMENSION_NAMES = Object.freeze(["time", "length", "mass", "current", "temperature", "amount", "luminous"]);
  const LIMIT = 9223372036854775807n;
  const gcd = (a, b) => { if (a < 0n) a = -a; while (b) { const r = a % b; a = b; b = r; } return a || 1n; };
  function integer(value, name, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
    return value;
  }
  function rational(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (!d) throw new RangeError("zero rational denominator");
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcd(n, d);
    n /= divisor; d /= divisor;
    if (n > LIMIT || n < -LIMIT || d > LIMIT) throw new RangeError("rational magnitude limit");
    return Object.freeze({ n, d });
  }
  const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => add(a, scale(b, -1n));
  const mul = (a, b) => rational(a.n * b.n, a.d * b.d);
  const div = (a, b) => { if (!b.n) throw new RangeError("division by zero"); return rational(a.n * b.d, a.d * b.n); };
  const scale = (a, value) => rational(a.n * BigInt(value), a.d);
  const compare = (a, b) => { const v = a.n * b.d - b.n * a.d; return v < 0n ? -1 : v > 0n ? 1 : 0; };
  const absolute = a => a.n < 0n ? scale(a, -1n) : a;
  function symmetricUncertainty(nominal, low, high) {
    const below = absolute(sub(nominal, low)), above = absolute(sub(high, nominal));
    return compare(below, above) >= 0 ? below : above;
  }
  const pow = (a, exponent) => {
    integer(exponent, "exponent", -64, 64);
    if (!a.n && exponent <= 0) throw new RangeError("undefined zero power");
    if (exponent < 0) return pow(rational(a.d, a.n), -exponent);
    return rational(a.n ** BigInt(exponent), a.d ** BigInt(exponent));
  };
  function dimensions(value = {}) {
    const result = {};
    for (const name of DIMENSION_NAMES) result[name] = integer(value[name] || 0, `dimension ${name}`, -16, 16);
    return Object.freeze(result);
  }
  function dimensionsCombine(a, b, sign = 1) {
    const result = {};
    for (const name of DIMENSION_NAMES) result[name] = a[name] + sign * b[name];
    return dimensions(result);
  }
  const dimensionless = () => dimensions();
  const sameDimensions = (a, b) => DIMENSION_NAMES.every(name => a[name] === b[name]);
  function quantity(value, unitDimensions = {}, uncertainty = null) {
    const q = { format: FORMAT, value: typeof value.n === "bigint" ? value : rational(value), dimensions: dimensions(unitDimensions) };
    if (uncertainty !== null) {
      const u = typeof uncertainty.n === "bigint" ? uncertainty : rational(uncertainty);
      if (u.n < 0n) throw new RangeError("negative uncertainty");
      q.uncertainty = u;
    }
    return Object.freeze(q);
  }
  function checkQuantity(q) {
    if (!q || q.format !== FORMAT || !q.value || !q.dimensions) throw new TypeError("invalid quantity");
    return q;
  }
  function binaryQuantity(a, b, operation) {
    checkQuantity(a); checkQuantity(b);
    const dimensionCheck = operation === "+" || operation === "-";
    if (dimensionCheck && !sameDimensions(a.dimensions, b.dimensions)) throw new TypeError("incompatible dimensions");
    const value = operation === "+" ? add(a.value, b.value) : operation === "-" ? sub(a.value, b.value) : operation === "*" ? mul(a.value, b.value) : div(a.value, b.value);
    const dims = dimensionCheck ? a.dimensions : dimensionsCombine(a.dimensions, b.dimensions, operation === "/" ? -1 : 1);
    let uncertainty;
    if (a.uncertainty || b.uncertainty) {
      if (operation === "+" || operation === "-") uncertainty = add(a.uncertainty || rational(0), b.uncertainty || rational(0));
      else {
        const intervalA = interval(a), intervalB = interval(b);
        if (operation === "/" && compare(intervalB.low, rational(0)) <= 0 && compare(intervalB.high, rational(0)) >= 0)
          throw new RangeError("divisor interval contains zero");
        const corners = [intervalA.low, intervalA.high].flatMap(x => [intervalB.low, intervalB.high].map(y => operation === "*" ? mul(x, y) : div(x, y)));
        const low = corners.reduce((x, y) => compare(x, y) < 0 ? x : y);
        const high = corners.reduce((x, y) => compare(x, y) > 0 ? x : y);
        uncertainty = symmetricUncertainty(value, low, high);
      }
    }
    return quantity(value, dims, uncertainty);
  }
  function interval(q) {
    checkQuantity(q);
    const u = q.uncertainty || rational(0);
    return Object.freeze({ low: sub(q.value, u), high: add(q.value, u), dimensions: q.dimensions });
  }
  const unit = (factor, dims, aliases = []) => Object.freeze({ factor: rational(factor.n, factor.d), dimensions: dimensions(dims), aliases: Object.freeze(aliases) });
  const units = new Map();
  function registerUnit(name, factor, dims, aliases = []) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new TypeError("invalid unit name");
    const value = unit(factor, dims, aliases);
    units.set(name, value);
    for (const alias of aliases) units.set(alias, value);
  }
  registerUnit("s", rational(1), { time: 1 }, ["second", "seconds"]);
  registerUnit("ms", rational(1, 1000), { time: 1 });
  registerUnit("us", rational(1, 1000000), { time: 1 });
  registerUnit("ns", rational(1, 1000000000), { time: 1 });
  registerUnit("zeqond", rational(777000777, 1000000000), { time: 1 }, ["Zeqond"]);
  registerUnit("m", rational(1), { length: 1 }, ["meter", "metre"]);
  registerUnit("km", rational(1000), { length: 1 });
  registerUnit("cm", rational(1, 100), { length: 1 });
  registerUnit("mm", rational(1, 1000), { length: 1 });
  registerUnit("kg", rational(1), { mass: 1 });
  registerUnit("g", rational(1, 1000), { mass: 1 });
  registerUnit("A", rational(1), { current: 1 });
  registerUnit("K", rational(1), { temperature: 1 });
  registerUnit("mol", rational(1), { amount: 1 });
  registerUnit("cd", rational(1), { luminous: 1 });
  registerUnit("Hz", rational(1), { time: -1 });
  registerUnit("N", rational(1), { mass: 1, length: 1, time: -2 });
  registerUnit("J", rational(1), { mass: 1, length: 2, time: -2 });
  registerUnit("W", rational(1), { mass: 1, length: 2, time: -3 });
  registerUnit("mps", rational(1), { length: 1, time: -1 });
  function getUnit(name) { const result = units.get(name); if (!result) throw new TypeError("unknown unit"); return result; }
  function fromUnit(value, name, uncertainty = null) {
    const target = getUnit(name);
    return quantity(mul(typeof value.n === "bigint" ? value : rational(value), target.factor), target.dimensions,
      uncertainty === null ? null : mul(typeof uncertainty.n === "bigint" ? uncertainty : rational(uncertainty), target.factor));
  }
  function convert(q, name) {
    checkQuantity(q); const target = getUnit(name);
    if (!sameDimensions(q.dimensions, target.dimensions)) throw new TypeError("unit dimensions differ");
    const value = div(q.value, target.factor);
    const result = quantity(value, target.dimensions, q.uncertainty ? div(q.uncertainty, target.factor) : null);
    return { ...result, unit: name };
  }
  const constants = new Map();
  function registerConstant(name, q, source, version = "1") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof source !== "string" || !source || !/^\d+$/.test(version)) throw new TypeError("invalid constant identity");
    constants.set(name, Object.freeze({ quantity: checkQuantity(q), source, version }));
  }
  registerConstant("tau", fromUnit(rational(777000777, 1000000000), "s"), "Zeq exact-time contract");
  registerConstant("f0", fromUnit(rational(1000000000, 777000777), "Hz"), "Zeq exact-time contract");
  registerConstant("alpha", quantity(rational(129, 100000)), "Zeq physics contract");
  function tokenize(expression) {
    if (typeof expression !== "string" || !expression.length || expression.length > 4096) throw new TypeError("invalid expression length");
    const tokens = [];
    const pattern = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()+*^\/-]|,))/gy;
    let offset = 0;
    while (offset < expression.length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(expression);
      if (!match || match.index !== offset) throw new SyntaxError(`invalid expression at ${offset}`);
      tokens.push({ kind: match[1] ? "number" : match[2] ? "name" : "operator", text: match[1] || match[2] || match[3] });
      if (tokens.length > 512) throw new RangeError("expression token limit");
      offset = pattern.lastIndex;
    }
    return tokens;
  }
  function decimal(text) {
    const [whole, fraction = ""] = text.split(".");
    return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  }
  function evaluate(expression, environment = {}) {
    const tokens = tokenize(expression);
    let cursor = 0;
    const peek = text => tokens[cursor]?.text === text;
    const take = text => { if (!peek(text)) throw new SyntaxError(`expected ${text}`); cursor++; };
    function primary(depth) {
      if (depth > 32) throw new RangeError("expression depth limit");
      const token = tokens[cursor++];
      if (!token) throw new SyntaxError("missing operand");
      if (token.text === "(") { const value = additive(depth + 1); take(")"); return value; }
      if (token.text === "-") return scaleQuantity(primary(depth + 1), -1n);
      if (token.text === "+") return primary(depth + 1);
      if (token.kind === "number") return quantity(decimal(token.text));
      if (token.kind === "name") {
        if (peek("(")) throw new TypeError("function calls are not allowed in expressions");
        if (Object.hasOwn(environment, token.text)) return checkQuantity(environment[token.text]);
        const constant = constants.get(token.text);
        if (constant) return constant.quantity;
        const namedUnit = units.get(token.text);
        if (namedUnit) return quantity(namedUnit.factor, namedUnit.dimensions);
        throw new ReferenceError(`unknown name ${token.text}`);
      }
      throw new SyntaxError("expected operand");
    }
    function power(depth) {
      const left = primary(depth);
      if (peek("^")) { cursor++; const exponent = primary(depth + 1); if (!sameDimensions(exponent.dimensions, dimensionless()) || exponent.value.d !== 1n) throw new TypeError("power requires an integer dimensionless exponent"); return powerQuantity(left, Number(exponent.value.n)); }
      return left;
    }
    function multiplicative(depth) {
      let value = power(depth);
      while (peek("*") || peek("/")) { const operation = tokens[cursor++].text; value = binaryQuantity(value, power(depth), operation); }
      return value;
    }
    function additive(depth) {
      let value = multiplicative(depth);
      while (peek("+") || peek("-")) { const operation = tokens[cursor++].text; value = binaryQuantity(value, multiplicative(depth), operation); }
      return value;
    }
    const result = additive(0);
    if (cursor !== tokens.length) throw new SyntaxError("trailing expression tokens");
    return result;
  }
  function scaleQuantity(q, scalar) { return quantity(scale(q.value, scalar), q.dimensions, q.uncertainty ? scale(q.uncertainty, scalar < 0n ? -scalar : scalar) : null); }
  function powerQuantity(q, exponent) {
    integer(exponent, "exponent", -64, 64);
    const dims = {}; for (const name of DIMENSION_NAMES) dims[name] = q.dimensions[name] * exponent;
    if (!q.uncertainty || exponent === 0) return quantity(pow(q.value, exponent), dims);
    const baseInterval = interval(q), zero = rational(0);
    const crossesZero = compare(baseInterval.low, zero) <= 0 && compare(baseInterval.high, zero) >= 0;
    if (exponent < 0 && crossesZero) throw new RangeError("negative-power interval contains zero");
    const endpoints = [pow(baseInterval.low, exponent), pow(baseInterval.high, exponent)];
    if (exponent > 0 && exponent % 2 === 0 && crossesZero) endpoints.push(zero);
    const low = endpoints.reduce((a, b) => compare(a, b) < 0 ? a : b);
    const high = endpoints.reduce((a, b) => compare(a, b) > 0 ? a : b);
    const value = pow(q.value, exponent);
    return quantity(value, dims, symmetricUncertainty(value, low, high));
  }
  const equations = new Map();
  function registerEquation(name, expression, argumentNames, source, version = "1") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !Array.isArray(argumentNames) || argumentNames.some(n => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) throw new TypeError("invalid equation registration");
    tokenize(expression); // Grammar is checked at registration; argument dimensions are checked on use.
    equations.set(name, Object.freeze({ expression, arguments: Object.freeze([...argumentNames]), source: String(source), version: String(version) }));
  }
  function evaluateEquation(name, args = {}) {
    const equation = equations.get(name); if (!equation) throw new ReferenceError("unknown equation");
    for (const argument of equation.arguments) if (!Object.hasOwn(args, argument)) throw new TypeError(`missing equation argument ${argument}`);
    for (const key of Object.keys(args)) if (!equation.arguments.includes(key)) throw new TypeError(`unexpected equation argument ${key}`);
    const value = evaluate(equation.expression, args);
    return Object.freeze({ value, equation: name, source: equation.source, version: equation.version });
  }
  registerEquation("uniform_distance", "velocity * time", ["velocity", "time"], "kinematic definition");
  registerEquation("average_velocity", "distance / time", ["distance", "time"], "kinematic definition");
  registerEquation("kinetic_energy", "mass * velocity^2 / 2", ["mass", "velocity"], "classical kinetic-energy definition");
  return Object.freeze({ FORMAT, DIMENSION_NAMES, rational, quantity, interval, convert, fromUnit, evaluate, registerEquation, evaluateEquation, registerConstant, binaryQuantity, compare, units, constants, equations });
});
