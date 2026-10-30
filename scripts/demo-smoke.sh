#!/bin/bash
# Checks the game demo end to end: a hidden Testing app in its own fresh instance (demo-smoke unless
# COZY_FOCUS_INSTANCE says otherwise), driven only through the demo panel's buttons and the check-in card.
# Screenshots are copied to .build/demo-smoke/<instance>/. Any failed check stops the script with an error.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export COZY_FOCUS_INSTANCE="${COZY_FOCUS_INSTANCE:-demo-smoke}"
trap '"$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || true' EXIT
"$repo_root/scripts/run-dev.sh" --reset --demo --hidden-window
REPO_ROOT="$repo_root" /usr/bin/python3 - <<'PY'
import json
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

root = Path(os.environ["REPO_ROOT"])
control = root / "scripts/dev-control.sh"
shots = root / ".build/demo-smoke" / os.environ["COZY_FOCUS_INSTANCE"]
shots.mkdir(parents=True, exist_ok=True)
for old in shots.glob("*.png"):
    old.unlink()

def status(action="status", value=None):
    args = [str(control), action]
    if value is not None:
        args.append(json.dumps(value) if isinstance(value, dict) else str(value))
    result = json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)
    state = result["status"]
    assert state["profile"] == "testing" and not state["appActive"] and not state["dockIconActive"], (action, state["appActive"], state["dockIconActive"])
    assert not state["activations"], f"The hidden Testing app took keyboard focus during {action!r}: {state['activations']}"
    return state

def not_in_front(state):
    # Ask macOS which app is in front, so this does not rely only on the app's own report.
    front = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()
    pid = subprocess.run(["lsappinfo", "info", "-only", "pid", front], capture_output=True, text=True).stdout.split("=")[-1].strip()
    assert pid != str(state["pid"]), f"macOS reports the hidden Testing app (pid {state['pid']}) as the front app"
    return state

def read(selector):
    return json.loads(subprocess.run([str(control), "ui-read", selector], check=True, capture_output=True, text=True).stdout)["ui"]["value"]

def found(selector):
    result = subprocess.run([str(control), "ui-read", selector], capture_output=True, text=True)
    return json.loads(result.stdout)["ok"] if result.stdout else False

def click(selector):
    assert found(selector), f"Nothing to click at {selector}"
    status("ui-click", selector)

def wait_for(check, what, seconds=20):
    deadline = time.monotonic() + seconds
    while True:
        state = status()
        if check(state):
            return state
        if time.monotonic() > deadline:
            raise AssertionError(f"Timed out waiting for {what}. Demo log: {state.get('demo', {}).get('log')}")
        time.sleep(0.2)

def local(state):
    return datetime.fromisoformat(state["currentWallTimeISO"].replace("Z", "+00:00")).astimezone()

def press(step, seconds=20):
    """Clicks one demo button the way a person would, then waits until its log line shows."""
    before = json.dumps(status()["demo"]["log"])
    button = f'#demo-panel [data-demo-step="{step}"]'
    assert found(f"{button}:not([disabled])"), f"The {step} button is missing or turned off"
    click(button)
    state = wait_for(lambda s: json.dumps(s["demo"]["log"]) != before and not found("#demo-panel .is-busy"), f"the {step} step", seconds)
    assert not found("#demo-note.error"), f"The {step} step showed an error: {read('#demo-note')}"
    text = state["demo"]["log"][-1]["text"]
    print(f"PASS {step}: Day {state['demo']['day']}, {local(state):%H:%M}: {text}")
    return state, text

def pick_on_card(heading):
    """Taps the waiting card: its first choice if it asks for one, otherwise Collect."""
    state = wait_for(lambda s: s["game"]["checkIn"] and found("#today-check-in .check-in-card"), "the check-in card")
    assert read("#check-in-title") == heading, (read("#check-in-title"), heading)
    count = state["game"]["checkIns"]
    click("#today-check-in .check-in-option" if found("#today-check-in .check-in-option") else "#check-in-collect")
    state = wait_for(lambda s: s["game"]["checkIns"] == count + 1 and not s["game"]["checkIn"], "the card tap")
    text = state["demo"]["log"][-1]["text"]
    assert text.startswith(f"Card {count + 1}: "), text
    print(f"PASS picked on the card ({heading}): {text}")
    return state

def screenshot(name):
    # The first capture of a hidden window can be a frame behind, so take one to throw away, then the real one.
    subprocess.run([str(control), "screenshot"], check=True, capture_output=True, text=True)
    result = json.loads(subprocess.run([str(control), "screenshot"], check=True, capture_output=True, text=True).stdout)
    assert result["status"]["page"] == "today" and not result["status"]["appActive"], result["status"]["page"]
    target = shots / f"{name}.png"
    shutil.copyfile(result["screenshot"], target)
    Path(result["screenshot"]).unlink(missing_ok=True)
    print(f"Screenshot {name}: {target}")

# A fresh demo: day 1 at 9:00, nothing earned, the panel below the island, and no switch to Away after 5 seconds.
fresh = not_in_front(status())
assert fresh["demo"]["day"] == 1 and fresh["phase"] == "idle" and fresh["game"]["checkIns"] == 0, fresh["demo"]
assert (local(fresh).hour, local(fresh).minute) == (9, 0), fresh["currentWallTimeISO"]
assert fresh["activityDelaySeconds"] == 120, fresh["activityDelaySeconds"]
assert found(".today-stage #today-island") and found(".today-stage + #demo-panel"), "The demo panel should sit right below the island"
assert "Day 1" in read("#demo-status")
screenshot("01-fresh-day")

