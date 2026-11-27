"use strict";

/* Reassemble the standalone machine's original embedded payloads before its
 * original hash-authorized runtime starts. Bearer export still uses those DOM
 * payloads and document.currentScript to reconstruct a self-contained page. */
(() => {
  const chunks = globalThis.ZEQ_MACHINE_CHUNKS;
  const read = (name, count) => {
    const parts = [];
    for (let index = 0; index < count; index += 1) {
      const key = `${name}:${index}`;
      if (!chunks || typeof chunks[key] !== "string") throw new Error(`missing machine asset ${key}`);
      parts.push(chunks[key]);
    }
    return parts.join("");
  };

  try {
    for (const [id, count] of [["zeq-catalogue", 1], ["zeq-page", 1], ["zeq-engine", 2]]) {
      const element = document.getElementById(id);
      if (!element) throw new Error(`missing machine payload element ${id}`);
      element.textContent = read(id, count);
    }
    const runtime = document.createElement("script");
    runtime.textContent = read("runtime", 2);
    document.body.append(runtime);
  } catch (error) {
    const status = document.getElementById("status");
    if (status) status.textContent = "MACHINE ASSETS FAILED";
    console.error("The Zeq machine could not assemble its same-origin assets.", error);
    throw error;
  } finally {
    delete globalThis.ZEQ_MACHINE_CHUNKS;
  }
})();
