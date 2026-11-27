#!/usr/bin/env python3
"""Prove retained-engine assembly is reproducible and keeps identities separate."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SDK_ROOT = Path(os.environ.get("ZEQ_SDK_ROOT", ROOT)).resolve()
SCRIPT = ROOT / "assemble-web-release.py"
REFERENCE = ROOT / "dist"
manifest = json.loads((REFERENCE / "zeq-release-manifest.json").read_text())

with tempfile.TemporaryDirectory(prefix="zeq-release-assembly-") as temporary:
    output = Path(temporary) / "release"
    command = [
        "python3", str(SCRIPT),
        "--sdk-root", str(SDK_ROOT),
        "--engine-dir", str(ROOT / "doomgeneric"),
        "--output", str(output),
        "--source-commit", manifest["sourceCommit"],
        "--repository-head", manifest["repositoryHead"],
        "--toolchain", manifest["toolchain"],
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    shell = (ROOT / "web/shell.html").read_text(encoding="utf-8")
    expected_game = shell.replace("{{{ SCRIPT }}}", '<script src="doomgeneric.js" async></script>')
    assert (output / "game.html").read_text(encoding="utf-8") == expected_game, \
        "retained generated HTML replaced the current machine-room browser shell"
    expected = sorted(p.relative_to(REFERENCE).as_posix() for p in REFERENCE.rglob("*") if p.is_file())
    actual = sorted(p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file())
    assert actual == expected, "retained-engine assembly changed the release inventory"
    for relative in expected:
        assert (output / relative).read_bytes() == (REFERENCE / relative).read_bytes(), relative

    # The assembler must never delete or overwrite its retained engine input.
    refused = subprocess.run([
        "python3", str(SCRIPT), "--sdk-root", str(SDK_ROOT),
        "--engine-dir", str(ROOT / "doomgeneric"),
        "--output", str(ROOT / "doomgeneric"),
        "--source-commit", manifest["sourceCommit"],
        "--repository-head", manifest["repositoryHead"],
        "--toolchain", manifest["toolchain"],
    ], capture_output=True, text=True)
    assert refused.returncode != 0, "nested engine/output directories were not refused"
    assert "separate, non-nested" in refused.stderr

print(json.dumps({
    "ok": True,
    "artifactsIncludingManifest": len(expected),
    "byteIdenticalRebuild": True,
    "currentBrowserShellRendered": True,
    "sourceCommit": manifest["sourceCommit"],
    "repositoryHead": manifest["repositoryHead"],
    "identitiesRemainSeparate": manifest["sourceCommit"] != manifest["repositoryHead"],
    "engineInputOverwriteRefused": True,
}, indent=2))
