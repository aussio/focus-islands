#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export FOCUS_ISLANDS_INSTANCE="${FOCUS_ISLANDS_INSTANCE:-ui-smoke}"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset --hidden-window
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
control = root / "scripts/dev-control.sh"

def call(action, value=None):
    args = [str(control), action]
    if value is not None:
        args.append(json.dumps(value) if isinstance(value, (dict, list)) else str(value))
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)

def status(action="status", value=None):
    state = call(action, value)["status"]
    assert state["profile"] == "testing" and not state["appActive"] and not state["dockIconActive"], (action, state["profile"], state["appActive"], state["dockIconActive"])
    assert not state["activations"], f"The hidden Testing app took keyboard focus during {action!r}: {state['activations']}"
    return state

def not_in_front(state):
    # Ask macOS which app is in front, so this does not rely only on the app's own report.
    front = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()
    pid = subprocess.run(["lsappinfo", "info", "-only", "pid", front], capture_output=True, text=True).stdout.split("=")[-1].strip()
    assert pid != str(state["pid"]), f"macOS reports the hidden Testing app (pid {state['pid']}) as the front app"
    return state

def found(selector):
    result = subprocess.run([str(control), "ui-read", selector], capture_output=True, text=True)
    return json.loads(result.stdout)["ok"] if result.stdout else False

def open_settings():
    status("ui-click", "#profile-badge summary")
    status("ui-click", "#profile-settings")
    assert call("ui-read", ".page-head h1")["ui"]["value"] == "Settings"

