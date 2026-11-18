/* ZEQ security and evidence formats / Phase 3.
 * Canonical JSON, Ed25519-signed event-v2 logs, proof-v2 verification,
 * and replay verification through an explicit host replay adapter.
 * Private keys remain in the host crypto implementation and are never exported.
 */
(function (global) {
"use strict";

const nodeCrypto = typeof module !== "undefined" && module.exports ? require("node:crypto") : null;
const SCOPE = "Integrity of this local event chain only; not proof of competitive legitimacy.";
const ZERO_HASH = "0".repeat(64);
const encoder = new TextEncoder();

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new TypeError("canonical numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.some((key) => value[key] === undefined)) throw new TypeError("undefined is not canonical");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw new TypeError("unsupported canonical value");
}

function bytesHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function hexBytes(hex) {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new TypeError("invalid hex");
  return new Uint8Array(hex.match(/.{2}/g).map((s) => parseInt(s, 16)));
}
function bytesBase64(bytes) {
  if (nodeCrypto) return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function base64Bytes(text) {
  if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new TypeError("non-canonical base64");
  if (nodeCrypto) return new Uint8Array(Buffer.from(text, "base64"));
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function sha256(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  if (nodeCrypto) return nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  return bytesHex(new Uint8Array(await global.crypto.subtle.digest("SHA-256", bytes)));
}

async function createSigner(machineZid) {
  let privateKey;
  let publicKey;
  let publicRaw;
  if (nodeCrypto) {
    const pair = nodeCrypto.generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    publicRaw = new Uint8Array(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  } else {
    const pair = await global.crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    publicRaw = new Uint8Array(await global.crypto.subtle.exportKey("raw", publicKey));
  }
  const keyId = await sha256(publicRaw);
  const anchor = Object.freeze({
    format: "zeq-trust-anchor-v1",
    machine_zid: String(machineZid || `local-${keyId.slice(0, 32)}`),
    key_id: keyId,
    algorithm: "Ed25519",
    public_key: bytesBase64(publicRaw),
    trust: "self-declared"
  });
  return Object.freeze({
    anchor,
    async sign(value) {
      const data = encoder.encode(canonical(value));
      if (nodeCrypto) return bytesBase64(nodeCrypto.sign(null, data, privateKey));
      return bytesBase64(new Uint8Array(await global.crypto.subtle.sign({ name: "Ed25519" }, privateKey, data)));
    }
  });
}

async function verifySignature(anchor, body, signature) {
  if (!anchor || anchor.format !== "zeq-trust-anchor-v1" || anchor.algorithm !== "Ed25519") return false;
  if (await sha256(base64Bytes(anchor.public_key)) !== anchor.key_id) return false;
  const data = encoder.encode(canonical(body));
  const sig = base64Bytes(signature);
  const raw = base64Bytes(anchor.public_key);
  if (nodeCrypto) {
    const key = nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    return nodeCrypto.verify(null, data, key, sig);
  }
  const key = await global.crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  return global.crypto.subtle.verify({ name: "Ed25519" }, key, sig, data);
}

function recordBody(record) {
  const { record_sha256, signature, ...body } = record;
  return body;
}
async function hashRecordBody(body) { return sha256(canonical(body)); }

async function appendRecord(records, signer, fields) {
  if (!records || !signer) throw new TypeError("signed log is not initialized");
  const previous = records.length ? records[records.length - 1].record_sha256 : null;
  const body = {
    format: "zeq-event-v2",
    session_id: String(fields.session_id),
    sequence: records.length,
    run_id: String(fields.run_id),
    gametic: String(fields.gametic),
    zeqond: String(fields.zeqond),
    phase64: String(fields.phase64),
    ruleset: String(fields.ruleset),
    kind: String(fields.kind),
    payload: fields.payload || {},
    previous_record_sha256: previous
  };
  const record = { ...body, record_sha256: await hashRecordBody(body), signature: await signer.sign(body) };
  records.push(record);
  return record;
}

async function verifyRecords(records, anchor, options = {}) {
  if (!Array.isArray(records)) return { ok: false, at: 0, why: "events are not an array" };
  let previous = null;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    try {
      if (!record || record.format !== "zeq-event-v2" || record.sequence !== i) return { ok: false, at: i, why: "schema or sequence failure" };
      if (record.previous_record_sha256 !== previous) return { ok: false, at: i, why: "chain link broken" };
      const body = recordBody(record);
      if (canonical(body) !== canonical(recordBody(JSON.parse(canonical(body))))) throw new Error("non-canonical record");
      if (await hashRecordBody(body) !== record.record_sha256) return { ok: false, at: i, why: "record hash mismatch" };
      if (!await verifySignature(anchor, body, record.signature)) return { ok: false, at: i, why: "signature mismatch" };
      previous = record.record_sha256;
    } catch (error) { return { ok: false, at: i, why: error.message }; }
  }
  return {
    ok: true,
    count: records.length,
    tip: previous,
    trusted: !!(options.trustedKeyIds && options.trustedKeyIds.includes(anchor.key_id)),
    trust: options.trustedKeyIds && options.trustedKeyIds.includes(anchor.key_id) ? "explicitly-trusted" : "self-consistent-only"
  };
}

function validateReplayShape(replay) {
  if (!replay || !["not-run", "match", "mismatch", "unavailable"].includes(replay.status)) return "invalid replay status";
  if (replay.status === "match") {
    if (replay.mode !== "headless" || !/^[0-9a-f]{64}$/.test(replay.input_sha256 || "")) return "match lacks headless identity or input digest";
    if (!Number.isSafeInteger(replay.compared_checkpoints) || replay.compared_checkpoints <= 0) return "match lacks compared checkpoints";
  }
  return null;
}

async function verifyProof(proof, options = {}) {
  try {
    if (!proof || proof.format !== "zeq-proof-v2" || !proof.run || proof.run.format !== "zeq-run-v1") return { ok: false, why: "unsupported proof" };
    if (!Array.isArray(proof.events) || !proof.signer || !Array.isArray(proof.state_hashes)) return { ok: false, why: "incomplete proof" };
    const eventResult = await verifyRecords(proof.events, proof.signer, options);
    if (!eventResult.ok) return { ...eventResult, replay: "unavailable" };
    if (proof.chain_head_sha256 !== eventResult.tip) return { ok: false, why: "proof chain head mismatch", replay: "unavailable" };
    const shapeError = validateReplayShape(proof.replay);
    if (shapeError) return { ok: false, why: shapeError, replay: "unavailable" };
    const inputDigest = proof.input_records_or_digest;
    if (proof.replay.status === "match" && inputDigest && typeof inputDigest === "object" && inputDigest.sha256 !== proof.replay.input_sha256) return { ok: false, why: "input digest mismatch", replay: "unavailable" };
    let replay = proof.replay.status;
    if (proof.replay.status === "match") {
      if (!options.replayAdapter) return { ok: false, why: "recorded match requires independent reproduction", replay: "unavailable" };
      const actual = await options.replayAdapter(proof);
      if (!actual || actual.status !== "match") return { ok: false, why: "replay did not reproduce", replay: actual && actual.status || "mismatch" };
      const expected = JSON.stringify(proof.state_hashes);
      if (JSON.stringify(actual.state_hashes) !== expected) return { ok: false, why: "replayed state hashes differ", replay: "mismatch" };
      if (actual.compared_checkpoints !== proof.replay.compared_checkpoints) return { ok: false, why: "checkpoint count differs", replay: "mismatch" };
      replay = "match";
    }
    return { ok: true, count: eventResult.count, tip: eventResult.tip, trusted: eventResult.trusted, trust: eventResult.trust, replay, scope: SCOPE };
  } catch (error) { return { ok: false, why: error.message, replay: "unavailable" }; }
}

async function createProof(options) {
  const records = [];
  const run = options.run;
  const sessionId = options.sessionId;
  for (const event of options.events || []) await appendRecord(records, options.signer, { ...event, run_id: run.run_id, session_id: sessionId });
  return {
    format: "zeq-proof-v2",
    run,
    session_id: sessionId,
    created_zeqond: String(options.createdZeqond || "0"),
    events: records,
    input_records_or_digest: options.inputRecordsOrDigest || { status: "unavailable" },
    state_hashes: options.stateHashes || [],
    checkpoint_interval: String(options.checkpointInterval || "0"),
    chain_head_sha256: records.length ? records[records.length - 1].record_sha256 : null,
    attestations: options.attestations || [],
    replay: options.replay || { status: "unavailable", reason: "No headless Doom reproduction was performed." },
    signer: options.signer.anchor,
    scope: SCOPE
  };
}

async function selfTest() {
  const failures = [];
  try {
    const signer = await createSigner("test-machine");
    const run = { format: "zeq-run-v1", run_id: "0123456789abcdef0123456789abcdef", engine_commit: "0".repeat(40), engine_build_sha256: "0".repeat(64), wad_sha256: "0".repeat(64), ruleset: "zeq-physics-v1", compatibility: "0", tick_rate: "35", initial_rng: "0", settings_sha256: "0".repeat(64), time_origin: { kind: "doom-tic", gametic: "0" } };
    const proof = await createProof({ signer, run, sessionId: "test-session", events: [{ gametic: "0", zeqond: "0", phase64: "0", ruleset: "zeq-physics-v1", kind: "session-open", payload: {} }, { gametic: "1", zeqond: "0", phase64: "1", ruleset: "zeq-physics-v1", kind: "engine-diagnostic", payload: { ok: true } }] });
    if (!(await verifyProof(proof)).ok) failures.push("clean signed proof");
    const tampered = JSON.parse(JSON.stringify(proof));
    tampered.events[1].payload.ok = false;
    if ((await verifyProof(tampered)).ok) failures.push("tampered signed proof");
    const wrongAnchor = await createSigner("other-machine");
    const wrong = { ...proof, signer: wrongAnchor.anchor };
    if ((await verifyProof(wrong)).ok) failures.push("wrong trust anchor");
    const trusted = await verifyProof(proof, { trustedKeyIds: [proof.signer.key_id] });
    if (!trusted.ok || !trusted.trusted) failures.push("explicit trust");
    const missing = { ...proof, replay: { status: "match", mode: "headless", input_sha256: "0".repeat(64), compared_checkpoints: 1 } };
    const unavailable = await verifyProof(missing);
    if (unavailable.ok || unavailable.replay !== "unavailable") failures.push("unreproduced match refusal");
    const replayProof = { ...proof, state_hashes: [{ gametic: "1", state_sha256: "1".repeat(64) }], input_records_or_digest: { sha256: "0".repeat(64) }, replay: { status: "match", mode: "headless", input_sha256: "0".repeat(64), compared_checkpoints: 1 } };
    const replayed = await verifyProof(replayProof, { replayAdapter: async (p) => ({ status: "match", state_hashes: p.state_hashes, compared_checkpoints: 1 }) });
    if (!replayed.ok || replayed.replay !== "match") failures.push("adapter replay match");
    const mismatch = await verifyProof(replayProof, { replayAdapter: async () => ({ status: "match", state_hashes: [], compared_checkpoints: 1 }) });
    if (mismatch.ok || mismatch.replay !== "mismatch") failures.push("replay mismatch detection");
  } catch (error) { failures.push(error.message); }
  return { ok: failures.length === 0, count: 8, failures };
}

const api = { SCOPE, ZERO_HASH, canonical, sha256, bytesHex, hexBytes, bytesBase64, base64Bytes, createSigner, verifySignature, hashRecordBody, appendRecord, verifyRecords, createProof, verifyProof, selfTest };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqSecurity = api;
})(typeof window !== "undefined" ? window : globalThis);
