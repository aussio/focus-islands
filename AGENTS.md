# Working on Focus Islands

Local macOS companion for real breaks. Read [STATE_PLAN.md](STATE_PLAN.md) for state ownership; game changes also require [game/AGENTS.md](game/AGENTS.md) and [game/BUILD_PLAN.md](game/BUILD_PLAN.md).

## Run safely

- Never use `run-personal.sh` or `run-game-demo.sh` for agent checks. Never modify or reset Personal data (`~/Library/Application Support/CozyFocusPet/events.sqlite`). Keep the legacy folder name.
- Launch only with `COZY_FOCUS_INSTANCE=<name> scripts/run-dev.sh --hidden-window`; add `--reset` for disposable fresh Testing data, `--demo` for game scenarios, or `--packaged` for packaging checks. State stays in `.build/dev-instances/<name>/`. Use the same instance for every control/smoke command.
- Before interactions, `scripts/dev-control.sh status` must report `profile=testing`, `appActive=false`. Never steal focus. If `activations` is nonempty, quit that instance and report it.
- Use `dev-control.sh` for named actions and app-scoped `ui-click`, `ui-fill`, `ui-read`, `ui-drag`. It controls an already running app; never launch Electron directly. Avoid `show-window`.
- Capture with `dev-control.sh screenshot`, inspect the PNG, verify inactivity, and stop with `dev-control.sh quit`. Never use whole-screen capture. Dev day-path dragging advances simulated time; demo controls exercise real action paths.

## Verify only what changed

- Source: `npm run check:source`. Core: `scripts/test.sh`. Packaging: `scripts/build.sh`.
- Small UI changes: exercise the affected flow and inspect its screenshot.
- Guidance/timers: `scripts/today-smoke.sh`. Broad flows/relaunch: `scripts/ui-smoke.sh`. Demo: `scripts/demo-smoke.sh`.
- Chrome: `scripts/chrome-smoke.sh` or `scripts/chrome-live-smoke.sh`; isolated profiles only. Extension pages in Chrome MCP require `--categoryExtensions`.
- Use normal sandbox escalation if macOS blocks Electron/Chromium process access.

## Boundaries

Main (`electron/main.js`) owns timers, SQLite, and the menu bar; core rules live in `electron/core/`. Renderer uses named preload actions and Zustand snapshots/drafts. Preserve append-only replay and separate profile databases. The extension (`Extension/`, `NativeHost/host.py`) reads only a short-lived phase lease.

Keep Today's island canvas alive across renders. Update countdown/presence in place; avoid repeated full-page or day-path redraws. Art stays in code; follow the game instructions. Generated candidates belong in ignored `.build/`; API keys belong in Keychain, never the repo.
