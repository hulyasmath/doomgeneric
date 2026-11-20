"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
require("../zeq-pixel.js");

const P = globalThis.ZeqPixel;
const R = P.rat;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-pixel-conformance-"));
const native = path.join(temp, "pixel-native");
const wasmJs = path.join(temp, "pixel-wasm.js");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function emcc() {
  if (process.env.EMCC) return process.env.EMCC;
  for (const local of ["/tmp/emsdk/upstream/emscripten/emcc", "/tmp/emsdk-zeq/upstream/emscripten/emcc"]) {
    if (fs.existsSync(local)) return local;
  }
  return "emcc";
}
function scene() {
  const s = P.init(9, 7);
  const results = [
    P.write(s, 1, 1, 100, 2, 3, 1, 0x112233ff),
    P.write(s, 1, 1, 101, 1, 0, 2, 0x445566ff),
    P.write(s, 1, 1, 90, 9, 3, 1, 0x112233ff),
    P.write(s, 1, 1, 90, 1, 4, 2, 0x445566ff),
    P.write(s, 1, 1, 90, 9, 3, 2, 0x112233ff),
    P.write(s, 1, 1, 90, 9, 3, 4, 0xaabbccff),
    P.write(s, 2, 1, 90, 9, 3, 4, 0xaabbccfe),
    P.write(s, 2, 1, 90, 0, 3, 4, 0xaabbccff),
    P.write(s, -1, 1, 90, 9, 3, 4, 0xaabbccff),
    P.span(s, 3, R(-3, 2), R(17, 2), 50, 4, 0, 4, 0x204060ff),
    P.span(s, 4, R(3), R(2), 50, 4, 0, 4, 0x204060ff),
    P.span(s, 4, R(3), R(3), 50, 4, 0, 4, 0x204060ff),
    P.span(s, 2, R(2), R(4), 60, 6, 0, 8, 0x8090a0ff),
    P.column(s, 4, R(1, 3), R(11, 2), 40, 5, -1, 16, 0xff8000ff),
    P.column(s, 99, R(0), R(2), 40, 5, -1, 16, 0xff8000ff),
    P.project(R(0), R(0), R(1), R(1), 9, 7).status,
    P.project(R(0), R(0), R(0), R(1), 9, 7).status,
    P.project(R(0), R(0), R(-1), R(1), 9, 7).status,
    P.project(R(1000000000), R(0), R(1, 1000000000), R(1000000000), 9, 7).status,
    P.project(R(1, 0), R(0), R(1), R(1), 9, 7).status
  ];
  const point = value => [value.status, ...(value.point ? [value.point.x.num, value.point.x.den, value.point.y.num, value.point.y.den] : [])];
  return {
    format: "zeq-pixel-conformance-v1", results,
    center: point(P.project(R(0), R(0), R(1), R(1), 9, 7)),
    fractional: point(P.project(R(1, 2), R(-1, 4), R(2), R(3, 2), 9, 7)),
    outside: point(P.project(R(10000), R(0), R(1), R(1), 9, 7)),
    frame_hex: Buffer.from(P.frameBytes(s)).toString("hex"),
    occupancy_hex: Buffer.from(P.occupancyBytes(s)).toString("hex")
  };
}
function normalize(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
}
function hash(hex) { return crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex"); }

try {
  run("cc", ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror", "-I", path.join(__dirname, ".."),
    path.join(__dirname, "zeq_pixel_probe.c"), path.join(__dirname, "../zeq_pixel.c"), "-o", native]);
  run(emcc(), ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror", "-I", path.join(__dirname, ".."),
    path.join(__dirname, "zeq_pixel_probe.c"), path.join(__dirname, "../zeq_pixel.c"),
    "-sENVIRONMENT=node", "-o", wasmJs]);
  const javascript = scene();
  const nativeResult = JSON.parse(run(native, []));
  const wasmResult = JSON.parse(run("node", [wasmJs]));
  assert.deepEqual(nativeResult, normalize(javascript));
  assert.deepEqual(wasmResult, normalize(javascript));
  assert.deepEqual(JSON.parse(run(native, [])), nativeResult, "native bytes must be stable across runs");
  assert.deepEqual(JSON.parse(run("node", [wasmJs])), wasmResult, "WASM bytes must be stable across runs");
  assert.deepEqual(javascript.results, [1, 2, 1, 2, 3, 0, 0, 0, 0, 9, -1, 0, 2, 6, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(javascript.center, [1, 1152n, 1n, 896n, 1n]);
  assert.deepEqual(javascript.fractional, [1, 1248n, 1n, 944n, 1n]);
  assert.deepEqual(javascript.outside, [2, 2561152n, 1n, 896n, 1n]);
  assert.throws(() => P.init(0, 7));
  assert.throws(() => P.init(4097, 1));
  assert.throws(() => P.init(9, 7, []));
  const report = {
    ok: true,
    format: javascript.format,
    targets: ["native-c99-i128", "javascript-bigint", "wasm-c99-i128"],
    frameBytes: javascript.frame_hex.length / 2,
    occupancyBytes: javascript.occupancy_hex.length / 2,
    frameSha256: hash(javascript.frame_hex),
    occupancySha256: hash(javascript.occupancy_hex),
    nativeWasmJavascriptBytesMatch: true,
    repeatRunBytesMatch: true,
    cases: "ownership, depth/layer ties, same-key conflict, opacity, clipping, seams, reversed/degenerate lines, projection, overflow and short buffers"
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
