/* Phase 5 signed mods and expiring sealed parcels.
 * Signatures prove key possession, not safety. Mods require explicit publisher
 * trust before file verification can authorize a later engine load. Parcels
 * are data only: this module never executes or loads their plaintext.
 */
(function (global) {
"use strict";

const nodeCrypto = typeof module !== "undefined" && module.exports ? require("node:crypto") : null;
const nodeZlib = nodeCrypto ? require("node:zlib") : null;
const security = nodeCrypto ? require("./zeq-security.js") : global.ZeqSecurity;
const encoder = new TextEncoder();
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MOD_FILES = 1024;
const MAX_MOD_FILE_BYTES = 64 * 1024 * 1024;
const MAX_MOD_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_PARCEL_BYTES = 1024 * 1024;
const MAX_INBOX_PARCELS = 1000;
const MAX_INBOX_BYTES = 64 * 1024 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RULESETS = new Set(["doom-vanilla-v1", "zeq-physics-v1", "zeq-arcade-legacy-v1"]);
const X25519_SPKI_PREFIX = "302a300506032b656e032100";

function failure(why) { return { ok: false, why: String(why) }; }
function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function byteLength(value) { return encoder.encode(security.canonical(value)).length; }
function uintString(value, maximum) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed <= BigInt(maximum);
}
function validName(value) { return typeof value === "string" && NAME.test(value) && value.normalize("NFC") === value; }
function validId(value) { return typeof value === "string" && ID.test(value); }
function validPath(path) {
  if (typeof path !== "string" || !path || path.length > 1024 || path.normalize("NFC") !== path) return false;
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}
function copyBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("content must be Uint8Array");
  return new Uint8Array(bytes);
}
function rawPublic(key, kind) {
  if (nodeCrypto) return new Uint8Array(key.export({ type: "spki", format: "der" }).subarray(-32));
  return global.crypto.subtle.exportKey("raw", key);
}
function publicKey(raw) {
  const bytes = copyBytes(raw);
  if (bytes.length !== 32) throw new TypeError("X25519 public key must be 32 bytes");
  if (nodeCrypto) return nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from(X25519_SPKI_PREFIX, "hex"), bytes]), format: "der", type: "spki" });
  return global.crypto.subtle.importKey("raw", bytes, { name: "X25519" }, false, []);
}
function allZero(bytes) { return bytes.every((byte) => byte === 0); }

