"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (_) { ({ chromium } = require("/home/kimi/.npm-global/lib/node_modules/playwright")); }
const Replay = require("../zeq-replay.js");

const URL = process.env.ZEQ_TEST_URL || "http://127.0.0.1:8765/game.html";
const ROOT = path.resolve(__dirname, "../..");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("PAGE ERROR:", error.stack || error.message); });
  page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); console.error("CONSOLE ERROR:", message.text()); } });
  page.on("response", (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });

  await page.goto(URL);
  await page.waitForFunction(() => !document.getElementById("start-button").disabled, null, { timeout: 60000 });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.gametic > 2 && ZeqDiagnostics.game()?.gamestate === 0);
  const initial = await page.evaluate(() => ZeqDiagnostics.snapshot());

  await page.keyboard.down("w");
  await page.waitForTimeout(1600);
  await page.keyboard.up("w");
  const moved = await page.evaluate(() => ZeqDiagnostics.snapshot());
  assert.ok(moved && (initial.player.x !== moved.player.x || initial.player.y !== moved.player.y),
    "real browser movement was not observed");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ControlLeft");
  await page.waitForTimeout(750);
  const acted = await page.evaluate(() => ZeqDiagnostics.snapshot());
  assert.notEqual(acted.player.angle, moved.player.angle, "real browser turning was not observed");
  assert.ok(acted.cooldown.start > 0, "real browser firing was not observed");
  await page.keyboard.up("ControlLeft");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("d");
  await page.waitForTimeout(750);
  await page.keyboard.up("d");
  await page.waitForFunction(() => ZeqDiagnostics.canonical().checkpoints.length >= 2);
  assert.deepEqual(await page.evaluate(() => ZeqDiagnostics.input()), { holds: [], counts: {} });

  await page.locator('[data-open="ledger-dialog"]').click();
  await page.locator("#phase5-self-test").click();
  await page.waitForFunction(() => document.getElementById("phase5-self-test").textContent.includes("ALL CHECKS PASS"));
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-input").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "zeq-doom-input-v1.json");
  const artifact = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  const input = Replay.decodeInputArtifact(artifact);
  assert.equal(input.length, artifact.count * 24);
  assert.ok(artifact.count >= 70, `only ${artifact.count} browser tics captured`);
  for (let offset = 0; offset < input.length; offset += 24) {
    assert.equal(input.readUInt32LE(offset + 4), offset / 24, "fresh deployment must have a contiguous zero-based tic origin");
  }

  const canonical = await page.evaluate(() => ZeqDiagnostics.canonical());
  await page.locator("#ledger-dialog [data-close]").click();
  await page.locator("#pause-button").click();
  await page.waitForFunction(() => ZeqDiagnostics.game()?.paused === 1);
  assert.equal(canonical.dropped, 0);
  assert.equal(canonical.errors, 0);
  const browserHashes = canonical.checkpoints.filter((checkpoint) => Number(checkpoint.gametic) <= artifact.count);
  assert.ok(browserHashes.length >= 2);
  if (process.env.ZEQ_REPLAY_ARTIFACT) fs.writeFileSync(process.env.ZEQ_REPLAY_ARTIFACT, JSON.stringify(artifact, null, 2) + "\n");

  const visualOutput = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-visual-replay-"));
  const expectedVisualTic = Math.floor(artifact.count / 35) * 35;
  await page.waitForFunction((tic) => ZeqDiagnostics.visual().checkpoints.some((checkpoint) => Number(checkpoint.gametic) === tic), expectedVisualTic);
  const browserVisual = await page.evaluate(() => ZeqDiagnostics.visual());
  assert.equal(browserVisual.dropped, 0);
  assert.equal(browserVisual.errors, 0);
  const reproduced = await Replay.runHeadless({
    root: ROOT, runId: artifact.run_id, inputArtifact: artifact,
    ruleset: 1, skill: 2, maxTic: artifact.count, checkpointInterval: 35,
    visual: true, visualOutput
  });
  const nativeByTic = new Map(reproduced.stateHashes.map((checkpoint) => [checkpoint.gametic, checkpoint.state_sha256]));
  const compared = browserHashes.map((checkpoint) => ({
    gametic: checkpoint.gametic,
    browser: checkpoint.state_sha256,
    native: nativeByTic.get(checkpoint.gametic) || null
  }));
  for (const checkpoint of compared) assert.equal(checkpoint.native, checkpoint.browser, `canonical mismatch at tic ${checkpoint.gametic}`);
  const nativeVisualByTic = new Map(reproduced.visual.map((checkpoint) => [checkpoint.gametic, checkpoint]));
  const visualCompared = browserVisual.checkpoints.filter((checkpoint) => Number(checkpoint.gametic) <= artifact.count && nativeVisualByTic.has(checkpoint.gametic)).map((checkpoint) => {
    const native = nativeVisualByTic.get(checkpoint.gametic);
    assert.equal(native.frame_sha256, checkpoint.frame_sha256, `visual frame mismatch at tic ${checkpoint.gametic}`);
    assert.equal(native.occupancy_sha256, checkpoint.occupancy_sha256, `visual occupancy mismatch at tic ${checkpoint.gametic}`);
    assert.equal(native.width, checkpoint.width);
    assert.equal(native.height, checkpoint.height);
    assert.deepEqual(native.identity, browserVisual.identity);
    return { gametic: checkpoint.gametic, frame: checkpoint.frame_sha256, occupancy: checkpoint.occupancy_sha256 };
  });
  assert.ok(visualCompared.length >= 2, "insufficient native/WASM visual checkpoints");
  const finalVisualTic = reproduced.visual[reproduced.visual.length - 1].gametic;
  const retainedVisual = await page.evaluate((tics) => tics.map((tic) => ({ tic, available: !!ZeqDiagnostics.visualFrame(tic) })), browserVisual.checkpoints.map(checkpoint => Number(checkpoint.gametic)));
  const wasmFrame = await page.evaluate((tic) => ZeqDiagnostics.visualFrame(tic), finalVisualTic);
  assert.ok(wasmFrame, `WASM frame bytes unavailable at tic ${finalVisualTic}; retained: ${JSON.stringify(retainedVisual)}`);
  const nativeFrame = fs.readFileSync(path.join(visualOutput, "visual-frame.bin"));
  const nativeOccupancy = fs.readFileSync(path.join(visualOutput, "visual-occupancy.bin"));
  assert.ok(Buffer.from(wasmFrame.frame, "base64").equals(nativeFrame), "full native/WASM frame bytes differ");
  assert.ok(Buffer.from(wasmFrame.occupancy, "base64").equals(nativeOccupancy), "full native/WASM occupancy bytes differ");
  fs.rmSync(visualOutput, { recursive: true, force: true });
  const final = await page.evaluate(() => ZeqDiagnostics.snapshot());
  assert.ok(initial && final && (initial.player.x !== final.player.x || initial.player.y !== final.player.y),
    "final browser position did not differ from its initial position");
  assert.deepEqual(errors, []);
  assert.deepEqual(badResponses, []);

  console.log(JSON.stringify({
    ok: true, inputRecords: artifact.count, inputSha256: artifact.sha256,
    comparedCheckpoints: compared, replayMode: "native-and-wasm-canonical",
    visualCheckpoints: visualCompared, fullVisualByteComparison: { gametic: finalVisualTic, frameBytes: nativeFrame.length, occupancyBytes: nativeOccupancy.length },
    consoleErrors: errors.length, badResponses: badResponses.length
  }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
