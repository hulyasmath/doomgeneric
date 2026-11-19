"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }
const Content = require("../sdk/zeq-content.js");
const Security = require("../sdk/zeq-security.js");

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/";
const MARKER = "ZEQ5TEST";
const PAYLOAD = new TextEncoder().encode("ZEQ-VERIFIED-PWAD-BYTES");

function testSigner() {
  // Fixed public conformance key, never a user or production identity.
  const seed = Buffer.alloc(32, 0x5a);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8"
  });
  const publicRaw = new Uint8Array(crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32));
  const anchor = {
    format: "zeq-trust-anchor-v1", machine_zid: "phase5-engine-test",
    key_id: crypto.createHash("sha256").update(publicRaw).digest("hex"),
    algorithm: "Ed25519", public_key: Security.bytesBase64(publicRaw), trust: "self-declared"
  };
  return {
    anchor,
    async sign(body) {
      return Security.bytesBase64(crypto.sign(null, Buffer.from(Security.canonical(body)), privateKey));
    }
  };
}

function markerWad() {
  const bytes = Buffer.alloc(12 + PAYLOAD.length + 16);
  bytes.write("PWAD", 0, "ascii");
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(12 + PAYLOAD.length, 8);
  Buffer.from(PAYLOAD).copy(bytes, 12);
  bytes.writeUInt32LE(12, 12 + PAYLOAD.length);
  bytes.writeUInt32LE(PAYLOAD.length, 16 + PAYLOAD.length);
  bytes.write(MARKER, 20 + PAYLOAD.length, "ascii");
  return new Uint8Array(bytes);
}

async function signWad(signer, wad, modId, rulesets = ["zeq-physics-v1"]) {
  return Content.signMod({
    signer, modId, modVersion: "1.0.0", name: `Engine ${modId}`,
    engineApi: "doomgeneric-zeq-v1", rulesets,
    files: [{ path: `mods/${modId}.wad`, bytes: wad }]
  });
}

async function diagnosticLoad(page, manifest, wad, keyId) {
  return page.evaluate(async ({ manifest, bytes, keyId }) =>
    ZeqDiagnostics.loadSignedWad(manifest, new Uint8Array(bytes), keyId),
    { manifest, bytes: [...wad], keyId });
}

