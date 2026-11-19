"use strict";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const SAVE_KEY = "zeq.doom.save.v1";
const SETTINGS_KEY = "zeq.doom.settings.v1";
const LEDGER_KEY = "zeq.doom.ledger.v1";
const ZERO_HASH = "0".repeat(64);
const eventNames = {
  1: "LEGACY PHASE SHOT", 2: "LEGACY PHASE HIT", 3: "LEGACY PHASE KILL", 4: "LEVEL ENTER",
  5: "DAMAGE TAKEN", 6: "PLAYER DEATH", 7: "CAPSULE SAVED", 8: "CAPSULE LOADED",
  9: "WEAPON FIRED", 10: "DAMAGE IMPACT", 11: "EXPLOSION PROPAGATION",
  12: "IMPULSE INTEGRATED", 13: "COOLDOWN STARTED", 14: "RULESET DEPLOYED",
  15: "SIGNED PWAD LOAD"
};
const rulesetNames = ["DOOM VANILLA V1", "ZEQ PHYSICS V1", "LEGACY ARCADE V1"];
const rulesetIds = ["doom-vanilla-v1", "zeq-physics-v1", "zeq-arcade-legacy-v1"];
const impulseNames = ["NONE", "IMPACT", "EXPLOSION", "MIXED"];
const weaponNames = ["FIST", "PISTOL", "SHOTGUN", "CHAINGUN", "ROCKET", "PLASMA", "BFG 9000", "CHAINSAW", "SUPER SHOTGUN"];
const mapNames = ["HANGAR", "NUCLEAR PLANT", "TOXIN REFINERY", "COMMAND CONTROL", "PHOBOS LAB", "CENTRAL PROCESSING", "COMPUTER STATION", "PHOBOS ANOMALY", "DEIMOS ANOMALY"];
const keys = {
  KeyW: 173, KeyS: 175, KeyA: 160, KeyD: 161,
  ArrowUp: 173, ArrowDown: 175, ArrowLeft: 172, ArrowRight: 174,
  ControlLeft: 163, ControlRight: 163, Space: 162,
  ShiftLeft: 182, ShiftRight: 182, AltLeft: 184, AltRight: 184,
  Escape: 27, Enter: 13, Tab: 9, Backspace: 127, Pause: 255,
  Equal: 61, NumpadAdd: 61, Minus: 45, NumpadSubtract: 45,
  F1: 187, F2: 188, F3: 189, F4: 190, F5: 191, F6: 192,
  F7: 193, F8: 194, F9: 195, F10: 196, F11: 215, F12: 216
};
for (let i = 0; i <= 9; i++) { keys[`Digit${i}`] = 48 + i; keys[`Numpad${i}`] = 48 + i; }
for (let i = 65; i <= 90; i++) {
  const code = `Key${String.fromCharCode(i)}`;
  if (keys[code] === undefined) keys[code] = i + 32;
}

let ready = false;
let started = false;
let muted = false;
let sensitivity = 1;
let mouseDown = false;
let toastTimer = 0;
let flashTimer = 0;
let lastSnapshot = null;
let lastExactSnapshot = null;
let lastExactComparedTic = -1;
let sdkVectorResult = null;
let impulseRecords = [];
let eventChain = Promise.resolve();
let ledger = [];
let touchAim = null;
const keyHolds = new Map();
const keyCounts = new Map();
const MIN_HOLD_MS = 48;
let holdSerial = 0;
let captureChunks = [];
let captureLength = 0;
let captureDropped = 0;
let captureReplayable = false;
let canonicalCheckpoints = [];
let canonicalDropped = 0;
let canonicalErrors = 0;
let lastContentEvidence = null;
let contentLoadBusy = false;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2400);
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
}
function call(name, args = []) {
  return Module.ccall(name, "number", args.map(() => "number"), args);
}
function keyEvent(pressed, key) {
  if (ready) call("ZEQ_KeyEvent", [pressed ? 1 : 0, key]);
}
function pressKey(id, key) {
  const previous = keyHolds.get(id);
  if (previous) finishHold(previous);
  const hold = { id, key, serial: ++holdSerial, since: performance.now(), released: false, finished: false, timer: 0 };
  keyHolds.set(id, hold);
  const count = keyCounts.get(key) || 0;
  keyCounts.set(key, count + 1);
  if (count === 0) keyEvent(true, key);
}
function finishHold(hold) {
  if (!hold || hold.finished) return;
  hold.finished = true;
  clearTimeout(hold.timer);
  if (keyHolds.get(hold.id) === hold) keyHolds.delete(hold.id);
  const count = (keyCounts.get(hold.key) || 1) - 1;
  if (count <= 0) {
    keyCounts.delete(hold.key);
    keyEvent(false, hold.key);
  } else keyCounts.set(hold.key, count);
}
function releaseKey(id, immediate = false) {
  const hold = keyHolds.get(id);
  if (!hold || hold.released) return;
  hold.released = true;
  // Doom samples the key queue once per 35 Hz gametic; never let a press
  // and its release collapse into the same batch. The hold remains tracked
  // until that key-up is actually queued, so blur/dialog cleanup cannot lose it.
  const wait = immediate ? 0 : Math.max(0, MIN_HOLD_MS - (performance.now() - hold.since));
  if (wait === 0) finishHold(hold);
  else hold.timer = setTimeout(() => finishHold(hold), wait);
}
function releaseAll() {
  [...keyHolds.values()].forEach(finishHold);
  if (mouseDown) { callReadyMouse(0, 0, 0); mouseDown = false; }
}
function isKeyHeld(id) {
  const hold = keyHolds.get(id);
  return !!hold && !hold.released && !hold.finished;
}
function callReadyMouse(dx, dy, buttons) {
  if (ready) call("ZEQ_Mouse", [dx, dy, buttons]);
}

var Module = {
  canvas,
  noInitialRun: false,
  print: (text) => console.log(`[doom] ${text}`),
  printErr: (text) => console.warn(`[doom] ${text}`),
  setStatus: (text) => {
    if (!text) return;
    $("boot-copy").textContent = text.toUpperCase();
    const match = /(\d+)\/(\d+)/.exec(text);
    if (match) $("boot-progress").firstElementChild.style.width = `${100 * Number(match[1]) / Number(match[2])}%`;
  },
  onRuntimeInitialized: () => {
    ready = true;
    $("engine-state").classList.add("ready");
    $("engine-state").innerHTML = "<i></i>ENGINE ONLINE";
    $("start-button").disabled = false;
    $("boot-copy").textContent = "DOOM1.WAD VERIFIED / ENGINE READY";
    $("boot-progress").classList.add("done");
    $("exact-self-test").disabled = false;
    $("deploy-ruleset").disabled = false;
    $("load-signed-mod").disabled = false;
    applySettings();
    pollExactSnapshot();
  },
  onAbort: (reason) => {
    $("engine-state").innerHTML = "<i></i>ENGINE FAULT";
    $("boot-copy").textContent = `ENGINE STOPPED: ${String(reason).slice(0, 100)}`;
    toast("Doom engine stopped. Reload to retry.");
  }
};
window.Module = Module;

