#!/usr/bin/env python3
"""Assemble a byte-inventoried Doom browser release from existing engine artifacts.

This script never compiles the engine. The compiled source identity, repository
head, and retained toolchain are separate, explicit inputs so a browser-only
release cannot accidentally claim that the C/WASM engine was rebuilt.
"""
import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE_ARTIFACTS = {
    "doomgeneric.js": "doomgeneric.js",
    "doomgeneric.wasm": "doomgeneric.wasm",
    "doomgeneric.data": "doomgeneric.data",
}
# Emscripten 3.1.64 replaces this marker with the external loader when using
# web/shell.html. The retained generated HTML can predate browser-only shell
# changes, so never substitute it for the current integration document.
GAME_LOADER = '<script src="doomgeneric.js" async></script>'
BROWSER_ASSETS = [
    "web/zeq.css", "web/zeq.js", "web/zeq-machine.js", "web/zeq-room.js",
    "web/zeq-capsule-worker.js", "web/machine.html",
    "web/machine-bootstrap.js", "web/machine-catalogue.js", "web/machine-page.js",
    "web/machine-engine-1.js", "web/machine-engine-2.js",
    "web/machine-runtime-1.js", "web/machine-runtime-2.js", "web/sdk.html",
    "sdk/zeq-time-table.js", "sdk/zeq-physics-table.js", "sdk/zeq-game-sdk.js",
    "sdk/zeq-security.js", "sdk/zeq-capsule.js", "sdk/zeq-content.js",
    "sdk/zeq-pixel.js",
]
BROWSER_SOURCES = [
    "build-web.sh", "build-sdk-docs.py", "assemble-web-release.py",
    "web/machine.html", "web/machine-bootstrap.js", "web/machine-catalogue.js",
    "web/machine-page.js", "web/machine-engine-1.js", "web/machine-engine-2.js",
    "web/machine-runtime-1.js", "web/machine-runtime-2.js", "web/shell.html",
    "web/sdk.html", "web/zeq.css", "web/zeq.js", "web/zeq-machine.js",
    "web/zeq-room.js", "web/zeq-capsule-worker.js", "sdk/zeq-time-table.js",
    "sdk/zeq-physics-table.js", "sdk/zeq-game-sdk.js", "sdk/zeq-security.js",
    "sdk/zeq-capsule.js", "sdk/zeq-content.js", "sdk/zeq-pixel.js",
]
OUTPUT_NAMES = {
    **{relative: relative.removeprefix("web/") for relative in BROWSER_ASSETS if relative.startswith("web/")},
    "web/machine.html": "index.html",
    "web/sdk.html": "sdk.html",
}
EXCLUDED_DIRECTORIES = {".git", "__pycache__", "node_modules", "build"}
EXCLUDED_SUFFIXES = {".pyc", ".o", ".out"}


def git_head():
    try:
        return subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "0" * 40