initial = not_in_front(status())
assert initial["todaySituation"] == "noPlan"
assert initial["game"] and initial["game"]["checkIn"] is None and len(initial["game"]["islands"]) == 1
# Run the day from 9 AM on the Testing clock so the flow works at any real time of day.
now = datetime.now().astimezone()
status("wall-jump", (now.replace(hour=9, minute=0, second=0, microsecond=0) - now).total_seconds() / 60)
assert initial["defaultFocusLength"] == 60 and initial["defaultBreakLength"] == 10
assert initial["defaultStartTime"] == "09:00" and initial["defaultEndTime"] == "17:00"
assert "Away in" not in call("ui-read", ".today-stage-copy")["ui"]["value"]
assert "Settings" not in call("ui-read", "#navigation")["ui"]["value"]
assert "Room" not in call("ui-read", "#navigation")["ui"]["value"]
assert not found("#today-acorns") and not found(".today-garden")
assert found('#today-island[aria-hidden="true"][data-mood]')
assert "Use Testing" not in call("ui-read", "#profile-badge")["ui"]["value"]
open_settings()
assert call("ui-read", "#data-profile")["ui"]["value"] == "testing"
assert call("ui-read", "#settings-start option:first-child")["ui"]["value"] == "07:00"
assert call("ui-read", "#settings-start option:last-child")["ui"]["value"] == "20:45"
assert call("ui-read", "#settings-end option:first-child")["ui"]["value"] == "07:15"
assert call("ui-read", "#settings-end option:last-child")["ui"]["value"] == "21:00"
status("ui-click", "#show-activity-meter")
status("ui-click", "#nav-today")
assert call("ui-read", ".activity-meter")["ui"]["found"]
open_settings()
status("ui-click", "#show-activity-meter")
status("ui-click", "#nav-today")
assert "Away in" not in call("ui-read", ".today-stage-copy")["ui"]["value"]
status("ui-click", "#today-edit-plan")
status("ui-click", "#nav-plan")
assert call("ui-read", "#focus-length")["ui"]["value"] == "60"
assert call("ui-read", "#day-start option:first-child")["ui"]["value"] == "07:00"
assert call("ui-read", "#day-start option:last-child")["ui"]["value"] == "20:45"
assert call("ui-read", "#day-end option:first-child")["ui"]["value"] == "07:15"
assert call("ui-read", "#day-end option:last-child")["ui"]["value"] == "21:00"
status("ui-fill", {"selector": "#day-start", "text": "09:30"})
status("ui-fill", {"selector": "#day-end", "text": "17:00"})
time.sleep(0.9)
planned = status()
assert planned["plannedTimeline"]
assert all(block["kind"] != "free" for block in planned["plannedTimeline"] + planned["forecastTimeline"])
assert call("ui-read", "#suggested-day-calendar .hour-line:first-child span")["ui"]["value"].startswith("10:00")
assert call("ui-read", "#suggested-day-calendar .hour-line:nth-child(8) span")["ui"]["value"].startswith("5:00")
status("ui-click", {"selector": '[data-plan-day="tomorrow"]'})
status("ui-fill", {"selector": "#day-start", "text": "09:15"})
status("ui-fill", {"selector": "#day-end", "text": "17:00"})
status("ui-fill", {"selector": "#focus-length", "text": "35"})
time.sleep(0.9)
tomorrow = status()
assert tomorrow["dayPlans"][tomorrow["tomorrowKey"]]["current"]["focusMinutes"] == 35
assert tomorrow["dayPlans"][tomorrow["todayKey"]]["baseline"]["focusMinutes"] == 60
assert call("ui-read", "#suggested-day-calendar .hour-line:first-child span")["ui"]["value"].startswith("10:00")
status("ui-click", {"selector": '[data-plan-day="today"]'})
status("ui-click", "#open-meetings")
assert call("ui-read", "#meeting-calendar .hour-line:first-child span")["ui"]["value"].startswith("10:00")
dragged_response = call("ui-drag", {"selector": "#meeting-calendar .calendar-inner", "fromY": 90, "toY": 126})
assert dragged_response["ui"]["previewVisible"]
dragged = dragged_response["status"]
assert dragged["profile"] == "testing" and not dragged["appActive"]
assert len(dragged["dayPlans"][dragged["todayKey"]]["current"]["meetings"]) == 0
status("ui-click", "#close-meetings")
time.sleep(0.9)
meeting_plan = status()
assert len(meeting_plan["dayPlans"][meeting_plan["todayKey"]]["current"]["meetings"]) == 1
assert all(block["kind"] != "free" for block in meeting_plan["plannedTimeline"] + meeting_plan["forecastTimeline"])
status("ui-click", "#open-meetings")
resize = call("ui-drag", {"selector": "#meeting-calendar [data-meeting-id]", "fromY": 34, "toY": 52})
assert resize["ui"]["previewVisible"] and not resize["status"]["appActive"]
status("ui-click", "#close-meetings")
time.sleep(0.9)
resized = status()["dayPlans"][initial["todayKey"]]["current"]["meetings"]
assert len(resized) == 1
assert datetime.fromisoformat(resized[0]["end"].replace("Z", "+00:00")) - datetime.fromisoformat(resized[0]["start"].replace("Z", "+00:00")) == timedelta(minutes=45)
meeting_slots = [(item["start"], item["end"]) for item in resized]
status("save-reflection", "A pause helped yesterday.")
status("navigate", "today")
today_image = call("screenshot")
assert today_image["renderedPage"] == today_image["status"]["todayGuidance"]["title"]
print("Today screenshot:", today_image["screenshot"])
first_focus = status("start-focus")
stability = call("input-stability")
assert stability["ok"] and stability["preserved"] and stability["afterBlur"] and stability["saved"] and stability["status"]["phase"] == "focus" and not stability["status"]["appActive"]
due = status("advance", 60)
assert due["phase"] == "focus" and due["breakDue"]
status("ui-click", "#nav-today")
assert call("ui-read", "#snooze-minutes")["ui"]["value"] == "5"
status("ui-fill", {"selector": "#snooze-minutes", "text": "15"})
snoozed = status("ui-click", "#snooze-break")
assert snoozed["phase"] == "focus" and not snoozed["breakDue"] and snoozed["timerTargetSeconds"] >= 75 * 60
assert [(item["start"], item["end"]) for item in snoozed["forecastTimeline"] if item["kind"] == "meeting"] == meeting_slots
status("advance", 15)
status("start-break")
status("advance", 10)
finished = status("finish-break")
assert finished["phase"] == "focus" and finished["timerTargetSeconds"] == finished["focusLength"] * 60
assert finished["focusMinutesToday"] >= 75 and finished["breakMinutesToday"] == 10
assert [(item["start"], item["end"]) for item in finished["forecastTimeline"] if item["kind"] == "meeting"] == meeting_slots
card = finished["game"]["checkIn"]
assert card and card["number"] == 1 and card["choice"]["kind"] == "job", card
job = card["choice"]["options"][0]["job"]
collected = status("game-check-in", {"token": card["token"], "pick": job})
assert collected["game"]["checkIn"] is None and collected["game"]["checkIns"] == 1 and collected["game"]["helpers"][0]["job"] == job
assert status("game-check-in", {"token": card["token"], "pick": job})["game"]["checkIns"] == 1
status("ui-click", "#nav-today")
assert not found("#today-acorns")
assert found(".today-stage > #today-island")
for page, heading in (("plan", "Shape your day"), ("history", "Your rhythm"), ("settings", "Settings")):
    if page == "settings": open_settings()
    else: status("ui-click", f"#nav-{page}")
    assert heading in call("ui-read", ".page-head h1")["ui"]["value"]
    image = call("screenshot")
    assert image["renderedPage"] == heading, (page, image["renderedPage"])
    if page == "history":
        history_text = call("ui-read", ".page")["ui"]["value"]
        # Today's helper job, from the check-in above, shows under "On the island today".
        assert "Acorns" not in history_text and "Today at a glance" in history_text and " became " in history_text, history_text[:600]
    if page == "settings": assert "Reward preview" not in call("ui-read", ".page")["ui"]["value"] and not found("#preview-focus")
    print(f"{page} screenshot:", image["screenshot"])
