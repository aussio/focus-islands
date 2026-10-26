#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
instance="${COZY_FOCUS_INSTANCE:-default}"
if [[ ! "$instance" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then echo "Invalid COZY_FOCUS_INSTANCE." >&2; exit 2; fi
if [[ "$instance" == default ]]; then state="$repo_root/.build/dev-state"
else state="$repo_root/.build/dev-instances/$instance"; fi
electron="$repo_root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
electron_app="$repo_root/node_modules/electron/dist/Electron.app"
case "${1:-}" in ''|--reset) ;; *) echo "Usage: $0 [--reset]" >&2; exit 2 ;; esac
if [[ $# -gt 1 ]]; then echo "Usage: $0 [--reset]" >&2; exit 2; fi
/usr/bin/python3 - "$repo_root" "$state" <<'PY'
import os
import sys

root = sys.argv[1]
state = sys.argv[2]
for path in (os.path.join(root, ".build"), os.path.dirname(state), state, os.path.join(state, "control"),
             os.path.join(state, "events.sqlite"), os.path.join(state, "status.json"),
             os.path.join(state, "preferences-testing.json"), os.path.join(state, "electron-user-data")):
    if os.path.islink(path):
        raise SystemExit(f"Development state contains a symbolic link: {path}")
PY
for pid in $(pgrep -f "$electron $repo_root --background-window --cozy-instance=$instance$" || true); do
  if kill -0 "$pid" 2>/dev/null; then
    COZY_FOCUS_INSTANCE="$instance" "$repo_root/scripts/dev-control.sh" quit >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
    for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    if kill -0 "$pid" 2>/dev/null; then echo "Development app did not stop; database left intact." >&2; exit 1; fi
  fi
done
if [[ "${1:-}" == --reset ]]; then rm -rf "$state"; fi
mkdir -p "$state/control"
chmod 700 "$state" "$state/control"
rm -f "$state/control/"*.json "$state/control/"*.response
cd "$repo_root"
npm run check:source
if [[ ! -x "$electron" ]]; then
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
if [[ ! -x "$electron" ]]; then echo "Electron binary is missing after installation." >&2; exit 1; fi
open -g -n -a "$electron_app" \
  --env "COZY_FOCUS_DEV=1" \
  --args "$repo_root" --background-window "--cozy-instance=$instance"
printf 'Launched Testing app. Database: %s\n' "$state/events.sqlite"
