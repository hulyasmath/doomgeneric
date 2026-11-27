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
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
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
assert.equal(browser.sourceCommitScope, "compiled C/WASM engine and generated engine assets");
assert.equal(browser.repositoryHead, commit);
const buildInfo = fs.readFileSync(path.join(ROOT, "dist/sdk/zeq-build-info.js"), "utf8");
assert.ok(buildInfo.includes(`sourceCommit: "${browser.sourceCommit}"`), "compiled build identity differs from its manifest");
const browserSources = [
  "build-web.sh", "build-sdk-docs.py", "web/machine.html", "web/machine-bootstrap.js",
  "web/machine-catalogue.js", "web/machine-page.js", "web/machine-engine-1.js", "web/machine-engine-2.js",
  "web/machine-runtime-1.js", "web/machine-runtime-2.js", "web/shell.html", "web/sdk.html", "web/zeq.css", "web/zeq.js",
  "web/zeq-machine.js", "web/zeq-room.js", "web/zeq-capsule-worker.js", "sdk/zeq-time-table.js",
  "sdk/zeq-physics-table.js", "sdk/zeq-game-sdk.js", "sdk/zeq-security.js",
  "sdk/zeq-capsule.js", "sdk/zeq-content.js", "sdk/zeq-pixel.js"
];
const browserTree = crypto.createHash("sha256");
for (const file of browserSources) {
  browserTree.update(Buffer.from(file + "\0"));
  browserTree.update(fs.readFileSync(path.join(ROOT, file)));
  browserTree.update(Buffer.from("\0"));
}
assert.equal(browser.browserSourceTreeSha256, browserTree.digest("hex"), "browser working-tree identity is stale");
const browserPaths = verifyArtifacts(browser, path.join(ROOT, "dist"));
for (const required of ["index.html", "machine-bootstrap.js", "machine-catalogue.js", "machine-page.js", "machine-engine-1.js", "machine-engine-2.js", "machine-runtime-1.js", "machine-runtime-2.js", "game.html", "sdk.html", "doomgeneric.js", "doomgeneric.wasm", "doomgeneric.data", "zeq.js", "zeq-machine.js", "zeq-room.js", "sdk/zeq-build-info.js", "projects/11-collaborative-cad-engineering/README.md", "projects/11-collaborative-cad-engineering/reference/zeq-design-steps.js", "projects/11-collaborative-cad-engineering/src/zeq_design_steps.cpp", "projects/11-collaborative-cad-engineering/evidence/portable-result.json", "projects/12-audio-daw-plugins/README.md", "projects/12-audio-daw-plugins/reference/zeq-audio-phase.js", "projects/12-audio-daw-plugins/src/zeq_audio_phase.cpp", "projects/12-audio-daw-plugins/evidence/portable-result.json", "projects/13-video-vfx-caches/README.md", "projects/13-video-vfx-caches/reference/zeq_particle_cache.py", "projects/13-video-vfx-caches/src/zeq_particle_cache.cpp", "projects/13-video-vfx-caches/evidence/portable-result.json", "projects/13-video-vfx-caches/evidence/process-result.json"])
  assert.ok(browserPaths.has(required), `missing browser artifact: ${required}`);
const actualBrowserFiles = fs.readdirSync(path.join(ROOT, "dist"), { recursive: true })
  .filter(file => fs.statSync(path.join(ROOT, "dist", file)).isFile())
  .map(file => file.split(path.sep).join("/"))
  .filter(file => file !== "zeq-release-manifest.json");
assert.deepEqual(actualBrowserFiles.sort(), [...browserPaths].sort(), "stale or unlisted browser artifact");

const native = readManifest(path.join(ROOT, "doomgeneric/build-headless/zeq-release-manifest.json"));
assert.equal(native.target, "doomgeneric-native-headless");
assert.equal(native.sourceCommit, browser.sourceCommit, "native and browser executables must retain their actual compiled engine identity");
const nativePaths = verifyArtifacts(native, ROOT);
assert.deepEqual([...nativePaths].sort(), ["doomgeneric/doom1.wad", "doomgeneric/doomgeneric-headless"]);

console.log(JSON.stringify({
  ok: true,
  format: "zeq-release-manifest-v1",
  repositoryHead: commit,
  compiledEngineSourceCommit: browser.sourceCommit,
  browserSourceTreeSha256: browser.browserSourceTreeSha256,
  browserArtifacts: browser.artifacts.length,
  browserWasmSha256: browser.artifacts.find(file => file.path === "doomgeneric.wasm").sha256,
  nativeEngineSha256: native.artifacts.find(file => file.path === "doomgeneric/doomgeneric-headless").sha256,
  staleBrowserArtifacts: 0
}, null, 2));
