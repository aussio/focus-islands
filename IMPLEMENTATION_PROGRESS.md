# Cozy Focus Pet: implementation progress

The MVP is **in progress**. This file tracks the [product plan](IMPLEMENTATION_PLAN.md) and current gaps, rather than the history of debugging sessions.

| Area | Current state | Remaining work |
| --- | --- | --- |
| Desktop shell and data safety | Menu bar paw opens and hides the window; right-click offers Quit. Normal launches start in Personal with no Dock icon; the sidebar labels the active profile and offers a direct Testing switch while idle. Agent launches are locked to an isolated Testing database and run behind other windows. App-scoped commands and own-window screenshots work without broad computer control. A clean-source build passed in a disposable directory. | User review of the normal Personal launch and menu bar interaction. |
| Facts and timer | SQLite migrations, WAL, append-only events, session recovery, focus/break transitions, snooze, and capped rewards are implemented. Idle and locked time suspend focus credit; simulated sleep and wall-clock changes do not grant credit. Break notifications offer Start break, Snooze, and Skip. | User verification of real macOS sleep/wake and notification presentation/actions after granting notification permission. |
| Day planning and history | Day bounds and rhythm update immediately, then nearby edits coalesce into one stored plan fact after four quiet seconds. Leaving Plan, closing the calendar, switching profiles, or quitting flushes the draft. A day-view sheet supports 15-minute snapping: drag empty space to create a meeting, drag its middle to move, drag an edge to resize, right-click to delete, and rename in the sheet. The dragged block remains a fixed mouse target while a separate preview follows the pointer. Plan shows a meeting preview and a read-only suggested day calendar; the task list is outside the MVP. Today now uses that same suggested schedule for its next action and live day tracker. It updates as plan inputs or time change, and it chooses a timer length again when the user starts. An active timer keeps its original target after plan edits. Plan revisions, yesterday's structured focus/break lengths and reflection, and planned-versus-actual history exist. Reflection submission collapses into a saved confirmation with Edit and Cancel; Return submits the brief field. Isolated app checks verify coalesced meeting revisions and reflection survive relaunch. | User review of Today guidance, pointer drag and right-click interactions, plan editing, and Return submission in the normal app. |
| Pet and room | A red panda, three room purchases, visible room changes, an extracted theme and room catalog, a versioned balance file, and a read-only reward rebalance preview from retained facts are present. | User review of visuals and reward preview. |
| Chrome nudge | Manifest V3 extension, chosen domains, native host, bypass, and fail-open release are implemented. Isolated browser checks pass focus redirect, bypass, break release, stale status release, and host failure release. A live Testing app lease released the redirect on break in 26.3 seconds. | Installation and behavior in the user's browser only when requested. |

## Working workflows

- **Personal:** `scripts/run-personal.sh` builds and opens the normal app. Startup chooses Personal; Settings can switch profiles for a session. The app has a menu bar icon and no Dock icon.
- **Agent:** `scripts/run-dev.sh` builds one background app locked to `.build/dev-state/events.sqlite`. `scripts/dev-control.sh status` should report `profile=testing` and `appActive=false`; `screenshot` returns a PNG of only that app window. `scripts/ui-smoke.sh` resets only Testing and checks a full focus/break/reward loop.
- **Browser:** `scripts/chrome-smoke.sh` uses an isolated Chromium profile. Chrome DevTools MCP can inspect the running browser when available; it is separate from native-window screenshots.

Current verification: 27 core tests pass; the Xcode app builds. The isolated app smoke check passes a full cycle, timeline and meeting model edits, reflection and plan replay, interrupted-session recovery, simulated idle/lock/sleep/clock changes, screenshots, and quit. `scripts/today-smoke.sh` checks immediate plan changes, timer targets, meeting transitions, and day rollover in Testing. App-owned Today, meeting editor, room, and Settings screenshots were visually inspected in the background. Both browser smoke modes pass. The Personal launcher has not been run, so verification has not opened the user's database.

## Next work

1. In Personal, review the menu bar launch, Today guidance, plan editing, pet room, and reward preview.
2. With notification permission, verify a real break prompt and its three actions.
3. During a real session, verify sleep/wake and lock/unlock behavior on this Mac.

The implementation is committed locally. Development state is under `.build/`; the user's Personal database remains under Application Support.
