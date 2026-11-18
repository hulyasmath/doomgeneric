"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const security = require("../zeq-security.js");
const content = require("../zeq-content.js");
const vector = JSON.parse(fs.readFileSync(path.join(__dirname, "../vectors/zeq-content-v1.json"), "utf8"));

function privateKey(seed, oid) {
  return crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from(`302e020100300506032b65${oid}04220420`, "hex"), Buffer.from(seed, "hex")]),
    format: "der", type: "pkcs8"
  });
}
function publicRaw(privateKeyObject) {
  return new Uint8Array(crypto.createPublicKey(privateKeyObject).export({ type: "spki", format: "der" }).subarray(-32));
}
function testIdentity(zid, edSeed, xSeed) {
  const ed = privateKey(edSeed, "70");
  const publicKey = publicRaw(ed);
  const anchor = {
    format: "zeq-trust-anchor-v1", machine_zid: zid,
    key_id: security.sha256 ? "" : "", algorithm: "Ed25519",
    public_key: security.bytesBase64(publicKey), trust: "self-declared"
  };
  anchor.key_id = crypto.createHash("sha256").update(publicKey).digest("hex");
  const body = {
    format: "zeq-machine-genesis-v1", machine_zid: zid, signer: anchor,
    x25519_public_key: security.bytesBase64(publicRaw(privateKey(xSeed, "6e")))
  };
  const record = { ...body, signature: security.bytesBase64(crypto.sign(null, Buffer.from(security.canonical(body)), ed)) };
  return {
    record,
    signer: { anchor, async sign(value) { return security.bytesBase64(crypto.sign(null, Buffer.from(security.canonical(value)), ed)); } },
    x25519PrivateKey: privateKey(xSeed, "6e")
  };
}

(async () => {
  const result = await content.selfTest();
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  const sender = testIdentity("vector-sender", vector.sender_seed, vector.sender_x25519_seed);
  const recipient = testIdentity("vector-recipient", vector.recipient_seed, vector.recipient_x25519_seed);
  assert.equal(security.canonical(sender.record), security.canonical(vector.sender));
  assert.equal(security.canonical(recipient.record), security.canonical(vector.recipient));
  const sealed = await content.sealParcel({
    from: sender.record, signer: sender.signer, to: recipient.record,
    name: "Vector parcel", plaintext: security.base64Bytes(vector.plaintext),
    zeqond: "100", expiresZeqond: "200",
    ephemeralPrivateKey: privateKey(vector.ephemeral_x25519_seed, "6e"),
    nonce: security.hexBytes(vector.nonce)
  });
  assert.equal(security.canonical(sealed.parcel), security.canonical(vector.parcel));
  assert.equal(sealed.parcel_id, vector.parcel_id);
  const opened = await content.openParcel(vector.parcel, {
    recipient, inbox: content.createInbox(), nowZeqond: "120",
    trustedKeyIds: [sender.signer.anchor.key_id]
  });
  assert.equal(opened.ok, true, opened.why);
  assert.equal(security.bytesBase64(opened.plaintext), vector.plaintext);
  assert.equal(opened.trusted, true);

  const badTag = JSON.parse(JSON.stringify(vector.parcel));
  const tag = security.base64Bytes(badTag.box.tag);
  tag[0] ^= 1;
  badTag.box.tag = security.bytesBase64(tag);
  assert.equal((await content.openParcel(badTag, { recipient, inbox: content.createInbox(), nowZeqond: "120" })).ok, false);
  const replayInbox = content.createInbox();
  assert.equal((await content.openParcel(vector.parcel, { recipient, inbox: replayInbox, nowZeqond: "120" })).ok, true);
  assert.equal((await content.openParcel(vector.parcel, { recipient, inbox: replayInbox, nowZeqond: "120" })).why, "parcel replay refused");
  assert.equal(replayInbox.count, 1);
  assert.ok(replayInbox.bytes > 0);

  console.log(`JavaScript OK: Phase 5 ${result.count} checks + independent Python parcel vector + tag/replay refusal`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
