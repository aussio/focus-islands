# Focus Islands

A local macOS menu bar companion for planning a flexible day, focusing, and taking real breaks. The plan is a guide. Append-only events keep what happened, while a small activity indicator and the sky above a small island reflect the current rhythm.

## Thesis / Purpose

Focus Islands should help one person make a realistic plan, protect time for real breaks, and learn from the difference between the day they intended and the day they lived. Focus often needs less prompting than breaks do. Reminders should be gentle and repeatable, with room to snooze or skip rather than pressure to follow a rigid schedule.

A day may be planned the previous evening or that morning: enter expected meetings and intended start and finish times, then see suggested focus and break blocks. The actual day begins with the first focus session, on time or not. Meetings can be added or cancelled; focus and breaks can start early, run late, or be skipped. The day can end simply because activity stops or the user turns to tomorrow's plan. The original plan, later deliberate revisions, and actual activity should remain distinct so a future view can show how expectations and work patterns change over time.

The companion is local-first and useful without a browser extension. It records aggregate activity and confirmed breaks, never keystrokes, mouse movements, or browsing history. An optional Chrome nudge can redirect chosen distracting sites during focus, with a deliberate bypass. A small sky-island game can make healthy rhythms pleasant to revisit; the reward rules and art can evolve without rewriting the recorded facts. A task list is outside the current scope.

## Computer activity signal

The menu bar app samples macOS system idle time once per second. Recent mouse or keyboard use shows Activity detected; after the configured activity delay without input, or while the Mac is locked or asleep, Today shows Away from computer and the island's sky turns to dusk. The indicator changes back when input resumes. Settings → Debug can show a countdown and progress bar on Today; it is off by default and does not change detection. The delay defaults to 2 minutes in the normal app and 5 seconds in development. Settings can change it per profile. The app does not capture keys, pointer coordinates, or individual input events, and it does not save these samples to SQLite. After focus has begun, away time is shown immediately as an inferred break, including time while the Mac is locked or asleep. When input returns, the app opens a prominent confirmation dialog. **I'm back** returns to focus immediately; continued recent input for one minute does so automatically. A lapse in input pauses that automatic return, and **I'm still on break** dismisses it. The break ends at the first input of the confirmed or continuous return, so that confirmation minute counts as focus. A break lasting at least three minutes or 75% of the planned break length, whichever is longer, satisfies break pacing and starts a fresh focus interval on return. Inferred breaks appear in break totals; an explicitly started break is confirmed when you finish it, confirm your return, or automatically return after at least three minutes away. The manual buttons remain available. After you choose End day, activity and inactivity no longer create intervals or return prompts until the next local day.

New plans default to 9 am–5 pm, with 60-minute focus windows and 10-minute breaks. Settings can change these defaults for future days; existing plans keep their values. Day start and finish use 15-minute choices, from 7 am through 9 pm. Take long break starts a 30-minute break without changing the usual break length or saved plan. Snoozing a suggested break starts a short focus session for the chosen interval. Skipping a due break keeps the current focus session running and asks again after another focus interval. Today labels overdue focus time as time past the target; break timers show negative overtime. A break continues until you finish it, then the next focus session starts automatically.

At the planned finish, Today offers **End day** or a 5–60 minute snooze to wrap up. This takes priority over focus, break, and return prompts. End day closes the current session, keeps its recorded time, and rests the companion until tomorrow, including after a restart. An optional “How did today feel?” reflection saves to today and appears in Yesterday the next day. Snoozing the finish reminder keeps the current session and saved plan unchanged.

With Visual reminders enabled, the Personal app brings Today forward and shows a short, click-through pixel confetti burst on every connected display when a break first becomes due. If the break is still due, a large shaking ⏰ enters from the top-right of each display about every five minutes, grows to roughly a quarter-screen footprint, then shrinks away. Reduced Motion removes the shaking and falling animations. Reminders wait until the Mac is active and unlocked; a scheduled meeting defers a due break reminder until it ends. At the planned finish, Today opens and later reminders use the clock. No macOS desktop notifications are sent.

## Run Personal

Install Node.js 22.13 or newer, then run these commands from the project folder:

```bash
npm install
scripts/run-personal.sh
```

