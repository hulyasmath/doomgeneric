"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/";
const SHOTS = process.env.ZEQ_SCREENSHOT_DIR || "/mnt/agents/work/workspace-evidence";
const ROOMS = [
  "Home", "Doom", "Games SDK", "SDK Documentation", "Vault", "State Observer", "HITE", "Connect", "Anchors", "Apps", "Ask",
  "Shelf", "Nano-Zeqond Evolver", "Tour", "Use cases", "Zeqond time", "Envelopes",
  "Zeq Mail", "Zeq Stamps", "Zeq MI", "Public Page", "Zeq Globe", "ZeqPM",
  "HZC Compressor", "Physics Wizard", "Library", "Anatomy", "Shortcuts", "Tools",
  "Terminal", "API"
];

async function boot(page) {
  await page.goto(URL);
  await page.locator("#running").waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-view="doom"]').waitFor({ state: "visible" });
  await page.locator("#doom-game-frame").waitFor({ state: "visible" });
  const game = page.frameLocator("#doom-game-frame");
  await game.locator("#start-button").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector("#doom-game-frame").contentDocument.getElementById("start-button").disabled, null, { timeout: 60000 });
  return game;
}

async function railRoom(page, name) {
  const index = ROOMS.indexOf(name);
  assert.ok(index >= 0, `unknown room ${name}`);
  const room = page.locator("#rail .rail-room").nth(index);
  await room.click({ timeout: 15000 });
  assert.equal(await room.getAttribute("aria-current"), "page");
  return room;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [], badResponses = [], visited = [];
  const observe = (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(new globalThis.URL(URL).origin) && response.status() >= 400)
        badResponses.push(`${response.status()} ${response.url()}`);
    });
  };

  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await desktop.newPage();
    observe(page);
    await boot(page);

    const desktopTop = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      room: document.querySelector("#running .view:not([hidden])").dataset.view,
      frameSource: document.getElementById("doom-game-frame").getAttribute("src"),
      frameCount: document.querySelectorAll("#doom-game-frame").length,
      outerStartButtons: document.querySelectorAll("body > #start-button").length,
      rejectedWorkspaceNodes: document.querySelectorAll(".workspace-nav, #machine-section, #zeq-machine-frame").length,
      dock: [...document.querySelectorAll("#dock-apps button")].map((node) => node.textContent.trim())
    }));
    assert.equal(desktopTop.scrollWidth, desktopTop.viewport);
    assert.equal(desktopTop.room, "doom");
    assert.equal(desktopTop.frameSource, "game.html");
    assert.equal(desktopTop.frameCount, 1);
    assert.equal(desktopTop.outerStartButtons, 0);
    assert.equal(desktopTop.rejectedWorkspaceNodes, 0);
    assert.deepEqual(desktopTop.dock, ["Doom", "Observer", "Games SDK", "Ask", "Library", "Vault"]);
    assert.equal(await page.locator("#rail .rail-room").count(), ROOMS.length);
    const labels = await page.locator("#rail .rail-room").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim().replace(/^\d+\s*/, "")));
    assert.deepEqual(labels, ROOMS);
    await page.screenshot({ path: `${SHOTS}/desktop-doom-room.png` });

    for (const name of ROOMS) {
      await railRoom(page, name);
      await page.waitForTimeout(350);
      const state = await page.locator("body").evaluate((body) => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        text: body.innerText.trim().length,
        room: document.querySelector("#running .view:not([hidden])").dataset.view
      }));
      const expected = name === "State Observer" ? "state" : name === "Games SDK" ? "games-sdk" : name === "SDK Documentation" ? "sdk-docs" : name.toLowerCase().replace(/ /g, "-");
      assert.ok(state.room, `${name} has no active room`);
      assert.ok(state.text > 100, `${name} rendered without content`);
      assert.ok(state.scrollWidth <= state.width + 1, `${name} overflows horizontally: ${JSON.stringify(state)}`);
      visited.push(name);
      if (["Doom", "Games SDK", "Vault", "State Observer", "Ask", "Library", "Terminal", "API"].includes(name))
        await page.screenshot({ path: `${SHOTS}/desktop-${state.room}.png` });
    }
    assert.deepEqual(visited, ROOMS);

    await railRoom(page, "Library");
    const libraryPages = page.locator("#rail .rail-page");
    assert.equal(await libraryPages.count(), 5);
    const libraryTitles = [];
    for (let index = 0; index < 5; index++) {
      const subpage = libraryPages.nth(index);
      libraryTitles.push((await subpage.innerText()).trim().replace(/^\d+\s*/, ""));
      await subpage.click();
      assert.equal(await page.locator("#rail .rail-page.on").innerText(), await libraryPages.nth(index).innerText());
    }
    assert.deepEqual(libraryTitles, ["Guides", "Question grammar", "Connection guides", "SDK", "Paper"]);
    await page.screenshot({ path: `${SHOTS}/desktop-library-paper.png` });
    await railRoom(page, "Doom");
    assert.equal(await page.locator("#doom-game-frame").isVisible(), true);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await mobile.newPage();
    observe(mp);
    const game = await boot(mp);
    const mobileTop = await mp.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      room: document.querySelector("#running .view:not([hidden])").dataset.view,
      dockTargets: [...document.querySelectorAll("#dock button")].map((node) => ({
        text: node.textContent.trim(), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height
      }))
    }));
    assert.equal(mobileTop.scrollWidth, mobileTop.viewport);
    assert.equal(mobileTop.room, "doom");
    for (const target of mobileTop.dockTargets)
      assert.ok(target.width > 0 && target.height >= 44, JSON.stringify(target));
    const mobileGame = await game.locator("body").evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(mobileGame.scrollWidth <= mobileGame.viewport + 1, JSON.stringify(mobileGame));
    await mp.screenshot({ path: `${SHOTS}/mobile-doom-room.png` });

    await mp.locator("#dock-rooms").waitFor({ state: "visible" });
    for (const name of ["Games SDK", "Ask", "Library", "API", "Doom"]) {
      await mp.locator("#dock-rooms").tap();
      const index = ROOMS.indexOf(name);
      const room = mp.locator("#rail .rail-room").nth(index);
      await room.tap({ timeout: 15000 });
      assert.equal(await room.getAttribute("aria-current"), "page");
      await mp.waitForTimeout(450);
      const layout = await mp.evaluate(() => {
        const active = document.querySelector("#running .view:not([hidden])").getBoundingClientRect();
        return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, activeLeft: active.left, activeRight: active.right };
      });
      assert.ok(layout.scrollWidth <= layout.viewport + 1, `${name}: ${JSON.stringify(layout)}`);
      assert.ok(layout.activeLeft >= 0 && layout.activeRight <= layout.viewport + 1, `${name} is clipped: ${JSON.stringify(layout)}`);
      if (name === "Games SDK") {
        assert.equal(await mp.locator('[data-view="games-sdk"] .games-project-list li').count(), 20);
        await mp.screenshot({ path: `${SHOTS}/mobile-games-sdk.png` });
      }
    }
    await mp.waitForTimeout(300);
    assert.equal(await mp.locator("#doom-game-frame").isVisible(), true);
    await mp.screenshot({ path: `${SHOTS}/mobile-doom-return.png` });
    await mobile.close();

    assert.deepEqual(errors, []);
    assert.deepEqual(badResponses, []);
    console.log(JSON.stringify({
      ok: true,
      machineIsOuterApplication: true,
      doomInitialRoom: true,
      rejectedOuterGameWorkspace: true,
      directGameFrame: "game.html",
      machineRoomsVisited: visited.length,
      machineRooms: visited,
      libraryPages: libraryTitles,
      mobileRooms: ["Doom", "Games SDK", "Ask", "Library", "API", "Doom"],
      desktop: desktopTop,
      mobile: mobileTop,
      consoleErrors: errors.length,
      badResponses: badResponses.length
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
