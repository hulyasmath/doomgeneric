"use strict";
// Error-controlled scientific Float64 methods. Not bit-authoritative gameplay arithmetic.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqNumerics = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FORMAT = "zeq-numerics-v1";
  const PROFILE = "scientific-float64-nonauthoritative";
  const clock = () => globalThis.performance?.now() ?? Date.now();
  class Control extends Error {
    constructor(status, message) { super(message); this.numericStatus = status; }
  }
  function integer(value, name, minimum, maximum, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Control("invalid-input", `${name} outside [${minimum}, ${maximum}]`);
    return value;
  }
  function number(value, name, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Control("invalid-input", `invalid ${name}`);
    return value;
  }
  function budgetFor(options = {}, defaultOperations = 100000) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Control("invalid-input", "options must be an object");
    const limits = {
      operations: integer(options.maxOperations, "maxOperations", 1, 100000000, defaultOperations),
      milliseconds: integer(options.maxMilliseconds, "maxMilliseconds", 1, 600000, 60000),
      arrayElements: integer(options.maxArrayElements, "maxArrayElements", 1, 10000000, 1000000)
    };
    const started = clock();
    let operations = 0, peakElements = 0;
    return {
      limits,
      consume(count = 1) {
        operations += count;
        if (operations > limits.operations) throw new Control("budget-exceeded", "operation budget exceeded");
        if (clock() - started > limits.milliseconds) throw new Control("budget-exceeded", "time budget exceeded");
      },
      allocate(count) {
        if (!Number.isSafeInteger(count) || count < 0 || count > limits.arrayElements) throw new Control("budget-exceeded", "array-element budget exceeded");
        peakElements = Math.max(peakElements, count);
      },
      report() { return { operations, elapsedMs: Math.max(0, clock() - started), peakArrayElements: peakElements, limits }; }
    };
  }
  function run(method, options, defaultOperations, body) {
    let budget;
    try {
      budget = budgetFor(options, defaultOperations);
      const value = body(budget);
      return { format: FORMAT, profile: PROFILE, method, status: "ok", ...value, budget: budget.report() };
    } catch (error) {
      if (!(error instanceof Control) && error?.name !== "Control") {
        error = new Control("refused", error instanceof Error ? error.message : "numerical callback failed");
      }
      return { format: FORMAT, profile: PROFILE, method, status: error.numericStatus || "refused", error: error.message, budget: budget?.report() || null };
    }
  }
  function vector(value, name, maximum = 64) {
    if (!Array.isArray(value) || !value.length || value.length > maximum) throw new Control("invalid-input", `invalid ${name} length`);
    return value.map((entry) => number(entry, name));
  }
  function matrix(value, size) {
    if (!Array.isArray(value) || value.length !== size) throw new Control("invalid-input", "matrix row count");
    return value.map(row => {
      if (!Array.isArray(row) || row.length !== size) throw new Control("invalid-input", "matrix row width");
      return vector(row, "matrix row", size);
    });
  }
  function normInfMatrix(a) {
    let norm = 0;
    for (const row of a) norm = Math.max(norm, row.reduce((sum, value) => sum + Math.abs(value), 0));
    return norm;
  }
  function normInfVector(a) { return a.reduce((norm, value) => Math.max(norm, Math.abs(value)), 0); }
  function factorial(n) { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; }

  function invert(a, tolerance, budget) {
    const n = a.length;
    budget.allocate(n * n * 2);
    const work = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
    const norm = normInfMatrix(a);
    const threshold = Math.max(Number.MIN_VALUE, norm * tolerance);
    for (let column = 0; column < n; column++) {
      let pivot = column;
      for (let row = column + 1; row < n; row++) if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
      if (Math.abs(work[pivot][column]) <= threshold) throw new Control("singular", "matrix pivot below declared tolerance");
      [work[column], work[pivot]] = [work[pivot], work[column]];
      const divisor = work[column][column];
      for (let j = 0; j < 2 * n; j++) work[column][j] /= divisor;
      for (let row = 0; row < n; row++) {
        if (row === column) continue;
        const factor = work[row][column];
        if (!factor) continue;
        for (let j = 0; j < 2 * n; j++) work[row][j] -= factor * work[column][j];
      }
      budget.consume(1 + n * n);
    }
    const inverse = work.map(row => row.slice(n));
    if (!inverse.every(row => row.every(Number.isFinite))) throw new Control("diverged", "non-finite matrix inverse");
    return { inverse, condition: norm * normInfMatrix(inverse) };
  }
  function multiply(a, x) { return a.map(row => row.reduce((sum, value, i) => sum + value * x[i], 0)); }

  function solveLinear(a, b, options = {}) {
    return run("linear-solve", options, 1000000, budget => {
      if (!Array.isArray(a) || !a.length || a.length > 64) throw new Control("invalid-input", "matrix size outside 1..64");
      const n = a.length, A = matrix(a, n), B = vector(b, "right-hand side", n);
      if (B.length !== n) throw new Control("invalid-input", "right-hand side size");
      const tolerance = number(options.tolerance ?? 1e-12, "tolerance", Number.MIN_VALUE, 1);
      const { inverse, condition } = invert(A, tolerance, budget);
      const x = inverse.map(row => row.reduce((sum, value, i) => sum + value * B[i], 0));
      const residual = A.map((row, i) => row.reduce((sum, value, j) => sum + value * x[j], 0) - B[i]);
      budget.consume(n * n);
      const residualNorm = normInfVector(residual);
      const residualDerivedAbsolute = normInfMatrix(inverse) * residualNorm;
      return { value: x, residualInfNorm: residualNorm, conditionInfNorm: condition,
        sensitivity: { conditionInfNorm: condition,
          residualDerivedAbsoluteErrorEstimate: residualDerivedAbsolute,
          residualDerivedRelativeErrorEstimate: residualDerivedAbsolute / Math.max(normInfVector(x), Number.MIN_VALUE),
          semantics: "floating-point residual/condition diagnostic, not an unconditional error bound" } };
    });
  }

  function finiteDifferenceWeights(nodes, derivative = 1, options = {}) {
    return run("finite-difference-weights", options, 200000, budget => {
      const points = vector(nodes, "nodes", 33);
      const order = integer(derivative, "derivative", 0, 8, 1);
      if (order >= points.length) throw new Control("invalid-input", "derivative order requires more nodes");
      if (new Set(points).size !== points.length) throw new Control("invalid-input", "duplicate finite-difference nodes");
      const scale = Math.max(...points.map(Math.abs));
      if (!scale) throw new Control("invalid-input", "all nodes coincide at zero");
      const A = points.map((_, k) => points.map(x => (x / scale) ** k));
      const rhs = Array.from({ length: points.length }, (_, k) => k === order ? factorial(order) / scale ** order : 0);
      const { inverse, condition } = invert(A, 0, budget);
      const weights = inverse.map(row => row.reduce((sum, value, i) => sum + value * rhs[i], 0));
      const residual = A.map((row, i) => row.reduce((sum, value, j) => sum + value * weights[j], 0) - rhs[i]);
      return { value: weights, nodes: points, derivative: order, residualInfNorm: normInfVector(residual), conditionInfNorm: condition };
    });
  }

  function finiteDifferenceConvergence(f, center, options = {}) {
    return run("finite-difference-convergence", options, 10000, budget => {
      if (typeof f !== "function") throw new Control("invalid-input", "function callback required");
      const x = number(center, "center"), derivative = integer(options.derivative, "derivative", 1, 2, 1);
      const baseStep = number(options.baseStep ?? 1, "baseStep", Number.MIN_VALUE);
      const levels = integer(options.levels, "levels", 3, 16, 8);
      const exact = options.exact === undefined ? null : number(options.exact, "exact");
      const weightsResult = finiteDifferenceWeights([-1, 0, 1], derivative, { maxMilliseconds: options.maxMilliseconds });
      if (weightsResult.status !== "ok") throw new Control(weightsResult.status, weightsResult.error);
      const estimates = [];
      for (let level = 0; level < levels; level++) {
        const h = baseStep * 2 ** -level;
        const values = [-1, 0, 1].map(node => number(f(x + node * h), "function value"));
        const estimate = values.reduce((sum, value, i) => sum + value * weightsResult.value[i] / h ** derivative, 0);
        estimates.push({ step: h, estimate, error: exact === null ? null : Math.abs(estimate - exact) });
        budget.consume(4);
      }
      for (let i = 1; i < estimates.length; i++) {
        const current = estimates[i], previous = estimates[i - 1];
        const error = exact === null ? Math.abs(current.estimate - previous.estimate) : current.error;
        const priorError = exact === null ? (i > 1 ? Math.abs(previous.estimate - estimates[i - 2].estimate) : null) : previous.error;
        current.observedOrder = priorError > 0 && error > 0 ? Math.log2(priorError / error) : null;
      }
      return { value: estimates, finalEstimate: estimates.at(-1).estimate, derivative };
    });
  }

  function integrateOde(f, initial, options = {}) {
    return run("adaptive-ode-rk45", options, 2000000, budget => {
      if (typeof f !== "function" || !initial || typeof initial !== "object" || !Array.isArray(initial.y)) throw new Control("invalid-input", "ODE callback and initial state required");
      let t = number(initial.t, "initial time");
      const end = number(options.end, "end time");
      if (t === end) throw new Control("invalid-input", "empty integration interval");
      let y = vector(initial.y, "initial state");
      const n = y.length, direction = Math.sign(end - t), span = Math.abs(end - t);
      const atol = number(options.absoluteTolerance ?? 1e-8, "absoluteTolerance", Number.MIN_VALUE);
      const rtol = number(options.relativeTolerance ?? 1e-8, "relativeTolerance", Number.MIN_VALUE);
      const maxSteps = integer(options.maxSteps, "maxSteps", 1, 100000, 10000);
      const maxState = number(options.maxState ?? 1e100, "maxState", Number.MIN_VALUE);
      const maxStep = number(options.maxStep ?? span / 10, "maxStep", Number.MIN_VALUE);
      const minStep = number(options.minStep ?? span * 1e-12, "minStep", Number.MIN_VALUE);
      if (minStep > maxStep) throw new Control("invalid-input", "minStep exceeds maxStep");
      let h = direction * Math.min(maxStep, span / 10 || maxStep), accepted = 0, rejected = 0, evaluations = 0, lastError = 0;
      const steps = options.recordSteps ? [{ t, y: [...y] }] : null;
      budget.allocate(n * 16);
      const derivative = (time, state) => {
        const value = vector(f(time, [...state]), "ODE derivative", n);
        if (value.length !== n) throw new Control("invalid-input", "ODE derivative size changed");
        evaluations++; budget.consume(n + 1); return value;
      };
      while (direction * (end - t) > 0) {
        if (accepted + rejected >= maxSteps) throw new Control("budget-exceeded", "ODE step budget exceeded");
        if (direction * (t + h - end) > 0) h = end - t;
        const k1 = derivative(t, y);
        const state2 = y.map((v, i) => v + h * k1[i] / 5);
        const k2 = derivative(t + h / 5, state2);
        const state3 = y.map((v, i) => v + h * (3 * k1[i] / 40 + 9 * k2[i] / 40));
        const k3 = derivative(t + 3 * h / 10, state3);
        const state4 = y.map((v, i) => v + h * (44 * k1[i] / 45 - 56 * k2[i] / 15 + 32 * k3[i] / 9));
        const k4 = derivative(t + 4 * h / 5, state4);
        const state5 = y.map((v, i) => v + h * (19372 * k1[i] / 6561 - 25360 * k2[i] / 2187 + 64448 * k3[i] / 6561 - 212 * k4[i] / 729));
        const k5 = derivative(t + 8 * h / 9, state5);
        const state6 = y.map((v, i) => v + h * (9017 * k1[i] / 3168 - 355 * k2[i] / 33 + 46732 * k3[i] / 5247 + 49 * k4[i] / 176 - 5103 * k5[i] / 18656));
        const k6 = derivative(t + h, state6);
        const fifth = y.map((v, i) => v + h * (35 * k1[i] / 384 + 500 * k3[i] / 1113 + 125 * k4[i] / 192 - 2187 * k5[i] / 6784 + 11 * k6[i] / 84));
        const k7 = derivative(t + h, fifth);
        const fourth = y.map((v, i) => v + h * (5179 * k1[i] / 57600 + 7571 * k3[i] / 16695 + 393 * k4[i] / 640 - 92097 * k5[i] / 339200 + 187 * k6[i] / 2100 + k7[i] / 40));
        const error = Math.max(...fifth.map((v, i) => Math.abs(v - fourth[i]) / (atol + rtol * Math.max(Math.abs(y[i]), Math.abs(v)))));
        lastError = error;
        if (!Number.isFinite(error)) throw new Control("diverged", "non-finite ODE error estimate");
        if (error <= 1) {
          t += h; y = fifth; accepted++;
          if (!y.every(v => Number.isFinite(v) && Math.abs(v) <= maxState)) throw new Control("diverged", "ODE state bound exceeded");
          if (steps) { steps.push({ t, y: [...y] }); budget.allocate(steps.length * n); }
        } else rejected++;
        if (direction * (end - t) <= 0) break;
        const factor = error === 0 ? 5 : Math.max(0.2, Math.min(error <= 1 ? 4 : 5, 0.9 * error ** -0.2));
        h *= factor;
        if (Math.abs(h) > maxStep) h = direction * maxStep;
        if (Math.abs(h) < minStep) throw new Control("diverged", "ODE step-size floor reached");
      }
      return { value: { t, y }, acceptedSteps: accepted, rejectedSteps: rejected, evaluations, errorEstimate: lastError, steps };
    });
  }

  function quadrature(f, a, b, options = {}) {
    return run("adaptive-simpson", options, 500000, budget => {
      if (typeof f !== "function") throw new Control("invalid-input", "quadrature callback required");
      const left = number(a, "left endpoint"), right = number(b, "right endpoint");
      if (left === right) return { value: 0, evaluations: 0, acceptedPanels: 0, rejectedPanels: 0, errorEstimate: 0, depth: 0 };
      const tolerance = number(options.tolerance ?? 1e-9, "tolerance", Number.MIN_VALUE);
      const maxDepth = integer(options.maxDepth, "maxDepth", 1, 24, 20);
      const maxEvaluations = integer(options.maxEvaluations, "maxEvaluations", 7, 1000000, 100000);
      let evaluations = 0, acceptedPanels = 0, rejectedPanels = 0, deepest = 0;
      const evaluate = x => {
        if (++evaluations > maxEvaluations) throw new Control("budget-exceeded", "quadrature evaluation budget exceeded");
        budget.consume(1); return number(f(x), "integrand value");
      };
      const fa = evaluate(left), fb = evaluate(right), fm = evaluate((left + right) / 2);
      const whole = (right - left) * (fa + 4 * fm + fb) / 6;
      function recurse(lo, hi, flo, fhi, fmid, estimate, localTolerance, depth) {
        deepest = Math.max(deepest, depth); budget.consume(1);
        const mid = (lo + hi) / 2, lm = (lo + mid) / 2, rm = (mid + hi) / 2;
        const flm = evaluate(lm), frm = evaluate(rm);
        const leftEstimate = (mid - lo) * (flo + 4 * flm + fmid) / 6;
        const rightEstimate = (hi - mid) * (fmid + 4 * frm + fhi) / 6;
        const refined = leftEstimate + rightEstimate, correction = (refined - estimate) / 15;
        if (Math.abs(refined - estimate) <= 15 * localTolerance) {
          acceptedPanels += 2; return { value: refined + correction, error: Math.abs(correction) };
        }
        rejectedPanels++;
        if (depth >= maxDepth || lo === lm || mid === lm || mid === rm || hi === rm)
          throw new Control("diverged", "quadrature did not resolve the interval within depth/precision limits");
        const leftResult = recurse(lo, mid, flo, fmid, flm, leftEstimate, localTolerance / 2, depth + 1);
        const rightResult = recurse(mid, hi, fmid, fhi, frm, rightEstimate, localTolerance / 2, depth + 1);
        return { value: leftResult.value + rightResult.value, error: leftResult.error + rightResult.error };
      }
      const result = recurse(left, right, fa, fb, fm, whole, tolerance, 0);
      if (!Number.isFinite(result.value)) throw new Control("diverged", "non-finite quadrature result");
      return { value: result.value, evaluations, acceptedPanels, rejectedPanels, errorEstimate: result.error, depth: deepest };
    });
  }

  function compensatedSum(values, options = {}) {
    return run("compensated-sum", options, Math.max(16, values?.length || 16), budget => {
      const input = vector(values, "sum values", 1000000);
      budget.allocate(input.length);
      let sum = 0, compensation = 0;
      for (const value of input) {
        const next = sum + value;
        compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
        sum = next; budget.consume(1);
      }
      const value = sum + compensation;
      if (!Number.isFinite(value)) throw new Control("diverged", "non-finite compensated sum");
      return { value, terms: input.length, errorEstimate: Math.abs(compensation), algorithm: "Neumaier" };
    });
  }

  function sumSeries(term, options = {}) {
    return run("adaptive-series-sum", options, 1000000, budget => {
      if (typeof term !== "function") throw new Control("invalid-input", "series term callback required");
      const tolerance = number(options.tolerance ?? 1e-10, "tolerance", Number.MIN_VALUE);
      const maxTerms = integer(options.maxTerms, "maxTerms", 4, 1000000, 100000);
      const start = integer(options.start, "start", -1000000, 1000000, 0);
      let sum = 0, compensation = 0, stable = 0, previous = null, tailEstimate = null, value = 0;
      for (let i = 0; i < maxTerms; i++) {
        value = number(term(start + i), "series term");
        const next = sum + value;
        compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
        sum = next; stable = Math.abs(value) <= tolerance ? stable + 1 : 0;
        if (previous !== null && Math.abs(previous) > 0) {
          const ratio = Math.abs(value / previous);
          tailEstimate = ratio < 1 ? Math.abs(value) * ratio / (1 - ratio) : Math.abs(value);
        } else tailEstimate = Math.abs(value);
        previous = value; budget.consume(1);
        if (stable >= 3 && tailEstimate <= tolerance) {
          return { value: sum + compensation, terms: i + 1, firstIndex: start, lastIndex: start + i, tailEstimate, errorEstimate: Math.abs(compensation) + tailEstimate, stoppingRule: "three-small-terms-and-geometric-tail-estimate" };
        }
      }
      throw new Control("budget-exceeded", "series convergence budget exhausted");
    });
  }

  function rootBracketed(f, bracket, options = {}) {
    return run("bracketed-bisection", options, 10000, budget => {
      if (typeof f !== "function" || !Array.isArray(bracket) || bracket.length !== 2) throw new Control("invalid-input", "function and two-point bracket required");
      let low = number(bracket[0], "bracket low"), high = number(bracket[1], "bracket high");
      if (!(low < high)) throw new Control("invalid-input", "root bracket must be increasing");
      const xTolerance = number(options.absoluteTolerance ?? 1e-12, "absoluteTolerance", Number.MIN_VALUE);
      const fTolerance = number(options.residualTolerance ?? 1e-12, "residualTolerance", Number.MIN_VALUE);
      const maxIterations = integer(options.maxIterations, "maxIterations", 1, 10000, 200);
      let fl = number(f(low), "left function value"), fh = number(f(high), "right function value");
      budget.consume(2);
      if (Math.abs(fl) <= fTolerance) return { value: low, iterations: 0, residual: fl, bracket: [low, low] };
      if (Math.abs(fh) <= fTolerance) return { value: high, iterations: 0, residual: fh, bracket: [high, high] };
      if (Math.sign(fl) === Math.sign(fh)) throw new Control("refused", "root bracket does not change sign");
      let mid = low, fm = fl;
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        mid = low + (high - low) / 2; fm = number(f(mid), "midpoint function value"); budget.consume(1);
        if (Math.abs(fm) <= fTolerance || high - low <= 2 * xTolerance)
          return { value: mid, iterations: iteration, residual: fm, bracket: [low, high], errorEstimate: (high - low) / 2 };
        if (Math.sign(fl) !== Math.sign(fm)) { high = mid; fh = fm; }
        else { low = mid; fl = fm; }
      }
      throw new Control("budget-exceeded", "root iteration budget exhausted");
    });
  }

  function symmetricEigen(a, options = {}) {
    return run("symmetric-jacobi-eigen", options, 10000000, budget => {
      if (!Array.isArray(a) || !a.length || a.length > 64) throw new Control("invalid-input", "matrix size outside 1..64");
      const n = a.length, A = matrix(a, n);
      const tolerance = number(options.tolerance ?? 1e-12, "tolerance", Number.MIN_VALUE, 1);
      const maxIterations = integer(options.maxIterations, "maxIterations", 1, 1000000, 100 * n * n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j] - A[j][i]) > tolerance) throw new Control("invalid-input", "Jacobi profile requires a symmetric matrix");
        A[i][j] = A[j][i] = (A[i][j] + A[j][i]) / 2;
      }
      budget.allocate(2 * n * n);
      const vectors = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
      let offNorm = Math.sqrt(A.reduce((sum, row, i) => sum + row.reduce((s, value, j) => s + (i === j ? 0 : value * value), 0), 0));
      let iteration = 0;
      while (offNorm > tolerance && iteration < maxIterations) {
        let p = 0, q = Math.min(1, n - 1), largest = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(A[i][j]) > largest) { largest = Math.abs(A[i][j]); p = i; q = j; }
        if (!largest) break;
        const app = A[p][p], aqq = A[q][q], apq = A[p][q];
        const tau = (aqq - app) / (2 * apq);
        const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t), s = t * c;
        for (let k = 0; k < n; k++) {
          if (k !== p && k !== q) {
            const akp = A[k][p], akq = A[k][q];
            A[k][p] = A[p][k] = c * akp - s * akq;
            A[k][q] = A[q][k] = s * akp + c * akq;
          }
          const vkp = vectors[k][p], vkq = vectors[k][q];
          vectors[k][p] = c * vkp - s * vkq;
          vectors[k][q] = s * vkp + c * vkq;
        }
        A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        A[p][q] = A[q][p] = 0;
        offNorm = Math.sqrt(A.reduce((sum, row, i) => sum + row.reduce((total, value, j) => total + (i === j ? 0 : value * value), 0), 0));
        iteration++; budget.consume(n * n);
      }
      if (offNorm > tolerance) throw new Control("budget-exceeded", "eigen iteration budget exhausted");
      const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i][i] - A[j][i] || i - j);
      const values = order.map(i => A[i][i]);
      const sortedVectors = vectors.map(row => order.map(i => row[i]));
      const original = matrix(a, n);
      const residuals = order.map((column, outputColumn) => {
        const eigenvector = sortedVectors.map(row => row[outputColumn]);
        return normInfVector(multiply(original, eigenvector).map((value, i) => value - values[outputColumn] * eigenvector[i]));
      });
      const absolute = values.map(Math.abs), smallest = Math.min(...absolute), largest = Math.max(...absolute);
      return { value: values, vectors: sortedVectors, iterations: iteration, offDiagonalNorm: offNorm, residualInfNorm: Math.max(...residuals), condition2Norm: smallest ? largest / smallest : null };
    });
  }

  function linearSensitivity(a, b, perturbation, options = {}) {
    return run("linear-sensitivity", options, 2000000, budget => {
      if (!perturbation || typeof perturbation !== "object") throw new Control("invalid-input", "perturbation required");
      const n = a.length, dA = perturbation.a ? matrix(perturbation.a, n) : Array.from({ length: n }, () => Array(n).fill(0));
      const db = perturbation.b ? vector(perturbation.b, "right-hand side perturbation", n) : Array(n).fill(0);
      if (db.length !== n || dA.length !== n) throw new Control("invalid-input", "perturbation dimensions");
      const base = solveLinear(a, b, options), perturbed = solveLinear(a.map((row, i) => row.map((value, j) => value + dA[i][j])), b.map((value, i) => value + db[i]), options);
      if (base.status !== "ok" || perturbed.status !== "ok") throw new Control(base.status !== "ok" ? base.status : perturbed.status, "base or perturbed linear solve failed");
      const delta = base.value.map((value, i) => perturbed.value[i] - value);
      const inputRelative = normInfMatrix(dA) / Math.max(normInfMatrix(matrix(a, n)), Number.MIN_VALUE) + normInfVector(db) / Math.max(normInfVector(vector(b, "right-hand side", n)), Number.MIN_VALUE);
      budget.consume(2);
      return { value: { base: base.value, perturbed: perturbed.value, delta }, relativeDeltaInfNorm: normInfVector(delta) / Math.max(normInfVector(base.value), Number.MIN_VALUE), conditionInfNorm: base.conditionInfNorm, conditionBasedRelativeEstimate: base.conditionInfNorm * inputRelative, baseResidualInfNorm: base.residualInfNorm, perturbedResidualInfNorm: perturbed.residualInfNorm };
    });
  }

  return Object.freeze({ FORMAT, PROFILE, finiteDifferenceWeights, finiteDifferenceConvergence, integrateOde, quadrature, compensatedSum, sumSeries, rootBracketed, solveLinear, symmetricEigen, linearSensitivity });
});
