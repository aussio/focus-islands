#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
instance="${COZY_FOCUS_INSTANCE:-default}"
if [[ ! "$instance" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then echo "Invalid COZY_FOCUS_INSTANCE." >&2; exit 2; fi
if [[ "$instance" == default ]]; then state="$repo_root/.build/dev-state"
else state="$repo_root/.build/dev-instances/$instance"; fi
control_dir="$state/control"
if [[ ! -d "$control_dir" ]]; then
  printf 'No development control inbox. Start the app with scripts/run-dev.sh first.\n' >&2
  exit 1
fi
/usr/bin/python3 - "$control_dir" "${1:-}" "${2:-}" <<'PY'
import json
import os
import sys
import time
import uuid
from pathlib import Path

directory = Path(sys.argv[1])
action = sys.argv[2]
value = sys.argv[3]
if value.startswith(("{", "[")):
    try:
        value = json.loads(value)
    except json.JSONDecodeError:
        pass
if not action:
    raise SystemExit("Usage: scripts/dev-control.sh ACTION [VALUE]")
request_id = str(uuid.uuid4())
request = directory / f"{request_id}.json"
temporary = directory / f"{request_id}.tmp"
response = directory / f"{request_id}.response"
temporary.write_text(json.dumps({"id": request_id, "action": action, "value": value}), encoding="utf-8")
os.replace(temporary, request)
# A gallery-screenshot may ask the app to wait up to 60 seconds for its page; wait that much longer here too.
extra = value.get("timeout") if action == "gallery-screenshot" and isinstance(value, dict) else None
extra = min(60, max(0, extra)) if isinstance(extra, (int, float)) and not isinstance(extra, bool) else 0
deadline = time.monotonic() + 15 + extra
while time.monotonic() < deadline:
    if response.exists():
        result = json.loads(response.read_text(encoding="utf-8"))
        response.unlink()
        print(json.dumps(result, indent=2, sort_keys=True))
        activations = (result.get("status") or {}).get("activations") or []
        if activations:
            last = activations[-1]
            print(f"WARNING: this Testing app has taken keyboard focus {len(activations)} time(s) since launch; "
                  f"last at {last['at']} during {last['duringControlAction'] or 'no control action'}: {last['cause']}.",
                  file=sys.stderr)
        raise SystemExit(0 if result.get("ok") else 1)
    time.sleep(0.1)
raise SystemExit("Timed out waiting for the development app. Check the app window or Console logs.")
PY
