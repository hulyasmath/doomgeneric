"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { performance } = require("node:perf_hooks");
const Content = require("../zeq-content.js");
const Security = require("../zeq-security.js");

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries, options = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const path = Buffer.from(entry.path, "utf8");
    const plain = Buffer.from(entry.bytes);
    const compressed = entry.method === 8 ? zlib.deflateRawSync(plain, { level: 9 }) : plain;
    const method = entry.method ?? 0, flags = entry.flags ?? 0;
    const crc = crc32(plain);
    const declaredSize = entry.declaredSize ?? plain.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt16LE(flags, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(declaredSize, 22);
    head.writeUInt16LE(path.length, 26);
    const localRecord = Buffer.concat([head, path, compressed]);
    const center = Buffer.alloc(46);
    center.writeUInt32LE(0x02014b50, 0); center.writeUInt16LE(20, 4); center.writeUInt16LE(20, 6);
    center.writeUInt16LE(flags, 8); center.writeUInt16LE(method, 10);
    center.writeUInt32LE(crc, 16); center.writeUInt32LE(compressed.length, 20); center.writeUInt32LE(declaredSize, 24);
    center.writeUInt16LE(path.length, 28); center.writeUInt32LE(entry.external ?? 0, 38); center.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([center, path])); local.push(localRecord); offset += localRecord.length;
  }
  const directory = Buffer.concat(central), body = Buffer.concat(local);
  const end = Buffer.alloc(22 + (options.comment || "").length);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE((options.comment || "").length, 20); end.write(options.comment || "", 22);
  let result = Buffer.concat([body, directory, end]);
  if (options.truncate) result = result.subarray(0, result.length - options.truncate);
  return new Uint8Array(result);
}
function markerWad(marker) {
  const payload = Buffer.from(`verified:${marker}`);
  const bytes = Buffer.alloc(12 + payload.length + 16);
  bytes.write("PWAD", 0); bytes.writeUInt32LE(1, 4); bytes.writeUInt32LE(12 + payload.length, 8);
  payload.copy(bytes, 12); bytes.writeUInt32LE(12, 12 + payload.length);
  bytes.writeUInt32LE(payload.length, 16 + payload.length); bytes.write(marker, 20 + payload.length, "ascii");
  return new Uint8Array(bytes);
}
function testSigner() {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 0x5a)
  ]), format: "der", type: "pkcs8" });
  const publicRaw = new Uint8Array(crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32));
  return { anchor: { format: "zeq-trust-anchor-v1", machine_zid: "pk3-conformance",
    key_id: crypto.createHash("sha256").update(publicRaw).digest("hex"), algorithm: "Ed25519",
    public_key: Security.bytesBase64(publicRaw), trust: "self-declared" },
    async sign(body) { return Security.bytesBase64(crypto.sign(null, Buffer.from(Security.canonical(body)), privateKey)); } };
}
async function refused(bytes, label, options) {
  const result = await Content.readPk3(bytes, options);
  assert.equal(result.ok, false, `${label}: ${JSON.stringify(result)}`);
  assert.equal(typeof result.why, "string");
  return result.why;
}
(async () => {
  const a = markerWad("ZEQ5PK3A"), b = markerWad("ZEQ5PK3B");
  const entries = [{ path: "mods/b.wad", bytes: b }, { path: "mods/a.wad", bytes: a, method: 8 }];
  const packed = zip(entries);
  const unpacked = await Content.readPk3(packed);
  assert.equal(unpacked.ok, true, unpacked.why);
  assert.deepEqual(unpacked.paths, ["mods/b.wad", "mods/a.wad"]); // ZIP order is observation, not load policy.
  assert.deepEqual(unpacked.files.get("mods/a.wad"), a);
  assert.deepEqual(unpacked.files.get("mods/b.wad"), b);

  const signer = testSigner();
  const manifest = await Content.signMod({ signer: signer, modId: "pk3-ordered", modVersion: "1.0.0",
    name: "Ordered PK3", files: [{ path: "mods/a.wad", bytes: a }, { path: "mods/b.wad", bytes: b }] });
  const verified = await Content.verifyModPackage(manifest, packed, { trustedKeyIds: [signer.anchor.key_id], maxFiles: 16 });
  assert.equal(verified.ok, true, verified.why);
  assert.deepEqual(verified.loadOrder, ["mods/a.wad", "mods/b.wad"]);
  assert.deepEqual(verified.orderedFiles.map(file => file.sha256), manifest.files.map(file => file.sha256));
  assert.equal((await Content.verifyModPackage(manifest, packed)).ok, false);
  assert.equal((await Content.verifyModPackage(manifest, zip([entries[0]]), { trustedKeyIds: [signer.anchor.key_id] })).ok, false);
  assert.equal((await Content.verifyModPackage(manifest, zip([...entries, { path: "mods/extra.wad", bytes: a }]), { trustedKeyIds: [signer.anchor.key_id] })).ok, false);

  const negative = {
    traversal: zip([{ path: "../escape.wad", bytes: a }]),
    absolute: zip([{ path: "/escape.wad", bytes: a }]),
    windowsAbsolute: zip([{ path: "C:/escape.wad", bytes: a }]),
    duplicate: zip([{ path: "mods/a.wad", bytes: a }, { path: "mods/a.wad", bytes: b }]),
    caseAmbiguous: zip([{ path: "mods/A.wad", bytes: a }, { path: "mods/a.wad", bytes: b }]),
    encrypted: zip([{ path: "mods/a.wad", bytes: a, flags: 1 }]),
    unsupportedMethod: zip([{ path: "mods/a.wad", bytes: a, method: 9 }]),
    directory: zip([{ path: "mods/a.wad", bytes: a, external: 0x10 }]),
    nestedArchive: zip([{ path: "mods/nested.pk3", bytes: a }]),
    symbolicLink: zip([{ path: "mods/a.wad", bytes: a, external: 0xa1ff0000 }]),
    declaredBomb: zip([{ path: "mods/a.wad", bytes: a, declaredSize: Content.MAX_MOD_FILE_BYTES + 1 }]),
    actualBomb: zip([{ path: "mods/a.wad", bytes: new Uint8Array(2 * 1024 * 1024), method: 8, declaredSize: 1024 }], {}),
    truncated: zip(entries, { truncate: 7 }),
    trailing: (() => { const p = zip(entries); const q = new Uint8Array(p.length + 1); q.set(p); return q; })()
  };
  for (const [name, bytes] of Object.entries(negative)) await refused(bytes, name);
  const corruptCrc = new Uint8Array(packed);
  // First local file is stored; flip its payload without updating central CRC.
  const firstData = 30 + Buffer.byteLength(entries[0].path);
  corruptCrc[firstData] ^= 1;
  await refused(corruptCrc, "crc");
  const localMismatch = new Uint8Array(packed);
  localMismatch[30] = "x".charCodeAt(0);
  await refused(localMismatch, "local-name-mismatch");
  await refused(packed, "entry-limit", { maxFiles: 1 });
  await refused(packed, "total-limit", { maxTotalBytes: a.length + b.length - 1 });

  let state = 0x12345678;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const fuzzStart = performance.now();
  for (let index = 0; index < 1000; index++) {
    const bytes = new Uint8Array(random() % 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = random() & 255;
    if (index % 2 === 0 && bytes.length >= 4) bytes.set([0x50, 0x4b, 0x05, 0x06]);
    const result = await Content.readPk3(bytes);
    assert.equal(result.ok, false);
  }
  const fuzzMs = performance.now() - fuzzStart;
  console.log(JSON.stringify({ ok: true, format: "zeq-pk3-v1", storedAndDeflated: true,
    manifestLoadOrder: verified.loadOrder, signatureTrustAndDigests: true,
    refused: Object.keys(negative).concat(["crc", "local-name-mismatch", "entry-limit", "total-limit", "missing-file", "extra-file", "untrusted-publisher"]),
    deterministicFuzzCases: 1000, fuzzMs: Number(fuzzMs.toFixed(3)), filesystemWrites: 0 }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
