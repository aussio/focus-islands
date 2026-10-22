#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
xcodebuild -project CozyFocusPet.xcodeproj -scheme CozyFocusPet -configuration Debug -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
printf '\nBuilt %s\n' "$repo_root/.build/DerivedData/Build/Products/Debug/CozyFocusPet.app"
