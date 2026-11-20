"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

function readManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(manifest.format, "zeq-release-manifest-v1");
  assert.equal(manifest.sourceCommit, commit);
  assert.match(manifest.evidenceScope, /test and delivery gates are separate/);
  assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0);
  return manifest;
}

function verifyArtifacts(manifest, base) {
  const paths = new Set();
  for (const artifact of manifest.artifacts) {
    assert.equal(typeof artifact.path, "string");
    assert.ok(artifact.path && !artifact.path.startsWith("/") && !artifact.path.includes("\\")
      && !artifact.path.split("/").includes("..") && !artifact.path.split("/").includes("."),
      `unsafe artifact path: ${artifact.path}`);
    assert.ok(!paths.has(artifact.path), `duplicate artifact: ${artifact.path}`);
    paths.add(artifact.path);
    const bytes = fs.readFileSync(path.resolve(base, artifact.path));
    assert.equal(bytes.length, artifact.bytes, `artifact length: ${artifact.path}`);
    assert.equal(sha256(bytes), artifact.sha256, `artifact digest: ${artifact.path}`);
  }
  return paths;
}

const browserFile = path.join(ROOT, "dist/zeq-release-manifest.json");
const browser = readManifest(browserFile);
assert.equal(browser.target, "doomgeneric-browser-wasm");
assert.match(browser.toolchain, /3\.1\.64/);
const browserPaths = verifyArtifacts(browser, path.join(ROOT, "dist"));
for (const required of ["index.html", "doomgeneric.js", "doomgeneric.wasm", "doomgeneric.data", "zeq.js", "sdk/zeq-build-info.js"])
  assert.ok(browserPaths.has(required), `missing browser artifact: ${required}`);
const actualBrowserFiles = fs.readdirSync(path.join(ROOT, "dist"), { recursive: true })
  .filter(file => fs.statSync(path.join(ROOT, "dist", file)).isFile())
  .map(file => file.split(path.sep).join("/"))
  .filter(file => file !== "zeq-release-manifest.json");
assert.deepEqual(actualBrowserFiles.sort(), [...browserPaths].sort(), "stale or unlisted browser artifact");

const native = readManifest(path.join(ROOT, "doomgeneric/build-headless/zeq-release-manifest.json"));
assert.equal(native.target, "doomgeneric-native-headless");
const nativePaths = verifyArtifacts(native, ROOT);
assert.deepEqual([...nativePaths].sort(), ["doomgeneric/doom1.wad", "doomgeneric/doomgeneric-headless"]);

console.log(JSON.stringify({
  ok: true,
  format: "zeq-release-manifest-v1",
  sourceCommit: commit,
  browserArtifacts: browser.artifacts.length,
  browserWasmSha256: browser.artifacts.find(file => file.path === "doomgeneric.wasm").sha256,
  nativeEngineSha256: native.artifacts.find(file => file.path === "doomgeneric/doomgeneric-headless").sha256,
  staleBrowserArtifacts: 0
}, null, 2));