(async () => {
  const signer = testSigner();
  const wad = markerWad();
  const manifest = await signWad(signer, wad, "phase5-engine-valid");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [], badResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });

  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 3 && ZeqDiagnostics.game()?.gamestate === 0);
  assert.equal(await page.evaluate((name) => ZeqDiagnostics.contentLumpPresent(name), MARKER), -1);

  const wrongTrust = await diagnosticLoad(page, manifest, wad, "0".repeat(64));
  assert.equal(wrongTrust.ok, false);
  assert.equal(wrongTrust.evidence.trusted, false);
  assert.equal(await page.evaluate((name) => ZeqDiagnostics.contentLumpPresent(name), MARKER), -1);

  const modified = new Uint8Array(wad);
  modified[12] ^= 1;
  const changedBytes = await diagnosticLoad(page, manifest, modified, signer.anchor.key_id);
  assert.equal(changedBytes.ok, false);
  assert.equal(changedBytes.evidence.digestVerified, false);
  assert.equal(await page.evaluate((name) => ZeqDiagnostics.contentLumpPresent(name), MARKER), -1);

  const incompatibleManifest = await signWad(signer, wad, "phase5-engine-incompatible", ["doom-vanilla-v1"]);
  const incompatible = await diagnosticLoad(page, incompatibleManifest, wad, signer.anchor.key_id);
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.evidence.trusted, true);
  assert.equal(incompatible.evidence.rulesetCompatible, false);

  const malformed = new Uint8Array(12);
  new TextEncoder().encode("PWAD").forEach((byte, i) => { malformed[i] = byte; });
  new DataView(malformed.buffer).setUint32(4, 1, true);
  new DataView(malformed.buffer).setUint32(8, 0xfffffff0, true);
  const malformedManifest = await signWad(signer, malformed, "phase5-engine-malformed");
  const malformedResult = await diagnosticLoad(page, malformedManifest, malformed, signer.anchor.key_id);
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.evidence.status, 7, JSON.stringify(malformedResult));
  assert.equal(malformedResult.evidence.digestVerified, true);
  const originalEngineLumps = malformedResult.evidence.engineLumpCount;
  assert.ok(originalEngineLumps > 1000);

  // Bypass only the SDK in this negative test: C must independently refuse a
  // trusted request whose expected digest does not match the supplied bytes.
  const cDigestRefusal = await page.evaluate(({ bytes, manifest, keyId }) => {
    const data = new Uint8Array(bytes);
    const pointer = Module._malloc(data.length);
    try {
      HEAPU8.set(data, pointer);
      const result = Module.ccall("ZEQ_LoadVerifiedWad", "number",
        ["number", "number", "string", "string", "string", "string", "number", "number"],
        [pointer, data.length, "0".repeat(64), manifest.mod_id, manifest.mod_version, keyId, 1, 2]);
      return { result, evidence: ZeqDiagnostics.engineContentEvidence() };
    } finally { Module._free(pointer); }
  }, { bytes: [...wad], manifest, keyId: signer.anchor.key_id });
  assert.equal(cDigestRefusal.result, -6);
  assert.equal(cDigestRefusal.evidence.status, 6);
  assert.equal(cDigestRefusal.evidence.digestVerified, false);
  assert.equal(cDigestRefusal.evidence.engineLumpCount, originalEngineLumps);

  // Exercise the visible user control, not only the diagnostics API.
  await page.locator('[data-open="settings-dialog"]').click();
  await page.locator("#mod-manifest").setInputFiles({ name: "signed-mod.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(manifest)) });
  await page.locator("#mod-wad").setInputFiles({ name: "phase5-engine-valid.wad", mimeType: "application/octet-stream", buffer: Buffer.from(wad) });
  await page.locator("#mod-trusted-key").fill(signer.anchor.key_id);
  await page.locator("#load-signed-mod").click();
  await page.waitForFunction(() => document.getElementById("mod-load-status").textContent.startsWith("LOADED"), null, { timeout: 30000 });
  const loaded = await page.evaluate(() => ZeqDiagnostics.contentEvidence());
  assert.equal(loaded.result, "loaded");
  assert.equal(loaded.status, 1);
  assert.equal(loaded.trusted, true);
  assert.equal(loaded.publisherKeyId, signer.anchor.key_id);
  assert.equal(loaded.digestVerified, true);
  assert.equal(loaded.ruleset, "zeq-physics-v1");
  assert.equal(loaded.contentSha256, manifest.files[0].sha256);
  assert.equal(loaded.engineLumpCount, originalEngineLumps + 1);
  assert.ok(await page.evaluate((name) => ZeqDiagnostics.contentLumpPresent(name), MARKER) >= originalEngineLumps);
  const readBack = await page.evaluate((name) => ZeqDiagnostics.contentLump(name), MARKER);
  assert.equal(readBack.ok, true);
  assert.deepEqual(readBack.data, [...PAYLOAD]);
  await page.screenshot({ path: "/mnt/agents/work/zeq-phase5-signed-mod.png", fullPage: true });

  const duplicate = await diagnosticLoad(page, manifest, wad, signer.anchor.key_id);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.evidence.status, 9);
  assert.equal(duplicate.evidence.engineLumpCount, originalEngineLumps + 1);
  assert.deepEqual((await page.evaluate((name) => ZeqDiagnostics.contentLump(name), MARKER)).data, [...PAYLOAD]);

  await page.locator("#settings-dialog [data-close]").click();
  await page.locator('[data-open="ledger-dialog"]').click();
  await page.locator("#verify-ledger").click();
  await page.waitForFunction(() => document.getElementById("ledger-verdict").textContent === "INTEGRITY OK");
  const proof = await page.evaluate(() => ZeqDiagnostics.signedProof());
  const verdict = await page.evaluate((value) => ZeqDiagnostics.verifySignedProof(value), proof);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.replay, "unavailable");
  const contentEvents = proof.events.filter((event) => event.kind === "signed-pwad-load");
  assert.ok(contentEvents.some((event) => event.payload.content.result === "loaded" && event.payload.content.contentSha256 === manifest.files[0].sha256));
  assert.ok(contentEvents.some((event) => event.payload.content.result === "refused"));
  await page.locator("#ledger-dialog [data-close]").click();

  const before = await page.evaluate(() => ZeqDiagnostics.game().gametic);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ZeqDiagnostics.game().gametic);
  assert.ok(after > before, "engine stopped advancing after signed content operations");
  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);

  console.log(JSON.stringify({
    ok: true, signedManifest: manifest.format, publisherTrust: loaded.publisherTrust,
    contentSha256: loaded.contentSha256, markerLump: MARKER, payloadReadBack: true,
    engineLumpsBefore: originalEngineLumps, engineLumpsAfter: loaded.engineLumpCount,
    refused: ["wrong-trust", "modified-bytes", "incompatible-ruleset", "malformed-wad", "c-digest-mismatch", "duplicate"],
    proofEvents: contentEvents.length, replay: verdict.replay,
    consoleErrors: errors.length, badResponses: badResponses.length
  }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
