"use strict";

const assert = require("node:assert/strict");
const ZeqNet = require("../zeq-net.js");

const descriptor = {
  format: "zeq-net-session-v1",
  protocol: "zeq-doom-net-v1",
  engine_api: "doomgeneric-zeq-v1",
  engine_build: "conformance-build",
  wad_sha256: "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771",
  content_sha256: "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771",
  ruleset: "zeq-physics-v1",
  episode: "1",
  map: "1",
  skill: "2",
  settings_sha256: "0".repeat(64),
  tick_rate: "35",
  initial_rng: "0",
  session_id: "0123456789abcdef0123456789abcdef"
};

(async () => {
  const normalized = ZeqNet.session(descriptor);
  assert.deepEqual(Object.keys(normalized).sort(), ZeqNet.fields.slice().sort());
  assert.equal(ZeqNet.canonical(normalized), ZeqNet.canonical({ ...descriptor }));
  assert.match(await ZeqNet.descriptorDigest(descriptor), /^[0-9a-f]{64}$/);
  assert.equal(await ZeqNet.descriptorDigest(descriptor), await ZeqNet.descriptorDigest({ ...descriptor }));
  assert.notEqual(await ZeqNet.descriptorDigest(descriptor), await ZeqNet.descriptorDigest({ ...descriptor, map: "2" }));
  for (const [key, value] of [
    ["format", "other"], ["protocol", "other"], ["session_id", "bad"],
    ["wad_sha256", "0"], ["tick_rate", "0"], ["map", "-1"], ["ruleset", ""]
  ]) {
    assert.throws(() => ZeqNet.session({ ...descriptor, [key]: value }), undefined, key);
  }

  const base = { delayTics: 3, jitterTics: 2, dropEvery: 5, duplicateEvery: 4, seed: 777000777 };
  let drops = 0, duplicates = 0, delayed = 0;
  for (let sequence = 1; sequence <= 100; sequence++) {
    const options = { ...base, sequence, sendTic: 20 };
    const a = ZeqNet.scheduleImpairment(options);
    const b = ZeqNet.scheduleImpairment({ ...options });
    assert.deepEqual(a, b);
    assert.deepEqual(a, ZeqNet.scheduleImpairment(options));
    if (!a.length) {
      assert.equal(sequence % 5, 0);
      drops++;
      continue;
    }
    if (a.length === 2) {
      assert.equal(sequence % 4, 0);
      duplicates++;
    }
    if (a[0] !== 23) delayed++;
    for (const due of a) assert.ok(due >= 20 && due <= 25);
  }
  assert.equal(drops, 20);
  assert.ok(duplicates > 0);
  assert.ok(delayed > 0);
  assert.deepEqual(ZeqNet.scheduleImpairment({ sequence: 0, sendTic: 0 }), [0]);
  assert.throws(() => ZeqNet.scheduleImpairment({ sequence: -1, sendTic: 0 }));
  assert.throws(() => ZeqNet.scheduleImpairment({ sequence: 0, sendTic: 0, jitterTics: -1 }));

  console.log(JSON.stringify({ ok: true, digest: await ZeqNet.descriptorDigest(descriptor), drops, duplicates, delayed }));
})().catch((error) => { console.error(error); process.exit(1); });
