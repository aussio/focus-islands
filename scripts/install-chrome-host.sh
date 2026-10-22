#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
browser="${1:-chrome}"
case "$browser" in
  chrome) manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
  chrome-for-testing) manifest_dir="$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts" ;;
  chromium) manifest_dir="$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
  *) printf 'Usage: %s [chrome|chrome-for-testing|chromium]\n' "$0" >&2; exit 2 ;;
esac

host_dir="$HOME/Library/Application Support/CozyFocusPet/NativeHost"
mkdir -p "$host_dir" "$manifest_dir"
install -m 755 "$repo_root/NativeHost/host.py" "$host_dir/host.py"
HOST_PATH="$host_dir/host.py" MANIFEST_DIR="$manifest_dir" /usr/bin/python3 - <<'PY'
import json
import os
from pathlib import Path

manifest = {
    "name": "com.cozyfocuspet.status",
    "description": "Cozy Focus Pet focus phase bridge",
    "path": os.environ["HOST_PATH"],
    "type": "stdio",
    "allowed_origins": ["chrome-extension://gpomofinaopfjfpieooejmlpjaiadfnp/"],
}
target = Path(os.environ["MANIFEST_DIR"]) / "com.cozyfocuspet.status.json"
target.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Installed {target}")
PY

printf 'Load the unpacked extension from %s/Extension in chrome://extensions.\n' "$repo_root"
