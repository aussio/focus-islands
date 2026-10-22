# Working on Cozy Focus Pet

Build a calm, local-first macOS companion that encourages real breaks. Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the product intent and [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) for open work. [README.md](README.md) has the user commands. Keep the user's Personal facts untouched during development.

## Launch and data boundary

- `scripts/run-personal.sh` is for the user. It starts in Personal, shows a menu bar paw, and has no Dock icon. Do not use it for agent checks or scenarios.
- `scripts/run-dev.sh` builds and opens one development app behind the user's windows. It is locked to Testing and writes to `.build/dev-state/events.sqlite`; Personal stays at `~/Library/Application Support/CozyFocusPet/events.sqlite`. Normal app Testing data has its own `profiles/testing/events.sqlite` under Application Support.
- Use `scripts/run-dev.sh --reset` only when a disposable fresh Testing database is needed. `scripts/ui-smoke.sh` performs that reset as part of its isolated end-to-end check. Do not reset or inspect Personal to clean up tests.
- Check `scripts/dev-control.sh status` before test actions: require `profile=testing` and `appActive=false`. Use `scripts/dev-control.sh quit` to stop the development app. The user's normal app is quit from the paw's right-click menu.

## Background interaction and screenshots

The user works on this Mac while agents develop. Routine app work must not activate the window or steal keyboard focus. `run-dev.sh` uses `open -g` and `--background-window`. The development-only control inbox accepts named app actions such as `navigate`, `scenario`, `start-focus`, `advance`, `start-break`, and `quit`; it cannot drive other apps or send arbitrary input. Avoid `show-window` and `menu-click` unless a visible interaction is the task.

Run `scripts/dev-control.sh screenshot` and inspect the returned PNG. The app captures only its own window with `SCShareableContent.currentProcess` and `SCScreenshotManager.captureImage`, without broad Accessibility or whole-screen capture permission. The screenshot covers the visible viewport. Navigate within the app for longer pages. Verify `appActive=false` after unattended screenshot checks.

Run `scripts/test.sh` for core tests, `scripts/build.sh` for the macOS build, and `scripts/ui-smoke.sh` for the isolated app loop. Xcode and Chromium can need macOS cache or process access beyond the filesystem sandbox; use the normal approval mechanism for those specific commands if the sandbox blocks them.

## Chrome extension

The app uses `Extension/` and `NativeHost/host.py` at runtime. `scripts/chrome-smoke.sh` checks the redirect flow in an isolated Chromium profile and cleans up its temporary host registration. Never use the user's normal Chrome profile for tests.

If the user's `chrome-agents` Chrome DevTools MCP connection is available, use its page list, snapshots, console messages, and page screenshots for hands-on browser inspection. Extension pages require that MCP server to include `--categoryExtensions`; a refused `chrome-extension:` navigation without that flag does not indicate an extension failure. The browser smoke script is the repeatable behavioral check. The app-scoped screenshot command is the reliable path for the native window; Chrome MCP does not control the macOS app.

## Code boundaries

Core timer, planning, event storage, and rewards are in `Sources/CozyFocusCore/`; the app UI and coordination are in `Sources/CozyFocusApp/`. Preserve append-only event replay, unique reward grants, and profile-separated databases. The extension reads only a short-lived phase lease, never browsing content or history.
