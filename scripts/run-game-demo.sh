#!/bin/bash
# The game demo, for you to run (agents use scripts/run-dev.sh --demo --hidden-window with their own instance).
# Opens the development app in its own "demo" instance with a normal window and demo buttons on Today.
# Its history lives only in .build/dev-instances/demo/. It never opens Personal, so your installed
# Focus Islands app can keep running. Quit from the 🧪 island in the menu bar.
#
#   scripts/run-game-demo.sh            pick up the demo where it stopped
#   scripts/run-game-demo.sh --reset    start the demo fresh: day 1 morning, nothing earned
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in ''|--reset) ;; *) echo "Usage: $0 [--reset]" >&2; exit 2 ;; esac
if [[ $# -gt 1 ]]; then echo "Usage: $0 [--reset]" >&2; exit 2; fi
export FOCUS_ISLANDS_INSTANCE=demo
"$repo_root/scripts/run-dev.sh" --demo --visible-window ${1:+"$1"}
printf 'Opened the game demo. Close its window to hide it; the 🧪 island in the menu bar opens it again or quits.\n'
