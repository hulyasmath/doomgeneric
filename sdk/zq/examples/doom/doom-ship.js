/*
 * Doom's host shim for zeq-ship.
 *
 * The Doom page seals save capsules in a Worker started from a file. One page
 * has no second file and a strict host allows no blob workers, so this stands
 * in for that one worker and answers the same messages with the same
 * ZeqCapsule and ZeqSecurity code, on the page.
 *
 *   node sdk/zq/zeq-ship.js pack dist out/index.html --emscripten doomgeneric.js --shim sdk/zq/examples/doom/doom-ship.js
 */
(function () {
  "use strict";
  var RealWorker = window.Worker;
  function CapsuleWorker() { this.onmessage = null; this.onerror = null; }
  CapsuleWorker.prototype.terminate = function () {};
  CapsuleWorker.prototype.postMessage = function (m) {
    var self = this;
    function reply(d) { setTimeout(function () { if (self.onmessage) self.onmessage({ data: d }); }, 0); }
    (async function () {
      try {
        if (m.op === "seal") { var c = await ZeqCapsule.seal(new Uint8Array(m.save), m.pin, m.fields); reply({ id: m.id, ok: true, capsule: c.buffer }); }
        else if (m.op === "open") { var o = await ZeqCapsule.open(new Uint8Array(m.capsule), m.pin); reply({ id: m.id, ok: true, save: o.bytes.buffer, plaintext: o.plaintext }); }
        else if (m.op === "selfTest") { var r = await Promise.all([ZeqCapsule.selfTest(), ZeqSecurity.selfTest()]); reply({ id: m.id, ok: r[0].ok && r[1].ok, capsule: r[0], security: r[1] }); }
        else throw new Error("unsupported operation");
      } catch (e) { reply({ id: m.id, ok: false, error: String(e.message || e) }); }
    })();
  };
  window.Worker = function (url, opts) { return String(url).split("?")[0] === "zeq-capsule-worker.js" ? new CapsuleWorker() : new RealWorker(url, opts); };
})();
