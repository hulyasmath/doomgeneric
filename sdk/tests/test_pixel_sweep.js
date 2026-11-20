"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
require("../zeq-pixel.js");
const Pixel = globalThis.ZeqPixel;
const ROOT = path.resolve(__dirname, "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-pixel-sweep-"));
const sizes = [[1, 1], [17, 13], [127, 63], [320, 200]];
const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");
function findEmcc() {
  const candidates = [process.env.EMCC, "/tmp/emsdk-zeq/upstream/emscripten/emcc", "/tmp/emsdk/upstream/emscripten/emcc", "emcc"].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes("/") && fs.existsSync(candidate)) return candidate;
    if (!candidate.includes("/")) return candidate;
  }
  throw new Error("Emscripten not found");
}
function javascriptBytes() {
  const output = [];
  for (const [width, height] of sizes) {
    const surface = Pixel.init(width, height);
    const counts = [0, 0, 0, 0];
    const account = status => { counts[status]++; };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const rgba = (((x * 17 + y * 3) & 255) * 0x1000000 + ((x * 5 + y * 29) & 255) * 0x10000 + ((x * 41 + y * 7) & 255) * 0x100 + 255) >>> 0;
      const depth = 100 + (x + y) % 17, owner = 1 + (x * 3 + y) % 7, layer = x % 5 - 2;
      account(Pixel.write(surface, x, y, depth, owner, layer, 2 ** ((x + y) % 8), rgba));
      if ((x + y * width) % 97 === 0) {
        account(Pixel.write(surface, x, y, depth, owner, layer, 256, rgba));
        account(Pixel.write(surface, x, y, depth, owner, layer, 256, (rgba ^ 0x100) >>> 0));
        account(Pixel.write(surface, x, y, 1000, 99, 99, 1, 0x102030ff));
        account(Pixel.write(surface, x, y, 1, 1, -10, 512, 0xf02030ff));
      }
    }
    for (let y = 0; y < height; y += 16) assert.ok(Pixel.span(surface, y, Pixel.rat(-1, 3), Pixel.rat(width * 3 + 1, 3), 50, 15, 0, 1024, 0x304050ff) >= 0);
    for (let x = 0; x < width; x += 31) assert.ok(Pixel.column(surface, x, Pixel.rat(-2, 5), Pixel.rat(height * 5 + 2, 5), 25, 16, -1, 2048, 0x506070ff) >= 0);
    const frame = Buffer.from(Pixel.frameBytes(surface));
    const occupancy = Buffer.from(Pixel.occupancyBytes(surface));
    const header = Buffer.alloc(32);
    header.writeUInt32LE(width, 0); header.writeUInt32LE(height, 4);
    header.writeUInt32LE(frame.length, 8); header.writeUInt32LE(occupancy.length, 12);
    counts.forEach((count, i) => header.writeUInt32LE(count, 16 + i * 4));
    output.push(header, frame, occupancy);
  }
  return Buffer.concat(output);
}
function difference(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  let offset = 0; while (offset < limit && actual[offset] === expected[offset]) offset++;
  return `lengths ${actual.length}/${expected.length}; first difference ${offset}: ${offset < actual.length ? actual[offset] : "eof"}/${offset < expected.length ? expected[offset] : "eof"}; actual=${actual.subarray(0, 40).toString("hex")} expected=${expected.subarray(0, 40).toString("hex")}`;
}
function run(command, args, budgetMs) {
  const started = performance.now();
  const result = spawnSync(command, args, { maxBuffer: 16 * 1024 * 1024, timeout: budgetMs });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.toString() || `exit ${result.status}`);
  return { bytes: result.stdout, elapsedMs: Math.round((performance.now() - started) * 100) / 100 };
}
try {
  const cc = ["cc", "-std=c99", "-O2", "-Wall", "-Wextra", "-Werror", "-I" + path.join(ROOT, "sdk")];
  const native = path.join(directory, "sweep-native");
  let built = spawnSync(cc[0], [...cc.slice(1), path.join(ROOT, "sdk", "zeq_pixel.c"), path.join(__dirname, "zeq_pixel_sweep_probe.c"), "-o", native], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const wasm = path.join(directory, "sweep-wasm.js");
  const emcc = findEmcc();
  built = spawnSync(emcc, ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror", "-I" + path.join(ROOT, "sdk"), path.join(ROOT, "sdk", "zeq_pixel.c"), path.join(__dirname, "zeq_pixel_sweep_probe.c"), "-o", wasm], { encoding: "utf8", timeout: 120000 });
  assert.equal(built.status, 0, built.stderr);
  const js = javascriptBytes();
  const nativeEncoded = run(native, [], 10000);
  const wasmEncoded = run(process.execPath, [wasm], 20000);
  const decodeHex = result => {
    const text = result.bytes.toString("utf8").trim();
    assert.ok(text.length % 2 === 0 && /^[0-9a-f]*$/.test(text), "non-canonical hex probe output");
    return { elapsedMs: result.elapsedMs, bytes: Buffer.from(text, "hex") };
  };
  const nativeRun = decodeHex(nativeEncoded), wasmRun = decodeHex(wasmEncoded);
  assert.ok(nativeRun.bytes.equals(js), `native/JavaScript sweep bytes differ: ${difference(nativeRun.bytes, js)}`);
  assert.ok(wasmRun.bytes.equals(js), `WASM/JavaScript sweep bytes differ: ${difference(wasmRun.bytes, js)}`);
  assert.ok(decodeHex(run(native, [], 10000)).bytes.equals(nativeRun.bytes), "native repeat differs");
  assert.ok(decodeHex(run(process.execPath, [wasm], 20000)).bytes.equals(wasmRun.bytes), "WASM repeat differs");
  const frames = [];
  let offset = 0;
  for (const [width, height] of sizes) {
    const header = nativeRun.bytes.subarray(offset, offset + 32); offset += 32;
    const frameBytes = header.readUInt32LE(8), occupancyBytes = header.readUInt32LE(12);
    const frame = nativeRun.bytes.subarray(offset, offset + frameBytes); offset += frameBytes;
    offset += occupancyBytes;
    frames.push({ width, height, frameBytes, occupancyBytes, frameSha256: sha256(frame) });
  }
  assert.equal(offset, nativeRun.bytes.length);
  console.log(JSON.stringify({ ok: true, format: "zeq-pixel-sweep-v1", targets: ["native-c99-i128", "javascript-bigint", "wasm-c99-i128"], resolutions: frames, exactBytesIncludingOccupancyAndStatuses: true, repeatRunBytesMatch: true, nativeMs: nativeRun.elapsedMs, wasmMs: wasmRun.elapsedMs, budgetsMs: { native: 10000, wasmPerRun: 20000, build: 120000 }, storageBound: "caller-owned width*height pixels; serialized frame 16+4n and occupancy 16+16n" }, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
