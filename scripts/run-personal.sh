#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo_root/.build/DerivedData/Build/Products/Debug/CozyFocusPet.app"

watch=false
case "${1:-}" in
  '') ;;
  --watch|--hot-reload) watch=true ;;
  --help|-h)
    printf 'Usage: %s [--watch|--hot-reload]\n' "$0"
    exit 0 ;;
  *)
    printf 'Usage: %s [--watch|--hot-reload]\n' "$0" >&2
    exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [--watch|--hot-reload]\n' "$0" >&2
  exit 2
fi

# Do not hide an additional copy behind another menu bar item.
running="$(ps -Ao pid=,comm= | awk '$2 ~ /(^|\/)CozyFocusPet$/ { print $1 }')"
if [[ -n "$running" ]]; then
  printf 'Cozy Focus Pet is already running (PID(s): %s). Quit it from its paw menu before starting Personal.\n' "$(tr '\n' ' ' <<< "$running")" >&2
  exit 1
fi

mkdir -p "$repo_root/.build"
"$repo_root/scripts/build.sh" > "$repo_root/.build/build-personal.log" 2>&1 || {
  tail -80 "$repo_root/.build/build-personal.log" >&2
  exit 1
}
open -n -a "$app" --args --show-window
printf 'Opened Personal Cozy Focus Pet. Use its menu bar paw to reopen or quit it.\n'
if $watch; then
  exec /usr/bin/python3 "$repo_root/scripts/watch-personal.py" "$repo_root" "$app"
fi
