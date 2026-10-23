#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo_root/.build/ElectronBuild/CozyFocusPet-darwin-$(uname -m)/CozyFocusPet.app"
case "${1:-}" in ''|--watch|--hot-reload) ;; *) echo "Usage: $0 [--watch|--hot-reload]" >&2; exit 2 ;; esac
if [[ $# -gt 1 ]]; then echo "Usage: $0 [--watch|--hot-reload]" >&2; exit 2; fi
if pgrep -f "$app/Contents/MacOS/CozyFocusPet" >/dev/null; then
  echo "Cozy Focus Pet is already running. Quit it from its paw menu." >&2
  exit 1
fi
"$repo_root/scripts/build.sh"
if [[ ! -d "$app" ]]; then echo "App bundle is missing. Run npm install and scripts/build.sh." >&2; exit 1; fi
if [[ "${1:-}" == --watch || "${1:-}" == --hot-reload ]]; then
  exec /usr/bin/python3 "$repo_root/scripts/watch-personal.py" "$repo_root" "$app"
fi
open -n -a "$app" --args --show-window
printf 'Opened Personal Cozy Focus Pet. Use its menu bar paw to reopen or quit it.\n'