state, text = press("work")
assert text == "Worked 60 min → break due" and state["breakDue"], (text, state["breakDue"])
state, text = press("break")
assert text.startswith("Break 15 min → a real break; focus started again · new card: pick a job"), text
assert state["phase"] == "focus" and state["game"]["checkIn"]["choice"]["kind"] == "job"
screenshot("02-card-after-break")
pick_on_card("Back from your break")

state, text = press("work-interrupted")
assert state["phase"] == "break" and "took a break early" in text, text
state, text = press("break-interrupted")
assert state["phase"] == "focus" and "too short to count as a real break" in text, text
assert state["game"]["checkIn"], "a short break still brings a card"
# The card is left waiting on purpose: the next step adds to it, as in the real app.
state, text = press("away")
assert "counted as a break" in text and "the waiting card grew" in text, text
state, text = press("end-day")
assert state["dayEndedAt"] and state["game"]["checkIn"], text
assert found('#demo-panel [data-demo-step="work"][disabled]') and found('#demo-panel [data-demo-step="next-morning"]:not([disabled])')
assert "press Next morning" in read("#demo-note")
screenshot("03-end-of-day-card")
pick_on_card("End of the day")

state, text = press("next-morning")
assert state["demo"]["day"] == 2 and (local(state).hour, local(state).minute) == (9, 0) and not state["dayEndedAt"], text
assert state["game"]["checkIns"] == 2 and state["game"]["activeDays"] == 1, (state["game"]["checkIns"], state["game"]["activeDays"])
screenshot("04-next-morning")

# Quitting and opening the demo again picks up at the same moment.
morning = state["currentWallTimeISO"]
status("quit")
subprocess.run([str(root / "scripts/run-dev.sh"), "--demo", "--hidden-window"], check=True, capture_output=True, text=True)
reopened = not_in_front(status())
assert reopened["demo"]["day"] == 2 and reopened["currentWallTimeISO"][:16] == morning[:16], (reopened["currentWallTimeISO"], morning)
assert "reopened" in reopened["demo"]["log"][-1]["text"]
print(f"PASS relaunch resumed on day 2 at {local(reopened):%H:%M}")

state, text = press("month", 90)
assert state["game"]["activeDays"] == 31 and len(state["game"]["islands"]) > 1, (state["game"]["activeDays"], len(state["game"]["islands"]))
assert state["demo"]["day"] == 32 and (local(state).hour, local(state).minute) == (9, 0), (state["demo"]["day"], state["currentWallTimeISO"])
assert text.startswith("Played 30 steady days from today"), text
screenshot("05-after-a-month")

# Start over needs a second click within 5 seconds. The first only asks, so keep the checks between them few.
# (ui-read gives a button's empty value, not its text, so the warning look shows that it is asking.)
start_over = '#demo-panel [data-demo-step="start-over"]'
epoch, cards = state["publicationEpoch"], state["game"]["checkIns"]
status("ui-click", start_over)
asked = json.loads(subprocess.run([str(control), "ui-read", f"{start_over}.is-warning"], capture_output=True, text=True).stdout)
assert asked["ok"] and asked["status"]["publicationEpoch"] == epoch and asked["status"]["game"]["checkIns"] == cards, "one click must only ask"
status("ui-click", start_over)
fresh = wait_for(lambda s: s["publicationEpoch"] > epoch and found("#demo-panel"), "Start over")
assert fresh["demo"]["day"] == 1 and fresh["game"]["checkIns"] == 0 and fresh["game"]["activeDays"] == 0 and fresh["phase"] == "idle"
assert (local(fresh).hour, local(fresh).minute) == (9, 0), fresh["currentWallTimeISO"]
events = json.loads(subprocess.run([str(control), "events"], check=True, capture_output=True, text=True).stdout)["events"]
assert [event["kind"] for event in events] == ["gameStarted"], [event["kind"] for event in events]
assert "Day 1" in read("#demo-status")
screenshot("06-start-over")
print("PASS Start over: day 1 at 9:00 with only a new island")
not_in_front(status())

# The normal development app (no --demo) has no panel and refuses demo steps.
status("quit")
subprocess.run([str(root / "scripts/run-dev.sh"), "--reset", "--hidden-window"], check=True, capture_output=True, text=True)
plain = not_in_front(status())
assert plain["demo"] is None and plain["activityDelaySeconds"] == 5
assert found(".today-stage #today-island") and not found("#demo-panel"), "the demo panel showed outside the demo"
refused = subprocess.run([str(control), "dev-demo", "work"], capture_output=True, text=True)
assert refused.returncode != 0 and "game demo" in refused.stdout, refused.stdout
assert [event["kind"] for event in json.loads(subprocess.run([str(control), "events"], check=True, capture_output=True, text=True).stdout)["events"]] == ["gameStarted"]
not_in_front(status())
print("PASS no demo panel or demo steps in the normal development app")
print(f"PASS game demo smoke. Screenshots: {shots}")
PY
