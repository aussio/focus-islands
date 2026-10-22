# Cozy Focus Pet

A local macOS companion for planning a flexible day, focusing for a while, and actually taking breaks. The plan is a guide. The app keeps what happened, rewards healthy rhythms, and offers an optional Chrome nudge during focus.

## Run your app

From this project folder, run:

```bash
scripts/run-personal.sh
scripts/run-personal.sh --watch   # rebuild and relaunch after code changes
```

This builds and opens Cozy Focus Pet in the **Personal** profile. Every normal launch starts in Personal. The sidebar shows the active profile and offers **Use Testing** while idle; switch before entering sample data. Personal history lives at `~/Library/Application Support/CozyFocusPet/events.sqlite`. The app is a local build at `.build/DerivedData/Build/Products/Debug/CozyFocusPet.app`; it is not installed in Applications.
Quit any existing Cozy Focus Pet instance before running the script; it refuses to stack another copy in the menu bar.
`--watch` (also `--hot-reload`) keeps the terminal open, rebuilds after source changes settle, and relaunches Personal only after a successful build. A failed build leaves the current app running. Press Ctrl-C to stop watching without quitting the app. Each relaunch returns to Personal; the database is preserved.

The paw appears in the macOS menu bar, with **no Dock icon**. Left-click it to show or hide the window. Red and yellow window controls hide the window while the app keeps running. Right-click the paw and choose **Quit Cozy Focus Pet** to stop it completely. Settings has a discreet Personal/Testing switcher for manual use; the two profiles have separate history, rewards, and preferences. A later normal launch starts in Personal again.

Requirements: macOS 15 and Xcode. The browser smoke test also needs Node and Chromium or Chrome for Testing.

## Agent development and screenshots

```bash
scripts/run-dev.sh                 # build and start behind your other windows
scripts/dev-control.sh status      # confirm profile=testing and appActive=false
scripts/dev-control.sh screenshot  # capture this app's window only
scripts/dev-control.sh quit        # stop the development app
```

The development launch is locked to **Testing** and uses `.build/dev-state/events.sqlite`, separate from Personal and from the normal app's Testing database. It does not bring the window forward. `scripts/run-dev.sh --reset` clears only the disposable development state; ordinary launches preserve it. The app-scoped control inbox accepts named actions such as `scenario morning`, `navigate plan`, `start-focus`, `advance 25`, and `start-break`. It cannot control other apps or send arbitrary input. Screenshots use ScreenCaptureKit to capture only the app's own window, without whole-computer control.

Run `scripts/ui-smoke.sh` for an isolated focus, break, reward, reflection, timeline edit, interrupted-session recovery, activity, screenshot, and relaunch check. Run `scripts/today-smoke.sh` to check that Today follows plan edits, time changes, and the exact timer length chosen at Start. Both scripts reset development state and quit their app. Run `scripts/test.sh` for core tests or `scripts/build.sh` for a build without launching anything. The developer workflow is detailed in [AGENTS.md](AGENTS.md); current feature status is in [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md).

## Optional Chrome nudge

The extension is in `Extension/`. `scripts/install-chrome-host.sh chrome` installs its local phase bridge for personal Chrome; then load the unpacked extension through `chrome://extensions`. Its options page controls the chosen sites. The extension reads a short-lived focus phase lease and releases redirects on breaks or if the app or host stops. It does not collect browsing history.

`scripts/chrome-smoke.sh` tests redirects, bypass, break release, and host failure using a separate Chromium profile and temporary host registration. It does not use your normal browser profile. Set `CHROME_BIN` if Chromium is elsewhere.

`scripts/chrome-live-smoke.sh` starts an isolated Testing app and browser, checks the extension against the app's live focus lease, then quits both. The app's break phase released the redirect within about 30 seconds in the latest check.

## Data

Plans, timer transitions, reflections, and purchases are append-only SQLite events. Each profile owns its database. Export and backup are available in Settings. The reward policy is in `Sources/CozyFocusCore/Resources/balance-v1.json`.

Settings has a read-only reward preview that replays saved sessions under different focus and break values. The room colors and decoration catalog are in `Sources/CozyFocusApp/VisualCatalog.swift`.
