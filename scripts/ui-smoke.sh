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
control = root / "scripts/dev-control.sh"

def command(action, value=None):
    args = [str(control), action]
    if value is not None:
        args.append(str(value))
    result = subprocess.run(args, text=True, capture_output=True, check=True)
    return json.loads(result.stdout)

def screenshot(label):
    path = command("screenshot")["screenshot"]
    print(f"{label}: {path}")

initial = command("status")["status"]
assert not initial["appActive"], "Development app took keyboard focus"
assert initial["profile"] == "testing", "Smoke test must use the isolated Testing profile"
assert not initial["dockIconActive"], "Menu bar app unexpectedly appeared in the Dock"
command("scenario", "morning")
edited = command("edit-block", "0:free")["status"]
assert edited["suggestions"][0] == "Free"
command("edit-block-start", "2:5")
timed = command("edit-block-duration", "2:15")["status"]
assert timed["suggestionMinutes"][1:3] == [10, 15]
first_reflection = "A real pause helped yesterday."
saved = command("save-reflection", first_reflection)["status"]
assert saved["savedReflection"] == first_reflection and not saved["reflectionIsEditing"]
editing = command("edit-reflection")["status"]
assert editing["reflectionIsEditing"] and editing["reflection"] == first_reflection
reflection_note = "A real pause made yesterday easier."
saved = command("save-reflection", reflection_note)["status"]
assert saved["savedReflection"] == reflection_note and not saved["reflectionIsEditing"]
screenshot("Morning plan")
command("navigate", "today")
command("start-focus")
due = command("advance", 25)["status"]
assert due["phase"] == "focus" and due["breakDue"]
screenshot("Break due")
command("start-break")
command("advance", 5)
finished = command("finish-break")["status"]
assert finished["phase"] == "idle"
assert finished["focusMinutesToday"] == 25
assert finished["breakMinutesToday"] == 5
command("navigate", "history")
screenshot("Day history")
command("purchase", "plant")
command("navigate", "room")
room = command("status")["status"]
assert "plant" in room["unlockedItems"]
screenshot("Purchased room item")
command("navigate", "settings")
screenshot("Reward preview")
assert not command("status")["status"]["appActive"], "Smoke test activated the app"

subprocess.run([str(root / "scripts/run-dev.sh")], check=True, capture_output=True, text=True)
restored = command("status")["status"]
assert restored["focusMinutesToday"] == 25
assert restored["breakMinutesToday"] == 5
assert "plant" in restored["unlockedItems"]
assert restored["suggestions"][0] == "Free"
assert restored["suggestionMinutes"][1:3] == [10, 15]
assert restored["reflection"] == reflection_note
assert restored["savedReflection"] == reflection_note and not restored["reflectionIsEditing"]
assert not restored["appActive"]
assert restored["profile"] == "testing"

with sqlite3.connect(root / ".build/dev-state/events.sqlite") as database:
    events = database.execute("SELECT id, kind, payload FROM events ORDER BY seq").fetchall()
plans = [(event_id, json.loads(payload)) for event_id, kind, payload in events if kind in ("dayPlan", "dayPlanRevised")]
assert len(plans) == 1, "Rapid plan tweaks created extra history facts"
assert any(kind == "reflection" and json.loads(payload)["note"] == reflection_note for _, kind, payload in events)

command("start-focus")
interrupted = command("advance", 10)["status"]
interrupted_minutes, interrupted_seconds = map(int, interrupted["countdown"].split(":"))
assert interrupted["phase"] == "focus"
assert 14 * 60 + 45 <= interrupted_minutes * 60 + interrupted_seconds <= 15 * 60
subprocess.run([str(root / "scripts/run-dev.sh")], check=True, capture_output=True, text=True)
recovered = command("status")["status"]
assert recovered["phase"] == "focus"
remaining_minutes, remaining_seconds = map(int, recovered["countdown"].split(":"))
assert 14 * 60 + 45 <= remaining_minutes * 60 + remaining_seconds <= 15 * 60, "Unobserved time was counted after relaunch"
assert recovered["focusMinutesToday"] == 25
assert recovered["reflection"] == reflection_note
assert recovered["savedReflection"] == reflection_note and not recovered["reflectionIsEditing"]
assert recovered["suggestions"][0] == "Free"
assert recovered["suggestionMinutes"][1:3] == [10, 15]
assert not recovered["appActive"]
command("advance", 15)
command("end-focus")
assert command("status")["status"]["phase"] == "idle"
with sqlite3.connect(root / ".build/dev-state/events.sqlite") as database:
    completed_events = database.execute("SELECT kind, payload FROM events ORDER BY seq").fetchall()
focus_ends = [json.loads(payload) for kind, payload in completed_events if kind == "focusEnded"]
assert len(focus_ends) == 2 and focus_ends[-1]["elapsedSeconds"] == 1500
grants = [json.loads(payload) for kind, payload in completed_events if kind == "rewardGranted"]
assert sum(grant["sourceID"] == focus_ends[-1]["sessionID"] for grant in grants) == 1
command("start-focus")
command("away")
away = command("advance", 10)["status"]
away_minutes, away_seconds = map(int, away["countdown"].split(":"))
assert away["suspended"] and away_minutes * 60 + away_seconds >= 24 * 60 + 50, "Idle time earned focus credit"
command("return")
command("end-focus")
command("start-focus")
command("lock")
locked = command("advance", 10)["status"]
locked_minutes, locked_seconds = map(int, locked["countdown"].split(":"))
assert locked["suspended"] and locked_minutes * 60 + locked_seconds >= 24 * 60 + 50, "Locked time earned focus credit"
command("unlock")
command("end-focus")
command("start-focus")
after_sleep = command("sleep-wake")["status"]
sleep_minutes, sleep_seconds = map(int, after_sleep["countdown"].split(":"))
assert sleep_minutes * 60 + sleep_seconds >= 24 * 60 + 50, "Sleep time earned focus credit"
after_clock_change = command("wall-jump", 5)["status"]
clock_minutes, clock_seconds = map(int, after_clock_change["countdown"].split(":"))
assert clock_minutes * 60 + clock_seconds >= 24 * 60 + 45, "Wall-clock change earned focus credit"
command("end-focus")
command("meeting-window", "Review:180:45")
command("revise-meeting", "Review:195:60")
calendar = command("open-meeting-editor")["status"]
assert calendar["meetingEditorOpen"] and "Review" in calendar["meetings"]
assert calendar["planSavePending"], "Meeting edits should wait for the settled plan"
assert calendar["meetings"].count("Review") == 1
assert any(window["title"] == "Review" and window["duration"] == 60 for window in calendar["meetingWindows"])
screenshot("Meeting day editor")
command("close-meeting-editor")
with sqlite3.connect(root / ".build/dev-state/events.sqlite") as database:
    plan_events = [(event_id, json.loads(payload)) for event_id, kind, payload in database.execute("SELECT id, kind, payload FROM events ORDER BY seq") if kind in ("dayPlan", "dayPlanRevised")]
assert len(plan_events) == 2, "Nearby meeting adjustments did not coalesce into one revision"
assert plan_events[-1][1]["revisesEventID"] == plan_events[-2][0], "Plan revision lost its parent"
assert not command("status")["status"]["appActive"], "Meeting editor activated the app"
command("quit")
print("PASS isolated Testing profile, timeline edits, meeting editor, reflection, recovery, activity suspensions, screenshots, purchase, and quit")
PY
trap - EXIT
