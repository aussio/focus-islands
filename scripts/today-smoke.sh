#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
control = root / "scripts/dev-control.sh"

def status(action="status", value=None):
    args = [str(control), action]
    if value is not None:
        args.append(json.dumps(value) if isinstance(value, dict) else str(value))
    result = json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)
    state = result["status"]
    assert state["profile"] == "testing" and not state["appActive"]
    return state

assert status()["todaySituation"] == "noPlan"
now = datetime.now(timezone.utc)
start = (now - timedelta(minutes=5)).isoformat()
end = (now + timedelta(hours=2)).isoformat()
planned = status("save-plan", {"dayStart": start, "dayEnd": end, "focusLength": 25, "breakLength": 5})
assert planned["plannedTimeline"] and planned["todaySituation"] == "focus"
started = status("today-suggestion")
assert started["phase"] == "focus"
target = started["timerTargetSeconds"]
assert 0 < target <= 25 * 60
changed = status("rhythm", {"focusMinutes": 40, "breakMinutes": 10})
assert changed["timerTargetSeconds"] == target
assert changed["focusLength"] == 40 and changed["breakLength"] == 10
status("end-focus")
print("PASS plan guidance, suggested timer target, and active target preservation")
PY
