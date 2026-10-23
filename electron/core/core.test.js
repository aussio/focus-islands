const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, existsSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createCore } = require('./index');
const { openStore } = require('./store');
const { Timer } = require('./timer');
const { project, suggest } = require('./planning');

function temporaryCore() {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-core-test-'));
  const dbPath = join(directory, 'events.sqlite');
  const statusPath = join(directory, 'focus-status.json');
  return { dbPath, statusPath, core: createCore({ dbPath, statusPath, profile: 'testing', development: true }) };
}

test('a fresh day opens on Today without starting a session or requiring a plan', () => {
  const { core } = temporaryCore();
  const status = core.status();
  assert.equal(status.page, 'today');
  assert.equal(status.phase, 'idle');
  assert.equal(status.plan, null);
  assert.equal(status.guidance.situation, 'noPlan');
  assert.equal(new Date(status.dayStart).getHours(), 9);
  assert.equal(new Date(status.dayEnd).getHours(), 17);
  assert.equal(status.defaultFocusLength, 60);
  assert.equal(status.defaultBreakLength, 10);
  core.close();
});

test('existing event schema and legacy date payloads replay without migration', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cozy-legacy-test-')), 'events.sqlite');
  const database = new DatabaseSync(dbPath);
  database.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL);
    INSERT INTO schema_migrations VALUES (1, 0);
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      schema_version INTEGER NOT NULL, occurred_at REAL NOT NULL, recorded_at REAL NOT NULL,
      timezone TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, unique_key TEXT UNIQUE
    ); CREATE INDEX events_occurred_idx ON events(occurred_at);`);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17);
  const payload = JSON.stringify({ day: today.getTime() / 1000 - 978307200,
    start: start.getTime() / 1000 - 978307200, end: end.getTime() / 1000 - 978307200,
    meetings: [], focusMinutes: 25, breakMinutes: 5 });
  database.prepare('INSERT INTO events (id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key) VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL)')
    .run('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', 'dayPlan', today.getTime() / 1000, today.getTime() / 1000,
      Intl.DateTimeFormat().resolvedOptions().timeZone, 'user', payload);
  database.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().plan.start, start.toISOString());
  assert.equal(reopened.status().events.length, 1);
  assert.equal(reopened.status().events[0].id, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
  assert.equal(reopened.status().dayPlans[reopened.status().todayKey].baseline.provenance, 'legacy-first-save');
  reopened.close();
});

test('tomorrow baseline and later intent survive without changing today', () => {
  const { dbPath, core } = temporaryCore();
  const tomorrowKey = core.status().tomorrowKey;
  const [year, month, day] = tomorrowKey.split('-').map(Number);
  const start = new Date(year, month - 1, day, 9).toISOString();
  const end = new Date(year, month - 1, day, 17).toISOString();
  core.action('save-plan', { dayKey: tomorrowKey, start, end, focusMinutes: 25, breakMinutes: 5 });
  const revised = core.action('save-plan', { dayKey: tomorrowKey, focusMinutes: 40 });
  assert.equal(revised.plan, null);
  assert.equal(revised.dayPlans[tomorrowKey].baseline.focusMinutes, 25);
  assert.equal(revised.dayPlans[tomorrowKey].baseline.provenance, 'explicit');
  assert.equal(revised.dayPlans[tomorrowKey].current.focusMinutes, 40);
  assert.equal(revised.dayPlans[tomorrowKey].revisionCount, 1);
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().dayPlans[tomorrowKey].current.focusMinutes, 40);
  reopened.close();
});

test('session changes revise the live forecast without revising the saved plan', () => {
  const { core } = temporaryCore();
  const real = new Date();
  const morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9, 30);
  core.action('wall-jump', (morning.getTime() - real.getTime()) / 60000);
  const start = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9).toISOString();
  const end = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 12).toISOString();
  const planned = core.action('save-plan', { start, end, focusMinutes: 25, breakMinutes: 5 });
  const baselineID = planned.dayPlans[planned.todayKey].latestEventID;
  const focusing = core.action('start-focus');
  assert.ok(focusing.forecastTimeline.some(block => block.active && block.kind === 'focus'));
  const resting = core.action('start-break');
  assert.ok(resting.forecastTimeline.some(block => block.active && block.kind === 'break'));
  core.action('advance', 5);
  const finished = core.action('finish-break');
  assert.equal(finished.dayPlans[finished.todayKey].latestEventID, baselineID);
  assert.equal(finished.dayPlans[finished.todayKey].revisionCount, 0);
  assert.ok(finished.forecastTimeline.some(block => block.actual && block.kind === 'break'));
  core.close();
});

test('paused focus is not forecast as active or redrawn after return', () => {
  const { core } = temporaryCore();
  const real = new Date(), day = new Date(real.getFullYear(), real.getMonth(), real.getDate());
  const morning = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 30);
  core.action('wall-jump', (morning.getTime() - real.getTime()) / 60000);
  core.action('save-plan', { start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString(),
    end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString() });
  core.action('start-focus'); core.action('advance', 2);
  const paused = core.action('away');
  assert.equal(paused.timer.isSleeping, true);
  assert.ok(paused.actualTimeline.some(block => block.kind === 'focus'));
  assert.equal(paused.forecastTimeline.some(block => block.active), false);
  const resumed = core.action('return');
  const actualEnd = Math.max(...resumed.actualTimeline.filter(block => block.kind === 'focus').map(block => Date.parse(block.end)));
  assert.ok(resumed.forecastTimeline.some(block => block.active && Date.parse(block.start) >= actualEnd));
  core.close();
});

test('profile settings import once into SQLite and do not change an existing day plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-settings-test-'));
  const dbPath = join(directory, 'events.sqlite');
  const legacyPath = join(directory, 'preferences-testing.json');
  writeFileSync(legacyPath, JSON.stringify({ focusMinutes: 40, breakMinutes: 10, notificationsEnabled: false }));
  const core = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(core.status().defaultFocusLength, 40);
  assert.equal(core.status().notificationsEnabled, false);
  const initial = core.status();
  core.action('save-plan', { dayStart: initial.dayStart, dayEnd: initial.dayEnd, focusLength: 25, breakLength: 5 });
  const saved = core.action('save-preferences', { focusLength: 50, breakLength: 15, notificationsEnabled: true });
  assert.equal(saved.defaultFocusLength, 50);
  assert.equal(saved.focusLength, 25);
  core.close();
  assert.equal(JSON.parse(readFileSync(legacyPath)).focusMinutes, 40);
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().defaultFocusLength, 50);
  assert.equal(reopened.status().focusLength, 25);
  assert.equal(reopened.status().notificationsEnabled, true);
  reopened.close();
});

test('focus and confirmed break grant once and persist after restart', () => {
  const { dbPath, statusPath, core } = temporaryCore();
  core.action('start-focus'); core.action('advance', 60);
  assert.equal(core.status().breakDue, true);
  core.action('start-break');
  core.action('advance', 10); core.action('finish-break');
  assert.equal(core.status().balance, 35);
  assert.deepEqual(core.status().unlockedItems, []);
  assert.equal(core.action('purchase', 'plant').balance, 0);
  assert.deepEqual(core.status().unlockedItems, ['plant']);
  assert.equal(core.action('purchase', 'plant').balance, 0);
  assert.ok(existsSync(statusPath));
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().balance, 0);
  assert.deepEqual(reopened.status().unlockedItems, ['plant']);
  reopened.close();
});

test('launch starts idle after an unfinished focus and keeps only observed progress', () => {
  const { dbPath, statusPath, core } = temporaryCore();
  assert.equal(core.status().phase, 'idle');
  core.action('start-focus');
  core.action('advance', 2);
  const before = core.status();
  const checkpoint = before.events.filter(event => event.kind === 'focusResumed').at(-1);
  core.close();

  const reopened = createCore({ dbPath, statusPath, profile: 'testing', development: true });
  const after = reopened.status();
  const ended = after.events.filter(event => event.kind === 'focusEnded');
  assert.equal(after.phase, 'idle');
  assert.equal(after.timer.sessionID, null);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].occurredAt, checkpoint.occurredAt);
  assert.equal(ended[0].payload.elapsedSeconds, checkpoint.payload.elapsedSeconds);
  assert.equal(ended[0].payload.interrupted, true);
  assert.equal(after.balance, Math.floor(checkpoint.payload.elapsedSeconds / 60));
  assert.equal(JSON.parse(readFileSync(statusPath, 'utf8')).phase, 'idle');
  reopened.close();

  const nextLaunch = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(nextLaunch.status().events.filter(event => event.kind === 'focusEnded').length, 1);
  nextLaunch.close();
});

test('launch starts idle after an unfinished break without confirming it', () => {
  const { dbPath, core } = temporaryCore();
  core.action('start-break');
  core.action('advance', 2);
  const checkpoint = core.status().events.filter(event => event.kind === 'breakProgress').at(-1);
  core.close();

  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const after = reopened.status();
  const ended = after.events.filter(event => event.kind === 'breakEnded');
  assert.equal(after.phase, 'idle');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].occurredAt, checkpoint.occurredAt);
  assert.equal(ended[0].payload.interrupted, true);
  assert.equal(after.events.filter(event => event.kind === 'breakConfirmed').length, 0);
  assert.equal(after.balance, 0);
  reopened.close();
});

test('unobserved gap does not credit focus after recovery', () => {
  const start = new Date('2025-01-01T10:00:00Z');
  const events = [
    { sequence: 1, kind: 'focusStarted', occurredAt: start.toISOString(), payload: { sessionID: 'A', targetSeconds: 1500 } },
    { sequence: 2, kind: 'focusResumed', occurredAt: '2025-01-01T10:05:00Z', payload: { sessionID: 'A', targetSeconds: 1500, elapsedSeconds: 300 } },
  ];
  const timer = Timer.recover(events, { wall: new Date('2025-01-02T10:00:00Z'), monotonicSeconds: 100 });
  assert.equal(timer.state.elapsedSeconds, 300);
  assert.equal(timer.state.unknownGapStartedAt, '2025-01-01T10:05:00Z');
  assert.deepEqual(timer.advance({ wall: new Date('2025-01-02T10:00:01Z'), monotonicSeconds: 101 }), []);
  assert.equal(timer.state.elapsedSeconds, 301);
});

test('actual focus timeline excludes an unobserved pause', () => {
  const at = minute => new Date(2026, 0, 5, 9, minute).toISOString();
  const events = [
    { kind: 'focusStarted', occurredAt: at(0), payload: { sessionID: 'A' } },
    { kind: 'focusPaused', occurredAt: at(10), payload: { sessionID: 'A', elapsedSeconds: 600 } },
    { kind: 'awayStarted', occurredAt: at(10), payload: {} },
    { kind: 'focusResumed', occurredAt: at(20), payload: { sessionID: 'A', elapsedSeconds: 600 } },
    { kind: 'awayEnded', occurredAt: at(20), payload: {} },
    { kind: 'focusEnded', occurredAt: at(30), payload: { sessionID: 'A', elapsedSeconds: 1200 } },
  ];
  const actual = project(events, new Date(at(0)), false);
  assert.equal(actual.focusSeconds, 1200);
  assert.deepEqual(actual.actual.filter(block => block.kind === 'focus').map(block => [block.start, block.end]),
    [[at(0), at(10)], [at(20), at(30)]]);
  assert.equal(actual.actual.find(block => block.kind === 'away').observedSeconds, 600);
});

test('suggested focus days keep breaks at common and odd durations', () => {
  const day = new Date(2026, 0, 5);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString();
  for (const breakMinutes of [5, 7]) {
    const blocks = suggest({ start, end, meetings: [], focusMinutes: 25, breakMinutes });
    assert.ok(blocks.some(block => block.kind === 'break'));
    assert.equal(blocks[0].start, start);
    assert.equal(blocks.at(-1).end, end);
  }
  const shiftedStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 2, 17).toISOString();
  const meetingStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 13).toISOString();
  const meetingEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 43).toISOString();
  const shifted = suggest({ start: shiftedStart, end, focusMinutes: 25, breakMinutes: 5,
    meetings: [{ title: 'Check-in', start: meetingStart, end: meetingEnd }] });
  assert.ok(shifted.some(block => block.kind === 'break'));
  assert.deepEqual(shifted.filter(block => block.kind === 'meeting').map(block => [block.start, block.end]), [[meetingStart, meetingEnd]]);
  assert.equal(shifted[0].start, shiftedStart);
  assert.equal(shifted.at(-1).end, end);
});

test('plans use focus, breaks, and meetings even when a gap is too short for focus', () => {
  const day = new Date(2026, 0, 5);
  const at = (hour, minute) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
  const plan = { start: at(9, 0), end: at(9, 35), focusMinutes: 25, breakMinutes: 5,
    meetings: [{ title: 'Check-in', start: at(9, 5), end: at(9, 35) }],
    customBlocks: [{ kind: 'free', start: at(9, 0), end: at(9, 5) },
      { kind: 'meeting', title: 'Check-in', start: at(9, 5), end: at(9, 35) }] };
  assert.deepEqual(suggest(plan).map(block => block.kind), ['break', 'meeting']);
  assert.deepEqual(suggest({ ...plan, meetings: [], end: at(9, 5), customBlocks: null }).map(block => block.kind), ['break']);
});

test('export and backup include committed events', async () => {
  const { dbPath, core } = temporaryCore();
  core.action('start-focus');
  const exported = `${dbPath}.json`, backedUp = `${dbPath}.backup`;
  core.exportJSON(exported);
  await core.backup(backedUp);
  const exportedData = JSON.parse(require('node:fs').readFileSync(exported, 'utf8'));
  assert.deepEqual(exportedData.events.map(event => event.kind), ['dayPlan', 'focusStarted']);
  assert.equal(exportedData.events[0].payload.provenance, 'generated-default');
  assert.equal(exportedData.settings.focusMinutes, 60);
  const copy = openStore(backedUp);
  assert.equal(copy.allEvents().length, 2);
  assert.equal(copy.getSettings().focusMinutes, 60);
  copy.close(); core.close();
});

test('simulation actions are unavailable outside development', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cozy-personal-guard-')), 'events.sqlite');
  const core = createCore({ dbPath, profile: 'personal', development: false });
  assert.throws(() => core.action('dev-scenario', 'completedDay'), /Development action unavailable/);
  assert.throws(() => core.action('advance', 25), /Development action unavailable/);
  assert.equal(core.status().events.length, 0);
  core.close();
});

test('snoozed focus prompts and completed breaks produce distinct signals', () => {
  const { core } = temporaryCore();
  core.action('start-focus');
  assert.equal(core.action('advance', 60).reminderSequence, 1);
  core.action('snooze-break');
  assert.equal(core.action('advance', 4).reminderSequence, 1);
  assert.equal(core.action('advance', 1).reminderSequence, 2);
  core.action('start-break');
  assert.equal(core.action('advance', 10).breakCompleteSequence, 1);
  core.close();
});

test('a break completed during sleep signals completion on wake', () => {
  const { core } = temporaryCore();
  core.action('start-break');
  const resumed = core.action('sleep-wake');
  assert.equal(resumed.breakCompleteSequence, 1);
  assert.equal(resumed.timer.isDue, true);
  core.close();
});

test('a rejected event write leaves the committed timer and plan in place', () => {
  const { dbPath, core } = temporaryCore();
  const database = new DatabaseSync(dbPath);
  database.exec("CREATE TRIGGER reject_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'write rejected'); END");
  assert.throws(() => core.action('start-focus', { planDraft: { focusMinutes: 40 } }), /write rejected/);
  const rejected = core.status();
  assert.equal(rejected.phase, 'idle');
  assert.equal(rejected.dayPlans[rejected.todayKey].baseline, undefined);
  assert.equal(rejected.events.length, 0);
  database.exec('DROP TRIGGER reject_events');
  const started = core.action('start-focus', { planDraft: { focusMinutes: 40 } });
  assert.equal(started.phase, 'focus');
  assert.equal(started.dayPlans[started.todayKey].baseline.focusMinutes, 40);
  database.exec("CREATE TRIGGER reject_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'write rejected'); END");
  assert.throws(() => core.action('end-focus'), /write rejected/);
  assert.equal(core.status().phase, 'focus');
  assert.equal(core.status().events.filter(event => event.kind === 'focusEnded').length, 0);
  database.exec('DROP TRIGGER reject_events');
  database.close(); core.close();
});