function readSave() {
  const encoded = safeGet(SAVE_KEY);
  if (!encoded) return null;
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (_) { return null; }
}
function refreshContinue() {
  $("continue-button").hidden = !readSave();
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function isZeqc3(data) {
  return data && data.length >= 49 && bytesToBase64(data.subarray(0, 5)) === "WkVRQzM=";
}
function capsuleWorker(message, transfer = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("zeq-capsule-worker.js");
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.ok || message.op === "selfTest") resolve(event.data);
      else reject(new Error(event.data.error || "Capsule operation failed"));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "Capsule Worker failed")); };
    worker.postMessage(message, transfer);
  });
}
let pendingSaveData = null;
let capsuleBusy = false;
let runDescriptorPromise = null;
let proofSessionId = null;
let proofSignerPromise = null;
function openCapsuleDialog(mode) {
  releaseAll();
  $("capsule-dialog").dataset.mode = mode;
  $("capsule-title").textContent = mode === "seal" ? "Seal a ZEQC3 save." : "Open your ZEQC3 save.";
  $("capsule-copy").textContent = mode === "seal"
    ? "Use at least eight characters, not digits alone, with four distinct characters. The PIN is sent only to the local Worker and is never stored."
    : "Enter the PIN for this browser’s local capsule. A wrong PIN or changed capsule fails without loading anything.";
  $("capsule-pin").value = "";
  $("capsule-confirm").value = "";
  $("capsule-confirm-row").hidden = mode !== "seal";
  $("capsule-submit").textContent = mode === "seal" ? "SEAL ZEQC3" : "OPEN CAPSULE";
  $("capsule-busy").textContent = "";
  delete $("capsule-dialog").dataset.busy;
  $("capsule-pin").disabled = false;
  $("capsule-confirm").disabled = false;
  $("capsule-dialog").showModal();
}
function saveCapsule() {
  if (!ready || !started || capsuleBusy) return;
  try {
    call("ZEQ_SaveGame");
    $("save-button").disabled = true;
    setTimeout(() => {
      try {
        const data = Module.FS.readFile("./.savegame/doomsav0.dsg");
        if (!data.length) throw new Error("Empty save");
        pendingSaveData = new Uint8Array(data);
        openCapsuleDialog("seal");
      } catch (_) { toast("SAVE UNAVAILABLE / ENTER A LEVEL FIRST"); }
      finally { $("save-button").disabled = false; }
    }, 180);
  } catch (_) {
    $("save-button").disabled = false;
    toast("SAVE UNAVAILABLE / ENTER A LEVEL FIRST");
  }
}
async function submitCapsule() {
  if (capsuleBusy) return;
  const mode = $("capsule-dialog").dataset.mode;
  const pin = $("capsule-pin").value;
  if (mode === "seal" && pin !== $("capsule-confirm").value) { toast("PIN CONFIRMATION DOES NOT MATCH"); return; }
  if (mode === "seal") {
    const weak = ZeqCapsule.weakPin(pin);
    if (weak) { toast(weak.toUpperCase()); return; }
  }
  capsuleBusy = true;
  $("capsule-dialog").dataset.busy = "true";
  $("capsule-submit").disabled = true;
  $("capsule-pin").disabled = true;
  $("capsule-confirm").disabled = true;
  $("capsule-busy").textContent = "SCRYPT N=131072 / LOCAL WORKER BUSY";
  try {
    if (mode === "seal") {
      if (!pendingSaveData?.length) throw new Error("No Doom save is waiting to be sealed");
      const exact = lastExactSnapshot || pollExactSnapshot();
      const fields = {
        run: await makeRunDescriptor(),
        machineZid: "browser-local",
        createdZeqond: exact?.zeqond || "0",
        createdPhase64: exact?.phase64 || "0",
        zeqState: {
          ruleset: exact?.ruleset ?? 0,
          pendingRuleset: exact?.pendingRuleset ?? 0,
          cooldown: exact?.cooldown || {},
          acceleration: exact?.acceleration || { x: 0, y: 0, z: 0 },
          pendingImpulse: exact?.pendingImpulse || { x: 0, y: 0, z: 0 }
        }
      };
      const data = pendingSaveData;
      const copy = new Uint8Array(data).buffer;
      const result = await capsuleWorker({ op: "seal", save: copy, pin, fields }, [copy]);
      const capsule = new Uint8Array(result.capsule);
      if (!safeSet(SAVE_KEY, bytesToBase64(capsule))) throw new Error("Browser storage unavailable");
      pendingSaveData = null;
      refreshContinue();
      toast(`ZEQC3 SEALED / ${capsule.length.toLocaleString()} BYTES`);
      $("capsule-dialog").close();
    } else {
      const data = readSave();
      const copy = new Uint8Array(data).buffer;
      const result = await capsuleWorker({ op: "open", capsule: copy, pin }, [copy]);
      if (result.plaintext?.run?.format === "zeq-run-v1") runDescriptorPromise = Promise.resolve(result.plaintext.run);
      proofSessionId = randomHex(16);
  proofSignerPromise = null;
      $("capsule-dialog").close();
      loadRawSave(new Uint8Array(result.save));
    }
  } catch (error) {
    $("capsule-busy").textContent = mode === "open" ? "OPEN FAILED / WRONG PIN OR CHANGED CAPSULE" : "SEAL FAILED / NOTHING STORED";
    toast(mode === "open" ? "CAPSULE REFUSED" : error.message.toUpperCase());
  } finally {
    capsuleBusy = false;
    delete $("capsule-dialog").dataset.busy;
    $("capsule-submit").disabled = false;
    $("capsule-pin").disabled = false;
    $("capsule-confirm").disabled = false;
    $("capsule-pin").value = "";
    $("capsule-confirm").value = "";
  }
}
function loadRawSave(data) {
  try {
    releaseAll();
    Module.FS.writeFile("./.savegame/doomsav0.dsg", data);
    started = true;
    resetCapture(false);
    resetCanonical(0);
    $("title-screen").classList.add("dismissed");
    $("save-button").disabled = false;
    $("export-save-button").disabled = false;
    call("ZEQ_LoadGame");
    canvas.focus();
    setTimeout(() => {
      const exact = pollExactSnapshot();
      if (!exact) return;
      $("ruleset-select").value = String(exact.pendingRuleset);
      persistSettings();
      toast(`CAPSULE RESTORED / ${rulesetNames[exact.ruleset]}`);
    }, 250);
  } catch (_) { toast("CAPSULE COULD NOT BE LOADED"); }
}
function loadCapsule() {
  if (!ready || capsuleBusy) return;
  const data = readSave();
  if (!data) { toast("NO LOCAL CAPSULE FOUND"); return; }
  if (isZeqc3(data)) openCapsuleDialog("open");
  else {
    runDescriptorPromise = null;
    proofSessionId = randomHex(16);
  proofSignerPromise = null;
    loadRawSave(data); // Legacy raw .dsg remains readable; next save migrates to ZEQC3.
  }
}
function downloadBytes(bytes, filename, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportSave() {
  const data = readSave();
  if (data) downloadBytes(data, isZeqc3(data) ? "zeq-doom-capsule.zeq" : "zeq-doom-capsule-legacy.dsg");
  else toast("NO EXPORTED CAPSULE AVAILABLE");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function recordPayload(record) {
  return JSON.stringify({ seq: record.seq, type: record.type, tic: record.tic, phase: record.phase, value: record.value, ...(record.content ? { content: record.content } : {}), previousHash: record.previousHash });
}
function queueEngineEvent(event) {
  eventChain = eventChain.then(async () => {
    const previousHash = ledger.length ? ledger[ledger.length - 1].hash : ZERO_HASH;
    const record = { seq: ledger.length, type: event.type, tic: event.tic, phase: event.phase, value: event.value, ...(event.content ? { content: event.content } : {}), previousHash };
    record.hash = await sha256(recordPayload(record));
    ledger.push(record);
    safeSet(LEDGER_KEY, JSON.stringify(ledger));
    updateLedger();
    addEventToStream(record);
    // Zeq SDK hook: every engine event, as the engine emitted it, to whatever the page plugged in
    // (state contracts on a Zeq machine, for one). The game never waits on it and never depends on it.
    if (typeof window.ZeqHostHook === "function") {
      try { Promise.resolve(window.ZeqHostHook({ type: record.type, gametic: record.tic, phase: record.phase, value: record.value })).catch((error) => console.warn("Zeq host hook failed", error)); }
      catch (error) { console.warn("Zeq host hook failed", error); }
    }
    if (sidecarOn) {
      const bridge = sidecarBridge();
      if (bridge) bridge.event({ type: record.type, tic: record.tic, phase: record.phase, value: record.value });
    }
    if (record.type === 1) {
      $("phase-flash").classList.add("visible");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => $("phase-flash").classList.remove("visible"), 420);
    }
  }).catch((error) => console.warn("Ledger append failed", error));
}
function addEventToStream(record) {
  const list = $("event-stream");
  list.querySelector(".empty-event")?.remove();
  const item = document.createElement("li");
  const tic = document.createElement("span");
  tic.textContent = `TIC ${record.tic}`;
  item.append(tic, document.createTextNode(eventNames[record.type] || `ENGINE EVENT ${record.type}`));
  list.prepend(item);
  while (list.children.length > 6) list.lastElementChild.remove();
}
function updateLedger() {
  $("ledger-count").textContent = String(ledger.length);
  $("chain-tip").textContent = ledger.length ? ledger[ledger.length - 1].hash : "NO EVENTS";
  const list = $("ledger-list");
  list.replaceChildren();
  if (!ledger.length) {
    const item = document.createElement("li"); item.textContent = "No engine events recorded yet."; list.append(item);
  } else {
    [...ledger].reverse().slice(0, 100).forEach((record) => {
      const item = document.createElement("li");
      const seq = document.createElement("b"); seq.textContent = `#${record.seq}`;
      item.append(seq, document.createTextNode(`${eventNames[record.type] || record.type} · TIC ${record.tic} · φ ${(record.phase / 35000).toFixed(3)} · VALUE ${record.value}`));
      list.append(item);
    });
  }
}
async function verifyLedger() {
  await eventChain;
  let previousHash = ZERO_HASH;
  for (let i = 0; i < ledger.length; i++) {
    const record = ledger[i];
    if (record.seq !== i || record.previousHash !== previousHash || await sha256(recordPayload(record)) !== record.hash) {
      $("ledger-verdict").textContent = "CHAIN BROKEN";
      $("ledger-verdict").style.color = "var(--orange)";
      toast(`LEDGER MISMATCH AT EVENT ${i}`);
      return;
    }
    previousHash = record.hash;
  }
  $("ledger-verdict").textContent = ledger.length ? "INTEGRITY OK" : "NO EVENTS";
  $("ledger-verdict").style.color = "var(--green)";
  toast(ledger.length ? `${ledger.length} EVENTS / HASH CHAIN VERIFIED` : "LEDGER IS EMPTY");
}
function restoreLedger() {
  try { ledger = JSON.parse(safeGet(LEDGER_KEY) || "[]"); if (!Array.isArray(ledger)) ledger = []; }
  catch (_) { ledger = []; }
  updateLedger();
}

const proofKinds = {
  1: "legacy-phase-shot", 2: "projectile-impact", 3: "legacy-phase-kill", 4: "level-enter",
  5: "damage-impact", 6: "player-death", 7: "capsule-saved", 8: "capsule-loaded",
  9: "weapon-fired", 10: "projectile-impact", 11: "explosion", 12: "impulse-integrated",
  13: "cooldown-started", 14: "ruleset-deployed", 15: "signed-pwad-load"
};
function randomHex(bytes) {
  const data = new Uint8Array(bytes); crypto.getRandomValues(data);
  return [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function makeRunDescriptor() {
  if (!runDescriptorPromise) runDescriptorPromise = createRunDescriptor().catch((error) => {
    runDescriptorPromise = null;
    throw error;
  });
  return runDescriptorPromise;
}
async function createRunDescriptor() {
  const exact = lastExactSnapshot || (ready ? pollExactSnapshot() : null);
  const buildResponse = await fetch("doomgeneric.wasm");
  if (!buildResponse.ok) throw new Error("Engine identity unavailable");
  const engineBuild = await ZeqSecurity.sha256(new Uint8Array(await buildResponse.arrayBuffer()));
  const settings = {
    ruleset: rulesetIds[exact?.ruleset ?? 1], phaseBonus: $("phase-toggle").checked,
    sensitivity: String(sensitivity), tickRate: "35"
  };
  return {
    format: "zeq-run-v1", run_id: randomHex(16),
    engine_commit: globalThis.ZeqBuildInfo?.sourceCommit || "0".repeat(40),
    engine_build_sha256: engineBuild,
    wad_sha256: "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771",
    ruleset: rulesetIds[exact?.ruleset ?? 1], compatibility: "0", tick_rate: "35", initial_rng: "0",
    settings_sha256: await ZeqSecurity.sha256(ZeqSecurity.canonical(settings)),
    time_origin: { kind: "doom-tic", gametic: "0" }
  };
}
function proofSigner() {
  if (!proofSignerPromise) proofSignerPromise = ZeqSecurity.createSigner("browser-local");
  return proofSignerPromise;
}
async function buildSignedProof() {
  await eventChain;
  const run = await makeRunDescriptor();
  const signer = await proofSigner();
  const events = ledger.map((record) => {
    const time = ZeqSDK.time.fromTic(record.tic, 35);
    return {
      gametic: String(record.tic), zeqond: time.zeqond, phase64: time.phase64,
      ruleset: run.ruleset, kind: proofKinds[record.type] || "engine-diagnostic",
      payload: { legacy_type: String(record.type), value: String(record.value), legacy_phase: String(record.phase), legacy_record_sha256: record.hash, ...(record.content ? { content: record.content } : {}) }
    };
  });
  if (!proofSessionId) proofSessionId = randomHex(16);
  return ZeqSecurity.createProof({
    signer, run, sessionId: proofSessionId, events, createdZeqond: lastExactSnapshot?.zeqond || "0",
    inputRecordsOrDigest: { status: "unavailable", reason: "Full actual-tic input capture is not included in this browser proof." },
    stateHashes: [], checkpointInterval: "0",
    replay: { status: "unavailable", reason: "No headless Doom reproduction was performed; the verifier refuses to upgrade this to match." }
  });
}
async function downloadSignedProof() {
  $("download-proof").disabled = true;
  try {
    const proof = await buildSignedProof();
    const verdict = await ZeqSecurity.verifyProof(proof);
    if (!verdict.ok || verdict.replay !== "unavailable") throw new Error(verdict.why || "Signed proof verification failed");
    downloadBytes(new TextEncoder().encode(JSON.stringify(proof, null, 2)), "zeq-doom-proof-v2.json", "application/json");
    toast(`${proof.events.length} SIGNED EVENTS / REPLAY UNAVAILABLE`);
  } catch (error) { toast(`SIGNED PROOF FAILED / ${error.message.toUpperCase()}`); }
  finally { $("download-proof").disabled = false; }
}
let phase3TestPromise = null;
function runPhase3SelfTest() {
  if (!phase3TestPromise) phase3TestPromise = capsuleWorker({ op: "selfTest" }).then((result) => ({
    ok: result.ok, capsule: result.capsule, security: result.security
  })).finally(() => { phase3TestPromise = null; });
  return phase3TestPromise;
}

/* --- Phase 5 signed PWAD engine handoff --------------------------------
 * The SDK authenticates the canonical manifest and explicit publisher trust.
 * C independently hashes an owned copy and Doom reads that exact copy. */
const contentStatusNames = [
  "NOT ATTEMPTED", "LOADED", "INVALID ARGUMENT", "PUBLISHER NOT TRUSTED",
  "INCOMPATIBLE RULESET", "INVALID SIZE", "DIGEST MISMATCH", "MALFORMED PWAD",
  "ENGINE REFUSED", "DUPLICATE CONTENT"
];
function readContentEvidence() {
  if (!ready) return null;
  const pointer = call("ZEQ_GetContentEvidence");
  if (!pointer) return null;
  const offset = pointer >> 2;
  const text = (position) => Module.UTF8ToString(pointer + position);
  return {
    version: HEAP32[offset], status: HEAP32[offset + 1],
    statusName: contentStatusNames[HEAP32[offset + 1]] || "UNKNOWN",
    trusted: !!HEAP32[offset + 2], rulesetCompatible: !!HEAP32[offset + 3],
    ruleset: rulesetIds[HEAP32[offset + 4]] || "invalid",
    digestVerified: !!HEAP32[offset + 5], lumpCount: HEAP32[offset + 6],
    engineLumpCount: HEAP32[offset + 7],
    modId: text(32), modVersion: text(161), publisherKeyId: text(290),
    contentSha256: text(355)
  };
}
async function recordContentEvidence(evidence) {
  lastContentEvidence = { format: "zeq-content-load-evidence-v1", ...evidence };
  const status = $("mod-load-status");
  if (status) {
    status.textContent = `${lastContentEvidence.result.toUpperCase()} / ${lastContentEvidence.modId || "UNKNOWN MOD"} / ${lastContentEvidence.why || lastContentEvidence.statusName || "SDK POLICY"}`;
    status.dataset.state = lastContentEvidence.result === "loaded" ? "ok" : "error";
  }
  queueEngineEvent({
    type: 15, tic: lastSnapshot?.gametic || 0, phase: lastSnapshot?.phase || 0,
    value: lastContentEvidence.result === "loaded" ? 1 : 0, content: lastContentEvidence
  });
  await eventChain;
}
async function refuseSignedWad(why, manifest, stage = "sdk", verification = null) {
  const file = Array.isArray(manifest?.files) && manifest.files.length === 1 ? manifest.files[0] : null;
  const evidence = {
    result: "refused", stage, why,
    modId: typeof manifest?.mod_id === "string" ? manifest.mod_id : "",
    modVersion: typeof manifest?.mod_version === "string" ? manifest.mod_version : "",
    publisherKeyId: verification?.key_id || "", trusted: !!verification?.authorized,
    publisherTrust: verification?.authorized ? "explicitly-trusted" : "not-authorized",
    contentSha256: typeof file?.sha256 === "string" ? file.sha256 : "",
    ruleset: rulesetIds[lastExactSnapshot?.ruleset ?? 1],
    rulesetCompatible: !!verification?.authorized && !!manifest?.rulesets?.includes(rulesetIds[lastExactSnapshot?.ruleset ?? 1]),
    digestVerified: !!verification?.ok
  };
  await recordContentEvidence(evidence);
  return { ok: false, why, evidence: lastContentEvidence };
}
async function loadSignedWad(manifest, wadBytes, trustedKeyId) {
  if (!ready) return refuseSignedWad("engine is not ready", manifest, "loader");
  if (contentLoadBusy) return refuseSignedWad("another content load is active", manifest, "loader");
  if (!(wadBytes instanceof Uint8Array)) return refuseSignedWad("PWAD bytes are required", manifest, "loader");
  contentLoadBusy = true;
  try {
    const verified = await ZeqContent.verifyModFiles(manifest, Array.isArray(manifest?.files) && manifest.files.length === 1
      ? [{ path: manifest.files[0].path, bytes: wadBytes }] : [], { trustedKeyIds: [trustedKeyId] });
    if (!verified.ok) return await refuseSignedWad(verified.why || "signed content verification failed", manifest);
    if (manifest.engine_api !== "doomgeneric-zeq-v1") return await refuseSignedWad("unsupported engine API", manifest, "sdk", verified);
    if (manifest.files.length !== 1 || !/\.wad$/i.test(manifest.files[0].path)) return await refuseSignedWad("exactly one PWAD is supported", manifest, "sdk", verified);
    if (manifest.dependencies.length) return await refuseSignedWad("mod dependencies are not supported", manifest, "sdk", verified);
    const activeRuleset = lastExactSnapshot?.ruleset ?? 1;
    const activeId = rulesetIds[activeRuleset];
    if (!manifest.rulesets.includes(activeId)) return await refuseSignedWad("active ruleset is not declared by the mod", manifest, "sdk", verified);
    const rulesetMask = manifest.rulesets.reduce((mask, id) => mask | (1 << rulesetIds.indexOf(id)), 0);
    const pointer = Module._malloc(wadBytes.length);
    if (!pointer) return await refuseSignedWad("engine allocation failed", manifest, "engine", verified);
    let result;
    try {
      HEAPU8.set(wadBytes, pointer);
      result = Module.ccall("ZEQ_LoadVerifiedWad", "number",
        ["number", "number", "string", "string", "string", "string", "number", "number"],
        [pointer, wadBytes.length, manifest.files[0].sha256, manifest.mod_id, manifest.mod_version,
          verified.key_id, 1, rulesetMask]);
    } finally { Module._free(pointer); }
    const engine = readContentEvidence();
    if (!engine) return await refuseSignedWad("engine evidence unavailable", manifest, "engine");
    const evidence = {
      ...engine, result: result === 1 && engine.status === 1 ? "loaded" : "refused",
      stage: "engine", signatureValid: true, publisherTrust: "explicitly-trusted",
      engineApi: manifest.engine_api
    };
    await recordContentEvidence(evidence);
    return { ok: evidence.result === "loaded", why: evidence.result === "loaded" ? "" : engine.statusName, evidence: lastContentEvidence };
  } catch (error) {
    return await refuseSignedWad(error.message || "signed content load failed", manifest, "loader");
  } finally { contentLoadBusy = false; }
}

/* --- Optional local sidecar bridge (zeq-game-sdk) ----------------------
 * Mirrors engine telemetry to a user-run zeq-kernel over JSON-RPC/WS.
 * Strictly optional: when disabled or unreachable the game is unchanged. */
let sidecarOn = false;
let lastSidecarSnapshot = 0;
function sidecarBridge() { return window.ZeqSDK ? window.ZeqSDK.bridge : null; }
function updateSidecarStatus(state) {
  const el = $("sidecar-status");
  if (el) el.textContent = state === "online" ? "linked" : state === "connecting" ? "connecting…" : "offline";
}
function applySidecar(on) {
  sidecarOn = on;
  const bridge = sidecarBridge();
  if (!bridge) { updateSidecarStatus("offline"); return; }
  if (on) {
    bridge.configure({
      url: "ws://127.0.0.1:7770/zeq",
      game: "doomgeneric-web",
      client: "zeq-doom/1.0",
      onstate: (state) => updateSidecarStatus(state)
    });
    bridge.connect();
  } else {
    bridge.close();
    updateSidecarStatus("offline");
  }
}

function drainEvents() {
  if (!ready || !started) return;
  for (let i = 0; i < 64; i++) {
    const pointer = call("ZEQ_GetEvent");
    if (!pointer) break;
    const offset = pointer >> 2;
    queueEngineEvent({ type: HEAP32[offset], tic: HEAP32[offset + 1], phase: HEAP32[offset + 2], value: HEAP32[offset + 3] });
  }
  drainImpulseRecords();
}
function readImpulseRecord(offset) {
  const phase64 = joinUnsigned64(HEAPU32[offset + 2], HEAPU32[offset + 3]).toString();
  return {
    kind: HEAP32[offset], gametic: HEAP32[offset + 1], phase64,
    phase64Hex: `0x${BigInt(phase64).toString(16).padStart(16, "0")}`,
    sourceId: HEAPU32[offset + 4], inflictorId: HEAPU32[offset + 5], targetId: HEAPU32[offset + 6],
    mass: HEAP32[offset + 7],
    base: { x: HEAP32[offset + 8], y: HEAP32[offset + 9], z: HEAP32[offset + 10] },
    delta: { x: HEAP32[offset + 11], y: HEAP32[offset + 12], z: HEAP32[offset + 13] },
    residual: { x: HEAP32[offset + 14], y: HEAP32[offset + 15], z: HEAP32[offset + 16] },
    intervalTics: HEAP32[offset + 17], substeps: HEAP32[offset + 18]
  };
}
function drainImpulseRecords() {
  for (let i = 0; i < 64; i++) {
    const pointer = call("ZEQ_GetImpulseRecord");
    if (!pointer) break;
    impulseRecords.push(readImpulseRecord(pointer >> 2));
  }
  if (impulseRecords.length > 64) impulseRecords = impulseRecords.slice(-64);
}
function joinSigned64(hi, lo) { return (BigInt(hi) << 32n) | BigInt(lo >>> 0); }
function joinUnsigned64(hi, lo) { return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0); }
function setExactConformance(state, text, detail = "") {
  const badge = $("exact-conformance");
  badge.dataset.state = state;
  badge.textContent = text;
  badge.title = detail;
}
function vectorText(v) { return `[${v.x}, ${v.y}, ${v.z}]`; }
function updateRulesetUI(exact) {
  const active = exact.ruleset;
  const pending = exact.pendingRuleset;
  const physics = active === 1;
  const legacy = active === 2;
  document.body.dataset.ruleset = rulesetIds[active] || "invalid";
  $("physics-ruleset").textContent = rulesetNames[active] || "INVALID RULESET";
  $("physics-active").textContent = physics ? "ACTIVE" : "BYPASSED";
  $("physics-active").dataset.state = physics ? "active" : "bypassed";
  $("physics-pending").hidden = pending === active;
  $("physics-pending").textContent = `PENDING: ${rulesetNames[pending]} / REDEPLOY REQUIRED`;
  $("start-ruleset").textContent = `NEW DEPLOYMENT / ${rulesetNames[pending]}`;
  $("phase-module").hidden = !legacy;
  $("phase-toggle").disabled = !legacy;
  $("module-state").textContent = $("phase-toggle").checked ? "ARMED" : "BYPASSED";
  $("runtime-detail").textContent = `640 × 400 · 35 HZ · ${rulesetNames[active]}`;
  $("cooldown-ready").textContent = physics ? exact.cooldown.ready.toLocaleString() : "—";
  $("cooldown-remaining").textContent = physics ? (exact.cooldown.remaining ? `${exact.cooldown.remaining} TIC` : "READY") : legacy ? "LEGACY" : "VANILLA";
  $("cooldown-duration").textContent = `${weaponNames[exact.cooldown.weapon] || "WEAPON"} · ${exact.cooldown.durationNum}/${exact.cooldown.durationDen} ZEQOND · ${exact.cooldown.cadenceTics} TIC CADENCE`;
  $("impulse-count").textContent = exact.impulseCount.toLocaleString();
  $("physics-errors").textContent = exact.physicsErrors.toLocaleString();
  $("physics-errors").dataset.state = exact.physicsErrors ? "error" : "ok";
  $("physics-accel").textContent = vectorText(exact.acceleration);
  $("physics-pending-impulse").textContent = vectorText(exact.pendingImpulse);

  const last = exact.lastImpulse;
  $("last-impulse-kind").textContent = impulseNames[last.kind] || `KIND ${last.kind}`;
  $("last-impulse-detail").textContent = `J ${vectorText(last.base)} · ΔV ${vectorText(last.delta)}`;
  $("last-impulse-residual").textContent = `RESIDUAL ${vectorText(last.residual)}`;
  $("last-impulse-meta").textContent = exact.impulseCount
    ? `TIC ${last.gametic} · ${last.phase64Hex} · MASS ${last.mass} · ${last.substeps} SUBSTEPS · TARGET ${last.targetId}`
    : "NO FINITE INTERVAL RECORDED";

  const descriptions = [
    "Vanilla bypasses Zeq force terms, cooldown restrictions, and arcade bonuses.",
    "Zeq Physics applies lapse movement, 32-substep impulses, and exact cooldowns.",
    "Legacy Arcade preserves the approximate carrier, thrust modulation, and optional phase damage."
  ];
  $("ruleset-deploy-copy").textContent = pending === active
    ? `${descriptions[pending]} Active in this deployment.`
    : `${descriptions[pending]} Pending; redeploy to apply.`;
}
function updateCarrierUI(s, exact) {
  if (!exact) return;
  const legacy = exact.ruleset === 2;
  const fraction = legacy ? s.phase / 35000 : Number(BigInt(exact.phase64) >> 32n) / 4294967296;
  $("carrier-title").textContent = legacy ? "LEGACY ARCADE" : "EXACT ZEQ CLOCK";
  $("carrier-frequency").textContent = legacy ? "≈1.287 Hz" : "0.777000777 S";
  $("legacy-pulse").textContent = legacy ? `R≈${(s.pulse / 1000).toFixed(3)}` : `R ${(Number(exact.carrierQ30) / 1073741824).toFixed(6)}`;
  $("phase-track").setAttribute("aria-label", legacy ? "Legacy arcade carrier phase" : "Exact Q64 carrier phase");
  $("phase-track").querySelector(".phase-window").hidden = !legacy;
  $("phase-cursor").style.left = `${Math.max(0, Math.min(100, 100 * fraction))}%`;
  $("phase-value").textContent = `${legacy ? "φ≈" : "φ "}${fraction.toFixed(legacy ? 3 : 6)}`;
  $("phase-status").textContent = s.paused ? "PAUSED" : legacy ? (s.aligned ? "LEGACY LOCK" : "SEEKING PHASE") : exact.ruleset === 1 ? "LAPSE INTEGRATION" : "OBSERVER ONLY";
  $("phase-status").classList.toggle("locked", legacy && !!s.aligned);
}
function pollExactSnapshot() {
  if (!ready || !window.ZeqSDK?.time) return null;
  const pointer = call("ZEQ_GetExactSnapshot");
  if (!pointer) {
    setExactConformance("error", "NO SNAPSHOT", "ZEQ_GetExactSnapshot returned a null pointer.");
    return null;
  }
  const offset = pointer >> 2;
  if (HEAP32[offset] !== 3) {
    setExactConformance("error", "BAD VERSION", `Expected exact snapshot v3, received ${HEAP32[offset]}.`);
    return null;
  }
  const exact = {
    gametic: HEAP32[offset + 1],
    zeqond: joinSigned64(HEAP32[offset + 2], HEAPU32[offset + 3]).toString(),
    phase64: joinUnsigned64(HEAPU32[offset + 4], HEAPU32[offset + 5]).toString(),
    carrierQ30: String(HEAP32[offset + 6]),
    lapse2Q30: String(HEAP32[offset + 7]),
    lapseQ30: String(HEAP32[offset + 8]),
    dlnCycleQ40: joinSigned64(HEAP32[offset + 9], HEAPU32[offset + 10]).toString(),
    player: {
      x: HEAP32[offset + 11], y: HEAP32[offset + 12], z: HEAP32[offset + 13],
      angle: HEAPU32[offset + 14], momx: HEAP32[offset + 15], momy: HEAP32[offset + 16], momz: HEAP32[offset + 17]
    },
    ruleset: HEAP32[offset + 18], pendingRuleset: HEAP32[offset + 19],
    cooldown: {
      weapon: HEAP32[offset + 20], start: HEAP32[offset + 21], ready: HEAP32[offset + 22],
      remaining: HEAP32[offset + 23], durationNum: HEAP32[offset + 51],
      durationDen: HEAP32[offset + 52], cadenceTics: HEAP32[offset + 53]
    },
    impulseCount: HEAP32[offset + 24],
    lastImpulse: {
      kind: HEAP32[offset + 25], gametic: HEAP32[offset + 26],
      phase64: joinUnsigned64(HEAPU32[offset + 27], HEAPU32[offset + 28]).toString(),
      mass: HEAP32[offset + 29],
      base: { x: HEAP32[offset + 30], y: HEAP32[offset + 31], z: HEAP32[offset + 32] },
      delta: { x: HEAP32[offset + 33], y: HEAP32[offset + 34], z: HEAP32[offset + 35] },
      residual: { x: HEAP32[offset + 36], y: HEAP32[offset + 37], z: HEAP32[offset + 38] },
      sourceId: HEAPU32[offset + 39], inflictorId: HEAPU32[offset + 40], targetId: HEAPU32[offset + 41],
      intervalTics: HEAP32[offset + 42], substeps: HEAP32[offset + 43]
    },
    physicsErrors: HEAP32[offset + 44],
    acceleration: { x: HEAP32[offset + 45], y: HEAP32[offset + 46], z: HEAP32[offset + 47] },
    pendingImpulse: { x: HEAP32[offset + 48], y: HEAP32[offset + 49], z: HEAP32[offset + 50] }
  };
  exact.lastImpulse.phase64Hex = `0x${BigInt(exact.lastImpulse.phase64).toString(16).padStart(16, "0")}`;
  const expected = ZeqSDK.time.fromTic(exact.gametic, 35);
  const keys = ["zeqond", "phase64", "carrierQ30", "lapse2Q30", "lapseQ30", "dlnCycleQ40"];
  const mismatches = keys.filter((key) => exact[key] !== expected[key]).map((key) => ({ key, c: exact[key], javascript: expected[key] }));
  exact.phase64Hex = `0x${BigInt(exact.phase64).toString(16).padStart(16, "0")}`;
  exact.mismatches = mismatches;
  lastExactSnapshot = exact;

  $("exact-tic").textContent = exact.gametic.toLocaleString();
  $("stat-zeqond").textContent = BigInt(exact.zeqond).toLocaleString();
  $("exact-carrier").textContent = `R ${(Number(exact.carrierQ30) / 1073741824).toFixed(9)}`;
  $("exact-lapse").textContent = (Number(exact.lapseQ30) / 1073741824).toFixed(9);
  $("exact-phase").textContent = exact.phase64Hex;
  $("exact-dln").textContent = (Number(exact.dlnCycleQ40) / 1099511627776).toExponential(6);
  updateRulesetUI(exact);
  if (mismatches.length) {
    const detail = mismatches.map((m) => `${m.key}: C=${m.c} JS=${m.javascript}`).join("\n");
    setExactConformance("error", "MISMATCH", detail);
    if (lastExactComparedTic !== exact.gametic) console.error("Exact C/JavaScript mismatch", mismatches);
  } else {
    setExactConformance("match", "MATCH", `C/WASM and JavaScript agree on all six integer fields at Doom tic ${exact.gametic}.`);
  }
  lastExactComparedTic = exact.gametic;
  return exact;
}
function runExactConformance(announce = true) {
  if (!window.ZeqSDK?.time || !window.ZeqSDK?.physics) return { ok: false, count: 0, failures: ["SDK unavailable"] };
  const timeResult = ZeqSDK.time.selfTest();
  const physicsResult = ZeqSDK.physics.selfTest();
  const failures = [
    ...timeResult.failures.map((failure) => ({ module: "time", failure })),
    ...physicsResult.failures.map((failure) => ({ module: "physics", failure }))
  ];
  sdkVectorResult = { ok: failures.length === 0, count: timeResult.count + physicsResult.count, failures, time: timeResult, physics: physicsResult };
  const vectorText = sdkVectorResult.ok ? `${sdkVectorResult.count}/${sdkVectorResult.count} VECTORS PASS` : "VECTOR FAILURE";
  $("exact-self-test").textContent = vectorText;
  const live = lastExactSnapshot || (ready ? pollExactSnapshot() : null);
  const liveOk = !!live && live.mismatches.length === 0;
  if (announce) {
    const liveText = liveOk ? `C/WASM = JS AT TIC ${live.gametic}` : live ? "LIVE MISMATCH" : "LIVE ENGINE PENDING";
    toast(`${vectorText} · ${liveText}`);
  }
  return { ...sdkVectorResult, live, liveOk };
}
function percent(value, total) { return total > 0 ? Math.round(100 * value / total) : 0; }
function resetCapture(replayable) {
  captureChunks = [];
  captureLength = 0;
  captureDropped = 0;
  captureReplayable = replayable;
  if (ready) call("ZEQ_CaptureReset");
}
function drainCapture() {
  if (!ready || !captureReplayable) return;
  for (;;) {
    const bytes = call("ZEQ_CaptureRead", [256]);
    if (!bytes) break;
    const pointer = call("ZEQ_CaptureData");
    const copy = HEAPU8.slice(pointer, pointer + bytes);
    captureChunks.push(copy);
    captureLength += bytes;
  }
  captureDropped = call("ZEQ_CaptureDropped");
}
function resetCanonical(interval) {
  canonicalCheckpoints = [];
  canonicalDropped = 0;
  canonicalErrors = 0;
  if (ready) call("ZEQ_CanonicalSetInterval", [interval]);
}
function drainCanonical() {
  if (!ready) return;
  for (;;) {
    const bytes = call("ZEQ_CanonicalRead");
    if (!bytes) break;
    if (bytes !== 68) throw new Error("Invalid canonical checkpoint record size");
    const pointer = call("ZEQ_CanonicalData");
    const record = HEAPU8.slice(pointer, pointer + bytes);
    const gametic = new DataView(record.buffer).getUint32(0, true);
    const stateSha256 = new TextDecoder().decode(record.subarray(4, 68));
    if (!/^[0-9a-f]{64}$/.test(stateSha256)) throw new Error("Invalid canonical checkpoint hash");
    canonicalCheckpoints.push({ gametic: String(gametic), state_sha256: stateSha256 });
  }
  canonicalDropped = call("ZEQ_CanonicalDropped");
  canonicalErrors = call("ZEQ_CanonicalErrors");
}
async function downloadInputCapture() {
  drainCapture();
  if (!captureReplayable) { toast("START A FRESH DEPLOYMENT TO CAPTURE INPUT"); return; }
  if (captureDropped) { toast(`CAPTURE INCOMPLETE: ${captureDropped} RECORDS DROPPED`); return; }
  if (!captureLength || captureLength % 24) { toast("NO COMPLETE TICCMD RECORDS YET"); return; }
  const bytes = new Uint8Array(captureLength);
  let offset = 0;
  for (const chunk of captureChunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const run = await makeRunDescriptor();
  const artifact = {
    format: "zeq-input-v1", run_id: run.run_id, tick_rate: "35",
    record_format: "zeq-ticcmd-le-v1", record_bytes: 24,
    count: bytes.length / 24, encoding: "base64",
    data: ZeqSecurity.bytesBase64(bytes), sha256: await ZeqSecurity.sha256(bytes)
  };
  downloadBytes(new TextEncoder().encode(JSON.stringify(artifact, null, 2)), "zeq-doom-input-v1.json", "application/json");
  toast(`${artifact.count} ACTUAL TICCMD RECORDS EXPORTED`);
}
function pollSnapshot() {
  if (!ready) return;
  const pointer = call("ZEQ_GetSnapshot");
  if (!pointer) return;
  const offset = pointer >> 2;
  const s = {};
  const fields = ["version", "gametic", "zeqond", "phase", "aligned", "pulse", "gamestate", "paused", "menuactive", "health", "armor", "ammo", "maxammo", "weapon", "episode", "map", "kills", "totalkills", "items", "totalitems", "secrets", "totalsecret", "phaseShots", "phaseHits", "phaseKills", "damageTaken", "leveltime", "playerstate"];
  fields.forEach((field, index) => { s[field] = HEAP32[offset + index]; });
  lastSnapshot = s;
  $("hud-health").textContent = Math.max(0, s.health);
  $("stat-armor").textContent = String(Math.max(0, s.armor)).padStart(3, "0");
  $("hud-ammo").textContent = s.ammo < 0 ? "—" : s.ammo;
  $("hud-maxammo").textContent = s.maxammo < 0 ? "" : `/ ${s.maxammo}`;
  $("hud-weapon").textContent = weaponNames[s.weapon] || "WEAPON";
  const mapNumber = Math.max(1, s.map || 1);
  $("hud-location").textContent = `E${s.episode || 1}M${mapNumber} // ${mapNames[mapNumber - 1] || "UAC"}`;
  $("hud-state").textContent = s.paused ? "SIMULATION PAUSED" : s.menuactive ? "DOOM MENU" : s.gamestate === 1 ? "INTERMISSION" : "UAC PHOBOS";
  $("stat-kills").textContent = `${s.kills} / ${s.totalkills}`;
  $("stat-items").textContent = `${percent(s.items, s.totalitems)}%`;
  $("phase-shots").textContent = s.phaseShots;
  $("phase-hits").textContent = s.phaseHits;
  $("phase-kills").textContent = s.phaseKills;
  $("pause-button").textContent = s.paused ? "RESUME" : "PAUSE";
  const exact = pollExactSnapshot();
  updateCarrierUI(s, exact);
  if (sidecarOn) {
    const bridge = sidecarBridge();
    const now = performance.now();
    if (bridge && bridge.state === "online" && now - lastSidecarSnapshot >= 500) {
      lastSidecarSnapshot = now;
      bridge.snapshot(s);
    }
  }
  drainCapture();
  drainCanonical();
}

function applySettings() {
  let settings = {};
  try { settings = JSON.parse(safeGet(SETTINGS_KEY) || "{}"); } catch (_) {}
  const phase = settings.phase !== false;
  const scan = settings.scan !== false;
  const sidecar = settings.sidecar === true;
  const ruleset = Number.isInteger(settings.ruleset) && settings.ruleset >= 0 && settings.ruleset <= 2 ? settings.ruleset : 1;
  muted = settings.muted === true;
  sensitivity = Number(settings.sensitivity) || 1;
  $("ruleset-select").value = String(ruleset);
  $("phase-toggle").checked = phase;
  $("scan-toggle").checked = scan;
  $("sidecar-toggle").checked = sidecar;
  if (sidecar !== sidecarOn) applySidecar(sidecar);
  $("sensitivity").value = String(sensitivity);
  $("sensitivity-value").textContent = `${sensitivity.toFixed(1)}×`;
  document.querySelector(".screen-scan").classList.toggle("off", !scan);
  $("module-state").textContent = phase ? "ARMED" : "BYPASSED";
  $("sound-button").textContent = muted ? "SOUND OFF" : "SOUND ON";
  if (ready) {
    call("ZEQ_SetRuleset", [ruleset]);
    call("ZEQ_SetPhaseBonus", [phase ? 1 : 0]);
    call("ZEQ_SetMuted", [muted ? 1 : 0]);
  }
}
function persistSettings() {
  safeSet(SETTINGS_KEY, JSON.stringify({ ruleset: Number($("ruleset-select").value), phase: $("phase-toggle").checked, scan: $("scan-toggle").checked, sidecar: $("sidecar-toggle").checked, muted, sensitivity }));
  applySettings();
  if (ready) pollExactSnapshot();
}

function startDeployment() {
  if (!ready) return;
  releaseAll();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  started = true;
  // Discard attract-demo records, then begin a fresh ruleset-scoped run chain.
  while (call("ZEQ_GetEvent")) {}
  while (call("ZEQ_GetImpulseRecord")) {}
  impulseRecords = [];
  resetCapture(true);
  resetCanonical(35);
  ledger = [];
  runDescriptorPromise = null;
  proofSessionId = randomHex(16);
  proofSignerPromise = null;
  safeSet(LEDGER_KEY, "[]");
  $("event-stream").innerHTML = '<li class="empty-event">New deployment. Waiting for engine events.</li>';
  $("ledger-verdict").textContent = "UNVERIFIED";
  updateLedger();
  call("ZEQ_NewGame", [2]);
  $("title-screen").classList.add("dismissed");
  $("save-button").disabled = false;
  $("export-save-button").disabled = false;
  canvas.focus();
}
$("start-button").addEventListener("click", startDeployment);
$("deploy-ruleset").addEventListener("click", startDeployment);
$("continue-button").addEventListener("click", loadCapsule);
$("save-button").addEventListener("click", saveCapsule);
$("export-save-button").addEventListener("click", exportSave);
$("capsule-form").addEventListener("submit", (event) => { event.preventDefault(); submitCapsule(); });
$("pause-button").addEventListener("click", () => { keyEvent(true, 255); keyEvent(false, 255); canvas.focus(); });
$("sound-button").addEventListener("click", () => { muted = !muted; persistSettings(); });
$("fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("screen-frame").requestFullscreen();
  } catch (_) { toast("FULLSCREEN IS NOT AVAILABLE"); }
});
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
  releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  $(button.dataset.open).showModal();
}));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
  const dialog = button.closest("dialog");
  if (dialog.id === "capsule-dialog" && capsuleBusy) return;
  dialog.close();
}));
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => { if (dialog.id === "capsule-dialog" && capsuleBusy) event.preventDefault(); });
  dialog.addEventListener("click", (event) => {
    if (dialog.id === "capsule-dialog" && capsuleBusy) return;
    if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); }
  });
});
$("ruleset-select").addEventListener("change", persistSettings);
$("phase-toggle").addEventListener("change", persistSettings);
$("scan-toggle").addEventListener("change", persistSettings);
$("sidecar-toggle").addEventListener("change", persistSettings);
$("sensitivity").addEventListener("input", () => { sensitivity = Number($("sensitivity").value); $("sensitivity-value").textContent = `${sensitivity.toFixed(1)}×`; });
$("sensitivity").addEventListener("change", persistSettings);
$("signed-mod-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (contentLoadBusy) return;
  const button = $("load-signed-mod");
  button.disabled = true;
  $("mod-load-status").textContent = "VERIFYING SIGNATURE, TRUST, DIGEST, AND PWAD";
  $("mod-load-status").dataset.state = "";
  try {
    const manifestFile = $("mod-manifest").files[0];
    const wadFile = $("mod-wad").files[0];
    if (!manifestFile || !wadFile) throw new Error("manifest and PWAD are required");
    if (manifestFile.size > ZeqContent.MAX_MANIFEST_BYTES || wadFile.size > ZeqContent.MAX_MOD_FILE_BYTES)
      throw new Error("signed content exceeds its size limit");
    const manifest = JSON.parse(await manifestFile.text());
    const wad = new Uint8Array(await wadFile.arrayBuffer());
    const result = await loadSignedWad(manifest, wad, $("mod-trusted-key").value.trim());
    toast(result.ok ? `SIGNED PWAD LOADED / ${result.evidence.lumpCount} LUMPS` : `PWAD REFUSED / ${result.why.toUpperCase()}`);
  } catch (error) {
    await refuseSignedWad(error.message || "unable to read signed content", null, "loader");
    toast(`PWAD REFUSED / ${error.message.toUpperCase()}`);
  } finally { button.disabled = !ready; }
});
$("verify-ledger").addEventListener("click", verifyLedger);
$("download-proof").addEventListener("click", downloadSignedProof);
$("download-input").addEventListener("click", downloadInputCapture);
$("phase3-self-test").addEventListener("click", async () => {
  $("phase3-self-test").disabled = true;
  $("phase3-self-test").textContent = "PHASE 3 TESTS RUNNING";
  try {
    const result = await runPhase3SelfTest();
    $("phase3-self-test").textContent = result.ok ? "PHASE 3 / ALL CHECKS PASS" : "PHASE 3 / FAILURE";
    toast(result.ok ? "SIGNED LOGS + REPLAY REFUSAL + ZEQC3 PASS" : "PHASE 3 TEST FAILURE");
  } catch (error) { $("phase3-self-test").textContent = "PHASE 3 / WORKER FAILURE"; toast(error.message.toUpperCase()); }
  finally { $("phase3-self-test").disabled = false; }
});
$("phase5-self-test").addEventListener("click", async () => {
  $("phase5-self-test").disabled = true;
  $("phase5-self-test").textContent = "PHASE 5 SDK TESTS RUNNING";
  try {
    const result = await ZeqContent.selfTest();
    $("phase5-self-test").textContent = result.ok ? "PHASE 5 SDK / ALL CHECKS PASS" : "PHASE 5 SDK / FAILURE";
    toast(result.ok ? "SIGNED MODS + SEALED PARCELS PASS" : "PHASE 5 SDK TEST FAILURE");
  } catch (error) { $("phase5-self-test").textContent = "PHASE 5 SDK / FAILURE"; toast(error.message.toUpperCase()); }
  finally { $("phase5-self-test").disabled = false; }
});
$("exact-self-test").addEventListener("click", () => runExactConformance(true));
$("download-ledger").addEventListener("click", async () => {
  await eventChain;
  const active = lastExactSnapshot?.ruleset ?? 1;
  const payload = {
    format: "zeq-doom-ledger-v1", hash: "SHA-256", engine: "doomgeneric",
    ruleset: rulesetIds[active], eventClock: "legacy-numeric-1287/35000-per-tic telemetry compatibility",
    exactClock: "zeq-time-v1", physicsFormat: active === 1 ? "zeq-physics-v1" : "disabled",
    impulseFormat: active === 1 ? "zeq-impulse-half-sine-v1" : "disabled", exactZeqondNs: "777000777",
    scope: "Integrity of this local event chain only; not proof of competitive legitimacy.", events: ledger,
    impulseTelemetry: { records: impulseRecords, integrity: "Raw engine telemetry export; these records are not included in the event hash chain." }
  };
  downloadBytes(new TextEncoder().encode(JSON.stringify(payload, null, 2)), "zeq-doom-ledger.json", "application/json");
});

