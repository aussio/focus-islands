# Cozy Focus Pet: product and implementation plan

## What we are making

A quiet macOS menu bar companion that helps one person shape a workable day and take restorative breaks. The day plan should feel easy to change. The pet and room should make healthy rhythms feel rewarding without pressuring the user to stay at the screen. The app is local-first and useful even if the Chrome extension is never installed.

## Experience principles

- **Gentle, not punitive.** Reminders offer a break, snooze, or skip. Working past a break never earns extra reward.
- **Plans are suggestions; facts are durable.** Meetings help shape the day, but the history records what actually happened and what the user reported. Changing a plan never rewrites history.
- **A small, cozy reward loop.** One expressive pet, a few room changes, and clear progress. Rewards celebrate focus balanced with breaks.
- **Private and predictable.** Keep the user's facts on this Mac. Record aggregate activity intervals, never keystrokes, URLs, or browsing history. Normal launches start in Personal; agents use a separate locked Testing database.
- **Quiet desktop behavior.** One menu bar paw, no Dock icon. The window can be hidden with its red or yellow control and reopened from the paw. Right-click the paw to quit completely.

## Core day loop

1. Offer a brief optional reflection on yesterday and let the user enter today's rough start and finish and meetings.
2. Suggest focus and break blocks around fixed meetings in a read-only day calendar. Never start a timer merely because a suggested block begins.
3. Show a flexible focus countdown in the menu bar and window. At the limit, send a gentle local break prompt with Start break, Snooze, and Skip. Rate-limit overdue reminders.
4. Record focus, confirmed breaks, and inferred away time as different facts. Handle idle, lock, sleep, wake, relaunch, and clock changes without crediting unobserved work.
5. Award capped focus credit and a break bonus. Allow room purchases and show a planned-versus-actual timeline, daily totals, and reflections.
6. Optionally redirect chosen distracting sites during focus. Allow a deliberate one-time bypass; release rules on break or if the app or native host is unavailable.

## Architecture and workflows

- Use SwiftUI for the window and AppKit for the menu bar item and window behavior. Target macOS 15. Build locally with Xcode.
- Keep a separate SQLite database per profile. Preserve the existing Personal path, `~/Library/Application Support/CozyFocusPet/events.sqlite`. Store append-only events with migrations and stable IDs. Use transactions for reward grants and purchases; provide profile-specific backup and export.
- Keep timer, planning, activity interpretation, and reward rules testable with small system boundaries for clock, event store, activity, notifications, and phase publishing. Keep theme, asset catalog, and versioned reward values replaceable without changing stored facts.
- `scripts/run-personal.sh` is the normal, visible Personal launch. `scripts/run-dev.sh` starts a locked Testing app behind other windows. Named app-scoped commands advance scenarios and capture only the app's own window. Automated checks may reset Testing, never Personal.
- The Chrome Manifest V3 extension reads a short-lived phase lease through a native messaging host. An isolated browser smoke test checks redirects, bypass, break release, and host failure without using the user's browser profile.

## Delivery sequence

1. **Desktop shell and safe development loop:** menu bar paw, hide/reopen/quit, Personal and Testing data boundaries, background app control, own-window screenshots.
2. **Reliable facts and timer:** SQLite replay, focus and break transitions, notifications, activity signals, recovery, and reward uniqueness.
3. **Flexible day planning:** meetings, read-only suggested calendar, yesterday reflection, and planned-versus-actual history. A task list is outside this MVP.
4. **Cozy game layer:** pet states, room items, purchases, versioned balance policy, and replaceable visual resources.
5. **Chrome nudge:** chosen sites, focus-only redirect, bypass, and fail-open release.

The MVP is complete when an agent can build from a clean checkout, run and visually inspect the whole loop in Testing, prove plans, actual intervals, reflections, and purchases survive relaunch, and leave Personal untouched. The user can run Personal from the menu bar without a Dock icon and quit through the paw. The Chrome nudge follows the live app phase and releases within about a minute on break or host failure. [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) tracks what is done and what remains.
