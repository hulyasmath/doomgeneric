"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const Replay = require("../zeq-replay.js");
const Security = require("../zeq-security.js");

(async () => {
  const root = path.resolve(__dirname, "../..");
  const commands = [];
  for (let tic = 0; tic < 140; tic++) {
    commands.push({ gametic: tic, forwardmove: tic < 35 ? 25 : 0, sidemove: tic >= 35 && tic < 70 ? 12 : 0,
      angleturn: tic >= 35 && tic < 70 ? 24 : 0, buttons: tic >= 70 ? 1 : 0 });
  }
  const runId = "0123456789abcdef0123456789abcdef";
  const input = Replay.createInputArtifact(commands, runId);
  const recorded = await Replay.runHeadless({ root, runId, inputArtifact: input, maxTic: 140, checkpointInterval: 35 });
  assert.equal(recorded.stateHashes.length, 4);
  assert.notEqual(recorded.stateHashes[3].state_sha256, "0".repeat(64));
  assert.ok(recorded.checkpoints[3].x !== "69206016" || recorded.checkpoints[3].y !== "-236978176", "real ticcmd movement must affect the C engine");

  const reproduced = await Replay.runHeadless({ root, runId, inputArtifact: input, maxTic: 140, checkpointInterval: 35 });
  const match = Replay.compareReproduction(recorded, reproduced);
  assert.equal(match.status, "match");
  assert.equal(match.compared_checkpoints, 4);

  const changedCommands = commands.map((command) => ({ ...command }));
  changedCommands[20].forwardmove++;
  const changedInput = Replay.createInputArtifact(changedCommands, runId);
  const changed = await Replay.runHeadless({ root, runId, inputArtifact: changedInput, maxTic: 140, checkpointInterval: 35 });
  const mismatch = Replay.compareReproduction(recorded, changed);
  assert.equal(mismatch.status, "mismatch");
  assert.notEqual(JSON.stringify(recorded.stateHashes), JSON.stringify(changed.stateHashes));

  const tamperedInput = { ...input, data: Buffer.from(Replay.decodeInputArtifact(input, runId)).toString("base64") };
  const tamperedBytes = Replay.decodeInputArtifact(tamperedInput, runId);
  tamperedBytes[8] ^= 1;
  tamperedInput.data = tamperedBytes.toString("base64");
  assert.throws(() => Replay.decodeInputArtifact(tamperedInput, runId), /digest/);

  const signer = await Security.createSigner("phase4-replay-test");
  const proof = await Replay.exportReplayProof(recorded, match, signer);
  assert.equal(proof.format, "zeq-proof-v2");
  assert.equal(proof.replay.status, "match");
  assert.equal(proof.scope, Security.SCOPE);
  const unavailable = await Security.verifyProof(proof);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.replay, "unavailable");
  const verified = await Replay.verifyReplayProof(proof, { root, inputArtifact: input });
  assert.equal(verified.ok, true);
  assert.equal(verified.replay, "match");

  const stateTampered = JSON.parse(JSON.stringify(proof));
  stateTampered.state_hashes[2].state_sha256 = "f".repeat(64);
  const rejected = await Replay.verifyReplayProof(stateTampered, { root, inputArtifact: input });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.replay, "mismatch");

  assert.throws(() => Replay.createInputArtifact([{ gametic: 1 }, { gametic: 1 }], runId), /increase/);
  console.log("Replay OK: real ticcmd movement; independent match; altered-input mismatch; input/state tamper refusal; signed third-run verification");
})().catch((error) => { console.error(error); process.exitCode = 1; });
