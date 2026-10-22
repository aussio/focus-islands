#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset
status="$("$repo_root/scripts/dev-control.sh" status)"
STATUS_JSON="$status" /usr/bin/python3 - <<'PY'
import json
import os
state = json.loads(os.environ["STATUS_JSON"])["status"]
assert state["profile"] == "testing" and not state["appActive"]
PY
"$repo_root/scripts/chrome-smoke.sh" --live
status="$("$repo_root/scripts/dev-control.sh" status)"
STATUS_JSON="$status" /usr/bin/python3 - <<'PY'
import json
import os
state = json.loads(os.environ["STATUS_JSON"])["status"]
assert state["profile"] == "testing" and not state["appActive"]
assert state["phase"] == "break"
PY
