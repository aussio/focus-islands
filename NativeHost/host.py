#!/usr/bin/python3
"""Native Messaging bridge: return only the app's leased focus phase."""

import json
import os
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path


ORIGIN = "chrome-extension://gpomofinaopfjfpieooejmlpjaiadfnp/"
DEFAULT_STATUS = Path.home() / "Library/Application Support/CozyFocusPet/focus-status.json"
MAX_LEASE_SECONDS = 120


def parse_time(value):
    if not isinstance(value, str):
        raise ValueError("timestamp missing")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp missing time zone")
    return parsed.astimezone(timezone.utc)


def current_status():
    path = Path(os.environ.get("FOCUS_ISLANDS_STATUS_FILE", DEFAULT_STATUS))
    try:
        if path.stat().st_size > 16_384:
            raise ValueError("status too large")
        status = json.loads(path.read_text(encoding="utf-8"))
        now = datetime.now(timezone.utc)
        updated = parse_time(status["updatedAt"])
        expires = parse_time(status["expiresAt"])
        remaining = (expires - now).total_seconds()
        age = (now - updated).total_seconds()
        lease = (expires - updated).total_seconds()
        if not (-30 <= age <= MAX_LEASE_SECONDS and 0 < remaining <= MAX_LEASE_SECONDS and 0 < lease <= MAX_LEASE_SECONDS):
            return {"phase": "idle", "active": False, "reason": "stale-status"}
        phase = status.get("phase")
        if phase not in ("focus", "break", "idle"):
            raise ValueError("invalid phase")
        return {"phase": phase, "active": phase == "focus", "expiresAt": expires.isoformat()}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return {"phase": "idle", "active": False, "reason": "missing-or-invalid-status"}


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    length = struct.unpack("=I", header)[0]
    if length > 4096:
        return None
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        return None
    try:
        return json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        return None


def write_message(message):
    data = json.dumps(message, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    message = read_message()
    if not isinstance(message, dict) or message.get("command") != "status":
        write_message({"phase": "idle", "active": False, "reason": "invalid-command"})
    elif len(sys.argv) > 1 and sys.argv[1] != ORIGIN:
        write_message({"phase": "idle", "active": False, "reason": "invalid-origin"})
    else:
        write_message(current_status())


if __name__ == "__main__":
    main()
