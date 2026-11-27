"use strict";

// Real doomgeneric C/WASM -> same-origin room transport -> this page's actual
// Worker-backed machine -> signed State Observer history. No sidecar or test
// HTTP contract evaluator participates in this conformance path.
const assert = require("node:assert/strict");
const fs = require("node:fs");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/";
const SHOTS = process.env.ZEQ_SCREENSHOT_DIR || "/mnt/agents/work/machine-room-evidence";

async function boot(page) {
  await page.goto(URL);
  await page.locator("#running").waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-view="doom"]').waitFor({ state: "visible" });
  const frame = page.frameLocator("#doom-game-frame");
  await frame.locator("#start-button").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector("#doom-game-frame").contentDocument.getElementById("start-button").disabled, null, { timeout: 60000 });
  await page.waitForFunction(() => window.ZeqDoomRoom?.stats().ready, null, { timeout: 60000 });
  return frame;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await context.newPage();
  const errors = [], badResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    if (response.url().startsWith(new globalThis.URL(URL).origin) && response.status() >= 400)
      badResponses.push(`${response.status()} ${response.url()}`);
  });

  try {
    const frame = await boot(page);
    assert.match(page.url(), /\/doom$/);
    assert.equal(await page.locator("#machine-section").count(), 0);
    assert.equal(await page.locator(".workspace-nav").count(), 0);
    assert.equal(await page.locator("#doom-game-frame").getAttribute("src"), "game.html");

    const initial = await page.evaluate(() => ZeqDoomRoom.stats());
    await frame.locator("#start-button").click();
    const game = page.frames().find((item) => item.url().includes("/game.html"));
    assert.ok(game, "real game frame missing");
    await game.waitForFunction(() => ZeqDiagnostics.game()?.gamestate === 0 && ZeqDiagnostics.game()?.gametic > 3);
    const before = await game.evaluate(() => ({
      player: ZeqDiagnostics.snapshot().player,
      ammo: ZeqDiagnostics.game().ammo
    }));
    await game.locator("#canvas").click({ position: { x: 280, y: 170 } });
    await page.keyboard.down("w");
    await page.waitForTimeout(1000);
    await page.keyboard.up("w");
    await page.keyboard.down("Control");
    await page.waitForTimeout(250);
    await page.keyboard.up("Control");
    await page.waitForFunction((count) => ZeqDoomRoom.stats().writtenMovement > count, initial.writtenMovement, { timeout: 15000 });
    await page.waitForFunction((count) => ZeqDoomRoom.stats().writtenEvents >= count + 2, initial.writtenEvents, { timeout: 15000 });
    const after = await game.evaluate(() => ({
      player: ZeqDiagnostics.snapshot().player,
      ammo: ZeqDiagnostics.game().ammo,
      input: ZeqDiagnostics.input()
    }));
    assert.ok(before.player.x !== after.player.x || before.player.y !== after.player.y, "C player did not move");
    assert.ok(after.ammo < before.ammo, "C weapon did not fire");
    assert.deepEqual(after.input, { holds: [], counts: {} });

    await game.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
    await game.locator("#pause-button").click();
    await game.waitForFunction(() => ZeqDiagnostics.game().paused === 1);
    await page.locator("#doom-open-observer").click();
    await page.locator('[data-view="state"]').waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll(".obs-doom .obs-what").length >= 4);
    const movementRows = await page.locator(".obs-doom .obs-what").allTextContents();
    const moved = movementRows.find((text) => text.startsWith("Doom moved"));
    assert.ok(moved && /E1M1/.test(moved) && /tic \d+/.test(moved) && /position \[-?\d+, -?\d+, -?\d+\]/.test(moved) && /momentum \[-?\d+, -?\d+, -?\d+\]/.test(moved), moved);
    assert.ok(movementRows.some((text) => /Doom weapon fired · tic \d+ · value 1/.test(text)));
    assert.ok(movementRows.some((text) => /Doom cooldown started · tic \d+/.test(text)));

    const movement = page.locator(".obs-doom").filter({ hasText: "Doom moved" }).first();
    await movement.locator(".obs-line").click();
    const signed = JSON.parse(await movement.locator("pre").innerText());
    assert.equal(signed.kind, "stamp");
    assert.equal(signed.body.name, "doom/movement");
    assert.match(signed.hash, /^[0-9a-f]{64}$/);
    assert.match(signed.prev, /^[0-9a-f]{64}$/);
    assert.match(signed.signature, /^[0-9a-f]{128}$/);
    await page.screenshot({ path: `${SHOTS}/observer.png` });

    // A valid-looking message from the top window is not from the game and is ignored.
    const ignoredBefore = await page.evaluate(() => ZeqDoomRoom.stats());
    await page.evaluate(() => window.postMessage({
      channel: "zeq-doom-room-v1", kind: "movement", payload: {
        format: "ZEQ-DOOM-MOVE-v1", gametic: 999999, zeqond: "0", phase64: "0", ruleset: 1,
        player: { x: 1, y: 2, z: 3, angle: 0, momx: 0, momy: 0, momz: 0 },
        game: { episode: 1, map: 1, health: 100, gamestate: 0, paused: 1 }
      }
    }, location.origin));
    await page.waitForTimeout(300);
    const ignoredAfter = await page.evaluate(() => ZeqDoomRoom.stats());
    assert.equal(ignoredAfter.writtenMovement, ignoredBefore.writtenMovement);
    assert.equal(ignoredAfter.rejected, ignoredBefore.rejected);

    // The actual frame origin/source checks pass here, but malformed gameplay is rejected.
    await game.evaluate(() => parent.postMessage({
      channel: "zeq-doom-room-v1", kind: "movement", payload: { format: "ZEQ-DOOM-MOVE-v1" }
    }, location.origin));
    await page.waitForFunction((count) => ZeqDoomRoom.stats().rejected === count + 1, ignoredBefore.rejected);
    assert.equal(await page.evaluate(() => ZeqDoomRoom.stats().writtenMovement), ignoredBefore.writtenMovement);

    // Leaving the room releases held gameplay input, including after pointer capture.
    await page.getByRole("button", { name: "Doom", exact: true }).click();
    await game.locator("#pause-button").click();
    await game.waitForFunction(() => ZeqDiagnostics.game().paused === 0);
    await game.locator("#canvas").click({ position: { x: 280, y: 170 } });
    await page.keyboard.down("w");
    await game.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
    await page.getByRole("button", { name: "Games SDK", exact: true }).click();
    await page.locator('[data-view="games-sdk"]').waitFor({ state: "visible" });
    await game.waitForFunction(() => ZeqDiagnostics.input().holds.length === 0 && Object.keys(ZeqDiagnostics.input().counts).length === 0);
    await page.keyboard.up("w");

    const sdk = page.locator('[data-view="games-sdk"]');
    assert.equal(await sdk.locator(".games-project-list li").count(), 20);
    assert.equal(await sdk.locator(".games-project-list li.is-tested").count(), 14);
    assert.match(await sdk.locator(".games-projects summary").innerText(), /14 TESTED \/ 6 QUEUED/);
    assert.equal(await sdk.locator('.games-project-list a[href="sdk.html#project-09"]').count(), 1);
    assert.equal(await sdk.locator('.games-project-list a[href="sdk.html#project-10"]').count(), 1);
    assert.equal(await sdk.locator('.games-project-list a[href="sdk.html#project-11"]').count(), 1);
    assert.equal(await sdk.locator('.games-project-list a[href="sdk.html#project-12"]').count(), 1);
    assert.equal(await sdk.locator('.games-project-list a[href="sdk.html#project-13"]').count(), 1);
    assert.match(await sdk.locator(".games-project-list li").nth(9).innerText(), /C\+\+ \+ JS \+ 3-PROCESS PASS/);
    assert.match(await sdk.locator(".games-project-list li").nth(10).innerText(), /C\+\+ \+ JS \+ 3-PROCESS PASS/);
    assert.match(await sdk.locator(".games-project-list li").nth(11).innerText(), /C\+\+ \+ JS \+ 3-PROCESS PASS/);
    assert.match(await sdk.locator(".games-project-list li").nth(12).innerText(), /C\+\+ \+ PYTHON \+ 3-PROCESS PASS/);
    const links = await sdk.locator(".sdk-index a").evaluateAll((nodes) => nodes.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
    assert.equal(links.length, 9);
    for (const link of links) {
      const target = new globalThis.URL(link.href);
      if (target.hostname === "github.com") assert.ok(target.pathname.startsWith("/hulyasmath/"));
      else {
        assert.equal(target.origin, new globalThis.URL(URL).origin);
        assert.equal(target.pathname, "/sdk.html");
      }
      assert.equal(link.target, "_blank");
      assert.match(link.rel, /noopener/);
    }
    await page.locator("#games-sdk-copy-c").click();
    await page.waitForFunction(() => document.getElementById("games-sdk-copy-status").textContent === "C snippet copied.");
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /ZEQ_TimeFromTic\(host_tick, host_tick_rate, &instant\)/);
    await page.locator("#games-sdk-copy-js").click();
    await page.waitForFunction(() => document.getElementById("games-sdk-copy-status").textContent === "JavaScript snippet copied.");
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /ZeqSDK\.time\.fromTic\(hostTick, hostTickRate\)/);
    await page.screenshot({ path: `${SHOTS}/games-sdk.png` });
    await page.locator("#games-sdk-open-docs").click();
    await page.locator('[data-view="sdk-docs"]').waitFor({ state: "visible" });
    const docs = page.frameLocator("#sdk-docs-frame");
    await docs.locator('[data-doc-link="project-09"]').click();
    await docs.locator("#doc-project-09").waitFor({ state: "visible" });
    assert.equal(await docs.locator("article.doc").count(), 26);
    assert.match(await docs.locator("#doc-project-09 h1").innerText(), /Project 9: Simulation/);
    const projectGuide = await docs.locator("#doc-project-09").innerText();
    assert.match(projectGuide, /zeq-digital-twin-coupled-v1/);
    assert.match(projectGuide, /not a calibrated building/);
    assert.match(projectGuide, /f0ba83b21e13de796f78be7b1e3792dcc0c9085ea81f5fd3337b136fe781811c/);
    assert.ok(await docs.locator('#doc-source a[href="projects/09-simulation-digital-twins/run-tests.sh"]').count());
    await page.screenshot({ path: `${SHOTS}/project-09-documentation.png` });
    await docs.locator('[data-doc-link="project-10"]').evaluate(node => node.scrollIntoView({ block: "center" }));
    await docs.locator('[data-doc-link="project-10"]').click();
    await docs.locator("#doc-project-10").waitFor({ state: "visible" });
    assert.match(await docs.locator("#doc-project-10 h1").innerText(), /Project 10: Financial/);
    const orderBookGuide = await docs.locator("#doc-project-10").innerText();
    assert.match(orderBookGuide, /zeq-order-book-v1/);
    assert.match(orderBookGuide, /not an exchange/);
    assert.match(orderBookGuide, /6b986ae5862d50634803d3dd7cf555c1579236f09f101679867f208eb16c62b6/);
    assert.match(orderBookGuide, /First divergence: tick 80/);
    assert.ok(await docs.locator('#doc-source a[href="projects/10-financial-trading-simulation/run-tests.sh"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/10-financial-trading-simulation/src/zeq_order_book.cpp"]').count());
    await page.screenshot({ path: `${SHOTS}/project-10-documentation.png` });
    await docs.locator('[data-doc-link="project-11"]').evaluate(node => node.scrollIntoView({ block: "center" }));
    await docs.locator('[data-doc-link="project-11"]').click();
    await docs.locator("#doc-project-11").waitFor({ state: "visible" });
    assert.match(await docs.locator("#doc-project-11 h1").innerText(), /Project 11: Collaborative CAD/);
    const designGuide = await docs.locator("#doc-project-11").innerText();
    assert.match(designGuide, /zeq-design-steps-v1/);
    assert.match(designGuide, /not a production CAD application/);
    assert.match(designGuide, /f5233146fcbeb0788102ce3e6e84ad6a1415e979b3d5eb213d5d2f9a95482b49/);
    assert.match(designGuide, /tick and revision 41/);
    assert.ok(await docs.locator('#doc-source a[href="projects/11-collaborative-cad-engineering/run-tests.sh"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/11-collaborative-cad-engineering/src/zeq_design_steps.cpp"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/11-collaborative-cad-engineering/tests/test_design_steps.js"]').count());
    await page.screenshot({ path: `${SHOTS}/project-11-documentation.png` });
    await docs.locator('[data-doc-link="project-12"]').evaluate(node => node.scrollIntoView({ block: "center" }));
    await docs.locator('[data-doc-link="project-12"]').click();
    await docs.locator("#doc-project-12").waitFor({ state: "visible" });
    assert.match(await docs.locator("#doc-project-12 h1").innerText(), /Project 12: Audio DAW/);
    const audioGuide = await docs.locator("#doc-project-12").innerText();
    assert.match(audioGuide, /zeq-audio-phase-v1/);
    assert.match(audioGuide, /not a compiled VST3/);
    assert.match(audioGuide, /7091200063c9fab21decff5152820532716342b15ee2572c30a67a125e3c27b7/);
    assert.match(audioGuide, /sample 4,065/);
    assert.ok(await docs.locator('#doc-source a[href="projects/12-audio-daw-plugins/run-tests.sh"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/12-audio-daw-plugins/src/zeq_audio_phase.cpp"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/12-audio-daw-plugins/tests/test_audio_phase.js"]').count());
    await page.screenshot({ path: `${SHOTS}/project-12-documentation.png` });
    await docs.locator('[data-doc-link="project-13"]').evaluate(node => node.scrollIntoView({ block: "center" }));
    await docs.locator('[data-doc-link="project-13"]').click();
    await docs.locator("#doc-project-13").waitFor({ state: "visible" });
    assert.match(await docs.locator("#doc-project-13 h1").innerText(), /Project 13: Video \/ VFX Caches/);
    const cacheGuide = await docs.locator("#doc-project-13").innerText();
    assert.match(cacheGuide, /zeq-particle-cache-v1/);
    assert.match(cacheGuide, /not a compiled Houdini/);
    assert.match(cacheGuide, /No renderer, video codec/);
    assert.match(cacheGuide, /a34e66cf3cfe53dd493b974c2a5f8447cfc5a746742fdeabddd3ad38480a1675/);
    assert.match(cacheGuide, /First deliberate divergence/);
    assert.match(cacheGuide, /frame 93/);
    assert.ok(await docs.locator('#doc-source a[href="projects/13-video-vfx-caches/run-tests.sh"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/13-video-vfx-caches/src/zeq_particle_cache.cpp"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/13-video-vfx-caches/reference/zeq_particle_cache.py"]').count());
    assert.ok(await docs.locator('#doc-source a[href="projects/13-video-vfx-caches/tests/test_particle_cache.py"]').count());
    await page.screenshot({ path: `${SHOTS}/project-13-documentation.png` });
    await page.locator("#sdk-docs-open-doom").click();
    await page.locator('[data-view="doom"]').waitFor({ state: "visible" });
    assert.equal(await game.evaluate(() => typeof ZeqDiagnostics.snapshot().gametic), "number");

    const mobileDocsContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
    const mobileDocs = await mobileDocsContext.newPage();
    mobileDocs.on("pageerror", (error) => errors.push(error.message));
    mobileDocs.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    mobileDocs.on("response", (response) => {
      if (response.url().startsWith(new globalThis.URL(URL).origin) && response.status() >= 400)
        badResponses.push(`${response.status()} ${response.url()}`);
    });
    await mobileDocs.goto(new globalThis.URL("sdk.html#project-13", URL).href);
    await mobileDocs.locator("#doc-project-13").waitFor({ state: "visible" });
    assert.equal(await mobileDocs.locator("article.doc").count(), 26);
    assert.match(await mobileDocs.locator("#doc-project-13 h1").innerText(), /Project 13: Video \/ VFX Caches/);
    const mobileLayout = await mobileDocs.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      articleWidth: document.getElementById("doc-project-13").getBoundingClientRect().width,
      tableContainers: [...document.querySelectorAll("#doc-project-13 .table-wrap")].map(node => ({
        width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth
      }))
    }));
    assert.equal(mobileLayout.scrollWidth, mobileLayout.viewport);
    assert.ok(mobileLayout.tableContainers.length >= 4);
    for (const table of mobileLayout.tableContainers) assert.ok(table.width <= mobileLayout.articleWidth + 1);
    await mobileDocs.locator("#doc-project-13 pre .copy").first().tap();
    await mobileDocs.waitForFunction(() => document.querySelector("#doc-project-13 pre .copy").textContent === "COPIED");
    assert.match(await mobileDocs.evaluate(() => navigator.clipboard.readText()), /zeq_particle_cache\.h/);
    await mobileDocs.screenshot({ path: `${SHOTS}/project-13-documentation-mobile.png`, fullPage: true });
    await mobileDocsContext.close();

    // Exercise the real self-contained bearer export after the website split.
    // Only a disposable conformance PIN is used; downloaded test machines stay
    // in Playwright's temporary download storage and are removed with context.
    await page.locator("#rail .rail-room").nth(4).click();
    await page.locator('[data-view="vault"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^The machine file/ }).click();
    await page.locator("#capsule-panel").waitFor({ state: "visible" });
    await page.locator("#pin-gate-go").click();
    await page.locator("#keep-dialog").waitFor({ state: "visible" });
    const testPin = "Zeq-Test-Only-827!";
    await page.locator("#keep-pin").fill(testPin);
    await page.locator("#keep-confirm").fill(testPin);
    const privateDownload = page.waitForEvent("download");
    await page.locator("#keep-go").click();
    const sealedMachine = await privateDownload;
    assert.match(sealedMachine.suggestedFilename(), /\.zeq$/);
    await sealedMachine.path();
    await page.locator("#keep-dialog").waitFor({ state: "hidden", timeout: 120000 });
    const bearerDownload = page.waitForEvent("download");
    await page.locator("#download-html").click();
    const bearerFile = await bearerDownload;
    assert.match(bearerFile.suggestedFilename(), /\.html$/);
    const bearerHtml = fs.readFileSync(await bearerFile.path(), "utf8");
    assert.ok(bearerHtml.includes('<script id="zeq-machine" type="application/json">'));
    assert.ok(bearerHtml.includes('<script id="zeq-page" type="application/json">'));
    assert.ok(!bearerHtml.includes('src="machine-runtime-1.js"'));
    assert.ok(!bearerHtml.includes('src="machine-bootstrap.js"'));
    assert.ok(!bearerHtml.match(/script-src ([^;]+)/)[1].includes("'self'"));
    assert.equal(await page.evaluate((pin) => Object.values(localStorage).some(value => value.includes(pin)), testPin), false);

    const final = await page.evaluate(() => ZeqDoomRoom.stats());
    assert.equal(final.errors, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(badResponses, []);
    console.log(JSON.stringify({
      ok: true,
      transport: "direct same-origin game frame to in-page machine",
      realMovement: true,
      realWeaponFire: true,
      signedObserverRows: movementRows.length,
      signedMovementSummary: moved,
      signatureChecked: true,
      wrongWindowIgnored: true,
      malformedFrameMessageRejected: true,
      inputReleasedOnRoomExit: true,
      sdkProjects: 20,
      testedProjects: 14,
      sdkLinks: links.length,
      documentationArticles: 26,
      project09GuideLoaded: true,
      project10GuideLoaded: true,
      project11GuideLoaded: true,
      project12GuideLoaded: true,
      project13GuideLoaded: true,
      mobileProject13DeepLink: true,
      selfContainedBearerExport: true,
      mobileDocumentationLayout: mobileLayout,
      copyControls: 3,
      stats: final,
      consoleErrors: 0,
      badResponses: 0
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
