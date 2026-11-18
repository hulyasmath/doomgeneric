"use strict";
importScripts("sdk/zeq-security.js", "sdk/zeq-capsule.js");

self.onmessage = async (event) => {
  const { id, op } = event.data;
  try {
    if (op === "seal") {
      const save = new Uint8Array(event.data.save);
      const capsule = await ZeqCapsule.seal(save, event.data.pin, event.data.fields);
      self.postMessage({ id, ok: true, capsule: capsule.buffer }, [capsule.buffer]);
    } else if (op === "open") {
      const blob = new Uint8Array(event.data.capsule);
      const opened = await ZeqCapsule.open(blob, event.data.pin);
      self.postMessage({ id, ok: true, save: opened.bytes.buffer, plaintext: opened.plaintext }, [opened.bytes.buffer]);
    } else if (op === "selfTest") {
      const [capsule, security] = await Promise.all([ZeqCapsule.selfTest(), ZeqSecurity.selfTest()]);
      self.postMessage({ id, ok: capsule.ok && security.ok, capsule, security });
    } else throw new Error("unsupported operation");
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error.message || error) });
  }
};