window.addEventListener("keydown", (event) => {
  const key = keys[event.code];
  if (key === undefined || !started || document.querySelector("dialog[open]") || /INPUT|BUTTON/.test(event.target.tagName)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!isKeyHeld(event.code)) pressKey(event.code, key);
}, true);
window.addEventListener("keyup", (event) => {
  if (!keyHolds.has(event.code)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  releaseKey(event.code);
}, true);
window.addEventListener("blur", releaseAll);
window.addEventListener("pagehide", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerdown", (event) => {
  if (!started || event.pointerType === "touch") return;
  canvas.focus();
  if (event.button === 0) {
    mouseDown = true; callReadyMouse(0, 0, 1);
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  }
});
window.addEventListener("pointerup", (event) => {
  if (event.button === 0 && mouseDown) { mouseDown = false; callReadyMouse(0, 0, 0); }
});
window.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement === canvas && started) callReadyMouse(Math.round(event.movementX * sensitivity), Math.round(event.movementY * sensitivity), mouseDown ? 1 : 0);
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || !started) return;
  event.preventDefault();
  try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
  touchAim = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointermove", (event) => {
  if (!touchAim || touchAim.id !== event.pointerId) return;
  event.preventDefault();
  const dx = Math.round((event.clientX - touchAim.x) * 1.5);
  const dy = Math.round((event.clientY - touchAim.y) * 1.5);
  touchAim.x = event.clientX; touchAim.y = event.clientY;
  callReadyMouse(dx, dy, 0);
});
function endTouchAim(event) { if (touchAim?.id === event.pointerId) touchAim = null; }
canvas.addEventListener("pointerup", endTouchAim);
canvas.addEventListener("pointercancel", endTouchAim);

