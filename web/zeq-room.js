"use strict";

/* Same-origin room transport for the real Doom document. This is not a network
 * connector: only the surrounding machine window may receive these messages. */
(() => {
  const CHANNEL = "zeq-doom-room-v1";
  const embedded = window.parent !== window;
  const targetOrigin = location.origin;

  function send(kind, payload = {}) {
    if (!embedded) return false;
    try {
      window.parent.postMessage({ channel: CHANNEL, kind, payload }, targetOrigin);
      return true;
    } catch (_) {
      return false;
    }
  }

  function announceLoaded() {
    send("loaded", { document: "game.html" });
  }

  window.addEventListener("message", (event) => {
    if (!embedded || event.source !== window.parent || event.origin !== targetOrigin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.kind === "machine-ready") {
      const status = document.getElementById("machine-room-status");
      if (status) status.textContent = "MACHINE CONNECTED";
      // The machine runtime may have loaded after this document's first
      // announcements. Reannounce on its explicit handshake; readiness itself
      // remains idempotent and is emitted only by the real WASM callback.
      announceLoaded();
      if (typeof window.ZeqRoomReady === "function") window.ZeqRoomReady();
    }
    if (message.kind === "visibility" && message.visible === false) {
      if (typeof window.ZeqRoomRelease === "function") window.ZeqRoomRelease();
    }
    if (message.kind === "observer-opened") send("observer-opened", {});
  });

  window.ZeqRoomLink = Object.freeze({ embedded, send });
  const status = document.getElementById("machine-room-status");
  if (status) status.textContent = embedded ? "ROOM LINK READY" : "OPEN INSIDE THE MACHINE";
  announceLoaded();
})();
