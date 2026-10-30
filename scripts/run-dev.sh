#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
instance="${COZY_FOCUS_INSTANCE:-default}"
if [[ ! "$instance" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then echo "Invalid COZY_FOCUS_INSTANCE." >&2; exit 2; fi
if [[ "$instance" == default ]]; then state="$repo_root/.build/dev-state"
else state="$repo_root/.build/dev-instances/$instance"; fi
electron="$repo_root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
electron_app="$repo_root/node_modules/electron/dist/Electron.app"
reset=false
window_mode=background
packaged=false
# --demo: the game demo, with demo buttons on Today (see README "Game demo").
# --visible-window: a normal window in front, for scripts/run-game-demo.sh only. Agents never use it.
app_options=()
for option in "$@"; do
  case "$option" in
    --reset) reset=true ;;
    --hidden-window) window_mode=hidden ;;
    --visible-window) window_mode=visible ;;
    --demo) app_options=(--demo) ;;
    --packaged) packaged=true ;;
    *) echo "Usage: $0 [--reset] [--hidden-window] [--demo] [--packaged]" >&2; exit 2 ;;
  esac
done
# Only a visible window may come to the front.
open_options=(-g -n)
if [[ "$window_mode" == visible ]]; then open_options=(-n); fi
if [[ "$packaged" == true ]]; then
  launcher="${COZY_FOCUS_PACKAGED_APP:-$repo_root/.build/ElectronBuild/CozyFocusPet-darwin-$(uname -m)/CozyFocusPet.app}"
  executable="$launcher/Contents/MacOS/CozyFocusPet"
else
  launcher="$electron_app"
  executable="$electron"
fi
/usr/bin/python3 - "$repo_root" "$state" <<'PY'
import os
import sys

root = sys.argv[1]
state = sys.argv[2]
for path in (os.path.join(root, ".build"), os.path.dirname(state), state, os.path.join(state, "control"),
             os.path.join(state, "events.sqlite"), os.path.join(state, "status.json"),
             os.path.join(state, "preferences-testing.json"), os.path.join(state, "electron-user-data"),
             os.path.join(state, "demo-clock.json")):
    if os.path.islink(path):
        raise SystemExit(f"Development state contains a symbolic link: {path}")
PY
for pid in $(pgrep -f "$executable.*--(background|hidden|visible)-window( --demo)? --cozy-instance=$instance$" || true); do
  if kill -0 "$pid" 2>/dev/null; then
    COZY_FOCUS_INSTANCE="$instance" "$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
    for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    if kill -0 "$pid" 2>/dev/null; then echo "Development app did not stop; database left intact." >&2; exit 1; fi
  fi
done
if [[ "$reset" == true ]]; then rm -rf "$state"; fi
mkdir -p "$state/control"
chmod 700 "$state" "$state/control"
rm -f "$state/control/"*.json "$state/control/"*.response
cd "$repo_root"
if [[ "$packaged" == true ]]; then scripts/build.sh
else npm run check:source; fi
if [[ "$packaged" == false && ! -x "$electron" ]]; then
  if [[ ! -f "$repo_root/node_modules/electron/install.js" ]]; then
    echo "Electron package is missing. Run npm install." >&2
    exit 1
  fi
  echo "Installing Electron binary..."
  if ! node "$repo_root/node_modules/electron/install.js"; then
    echo "Electron binary installation failed. Check download access and retry." >&2
    exit 1
  fi
fi
if [[ ! -x "$executable" ]]; then echo "Development app executable is missing." >&2; exit 1; fi
if [[ "$packaged" == true ]]; then
  open "${open_options[@]}" -a "$launcher" --env "COZY_FOCUS_DEV=1" --env "COZY_FOCUS_DEV_REPOSITORY=$repo_root" \
    --args "--$window_mode-window" ${app_options[@]+"${app_options[@]}"} "--cozy-instance=$instance"
else
  open "${open_options[@]}" -a "$launcher" --env "COZY_FOCUS_DEV=1" \
    --args "$repo_root" "--$window_mode-window" ${app_options[@]+"${app_options[@]}"} "--cozy-instance=$instance"
fi
kind=''
if [[ ${#app_options[@]} -gt 0 ]]; then kind=' (game demo)'; fi
printf 'Launched Testing app%s. Database: %s\n' "$kind" "$state/events.sqlite"
