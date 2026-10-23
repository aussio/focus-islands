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
import time
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
    return state

initial = status()
assert initial["todaySituation"] == "noPlan"
status("ui-click", "#today-edit-plan")
status("ui-click", "#nav-plan")
assert call("ui-read", "#focus-length")["ui"]["value"] == "25"
status("ui-fill", {"selector": "#day-start", "text": "09:00"})
assert not status()["dayPlans"][initial["todayKey"]].get("baseline")
status("ui-fill", {"selector": "#day-end", "text": "17:00"})
time.sleep(0.9)
planned = status()
assert planned["plannedTimeline"]
assert all(block["kind"] != "free" for block in planned["plannedTimeline"] + planned["forecastTimeline"])
status("ui-click", {"selector": '[data-plan-day="tomorrow"]'})
status("ui-fill", {"selector": "#day-start", "text": "09:00"})
status("ui-fill", {"selector": "#day-end", "text": "17:00"})
status("ui-fill", {"selector": "#focus-length", "text": "35"})
time.sleep(0.9)
tomorrow = status()
assert tomorrow["dayPlans"][tomorrow["tomorrowKey"]]["current"]["focusMinutes"] == 35
assert tomorrow["dayPlans"][tomorrow["todayKey"]]["baseline"]["focusMinutes"] == 25
status("ui-click", {"selector": '[data-plan-day="today"]'})
status("ui-click", "#open-meetings")
dragged = status("ui-drag", {"selector": "#meeting-calendar .calendar-inner", "fromY": 90, "toY": 126})
assert len(dragged["dayPlans"][dragged["todayKey"]]["current"]["meetings"]) == 0
status("ui-click", "#close-meetings")
time.sleep(0.9)
meeting_plan = status()
assert len(meeting_plan["dayPlans"][meeting_plan["todayKey"]]["current"]["meetings"]) == 1
assert all(block["kind"] != "free" for block in meeting_plan["plannedTimeline"] + meeting_plan["forecastTimeline"])
status("save-reflection", "A pause helped yesterday.")
status("navigate", "today")
today_image = call("screenshot")
assert today_image["renderedPage"] == "Your little corner of today"
print("Today screenshot:", today_image["screenshot"])
status("start-focus")
stability = call("input-stability")
assert stability["ok"] and stability["preserved"] and stability["afterBlur"] and stability["saved"] and stability["status"]["phase"] == "focus" and not stability["status"]["appActive"]
due = status("advance", 25)
assert due["phase"] == "focus" and due["breakDue"]
status("start-break")
status("advance", 5)
finished = status("finish-break")
assert finished["phase"] == "idle"
assert finished["focusMinutesToday"] == 25 and finished["breakMinutesToday"] == 5
status("ui-click", "#nav-room")
room = status("ui-click", "#purchase-plant")
assert "plant" in room["unlockedItems"]
for page, heading in (("plan", "Shape your day"), ("history", "Your rhythm"), ("room", "Your little room"), ("settings", "Make it yours")):
    status("navigate", page)
    image = call("screenshot")
    assert image["renderedPage"] == heading, (page, image["renderedPage"])
    print(f"{page} screenshot:", image["screenshot"])
subprocess.run([str(root / "scripts/run-dev.sh")], check=True, capture_output=True, text=True)
restored = status()
assert restored["focusMinutesToday"] == 25 and restored["breakMinutesToday"] == 5
assert restored["savedReflection"] == "A pause helped yesterday."
assert "plant" in restored["unlockedItems"]
assert restored["dayPlans"][restored["todayKey"]]["current"]["meetings"]

instance = os.environ.get("COZY_FOCUS_INSTANCE", "default")
state = root / ".build/dev-state" if instance == "default" else root / ".build/dev-instances" / instance
with sqlite3.connect(state / "events.sqlite") as database:
    events = [(kind, json.loads(payload)) for kind, payload in database.execute("SELECT kind, payload FROM events ORDER BY seq")]
assert sum(kind == "dayPlan" for kind, _ in events) == 2
assert sum(kind == "dayPlanRevised" for kind, _ in events) >= 1
assert sum(kind == "rewardGranted" for kind, _ in events) == 2
assert sum(kind == "itemPurchased" for kind, _ in events) == 1
assert any(kind == "reflection" for kind, _ in events)
print("PASS isolated Testing loop, screenshots, rewards, reflection, purchase, and relaunch")
PY
