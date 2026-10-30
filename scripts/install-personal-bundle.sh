#!/bin/bash
set -euo pipefail
if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 BUILT_APP_BUNDLE" >&2
  exit 2
fi
source_app="$1"
application_dir="/Applications"
target_app="$application_dir/Focus Islands.app"
# The app used to be called Cozy Focus Pet. Both names open the same Personal data, so the old copy
# is removed once the new one is in place. The data folder is not inside the app and is not touched.
old_name_app="$application_dir/Cozy Focus Pet.app"
stage_dir="$(mktemp -d "$application_dir/.cozy-focus-install.XXXXXX")"
staged_app="$stage_dir/Focus Islands.app"
previous_app="$stage_dir/previous.app"
cleanup() {
  if [[ -d "$previous_app" && ! -e "$target_app" ]]; then mv "$previous_app" "$target_app"; fi
  rm -rf "$stage_dir"
}
trap cleanup EXIT
ditto "$source_app" "$staged_app"
codesign --verify --deep "$staged_app"
if [[ -e "$target_app" ]]; then mv "$target_app" "$previous_app"; fi
mv "$staged_app" "$target_app"
if [[ -e "$old_name_app" ]]; then
  if pgrep -f "$old_name_app/Contents/MacOS/CozyFocusPet" >/dev/null; then
    echo "Kept $old_name_app because it is running. Right-click its menu bar icon and choose Quit, then run this again to remove it." >&2
  else
    mv "$old_name_app" "$stage_dir/old-name.app"
    echo "Removed $old_name_app. $target_app replaces it."
  fi
fi
