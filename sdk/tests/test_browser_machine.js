"use strict";
/* The browser game's path to a Zeq machine: the page's own scripts in a real Chromium, fed the REAL engine's events.
 * The WASM game is not needed (and needs Emscripten to build): the events come from the native headless engine, the
 * same C code, and enter the page exactly where web/zeq.js hands them over, window.ZeqHostHook.
 * Needs ZEQ_MACHINE_DIR, ZEQ_KEY_FILE, ZEQ_PIN_FILE, Playwright, and the built headless engine with doom1.wad. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Link = require("../zq/zeq-link.js");
const Replay = require("../zeq-replay.js");

(async () => {
  const root = path.join(__dirname, "..", ".."), dir = process.env.ZEQ_MACHINE_DIR, keyFile = process.env.ZEQ_KEY_FILE;
  const shell = fs.readFileSync(path.join(root, "web", "shell.html"), "utf8"), game = fs.readFileSync(path.join(root, "web", "zeq.js"), "utf8");
  for (const s of ["sdk/zq/zeq-browser.js", "sdk/zq/examples/doom/doom-zeq.js", "zeq-machine.js"]) assert.ok(shell.includes(`<script src="${s}"></script>`), `shell.html loads ${s}`);
  assert.ok(shell.indexOf("zeq-machine.js") > shell.indexOf("zeq-browser.js"), "the SDK loads before the panel");
  assert.ok(/window\.ZeqHostHook\(\{ type: record\.type, gametic: record\.tic, phase: record\.phase, value: record\.value \}\)/.test(game), "web/zeq.js hands every event to the hook");
  const build = fs.readFileSync(path.join(root, "build-web.sh"), "utf8");
  for (const f of ["zeq-machine.js", "zeq-browser.js", "doom-zeq.js"]) assert.ok(build.includes(f), `build-web.sh ships ${f}`);
  if (!dir || !keyFile) { console.log("Browser machine OK: 6 checks offline; live unavailable (set ZEQ_MACHINE_DIR, ZEQ_KEY_FILE, ZEQ_PIN_FILE)"); return; }
  if (!fs.existsSync(path.join(root, "doomgeneric", "doomgeneric-headless")) || !fs.existsSync(path.join(root, "doomgeneric", "doom1.wad"))) { console.log("Browser machine OK: 6 checks offline; real engine unavailable (sh build-headless.sh, with doom1.wad)"); return; }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (_) { console.log("Browser machine OK: 6 checks offline; Playwright unavailable"); return; }

  /* the real engine: E1M1, fire held for 700 tics */
  const commands = Array.from({ length: 700 }, (_, gametic) => ({ gametic, forwardmove: 0, sidemove: 0, angleturn: 0, chatchar: 0, buttons: 1, consistancy: 0, buttons2: 0, inventory: 0, lookfly: 0, arti: 0 }));
  const recorded = await Replay.runHeadless({ maxTic: 700, commands });
  /* as web/zeq.js builds them from the engine's ring: {type, gametic, phase, value} */
  const events = recorded.events.map((e) => ({ type: Number(e.type), gametic: Number(e.gametic), phase: Number(e.phase), value: Number(e.value) }));

  const page0 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeq-page-")), "index.html");
  fs.writeFileSync(page0, `<!doctype html><meta charset="utf-8"><title>hook</title><body>
<script src="file://${path.join(root, "sdk", "zq", "zeq-browser.js")}"></script>
<script src="file://${path.join(root, "sdk", "zq", "examples", "doom", "doom-zeq.js")}"></script>
<script src="file://${path.join(root, "web", "zeq-machine.js")}"></script></body>`);
  const port = Number(process.env.ZEQ_PORT || 8797), key = fs.readFileSync(keyFile, "utf8").trim();
  const machine = await Link.serve({ dir, keyFile, port });
  const browser = await chromium.launch();
  let checks = 6;
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + page0);
    assert.equal(await page.locator("#zm-status").innerText(), "not connected");
    /* before connecting, the game's events go nowhere and cost nothing */
    assert.equal(await page.evaluate((e) => window.ZeqHostHook(e), events[1]), null); checks += 2;

    await page.fill("#zm-url", machine.url); await page.fill("#zm-key", key); await page.click("#zm-connect");
    await page.waitForFunction(() => window.ZeqMachinePanel.state.connected || window.ZeqMachinePanel.state.error, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.ZeqMachinePanel.state.error), "");
    assert.equal(await page.inputValue("#zm-key"), "", "the key field is cleared"); checks += 2;

    /* the real engine's events, handed over one by one as the game does, without waiting */
    const state = await page.evaluate(async (list) => { for (const e of list) window.ZeqHostHook(e); await window.ZeqMachinePanel.idle(); return { ...window.ZeqMachinePanel.state }; }, events);
    const shots = events.filter((e) => e.type === 9).length;
    assert.ok(shots >= 30, `${shots} real shots`);
    assert.equal(state.events, events.length);
    assert.equal(state.accepted, shots, "the machine accepted every shot the real engine made");
    assert.equal(state.refused, 0);
    assert.equal(state.weapon, "cooling"); assert.equal(state.player, "alive"); checks += 6;
    assert.match(await page.locator("#zm-readout").innerText(), new RegExp(`events ${events.length}\\s+accepted ${shots}\\s+refused 0`)); checks++;

    /* the machine's own record of what the page sent */
    const weaponId = await page.evaluate(() => window.ZeqMachinePanel.bridge().weapon.id);
    const weapon = await machine.link.contracts.get(weaponId);
    assert.equal(weapon.rows.length, weapon.fires);
    assert.equal(weapon.fires, 2 * shots - 1, "one row per transition on the machine's chain");
    const leaked = await page.evaluate((k) => [JSON.stringify(Object.assign({}, localStorage)), document.cookie, location.href, document.documentElement.outerHTML].some((s) => s.includes(k)), key);
    assert.equal(leaked, false, "the key is in no storage, cookie, address or markup");
    assert.deepEqual(errors, []); checks += 3;
    console.log(`Browser machine OK: ${checks} checks; a real Chromium page running the game's own panel decided the real engine's ${events.length} events on a live machine: ${shots} of ${shots} shots accepted, ${weapon.fires} rows on its chain`);
  } finally { await browser.close(); machine.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
