"use strict";
const assert = require("node:assert/strict");
const L = require("../zeq-lifecycle.js");
const S = require("../zeq-security.js");
(async () => {
  const owner = await S.createSigner("owner"), nextOwner = await S.createSigner("next-owner"), attester = await S.createSigner("attester");
  const content = new TextEncoder().encode("portable-test-plugin-v1"), contentSha256 = await S.sha256(content);
  const descriptor = { format: L.DESCRIPTOR, id: "example.plugin", version: "1", content_sha256: contentSha256, compatibility: "test-host-v1", execution: "data-only", sandbox: null, requested_capabilities: ["state:read", "input:write"] };
  const lifecycle = L.createLifecycle({ compatibility: "test-host-v1" });
  let state = await lifecycle.install(descriptor, owner, { grant: ["state:read"], verifyContent: async expected => expected === await S.sha256(content) });
  assert.equal(state.enabled, false);
  assert.deepEqual(state.grants, ["state:read"]);
  assert.equal(lifecycle.authorize(descriptor.id, "state:read"), false);
  await assert.rejects(() => lifecycle.install(descriptor, owner, { verifyContent: async () => true }), /already/);
  state = await lifecycle.transition(descriptor.id, "enable", owner);
  assert.equal(state.enabled, true);
  assert.equal(lifecycle.authorize(descriptor.id, "state:read"), true);
  assert.equal(lifecycle.authorize(descriptor.id, "input:write"), false);
  const host = { read: () => 42, input: () => "changed" };
  const scoped = L.scopedHost(lifecycle, descriptor.id, host, { read: "state:read", input: "input:write" });
  assert.equal(scoped.read(), 42);
  assert.throws(() => scoped.input(), /denied/);
  const content2 = new TextEncoder().encode("portable-test-plugin-v2"), content2Sha256 = await S.sha256(content2);
  state = await lifecycle.transition(descriptor.id, "update", owner, {
    descriptor: { ...descriptor, version: "2", content_sha256: content2Sha256 }, grant: ["state:read", "input:write"], verifyContent: async expected => expected === content2Sha256
  });
  assert.equal(state.enabled, false);
  assert.equal(state.descriptor.version, "2");
  await lifecycle.transition(descriptor.id, "enable", owner);
  assert.equal(scoped.input(), "changed");
  state = await lifecycle.transition(descriptor.id, "transfer", owner, { newOwner: nextOwner.anchor });
  assert.equal(state.owner.key_id, nextOwner.anchor.key_id);
  await assert.rejects(() => lifecycle.transition(descriptor.id, "disable", owner), /current owner/);
  await lifecycle.transition(descriptor.id, "disable", nextOwner);
  await lifecycle.transition(descriptor.id, "enable", nextOwner);
  await lifecycle.attest(descriptor.id, attester, { format: "zeq-attestation-v1", claim: "public test attestation only", subject_sha256: content2Sha256 });
  const beforeRevoke = lifecycle.exportState(descriptor.id);
  const audited = await L.auditState(beforeRevoke);
  assert.equal(audited.ok, true, audited.why);
  assert.equal(audited.records, 8);
  const invalidTransition = JSON.parse(JSON.stringify(beforeRevoke));
  const previous = invalidTransition.records.at(-1);
  const body = { format: L.FORMAT, application: descriptor.id, action: "enable", sequence: invalidTransition.records.length,
    previous_sha256: previous.record_sha256, descriptor: null, grants: null, actor_key_id: nextOwner.anchor.key_id,
    new_owner: null, attestation: null };
  invalidTransition.records.push({ ...body, record_sha256: await S.sha256(S.canonical(body)),
    signature: await nextOwner.sign(body), signer: nextOwner.anchor });
  invalidTransition.state.sequence++;
  const invalidAudit = await L.auditState(invalidTransition);
  assert.equal(invalidAudit.ok, false);
  assert.equal(invalidAudit.why, "application already enabled");
  const tampered = JSON.parse(JSON.stringify(beforeRevoke)); tampered.records[2].action = "revoke";
  assert.equal((await L.auditState(tampered)).ok, false);
  state = await lifecycle.transition(descriptor.id, "revoke", nextOwner);
  assert.equal(state.revoked, true);
  assert.equal(lifecycle.authorize(descriptor.id, "state:read"), false);
  assert.throws(() => scoped.read(), /denied/);
  await assert.rejects(() => lifecycle.transition(descriptor.id, "enable", nextOwner), /terminal/);
  assert.equal((await L.auditState(lifecycle.exportState(descriptor.id))).ok, true);
  const unsafeDescriptor = { ...descriptor, id: "unsafe.native", content_sha256: "b".repeat(64), execution: "native-unsafe", requested_capabilities: ["state:read"] };
  await lifecycle.install(unsafeDescriptor, owner, { grant: ["state:read"], verifyContent: async () => true });
  await assert.rejects(() => lifecycle.transition(unsafeDescriptor.id, "enable", owner), /not sandboxed/);
  console.log(JSON.stringify({ ok: true, format: L.FORMAT, signedRecords: lifecycle.exportState(descriptor.id).records.length, lifecycleActions: ["install", "enable", "disable", "update", "transfer", "attest", "revoke"], ownershipTransfer: true, defaultCapabilityDenial: true, contentVerificationRequired: true, unsafeNativeRefusedByDefault: true, auditAndTamperRefusal: true, executionClaim: "none; host sandbox/process boundary remains required" }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
