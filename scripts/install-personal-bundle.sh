#!/bin/bash
set -euo pipefail
if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 BUILT_APP_BUNDLE" >&2
  exit 2
fi
source_app="$1"
application_dir="/Applications"
target_app="$application_dir/Cozy Focus Pet.app"
stage_dir="$(mktemp -d "$application_dir/.cozy-focus-install.XXXXXX")"
staged_app="$stage_dir/Cozy Focus Pet.app"
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