document.querySelectorAll("[data-key]").forEach((button) => {
  const key = Number(button.dataset.key);
  const press = (event) => {
    if (!started) return;
    event.preventDefault();
    try { button.setPointerCapture(event.pointerId); } catch (_) {}
    pressKey(`touch-${event.pointerId}`, key);
  };
  const release = (event) => {
    const id = `touch-${event.pointerId}`;
    if (!keyHolds.has(id)) return;
    event.preventDefault(); releaseKey(id);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

window.ZeqDiagnostics = Object.freeze({
  selfTest: () => runExactConformance(false),
  snapshot: () => lastExactSnapshot ? JSON.parse(JSON.stringify(lastExactSnapshot)) : null,
  game: () => lastSnapshot ? { ...lastSnapshot } : null,
  impulses: () => JSON.parse(JSON.stringify(impulseRecords)),
  ledger: () => JSON.parse(JSON.stringify(ledger)),
  signedProof: () => buildSignedProof(),
  verifySignedProof: (proof) => ZeqSecurity.verifyProof(proof),
  phase3SelfTest: () => runPhase3SelfTest(),
  phase5SelfTest: () => ZeqContent.selfTest(),
  loadSignedWad: (manifest, bytes, trustedKeyId) => loadSignedWad(manifest, bytes, trustedKeyId),
  contentEvidence: () => lastContentEvidence ? JSON.parse(JSON.stringify(lastContentEvidence)) : null,
  engineContentEvidence: () => readContentEvidence(),
  contentLumpPresent: (name) => Module.ccall("ZEQ_ContentLumpPresent", "number", ["string"], [String(name)]),
  contentLump: (name) => {
    const pointer = Module._malloc(4096);
    if (!pointer) return { ok: false, status: -2 };
    try {
      const length = Module.ccall("ZEQ_ContentReadLump", "number", ["string", "number", "number"], [String(name), pointer, 4096]);
      return length < 0 ? { ok: false, status: length } : { ok: true, data: Array.from(HEAPU8.slice(pointer, pointer + length)) };
    } finally { Module._free(pointer); }
  },
  capsuleStored: () => { const data = readSave(); return data ? { bytes: data.length, zeqc3: isZeqc3(data), magic: bytesToBase64(data.subarray(0, 5)) } : null; },
  canonical: () => ({ checkpoints: canonicalCheckpoints.map((checkpoint) => ({ ...checkpoint })), dropped: canonicalDropped, errors: canonicalErrors }),
  input: () => ({ holds: [...keyHolds.values()].map((hold) => ({ id: hold.id, key: hold.key, released: hold.released, finished: hold.finished })), counts: Object.fromEntries(keyCounts) })
});

restoreLedger();
refreshContinue();
applySettings();
runExactConformance(false);
setInterval(pollSnapshot, 50);
setInterval(drainEvents, 40);
