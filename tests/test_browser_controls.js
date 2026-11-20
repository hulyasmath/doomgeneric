"use strict";

const assert = require("node:assert/strict");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/";

function observe(page, errors, badResponses) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
}
async function start(page) {
  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gamestate === 0 && ZeqDiagnostics.game()?.gametic > 3);
}
async function pointer(page, selector, type, pointerId, x, y) {
  await page.locator(selector).dispatchEvent(type, {
    pointerId, pointerType: "touch", isPrimary: pointerId === 41,
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1
  });
}
async function assertReleased(page) {
  await page.waitForTimeout(120);
  assert.deepEqual(await page.evaluate(() => ZeqDiagnostics.input()), { holds: [], counts: {} });
  assert.deepEqual(await page.evaluate(() => ZeqDiagnostics.controls().analog), { forward: 0, side: 0, turn: 0 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [], badResponses = [];
  const report = { ok: false };

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await desktop.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    window.__zeqTestPad = { index: 0, id: "Zeq conformance gamepad", mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons };
    window.__zeqPadConnected = true;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => window.__zeqPadConnected ? [window.__zeqTestPad] : [] });
  });
  const page = await desktop.newPage();
  observe(page, errors, badResponses);
  await start(page);

  const beforeKeyboard = await page.evaluate(() => ZeqDiagnostics.snapshot().player);
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  const afterKeyboard = await page.evaluate(() => ZeqDiagnostics.snapshot().player);
  assert.ok(beforeKeyboard.x !== afterKeyboard.x || beforeKeyboard.y !== afterKeyboard.y);
  await assertReleased(page);

  await page.evaluate(() => { window.__zeqTestPad.axes = [0.65, -1, 0.8, 0]; });
  await page.waitForFunction(() => ZeqDiagnostics.controls().analog.forward === 127 && ZeqDiagnostics.controls().analog.turn > 90);
  const beforePad = await page.evaluate(() => ZeqDiagnostics.snapshot().player);
  await page.waitForTimeout(650);
  const afterPad = await page.evaluate(() => ZeqDiagnostics.snapshot().player);
  assert.ok(beforePad.x !== afterPad.x || beforePad.y !== afterPad.y);
  assert.notEqual(beforePad.angle, afterPad.angle);
  await page.evaluate(() => {
    window.__zeqTestPad.axes = [0, 0, 0, 0];
    window.__zeqTestPad.buttons[7] = { pressed: true, value: 1 };
  });
  const padAmmo = await page.evaluate(() => ZeqDiagnostics.game().ammo);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => ZeqDiagnostics.game().ammo), padAmmo - 1);
  await page.evaluate(() => { window.__zeqTestPad.buttons[7] = { pressed: false, value: 0 }; });
  await assertReleased(page);
  await page.evaluate(() => {
    window.__zeqTestPad.axes = [0, -1, 0, 0];
    window.__zeqTestPad.buttons[2] = { pressed: true, value: 1 };
    window.__zeqPadConnected = false;
  });
  await page.waitForFunction(() => ZeqDiagnostics.controls().gamepads.length === 0);
  await assertReleased(page);
  report.gamepad = { movement: true, turning: true, fire: true, disconnectRelease: true };

  await page.locator("#fullscreen-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.controls().fullscreen || ZeqDiagnostics.controls().expandedFallback);
  assert.equal(await page.evaluate(() => ZeqDiagnostics.controls().touchParent), "screen-frame");
  await page.screenshot({ path: "/mnt/agents/work/zeq-controls-desktop-fullscreen.png" });
  await page.locator("#fullscreen-button").click();
  await page.waitForFunction(() => !ZeqDiagnostics.controls().fullscreen && !ZeqDiagnostics.controls().expandedFallback);
  report.desktopFullscreen = true;
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  observe(mp, errors, badResponses);
  await start(mp);
  const joystick = await mp.locator(".joystick-ring").boundingBox();
  const fire = await mp.locator(".touch-fire").boundingBox();
  assert.ok(joystick && fire && joystick.x >= 0 && fire.x + fire.width <= 390);
  const jx = joystick.x + joystick.width / 2, jy = joystick.y + joystick.height / 2;
  await pointer(mp, "#touch-joystick", "pointerdown", 41, jx, jy);
  await pointer(mp, "#touch-joystick", "pointermove", 41, jx + joystick.width * 0.28, jy - joystick.height * 0.3);
  await pointer(mp, ".touch-fire", "pointerdown", 42, fire.x + fire.width / 2, fire.y + fire.height / 2);
  await mp.waitForFunction(() => ZeqDiagnostics.controls().analog.forward > 70 && ZeqDiagnostics.controls().analog.turn > 50);
  const touchAmmo = await mp.evaluate(() => ZeqDiagnostics.game().ammo);
  await mp.waitForTimeout(500);
  assert.ok((await mp.evaluate(() => ZeqDiagnostics.game().ammo)) < touchAmmo);
  await pointer(mp, ".touch-fire", "pointerup", 42, fire.x + fire.width / 2, fire.y + fire.height / 2);
  assert.ok((await mp.evaluate(() => ZeqDiagnostics.controls().analog.forward)) > 70, "fire release must not release joystick");
  await pointer(mp, "#touch-joystick", "pointercancel", 41, jx, jy);
  await assertReleased(mp);
  await pointer(mp, "#touch-joystick", "pointerdown", 43, jx, jy - 30);
  await mp.locator("#touch-joystick").dispatchEvent("lostpointercapture", { pointerId: 43, pointerType: "touch", bubbles: true });
  await assertReleased(mp);
  await mp.screenshot({ path: "/mnt/agents/work/zeq-controls-mobile.png", fullPage: true });

  await mp.locator("#fullscreen-button").click();
  await mp.waitForFunction(() => ZeqDiagnostics.controls().fullscreen || ZeqDiagnostics.controls().expandedFallback);
  const fullscreenLayout = await mp.evaluate(() => {
    const joy = document.querySelector("#touch-joystick").getBoundingClientRect();
    const fire = document.querySelector(".touch-fire").getBoundingClientRect();
    const controls = getComputedStyle(document.querySelector("#touch-controls"));
    return { joy: { left: joy.left, top: joy.top, right: joy.right, bottom: joy.bottom }, fire: { left: fire.left, top: fire.top, right: fire.right, bottom: fire.bottom }, z: Number(controls.zIndex), visibility: controls.visibility, width: innerWidth, height: innerHeight, parent: ZeqDiagnostics.controls().touchParent };
  });
  for (const rect of [fullscreenLayout.joy, fullscreenLayout.fire]) {
    assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= fullscreenLayout.width && rect.bottom <= fullscreenLayout.height);
  }
  assert.ok(fullscreenLayout.z >= 60);
  assert.equal(fullscreenLayout.visibility, "visible");
  assert.equal(fullscreenLayout.parent, "screen-frame");
  await mp.screenshot({ path: "/mnt/agents/work/zeq-controls-mobile-fullscreen.png" });
  report.mobile = { simultaneousJoystickFire: true, cancelRelease: true, lostCaptureRelease: true, fullscreenLayout };
  await mobile.close();

  const ipad = await browser.newContext({ viewport: { width: 1024, height: 1366 }, isMobile: true, hasTouch: true });
  const ip = await ipad.newPage();
  observe(ip, errors, badResponses);
  await start(ip);
  const ipadLayout = await ip.evaluate(() => {
    const controls = document.querySelector("#touch-controls");
    const fire = document.querySelector(".touch-fire").getBoundingClientRect();
    return { display: getComputedStyle(controls).display, visibility: getComputedStyle(controls).visibility, coarse: matchMedia("(pointer:coarse)").matches, fireTop: fire.top, fireRight: fire.right, fireBottom: fire.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.equal(ipadLayout.display, "flex");
  assert.equal(ipadLayout.visibility, "visible");
  assert.ok(ipadLayout.fireRight <= ipadLayout.width && ipadLayout.fireBottom <= ipadLayout.height);
  assert.equal(ipadLayout.scrollWidth, ipadLayout.width);
  await ip.screenshot({ path: "/mnt/agents/work/zeq-controls-ipad.png" });
  report.ipad = ipadLayout;
  await ipad.close();

  const fallback = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fallback.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(Element.prototype, "webkitRequestFullscreen", { configurable: true, value: undefined });
  });
  const fp = await fallback.newPage();
  observe(fp, errors, badResponses);
  await start(fp);
  await fp.locator("#fullscreen-button").click();
  await fp.waitForFunction(() => ZeqDiagnostics.controls().expandedFallback);
  assert.equal(await fp.evaluate(() => ZeqDiagnostics.controls().touchParent), "screen-frame");
  await fp.keyboard.press("Escape");
  await fp.waitForFunction(() => !ZeqDiagnostics.controls().expandedFallback);
  report.expandedFallback = true;
  await fallback.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);
  report.ok = true;
  report.consoleErrors = errors.length;
  report.badResponses = badResponses.length;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
