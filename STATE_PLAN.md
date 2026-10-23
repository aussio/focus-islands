# Cozy Focus Pet state plan

Status: implemented in the Electron app. The boundaries below describe the current behavior and the rules for further changes.

## The four views of a day

These are different values and must stay separately named in code and in snapshots.

| View | Meaning | Source |
| --- | --- | --- |
| **Baseline plan** | The day as the user set it up, including the meetings known then | The first committed plan event for that day, with its provenance |
| **Current intent** | The user's latest deliberate changes to that plan | The baseline followed by timestamped plan revision events |
| **Live forecast** | What may still fit today, given current intent, completed work and breaks, the active session, and the current time | A calculation in the main process; never a saved plan revision |
| **Actual day** | Work, breaks, away time, and any meetings later recorded as attended | Timestamped fact events in SQLite; meeting attendance is a future fact type |

The baseline stays available after a revision. An actual break changes the forecast but does not rewrite either plan. A meeting added later is a plan revision; it does not alter the baseline. A scheduled meeting remains intent unless a separate attendance fact is recorded. Attendance capture is outside this implementation pass. This preserves the inputs needed for a future before-and-after view without recording a new forecast every second.

The first explicit **Set plan** action for a selected local date commits that date's baseline. The user can select today or tomorrow and plan tomorrow the previous evening. Until commit, plan fields are drafts. Starting the first focus session for today from the window sends today's draft with the command, and the main process commits today's baseline and session start together. A start command from a main-process handler without the renderer, such as a future tray action, has no draft; if today's plan does not exist, the main process creates its baseline from stored profile defaults, with no unsaved meetings. An unsaved window draft is never treated as committed by that path. On window reload, drafts are gone and the main process supplies committed plans or defaults. Later deliberate edits append revisions. The UI must make this boundary clear; today's automatic field-by-field saves cannot define a trustworthy baseline.

Every plan command names its target **local calendar date**. The main process does not infer the target from the wall-clock date of the edit or from a UTC timestamp. Day start and finish use the Mac's local clock, including when the user plans tomorrow at night. A first focus session begins the actual day even if it starts later than intended. The day ends at the next local date boundary for reporting; no interaction or synthetic “day ended” fact is required. This pass assumes sessions stay within one local date and does not handle cross-midnight work or time-zone changes.

New baseline events record whether they came from an explicit plan action or a generated default. Existing first plan events have no such marker and may have come from a single field edit. Replay labels them **legacy first save**, preserves their original bytes, and does not claim that the user approved them as a complete morning plan.

## Ownership

| Owner | Holds | Writes to disk? | Rule |
| --- | --- | --- | --- |
| SQLite database for the active profile | Fact events, baseline and revised plans, and one current settings row | Yes | Durable authority. Personal and Testing use separate databases. |
| Electron main process | Command handling, timer clock, event replay, plan and actual projections, live forecast, notification decisions | Through SQLite | The only process that interprets and commits domain changes. |
| Zustand vanilla store in the renderer | Latest main-process snapshot, navigation, pending commands, errors, and unsaved form drafts | No | The single interface used by views and UI actions. It is a read model and command gateway, not a second durable record. |
| Chrome phase lease | Short-lived focus/break signal for the extension | Temporary file | A disposable publication of main-process state; it cannot change the database. |

The renderer must not open SQLite, calculate rewards, or independently revise the schedule. Main-process tray, power, and notification handlers use the same command path as renderer actions. Zustand's `persist` middleware is not used: reloading the window gets a fresh authoritative snapshot from the main process.

## What SQLite stores

Keep the existing append-only `events` ledger and its schema migration history. Events record the first plan, deliberate plan revisions, timer and activity facts, reflections, and any future reward facts. Each event keeps its ID, occurrence time, recording time, source, and schema version. A plan revision refers to the plan it revises. Facts are never rewritten because a forecast changes.

