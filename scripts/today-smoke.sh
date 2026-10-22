#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import sqlite3
import subprocess
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])

def command(action, value=None):
    args = [str(root / "scripts/dev-control.sh"), action]
    if value is not None:
        args.append(str(value))
    result = json.loads(subprocess.run(args, capture_output=True, text=True, check=True).stdout)
    status = result["status"]
    assert status["profile"] == "testing", "Today checks must use Testing"
    assert not status["appActive"], "Today check activated the app"
    return result

def status(action="status", value=None):
    return command(action, value)["status"]

def near(actual, expected):
    assert abs(actual - expected) < 1, (actual, expected)

def until_minute(state, minute):
    return state["plannedWindows"][0]["start"] + minute * 60 - state["currentWallTime"]

assert status()["todaySituation"] == "noPlan"
status("day-time", 18)
initial = status("set-rhythm", "60:15")
assert initial["planSavePending"]
near(initial["todayProposedSeconds"], until_minute(initial, 60))
status("navigate", "today")
print("Focus suggestion screenshot", command("screenshot")["screenshot"])
changed = status("set-rhythm", "40:20")
assert changed["planSavePending"]
near(changed["todayProposedSeconds"], until_minute(changed, 40))
meeting = status("meeting-window", "Review:32:30")
assert meeting["planSavePending"]
near(meeting["todayProposedSeconds"], until_minute(meeting, 30))
custom = status("edit-block", "0:break")
assert custom["todaySituation"] == "rest"
assert custom["plannedWindows"][0]["kind"] == "break"
near(custom["todayProposedSeconds"], until_minute(custom, 30))
status("edit-block", "0:focus")
started = status("today-suggestion")
assert started["phase"] == "focus"
near(started["timerTargetSeconds"], until_minute(started, 30))
target = started["timerTargetSeconds"]
assert status("set-rhythm", "80:10")["timerTargetSeconds"] == target
updated = status("meeting-window", "Quick sync:25:15")
assert updated["timerTargetSeconds"] == target
assert updated["todaySituation"] == "runningFocus"
with sqlite3.connect(root / ".build/dev-state/events.sqlite") as database:
    payload = database.execute("SELECT payload FROM events WHERE kind = 'focusStarted' ORDER BY seq DESC LIMIT 1").fetchone()[0]
assert json.loads(payload)["targetSeconds"] == target
print("Running focus screenshot", command("screenshot")["screenshot"])
status("end-focus")
soon = status("day-time", 21)
assert soon["todaySituation"] == "meetingSoon"
near(soon["todayProposedSeconds"], until_minute(soon, 23))
print("Meeting soon screenshot", command("screenshot")["screenshot"])
rest = status("today-suggestion")
assert rest["phase"] == "break"
near(rest["timerTargetSeconds"], until_minute(rest, 23))
status("advance", 2)
assert status()["phase"] == "break", "A completed break must wait for confirmation"
status("finish-break")
assert status("day-time", 26)["todaySituation"] == "meeting"
assert status()["todayProposedSeconds"] == 0
assert status("day-time", 70)["todaySituation"] == "focus"
status("day-time", 150)
status("set-rhythm", "60:15")
rest_slot = status("day-time", 127)
assert rest_slot["todaySituation"] == "rest"
near(rest_slot["todayProposedSeconds"], until_minute(rest_slot, 137))
status("set-rhythm", "60:20")
longer = status()
near(longer["todayProposedSeconds"], until_minute(longer, 142))
assert status("day-time", 480)["todaySituation"] == "afterDay"
assert status("day-time", 960)["todaySituation"] == "noPlan"
assert status()["plannedWindows"] == []
status("quit")
print("PASS live plan edits, exact persisted targets, meeting buffer, timer preservation, clock progression, and midnight rollover")
PY
trap - EXIT
