#!/bin/bash
# Screenshot tour of the sky island on Today, taken from a hidden Testing app with its own instance.
# Pictures are copied to .build/game-tour/<name>.png. Never touches Personal data or other instances.
#
#   scripts/game-tour.sh
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export COZY_FOCUS_INSTANCE="${COZY_FOCUS_INSTANCE:-game-tour}"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset --hidden-window
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
control = root / "scripts/dev-control.sh"
out = root / ".build/game-tour"
out.mkdir(parents=True, exist_ok=True)
for old in out.glob("*.png"):
    old.unlink()
taken = []

def call(action, value=None):
    args = [str(control), action]
    if value is not None:
        args.append(json.dumps(value) if isinstance(value, (dict, list)) else str(value))
    result = subprocess.run(args, capture_output=True, text=True)
    if not result.stdout:
        raise SystemExit(f"{action} failed: {result.stderr.strip()}")
    data = json.loads(result.stdout)
    if not data.get("ok"):
        raise SystemExit(f"{action} failed: {data.get('error')}")
    return data

def status(action="status", value=None):
    state = call(action, value)["status"]
    assert state["profile"] == "testing", state["profile"]
    assert not state["appActive"], "the Testing window became active"
    return state

def game():
    return status()["game"] or {}

def settle_return():
    # Coming back from time away can open the "Are you back?" prompt; answer it so later pictures are clean.
    state = status()
    if state.get("returnPrompt"):
        status("keep-break" if state["phase"] in ("break", "rest") else "confirm-return")

def capture(name, away=False):
    if not away:
        status("activity-sample", 0)
    state = status()
    assert state["page"] == "today", state["page"]
    call("screenshot")  # A covered window redraws only while being captured, so the first picture is thrown away.
    shot = call("screenshot")
    state = shot["status"]
    assert state["profile"] == "testing" and not state["appActive"]
    target = out / f"{name}.png"
    shutil.copyfile(shot["screenshot"], target)
    card = (state.get("game") or {}).get("checkIn")
    kind = (card or {}).get("choice", {}) or {}
    print(f"{name}: {target}  (mood scene drew: {shot.get('islandDrew')}, card: {kind.get('kind', 'collect') if card else 'none'})")
    taken.append(target)

def focus_then_break(focus=60, rest=10):
    status("activity-sample", 0)
    # start-focus, not today-suggestion: on a day with no saved plan the suggestion opens Plan instead.
    if status()["phase"] != "focus":
        status("start-focus")
    status("advance", focus)
    status("start-break")
    status("advance", rest)
    status("activity-sample", 0)
    status("finish-break")
    settle_return()

# 1. A fresh island in focus, on a fresh database.
status("activity-sample", 0)
now = datetime.now().astimezone()
status("wall-jump", (now.replace(hour=9, minute=30, second=0, microsecond=0) - now).total_seconds() / 60)
status("start-focus")
status("advance", 5)
assert status()["phase"] == "focus"
capture("01-focus-fresh")

# The first check-in scenario needs an island that has earned nothing yet, so start over.
status("quit")
subprocess.run([str(root / "scripts/run-dev.sh"), "--reset", "--hidden-window"], check=True, capture_output=True, text=True)

# 2. The first check-in card: one focus session and one real break.
status("activity-sample", 0)
status("scenario", "game-first-break")
settle_return()
card = game().get("checkIn")
assert card and card["choice"] and card["choice"]["kind"] == "job", card
capture("02-first-check-in")

# 3. Pick the first job with a real click on the card.
call("ui-click", "#today-check-in .check-in-option")
picked = game()
assert picked["checkIn"] is None and picked["lastCheckIn"]["job"], picked["lastCheckIn"]
capture("03-after-job")

# 4. Away during focus (no activity sample, so the app sees the Mac as idle).
if status()["phase"] != "focus":
    status("start-focus")
status("advance", 20)
status("activity-sample", 90)
state = status()
assert state["activity"]["state"] == "inactive", state["activity"]
capture("04-away", away=True)
status("activity-sample", 0)
settle_return()

# 5. Break mood.
if status()["phase"] != "focus":
    status("start-focus")
status("advance", 25)
status("start-break")
status("advance", 3)
settle_return()
assert status()["phase"] in ("break", "rest")
capture("05-break")

# 6. Day done, with whatever check-in is waiting from that break.
status("advance", 7)
status("activity-sample", 0)
status("finish-break")
settle_return()
status("end-day")
assert status()["dayEndedAt"]
capture("06-day-done")

# 7. A week of steady days, then one more focus and break so a card is waiting.
status("scenario", "game-week")
settle_return()
capture("07-week")
focus_then_break()
capture("08-week-check-in")
# Keep going (picking the first option) until a build choice shows, to check the larger card.
for _ in range(5):
    card = game().get("checkIn")
    if card and (card.get("choice") or {}).get("kind") == "build":
        capture("09-build-choice")
        break
    if card:
        call("ui-click", "#today-check-in .check-in-option" if card.get("choice") else "#check-in-collect")
    focus_then_break()

# 8. A month of steady days.
status("scenario", "game-month")
settle_return()
capture("10-month")

print("\nTour pictures:")
for path in taken:
    print(path)
status("quit")
PY
