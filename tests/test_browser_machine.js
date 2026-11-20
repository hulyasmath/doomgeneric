"use strict";
/* Played WASM game -> browser client -> HTTP contract evaluator -> audit.
 * The evaluator is a conformance stand-in, not an external Zeq machine. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const ZeqHost = require("../sdk/zq/zeq-host.js");
const TestMachine = require("../sdk/zq/tests/contract-test-machine.js");

(async () => {
  const root = path.join(__dirname, ".."), dist = path.join(root, "dist");
  for (const f of ["sdk/zq/zeq-browser.js", "sdk/zq/zeq-host.js", "sdk/zq/zeq-panel.js", "sdk/zq/examples/doom/doom-zeq.js", "zeq-machine.js"])
    assert.ok(fs.existsSync(path.join(dist, f)), `dist ships ${f}; run build-web.sh`);
  const machine = TestMachine.createMachine();
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".data": "application/octet-stream" };
  const site = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.resolve(dist, `.${pathname}`);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const api = await TestMachine.serve(machine, { origin });
  const browser = await chromium.launch({ headless: true });
  let checks = 5;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [], badResponses = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => { if (r.url().startsWith(origin) && r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
    await page.goto(origin + "/");
    await page.waitForFunction(() => typeof Module === "object" && Module.calledRun && typeof window.ZeqMachinePanel === "object", null, { timeout: 30000 });
    assert.equal(await page.locator("#zm-status").innerText(), "not connected");
    assert.equal(await page.evaluate(() => window.ZeqHostHook({ type: 9, gametic: 1, phase: 0, value: 1 })), null);
    checks += 2;

    await page.fill("#zm-url", api.url); await page.fill("#zm-key", api.key); await page.click("#zm-connect");
    await page.waitForFunction(() => window.ZeqMachinePanel.state.connected || window.ZeqMachinePanel.state.error, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.ZeqMachinePanel.state.error), "");
    assert.equal(await page.evaluate(() => window.ZeqMachinePanel.state.connected), true);
    assert.equal(await page.inputValue("#zm-key"), "");
    checks += 3;

    await page.click("text=ENTER E1M1"); await page.waitForTimeout(2500);
    await page.keyboard.down("Control"); await page.waitForTimeout(6000); await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    const state = await page.evaluate(async () => {
      await window.ZeqMachinePanel.idle();
      const host = window.ZeqMachinePanel.host();
      return { ...window.ZeqMachinePanel.state, fires: host.stats.fires, record: await host.record(), states: host.states() };
    });
    assert.ok(state.events > 0, "real WASM events reached the panel");
    assert.ok(state.accepted >= 5, `accepted=${state.accepted}`);
    assert.equal(state.refused, 0, "the real engine obeys its own cooldown");
    assert.equal(state.player, "alive");
    assert.equal(state.states.level, "playing");
    assert.equal(state.states.run, "clean");
    const rows = Object.values(state.record.contracts).reduce((n, c) => n + c.rows.length, 0);
    assert.equal(rows, state.fires);
    const audit = await ZeqHost.audit(machine, state.record);
    assert.ok(audit.ok, audit.problems.join());
    checks += 8;
    assert.match(await page.locator("#zm-readout").innerText(), /accepted \d+\s+refused 0/);
    const leaked = await page.evaluate((key) => [JSON.stringify(Object.assign({}, localStorage)), JSON.stringify(Object.assign({}, sessionStorage)), document.cookie, location.href, document.documentElement.outerHTML].some((s) => s.includes(key)), api.key);
    assert.equal(leaked, false);
    assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
    checks += 4;
    await page.screenshot({ path: "/mnt/agents/work/browser-states/contract-desktop.png", fullPage: true });
    await page.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mobileErrors = []; mobile.on("pageerror", (e) => mobileErrors.push(e.message));
    await mobile.goto(origin + "/");
    await mobile.waitForFunction(() => typeof Module === "object" && Module.calledRun && typeof window.ZeqMachinePanel === "object", null, { timeout: 30000 });
    await mobile.click("text=ENTER E1M1"); await mobile.waitForTimeout(2500);
    const layout = await mobile.evaluate(() => {
      const panel = document.getElementById("zeq-machine"), joy = document.getElementById("touch-joystick"), fire = document.querySelector(".touch-fire");
      const pr = panel.getBoundingClientRect(), jr = joy.getBoundingClientRect(), fr = fire.getBoundingClientRect();
      const top = (r) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, panelInside: pr.left >= 0 && pr.right <= innerWidth,
        joystickTop: top(jr) === joy || joy.contains(top(jr)), fireTop: top(fr) === fire || fire.contains(top(fr)) };
    });
    assert.ok(layout.panelInside && layout.scroll <= layout.viewport && layout.joystickTop && layout.fireTop, JSON.stringify(layout));
    assert.deepEqual(mobileErrors, []);
    checks += 2;
    await mobile.screenshot({ path: "/mnt/agents/work/browser-states/contract-mobile.png", fullPage: true });
    await mobile.close();
    console.log(`Browser machine OK: ${checks} checks; played WASM, ${state.events} real engine events, ${state.accepted} accepted, ${rows} audited test-chain rows; key not persisted; desktop/mobile controls usable`);
  } finally { await browser.close(); await api.close(); await new Promise((resolve) => site.close(resolve)); }
})().catch((error) => { console.error(error); process.exit(1); });