def copy_verified(source, destination, allow_empty=False):
    if not source.is_file() or (source.stat().st_size == 0 and not allow_empty):
        raise RuntimeError(f"Refusing to copy empty or missing artifact: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    temporary.unlink(missing_ok=True)
    shutil.copyfile(source, temporary)
    if source.read_bytes() != temporary.read_bytes():
        raise RuntimeError(f"Artifact copy differed: {source}")
    os.replace(temporary, destination)


def write_verified_text(destination, text):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    temporary.unlink(missing_ok=True)
    temporary.write_text(text, encoding="utf-8")
    if temporary.read_bytes() != text.encode("utf-8"):
        raise RuntimeError(f"Rendered artifact differed: {destination}")
    os.replace(temporary, destination)


def remove_output_tree(path):
    # The sandbox's FUSE mount can transiently report ENOTEMPTY after a large
    # recursive delete. Each retry resumes the same destructive operation only
    # inside the already validated release output; it never touches the input.
    for attempt in range(5):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except OSError as error:
            if error.errno != errno.ENOTEMPTY or attempt == 4:
                raise
            time.sleep(0.05 * (attempt + 1))


def validate_commit(value, label):
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError(f"{label} must be one lowercase Git commit SHA")
    return value


def assemble(args):
    sdk_root = args.sdk_root.resolve()
    engine_dir = args.engine_dir.resolve()
    output = args.output.resolve()
    if not (sdk_root / "docs/zeq-developer-manual-v1.md").is_file() or not (sdk_root / "projects").is_dir():
        raise RuntimeError("The SDK root must contain the complete manuals and project sources")
    if output == ROOT or output == engine_dir or output in engine_dir.parents or engine_dir in output.parents:
        raise RuntimeError("Release output and retained engine input must be separate, non-nested directories")

    source_commit = validate_commit(args.source_commit, "source commit")
    repository_head = validate_commit(args.repository_head, "repository head")
    toolchain = args.toolchain.strip()
    if not toolchain:
        raise ValueError("The retained toolchain identity is required")

    # A clean output prevents files from an earlier browser release surviving.
    if output.exists():
        remove_output_tree(output)
    output.mkdir(parents=True, exist_ok=True)

    for source_name, output_name in ENGINE_ARTIFACTS.items():
        copy_verified(engine_dir / source_name, output / output_name)
    shell = (ROOT / "web/shell.html").read_text(encoding="utf-8")
    if shell.count("{{{ SCRIPT }}}") != 1:
        raise RuntimeError("The browser shell must contain exactly one Emscripten script marker")
    write_verified_text(output / "game.html", shell.replace("{{{ SCRIPT }}}", GAME_LOADER))
    for relative in BROWSER_ASSETS:
        copy_verified(ROOT / relative, output / OUTPUT_NAMES.get(relative, relative))

    build_info = output / "sdk/zeq-build-info.js"
    build_info.parent.mkdir(parents=True, exist_ok=True)
    build_info.write_text(
        "/* Generated build identity. */\n"
        f'window.ZeqBuildInfo = Object.freeze({{ sourceCommit: "{source_commit}" }});\n',
        encoding="utf-8",
    )

    # The manual's source links resolve to a complete same-origin SDK/test release.
    for directory in ("sdk", "projects"):
        for path in sorted((sdk_root / directory).rglob("*")):
            relative = path.relative_to(sdk_root)
            if not path.is_file() or any(part in EXCLUDED_DIRECTORIES for part in relative.parts):
                continue
            if path.suffix in EXCLUDED_SUFFIXES:
                continue
            destination = output / relative
            if not destination.exists() or path.read_bytes() != destination.read_bytes():
                copy_verified(path, destination, allow_empty=True)

    artifacts = []
    for path in sorted(p for p in output.rglob("*") if p.is_file()):
        data = path.read_bytes()
        artifacts.append({
            "path": path.relative_to(output).as_posix(),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })

    browser_tree = hashlib.sha256()
    for relative in BROWSER_SOURCES:
        path = ROOT / relative
        browser_tree.update(relative.encode() + b"\0")
        browser_tree.update(path.read_bytes() + b"\0")

    manifest = {
        "format": "zeq-release-manifest-v1",
        "target": "doomgeneric-browser-wasm",
        "sourceCommit": source_commit,
        "sourceCommitScope": "compiled C/WASM engine and generated engine assets",
        "repositoryHead": repository_head,
        "browserSourceTreeSha256": browser_tree.hexdigest(),
        "toolchain": toolchain,
        "artifacts": artifacts,
        "evidenceScope": "build identity and byte inventory only; test and delivery gates are separate",
    }
    (output / "zeq-release-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", type=Path, required=True)
    parser.add_argument("--engine-dir", type=Path, required=True,
                        help="Directory containing retained doomgeneric.js/.wasm/.data; game.html uses the current shell")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    parser.add_argument("--source-commit", required=True,
                        help="Actual source commit compiled into the retained engine artifacts")
    parser.add_argument("--repository-head", default=git_head(),
                        help="Current browser/repository identity; independent of source-commit")
    parser.add_argument("--toolchain", required=True,
                        help="Verified retained toolchain description, not a claim of recompilation")
    args = parser.parse_args()
    manifest = assemble(args)
    print(json.dumps({
        "output": str(args.output.resolve()),
        "sourceCommit": manifest["sourceCommit"],
        "repositoryHead": manifest["repositoryHead"],
        "browserSourceTreeSha256": manifest["browserSourceTreeSha256"],
        "artifacts": len(manifest["artifacts"]),
    }, indent=2))


if __name__ == "__main__":
    main()
