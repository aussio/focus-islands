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

def current_window(state):
    return next(window for window in state["plannedWindows"]
                if window["start"] <= state["currentWallTime"] < window["end"])

def until_minute(state, minute):
    return state["plannedWindows"][0]["start"] + minute * 60 - state["currentWallTime"]

def at_first_break_after(state, minute):
    start = state["plannedWindows"][0]["start"]
    window = next(window for window in state["plannedWindows"]
                  if window["kind"] == "break" and window["start"] >= start + minute * 60)
    return status("day-time", int((window["start"] - start) / 60) + 1)

assert status()["todaySituation"] == "noPlan"
status("day-time", 18)
initial = status("rhythm", "60:15")
assert initial["planSavePending"]
assert initial["todaySituation"] == "focus"
near(initial["todayProposedSeconds"], current_window(initial)["end"] - initial["currentWallTime"])
status("navigate", "today")
print("Focus suggestion screenshot", command("screenshot")["screenshot"])
changed = status("rhythm", "40:20")
assert changed["planSavePending"]
assert current_window(changed)["end"] != current_window(initial)["end"]
near(changed["todayProposedSeconds"], current_window(changed)["end"] - changed["currentWallTime"])
meeting = status("meeting-window", "Review:32:30")
assert meeting["planSavePending"]
meeting_start = next(window["start"] for window in meeting["plannedWindows"] if window["kind"] == "meeting")
near(meeting["todayProposedSeconds"], min(current_window(meeting)["end"], meeting_start - 120) - meeting["currentWallTime"])
custom = status("edit-block", "0:break")
assert custom["todaySituation"] == "rest"
assert custom["plannedWindows"][0]["kind"] == "break"
near(custom["todayProposedSeconds"], min(current_window(custom)["end"], meeting_start - 120) - custom["currentWallTime"])
status("edit-block", "0:focus")
ready = status()
started = status("today-suggestion")
assert started["phase"] == "focus"
near(started["timerTargetSeconds"], min(current_window(started)["end"], meeting_start - 120) - started["currentWallTime"])
assert abs(started["timerTargetSeconds"] - ready["todayProposedSeconds"]) < 2
target = started["timerTargetSeconds"]
assert status("rhythm", "80:10")["timerTargetSeconds"] == target
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
after_meeting = status("day-time", 70)
assert after_meeting["todaySituation"] in {"focus", "rest", "free"}
status("rhythm", "60:15")
rest_slot = at_first_break_after(status(), 70)
assert rest_slot["todaySituation"] == "rest"
near(rest_slot["todayProposedSeconds"], current_window(rest_slot)["end"] - rest_slot["currentWallTime"])
assert current_window(rest_slot)["end"] - current_window(rest_slot)["start"] == 15 * 60
status("rhythm", "60:20")
longer = at_first_break_after(status(), 70)
assert longer["todaySituation"] == "rest"
near(longer["todayProposedSeconds"], current_window(longer)["end"] - longer["currentWallTime"])
assert current_window(longer)["end"] - current_window(longer)["start"] == 20 * 60
assert status("day-time", 480)["todaySituation"] == "afterDay"
assert status("day-time", 960)["todaySituation"] == "noPlan"
assert status()["plannedWindows"] == []
status("quit")
print("PASS live plan edits, exact persisted targets, meeting buffer, timer preservation, clock progression, and midnight rollover")
PY
trap - EXIT