The launcher opens the Electron app in **Personal**. The small island in the menu bar opens or hides the window. It is sunny while you are at the Mac and turns to night while you are away; the Testing profile adds 🧪 next to it. The app has no Dock icon. Right-click the island and choose **Quit Focus Islands** to stop it. `scripts/run-personal.sh --watch` checks source changes and restarts the app after a successful check.
To load updated code, quit from the island's menu and run `scripts/run-personal.sh` again. A focus or break session restarted on the same day keeps its session and recorded timer progress. Time while the app was closed is paused unless a recorded away interval is open; that interval continues as a break until return. A normal quit saves a final progress checkpoint. A session left open from a previous day closes at its last recorded checkpoint on launch.
`run-personal.sh` builds, signs, and installs the app at `/Applications/Focus Islands.app` before launching it. The app used to be called Cozy Focus Pet; the install removes the old `/Applications/Cozy Focus Pet.app` so only one copy can open the Personal data, and it stops if the old app is still running. The installation does not change the Personal database.

Personal history stays at `~/Library/Application Support/CozyFocusPet/events.sqlite`. The folder keeps the app's earlier name on purpose. Settings can switch to a separate normal Testing profile while idle. A later normal launch starts in Personal again. The development launch below cannot enter Personal.

## Game demo

To try how the island game feels without waiting through real focus time and breaks, run:

```bash
scripts/run-game-demo.sh            # pick up the demo where it stopped
scripts/run-game-demo.sh --reset    # start fresh: day 1 morning, nothing earned
```

This opens the development app with a normal window and a 🧪 island in the menu bar. It keeps its own history in `.build/dev-instances/demo/` and never opens Personal, so the installed app can keep running. The demo starts the morning after the day you first open it, at your start time (9:00 unless you change it), and it treats you as present the whole time. It never switches to Away because you stopped typing. Closing the window hides it; the 🧪 island opens it again or quits.

Below the island, Today shows a demo panel. Each button presses the same buttons and clock moves the real app uses, so the game sees exactly what it would see from a real day:

- **Work 60 min** (your focus length): starts focus, or finishes a running break, which starts focus. Then it moves the clock forward one focus length, so a break is due.
- **Break 15 min**: takes a break, which ends focus. Then it moves the clock 15 minutes and finishes the break. Focus starts again by itself.
- **Interrupted work**: works 20 minutes, then takes a break early. The break keeps running.
- **Interrupted break**: takes a break, if one isn't running, and comes back after 4 minutes. That is too short to count as a real break.
- **Step away 15 min**: steps away, moves the clock 15 minutes, then presses I'm back. During focus, that time counts as a break.
- **End the day**: ends the day, as Today's End day button does. The end-of-day card follows.
- **Next morning**: moves the clock to tomorrow's start time. If a session is still running, the day ends first.
- **Play a week** or **Play a month**: plays 7 or 30 steady days. Each day follows the default plan, takes real breaks, ends the day, and picks the first choice on every card. Play starts today if nothing has happened yet this morning, otherwise tomorrow.
- **Start over**: on a second click, deletes this demo's history and begins again on day 1 with nothing earned.

The buttons do not skip a check-in card. Pick on it when you like. If you keep going first, it stays and gathers what you earn next, as it does in the real app. Once the day ends, the buttons for time inside a day turn off until **Next morning**. They also refuse a step that would run past midnight. The panel's top lines show the day, time, current session, resources and town, and its list shows the last few steps.

Agents test the demo with `scripts/run-dev.sh --demo --hidden-window` in their own `COZY_FOCUS_INSTANCE`, or with `scripts/demo-smoke.sh`, which clicks through the panel in a hidden app.

## Develop and verify

```bash
npm run check:source             # quick renderer and Electron source check
scripts/test.sh                  # core behavior changes
scripts/build.sh                 # packaging changes or a distributable bundle
scripts/run-dev.sh               # background Testing app (--reset, --hidden-window, --demo, --packaged)
scripts/dev-control.sh status    # require profile=testing and appActive=false
scripts/dev-control.sh screenshot
scripts/dev-control.sh quit
```

Use the checks that match the change. For a small UI change, drive just that flow with `dev-control.sh` in the background Testing app, inspect its screenshot, and confirm `appActive=false`. Run `scripts/today-smoke.sh` when changing day guidance or timer integration. Reserve the longer `scripts/ui-smoke.sh` loop for changes spanning several views, persistence and relaunch, or a release check. It covers focus, breaks, the island slot, the new focus and break notes, reflection, screenshots, and relaunch. In the development app, hidden `#dev-render-count` and `#dev-day-path-draw-count` elements count full page renders and day path redraws; `scripts/today-smoke.sh` reads them with `ui-read` to check that Today is not rebuilt during 10 seconds of focus.

On Today in the development app, drag anywhere on Your day path forward in 30-second steps. Releasing it advances the simulated clock; focus and break timers continue ticking from the new time. While a timer runs, **To focus end** or **To break end** advances precisely to its due point. The controls are available only in development mode and change Testing history.

