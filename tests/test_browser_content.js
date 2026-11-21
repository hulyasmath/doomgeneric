"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
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

function markerWad(marker = MARKER, payload = PAYLOAD) {
  const bytes = Buffer.alloc(12 + payload.length + 16);
  bytes.write("PWAD", 0, "ascii");
  bytes.writeUInt32LE(1, 4);
  bytes.writeUInt32LE(12 + payload.length, 8);
  Buffer.from(payload).copy(bytes, 12);
  bytes.writeUInt32LE(12, 12 + payload.length);
  bytes.writeUInt32LE(payload.length, 16 + payload.length);
  bytes.write(marker, 20 + payload.length, "ascii");
  return new Uint8Array(bytes);
}

function makePk3(entries) {
  const table = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], central = []; let offset = 0;
  for (const entry of entries) {
    const path = Buffer.from(entry.path), plain = Buffer.from(entry.bytes);
    const compressed = entry.deflate ? zlib.deflateRawSync(plain) : plain;
    const method = entry.deflate ? 8 : 0, crc = crc32(plain);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(plain.length, 22); local.writeUInt16LE(path.length, 26);
    const record = Buffer.concat([local, path, compressed]);
    const center = Buffer.alloc(46); center.writeUInt32LE(0x02014b50); center.writeUInt16LE(20, 4);
    center.writeUInt16LE(20, 6); center.writeUInt16LE(method, 10); center.writeUInt32LE(crc, 16);
    center.writeUInt32LE(compressed.length, 20); center.writeUInt32LE(plain.length, 24);
    center.writeUInt16LE(path.length, 28); center.writeUInt32LE(offset, 42);
    locals.push(record); central.push(Buffer.concat([center, path])); offset += record.length;
  }
  const body = Buffer.concat(locals), directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, directory, end]));
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

  // A malformed later PWAD must be found during whole-batch validation, before
  // the valid first PWAD is handed to Doom. This is not an engine rollback claim.
  const pk3a = markerWad("ZEQ5P3A", new TextEncoder().encode("ORDER-A"));
  const pk3b = markerWad("ZEQ5P3B", new TextEncoder().encode("ORDER-B"));
  const malformedB = new Uint8Array(pk3b); new DataView(malformedB.buffer).setUint32(8, 0xfffffff0, true);
  const invalidBatchManifest = await Content.signMod({ signer, modId: "phase5-pk3-invalid-batch", modVersion: "1.0.0",
    name: "Invalid batch", engineApi: "doomgeneric-zeq-v1", rulesets: ["zeq-physics-v1"],
    files: [{ path: "mods/a.wad", bytes: pk3a }, { path: "mods/b.wad", bytes: malformedB }] });
  const invalidBatch = await page.evaluate(async ({ manifest, bytes, keyId }) =>
    ZeqDiagnostics.loadSignedMod(manifest, new Uint8Array(bytes), keyId, { pk3: true }),
    { manifest: invalidBatchManifest, bytes: [...makePk3([{ path: "mods/b.wad", bytes: malformedB, deflate: true }, { path: "mods/a.wad", bytes: pk3a }])], keyId: signer.anchor.key_id });
  assert.equal(invalidBatch.ok, false);
  assert.equal(invalidBatch.evidence.stage, "engine-validation");
  assert.equal(invalidBatch.evidence.fileIndex, 1);
  assert.equal(invalidBatch.evidence.engineLumpCount, originalEngineLumps + 1);
  assert.equal(await page.evaluate(() => ZeqDiagnostics.contentLumpPresent("ZEQ5P3A")), -1);

  const pk3Manifest = await Content.signMod({ signer, modId: "phase5-pk3-valid", modVersion: "1.0.0",
    name: "Ordered PK3", engineApi: "doomgeneric-zeq-v1", rulesets: ["zeq-physics-v1"],
    files: [{ path: "mods/a.wad", bytes: pk3a }, { path: "mods/b.wad", bytes: pk3b }] });
  const pk3 = makePk3([{ path: "mods/b.wad", bytes: pk3b, deflate: true }, { path: "mods/a.wad", bytes: pk3a }]);
  await page.locator("#mod-manifest").setInputFiles({ name: "signed-pk3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pk3Manifest)) });
  await page.locator("#mod-wad").setInputFiles({ name: "ordered.pk3", mimeType: "application/zip", buffer: Buffer.from(pk3) });
  await page.locator("#load-signed-mod").click();
  await page.waitForFunction(() => document.getElementById("mod-load-status").textContent.startsWith("LOADED"), null, { timeout: 30000 });
  const pk3Loaded = await page.evaluate(() => ZeqDiagnostics.contentEvidence());
  assert.equal(pk3Loaded.packageFormat, "zeq-pk3-v1");
  assert.equal(pk3Loaded.fileCount, 2);
  assert.deepEqual(pk3Loaded.loadOrder.map(file => file.path), ["mods/a.wad", "mods/b.wad"]);
  assert.equal(pk3Loaded.engineLumpCount, originalEngineLumps + 3);
  assert.deepEqual((await page.evaluate(() => ZeqDiagnostics.contentLump("ZEQ5P3A"))).data, [...new TextEncoder().encode("ORDER-A")]);
  assert.deepEqual((await page.evaluate(() => ZeqDiagnostics.contentLump("ZEQ5P3B"))).data, [...new TextEncoder().encode("ORDER-B")]);

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
    engineLumpsBefore: originalEngineLumps, engineLumpsAfter: pk3Loaded.engineLumpCount,
    pk3LoadOrder: pk3Loaded.loadOrder.map(file => file.path), wholeBatchPrevalidation: true,
    refused: ["wrong-trust", "modified-bytes", "incompatible-ruleset", "malformed-wad", "c-digest-mismatch", "duplicate", "malformed-later-pwad-without-partial-load"],
    proofEvents: contentEvents.length, replay: verdict.replay,
    consoleErrors: errors.length, badResponses: badResponses.length
  }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
