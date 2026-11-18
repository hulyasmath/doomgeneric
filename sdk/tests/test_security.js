"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const security = require("../zeq-security.js");
const capsule = require("../zeq-capsule.js");
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "../vectors/zeq-security-v1.json"), "utf8"));

(async () => {
  const securityResult = await security.selfTest();
  assert.equal(securityResult.ok, true, JSON.stringify(securityResult.failures));
  const fields = {
    run: vectors.plaintext.run, machineZid: vectors.plaintext.machine_zid,
    createdZeqond: vectors.plaintext.created_zeqond, createdPhase64: vectors.plaintext.created_phase64,
    zeqState: vectors.plaintext.zeq_state
  };
  const sealed = await capsule.seal(security.base64Bytes(vectors.plaintext.save_data), vectors.pin, fields, {
    salt: security.hexBytes(vectors.salt), iv: security.hexBytes(vectors.iv)
  });
  assert.equal(security.bytesBase64(sealed), vectors.capsule, "independent Python ZEQC3 vector");
  const opened = await capsule.open(security.base64Bytes(vectors.capsule), vectors.pin);
  assert.deepEqual([...opened.bytes], [...security.base64Bytes(vectors.plaintext.save_data)]);
  assert.equal(security.canonical(opened.plaintext), security.canonical(vectors.plaintext));
  const rfc = vectors.ed25519_rfc8032_test1;
  const key = require("node:crypto").createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(rfc.seed, "hex")]), format: "der", type: "pkcs8" });
  const signature = require("node:crypto").sign(null, Buffer.alloc(0), key);
  assert.equal(signature.toString("hex"), rfc.signature);
  const capsuleResult = await capsule.selfTest();
  assert.equal(capsuleResult.ok, true, JSON.stringify(capsuleResult.failures));
  console.log(`JavaScript OK: signed proof/replay ${securityResult.count} + ZEQC3 ${capsuleResult.count} checks; independent Python vector and RFC 8032 OK`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
