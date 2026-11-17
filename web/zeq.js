"use strict";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const SAVE_KEY = "zeq.doom.save.v1";
const SETTINGS_KEY = "zeq.doom.settings.v1";
const LEDGER_KEY = "zeq.doom.ledger.v1";
const ZERO_HASH = "0".repeat(64);
const eventNames = {
  1: "PHASE SHOT", 2: "PHASE HIT", 3: "PHASE KILL", 4: "LEVEL ENTER",
  5: "DAMAGE TAKEN", 6: "PLAYER DEATH", 7: "CAPSULE SAVED", 8: "CAPSULE LOADED"
};
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
for (let i = 65; i <= 90; i++) keys[`Key${String.fromCharCode(i)}`] = i + 32;

let ready = false;
let started = false;
let muted = false;
let sensitivity = 1;
let mouseDown = false;
let toastTimer = 0;
let flashTimer = 0;
let lastSnapshot = null;
let eventChain = Promise.resolve();
let ledger = [];
let touchAim = null;
const keyHolds = new Map();
const MIN_HOLD_MS = 48;
let holdEpoch = 0;

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
  const gen = (keyHolds.get(id)?.gen || 0) + 1;
  keyHolds.set(id, { key, since: performance.now(), gen });
  keyEvent(true, key);
}
function releaseKey(id) {
  const hold = keyHolds.get(id);
  if (!hold) return;
  keyHolds.delete(id);
  // Doom samples the key queue once per 35 Hz gametic; never let a press
  // and its release collapse into the same batch.
  const wait = Math.max(0, MIN_HOLD_MS - (performance.now() - hold.since));
  const epoch = holdEpoch;
  setTimeout(() => {
    if (epoch !== holdEpoch) return;
    if (keyHolds.get(id)?.gen > hold.gen) return;
    keyEvent(false, hold.key);
  }, wait);
}
function releaseAll() {
  holdEpoch++;
  keyHolds.forEach((hold) => keyEvent(false, hold.key));
  keyHolds.clear();
  if (mouseDown) { callReadyMouse(0, 0, 0); mouseDown = false; }
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
    applySettings();
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
function saveCapsule() {
  if (!ready || !started) return;
  try {
    call("ZEQ_SaveGame");
    $("save-button").disabled = true;
    setTimeout(() => {
      try {
        const data = Module.FS.readFile("./.savegame/doomsav0.dsg");
        if (!data.length) throw new Error("Empty save");
        if (!safeSet(SAVE_KEY, bytesToBase64(data))) throw new Error("Browser storage unavailable");
        refreshContinue();
        toast(`CAPSULE SAVED / ${data.length.toLocaleString()} BYTES`);
      } catch (error) {
        console.warn(error);
        toast("SAVE UNAVAILABLE / ENTER A LEVEL FIRST");
      } finally {
        $("save-button").disabled = false;
      }
    }, 180);
  } catch (error) {
    console.warn(error);
    $("save-button").disabled = false;
    toast("SAVE UNAVAILABLE / ENTER A LEVEL FIRST");
  }
}
function loadCapsule() {
  if (!ready) return;
  const data = readSave();
  if (!data) { toast("NO LOCAL CAPSULE FOUND"); return; }
  try {
    Module.FS.writeFile("./.savegame/doomsav0.dsg", data);
    started = true;
    $("title-screen").classList.add("dismissed");
    $("save-button").disabled = false;
    $("export-save-button").disabled = false;
    call("ZEQ_LoadGame");
    canvas.focus();
    toast("LOCAL CAPSULE RESTORED");
  } catch (error) {
    console.warn(error);
    toast("CAPSULE COULD NOT BE LOADED");
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
  if (data) downloadBytes(data, "zeq-doom-capsule.dsg");
  else toast("NO EXPORTED CAPSULE AVAILABLE");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function recordPayload(record) {
  return JSON.stringify({ seq: record.seq, type: record.type, tic: record.tic, phase: record.phase, value: record.value, previousHash: record.previousHash });
}
function queueEngineEvent(event) {
  eventChain = eventChain.then(async () => {
    const previousHash = ledger.length ? ledger[ledger.length - 1].hash : ZERO_HASH;
    const record = { seq: ledger.length, type: event.type, tic: event.tic, phase: event.phase, value: event.value, previousHash };
    record.hash = await sha256(recordPayload(record));
    ledger.push(record);
    safeSet(LEDGER_KEY, JSON.stringify(ledger));
    updateLedger();
    addEventToStream(record);
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
}
function percent(value, total) { return total > 0 ? Math.round(100 * value / total) : 0; }
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
  $("stat-zeqond").textContent = s.zeqond.toLocaleString();
  $("phase-shots").textContent = s.phaseShots;
  $("phase-hits").textContent = s.phaseHits;
  $("phase-kills").textContent = s.phaseKills;
  $("phase-cursor").style.left = `${100 * s.phase / 35000}%`;
  $("phase-value").textContent = `φ ${(s.phase / 35000).toFixed(3)}`;
  $("carrier-pulse").textContent = `R(t) ${(s.pulse / 1000).toFixed(3)}`;
  $("phase-status").textContent = s.aligned ? "PHASE LOCKED" : s.paused ? "PAUSED" : "SEEKING PHASE";
  $("phase-status").classList.toggle("locked", !!s.aligned);
  $("pause-button").textContent = s.paused ? "RESUME" : "PAUSE";
  if (sidecarOn) {
    const bridge = sidecarBridge();
    const now = performance.now();
    if (bridge && bridge.state === "online" && now - lastSidecarSnapshot >= 500) {
      lastSidecarSnapshot = now;
      bridge.snapshot(s);
    }
  }
}

function applySettings() {
  let settings = {};
  try { settings = JSON.parse(safeGet(SETTINGS_KEY) || "{}"); } catch (_) {}
  const phase = settings.phase !== false;
  const scan = settings.scan !== false;
  const sidecar = settings.sidecar === true;
  muted = settings.muted === true;
  sensitivity = Number(settings.sensitivity) || 1;
  $("phase-toggle").checked = phase;
  $("scan-toggle").checked = scan;
  $("sidecar-toggle").checked = sidecar;
  if (sidecar !== sidecarOn) applySidecar(sidecar);
  $("sensitivity").value = String(sensitivity);
  $("sensitivity-value").textContent = `${sensitivity.toFixed(1)}×`;
  document.querySelector(".screen-scan").classList.toggle("off", !scan);
  $("module-state").textContent = phase ? "ARMED" : "BYPASSED";
  $("sound-button").textContent = muted ? "SOUND OFF" : "SOUND ON";
  if (ready) { call("ZEQ_SetPhaseBonus", [phase ? 1 : 0]); call("ZEQ_SetMuted", [muted ? 1 : 0]); }
}
function persistSettings() {
  safeSet(SETTINGS_KEY, JSON.stringify({ phase: $("phase-toggle").checked, scan: $("scan-toggle").checked, sidecar: $("sidecar-toggle").checked, muted, sensitivity }));
  applySettings();
}

$("start-button").addEventListener("click", () => {
  if (!ready) return;
  started = true;
  // Discard attract-demo events, then begin a fresh run chain.
  while (call("ZEQ_GetEvent")) {}
  ledger = [];
  safeSet(LEDGER_KEY, "[]");
  $("event-stream").innerHTML = '<li class="empty-event">New deployment. Waiting for engine events.</li>';
  $("ledger-verdict").textContent = "UNVERIFIED";
  updateLedger();
  call("ZEQ_NewGame", [2]);
  $("title-screen").classList.add("dismissed");
  $("save-button").disabled = false;
  $("export-save-button").disabled = false;
  canvas.focus();
});
$("continue-button").addEventListener("click", loadCapsule);
$("save-button").addEventListener("click", saveCapsule);
$("export-save-button").addEventListener("click", exportSave);
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
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); }
}));
$("phase-toggle").addEventListener("change", persistSettings);
$("scan-toggle").addEventListener("change", persistSettings);
$("sidecar-toggle").addEventListener("change", persistSettings);
$("sensitivity").addEventListener("input", () => { sensitivity = Number($("sensitivity").value); $("sensitivity-value").textContent = `${sensitivity.toFixed(1)}×`; });
$("sensitivity").addEventListener("change", persistSettings);
$("verify-ledger").addEventListener("click", verifyLedger);
$("download-ledger").addEventListener("click", async () => {
  await eventChain;
  const payload = { format: "zeq-doom-ledger-v1", hash: "SHA-256", engine: "doomgeneric", carrierHz: 1.287, scope: "Integrity of this local event chain only; not proof of competitive legitimacy.", events: ledger };
  downloadBytes(new TextEncoder().encode(JSON.stringify(payload, null, 2)), "zeq-doom-ledger.json", "application/json");
});

window.addEventListener("keydown", (event) => {
  const key = keys[event.code];
  if (key === undefined || !started || document.querySelector("dialog[open]") || /INPUT|BUTTON/.test(event.target.tagName)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!keyHolds.has(event.code)) pressKey(event.code, key);
}, true);
window.addEventListener("keyup", (event) => {
  if (!keyHolds.has(event.code)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  releaseKey(event.code);
}, true);
window.addEventListener("blur", releaseAll);
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

restoreLedger();
refreshContinue();
applySettings();
setInterval(pollSnapshot, 50);
setInterval(drainEvents, 40);
