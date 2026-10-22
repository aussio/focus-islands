#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo_root/.build/DerivedData/Build/Products/Debug/CozyFocusPet.app"
relative_app=".build/DerivedData/Build/Products/Debug/CozyFocusPet.app"
state="$repo_root/.build/dev-state"

# Stop only development instances launched from this checkout. An older app may
# still hold SQLite WAL files open; resetting while it runs would lose data.
while IFS= read -r line; do
  pid="${line%% *}"
  command="${line#* }"
  if [[ "$command" == "$app/Contents/MacOS/CozyFocusPet --show-window" ||
        "$command" == "$app/Contents/MacOS/CozyFocusPet --background-window" ||
        "$command" == "$relative_app/Contents/MacOS/CozyFocusPet --show-window" ||
        "$command" == "$relative_app/Contents/MacOS/CozyFocusPet --background-window" ]]; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..50}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      printf 'Development app %s did not stop; database was left intact.\n' "$pid" >&2
      exit 1
    fi
  fi
done < <(ps -Ao pid=,command= | sed -E 's/^ *([0-9]+) +/\1 /')

case "${1:-}" in
  '') ;;
  --reset) ;;
  *) printf 'Usage: %s [--reset]\n' "$0" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [--reset]\n' "$0" >&2
  exit 2
fi
if [[ "${1:-}" == "--reset" ]]; then
  rm -rf "$state"
fi
mkdir -p "$state/control"
chmod 700 "$state" "$state/control"
# Do not replay a stale development command from an earlier app exit.
rm -f "$state/control/"*.json "$state/control/"*.response
"$repo_root/scripts/build.sh" > "$repo_root/.build/build-run.log" 2>&1 || {
  cat "$repo_root/.build/build-run.log" >&2
  exit 1
}

open -g -n -a "$app" \
  --env "COZY_FOCUS_DEV=1" \
  --env "COZY_FOCUS_DB_PATH=$state/events.sqlite" \
  --env "COZY_FOCUS_STATUS_FILE=$state/focus-status.json" \
  --env "COZY_FOCUS_CONTROL_DIR=$state/control" \
  --args --background-window
printf 'Launched Cozy Focus Pet.\nDatabase: %s\nControl: %s\n' "$state/events.sqlite" "$state/control"
