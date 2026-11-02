#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${1:-}" != "" && "${1:-}" != "--live" ]]; then
  printf 'Usage: %s [--live]\n' "$0" >&2
  exit 2
fi
live_control=""
chrome_bin="${CHROME_BIN:-/Applications/Chromium.app/Contents/MacOS/Chromium}"
if [[ ! -x "$chrome_bin" ]]; then
  printf 'Chromium or Chrome for Testing not found at %s. Set CHROME_BIN to its executable.\n' "$chrome_bin" >&2
  exit 2
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/focus-islands-chrome-smoke.XXXXXX")"
case "$chrome_bin" in
  *Chromium.app/*|*"Google Chrome for Testing.app"/*) ;;
  *) printf 'Use Chromium or Chrome for Testing: branded Google Chrome ignores --load-extension.\n' >&2; exit 2 ;;
esac
manifest_dir="$tmp_dir/profile/NativeMessagingHosts"
manifest="$manifest_dir/com.cozyfocuspet.status.json"
chrome_pid=""
cleanup() {
  if [[ -n "$chrome_pid" ]]; then kill "$chrome_pid" 2>/dev/null || true; wait "$chrome_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$manifest_dir"
HOST_PATH="$repo_root/NativeHost/host.py" MANIFEST_PATH="$manifest" /usr/bin/python3 - <<'PY'
import json
import os
from pathlib import Path
Path(os.environ["MANIFEST_PATH"]).write_text(json.dumps({
    "name": "com.cozyfocuspet.status",
    "description": "Focus Islands smoke test host",
    "path": os.environ["HOST_PATH"],
    "type": "stdio",
    "allowed_origins": ["chrome-extension://gpomofinaopfjfpieooejmlpjaiadfnp/"]
}), encoding="utf-8")
PY

if [[ "${1:-}" == "--live" ]]; then
  live_control="$repo_root/scripts/dev-control.sh"
  instance="${FOCUS_ISLANDS_INSTANCE:-default}"
  if [[ ! "$instance" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]]; then echo "Invalid FOCUS_ISLANDS_INSTANCE." >&2; exit 2; fi
  if [[ "$instance" == default ]]; then state="$repo_root/.build/dev-state"
  else state="$repo_root/.build/dev-instances/$instance"; fi
  export FOCUS_ISLANDS_STATUS_FILE="$state/focus-status.json"
else
  export FOCUS_ISLANDS_STATUS_FILE="$tmp_dir/focus-status.json"
fi
"$chrome_bin" \
  --headless=new \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-extensions-except="$repo_root/Extension" \
  --load-extension="$repo_root/Extension" \
  --user-data-dir="$tmp_dir/profile" \
  --remote-debugging-port=0 \
  about:blank >"$tmp_dir/chrome.log" 2>&1 &
chrome_pid=$!

port_file="$tmp_dir/profile/DevToolsActivePort"
for _ in {1..100}; do
  [[ -f "$port_file" ]] && break
  if ! kill -0 "$chrome_pid" 2>/dev/null; then cat "$tmp_dir/chrome.log" >&2; exit 1; fi
  sleep 0.1
done
if [[ ! -f "$port_file" ]]; then cat "$tmp_dir/chrome.log" >&2; exit 1; fi
port="$(head -n1 "$port_file")"
node "$repo_root/NativeHost/chrome_smoke.mjs" "$port" "$FOCUS_ISLANDS_STATUS_FILE" "$manifest" "$live_control"
