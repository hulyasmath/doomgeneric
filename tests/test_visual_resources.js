"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const engine = path.join(ROOT, "doomgeneric", "doomgeneric-headless");
const loader = "/lib64/ld-linux-x86-64.so.2";
const source = fs.readFileSync(path.join(ROOT, "doomgeneric", "doom1.wad"));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-visual-resources-"));
function entry(wad, name) {
  const count = wad.readUInt32LE(4), start = wad.readUInt32LE(8);
  for (let i = 0; i < count; i++) {
    const offset = start + i * 16;
    if (wad.toString("ascii", offset + 8, offset + 16).replace(/\0.*$/s, "") === name)
      return { position: offset, data: wad.readUInt32LE(offset), size: wad.readUInt32LE(offset + 4) };
  }
  throw new Error(`missing ${name}`);
}
function run(wad, name, visual = false) {
  const wadPath = path.join(directory, `${name}.wad`);
  fs.writeFileSync(wadPath, wad);
  const env = { ...process.env, ZEQ_MAX_TIC: "4", ZEQ_CHECKPOINT_INTERVAL: "4", ZEQ_VISUAL_INTERVAL: visual ? "1" : "0" };
  const result = spawnSync(loader, [engine, "-iwad", wadPath, "-warp", "1", "1", "-skill", "3", "-nosound", "-nomusic", "-config", "default.cfg"], { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  return result;
}
try {
  const valid = run(source, "valid", true);
  assert.equal(valid.status, 0, valid.stderr);
  const visualRecords = valid.stdout.split("\n").filter(line => line.startsWith("ZEQJ")).map(line => JSON.parse(line.slice(4))).filter(record => record.kind === "visual");
  assert.ok(visualRecords.length > 0, "real host emitted no visual frame");
  assert.ok(visualRecords.every(record => record.width === 320 && record.height === 200 && record.frame_bytes === 256016));
  const mutations = [
    ["PNAMES", "count", wad => { const e = entry(wad, "PNAMES"); wad.writeUInt32LE(0xffffffff, e.data); }],
    ["TEXTURE1", "directory", wad => { const e = entry(wad, "TEXTURE1"); wad.writeUInt32LE(3, e.data + 4); }],
    ["PATCH", "patch", wad => { const p = entry(wad, "PNAMES"); const name = wad.toString("ascii", p.data + 4, p.data + 12).replace(/\0.*$/s, ""); const e = entry(wad, name); wad.writeUInt32LE(0x7fffffff, e.data + 8); }],
    ["FLAT", "flat", wad => { const e = entry(wad, "FLOOR0_1"); wad.writeUInt32LE(4095, e.position + 4); }],
    ["PLAYPAL", "palette", wad => { const e = entry(wad, "PLAYPAL"); wad.writeUInt32LE(767, e.position + 4); }],
    ["COLORMAP", "colormap", wad => { const e = entry(wad, "COLORMAP"); wad.writeUInt32LE(8192, e.position + 4); }]
  ];
  const refused = [];
  for (const [name, reason, mutate] of mutations) {
    const wad = Buffer.from(source); mutate(wad);
    const result = run(wad, `bad-${name.toLowerCase()}`);
    assert.notEqual(result.status, 0, `${name} mutation was accepted`);
    assert.match(result.stderr + result.stdout, /R_ValidateResource/, `${name} did not fail at structural validator`);
    refused.push({ resource: name, reason });
  }
  console.log(JSON.stringify({ ok: true, validHostFrames: visualRecords.length, validFrameSha256: visualRecords.at(-1).frame_sha256, refused, scope: "real doomgeneric resource ingestion; malformed resources fail before use" }, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