focus_starts_before_restart = sum(event["kind"] == "focusStarted" for event in call("events")["events"])
subprocess.run([str(root / "scripts/run-dev.sh"), "--hidden-window"], check=True, capture_output=True, text=True)
restored = not_in_front(status())
assert restored["phase"] == "focus" and restored["timer"]["sessionID"] == finished["timer"]["sessionID"]
assert sum(event["kind"] == "focusStarted" for event in call("events")["events"]) == focus_starts_before_restart
assert restored["focusMinutesToday"] == finished["focusMinutesToday"] and restored["breakMinutesToday"] == 10
assert restored["savedReflection"] == "A pause helped yesterday."
assert restored["dayPlans"][restored["todayKey"]]["current"]["meetings"]
assert restored["game"]["checkIns"] == 1 and restored["game"]["helpers"][0]["job"] == job

instance = os.environ.get("FOCUS_ISLANDS_INSTANCE", "default")
state = root / ".build/dev-state" if instance == "default" else root / ".build/dev-instances" / instance
with sqlite3.connect(state / "events.sqlite") as database:
    events = [(kind, json.loads(payload)) for kind, payload in database.execute("SELECT kind, payload FROM events ORDER BY seq")]
assert sum(kind == "dayPlan" for kind, _ in events) == 2
assert sum(kind == "dayPlanRevised" for kind, _ in events) >= 1
assert not any(kind in ("rewardGranted", "rewardDebited", "itemPurchased") for kind, _ in events)
assert [payload.get("reason") for kind, payload in events if kind == "focusStarted"] == ["manual", "afterBreak"]
assert [payload.get("followsSessionID") for kind, payload in events if kind == "breakStarted"] == [first_focus["timer"]["sessionID"]]
assert any(kind == "reflection" for kind, _ in events)
assert sum(kind == "gameStarted" for kind, _ in events) == 1
assert sorted(payload["source"] for kind, payload in events if kind == "gameGranted") == ["focus", "rest"]
assert sum(kind == "gameCheckedIn" for kind, _ in events) == 1
not_in_front(status())
print("PASS isolated Testing loop, screenshots, island slot, focus and break notes, island grants and check-in, reflection, and relaunch")
PY
