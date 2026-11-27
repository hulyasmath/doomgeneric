"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }
const PIN = "correct-horse-9";
const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/game.html";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  let step = "boot";
  const badResponses = [];
  const requestBodies = [];
  page.on("console", (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
    if (message.type() === "error") console.log("BROWSER ERROR:", message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(`${step}: ${error.message}`);
    console.log("PAGE ERROR AT", step, error.stack || error.message);
  });
  page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  page.on("request", (request) => requestBodies.push(request.postData() || ""));

  async function boot() {
    await page.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  }
  async function reload() {
    const previous = step;
    step = `reload after ${previous}`;
    await page.reload();
    step = `boot after ${previous}`;
    await boot();
  }
  async function typePin(target, selector, pin) {
    const field = target.locator(selector);
    await field.click();
    await field.press("ControlOrMeta+A");
    await field.press("Backspace");
    await field.pressSequentially(pin);
    assert.equal(await field.inputValue(), pin, `${selector} must accept ordinary keyboard entry`);
  }
  async function fillPin(pin, confirmation = pin) {
    await typePin(page, "#capsule-pin", pin);
    if (await page.locator("#capsule-confirm-row").isVisible()) await typePin(page, "#capsule-confirm", confirmation);
  }
  async function waitCapsuleResult() {
    await page.waitForFunction(() => {
      const dialog = document.getElementById("capsule-dialog");
      const busy = document.getElementById("capsule-busy").textContent;
      return !dialog.open || busy.includes("FAILED");
    }, null, { timeout: 60000 });
  }
  async function openStored(pin) {
    await page.locator("#continue-button").click();
    await page.locator("#capsule-dialog").waitFor({ state: "visible" });
    await fillPin(pin);
    await page.locator("#capsule-submit").click();
    await waitCapsuleResult();
  }

  step = "initial boot";
  await page.goto(URL);
  await boot();
  const selfTest = await page.evaluate(() => ZeqDiagnostics.phase3SelfTest());
  assert.equal(selfTest.ok, true, JSON.stringify(selfTest));
  assert.equal(selfTest.capsule.count, 9);
  assert.equal(selfTest.security.count, 8);
  const phase5SelfTest = await page.evaluate(() => ZeqDiagnostics.phase5SelfTest());
  assert.equal(phase5SelfTest.ok, true, JSON.stringify(phase5SelfTest));
  assert.equal(phase5SelfTest.count, 12);

  step = "new deployment";
  await page.locator("#start-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 8 && ZeqDiagnostics.game()?.gamestate === 0);
  step = "save capsule";
  await page.locator("#save-button").click();
  await page.locator("#capsule-dialog").waitFor({ state: "visible" });
  await fillPin(PIN, "correct-horse-8");
  await page.locator("#capsule-submit").click();
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("DOES NOT MATCH"));
  assert.equal(await page.locator("#capsule-dialog").isVisible(), true);
  await fillPin("12345678");
  await page.locator("#capsule-submit").click();
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("DIGITS ALONE"));
  assert.equal(await page.locator("#capsule-dialog").isVisible(), true);
  await fillPin(PIN);
  await page.locator("#capsule-submit").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#capsule-dialog").isVisible(), true, "busy dialog must not close on Escape");
  await waitCapsuleResult();
  assert.equal(await page.locator("#capsule-dialog").isVisible(), false);
  const stored = await page.evaluate(() => ZeqDiagnostics.capsuleStored());
  assert.equal(stored.zeqc3, true);
  const encodedCapsule = await page.evaluate(() => localStorage.getItem("zeq.doom.save.v1"));
  const capsule = Buffer.from(encodedCapsule, "base64");
  assert.equal(capsule.subarray(0, 5).toString(), "ZEQC3");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-save-button").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "zeq-doom-capsule.zeq");
  const exported = fs.readFileSync(await download.path());
  assert.equal(exported.equals(capsule), true);

  const proofA = await page.evaluate(() => ZeqDiagnostics.signedProof());
  const verdictA = await page.evaluate((proof) => ZeqDiagnostics.verifySignedProof(proof), proofA);
  assert.equal(verdictA.ok, true, JSON.stringify(verdictA));
  assert.equal(proofA.format, "zeq-proof-v2");
  assert.equal(proofA.run.engine_build_sha256.length, 64);
  const proofB = await page.evaluate(() => ZeqDiagnostics.signedProof());
  assert.equal(proofB.run.run_id, proofA.run.run_id);
  assert.equal(proofB.session_id, proofA.session_id);
  assert.equal(proofB.signer.key_id, proofA.signer.key_id);

  const tampered = Buffer.from(capsule);
  tampered[tampered.length - 1] ^= 1;
  await page.evaluate((encoded) => localStorage.setItem("zeq.doom.save.v1", encoded), tampered.toString("base64"));
  await reload();
  step = "tampered open";
  await openStored(PIN);
  assert.match(await page.locator("#capsule-busy").textContent(), /OPEN FAILED/);
  assert.equal(await page.locator("#capsule-dialog").isVisible(), true);
  const truncated = capsule.subarray(0, capsule.length - 1);
  await page.evaluate((encoded) => localStorage.setItem("zeq.doom.save.v1", encoded), Buffer.from(truncated).toString("base64"));
  await reload();
  step = "truncated open";
  await openStored(PIN);
  assert.match(await page.locator("#capsule-busy").textContent(), /OPEN FAILED/);
  await page.evaluate((encoded) => localStorage.setItem("zeq.doom.save.v1", encoded), encodedCapsule);
  await reload();
  step = "wrong PIN open";
  await openStored("wrong-horse-9");
  assert.match(await page.locator("#capsule-busy").textContent(), /OPEN FAILED/);
  step = "correct PIN open";
  await fillPin(PIN);
  await page.locator("#capsule-submit").click();
  await waitCapsuleResult();
  assert.equal(await page.locator("#capsule-dialog").isVisible(), false);
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 0 && ZeqDiagnostics.snapshot()?.ruleset === 1);
  assert.equal(await page.locator("#save-button").isEnabled(), true);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowUp");
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(120);
  assert.deepEqual(await page.evaluate(() => ZeqDiagnostics.input()), { holds: [], counts: {} });
  const raw = await page.evaluate(() => bytesToBase64(Module.FS.readFile("./.savegame/doomsav0.dsg")));
  step = "legacy raw open";
  await page.evaluate((encoded) => localStorage.setItem("zeq.doom.save.v1", encoded), raw);
  await reload();
  await page.locator("#continue-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 0);
  assert.equal(await page.locator("#capsule-dialog").isVisible(), false);
  assert.equal((await page.evaluate(() => ZeqDiagnostics.capsuleStored())).zeqc3, false);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  const mobile = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(mobile.scrollWidth <= mobile.width, true, JSON.stringify(mobile));
  if (process.env.ZEQ_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.ZEQ_SCREENSHOT_DIR}/phase3-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(250);
  const desktop = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.equal(desktop.scrollWidth <= desktop.width, true, JSON.stringify(desktop));
  if (process.env.ZEQ_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.ZEQ_SCREENSHOT_DIR}/phase3-desktop.png`, fullPage: true });

  step = "mobile typed PIN seal and restore";
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("console", (message) => {
    consoleMessages.push(`mobile ${message.type()}: ${message.text()}`);
    if (message.type() === "error") console.log("MOBILE BROWSER ERROR:", message.text());
  });
  mobilePage.on("pageerror", (error) => pageErrors.push(`${step}: mobile ${error.message}`));
  mobilePage.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  mobilePage.on("request", (request) => requestBodies.push(request.postData() || ""));
  await mobilePage.goto(URL);
  await mobilePage.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  await mobilePage.locator("#start-button").tap();
  await mobilePage.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 8 && ZeqDiagnostics.game()?.gamestate === 0);
  await mobilePage.locator("#save-button").tap();
  await mobilePage.locator("#capsule-dialog").waitFor({ state: "visible" });
  await mobilePage.locator("#capsule-pin").tap();
  await mobilePage.locator("#capsule-pin").pressSequentially(PIN);
  await mobilePage.locator("#capsule-confirm").tap();
  await mobilePage.locator("#capsule-confirm").pressSequentially(PIN);
  assert.equal(await mobilePage.locator("#capsule-pin").inputValue(), PIN);
  assert.equal(await mobilePage.locator("#capsule-confirm").inputValue(), PIN);
  assert.equal(await mobilePage.evaluate(() => document.activeElement.id), "capsule-confirm");
  if (process.env.ZEQ_SCREENSHOT_DIR) await mobilePage.screenshot({ path: `${process.env.ZEQ_SCREENSHOT_DIR}/capsule-mobile-typed.png`, fullPage: true });
  await mobilePage.locator("#capsule-submit").tap();
  await mobilePage.waitForFunction(() => !document.getElementById("capsule-dialog").open, null, { timeout: 60000 });
  assert.equal(await mobilePage.evaluate(() => ZeqDiagnostics.capsuleStored().zeqc3), true);
  await mobilePage.reload();
  await mobilePage.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  await mobilePage.locator("#continue-button").tap();
  await mobilePage.locator("#capsule-pin").tap();
  await mobilePage.locator("#capsule-pin").pressSequentially(PIN);
  assert.equal(await mobilePage.locator("#capsule-pin").inputValue(), PIN);
  await mobilePage.locator("#capsule-submit").tap();
  await mobilePage.waitForFunction(() => !document.getElementById("capsule-dialog").open, null, { timeout: 60000 });
  await mobilePage.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 0 && ZeqDiagnostics.snapshot()?.ruleset === 1);
  await mobileContext.close();

  const leaked = [...consoleMessages, ...pageErrors, ...requestBodies, JSON.stringify(proofA), encodedCapsule].join("\n");
  assert.doesNotMatch(leaked, /correct-horse-9|wrong-horse-9|PRIVATE KEY/);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(badResponses, []);
  const consoleErrors = consoleMessages.filter((line) => line.startsWith("error:"));
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ ok: true, selfTests: selfTest.capsule.count + selfTest.security.count,
    phase5SelfTests: phase5SelfTest.count, capsuleBytes: capsule.length, signedEvents: proofA.events.length, replay: verdictA.replay,
    wrongPinTamperTruncationRefused: true, legacyRawSaveRestored: true, exportVerified: true,
    typedPinEntry: "desktop and mobile; seal and restore", mobileOverflow: false,
    consoleErrors: consoleErrors.length, badResponses: badResponses.length }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
