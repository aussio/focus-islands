# Working on Focus Islands

Build a calm, local-first macOS companion that encourages real breaks. Read [README.md](README.md) for the product purpose and user commands, and [STATE_PLAN.md](STATE_PLAN.md) for state ownership. Keep the user's Personal facts untouched during development.

## Launch and data boundary

- `scripts/run-personal.sh` is for the user. It starts in Personal, shows a small island in the menu bar, and has no Dock icon. Do not use it for agent checks or scenarios.
- `scripts/run-game-demo.sh` is also for the user only, like `run-personal.sh`. Agents test the game demo with `scripts/run-dev.sh --demo --hidden-window` and their own `COZY_FOCUS_INSTANCE`, or with `scripts/demo-smoke.sh`.
- Always use `scripts/run-dev.sh` as the entry point when an agent runs the app locally. It checks and launches Electron behind the user's windows, locked to Testing, and writes to `.build/dev-state/events.sqlite` by default. Do not launch Electron directly or treat `scripts/dev-control.sh` as a launcher; that script only controls an already running development app. Set `COZY_FOCUS_INSTANCE` to a short name to use an independent `.build/dev-instances/<name>/` database, lease, control inbox, and Electron user data. Pass the same variable to `scripts/dev-control.sh` and smoke scripts. Personal stays at `~/Library/Application Support/CozyFocusPet/events.sqlite`. Normal app Testing data has its own `profiles/testing/events.sqlite` under Application Support.
- Use `scripts/run-dev.sh --reset` only when a disposable fresh Testing database is needed. The smoke scripts default to their own isolated Testing instances and reset only those. Do not reset or inspect Personal to clean up tests.
- Check `scripts/dev-control.sh status` before test actions: require `profile=testing` and `appActive=false`. Use `scripts/dev-control.sh quit` to stop the development app. The user's normal app is quit from the menu bar island's right-click menu.

## Background interaction and screenshots

The user works on this Mac while agents develop. Routine app work must not activate the window or steal keyboard focus. `run-dev.sh` uses `--background-window`, which shows the window without focus and sends it behind every other window; prefer `--hidden-window` for unattended checks, since the user can't click a window they can't see. A Testing app's menu bar item opens a menu on click and never shows the window by itself. `dev-control.sh status` lists every time the app became active since launch (`activations`), and `dev-control.sh` prints a `WARNING:` once it has; quit that instance and say so. When several agents may run the same smoke script, give each its own `COZY_FOCUS_INSTANCE`. The development-only control inbox accepts named app actions such as `navigate`, `scenario`, `start-focus`, `advance`, `start-break`, and `quit`. It also supports app-scoped `ui-click`, `ui-fill`, `ui-read`, and `ui-drag` actions inside the Testing window; it cannot drive other apps or send arbitrary system input. Avoid `show-window` unless a visible interaction is the task.

Run `scripts/dev-control.sh screenshot` and inspect the returned PNG. Electron captures only its own window with `webContents.capturePage`, without broad Accessibility or whole-screen capture permission. The screenshot covers the visible viewport. Navigate within the app for longer pages. Verify `appActive=false` after unattended screenshot checks.

Choose checks for the changed behavior. Run `npm run check:source` for renderer or Electron source edits, `scripts/test.sh` for core behavior, and `scripts/build.sh` when packaging changes or a distributable bundle is needed. For a small UI change, drive the affected flow manually through the background Testing app with `dev-control.sh`, inspect an app-scoped screenshot, and verify `appActive=false`. Do not run the full UI smoke loop for an unrelated local change. Use `scripts/today-smoke.sh` for guidance or timer integration, and `scripts/ui-smoke.sh` for broad state flows, persistence and relaunch, or release checks. Electron and Chromium can need macOS process access beyond the filesystem sandbox; use the normal approval mechanism for those specific commands if the sandbox blocks them.

## Chrome extension

The app uses `Extension/` and `NativeHost/host.py` at runtime. `scripts/chrome-smoke.sh` checks the redirect flow in an isolated Chromium profile and cleans up its temporary host registration. Never use the user's normal Chrome profile for tests.

If the user's `chrome-agents` Chrome DevTools MCP connection is available, use its page list, snapshots, console messages, and page screenshots for hands-on browser inspection. Extension pages require that MCP server to include `--categoryExtensions`; a refused `chrome-extension:` navigation without that flag does not indicate an extension failure. The browser smoke script is the repeatable behavioral check. The app-scoped screenshot command is the reliable path for the Electron window; Chrome MCP does not control the macOS app.

## Code boundaries

Core timer, planning, event storage, and rewards are in `electron/core/`; the menu bar shell is in `electron/main.js`, and the window UI is in `electron/renderer/`. Preserve append-only event replay, unique reward grants, and profile-separated databases. The extension reads only a short-lived phase lease, never browsing content or history.

Game work (islands, helpers, art, spending, long-term progress): read [game/AGENTS.md](game/AGENTS.md) first.
