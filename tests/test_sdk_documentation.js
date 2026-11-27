"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "web/sdk.html"), "utf8");
const release = fs.existsSync(path.join(ROOT, "dist/sdk.html"))
  ? fs.readFileSync(path.join(ROOT, "dist/sdk.html"), "utf8") : source;
assert.equal(release, source, "generated documentation portal is stale");

const ids = [...release.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "duplicate HTML id");
const documents = [...release.matchAll(/<article class="doc(?: overview)?"[^>]*data-doc="([^"]+)"/g)].map(match => match[1]);
assert.equal(documents.length, 26);
for (const required of ["overview", "developer-manual", "integration", "module-handbook", "portable-profiles", "support-matrix", "release-evidence", "final-audit", "source", "project-08", "project-09", "project-10", "project-11", "project-12", "project-13"])
  assert.ok(documents.includes(required), `missing documentation article: ${required}`);

const searchText = release.match(/<script id="search-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(searchText, "search index missing");
const search = JSON.parse(searchText[1]);
assert.equal(search.length, documents.length);
assert.deepEqual(new Set(search.map(item => item.id)), new Set(documents));

const hrefs = [...release.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
assert.ok(!hrefs.some(href => href.includes("github.com")), "portal must not depend on GitHub documentation links");
const sourceFiles = hrefs.filter(href => /^(?:sdk|projects)\//.test(href));
assert.ok(sourceFiles.length >= 200, "complete local source inventory missing");
for (const href of sourceFiles) {
  const clean = decodeURIComponent(href.split("#")[0]);
  assert.ok(!clean.includes("..") && !clean.startsWith("/"), `unsafe source link: ${clean}`);
  assert.ok(fs.existsSync(path.join(ROOT, "dist", clean)), `broken same-origin source link: ${clean}`);
}
for (const phrase of [
  "Production release gate", "Commercial packaging checklist", "ZEQC3 encrypted saves",
  "Canonical state and replay", "Source + test browser", "zeq-rts-lockstep-v1",
  "zeq-digital-twin-coupled-v1", "f0ba83b21e13de796f78be7b1e3792dcc0c9085ea81f5fd3337b136fe781811c",
  "zeq-order-book-v1", "6b986ae5862d50634803d3dd7cf555c1579236f09f101679867f208eb16c62b6",
  "not an exchange", "zeq-design-steps-v1", "f5233146fcbeb0788102ce3e6e84ad6a1415e979b3d5eb213d5d2f9a95482b49",
  "not a production CAD application", "zeq-audio-phase-v1",
  "7091200063c9fab21decff5152820532716342b15ee2572c30a67a125e3c27b7", "not a compiled VST3",
  "zeq-particle-cache-v1", "a34e66cf3cfe53dd493b974c2a5f8447cfc5a746742fdeabddd3ad38480a1675",
  "not a compiled Houdini", "No renderer, video codec", "fourteen scoped lanes are tested and six remain queued"
])
  assert.ok(release.includes(phrase), `missing documentation content: ${phrase}`);

const scripts = [...release.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.ok(scripts.length >= 1);
for (const script of scripts) new vm.Script(script, { filename: "sdk.html inline script" });

const machine = fs.readFileSync(path.join(ROOT, "web/machine.html"), "utf8");
const embeddedMatch = machine.match(/<script id="zeq-page" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(embeddedMatch, "embedded machine template placeholder missing");
assert.equal(embeddedMatch[1], "", "machine payload should be supplied by its ordered asset loader");
const assetContext = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, "web/machine-page.js"), "utf8"), assetContext, { filename: "machine-page.js" });
const embedded = JSON.parse(assetContext.ZEQ_MACHINE_CHUNKS["zeq-page:0"]);
assert.ok(embedded.includes("14 TESTED / 6 QUEUED"));
assert.ok(embedded.includes('href="sdk.html#project-10"'));
assert.ok(embedded.includes('href="sdk.html#project-11"'));
assert.ok(embedded.includes('href="sdk.html#project-12"'));
assert.ok(embedded.includes('href="sdk.html#project-13"'));
assert.equal((embedded.match(/class="is-tested"/g) || []).length, 14);

console.log(JSON.stringify({
  ok: true,
  documents: documents.length,
  uniqueHtmlIds: ids.length,
  sameOriginSourceLinks: sourceFiles.length,
  githubDocumentationDependencies: 0,
  inlineScriptsParse: true,
  embeddedMachineJsonValid: true,
  generatedPortalCurrent: true
}, null, 2));
