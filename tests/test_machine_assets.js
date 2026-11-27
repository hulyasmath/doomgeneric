"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const machine = fs.readFileSync(path.join(WEB, "machine.html"), "utf8");
const assets = [
  "machine-catalogue.js", "machine-page.js", "machine-engine-1.js", "machine-engine-2.js",
  "machine-runtime-1.js", "machine-runtime-2.js"
];
const declared = [...machine.matchAll(/<script src="(machine-[^"]+\.js)"><\/script>/g)].map(match => match[1]);
assert.deepEqual(declared, [...assets, "machine-bootstrap.js"], "machine asset order changed");
assert.ok(Buffer.byteLength(machine) < 1_000_000, "outer machine exceeds the text publication limit");

const context = vm.createContext({});
for (const file of [...assets, "machine-bootstrap.js"]) {
  const source = fs.readFileSync(path.join(WEB, file), "utf8");
  assert.ok(Buffer.byteLength(source) < 1_000_000, `${file} exceeds the text publication limit`);
  new vm.Script(source, { filename: file });
  if (file !== "machine-bootstrap.js") vm.runInContext(source, context, { filename: file });
}
const chunks = context.ZEQ_MACHINE_CHUNKS;
const read = (name, count) => Array.from({ length: count }, (_, index) => {
  const value = chunks[`${name}:${index}`];
  assert.equal(typeof value, "string", `missing ${name}:${index}`);
  return value;
}).join("");

const catalogue = read("zeq-catalogue", 1);
const page = read("zeq-page", 1);
const pack = read("zeq-engine", 2);
const runtime = read("runtime", 2);
const sha256 = value => crypto.createHash("sha256").update(value).digest("base64");
assert.equal(sha256(catalogue), "95QFFgpxE7PrlPm9G1vJodw7kypmvrSh1Em49wRXOhI=");
assert.equal(sha256(page), "xFEfnhRZOt4SxQs26hucBEMQGsYA253xzSQNUgleXYY=");
assert.equal(sha256(pack), "AWIk0TMm4UU/asqURWqI14cMktXOgiE2se6vdTjCp9I=");
assert.equal(sha256(runtime), "1dHNadchqHUxMlVHyghJo34L2bUGO8MPxTJ2b3A4aUs=");
assert.equal(JSON.parse(catalogue).format, "ZEQ-CATALOGUE-v1");
assert.equal(JSON.parse(pack).format, "ZEQ-ENGINE-v1");
assert.ok(JSON.parse(page).includes("14 TESTED / 6 QUEUED"));
new vm.Script(runtime, { filename: "reassembled original machine runtime" });

const policy = machine.match(/content="([^"]+)" http-equiv="Content-Security-Policy"/)[1];
const scriptPolicy = policy.match(/script-src ([^;]+)/)[1];
assert.ok(scriptPolicy.includes("'self'"));
assert.ok(scriptPolicy.includes(`'sha256-${sha256(runtime)}'`));
assert.ok(!scriptPolicy.includes("unsafe-inline") && !scriptPolicy.includes("unsafe-eval"));

const style = machine.match(/<style id="zeq-style">([\s\S]*?)<\/style>/)[1];
const parts = { CSS: style.slice(1), PACK: pack, JS: runtime.slice(1), TPL: page };
const exported = JSON.parse(page).replace(/%%ZEQ:(CSS|PACK|JS|TPL)%%/g, (_, key) => parts[key]);
assert.ok(exported.includes(runtime.slice(1)), "bearer export lost its original inline runtime");
assert.ok(exported.includes(pack), "bearer export lost its engine payload");
assert.ok(!assets.some(file => exported.includes(file)), "bearer export unexpectedly depends on split website assets");
const exportedPolicy = exported.match(/content="([^"]+)" http-equiv="Content-Security-Policy"/)[1];
assert.ok(!exportedPolicy.match(/script-src ([^;]+)/)[1].includes("'self'"), "self-contained export should retain its original inline-only script policy");

console.log(JSON.stringify({
  ok: true,
  outerMachineBytes: Buffer.byteLength(machine),
  maximumAssetBytes: Math.max(...assets.map(file => fs.statSync(path.join(WEB, file)).size)),
  releasePayloadsSha256Matched: 4,
  runtimeParses: true,
  bearerExportSelfContained: true,
  unsafeEvalAdded: false
}, null, 2));
