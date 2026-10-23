# Cozy Focus Pet

A local macOS menu bar companion for planning a flexible day, focusing, and taking real breaks. The plan is a guide. Append-only events keep what happened, and a red panda room rewards a balanced rhythm.

## Thesis / Purpose

Cozy Focus Pet should help one person make a realistic plan, protect time for real breaks, and learn from the difference between the day they intended and the day they lived. Focus often needs less prompting than breaks do. Reminders should be gentle and repeatable, with room to snooze or skip rather than pressure to follow a rigid schedule.

A day may be planned the previous evening or that morning: enter expected meetings and intended start and finish times, then see suggested focus and break blocks. The actual day begins with the first focus session, on time or not. Meetings can be added or cancelled; focus and breaks can start early, run late, or be skipped. The day can end simply because activity stops or the user turns to tomorrow's plan. The original plan, later deliberate revisions, and actual activity should remain distinct so a future view can show how expectations and work patterns change over time.

The companion is local-first and useful without a browser extension. It records aggregate activity and confirmed breaks, never keystrokes, mouse movements, or browsing history. An optional Chrome nudge can redirect chosen distracting sites during focus, with a deliberate bypass. A pet, room, or garden can make healthy rhythms pleasant to revisit; the reward rules and art can evolve without rewriting the recorded facts. A task list is outside the current scope.

## Run Personal

Install Node.js 22.13 or newer, then run these commands from the project folder:

```bash
npm install
scripts/run-personal.sh
```

The launcher opens the Electron app in **Personal**. The paw in the menu bar opens or hides the window. The app has no Dock icon. Right-click the paw and choose **Quit Cozy Focus Pet** to stop it. `scripts/run-personal.sh --watch` checks source changes and restarts the app after a successful check.
The local app bundle is `.build/ElectronBuild/CozyFocusPet-darwin-<architecture>/CozyFocusPet.app`. The build signs it locally for macOS notification actions. It is not installed in Applications.

Personal history stays at `~/Library/Application Support/CozyFocusPet/events.sqlite`. Settings can switch to a separate normal Testing profile while idle. A later normal launch starts in Personal again. The development launch below cannot enter Personal.

## Develop and verify

```bash
scripts/test.sh                  # core behavior
scripts/build.sh                 # build the local macOS app bundle
scripts/run-dev.sh               # background Testing app
scripts/dev-control.sh status    # require profile=testing and appActive=false
scripts/dev-control.sh screenshot
scripts/dev-control.sh quit
```

The development app writes to `.build/dev-state/events.sqlite`. `scripts/run-dev.sh --reset` deletes only this disposable state. `scripts/ui-smoke.sh` resets Testing and checks the focus, break, reward, purchase, reflection, screenshot, and relaunch loop. `scripts/today-smoke.sh` checks day guidance and timer targets. Screenshots come from the app's own Electron window.

Use [development-tools/forecast](development-tools/forecast/README.md) to render a manually supplied day plan and history as a local HTML forecast preview. The tool contains no bundled scenario data and does not open a profile database.

For parallel agent runs in one checkout, set a distinct `COZY_FOCUS_INSTANCE` for each agent and use it for every launch, control, and smoke command. For example, `COZY_FOCUS_INSTANCE=agent-a scripts/run-dev.sh --reset` and `COZY_FOCUS_INSTANCE=agent-a scripts/dev-control.sh status` use `.build/dev-instances/agent-a/`. A reset or quit for one instance leaves the others running.

The Testing control inbox also supports `ui-click`, `ui-fill`, `ui-read`, and `ui-drag` on selectors inside the app window. For example, `scripts/dev-control.sh ui-click '#nav-plan'` navigates through the actual renderer. `scripts/dev-control.sh events` reads the committed event ledger. `scripts/ui-smoke.sh` uses app-window controls for plan editing, meeting drag, and a room purchase without activating the window.

The Electron main process owns SQLite, timers, and the menu bar. The renderer is in `electron/renderer/` and reaches the main process through named preload actions. The core is in `electron/core/`. The reward values are versioned in `electron/core/index.js`.

## Optional Chrome nudge

The extension is in `Extension/`. Run `scripts/install-chrome-host.sh chrome` to install its local phase bridge for personal Chrome, then load the unpacked extension through `chrome://extensions`. Its options page controls chosen sites. The bridge reads only a short-lived focus phase lease. It does not collect browsing history.

`scripts/chrome-smoke.sh` uses a separate Chromium profile and temporary host registration. `scripts/chrome-live-smoke.sh` pairs that browser with the isolated Testing app. Neither script uses your normal browser profile.

## Data

Each profile has its own SQLite database. The Electron core replays the existing event schema and date payloads. Plans, timer transitions, reflections, rewards, and purchases remain append-only. Profile settings live in the same database. The renderer uses Zustand for the current snapshot and unsaved drafts; reloading it reads committed state from SQLite. Settings can export events and preferences to JSON and back up the active database.

See [STATE_PLAN.md](STATE_PLAN.md) for state ownership and day-planning rules.