Add a typed, single-row `settings` table in each profile database for current preferences such as default focus length, default break length, and notifications. Settings provide defaults for future days. Today's chosen rhythm belongs to the day's baseline or a deliberate plan revision; changing a profile default does not revise today's plan. Changing either value while a timer runs does not alter that session's fixed target. A schema migration creates the table. On first open, import the existing profile-specific preferences JSON only if the database has no settings row; commit that row before treating the import as complete. Retain the old file until the import is verified. Database backup and JSON export must include settings as well as events.

Keep active timer seconds in the main process and checkpoint observed progress to events at bounded intervals and on suspend, resume, or phase transitions. Do not write once per second. On relaunch, replay the last checkpoint and pause any unobserved gap; no elapsed focus or earned outcome is invented for that gap.

Use SQLite transactions for commands that produce multiple durable records. Compute a proposed timer transition and its events without changing the live timer, commit the required writes, then install the new timer state and publish it. A command reports success only after commit. After a failed write, retain or replay the last committed projection and report the error to the UI; no uncommitted elapsed time, phase, or plan change may appear as saved. Reward rules remain a separate product decision; this plan only requires that any eventual reward records follow the same transaction and replay rules.

## Command and snapshot flow

1. A view reads Zustand and calls a store action such as `startFocus`, `savePlan`, or `saveSettings`. It never calls preload IPC directly.
2. The store sends a named command through preload. It may mark the command pending but does not claim a durable change succeeded.
3. The main process handles commands in order, validates each one, computes the required changes, commits durable records, updates its timer and projections, and publishes a complete snapshot.
4. Zustand accepts the snapshot and notifies Today, Plan, Room, and Settings. A rejected command leaves the draft intact and exposes an error.

The snapshot has an app/profile epoch and a monotonically increasing publication number. The renderer accepts only newer snapshots in that epoch. Switching profiles starts a new epoch and clears profile-specific drafts. This keeps a late command response or initial load from replacing a newer pushed update.

At window startup, subscribe to published snapshots before requesting the initial snapshot. On relaunch, the main process opens the selected profile database, migrates it, replays events, loads settings, restores the timer conservatively, computes projections, and then serves the snapshot. A renderer reload follows the same request path; no renderer cache is needed for recovery.

## Recalculation rules

The main process calculates a live forecast from current intent, actual intervals, the active session, and the clock. It keeps completed intervals fixed, respects upcoming meetings, and schedules only the remaining day. It recalculates after a plan revision, meeting change, session start or end, break confirmation, away/return transition, or day rollover. While a session runs, it can refresh the forecast at a minute boundary if the remaining schedule changed. A one-second countdown update does not rerun the planner. Each published forecast identifies the input revision it used; a slow calculation cannot replace a newer one.

Today and Plan display the same forecast from the same snapshot. The actual timeline and baseline plan remain separately available for comparison. A running session can appear as observed progress, but it is not a completed actual interval until the corresponding fact is committed.

## Implementation order and proof

1. Add SQLite settings storage and the one-time JSON import. Verify settings, events, backup, and export after a restart in isolated Testing.
2. Make the baseline commit explicit for a selected local date and keep later edits as revisions. Label older first saves as legacy. Verify that a plan for tomorrow survives overnight, early drafts do not create a false baseline, non-renderer starts use main-owned defaults, and a late meeting leaves the baseline intact.
3. Extract a pure forecast calculation from current intent, actual facts, active session, and time. Verify that starting and ending a break changes both Today and Plan without adding a plan revision.
4. Add a main-process command/snapshot boundary with ordered publications. Verify failed writes leave the timer and last committed view intact and a late response cannot roll the UI back.
5. Add one Zustand vanilla store as the renderer's snapshot, draft, and command interface. Remove direct view-to-preload calls and duplicate mutable UI state. Verify unsaved edits survive timer publications and a renderer reload reconstructs state from SQLite.

All checks use the isolated Testing database. Personal history is never reset or inspected to test this migration.

## Current limits

The plan selector covers today and tomorrow. Meeting attendance has no separate fact type yet. The app assumes sessions remain within one local date and does not reconcile time-zone changes. These limits do not change the ownership rules above.
