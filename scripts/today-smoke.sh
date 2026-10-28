#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export COZY_FOCUS_INSTANCE="${COZY_FOCUS_INSTANCE:-today-smoke}"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset --hidden-window
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
control = root / "scripts/dev-control.sh"

def status(action="status", value=None):
    args = [str(control), action]
    if value is not None:
        args.append(json.dumps(value) if isinstance(value, dict) else str(value))
    result = json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)
    state = result["status"]
    assert state["profile"] == "testing" and not state["appActive"] and not state["dockIconActive"]
    return state

assert status()["todaySituation"] == "noPlan"
now = datetime.now().astimezone()
morning = now.replace(hour=9, minute=30, second=0, microsecond=0)
status("wall-jump", (morning - now).total_seconds() / 60)
start = morning.replace(hour=9, minute=0).isoformat()
end = morning.replace(hour=12, minute=0).isoformat()
planned = status("save-plan", {"start": start, "end": end, "focusMinutes": 25, "breakMinutes": 5})
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
status("navigate", "today")
status("start-focus")
status("activity-sample", 0)
due = status("advance", 150)
assert due["todaySituation"] == "afterDay" and not due["breakDue"]
assert status()["lastBreakReminderPreview"]["kind"] == "endDay"
status("ui-fill", {"selector": "#snooze-minutes", "text": "15"})
snoozed = status("ui-click", "#snooze-end-day")
assert snoozed["todaySituation"] == "wrappingUp"
assert snoozed["phase"] == "focus"
assert datetime.fromisoformat(snoozed["plan"]["end"].replace("Z", "+00:00")) == datetime.fromisoformat(end)
assert status("advance", 16)["todaySituation"] == "afterDay"
result = json.loads(subprocess.run([str(control), "screenshot"], check=True, capture_output=True, text=True).stdout)
print("End-day prompt screenshot:", result["screenshot"])
ended = status("ui-click", "#end-day")
assert ended["phase"] == "idle" and ended["dayEndedAt"] and ended["returnPrompt"] is None
status("ui-fill", {"selector": "#today-reflection-input", "text": "A good day. More time outside tomorrow."})
saved = status("ui-click", "#save-today-reflection")
assert saved["todayReflection"] == "A good day. More time outside tomorrow."
assert status("start-focus")["phase"] == "idle"
assert status("sleep-wake")["phase"] == "idle"
status("quit")
subprocess.run([str(root / "scripts/run-dev.sh"), "--hidden-window"], check=True, capture_output=True, text=True)
reopened = status()
assert reopened["dayEndedAt"] == ended["dayEndedAt"] and reopened["phase"] == "idle"
assert reopened["todayReflection"] == saved["todayReflection"]
status("ui-click", "#edit-today-reflection")
status("ui-fill", {"selector": "#today-reflection-input", "text": "A good day, with room for a longer walk."})
assert status("ui-click", "#save-today-reflection")["todayReflection"] == "A good day, with room for a longer walk."
result = json.loads(subprocess.run([str(control), "screenshot"], check=True, capture_output=True, text=True).stdout)
print("Ended-day reflection screenshot:", result["screenshot"])
status("ui-click", "#plan-tomorrow")
assert status()["page"] == "plan"
assert status("wall-jump", 24 * 60)["savedReflection"] == "A good day, with room for a longer walk."
assert status()["dayEndedAt"] is None
print("PASS end-day guidance, snooze, reflection editing, restart, and next-day reset")
PY
