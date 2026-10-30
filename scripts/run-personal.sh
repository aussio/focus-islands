#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
build_app="$repo_root/.build/ElectronBuild/CozyFocusPet-darwin-$(uname -m)/CozyFocusPet.app"
app="/Applications/Focus Islands.app"
old_app="$HOME/Applications/Cozy Focus Pet.app"
# The app used to be called Cozy Focus Pet. install-personal-bundle.sh removes this copy after installing the new one.
old_name_app="/Applications/Cozy Focus Pet.app"
case "${1:-}" in ''|--watch|--hot-reload) ;; *) echo "Usage: $0 [--watch|--hot-reload]" >&2; exit 2 ;; esac
if [[ $# -gt 1 ]]; then echo "Usage: $0 [--watch|--hot-reload]" >&2; exit 2; fi
for running_app in "$app" "$old_name_app" "$old_app" "$build_app"; do
  if pgrep -f "$running_app/Contents/MacOS/CozyFocusPet" >/dev/null; then
    echo "Focus Islands is already running from $running_app. Right-click its menu bar icon and choose Quit." >&2
    exit 1
  fi
done
"$repo_root/scripts/build.sh"
if [[ ! -d "$build_app" ]]; then echo "App bundle is missing. Run npm install and scripts/build.sh." >&2; exit 1; fi
"$repo_root/scripts/install-personal-bundle.sh" "$build_app"
if [[ "${1:-}" == --watch || "${1:-}" == --hot-reload ]]; then
  exec /usr/bin/python3 "$repo_root/scripts/watch-personal.py" "$repo_root" "$app"
fi
open -n -a "$app" --args --show-window
printf 'Opened Personal Focus Islands from /Applications. Use its menu bar island to reopen or quit it.\n'
