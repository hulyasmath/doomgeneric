"use strict";

const assert = require("node:assert/strict");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/";
const SHOTS = process.env.ZEQ_SCREENSHOT_DIR || "/mnt/agents/work/sdk-guide-evidence";

(async () => {
  const fs = require("node:fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], badResponses = [];
  const observe = (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  };
  const boot = async (page) => {
    await page.goto(URL);
    await page.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  observe(page);
  await boot(page);
  await page.locator('.top-actions [data-open="sdk-dialog"]').click();
  await page.locator("#sdk-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#sdk-dialog h2").textContent(), /Keep your engine/);
  const links = await page.locator("#sdk-dialog .sdk-links a").evaluateAll((nodes) => nodes.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert.equal(links.length, 5);
  for (const link of links) {
    const parsed = new globalThis.URL(link.href);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hostname, "github.com");
    assert.ok(parsed.pathname.startsWith("/hulyasmath/"));
    assert.equal(link.target, "_blank");
    assert.match(link.rel, /noopener/);
  }
  const snippets = await page.locator("#sdk-dialog details").evaluateAll((nodes) => nodes.map((node) => ({ open: node.open, height: node.getBoundingClientRect().height })));
  assert.equal(snippets[0].open, true);
  assert.ok(snippets[0].height > 44);
  assert.equal(snippets[1].open, false);
  await page.locator("#sdk-dialog details").nth(1).locator("summary").click();
  assert.equal(await page.locator("#sdk-dialog details").nth(1).getAttribute("open"), "");
  await page.locator('[data-copy-target="sdk-c-snippet"]').click();
  await page.waitForFunction(() => document.getElementById("sdk-copy-status").textContent.includes("C EXACT-TIME SNIPPET COPIED"));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /ZEQ_TimeFromTic\(host_tick, host_tick_rate, &instant\)/);
  await page.locator('[data-copy-target="sdk-js-snippet"]').click();
  await page.waitForFunction(() => document.getElementById("sdk-copy-status").textContent.includes("JAVASCRIPT EXACT-TIME SNIPPET COPIED"));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /ZeqSDK\.time\.fromTic\(hostTick, hostTickRate\)/);
  await page.screenshot({ path: `${SHOTS}/sdk-guide-desktop.png` });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("sdk-dialog").open);
  await page.locator('.sdk-module [data-open="sdk-dialog"]').click();
  await page.locator("#sdk-dialog").waitFor({ state: "visible" });
  await page.locator('#sdk-dialog [data-close]').click();
  await page.waitForFunction(() => !document.getElementById("sdk-dialog").open);
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  observe(mp);
  await boot(mp);
  const topSdk = mp.locator('.top-actions [data-open="sdk-dialog"]');
  assert.equal(await topSdk.isVisible(), true);
  const topRect = await topSdk.boundingBox();
  assert.ok(topRect.x >= 0 && topRect.x + topRect.width <= 390 && topRect.height >= 44);
  await topSdk.tap();
  await mp.locator("#sdk-dialog").waitFor({ state: "visible" });
  await mp.locator("#sdk-dialog details").nth(1).locator("summary").tap();
  assert.equal(await mp.locator("#sdk-dialog details").nth(1).getAttribute("open"), "");
  const layout = await mp.evaluate(() => {
    const dialog = document.getElementById("sdk-dialog");
    const grid = getComputedStyle(dialog.querySelector(".sdk-status-grid"));
    return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      dialogWidth: dialog.getBoundingClientRect().width, columns: grid.gridTemplateColumns,
      preWidth: dialog.querySelector("pre").getBoundingClientRect().width,
      guideWidth: dialog.querySelector(".sdk-guide").getBoundingClientRect().width };
  });
  assert.equal(layout.scrollWidth, layout.viewport);
  assert.ok(layout.dialogWidth <= layout.viewport - 28);
  assert.ok(!layout.columns.includes(" "), "mobile status cards must use one column");
  assert.ok(layout.preWidth <= layout.guideWidth);
  await mp.screenshot({ path: `${SHOTS}/sdk-guide-mobile.png` });
  await mp.locator('#sdk-dialog [data-close]').tap();
  await mp.waitForFunction(() => !document.getElementById("sdk-dialog").open);
  await mobile.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);
  console.log(JSON.stringify({ ok: true, documentationLinks: links.length, copyButtons: 2,
    disclosureControls: 2, closePaths: ["Escape", "close button"], mobileLayout: layout,
    consoleErrors: 0, badResponses: 0 }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