async function createIdentity(machineZid) {
  if (!validId(machineZid)) throw new TypeError("invalid machine ZID");
  const signer = await security.createSigner(machineZid);
  let privateKey;
  let publicRaw;
  if (nodeCrypto) {
    const pair = nodeCrypto.generateKeyPairSync("x25519");
    privateKey = pair.privateKey;
    publicRaw = await rawPublic(pair.publicKey);
  } else {
    const pair = await global.crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    privateKey = pair.privateKey;
    publicRaw = new Uint8Array(await global.crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const body = {
    format: "zeq-machine-genesis-v1",
    machine_zid: machineZid,
    signer: signer.anchor,
    x25519_public_key: security.bytesBase64(publicRaw)
  };
  const record = { ...body, signature: await signer.sign(body) };
  /* Host-only private key object. Never serialize the identity itself. */
  return { record, signer, x25519PrivateKey: privateKey };
}

async function verifyIdentity(record, options = {}) {
  try {
    if (!isObject(record) || record.format !== "zeq-machine-genesis-v1") return failure("unsupported machine record");
    if (!validId(record.machine_zid) || !isObject(record.signer)) return failure("invalid machine identity");
    if (record.signer.machine_zid !== record.machine_zid) return failure("machine signer mismatch");
    const xkey = security.base64Bytes(record.x25519_public_key);
    if (xkey.length !== 32 || allZero(xkey)) return failure("invalid X25519 key");
    const { signature, ...body } = record;
    if (!await security.verifySignature(record.signer, body, signature)) return failure("machine signature mismatch");
    const trusted = Array.isArray(options.trustedKeyIds) && options.trustedKeyIds.includes(record.signer.key_id);
    return { ok: true, trusted, trust: trusted ? "explicitly-trusted" : "self-consistent-only" };
  } catch (error) { return failure(error.message); }
}

async function signMod(options) {
  if (!options || !options.signer || !Array.isArray(options.files)) throw new TypeError("signer and files are required");
  if (!validId(options.modId) || !validId(options.modVersion) || !validName(options.name)) throw new TypeError("invalid mod identity");
  if (!validId(options.engineApi || "doomgeneric-zeq-v1")) throw new TypeError("invalid engine API");
  const rulesets = options.rulesets || ["zeq-physics-v1"];
  if (!Array.isArray(rulesets) || !rulesets.length || rulesets.some((r) => !RULESETS.has(r))) throw new TypeError("invalid rulesets");
  if (options.files.length > MAX_MOD_FILES) throw new TypeError("too many mod files");
  const files = [];
  let total = 0;
  const paths = new Set();
  for (const entry of options.files) {
    if (!isObject(entry) || !validPath(entry.path) || paths.has(entry.path)) throw new TypeError("invalid or duplicate mod path");
    paths.add(entry.path);
    const bytes = copyBytes(entry.bytes);
    if (bytes.length > MAX_MOD_FILE_BYTES) throw new TypeError("mod file too large");
    total += bytes.length;
    if (total > MAX_MOD_TOTAL_BYTES) throw new TypeError("mod content too large");
    files.push({ path: entry.path, sha256: await security.sha256(bytes), bytes: String(bytes.length) });
  }
  const body = {
    format: "zeq-mod-manifest-v1",
    mod_id: options.modId,
    mod_version: options.modVersion,
    name: options.name,
    engine_api: options.engineApi || "doomgeneric-zeq-v1",
    rulesets: [...rulesets],
    dependencies: options.dependencies || [],
    files,
    signer_zid: options.signer.anchor.machine_zid,
    signer_public_key: options.signer.anchor.public_key
  };
  const manifest = { ...body, signature: await options.signer.sign(body) };
  if (byteLength(manifest) > MAX_MANIFEST_BYTES) throw new TypeError("manifest too large");
  return manifest;
}

async function verifyManifest(manifest, options = {}) {
  try {
    if (!isObject(manifest) || manifest.format !== "zeq-mod-manifest-v1") return failure("unsupported mod manifest");
    if (byteLength(manifest) > MAX_MANIFEST_BYTES) return failure("manifest too large");
    if (!validId(manifest.mod_id) || !validId(manifest.mod_version) || !validName(manifest.name)) return failure("invalid mod identity");
    if (!validId(manifest.engine_api) || !validId(manifest.signer_zid)) return failure("invalid engine or signer identity");
    if (!Array.isArray(manifest.rulesets) || !manifest.rulesets.length || manifest.rulesets.some((r) => !RULESETS.has(r))) return failure("invalid rulesets");
    if (!Array.isArray(manifest.dependencies) || !Array.isArray(manifest.files) || manifest.files.length > MAX_MOD_FILES) return failure("invalid mod lists");
    const paths = new Set();
    let total = 0;
    for (const file of manifest.files) {
      if (!isObject(file) || !validPath(file.path) || paths.has(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256)) return failure("invalid or duplicate file record");
      if (!uintString(file.bytes, MAX_MOD_FILE_BYTES)) return failure("invalid file size");
      paths.add(file.path);
      total += Number(file.bytes);
      if (total > MAX_MOD_TOTAL_BYTES) return failure("mod content too large");
    }
    const publicRaw = security.base64Bytes(manifest.signer_public_key);
    if (publicRaw.length !== 32) return failure("invalid signer key");
    const keyId = await security.sha256(publicRaw);
    const anchor = { format: "zeq-trust-anchor-v1", machine_zid: manifest.signer_zid, key_id: keyId, algorithm: "Ed25519", public_key: manifest.signer_public_key, trust: "self-declared" };
    const { signature, ...body } = manifest;
    if (!await security.verifySignature(anchor, body, signature)) return failure("mod signature mismatch");
    const trusted = Array.isArray(options.trustedKeyIds) && options.trustedKeyIds.includes(keyId);
    return { ok: true, key_id: keyId, authorized: trusted, trusted, trust: trusted ? "explicitly-trusted" : "self-consistent-only" };
  } catch (error) { return failure(error.message); }
}

async function verifyModFiles(manifest, content, options = {}) {
  const verdict = await verifyManifest(manifest, options);
  if (!verdict.ok) return verdict;
  if (!verdict.authorized) return failure("publisher is not explicitly trusted");
  try {
    if (!Array.isArray(content) || content.length !== manifest.files.length) return failure("mod file count mismatch");
    const byPath = new Map();
    for (const entry of content) {
      if (!isObject(entry) || !validPath(entry.path) || byPath.has(entry.path) || !(entry.bytes instanceof Uint8Array)) return failure("invalid or duplicate content");
      byPath.set(entry.path, copyBytes(entry.bytes));
    }
    for (const file of manifest.files) {
      const bytes = byPath.get(file.path);
      if (!bytes || String(bytes.length) !== file.bytes) return failure("mod file size mismatch");
      if (await security.sha256(bytes) !== file.sha256) return failure("mod file digest mismatch");
    }
    return { ok: true, authorized: true, key_id: verdict.key_id, files: manifest.files.map((file) => file.path) };
  } catch (error) { return failure(error.message); }
}

/* Bounded PK3/ZIP reader. Only stored and deflated regular files are accepted.
 * Central-directory sizes are policy limits, not permission to allocate without
 * checking actual inflater output. No path is ever opened on the host filesystem.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipView(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("PK3 content must be Uint8Array");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function zipString(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function inflateBounded(compressed, expected, maximum) {
  if (nodeZlib) {
    const output = nodeZlib.inflateRawSync(compressed, {
      maxOutputLength: Math.min(maximum, expected) + 1,
      finishFlush: nodeZlib.constants.Z_SYNC_FLUSH
    });
    if (output.length !== expected) throw new RangeError("PK3 uncompressed size mismatch");
    return new Uint8Array(output);
  }
  if (typeof DecompressionStream === "undefined") throw new TypeError("deflated PK3 requires DecompressionStream");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected || total > maximum) throw new RangeError("PK3 output exceeds declared or configured bounds");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  if (total !== expected) throw new RangeError("PK3 uncompressed size mismatch");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function readPk3(packageBytes, options = {}) {
  try {
    const bytes = copyBytes(packageBytes);
    const maxFiles = options.maxFiles ?? MAX_MOD_FILES;
    const maxFileBytes = options.maxFileBytes ?? MAX_MOD_FILE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? MAX_MOD_TOTAL_BYTES;
    if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_MOD_FILES
      || !Number.isInteger(maxFileBytes) || maxFileBytes < 0 || maxFileBytes > MAX_MOD_FILE_BYTES
      || !Number.isInteger(maxTotalBytes) || maxTotalBytes < 0 || maxTotalBytes > MAX_MOD_TOTAL_BYTES) return failure("invalid PK3 limits");
    if (bytes.length < 22 || bytes.length > MAX_MOD_TOTAL_BYTES) return failure("invalid PK3 package size");
    const view = zipView(bytes);
    let eocd = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0 || eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length) return failure("invalid or ambiguous PK3 end record");
    if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) return failure("multi-disk PK3 refused");
    const count = view.getUint16(eocd + 10, true);
    if (count !== view.getUint16(eocd + 8, true) || count < 1 || count > maxFiles) return failure("PK3 entry count outside bounds");
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (directoryOffset > eocd || directorySize > eocd - directoryOffset
      || directoryOffset + directorySize !== eocd) return failure("PK3 central directory outside bounds");
    const records = [];
    const paths = new Set(), folded = new Set();
    let cursor = directoryOffset, total = 0;
    for (let index = 0; index < count; index++) {
      if (cursor > eocd - 46 || view.getUint32(cursor, true) !== 0x02014b50) return failure("malformed PK3 central entry");
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true), compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true), disk = view.getUint16(cursor + 34, true);
      const external = view.getUint32(cursor + 38, true), localOffset = view.getUint32(cursor + 42, true);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > eocd || disk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
        || localOffset === 0xffffffff || (flags & ~0x0808) !== 0 || (method !== 0 && method !== 8)
        || (external & 0x10) !== 0 || uncompressedSize > maxFileBytes) return failure("unsupported or oversized PK3 entry");
      const path = zipString(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      const fold = path.toLowerCase();
      const fileType = (external >>> 16) & 0xf000;
      if (!validPath(path) || paths.has(path) || folded.has(fold) || /\.(?:pk3|zip)$/i.test(path)
        || (fileType !== 0 && fileType !== 0x8000)) return failure("unsafe, nested, non-regular, duplicate, or ambiguous PK3 path");
      paths.add(path); folded.add(fold);
      total += uncompressedSize;
      if (total > maxTotalBytes) return failure("PK3 uncompressed content exceeds total bound");
      records.push({ path, flags, method, crc, compressedSize, uncompressedSize, localOffset });
      cursor = next;
    }
    if (cursor !== eocd) return failure("PK3 central directory length mismatch");
    const files = new Map();
    for (const record of records) {
      const p = record.localOffset;
      if (p > directoryOffset - 30 || view.getUint32(p, true) !== 0x04034b50) return failure("PK3 local header outside data region");
      const flags = view.getUint16(p + 6, true), method = view.getUint16(p + 8, true);
      const nameLength = view.getUint16(p + 26, true), extraLength = view.getUint16(p + 28, true);
      const start = p + 30 + nameLength + extraLength;
      if (flags !== record.flags || method !== record.method || start > directoryOffset
        || record.compressedSize > directoryOffset - start
        || zipString(bytes.subarray(p + 30, p + 30 + nameLength)) !== record.path) return failure("PK3 local/central entry mismatch");
      if (record.method === 0 && record.compressedSize !== record.uncompressedSize) return failure("stored PK3 size mismatch");
      const compressed = bytes.subarray(start, start + record.compressedSize);
      const output = record.method === 0 ? new Uint8Array(compressed)
        : await inflateBounded(compressed, record.uncompressedSize, maxFileBytes);
      if (crc32(output) !== record.crc) return failure("PK3 CRC-32 mismatch");
      files.set(record.path, output);
    }
    return { ok: true, format: "zeq-pk3-v1", files, paths: records.map(record => record.path), totalBytes: total };
  } catch (error) { return failure(error.message); }
}

async function verifyModPackage(manifest, packageBytes, options = {}) {
  const unpacked = await readPk3(packageBytes, options);
  if (!unpacked.ok) return unpacked;
  const content = unpacked.paths.map(path => ({ path, bytes: unpacked.files.get(path) }));
  const verdict = await verifyModFiles(manifest, content, options);
  if (!verdict.ok) return verdict;
  const byPath = new Map(content.map(entry => [entry.path, entry.bytes]));
  return { ...verdict, format: "zeq-pk3-v1", loadOrder: manifest.files.map(file => file.path),
    orderedFiles: manifest.files.map((file, index) => ({ path: file.path, sha256: file.sha256,
      bytes: byPath.get(file.path), order: index })) };
}

async function deriveParcelKey(shared, ephRaw, recipientRaw) {
  if (allZero(shared)) throw new TypeError("small-order or all-zero X25519 secret");
  const salt = encoder.encode("zeq-e2ee-v1");
  const info = new Uint8Array(64);
  info.set(ephRaw, 0);
  info.set(recipientRaw, 32);
  if (nodeCrypto) return new Uint8Array(nodeCrypto.hkdfSync("sha256", shared, salt, info, 32));
  const hkdf = await global.crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return global.crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function x25519(privateKey, publicRaw) {
  const peer = await publicKey(publicRaw);
  let shared;
  if (nodeCrypto) shared = new Uint8Array(nodeCrypto.diffieHellman({ privateKey, publicKey: peer }));
  else shared = new Uint8Array(await global.crypto.subtle.deriveBits({ name: "X25519", public: peer }, privateKey, 256));
  if (allZero(shared)) throw new TypeError("small-order or all-zero X25519 secret");
  return shared;
}

async function encryptParcel(plaintext, key, nonce, aad) {
  if (nodeCrypto) {
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const ct = new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()]));
    return { ct, tag: new Uint8Array(cipher.getAuthTag()) };
  }
  const sealed = new Uint8Array(await global.crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, plaintext));
  return { ct: sealed.slice(0, -16), tag: sealed.slice(-16) };
}

async function decryptParcel(ct, tag, key, nonce, aad) {
  if (nodeCrypto) {
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad, { plaintextLength: ct.length });
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
  }
  const sealed = new Uint8Array(ct.length + 16);
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);
  return new Uint8Array(await global.crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, sealed));
}

function parcelHeader(parcel) {
  return { expires_zeqond: parcel.expires_zeqond, from: parcel.from.machine_zid, name: parcel.name, to: parcel.to };
}
function parcelAad(box, header) {
  return encoder.encode(`box:v1|${box.eph_pub}|${box.zeqond}|${security.canonical(header)}`);
}

async function sealParcel(options) {
  if (!isObject(options) || !options.signer || !(options.plaintext instanceof Uint8Array)) throw new TypeError("signer and plaintext are required");
  const sender = await verifyIdentity(options.from);
  const recipient = await verifyIdentity(options.to);
  if (!sender.ok || sender.trusted === undefined || !recipient.ok) throw new TypeError("invalid machine record");
  if (options.from.machine_zid !== options.signer.anchor.machine_zid) throw new TypeError("sender signer mismatch");
  if (!validName(options.name)) throw new TypeError("invalid parcel name");
  const plaintext = copyBytes(options.plaintext);
  if (plaintext.length > MAX_PARCEL_BYTES) throw new TypeError("parcel too large");
  const expires = String(options.expiresZeqond);
  const zeqond = String(options.zeqond);
  if (!uintString(expires, "18446744073709551615") || !uintString(zeqond, "18446744073709551615") || BigInt(expires) < BigInt(zeqond)) throw new TypeError("invalid parcel expiry");
  const recipientRaw = security.base64Bytes(options.to.x25519_public_key);
  let ephPrivate;
  let ephRaw;
  if (options.ephemeralPrivateKey) {
    ephPrivate = options.ephemeralPrivateKey;
    ephRaw = await rawPublic(nodeCrypto ? nodeCrypto.createPublicKey(ephPrivate) : (() => { throw new TypeError("browser test keys require generated ephemeral pair"); })());
  } else if (nodeCrypto) {
    const pair = nodeCrypto.generateKeyPairSync("x25519");
    ephPrivate = pair.privateKey;
    ephRaw = await rawPublic(pair.publicKey);
  } else {
    const pair = await global.crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    ephPrivate = pair.privateKey;
    ephRaw = new Uint8Array(await global.crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const nonce = options.nonce ? copyBytes(options.nonce) : nodeCrypto ? new Uint8Array(nodeCrypto.randomBytes(12)) : global.crypto.getRandomValues(new Uint8Array(12));
  if (nonce.length !== 12) throw new TypeError("parcel nonce must be 12 bytes");
  const ephPub = security.bytesBase64(ephRaw);
  const header = { expires_zeqond: expires, from: options.from.machine_zid, name: options.name, to: options.to.machine_zid };
  const boxBase = { eph_pub: ephPub, nonce: security.bytesBase64(nonce), zeqond };
  const shared = await x25519(ephPrivate, recipientRaw);
  const key = await deriveParcelKey(shared, ephRaw, recipientRaw);
  const encrypted = await encryptParcel(plaintext, key, nonce, parcelAad(boxBase, header));
  const box = { ...boxBase, tag: security.bytesBase64(encrypted.tag), ct: security.bytesBase64(encrypted.ct), header };
  const body = { format: "ZEQ-PARCEL-v2", from: options.from, to: options.to.machine_zid, name: options.name, bytes: String(plaintext.length), expires_zeqond: expires, box };
  const parcel = { ...body, signature: await options.signer.sign(body) };
  return { parcel, parcel_id: await security.sha256(security.canonical(parcel)) };
}

function createInbox() {
  const records = new Map();
  let total = 0;
  function prune(now) {
    for (const [key, record] of records) {
      if (BigInt(record.expires) < BigInt(now)) {
        total -= record.bytes;
        records.delete(key);
      }
    }
  }
  return {
    get count() { return records.size; },
    get bytes() { return total; },
    inspect(recipient, id, expires, now, serializedBytes) {
      prune(String(now));
      const key = `${recipient}:${id}`;
      if (records.has(key)) return failure("parcel replay refused");
      if (!Number.isSafeInteger(serializedBytes) || serializedBytes < 0) return failure("invalid parcel size");
      if (records.size >= MAX_INBOX_PARCELS || total + serializedBytes > MAX_INBOX_BYTES) return failure("parcel inbox limit");
      return { ok: true, key };
    },
    commit(reservation, id, expires, serializedBytes) {
      if (!reservation || records.has(reservation.key)) return false;
      records.set(reservation.key, { id, expires: String(expires), bytes: serializedBytes });
      total += serializedBytes;
      return true;
    }
  };
}

async function openParcel(parcel, options) {
  try {
    if (!isObject(parcel) || parcel.format !== "ZEQ-PARCEL-v2" || !isObject(options) || !options.recipient || !options.inbox) return failure("incomplete parcel open request");
    if (!uintString(options.nowZeqond, "18446744073709551615")) return failure("invalid recipient tick");
    const recipientRecord = options.recipient.record;
    const recipientIdentity = await verifyIdentity(recipientRecord);
    if (!recipientIdentity.ok) return recipientIdentity;
    if (parcel.to !== recipientRecord.machine_zid) return failure("wrong parcel recipient");
    const sender = await verifyIdentity(parcel.from, options);
    if (!sender.ok) return sender;
    const { signature, ...body } = parcel;
    if (!await security.verifySignature(parcel.from.signer, body, signature)) return failure("parcel signature mismatch");
    if (!validName(parcel.name) || !uintString(parcel.bytes, MAX_PARCEL_BYTES) || !uintString(parcel.expires_zeqond, "18446744073709551615")) return failure("invalid parcel fields");
    const box = parcel.box;
    if (!isObject(box) || !uintString(box.zeqond, "18446744073709551615")) return failure("invalid parcel box");
    const now = BigInt(options.nowZeqond);
    const sealedAt = BigInt(box.zeqond);
    const expires = BigInt(parcel.expires_zeqond);
    if (expires < sealedAt) return failure("expiry precedes sealing");
    if (expires < now) return failure("parcel expired");
    if (sealedAt > now + 64n) return failure("parcel sealing tick is too far ahead");
    const header = parcelHeader(parcel);
    if (security.canonical(box.header) !== security.canonical(header)) return failure("parcel header mismatch");
    const ephRaw = security.base64Bytes(box.eph_pub);
    const nonce = security.base64Bytes(box.nonce);
    const tag = security.base64Bytes(box.tag);
    const ct = security.base64Bytes(box.ct);
    if (ephRaw.length !== 32 || allZero(ephRaw) || nonce.length !== 12 || tag.length !== 16 || String(ct.length) !== parcel.bytes) return failure("invalid parcel encoding");
    const id = await security.sha256(security.canonical(parcel));
    const serializedBytes = byteLength(parcel);
    const reservation = options.inbox.inspect(parcel.to, id, parcel.expires_zeqond, options.nowZeqond, serializedBytes);
    if (!reservation.ok) return reservation;
    const recipientRaw = security.base64Bytes(recipientRecord.x25519_public_key);
    const shared = await x25519(options.recipient.x25519PrivateKey, ephRaw);
    const key = await deriveParcelKey(shared, ephRaw, recipientRaw);
    const plaintext = await decryptParcel(ct, tag, key, nonce, parcelAad({ eph_pub: box.eph_pub, zeqond: box.zeqond }, header));
    if (plaintext.length !== Number(parcel.bytes)) return failure("parcel plaintext size mismatch");
    if (!options.inbox.commit(reservation, id, parcel.expires_zeqond, serializedBytes)) return failure("parcel replay refused");
    return { ok: true, parcel_id: id, plaintext, trusted: sender.trusted, trust: sender.trust, replay: "recorded" };
  } catch (error) { return failure(`parcel authentication failed: ${error.message}`); }
}

async function selfTest() {
  const failures = [];
  const check = (condition, name) => { if (!condition) failures.push(name); };
  try {
    const sender = await createIdentity("phase5-sender");
    const recipient = await createIdentity("phase5-recipient");
    const wrongRecipient = await createIdentity("phase5-wrong-recipient");
    const wad = new TextEncoder().encode("PWAD\0\0\0\0\0\0\0\0");
    const manifest = await signMod({ signer: sender.signer, modId: "phase5-test", modVersion: "1.0.0", name: "Phase 5 test", files: [{ path: "maps/test.wad", bytes: wad }] });
    const trusted = await verifyManifest(manifest, { trustedKeyIds: [sender.signer.anchor.key_id] });
    check(trusted.ok && trusted.authorized, "trusted signed mod");
    const unsignedTrust = await verifyManifest(manifest);
    check(unsignedTrust.ok && !unsignedTrust.authorized, "signature without trust is not authorization");
    check((await verifyModFiles(manifest, [{ path: "maps/test.wad", bytes: wad }], { trustedKeyIds: [sender.signer.anchor.key_id] })).ok, "bound mod file digest");
    const changed = JSON.parse(JSON.stringify(manifest));
    changed.files[0].sha256 = "0".repeat(64);
    check(!(await verifyManifest(changed, { trustedKeyIds: [sender.signer.anchor.key_id] })).ok, "modified manifest refused");
    const escaped = await signMod({ signer: sender.signer, modId: "phase5-test", modVersion: "1.0.0", name: "Phase 5 test", files: [{ path: "maps/test.wad", bytes: wad }] });
    escaped.files[0].path = "../escape.wad";
    check(!(await verifyManifest(escaped, { trustedKeyIds: [sender.signer.anchor.key_id] })).ok, "path traversal refused");

    const sealed = await sealParcel({ from: sender.record, signer: sender.signer, to: recipient.record, name: "Phase 5 parcel", plaintext: wad, zeqond: "100", expiresZeqond: "200" });
    const inbox = createInbox();
    const opened = await openParcel(sealed.parcel, { recipient, inbox, nowZeqond: "120", trustedKeyIds: [sender.signer.anchor.key_id] });
    check(opened.ok && security.canonical([...opened.plaintext]) === security.canonical([...wad]) && opened.trusted, "sealed parcel round trip");
    check((await openParcel(sealed.parcel, { recipient, inbox, nowZeqond: "121" })).why === "parcel replay refused", "parcel replay refused");
    check(!(await openParcel(sealed.parcel, { recipient, inbox: createInbox(), nowZeqond: "201" })).ok, "expired parcel refused");
    check(!(await openParcel(sealed.parcel, { recipient, inbox: createInbox(), nowZeqond: "35" })).ok, "future parcel refused");
    const wrong = await openParcel(sealed.parcel, { recipient: wrongRecipient, inbox: createInbox(), nowZeqond: "120" });
    check(!wrong.ok, "wrong recipient refused");
    const tampered = JSON.parse(JSON.stringify(sealed.parcel));
    tampered.box.header.name = "Modified parcel";
    check(!(await openParcel(tampered, { recipient, inbox: createInbox(), nowZeqond: "120" })).ok, "modified authenticated header refused");
    const modified = JSON.parse(JSON.stringify(sealed.parcel));
    const ct = security.base64Bytes(modified.box.ct);
    ct[0] ^= 1;
    modified.box.ct = security.bytesBase64(ct);
    check(!(await openParcel(modified, { recipient, inbox: createInbox(), nowZeqond: "120" })).ok, "ciphertext modification refused");
  } catch (error) { failures.push(error.message); }
  return { ok: failures.length === 0, count: 12, failures };
}

const api = {
  MAX_MANIFEST_BYTES, MAX_MOD_FILES, MAX_MOD_FILE_BYTES, MAX_MOD_TOTAL_BYTES,
  MAX_PARCEL_BYTES, MAX_INBOX_PARCELS, MAX_INBOX_BYTES,
  validPath, createIdentity, verifyIdentity, signMod, verifyManifest, verifyModFiles,
  readPk3, verifyModPackage, sealParcel, openParcel, createInbox, selfTest
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else global.ZeqContent = api;
})(typeof window !== "undefined" ? window : globalThis);