`scripts/run-dev.sh` is the background launch entry point; `scripts/dev-control.sh` sends commands to the app after it starts. The development app writes to `.build/dev-state/events.sqlite`. `scripts/run-dev.sh --reset` deletes only this disposable state. The smoke scripts run hidden and default to separate disposable instances (`today-smoke`, `ui-smoke` and `demo-smoke`); they reset only their own instance. Screenshots come from the app's own Electron window.

For a packaging regression, `COZY_FOCUS_INSTANCE=packaged-check scripts/run-dev.sh --reset --hidden-window --packaged` builds and launches the signed bundle in an isolated Testing instance. Use the same instance with `dev-control.sh status` and `quit`.

Use [development-tools/forecast](development-tools/forecast/README.md) to render a manually supplied day plan and history as a local HTML forecast preview. The tool contains no bundled scenario data and does not open a profile database.

For parallel agent runs in one checkout, set a distinct `COZY_FOCUS_INSTANCE` for each agent and use it for every launch, control, and smoke command. For example, `COZY_FOCUS_INSTANCE=agent-a scripts/run-dev.sh --reset` and `COZY_FOCUS_INSTANCE=agent-a scripts/dev-control.sh status` use `.build/dev-instances/agent-a/`. A reset or quit for one instance leaves the others running.

The Testing control inbox also supports `ui-click`, `ui-fill`, `ui-read`, and `ui-drag` on selectors inside the app window. For example, `scripts/dev-control.sh ui-click '#nav-plan'` navigates through the actual renderer. `scripts/dev-control.sh events` reads the committed event ledger. `scripts/ui-smoke.sh` uses app-window controls for plan editing and meeting drag without activating the window.

### Future art experiments with Sunburst

Install the [OpenAI CLI](https://developers.openai.com/api/reference/cli) with `brew install openai/tools/openai`. This Sunburst command uses separately billed API credits, not a ChatGPT Pro subscription. The API key is stored in the macOS Keychain item `cozy-focus-openai`; never put it in the repo. From the project folder, generate a candidate PNG with [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/guides/image-generation):

```bash
mkdir -p .build/dragon-art
OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s cozy-focus-openai -w)" \
  openai images generate --model gpt-image-2.5-sunburst \
  --prompt "A cute green dragon, high-density pixel art sprite, transparent background" \
  --background transparent --output-format png --quality high \
  --output-dir .build/dragon-art --name dragon-candidate
```

Generated candidates stay in ignored `.build/dragon-art/` until reviewed. The app bundles no generated artwork. The sky-island scene is built in code; see [game/AGENTS.md](game/AGENTS.md).

The Electron main process owns SQLite, timers, and the menu bar. The renderer is in `electron/renderer/` and reaches the main process through named preload actions. The core is in `electron/core/`. Game rules and their versioned values belong in `electron/core/game/`; see [game/BUILD_PLAN.md](game/BUILD_PLAN.md).

Today has one lasting slot for the island scene, `<div id="today-island">`. The page creates it once and moves it into each new Today render, so a canvas inside it is never rebuilt. Its `data-mood` attribute is `focus`, `break`, `away`, or `done`. Until the scene is mounted, the slot shows a soft sky: calm blue for focus and dusk colours while resting. Today redraws the whole page only when something real changes, such as the phase, the guidance, its buttons, or the plan. The countdown, the presence badge, Up next, and the day path update in place; the day path redraws at most about once a minute unless its blocks change.

## Optional Chrome nudge

The extension is in `Extension/`. Run `scripts/install-chrome-host.sh chrome` to install its local phase bridge for personal Chrome, then load the unpacked extension through `chrome://extensions`. Its options page controls chosen sites. The bridge reads only a short-lived focus phase lease. It does not collect browsing history.

`scripts/chrome-smoke.sh` uses a separate Chromium profile and temporary host registration. `scripts/chrome-live-smoke.sh` pairs that browser with the isolated Testing app. Neither script uses your normal browser profile.

## Data

Each profile has its own SQLite database. The Electron core replays the existing event schema and date payloads. Plans, timer transitions, and reflections remain append-only. The old acorn rewards and shop are gone. Their records (`rewardGranted`, `rewardDebited`, `itemPurchased`) stay in older databases untouched, but nothing reads or shows them, and earned acorns do not carry over. Profile settings live in the same database. The renderer uses Zustand for the current snapshot and unsaved drafts; reloading it reads committed state from SQLite. Settings can export events and preferences to JSON and back up the active database.

See [STATE_PLAN.md](STATE_PLAN.md) for state ownership and day-planning rules.

Before the first session of the day, Today offers **I started earlier**. Choose the actual start time today and **Start from this time** to count that work toward your focus timer and actual timeline. This leaves the planned day unchanged.
