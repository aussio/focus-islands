# Working on Focus Islands

Local macOS companion for real breaks. Read [STATE_PLAN.md](STATE_PLAN.md) when changing state ownership. Game changes also require [game/AGENTS.md](game/AGENTS.md) and the sections of [game/BUILD_PLAN.md](game/BUILD_PLAN.md) that cover the change; it is too long to read whole, so list its headings with `grep -n '^#'`.

## Run safely

- Never use `run-personal.sh` or `run-game-demo.sh` for agent checks. Never modify or reset Personal data (`~/Library/Application Support/CozyFocusPet/events.sqlite`). Keep the legacy folder name.
- Launch only with `FOCUS_ISLANDS_INSTANCE=<name> scripts/run-dev.sh --hidden-window`; add `--reset` for disposable fresh Testing data, `--demo` for game scenarios, or `--packaged` for packaging checks. State stays in `.build/dev-instances/<name>/`. Use the same instance for every control/smoke command.
- Before interactions, `scripts/dev-control.sh status` must report `profile=testing`, `appActive=false`. Never steal focus. If `activations` is nonempty, quit that instance and report it.
- Use `dev-control.sh` for named actions and app-scoped `ui-click`, `ui-fill`, `ui-read`, `ui-drag`. It controls an already running app; never launch Electron directly. Avoid `show-window`.
- Capture with `dev-control.sh screenshot`, inspect the PNG, verify inactivity, and stop with `dev-control.sh quit`. Never use whole-screen capture. Dev day-path dragging advances simulated time; demo controls exercise real action paths.

## Verify only what changed

Size the checking to the change. You are done when the checks below for what you touched pass; the user reviews too, so stop there and list your doubts in the report.

- Source: `npm run check:source`. Core: `scripts/test.sh` (`node --test <file>` while iterating). Packaging: `scripts/build.sh`.
- Guidance/timers: `scripts/today-smoke.sh`. Broad flows/relaunch: `scripts/ui-smoke.sh`. Demo: `scripts/demo-smoke.sh`. Game scene: `scripts/game-tour.sh`.
- Chrome: `scripts/chrome-smoke.sh` or `scripts/chrome-live-smoke.sh`; isolated profiles only. Extension pages in Chrome MCP require `--categoryExtensions`.
- Run smoke scripts and the tour once, after the change is finished. Save the output and read its end: `scripts/demo-smoke.sh > .build/demo-smoke.log 2>&1; tail -5 .build/demo-smoke.log`. Smoke scripts end with a PASS line and the tour with its picture paths, or with the failure; to see more, reread the log.
- Small UI changes: exercise the affected flow and inspect 1–3 pictures of what changed. Add a picture only for a state that looks different, such as another mood when colors change.
- Every picture stays in context and slows each later step. Crop or shrink it first with the built-in `sips`: `sips --cropToHeightWidth H W --cropOffset Y X in.png --out crop.png`, or `sips -Z 1200 in.png --out small.png`. Window screenshots are 2400×1744; the Today island is about H 720, W 1200 at Y 170, X 1100.
- Hold animations and timed views still in a test or gallery view; waiting for them in the running app costs minutes.
- When handing work to another agent, start a fresh one per feature and ask for the checks this section sets, plus any the user asked for.
- Use normal sandbox escalation if macOS blocks Electron/Chromium process access.

## Boundaries

Main (`electron/main.js`) owns timers, SQLite, and the menu bar; core rules live in `electron/core/`. Renderer uses named preload actions and Zustand snapshots/drafts. Preserve append-only replay and separate profile databases. The extension (`Extension/`, `NativeHost/host.py`) reads only a short-lived phase lease.

Keep Today's island canvas alive across renders. Update countdown/presence in place; avoid repeated full-page or day-path redraws. Art stays in code; follow the game instructions. Generated candidates belong in ignored `.build/`; API keys belong in Keychain, never the repo.
