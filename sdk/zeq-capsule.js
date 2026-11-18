/* ZEQC3 Doom save capsules. scrypt N=2^17,r=8,p=1 + AES-256-GCM.
 * Browser KDF work runs in a Worker. No PIN is persisted or included in output.
 */
(function (global) {
"use strict";
const nodeCrypto = typeof module !== "undefined" && module.exports ? require("node:crypto") : null;
const security = nodeCrypto ? require("./zeq-security.js") : global.ZeqSecurity;
const MAGIC = new Uint8Array([90, 69, 81, 67, 51]); // ZEQC3
const HITE = new TextEncoder().encode("HULYAS.HITE.f=1.287Hz.tau=0.777s");
const N = 131072, R = 8, P = 1, DKLEN = 32, MAX_BYTES = 16 * 1024 * 1024;
const ZEQC3_TEST_VECTOR = "WkVRQzMAAQIDBAUGBwgJCgsMDQ4PZGVmZ2hpamtsbW5va82utfpiXXys92lo2qtSTg4AZN+krGX5n2l/IbigfbT1ImPVm1iiLNjmWYDeEY5+xh1IeUqBY4gF818dgWCYqBtGNDz7cPOPrJirauCZ58SMTOCoNV7tCtqigp+8AsQ0FhdpVllC2BlWZO93y2ITAIXx2LSHYGyuJQUUJqJ/4V4TnqpT0Mn1IUq7/89jG+4+RuyohCHNcj36DPcWUIqPdsz5b7D+rcQglqZ4LJMazdqPXHYbUxnkDdF48bI7bA79ivFCxPplVOIFg7DEZwDAYEDGZoWfhElAbtkBDfEj5rP+y5U4LpGZCfFGbhPH7Q6uVxHpCrnQTgYrj7wA0k4ZMyv/YrPDUyLdqQXilJ1brDCK3xytWOWXoFmSpXiXOPTK6MOkq33h8V0eChGYvQk6fLezisPl0r8=";
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = nodeCrypto ? nodeCrypto.webcrypto.subtle : global.crypto.subtle;

function concat(...arrays) { const length = arrays.reduce((n, a) => n + a.length, 0); const out = new Uint8Array(length); let at = 0; for (const a of arrays) { out.set(a, at); at += a.length; } return out; }
function equalBytes(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; }
function randomBytes(length, fixture) {
  if (fixture) return Uint8Array.from(fixture);
  const out = new Uint8Array(length);
  (nodeCrypto ? nodeCrypto.webcrypto : global.crypto).getRandomValues(out);
  return out;
}
function weakPin(pin) {
  if (typeof pin !== "string") return "PIN must contain at least eight characters";
  const characters = Array.from(pin);
  if (characters.length < 8) return "PIN must contain at least eight characters";
  if (/^\d+$/.test(pin)) return "PIN must not contain digits alone";
  if (new Set(characters).size < 4) return "PIN must contain at least four distinct characters";
  return null;
}
async function pbkdf2(password, salt, length) {
  const key = await subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, key, length * 8));
}
function salsaBlock(block) {
  const x = Uint32Array.from(block);
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= ((x[0] + x[12]) << 7) | ((x[0] + x[12]) >>> 25); x[8] ^= ((x[4] + x[0]) << 9) | ((x[4] + x[0]) >>> 23); x[12] ^= ((x[8] + x[4]) << 13) | ((x[8] + x[4]) >>> 19); x[0] ^= ((x[12] + x[8]) << 18) | ((x[12] + x[8]) >>> 14);
    x[9] ^= ((x[5] + x[1]) << 7) | ((x[5] + x[1]) >>> 25); x[13] ^= ((x[9] + x[5]) << 9) | ((x[9] + x[5]) >>> 23); x[1] ^= ((x[13] + x[9]) << 13) | ((x[13] + x[9]) >>> 19); x[5] ^= ((x[1] + x[13]) << 18) | ((x[1] + x[13]) >>> 14);
    x[14] ^= ((x[10] + x[6]) << 7) | ((x[10] + x[6]) >>> 25); x[2] ^= ((x[14] + x[10]) << 9) | ((x[14] + x[10]) >>> 23); x[6] ^= ((x[2] + x[14]) << 13) | ((x[2] + x[14]) >>> 19); x[10] ^= ((x[6] + x[2]) << 18) | ((x[6] + x[2]) >>> 14);
    x[3] ^= ((x[15] + x[11]) << 7) | ((x[15] + x[11]) >>> 25); x[7] ^= ((x[3] + x[15]) << 9) | ((x[3] + x[15]) >>> 23); x[11] ^= ((x[7] + x[3]) << 13) | ((x[7] + x[3]) >>> 19); x[15] ^= ((x[11] + x[7]) << 18) | ((x[11] + x[7]) >>> 14);
    x[1] ^= ((x[0] + x[3]) << 7) | ((x[0] + x[3]) >>> 25); x[2] ^= ((x[1] + x[0]) << 9) | ((x[1] + x[0]) >>> 23); x[3] ^= ((x[2] + x[1]) << 13) | ((x[2] + x[1]) >>> 19); x[0] ^= ((x[3] + x[2]) << 18) | ((x[3] + x[2]) >>> 14);
    x[6] ^= ((x[5] + x[4]) << 7) | ((x[5] + x[4]) >>> 25); x[7] ^= ((x[6] + x[5]) << 9) | ((x[6] + x[5]) >>> 23); x[4] ^= ((x[7] + x[6]) << 13) | ((x[7] + x[6]) >>> 19); x[5] ^= ((x[4] + x[7]) << 18) | ((x[4] + x[7]) >>> 14);
    x[11] ^= ((x[10] + x[9]) << 7) | ((x[10] + x[9]) >>> 25); x[8] ^= ((x[11] + x[10]) << 9) | ((x[11] + x[10]) >>> 23); x[9] ^= ((x[8] + x[11]) << 13) | ((x[8] + x[11]) >>> 19); x[10] ^= ((x[9] + x[8]) << 18) | ((x[9] + x[8]) >>> 14);
    x[12] ^= ((x[15] + x[14]) << 7) | ((x[15] + x[14]) >>> 25); x[13] ^= ((x[12] + x[15]) << 9) | ((x[12] + x[15]) >>> 23); x[14] ^= ((x[13] + x[12]) << 13) | ((x[13] + x[12]) >>> 19); x[15] ^= ((x[14] + x[13]) << 18) | ((x[14] + x[13]) >>> 14);
  }
  for (let i = 0; i < 16; i++) block[i] = (block[i] + x[i]) >>> 0;
}
function blockMix(b, r) {
  const x = Uint32Array.from(b.subarray((2 * r - 1) * 16, 2 * r * 16));
  const out = new Uint32Array(b.length);
  const mixed = new Uint32Array(16);
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) mixed[j] = x[j] ^ b[i * 16 + j];
    salsaBlock(mixed);
    x.set(mixed);
    const target = (i & 1) ? ((i >> 1) + r) * 16 : (i >> 1) * 16;
    out.set(mixed, target);
  }
  return out;
}
function integerify(x, r) {
  const at = (2 * r - 1) * 16;
  // N is 2^17, so only the low 32-bit limb contributes. Avoiding a
  // 64-bit Number here is required: IEEE-754 would discard those low bits.
  return x[at] & (N - 1);
}
async function scryptBrowser(pin, salt) {
  const initial = await pbkdf2(enc.encode(pin), salt, 128 * R * P);
  const b = new Uint32Array(initial.buffer, initial.byteOffset, initial.byteLength / 4);
  const x = new Uint32Array(32 * R);
  const v = new Uint32Array(N * 32 * R);
  for (let i = 0; i < N; i++) {
    if (i === 0) x.set(b); else x.set(blockMix(x, R));
    v.set(x, i * x.length);
  }
  // RFC 7914 ROMix stores V[i] = X and then advances X on every iteration,
  // including the final one. The loop above stores V; this is the Nth advance.
  x.set(blockMix(x, R));
  for (let i = 0; i < N; i++) {
    const j = integerify(x, R);
    const offset = j * x.length;
    for (let k = 0; k < x.length; k++) x[k] ^= v[offset + k];
    x.set(blockMix(x, R));
  }
  b.set(x);
  v.fill(0); x.fill(0);
  return pbkdf2(enc.encode(pin), new Uint8Array(b.buffer, b.byteOffset, b.byteLength), DKLEN);
}
async function deriveKey(pin, salt) {
  const salted = concat(HITE, salt);
  if (nodeCrypto) return new Uint8Array(nodeCrypto.scryptSync(pin, salted, DKLEN, { N, r: R, p: P, maxmem: N * R * 128 * 2 }));
  return scryptBrowser(pin, salted);
}
async function aesEncrypt(key, iv, plaintext, aad) {
  const cryptoKey = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  return new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, cryptoKey, plaintext));
}
async function aesDecrypt(key, iv, ciphertext, aad) {
  const cryptoKey = await subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, cryptoKey, ciphertext));
}
function validatePlaintext(plain) {
  if (!plain || plain.format !== "zeq-doom-save-v1" || plain.save_encoding !== "doom-save-le-v1") throw new Error("unsupported save plaintext");
  const bytes = security.base64Bytes(plain.save_data);
  if (plain.save_bytes !== String(bytes.length) || bytes.length > MAX_BYTES || security.bytesBase64(bytes) !== plain.save_data) throw new Error("save length or encoding mismatch");
  if (!plain.zeq_state || typeof plain.zeq_state !== "object") throw new Error("missing Zeq state");
  return bytes;
}
async function seal(saveBytes, pin, fields, options = {}) {
  const weak = weakPin(pin);
  if (weak) throw new Error(weak);
  if (!(saveBytes instanceof Uint8Array) || !saveBytes.length || saveBytes.length > MAX_BYTES) throw new Error("invalid Doom save size");
  const salt = randomBytes(16, options.salt), iv = randomBytes(12, options.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error("invalid salt or IV");
  const plain = {
    format: "zeq-doom-save-v1",
    run: fields.run,
    machine_zid: String(fields.machineZid),
    created_zeqond: String(fields.createdZeqond),
    created_phase64: String(fields.createdPhase64),
    save_encoding: "doom-save-le-v1",
    save_bytes: String(saveBytes.length),
    save_data: security.bytesBase64(saveBytes),
    zeq_state: fields.zeqState
  };
  const key = await deriveKey(pin, salt);
  try {
    const sealed = await aesEncrypt(key, iv, enc.encode(security.canonical(plain)), concat(MAGIC, salt));
    return concat(MAGIC, salt, iv, sealed);
  } finally { key.fill(0); }
}
async function open(blob, pin) {
  try {
    if (!(blob instanceof Uint8Array) || typeof pin !== "string" || blob.length < 49 || blob.length > MAX_BYTES + 4096) throw new Error("invalid capsule");
    if (!equalBytes(blob.subarray(0, 5), MAGIC)) throw new Error("unsupported capsule version");
    const salt = blob.subarray(5, 21), iv = blob.subarray(21, 33), ciphertext = blob.subarray(33);
    const key = await deriveKey(pin, salt);
    let decrypted;
    try { decrypted = await aesDecrypt(key, iv, ciphertext, concat(MAGIC, salt)); }
    finally { key.fill(0); }
    const plain = JSON.parse(dec.decode(decrypted));
    if (security.canonical(plain) !== dec.decode(decrypted)) throw new Error("non-canonical plaintext");
    return { bytes: validatePlaintext(plain), plaintext: plain, current: true };
  } catch (_) { throw new Error("Capsule could not be opened"); }
}
function isZeqc3(blob) { return blob instanceof Uint8Array && blob.length >= 49 && equalBytes(blob.subarray(0, 5), MAGIC); }
async function selfTest() {
  const failures = [];
  try {
    if (!weakPin("short") || !weakPin("12345678") || !weakPin("aaaaaaaa") || !weakPin("😀😁😂😃") || weakPin("correct-horse-9")) failures.push("PIN policy");
    const save = new Uint8Array([0, 1, 2, 3, 255]);
    const fields = { run: { format: "zeq-run-v1", run_id: "0123456789abcdef0123456789abcdef" }, machineZid: "test-machine", createdZeqond: "7", createdPhase64: "99", zeqState: { ruleset: 1, cooldowns: [0, 20] } };
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i), iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);
    const blob = await seal(save, "correct-horse-9", fields, { salt, iv });
    if (security.bytesBase64(blob) !== ZEQC3_TEST_VECTOR) failures.push("independent Python vector");
    const opened = await open(blob, "correct-horse-9");
    if (!equalBytes(opened.bytes, save) || !opened.current || opened.plaintext.zeq_state.ruleset !== 1) failures.push("roundtrip");
    for (const [name, mutate, pin] of [["wrong PIN", (b) => b, "wrong-horse-9"], ["tamper", (b) => { b[b.length - 1] ^= 1; return b; }, "correct-horse-9"], ["truncation", (b) => b.subarray(0, b.length - 1), "correct-horse-9"], ["version", (b) => { b[4] = 50; return b; }, "correct-horse-9"]]) {
      let refused = false; try { await open(Uint8Array.from(mutate(Uint8Array.from(blob))), pin); } catch (_) { refused = true; }
      if (!refused) failures.push(name);
    }
  } catch (error) { failures.push(error.message); }
  return { ok: failures.length === 0, count: 9, failures };
}
const api = { MAGIC, HITE, N, R, P, DKLEN, MAX_BYTES, weakPin, deriveKey, seal, open, isZeqc3, selfTest };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqCapsule = api;
})(typeof self !== "undefined" ? self : globalThis);
