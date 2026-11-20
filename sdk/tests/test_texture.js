"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zeq-texture-"));
function run(executable) {
  const result = spawnSync(executable, [], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `exit ${result.status}`);
  return JSON.parse(result.stdout);
}
try {
  for (const [name, flags] of [
    ["strict", ["-std=c99", "-O2", "-Wall", "-Wextra", "-Werror"]],
    ["sanitized", ["-std=c99", "-O1", "-g", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"]]
  ]) {
    const executable = path.join(directory, name);
    const built = spawnSync("cc", [...flags, "-I" + path.join(ROOT, "sdk"),
      path.join(ROOT, "sdk", "zeq_texture.c"), path.join(__dirname, "zeq_texture_probe.c"),
      "-o", executable], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const report = run(executable);
    assert.equal(report.ok, true);
    assert.equal(report.fuzz_cases, 20000);
    if (name === "sanitized") console.log(JSON.stringify({ ...report, targets: ["native-c99-werror", "asan-ubsan"] }, null, 2));
  }
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
