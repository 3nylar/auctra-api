"""Signature verification in Python. Same rules: raw body, timestamp, constant time."""
import hashlib
import hmac
import time

TOLERANCE = 300  # seconds


def verify(raw_body: bytes, header: str, secret: str) -> bool:
    try:
        parts = dict(kv.split("=", 1) for kv in header.split(","))
        timestamp = int(parts["t"])
        given = bytes.fromhex(parts["v1"])
    except (ValueError, KeyError):
        return False

    # A bare HMAC of the body is replayable forever. The timestamp is what kills that.
    if abs(time.time() - timestamp) > TOLERANCE:
        return False

    signed = f"{timestamp}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).digest()

    return hmac.compare_digest(expected, given)


# --- Flask ------------------------------------------------------------------
# from flask import Flask, request, abort
#
# @app.post("/hooks/auctra")
# def hook():
#     if not verify(request.get_data(), request.headers.get("Auctra-Signature", ""), SECRET):
#         abort(400)
#     queue.enqueue(handle, request.get_json())   # acknowledge now, work later
#     return "", 200
