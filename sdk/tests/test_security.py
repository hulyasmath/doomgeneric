#!/usr/bin/env python3
"""Independent Phase 3 vectors and negative tests using Python cryptography."""
import base64
import hashlib
import json
from pathlib import Path
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
HITE = b"HULYAS.HITE.f=1.287Hz.tau=0.777s"
MAGIC = b"ZEQC3"
PIN = "correct-horse-9"
SALT = bytes(range(16))
IV = bytes(range(100, 112))
SAVE = bytes([0, 1, 2, 3, 255])


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def main():
    run = {"format": "zeq-run-v1", "run_id": "0123456789abcdef0123456789abcdef"}
    plain = {
        "format": "zeq-doom-save-v1", "run": run, "machine_zid": "test-machine",
        "created_zeqond": "7", "created_phase64": "99", "save_encoding": "doom-save-le-v1",
        "save_bytes": str(len(SAVE)), "save_data": base64.b64encode(SAVE).decode(),
        "zeq_state": {"ruleset": 1, "cooldowns": [0, 20]},
    }
    key = hashlib.scrypt(PIN.encode(), salt=HITE + SALT, n=2**17, r=8, p=1, dklen=32, maxmem=2**17 * 8 * 128 * 2)
    sealed = AESGCM(key).encrypt(IV, canonical(plain), MAGIC + SALT)
    capsule = MAGIC + SALT + IV + sealed
    assert AESGCM(key).decrypt(IV, capsule[33:], MAGIC + SALT) == canonical(plain)
    for bad in (capsule[:-1], capsule[:-1] + bytes([capsule[-1] ^ 1]), b"ZEQC2" + capsule[5:]):
        try:
            if len(bad) < 49 or bad[:5] != MAGIC:
                raise ValueError("invalid container")
            AESGCM(key).decrypt(IV, bad[33:], MAGIC + SALT)
            raise AssertionError("negative capsule test was not refused")
        except (ValueError, InvalidTag):
            pass
    seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    signer = Ed25519PrivateKey.from_private_bytes(seed)
    public = signer.public_key().public_bytes_raw()
    signature = signer.sign(b"")
    assert public.hex() == "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    assert signature.hex().startswith("e5564300c360ac729086e2cc806e828a")
    vectors = {
        "format": "zeq-security-v1", "pin": PIN, "salt": SALT.hex(), "iv": IV.hex(),
        "capsule": base64.b64encode(capsule).decode(), "plaintext": plain,
        "ed25519_rfc8032_test1": {"seed": seed.hex(), "public_key": public.hex(), "message": "", "signature": signature.hex()},
    }
    (ROOT / "vectors").mkdir(exist_ok=True)
    (ROOT / "vectors" / "zeq-security-v1.json").write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    print("Python OK: ZEQC3 independent vector + wrong-layout/tamper/truncation + RFC 8032 Ed25519 vector")


if __name__ == "__main__":
    main()
