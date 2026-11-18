#!/usr/bin/env python3
"""Independent Phase 5 signed-manifest and sealed-parcel vectors."""
import base64
import hashlib
import json
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ROOT = Path(__file__).resolve().parents[1]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def b64(value):
    return base64.b64encode(value).decode()


def identity(zid, ed_seed, x_seed):
    ed = Ed25519PrivateKey.from_private_bytes(ed_seed)
    x = X25519PrivateKey.from_private_bytes(x_seed)
    public = ed.public_key().public_bytes_raw()
    anchor = {
        "format": "zeq-trust-anchor-v1", "machine_zid": zid,
        "key_id": hashlib.sha256(public).hexdigest(), "algorithm": "Ed25519",
        "public_key": b64(public), "trust": "self-declared",
    }
    body = {
        "format": "zeq-machine-genesis-v1", "machine_zid": zid,
        "signer": anchor, "x25519_public_key": b64(x.public_key().public_bytes_raw()),
    }
    record = {**body, "signature": b64(ed.sign(canonical(body)))}
    return ed, x, record


def main():
    sender_seed = bytes.fromhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
    recipient_seed = bytes.fromhex("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f")
    sender_x_seed = bytes.fromhex("404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f")
    recipient_x_seed = bytes.fromhex("606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f")
    ephemeral_seed = bytes.fromhex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
    nonce = bytes(range(100, 112))
    plaintext = b"ZEQ phase 5 independent parcel vector\x00\xff"
    sender_ed, _, sender = identity("vector-sender", sender_seed, sender_x_seed)
    _, recipient_x, recipient = identity("vector-recipient", recipient_seed, recipient_x_seed)
    ephemeral = X25519PrivateKey.from_private_bytes(ephemeral_seed)
    eph_raw = ephemeral.public_key().public_bytes_raw()
    recipient_raw = recipient_x.public_key().public_bytes_raw()
    shared = ephemeral.exchange(recipient_x.public_key())
    assert shared != bytes(32)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"zeq-e2ee-v1", info=eph_raw + recipient_raw).derive(shared)
    header = {"expires_zeqond": "200", "from": "vector-sender", "name": "Vector parcel", "to": "vector-recipient"}
    eph_pub = b64(eph_raw)
    aad = b"box:v1|" + eph_pub.encode() + b"|100|" + canonical(header)
    sealed = AESGCM(key).encrypt(nonce, plaintext, aad)
    box = {
        "eph_pub": eph_pub, "nonce": b64(nonce), "tag": b64(sealed[-16:]),
        "ct": b64(sealed[:-16]), "header": header, "zeqond": "100",
    }
    body = {
        "format": "ZEQ-PARCEL-v2", "from": sender, "to": "vector-recipient",
        "name": "Vector parcel", "bytes": str(len(plaintext)),
        "expires_zeqond": "200", "box": box,
    }
    parcel = {**body, "signature": b64(sender_ed.sign(canonical(body)))}
    parcel_id = hashlib.sha256(canonical(parcel)).hexdigest()
    assert AESGCM(key).decrypt(nonce, sealed, aad) == plaintext
    vector = {
        "format": "zeq-content-v1",
        "warning": "Deterministic public test keys only; never use for real identities.",
        "sender_seed": sender_seed.hex(), "recipient_seed": recipient_seed.hex(),
        "sender_x25519_seed": sender_x_seed.hex(), "recipient_x25519_seed": recipient_x_seed.hex(),
        "ephemeral_x25519_seed": ephemeral_seed.hex(), "nonce": nonce.hex(),
        "plaintext": b64(plaintext), "sender": sender, "recipient": recipient,
        "parcel": parcel, "parcel_id": parcel_id,
    }
    (ROOT / "vectors").mkdir(exist_ok=True)
    (ROOT / "vectors" / "zeq-content-v1.json").write_text(json.dumps(vector, separators=(",", ":")) + "\n")
    print("Python OK: independent Ed25519 + X25519/HKDF-SHA256/AES-256-GCM parcel vector")


if __name__ == "__main__":
    main()
