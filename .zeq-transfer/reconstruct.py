#!/usr/bin/env python3
"""Deterministic, hash-gated transport for the eight large browser assets.

ZEQXFER3 reversibly separates long Base64 tokens from their surrounding source
text. Decoded payloads are transported as bytes; a gzip payload is replaced by
its plaintext only when the configured gzip invocation reproduces every original
byte. The reconstruction command does not need the source repository.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import gzip
import hashlib
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import tempfile

ARCHIVE_MAGIC = b"ZEQXFER3"
PACKAGE_FORMAT = "ZEQXFER3-PACKAGE-v1"
BASE64_SPAN = re.compile(rb"[A-Za-z0-9+/]{64,}={0,2}")
SHARD_SIZE = 90_000
SHARD_LINE_BYTES = 999
SHARD_LINES = SHARD_SIZE // (SHARD_LINE_BYTES + 1)
ASSETS = (
    "web/machine.html",
    "web/machine-runtime-1.js",
    "web/machine-runtime-2.js",
    "web/machine-catalogue.js",
    "web/machine-engine-1.js",
    "web/machine-engine-2.js",
    "web/machine-page.js",
    "web/sdk.html",
)


class TransferError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def u16(value: int) -> bytes:
    return struct.pack(">H", value)


def u32(value: int) -> bytes:
    return struct.pack(">I", value)


def u64(value: int) -> bytes:
    return struct.pack(">Q", value)


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def take(self, length: int) -> bytes:
        if length < 0 or self.offset + length > len(self.data):
            raise TransferError("truncated transfer record")
        result = self.data[self.offset:self.offset + length]
        self.offset += length
        return result

    def number(self, size: int) -> int:
        return int.from_bytes(self.take(size), "big")

    def finish(self) -> None:
        if self.offset != len(self.data):
            raise TransferError("trailing bytes in transfer record")


def gzip_transport(payload: bytes) -> tuple[int, bytes]:
    if not payload.startswith(b"\x1f\x8b"):
        return 0, payload
    try:
        plaintext = gzip.decompress(payload)
    except (EOFError, OSError, zlib_error()):
        return 0, payload
    for level in range(1, 10):
        if gzip.compress(plaintext, compresslevel=level, mtime=0) == payload:
            return level + 1, plaintext
    return 0, payload


def zlib_error():
    # Import lazily so the decoder's exception tuple remains portable.
    import zlib
    return zlib.error


def decode_base64_token(token: bytes) -> tuple[int, int, bytes] | None:
    if len(token) % 4 == 1:
        return None
    padded = token + b"=" * ((-len(token)) % 4)
    try:
        payload = base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError):
        return None
    canonical = base64.b64encode(payload)
    if canonical == token:
        return 0, 0, payload
    unpadded = canonical.rstrip(b"=")
    if unpadded == token:
        return 1, 0, payload
    if len(unpadded) == len(token) and unpadded[:-1] == token[:-1]:
        # Some embedded encoders leave unused bits noncanonical. Preserve the
        # original final character instead of normalizing the source asset.
        return 2, token[-1], payload
    return None


def encode_record(source: bytes) -> tuple[bytes, dict[str, int]]:
    segments: list[bytes] = []
    cursor = 0
    span_count = 0
    gzip_count = 0
    gzip_exact = 0
    for match in BASE64_SPAN.finditer(source):
        decoded = decode_base64_token(match.group())
        if decoded is None:
            continue
        style, override, payload = decoded
        kind, transported = gzip_transport(payload)
        text = source[cursor:match.start()]
        segments.append(
            bytes((style, override, kind))
            + u64(len(text)) + text
            + u64(len(transported)) + transported
        )
        cursor = match.end()
        span_count += 1
        if payload.startswith(b"\x1f\x8b"):
            gzip_count += 1
            if kind:
                gzip_exact += 1
    tail = source[cursor:]
    record = u32(len(segments)) + b"".join(segments) + u64(len(tail)) + tail
    return record, {
        "spans": span_count,
        "gzip": gzip_count,
        "gzipExact": gzip_exact,
    }


def encode_base64_payload(style: int, override: int, payload: bytes) -> bytes:
    encoded = base64.b64encode(payload)
    if style == 0:
        result = encoded
    elif style == 1:
        result = encoded.rstrip(b"=")
    elif style == 2:
        result = encoded.rstrip(b"=")
        if not result or not 0 <= override <= 255:
            raise TransferError("invalid noncanonical Base64 override")
        result = result[:-1] + bytes((override,))
    else:
        raise TransferError(f"unsupported Base64 style {style}")
    padded = result + b"=" * ((-len(result)) % 4)
    try:
        decoded = base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise TransferError("reconstructed Base64 is invalid") from error
    if decoded != payload:
        raise TransferError("reconstructed Base64 changes its payload")
    return result


def decode_record(record: bytes) -> bytes:
    reader = Reader(record)
    segment_count = reader.number(4)
    output = bytearray()
    for _ in range(segment_count):
        style = reader.number(1)
        override = reader.number(1)
        kind = reader.number(1)
        text = reader.take(reader.number(8))
        transported = reader.take(reader.number(8))
        if kind == 0:
            payload = transported
        elif 2 <= kind <= 10:
            payload = gzip.compress(transported, compresslevel=kind - 1, mtime=0)
        else:
            raise TransferError(f"unsupported gzip kind {kind}")
        output.extend(text)
        output.extend(encode_base64_payload(style, override, payload))
    output.extend(reader.take(reader.number(8)))
    reader.finish()
    return bytes(output)


def encode_archive(root: Path) -> tuple[bytes, dict[str, int]]:
    archive = bytearray(ARCHIVE_MAGIC)
    totals = {"spans": 0, "gzip": 0, "gzipExact": 0}
    for name in ASSETS:
        source = (root / name).read_bytes()
        encoded_name = name.encode("utf-8")
        record, counts = encode_record(source)
        archive.extend(u16(len(encoded_name)))
        archive.extend(encoded_name)
        archive.extend(u64(len(record)))
        archive.extend(record)
        for key in totals:
            totals[key] += counts[key]
    return bytes(archive), totals


def validate_asset_name(name: str) -> None:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        raise TransferError(f"unsafe asset path: {name!r}")


def decode_archive(archive: bytes) -> dict[str, bytes]:
    reader = Reader(archive)
    if reader.take(len(ARCHIVE_MAGIC)) != ARCHIVE_MAGIC:
        raise TransferError("incorrect archive magic")
    assets: dict[str, bytes] = {}
    while reader.offset < len(archive):
        name = reader.take(reader.number(2)).decode("utf-8")
        validate_asset_name(name)
        if name in assets:
            raise TransferError(f"duplicate asset: {name}")
        record = reader.take(reader.number(8))
        assets[name] = decode_record(record)
    return assets


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def pack(root: Path, output: Path) -> None:
    if output.exists():
        raise TransferError(f"output already exists: {output}")
    output.mkdir(parents=True)
    archive, totals = encode_archive(root)
    xz = lzma.compress(archive, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64,
                       preset=9 | lzma.PRESET_EXTREME)
    package = base64.b64encode(xz)
    shards = []
    shard_dir = output / "shards"
    shard_dir.mkdir()
    lines = [package[start:start + SHARD_LINE_BYTES] + b"\n"
             for start in range(0, len(package), SHARD_LINE_BYTES)]
    for index, start in enumerate(range(0, len(lines), SHARD_LINES)):
        payload = b"".join(lines[start:start + SHARD_LINES])
        if len(payload) > SHARD_SIZE:
            raise TransferError("wrapped shard exceeds its size limit")
        relative = f"shards/{index:05d}.txt"
        (output / relative).write_bytes(payload)
        shards.append({
            "path": relative,
            "bytes": len(payload),
            "sha256": sha256(payload),
            "gitBlobSha": git_blob_sha(payload),
        })
    assets = []
    for name in ASSETS:
        payload = (root / name).read_bytes()
        assets.append({
            "path": name,
            "bytes": len(payload),
            "sha256": sha256(payload),
            "gitBlobSha": git_blob_sha(payload),
        })
    manifest = {
        "format": PACKAGE_FORMAT,
        "archiveFormat": ARCHIVE_MAGIC.decode("ascii"),
        "shardSize": SHARD_SIZE,
        "packageBytes": len(package),
        "packageSha256": sha256(package),
        "xzBytes": len(xz),
        "xzSha256": sha256(xz),
        "archiveBytes": len(archive),
        "archiveSha256": sha256(archive),
        "transformCounts": totals,
        "assets": assets,
        "shards": shards,
    }
    write_json(output / "manifest.json", manifest)
    (output / "READY").write_text(
        f"{PACKAGE_FORMAT}\nshards={len(shards)}\npackageSha256={sha256(package)}\n",
        encoding="ascii",
    )
    (output / "archive.zeqxfer3").write_bytes(archive)
    (output / "package.xz").write_bytes(xz)
    (output / "package.b64").write_bytes(package)
    print(json.dumps({
        "archiveBytes": len(archive),
        "xzBytes": len(xz),
        "base64Bytes": len(package),
        "shards": len(shards),
        "packageSha256": sha256(package),
        **totals,
    }, indent=2))


def load_manifest(input_dir: Path) -> dict:
    manifest = json.loads((input_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != PACKAGE_FORMAT:
        raise TransferError("unsupported package manifest")
    if manifest.get("archiveFormat") != ARCHIVE_MAGIC.decode("ascii"):
        raise TransferError("unsupported archive format")
    return manifest


def read_package(input_dir: Path, manifest: dict) -> bytes:
    shards = []
    expected_paths = []
    for entry in manifest["shards"]:
        relative = entry["path"]
        validate_asset_name(relative)
        expected_paths.append(relative)
        payload = (input_dir / relative).read_bytes()
        if len(payload) != entry["bytes"] or sha256(payload) != entry["sha256"]:
            raise TransferError(f"shard hash mismatch: {relative}")
        if git_blob_sha(payload) != entry["gitBlobSha"]:
            raise TransferError(f"shard Git blob mismatch: {relative}")
        if not payload.endswith(b"\n") or b"\r" in payload:
            raise TransferError(f"noncanonical shard wrapping: {relative}")
        lines = payload.splitlines()
        if any(not line or len(line) > SHARD_LINE_BYTES for line in lines):
            raise TransferError(f"invalid shard line length: {relative}")
        shards.append(b"".join(lines))
    actual_paths = sorted(str(path.relative_to(input_dir)) for path in (input_dir / "shards").glob("*.txt"))
    if sorted(expected_paths) != actual_paths:
        raise TransferError("shard inventory mismatch")
    package = b"".join(shards)
    if len(package) != manifest["packageBytes"] or sha256(package) != manifest["packageSha256"]:
        raise TransferError("package hash mismatch")
    return package


def reconstruct(input_dir: Path, output: Path) -> dict[str, bytes]:
    if output.exists():
        raise TransferError(f"output already exists: {output}")
    manifest = load_manifest(input_dir)
    package = read_package(input_dir, manifest)
    try:
        xz = base64.b64decode(package, validate=True)
    except (binascii.Error, ValueError) as error:
        raise TransferError("package Base64 is invalid") from error
    if len(xz) != manifest["xzBytes"] or sha256(xz) != manifest["xzSha256"]:
        raise TransferError("XZ payload hash mismatch")
    try:
        archive = lzma.decompress(xz, format=lzma.FORMAT_XZ)
    except lzma.LZMAError as error:
        raise TransferError("XZ decompression failed") from error
    if len(archive) != manifest["archiveBytes"] or sha256(archive) != manifest["archiveSha256"]:
        raise TransferError("archive hash mismatch")
    assets = decode_archive(archive)
    expected = {entry["path"]: entry for entry in manifest["assets"]}
    if set(assets) != set(expected):
        raise TransferError("asset inventory mismatch")
    for name, entry in expected.items():
        validate_asset_name(name)
        payload = assets[name]
        if len(payload) != entry["bytes"] or sha256(payload) != entry["sha256"]:
            raise TransferError(f"asset hash mismatch: {name}")
        if git_blob_sha(payload) != entry["gitBlobSha"]:
            raise TransferError(f"asset Git blob mismatch: {name}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=output.name + ".tmp-", dir=output.parent))
    try:
        for name, payload in assets.items():
            destination = temporary / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
        temporary.rename(output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return assets


def verify(root: Path, input_dir: Path) -> None:
    manifest = load_manifest(input_dir)
    with tempfile.TemporaryDirectory(prefix="zeq-transfer-verify-") as temporary:
        output = Path(temporary) / "reconstructed"
        assets = reconstruct(input_dir, output)
        for name, payload in assets.items():
            original = (root / name).read_bytes()
            if payload != original:
                raise TransferError(f"on-disk reconstruction differs: {name}")
            if (output / name).read_bytes() != original:
                raise TransferError(f"written reconstruction differs: {name}")
        for binary_name, hash_name in (
            ("archive.zeqxfer3", "archiveSha256"),
            ("package.xz", "xzSha256"),
            ("package.b64", "packageSha256"),
        ):
            if sha256((input_dir / binary_name).read_bytes()) != manifest[hash_name]:
                raise TransferError(f"local transfer artifact mismatch: {binary_name}")
    print(json.dumps({
        "roundTripExact": True,
        "assets": len(manifest["assets"]),
        "shards": len(manifest["shards"]),
        "packageSha256": manifest["packageSha256"],
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    pack_parser = subparsers.add_parser("pack")
    pack_parser.add_argument("--root", type=Path, required=True)
    pack_parser.add_argument("--output", type=Path, required=True)
    reconstruct_parser = subparsers.add_parser("reconstruct")
    reconstruct_parser.add_argument("--input", type=Path, required=True)
    reconstruct_parser.add_argument("--output", type=Path, required=True)
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--root", type=Path, required=True)
    verify_parser.add_argument("--input", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        if arguments.command == "pack":
            pack(arguments.root.resolve(), arguments.output.resolve())
        elif arguments.command == "reconstruct":
            assets = reconstruct(arguments.input.resolve(), arguments.output.resolve())
            print(json.dumps({"reconstructed": len(assets)}, indent=2))
        else:
            verify(arguments.root.resolve(), arguments.input.resolve())
    except (TransferError, KeyError, OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(1, f"transfer failed: {error}\n")


if __name__ == "__main__":
    main()
