"use strict";
/*
 * The real browser game on a live machine.
 *
 * Serves the WebAssembly build (dist/, from build-web.sh), opens it in Chromium,
 * starts E1M1, holds fire, connects the panel to a machine born on this device,
 * and checks that the machine decided the shots the running engine made.
 *
 * Needs dist/, ZEQ_MACHINE_DIR, ZEQ_KEY_FILE, ZEQ_PIN_FILE and Playwright's Chromium.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Link = require("../zq/zeq-link.js");

(async () => {
  const root = path.join(__dirname, "..", ".."), dist = path.join(root, "dist");
  const dir = process.env.ZEQ_MACHINE_DIR, keyFile = process.env.ZEQ_KEY_FILE;
  if (!fs.existsSync(path.join(dist, "doomgeneric.wasm"))) { console.log("Browser game OK: unavailable (no dist/; run build-web.sh)"); return; }
  if (!dir || !keyFile) { console.log("Browser game OK: unavailable (set ZEQ_MACHINE_DIR, ZEQ_KEY_FILE and ZEQ_PIN_FILE)"); return; }
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (_) { console.log("Browser game OK: unavailable (Playwright is not installed)"); return; }

  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
  const site = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const f = path.join(dist, p);
    if (!f.startsWith(dist) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((ok) => site.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const key = fs.readFileSync(keyFile, "utf8").trim();
  /* the machine answers this page's origin and no other */
  const machine = await Link.serve({ dir, keyFile, port: Number(process.env.ZEQ_PORT || 8798), origins: origin });
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/");
    await page.waitForFunction(() => typeof Module === "object" && Module.calledRun && typeof window.ZeqMachinePanel === "object", null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    assert.equal(await page.locator("#zm-status").innerText(), "not connected"); checks++;

    await page.fill("#zm-url", machine.url); await page.fill("#zm-key", key); await page.click("#zm-connect");
    await page.waitForFunction(() => window.ZeqMachinePanel.state.connected || window.ZeqMachinePanel.state.error, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.ZeqMachinePanel.state.error), "");
    assert.equal(await page.inputValue("#zm-key"), ""); checks += 2;

    /* play: enter the level and hold fire */
    await page.click("text=ENTER E1M1"); await page.waitForTimeout(2500);
    await page.keyboard.down("Control"); await page.waitForTimeout(6000); await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    const state = await page.evaluate(async () => { await window.ZeqMachinePanel.idle(); return { ...window.ZeqMachinePanel.state, fires: window.ZeqMachinePanel.host().stats.fires, weaponId: window.ZeqMachinePanel.bridge().weapon.id }; });
    assert.ok(state.events > 0, "the running engine's events reached the panel");
    assert.ok(state.accepted >= 5, `the machine accepted ${state.accepted} shots`);
    assert.equal(state.refused, 0, "the engine's own cooldown never asks for a shot the rule refuses");
    assert.equal(state.player, "alive"); checks += 4;

    /* the machine's own record agrees with the page */
    const weapon = await machine.link.contracts.get(state.weaponId);
    assert.equal(weapon.definition.name, "doom.weapon");
    assert.equal(weapon.fires, state.fires, "every transition the page counted is a row on the machine's chain");
    assert.equal(weapon.chain_valid, true); checks += 3;
    assert.match(await page.locator("#zm-readout").innerText(), /accepted \d+\s+refused 0/);
    const leaked = await page.evaluate((k) => [JSON.stringify(Object.assign({}, localStorage)), document.cookie, location.href, document.documentElement.outerHTML].some((s) => s.includes(k)), key);
    assert.equal(leaked, false, "the key is in no storage, cookie, address or markup");
    assert.deepEqual(errors, []); checks += 3;
    console.log(`Browser game OK: ${checks} checks; the WebAssembly game played in Chromium on a live machine: ${state.events} engine events, ${state.accepted} shots accepted, ${weapon.fires} rows on the machine's chain`);
  } finally { await browser.close(); machine.stop(); site.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
