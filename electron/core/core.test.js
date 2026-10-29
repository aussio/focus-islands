const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, existsSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createCore } = require('./index');
const { openStore } = require('./store');
const { Timer } = require('./timer');
const { project, suggest, forecast } = require('./planning');

test('forecast keeps short interrupted focus in the same work rhythm', () => {
  const at = (hour, minute) => new Date(2026, 9, 23, hour, minute).toISOString();
  const plan = { start: at(9, 0), end: at(12, 0), focusMinutes: 60, breakMinutes: 10, meetings: [] };
  const actual = [
    { kind: 'focus', start: at(9, 0), end: at(9, 2), observedSeconds: 120 },
    { kind: 'focus', start: at(9, 5), end: at(9, 8), observedSeconds: 180 },
  ];
  const blocks = forecast(plan, actual, { phase: 'idle' }, at(9, 10));
  const upcoming = blocks.filter(item => item.forecast);
  assert.equal(upcoming[0].kind, 'focus');
  assert.equal(upcoming[0].start, at(9, 10));
  assert.equal(upcoming[0].end, at(10, 5));
  assert.equal(upcoming[1].kind, 'break');
});

test('forecast honors a snoozed due break and a skipped break', () => {
  const at = (hour, minute) => new Date(2026, 9, 23, hour, minute).toISOString();
  const plan = { start: at(9, 0), end: at(12, 0), focusMinutes: 60, breakMinutes: 10, meetings: [] };
  const timer = { phase: 'focus', sessionID: 'focus-1', startedAt: at(9, 0),
    observedSegmentStartedAt: at(9, 0), targetSeconds: 3600, elapsedSeconds: 3600, isDue: true };
  const snoozed = forecast(plan, [], timer, at(10, 0), [{ kind: 'breakSnoozed', occurredAt: at(10, 0), payload: { sessionID: 'focus-1', minutes: 5 } }]);
  assert.equal(snoozed.find(item => item.active).end, at(10, 5));
  assert.equal(snoozed.find(item => item.forecast).start, at(10, 5));
  const actual = [{ kind: 'focus', start: at(9, 0), end: at(10, 0), observedSeconds: 3600 }];
  const skipped = forecast(plan, actual, { phase: 'idle' }, at(10, 0),
    [{ kind: 'breakSkipped', occurredAt: at(10, 0), payload: { sessionID: 'focus-1' } }]);
  assert.equal(skipped.find(item => item.forecast).kind, 'focus');
  const idleSnoozed = forecast(plan, actual, { phase: 'idle' }, at(10, 0),
    [{ kind: 'breakSnoozed', occurredAt: at(10, 0), payload: { scope: 'forecast', minutes: 5 } }]);
  assert.equal(idleSnoozed.find(item => item.forecast).kind, 'focus');
  assert.equal(idleSnoozed.find(item => item.forecast).end, at(10, 5));
  assert.equal(idleSnoozed.filter(item => item.forecast)[1].kind, 'break');
});

test('live forecast keeps meeting times fixed through skipped breaks and overlapping sessions', () => {
  const at = (hour, minute) => new Date(2026, 9, 23, hour, minute).toISOString();
  const meeting = { title: 'Check-in', start: at(10, 15), end: at(10, 45) };
  const plan = { start: at(9, 0), end: at(12, 0), focusMinutes: 60, breakMinutes: 10, meetings: [meeting] };
  const actual = [{ kind: 'focus', start: at(9, 0), end: at(10, 0), observedSeconds: 3600 }];
  const skipped = [{ kind: 'breakSkipped', occurredAt: at(10, 0), payload: { sessionID: 'focus-1' } }];
  const running = { phase: 'focus', sessionID: 'focus-2', startedAt: at(10, 0),
    observedSegmentStartedAt: at(10, 0), targetSeconds: 1800, elapsedSeconds: 0 };
  for (const [timer, now, events] of [
    [{ phase: 'idle' }, at(10, 0), skipped],
    [running, at(10, 0), skipped],
    [{ phase: 'break', startedAt: at(10, 0), observedSegmentStartedAt: at(10, 0), targetSeconds: 1800, elapsedSeconds: 0 }, at(10, 0), []],
    [{ phase: 'idle' }, at(10, 30), skipped],
    [{ phase: 'idle' }, at(11, 0), skipped],
  ]) {
    const blocks = forecast(plan, actual, timer, now, events);
    assert.deepEqual(blocks.filter(item => item.kind === 'meeting').map(item => [item.start, item.end]), [[meeting.start, meeting.end]]);
    assert.ok(blocks.filter(item => item.forecast && item.kind !== 'meeting')
      .every(item => Date.parse(item.end) <= Date.parse(meeting.start) || Date.parse(item.start) >= Date.parse(meeting.end)));
  }
});

test('a due break waits until a meeting ends and keeps its configured length', () => {
  const at = (hour, minute, second = 0) => new Date(2026, 9, 26, hour, minute, second).toISOString();
  const plan = { start: at(9, 30), end: at(17, 0), focusMinutes: 60, breakMinutes: 10,
    meetings: [{ title: 'Planning', start: at(11, 30), end: at(12, 0) }] };
  const actual = [{ kind: 'focus', start: at(11, 6, 9), end: at(11, 53, 18), observedSeconds: 2829 }];
  const blocks = forecast(plan, actual, { phase: 'idle' }, at(11, 54));
  const upcomingBreak = blocks.find(item => item.kind === 'break' && item.forecast);
  assert.deepEqual([upcomingBreak.start, upcomingBreak.end], [at(12, 0), at(12, 10)]);
  assert.deepEqual(blocks.filter(item => item.kind === 'meeting').map(item => [item.start, item.end]),
    [[at(11, 30), at(12, 0)]]);
});

test('a scheduled meeting uses a live working countdown without a prep state', () => {
  const { core } = temporaryCore();
  const real = new Date();
  const at = (hour, minute) => new Date(real.getFullYear(), real.getMonth(), real.getDate(), hour, minute).toISOString();
  core.action('wall-jump', (Date.parse(at(13, 50)) - real.getTime()) / 60000);
  core.action('save-plan', { start: at(9, 0), end: at(17, 0), focusMinutes: 60, breakMinutes: 10,
    meetings: [{ title: 'IC SDLC', start: at(14, 0), end: at(15, 0) }] });
  const before = core.status();
  assert.notEqual(before.todaySituation, 'meetingSoon');
  assert.doesNotMatch(before.guidance.detail, /get ready/i);
  core.action('advance', 10);
  const during = core.status();
  assert.equal(during.phase, 'idle');
  assert.equal(during.todaySituation, 'working');
  assert.equal(during.todayTitle, 'IC SDLC');
  assert.equal(during.guidance.action.type, 'working');
  assert.equal(during.countdown, '60:00');
  core.action('advance', 0.5);
  assert.equal(core.status().countdown, '59:30');
  core.action('advance', 14.5);
  assert.ok(core.status().workingMinutesToday >= 15);
  assert.equal(core.status().focusMinutesToday, 0);
  core.close();
});

test('a focus timer that becomes due at a meeting waits to show the break prompt', () => {
  const { core } = temporaryCore();
  const real = new Date();
  const at = (hour, minute) => new Date(real.getFullYear(), real.getMonth(), real.getDate(), hour, minute).toISOString();
  core.action('wall-jump', (Date.parse(at(13, 30)) - real.getTime()) / 60000);
  core.action('save-plan', { start: at(9, 0), end: at(17, 0), focusMinutes: 60, breakMinutes: 10,
    meetings: [{ title: 'IC SDLC', start: at(14, 0), end: at(15, 0) }] });
  core.action('start-focus', { targetSeconds: 30 * 60 });
  core.action('advance', 30);
  const during = core.status();
  assert.equal(during.breakDue, true);
  assert.equal(during.todaySituation, 'working');
  assert.equal(during.countdown, '60:00');
  core.action('advance', 60);
  assert.notEqual(core.status().todaySituation, 'working');
  assert.match(core.status().todayTitle, /break/i);
  core.close();
});

test('forecast presents one continuous break before consecutive meetings', () => {
  const at = (hour, minute) => new Date(2026, 9, 23, hour, minute).toISOString();
  const plan = { start: at(9, 0), end: at(17, 0), focusMinutes: 60, breakMinutes: 10,
    meetings: [['12:45', '13:00'], ['13:00', '14:00'], ['14:00', '15:00']].map(([start, end]) => ({
      start: at(...start.split(':').map(Number)), end: at(...end.split(':').map(Number)), title: 'Meeting',
    })) };
  const actual = [{ kind: 'focus', start: at(11, 20), end: at(12, 20), observedSeconds: 3600 }];
  const blocks = forecast(plan, actual, { phase: 'idle' }, at(12, 30));
  const future = blocks.filter(item => item.forecast);
  assert.deepEqual(future.slice(0, 4).map(item => [item.kind, item.start, item.end]), [
    ['break', at(12, 30), at(12, 45)],
    ['meeting', at(12, 45), at(13, 0)],
    ['meeting', at(13, 0), at(14, 0)],
    ['meeting', at(14, 0), at(15, 0)],
  ]);
});

test('a past meeting contributes to break pacing while untracked gaps do not', () => {
  const at = (hour, minute) => new Date(2026, 9, 21, hour, minute).toISOString();
  const base = { start: at(9, 0), end: at(17, 0), focusMinutes: 60, breakMinutes: 10 };
  const actual = [
    { kind: 'focus', start: at(9, 0), end: at(10, 0), observedSeconds: 3600 },
    { kind: 'break', start: at(10, 0), end: at(10, 10), confirmed: true, observedSeconds: 600 },
    { kind: 'focus', start: at(12, 20), end: at(12, 55), observedSeconds: 2100 },
  ];
  const withoutMeeting = forecast({ ...base, meetings: [] }, actual, { phase: 'idle' }, at(13, 20));
  assert.equal(withoutMeeting.find(item => item.forecast).kind, 'focus');
  const withMeeting = forecast({ ...base, meetings: [{ start: at(13, 0), end: at(13, 15), title: 'Sync' }] }, actual, { phase: 'idle' }, at(13, 20));
  assert.equal(withMeeting.find(item => item.forecast && Date.parse(item.end) > Date.parse(at(13, 20))).kind, 'break');
});

test('a long break before a short meeting leads into focus afterward', () => {
  const at = (hour, minute) => new Date(2026, 9, 20, hour, minute).toISOString();
  const plan = { start: at(9, 0), end: at(17, 0), focusMinutes: 60, breakMinutes: 10,
    meetings: [{ start: at(14, 0), end: at(14, 30), title: '1:1' }] };
  const actual = [{ kind: 'focus', start: at(12, 5), end: at(12, 55), observedSeconds: 3000 }];
  const future = forecast(plan, actual, { phase: 'idle' }, at(13, 35)).filter(item => item.forecast);
  assert.deepEqual(future.slice(0, 3).map(item => item.kind), ['break', 'meeting', 'focus']);
  assert.equal(future[0].end, at(14, 0));
  assert.equal(future[2].start, at(14, 30));
});

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
  assert.equal(status.dayPlans[status.todayKey].current, undefined);
  assert.equal(status.defaultDayPath.start, status.dayStart);
  assert.equal(status.defaultDayPath.end, status.dayEnd);
  assert.ok(status.defaultDayPath.timeline.some(block => block.kind === 'focus'));
  assert.ok(status.defaultDayPath.timeline.some(block => block.kind === 'break'));
  assert.equal(status.events.length, 0);
  const updated = core.action('save-preferences', { startTime: '08:30', endTime: '16:45', focusMinutes: 35, breakMinutes: 5 });
  assert.equal(new Date(updated.defaultDayPath.start).getHours(), 8);
  assert.equal(new Date(updated.defaultDayPath.start).getMinutes(), 30);
  assert.equal(new Date(updated.defaultDayPath.end).getHours(), 16);
  assert.equal(updated.defaultDayPath.timeline[0].kind, 'focus');
  assert.equal(updated.events.length, 0);
  const now = new Date();
  const midmorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);
  core.action('wall-jump', (midmorning - now) / 60000);
  const started = core.action('start-focus');
  assert.equal(started.defaultDayPath, null);
  assert.equal(started.dayPlans[started.todayKey].current.provenance, 'generated-default');
  core.close();
});

test('a removed Room route returns to Today', () => {
  const { core } = temporaryCore();
  assert.equal(core.action('navigate', 'history').page, 'history');
  assert.equal(core.action('navigate', 'room').page, 'today');
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

test('skipping a due break continues one focus session without moving a meeting', () => {
  const { core } = temporaryCore();
  const real = new Date(), day = new Date(real.getFullYear(), real.getMonth(), real.getDate());
  const at = (hour, minute) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
  core.action('wall-jump', (Date.parse(at(9, 30)) - real.getTime()) / 60000);
  const meeting = { title: 'Check-in', start: at(10, 45), end: at(11, 15) };
  core.action('save-plan', { start: at(9, 0), end: at(12, 0), focusMinutes: 60, breakMinutes: 10, meetings: [meeting] });
  const started = core.action('start-focus');
  const due = core.action('advance', 60);
  assert.equal(due.breakDue, true);
  const skipped = core.action('skip-break');
  assert.equal(skipped.phase, 'focus');
  assert.equal(skipped.timer.sessionID, started.timer.sessionID);
  assert.equal(skipped.timer.startedAt, started.timer.startedAt);
  assert.equal(skipped.breakDue, false);
  assert.ok(Math.abs(skipped.timer.targetSeconds - skipped.timer.elapsedSeconds - 3600) < 0.1);
  assert.ok(skipped.timer.remainingSeconds > 3500);
  assert.equal(skipped.events.filter(event => event.kind === 'focusEnded').length, 0);
  assert.equal(skipped.events.filter(event => event.kind === 'breakSkipped').length, 1);
  const recovered = Timer.recover(skipped.events, { wall: new Date(skipped.currentWallTimeISO), monotonicSeconds: 0 });
  assert.equal(recovered.state.sessionID, started.timer.sessionID);
  assert.equal(recovered.state.targetSeconds, skipped.timer.targetSeconds);
  assert.deepEqual(skipped.forecastTimeline.filter(item => item.kind === 'meeting').map(item => [item.start, item.end]),
    [[meeting.start, meeting.end]]);
  const later = core.action('advance', 25);
  assert.equal(later.timer.sessionID, started.timer.sessionID);
  assert.equal(later.phase, 'focus');
  assert.deepEqual(later.forecastTimeline.filter(item => item.kind === 'meeting').map(item => [item.start, item.end]),
    [[meeting.start, meeting.end]]);
  assert.deepEqual(later.dayPlans[later.todayKey].current.meetings.map(item => [item.start, item.end]),
    [[meeting.start, meeting.end]]);
  const ended = core.action('start-break');
  assert.equal(ended.events.filter(event => event.kind === 'focusEnded').length, 1);
  assert.equal(ended.events.find(event => event.kind === 'focusEnded').payload.sessionID, started.timer.sessionID);
  assert.equal(ended.actualTimeline.filter(item => item.kind === 'focus').length, 1);
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
  assert.ok(resumed.returnPrompt);
  assert.equal(resumed.forecastTimeline.some(block => block.active), false);
  const confirmed = core.action('confirm-return');
  const pausedEnd = Math.max(...paused.actualTimeline.filter(block => block.kind === 'focus').map(block => Date.parse(block.end)));
  assert.ok(confirmed.forecastTimeline.some(block => block.active && Date.parse(block.start) >= pausedEnd));
  core.close();
});

test('a spontaneous ten-minute absence is an inferred break and resets break pacing', () => {
  const { core, dbPath } = temporaryCore();
  const real = new Date();
  const morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9, 28);
  core.action('wall-jump', (morning - real) / 60000);
  core.action('save-plan', { start: new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9).toISOString(),
    end: new Date(real.getFullYear(), real.getMonth(), real.getDate(), 12).toISOString(),
    focusMinutes: 60, breakMinutes: 10 });
  const started = core.action('start-focus');
  core.action('advance', 40);
  core.action('away');
  core.action('advance', 10);
  const prompt = core.action('return');
  assert.ok(prompt.returnPrompt);
  const returned = core.action('confirm-return');
  const inferred = returned.actualTimeline.find(item => item.kind === 'break' && item.inferred);
  assert.ok(inferred);
  assert.ok(inferred.observedSeconds >= 9 * 60);
  assert.equal(returned.phase, 'focus');
  assert.notEqual(returned.timer.sessionID, started.timer.sessionID);
  assert.ok(returned.breakMinutesToday >= 9);
  assert.equal(Date.parse(returned.events.find(item => item.kind === 'focusEnded').occurredAt), Date.parse(inferred.start));
  const upcomingBreak = returned.forecastTimeline.find(item => item.kind === 'break' && item.forecast);
  assert.ok(Date.parse(upcomingBreak.start) - Date.parse(inferred.end) >= 55 * 60000);
  const active = core.action('advance', 2);
  assert.ok(active.actualTimeline.some(item => item.kind === 'focus' && item.inProgress && item.observedSeconds >= 119));
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.ok(reopened.status().actualTimeline.some(item => item.kind === 'break' && item.inferred));
  reopened.close();
});

test('short away time remains a break but does not reset the focus cycle', () => {
  const { core } = temporaryCore();
  const started = core.action('start-focus');
  core.action('away');
  core.action('advance', 2);
  core.action('return');
  const returned = core.action('confirm-return');
  assert.equal(returned.timer.sessionID, started.timer.sessionID);
  assert.ok(returned.actualTimeline.some(item => item.kind === 'break' && item.inferred));
  core.close();
});

test('continued activity ends an inferred break at the first return and credits the next focus minute', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9, 0);
  const first = core.action('start-focus');
  core.action('away');
  core.action('advance', 10);
  const prompted = core.action('return');
  const returnedAt = prompted.returnPrompt.since;
  assert.equal(prompted.phase, 'focus');
  assert.equal(prompted.inferredBreakActive, true);
  assert.equal(prompted.actualTimeline.find(item => item.inferred)?.observedSeconds >= 600, true);
  assert.equal(prompted.forecastTimeline.some(item => item.forecast && item.kind === 'focus'), false);
  const resumed = core.action('advance', 1);
  assert.equal(resumed.returnPrompt, null);
  assert.equal(resumed.inferredBreakActive, false);
  assert.notEqual(resumed.timer.sessionID, first.timer.sessionID);
  assert.equal(resumed.events.find(item => item.kind === 'awayEnded').occurredAt, returnedAt);
  assert.ok(resumed.timer.elapsedSeconds >= 60);
  core.close();
});

test('an activity lapse stops automatic return until activity continues again', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9, 0);
  core.action('start-focus'); core.action('away'); core.action('advance', 10);
  core.action('return');
  core.action('advance', .5);
  assert.ok(core.status().returnPrompt);
  core.action('tick', 20);
  assert.ok(core.status().returnPrompt);
  assert.equal(core.status().returnPrompt.activeSeconds, 0);
  core.action('advance', 1);
  assert.equal(core.status().inferredBreakActive, true);
  core.action('return');
  assert.ok(core.status().returnPrompt);
  core.action('keep-break');
  assert.equal(core.status().returnPrompt, null);
  assert.equal(core.action('confirm-return').inferredBreakActive, false);
  core.close();
});

test('sleep time becomes a live inferred break, including across restart', () => {
  const { core, dbPath } = temporaryCore();
  setLocalClock(core, 9, 0);
  core.action('start-focus');
  core.action('sleep');
  core.action('advance', 20);
  const sleeping = core.status();
  assert.equal(sleeping.inferredBreakActive, true);
  assert.ok(sleeping.breakMinutesToday >= 20);
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().inferredBreakActive, true);
  assert.equal(reopened.status().suspended, true);
  setLocalClock(reopened, 10, 0);
  const returned = reopened.action('return');
  assert.ok(returned.returnPrompt);
  const focusing = reopened.action('confirm-return');
  assert.equal(focusing.inferredBreakActive, false);
  assert.ok(focusing.actualTimeline.some(item => item.inferred && item.observedSeconds >= 20 * 60));
  reopened.close();
});

test('lock time becomes an inferred break after return', () => {
  const { core } = temporaryCore();
  core.action('start-focus');
  core.action('lock');
  core.action('advance', 10);
  core.action('unlock');
  assert.equal(core.status().inferredBreakActive, true);
  core.action('return');
  const focusing = core.action('confirm-return');
  assert.ok(focusing.actualTimeline.some(item => item.inferred && item.observedSeconds >= 10 * 60));
  core.close();
});

test('sleep includes idle time just before the Mac suspended', () => {
  const { core } = temporaryCore();
  core.action('start-focus');
  core.action('advance', 2);
  const sleeping = core.action('sleep', 60);
  assert.ok(sleeping.actualTimeline.some(item => item.inferred && item.observedSeconds >= 59));
  core.close();
});

test('a started break counts sleep across a same-day restart', () => {
  const { core, dbPath } = temporaryCore();
  core.action('wall-jump', -30);
  core.action('start-break');
  core.action('sleep');
  core.action('advance', 20);
  assert.ok(core.status().breakMinutesToday >= 20);
  assert.ok(core.status().actualTimeline.some(item => item.kind === 'break' && item.inProgress && item.observedSeconds >= 20 * 60));
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().phase, 'break');
  reopened.action('return');
  const focusing = reopened.action('confirm-return');
  assert.ok(focusing.actualTimeline.some(item => item.kind === 'break' && item.confirmed && item.observedSeconds >= 29 * 60));
  reopened.close();
});

test('an explicit break automatically ends after sustained return activity', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9, 0);
  core.action('start-focus'); core.action('start-break');
  core.action('away'); core.action('advance', 4);
  const prompt = core.action('return');
  assert.equal(prompt.returnPrompt.kind, 'started');
  const firstActivityAt = prompt.returnPrompt.since;
  const focusing = core.action('advance', 1);
  assert.equal(focusing.phase, 'focus');
  assert.equal(focusing.events.find(item => item.kind === 'breakEnded').occurredAt, firstActivityAt);
  assert.ok(focusing.actualTimeline.some(item => item.kind === 'break' && item.confirmed && item.observedSeconds >= 3 * 60));
  assert.ok(focusing.timer.elapsedSeconds >= 60);
  core.close();
});

test('profile settings import once into SQLite and do not change an existing day plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-settings-test-'));
  const dbPath = join(directory, 'events.sqlite');
  const legacyPath = join(directory, 'preferences-testing.json');
  writeFileSync(legacyPath, JSON.stringify({ focusMinutes: 40, breakMinutes: 10, notificationsEnabled: false }));
  const core = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(core.status().defaultFocusLength, 40);
  assert.equal(core.status().activityDelaySeconds, 5);
  assert.equal(core.status().notificationsEnabled, false);
  const initial = core.status();
  core.action('save-plan', { dayStart: initial.dayStart, dayEnd: initial.dayEnd, focusLength: 25, breakLength: 5 });
  const saved = core.action('save-preferences', { focusLength: 50, breakLength: 15, notificationsEnabled: true, activityDelaySeconds: 30 });
  assert.equal(saved.defaultFocusLength, 50);
  assert.equal(saved.activityDelaySeconds, 30);
  assert.equal(saved.focusLength, 25);
  core.close();
  assert.equal(JSON.parse(readFileSync(legacyPath)).focusMinutes, 40);
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().defaultFocusLength, 50);
  assert.equal(reopened.status().focusLength, 25);
  assert.equal(reopened.status().notificationsEnabled, true);
  assert.equal(reopened.status().activityDelaySeconds, 30);
  assert.throws(() => reopened.action('save-preferences', { activityDelaySeconds: 0 }), /activity delay/);
  reopened.close();
});

test('normal profiles default activity delay to two minutes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-activity-default-'));
  const core = createCore({ dbPath: join(directory, 'events.sqlite'), profile: 'personal' });
  assert.equal(core.status().activityDelaySeconds, 120);
  core.close();
});

test('saved day bounds apply to new plans without changing an existing plan', () => {
  const { dbPath, core } = temporaryCore();
  const originalStart = core.status().dayStart;
  core.action('save-plan', {});
  const saved = core.action('save-preferences', { startTime: '08:30', endTime: '16:45' });
  assert.equal(saved.defaultStartTime, '08:30');
  assert.equal(saved.defaultEndTime, '16:45');
  assert.equal(saved.dayStart, originalStart);
  const tomorrow = saved.tomorrowKey;
  const plan = core.action('save-plan', { dayKey: tomorrow }).dayPlans[tomorrow].current;
  assert.equal(new Date(plan.start).getHours(), 8);
  assert.equal(new Date(plan.start).getMinutes(), 30);
  assert.equal(new Date(plan.end).getHours(), 16);
  assert.equal(new Date(plan.end).getMinutes(), 45);
  assert.throws(() => core.action('save-preferences', { startTime: '09:10' }), /15-minute/);
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().defaultStartTime, '08:30');
  assert.equal(reopened.status().defaultEndTime, '16:45');
  reopened.close();
});

test('new day bounds stay between 7 AM and 9 PM in 15-minute steps', () => {
  const { core } = temporaryCore();
  const wall = new Date(core.status().currentWallTimeISO);
  const at = (hour, minute = 0) => new Date(wall.getFullYear(), wall.getMonth(), wall.getDate(), hour, minute).toISOString();
  assert.match(core.action('save-plan', { start: at(6, 45), end: at(17) }).statusMessage, /7:00 AM/);
  assert.match(core.action('save-plan', { start: at(7), end: at(21, 15) }).statusMessage, /9:00 PM/);
  assert.match(core.action('save-plan', { start: at(7, 10), end: at(21) }).statusMessage, /15-minute/);
  const valid = core.action('save-plan', { start: at(7), end: at(21) });
  assert.equal(valid.dayPlans[valid.todayKey].baseline.start, at(7));
  assert.equal(valid.dayPlans[valid.todayKey].baseline.end, at(21));
  assert.throws(() => core.action('save-preferences', { startTime: '06:45' }), /7:00 AM/);
  assert.throws(() => core.action('save-preferences', { endTime: '21:15' }), /9:00 PM/);
  core.close();
});

test('focus and confirmed break grant once and persist after restart', () => {
  const { dbPath, statusPath, core } = temporaryCore();
  setLocalClock(core, 9, 0);
  core.action('start-focus'); core.action('advance', 60);
  assert.equal(core.status().breakDue, true);
  core.action('start-break');
  core.action('advance', 10); core.action('finish-break');
  assert.equal(core.status().balance, 35);
  assert.equal(core.status().todayAcornsEarned, 35);
  assert.deepEqual(core.status().todayRewardEntries.map(entry => [entry.activity, entry.amount]),
    [['Completed break', 10], ['Focus session', 25]]);
  assert.deepEqual(core.status().unlockedItems, []);
  assert.equal(core.action('purchase', 'plant').balance, 0);
  assert.equal(core.status().todayAcornsEarned, 35);
  assert.deepEqual(core.status().unlockedItems, ['plant']);
  assert.equal(core.action('purchase', 'plant').balance, 0);
  assert.ok(existsSync(statusPath));
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().balance, 0);
  assert.deepEqual(reopened.status().unlockedItems, ['plant']);
  reopened.close();
});

test('today acorns count grants on the local day separately from balance and purchases', () => {
  const { dbPath, core } = temporaryCore();
  core.close();
  const database = openStore(dbPath);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  database.append('rewardGranted', { amount: 12, reason: 'focus' }, { occurredAt: yesterday });
  database.append('rewardGranted', { amount: 3, reason: 'focus' }, { occurredAt: today });
  database.append('rewardDebited', { amount: -5, reason: 'purchase:plant' }, { occurredAt: today });
  database.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const snapshot = reopened.status();
  assert.equal(snapshot.balance, 10);
  assert.equal(snapshot.todayAcornsEarned, 3);
  assert.deepEqual(snapshot.todayRewardEntries.map(entry => [entry.activity, entry.amount]), [['Focus session', 3]]);
  reopened.close();
});

test('overdue focus and break keep counting, and finishing the break starts focus', () => {
  const { core } = temporaryCore();
  const firstFocus = core.action('start-focus');
  const overdueFocus = core.action('advance', 61);
  assert.equal(overdueFocus.phase, 'focus');
  assert.match(overdueFocus.countdown, /^-01:0[0-2]$/);
  const resting = core.action('start-break');
  assert.ok(resting.actualTimeline.find(item => item.kind === 'focus').observedSeconds >= 61 * 60);
  const overdueBreak = core.action('advance', 12);
  assert.equal(overdueBreak.phase, 'break');
  assert.equal(overdueBreak.timer.isDue, true);
  assert.match(overdueBreak.countdown, /^-02:0[0-2]$/);
  assert.equal(overdueBreak.forecastTimeline.some(item => item.forecast && item.kind === 'focus'), false);
  const finished = core.action('finish-break');
  assert.equal(finished.phase, 'focus');
  assert.notEqual(finished.timer.sessionID, firstFocus.timer.sessionID);
  assert.equal(finished.timer.targetSeconds, finished.focusLength * 60);
  assert.ok(finished.timer.remainingSeconds > 59 * 60);
  assert.ok(finished.actualTimeline.find(item => item.kind === 'break').observedSeconds >= 12 * 60);
  assert.deepEqual(finished.events.filter(event => ['breakConfirmed', 'breakEnded', 'focusStarted'].includes(event.kind)).slice(-3)
    .map(event => event.kind), ['breakConfirmed', 'breakEnded', 'focusStarted']);
  core.close();
});

test('a sleeping break resumes with its full elapsed time, including overtime', () => {
  const timer = new Timer();
  const at = seconds => ({ wall: new Date(2026, 0, 1, 9, 0, seconds), monotonicSeconds: seconds });
  timer.start('break', 600, at(0));
  timer.pauseForSleep(at(60));
  assert.deepEqual(timer.resumeFromSleep(at(780)), ['breakComplete']);
  assert.equal(timer.state.elapsedSeconds, 780);
  assert.equal(timer.remainingSeconds, -180);
});

test('computer inactivity does not pause a running break', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cozy-idle-break-')), 'events.sqlite');
  const core = createCore({ dbPath, profile: 'testing', development: false });
  core.action('start-break');
  core.action('tick', 120);
  assert.equal(core.status().phase, 'break');
  assert.equal(core.status().timer.isSleeping, false);
  core.action('tick', 0);
  assert.equal(core.status().phase, 'break');
  core.close();
});

test('taking a due break starts the full configured timer after the forecast break begins', () => {
  const { core } = temporaryCore();
  const real = new Date();
  const morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9, 0);
  const end = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 17, 0);
  core.action('wall-jump', (morning - real) / 60000);
  core.action('save-plan', { start: morning.toISOString(), end: end.toISOString(), focusMinutes: 60, breakMinutes: 10 });
  core.action('start-focus');
  core.action('advance', 60);
  core.action('advance', 0.5);
  assert.equal(core.status().breakDue, true);
  assert.equal(core.status().guidance.breakAction?.type, 'rest');
  const started = core.action('today-break');
  assert.equal(started.phase, 'break');
  assert.equal(started.timerTargetSeconds, 600);
  assert.ok(started.forecastTimeline.some(item => item.kind === 'break' && item.active &&
    Date.parse(item.end) - Date.parse(item.start) >= 600000));
  core.action('advance', 10);
  const finished = core.action('finish-break');
  assert.ok(finished.breakMinutesToday >= 10);
  core.close();
});

test('a long break starts for 30 minutes without changing the usual break length', () => {
  const { dbPath, core } = temporaryCore();
  const focused = core.action('start-focus');
  const resting = core.action('start-long-break');
  assert.equal(resting.phase, 'break');
  assert.equal(resting.timerTargetSeconds, 1800);
  assert.equal(resting.countdown, '30:00');
  assert.equal(resting.breakLength, 10);
  assert.equal(resting.defaultBreakLength, 10);
  assert.equal(resting.events.filter(event => event.kind === 'focusEnded').at(-1).payload.sessionID, focused.timer.sessionID);
  core.close();

  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().timer.sessionID, resting.timer.sessionID);
  assert.equal(reopened.status().timerTargetSeconds, 1800);
  const finished = reopened.action('finish-break');
  assert.equal(finished.phase, 'focus');
  assert.equal(finished.timerTargetSeconds, 3600);
  assert.equal(finished.events.filter(event => event.kind === 'breakConfirmed').at(-1).payload.targetSeconds, 1800);
  reopened.close();
});

test('same-day relaunch resumes the same focus session without crediting the closed gap', () => {
  const { dbPath, statusPath, core } = temporaryCore();
  assert.equal(core.status().phase, 'idle');
  core.action('wall-jump', -2);
  core.action('start-focus');
  core.action('advance', 2);
  const before = core.status();
  core.close();

  const reopened = createCore({ dbPath, statusPath, profile: 'testing', development: true });
  const after = reopened.status();
  assert.equal(after.phase, 'focus');
  assert.equal(after.timer.sessionID, before.timer.sessionID);
  assert.ok(Math.abs(after.timer.elapsedSeconds - before.timer.elapsedSeconds) < 1);
  assert.equal(after.events.filter(event => event.kind === 'focusEnded').length, 0);
  assert.equal(after.events.filter(event => event.kind === 'focusStarted').length, 1);
  assert.equal(after.events.filter(event => event.kind === 'focusPaused').length, 1);
  assert.equal(after.events.filter(event => event.kind === 'focusResumed').at(-1).payload.sessionID, before.timer.sessionID);
  assert.ok(after.actualTimeline.some(item => item.kind === 'focus' && !item.inProgress && item.observedSeconds > 119));
  assert.equal(after.balance, 0);
  assert.equal(JSON.parse(readFileSync(statusPath, 'utf8')).phase, 'focus');
  reopened.close();

  const nextLaunch = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(nextLaunch.status().timer.sessionID, before.timer.sessionID);
  assert.equal(nextLaunch.status().events.filter(event => event.kind === 'focusEnded').length, 0);
  nextLaunch.close();
});

test('same-day relaunch resumes an unfinished break without confirming it', () => {
  const { dbPath, core } = temporaryCore();
  core.action('start-break');
  const before = core.status();
  core.close();

  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const after = reopened.status();
  assert.equal(after.phase, 'break');
  assert.equal(after.timer.sessionID, before.timer.sessionID);
  assert.equal(after.events.filter(event => event.kind === 'breakEnded').length, 0);
  assert.equal(after.events.filter(event => event.kind === 'breakConfirmed').length, 0);
  assert.equal(after.balance, 0);
  reopened.close();
});

test('relaunch recovers a focus left open by the previous app version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-legacy-restart-'));
  const dbPath = join(directory, 'events.sqlite');
  const database = openStore(dbPath);
  const launch = new Date(), startedAt = new Date(launch.getTime() - 30000), checkpointAt = new Date(launch.getTime() - 20000);
  database.append('focusStarted', { sessionID: 'existing-focus', targetSeconds: 3600 }, { occurredAt: startedAt });
  database.append('focusResumed', { sessionID: 'existing-focus', targetSeconds: 3600, elapsedSeconds: 10 }, { occurredAt: checkpointAt, source: 'system' });
  database.close();

  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const after = reopened.status();
  assert.equal(after.phase, 'focus');
  assert.equal(after.timer.sessionID, 'existing-focus');
  assert.equal(after.timer.elapsedSeconds, 10);
  assert.equal(after.events.filter(event => event.kind === 'focusEnded').length, 0);
  assert.equal(after.events.filter(event => event.kind === 'focusPaused').at(-1).occurredAt, checkpointAt.toISOString());
  assert.ok(after.actualTimeline.some(item => item.kind === 'focus' && !item.inProgress && item.observedSeconds === 10));
  reopened.close();
});

test('an unfinished session from a prior day closes at its last checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cozy-overnight-restart-'));
  const dbPath = join(directory, 'events.sqlite');
  const database = openStore(dbPath);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);
  const checkpoint = new Date(yesterday.getTime() + 120000);
  database.append('focusStarted', { sessionID: 'yesterday-focus', targetSeconds: 3600 }, { occurredAt: yesterday });
  database.append('focusResumed', { sessionID: 'yesterday-focus', targetSeconds: 3600, elapsedSeconds: 120 }, { occurredAt: checkpoint, source: 'system' });
  database.close();

  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const after = reopened.status();
  assert.equal(after.phase, 'idle');
  assert.equal(after.events.filter(event => event.kind === 'focusEnded').at(-1).occurredAt, checkpoint.toISOString());
  assert.equal(after.balance, 2);
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
  assert.equal(actual.actual.find(block => block.kind === 'break' && block.inferred).observedSeconds, 600);
});

test('away time before the first focus session stays away', () => {
  const at = minute => new Date(2026, 0, 5, 9, minute).toISOString();
  const actual = project([
    { kind: 'awayStarted', occurredAt: at(0), payload: {} },
    { kind: 'awayEnded', occurredAt: at(5), payload: {} },
    { kind: 'focusStarted', occurredAt: at(10), payload: { sessionID: 'A' } },
    { kind: 'focusEnded', occurredAt: at(20), payload: { sessionID: 'A', elapsedSeconds: 600 } },
    { kind: 'awayStarted', occurredAt: at(20), payload: {} },
    { kind: 'awayEnded', occurredAt: at(30), payload: {} },
  ], new Date(at(0)), false);
  assert.deepEqual(actual.actual.filter(item => item.kind === 'away').map(item => [item.start, item.end]), [[at(0), at(5)]]);
  assert.deepEqual(actual.actual.filter(item => item.inferred).map(item => [item.start, item.end]), [[at(20), at(30)]]);
});

test('sleep recorded by an older app appears as one inferred break without changing events', () => {
  const at = minute => new Date(2026, 0, 5, 9, minute).toISOString();
  const focus = [
    { kind: 'focusStarted', occurredAt: at(0), payload: { sessionID: 'A' } },
    { kind: 'focusPaused', occurredAt: at(10), payload: { sessionID: 'A', elapsedSeconds: 600 } },
    { kind: 'sleepStarted', occurredAt: at(10), payload: { sessionID: 'A' } },
    { kind: 'sleepEnded', occurredAt: at(30), payload: { sessionID: 'A' } },
    { kind: 'focusResumed', occurredAt: at(30), payload: { sessionID: 'A', elapsedSeconds: 600 } },
    { kind: 'focusEnded', occurredAt: at(40), payload: { sessionID: 'A', elapsedSeconds: 1200 } },
  ];
  const legacy = project(focus, new Date(at(0)), false);
  assert.deepEqual(legacy.actual.filter(item => item.inferred).map(item => [item.start, item.end]), [[at(10), at(30)]]);
  assert.equal(legacy.breakSeconds, 1200);
  const recordedAway = project([focus[0], focus[1],
    { kind: 'awayStarted', occurredAt: at(10), payload: {} }, ...focus.slice(2, 4),
    { kind: 'awayEnded', occurredAt: at(30), payload: {} }, ...focus.slice(4)], new Date(at(0)), false);
  assert.equal(recordedAway.actual.filter(item => item.inferred).length, 1);
  assert.equal(recordedAway.breakSeconds, 1200);
  const restartedWithoutWakeEvent = project(focus.filter(item => item.kind !== 'sleepEnded'), new Date(at(0)), false);
  assert.deepEqual(restartedWithoutWakeEvent.actual.filter(item => item.inferred).map(item => [item.start, item.end]), [[at(10), at(30)]]);
});

test('away and sleep inside a confirmed break do not cover it with gray time', () => {
  const at = minute => new Date(2026, 0, 5, 9, minute).toISOString();
  const events = [
    { kind: 'breakStarted', occurredAt: at(0), payload: { sessionID: 'B', targetSeconds: 600 } },
    { kind: 'awayStarted', occurredAt: at(8), payload: { reason: 'idle' } },
    { kind: 'sleepStarted', occurredAt: at(18), payload: { sessionID: 'B' } },
    { kind: 'sleepEnded', occurredAt: at(45), payload: { sessionID: 'B' } },
    { kind: 'awayEnded', occurredAt: at(45), payload: {} },
    { kind: 'breakConfirmed', occurredAt: at(56), payload: { sessionID: 'B' } },
    { kind: 'breakEnded', occurredAt: at(56), payload: { sessionID: 'B', elapsedSeconds: 3360 } },
  ];
  const actual = project(events, new Date(at(0)), false);
  assert.deepEqual(actual.actual.map(item => [item.kind, item.start, item.end]), [['break', at(0), at(56)]]);
  assert.equal(actual.breakSeconds, 3360);
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

test('snoozing a due break for a chosen interval extends focus before the configured break', () => {
  const { core } = temporaryCore();
  const real = new Date(), morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9);
  core.action('wall-jump', (morning.getTime() - real.getTime()) / 60000);
  core.action('save-plan', { start: morning.toISOString(), end: new Date(morning.getTime() + 4 * 3600000).toISOString(), focusMinutes: 60, breakMinutes: 10 });
  core.action('start-focus');
  core.action('advance', 60);
  const snoozed = core.action('snooze-break', { minutes: 15 });
  assert.ok(Math.abs(Date.parse(snoozed.forecastTimeline.find(item => item.active).end) -
    Date.parse(snoozed.currentWallTimeISO) - 15 * 60000) < 1000);
  assert.equal(snoozed.phase, 'focus');
  assert.equal(snoozed.breakDue, false);
  assert.ok(snoozed.countdown.startsWith('15:'));
  core.action('advance', 15);
  const resting = core.action('start-break');
  assert.equal(resting.timerTargetSeconds, 10 * 60);
  assert.equal(resting.forecastTimeline.find(item => item.active).kind, 'break');
  core.close();
});

test('snoozing an idle break starts a short focus session without changing the plan', () => {
  const { core } = temporaryCore();
  const real = new Date(), morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 9);
  core.action('wall-jump', (morning.getTime() - real.getTime()) / 60000);
  core.action('save-plan', { start: morning.toISOString(), end: new Date(morning.getTime() + 4 * 3600000).toISOString(), focusMinutes: 60, breakMinutes: 10 });
  core.action('start-focus'); core.action('advance', 60);
  const stopped = core.action('end-focus');
  assert.equal(stopped.guidance.situation, 'rest');
  const snoozed = core.action('snooze-break', { minutes: 10 });
  assert.equal(snoozed.guidance.situation, 'runningFocus');
  assert.equal(snoozed.phase, 'focus');
  assert.equal(snoozed.timerTargetSeconds, 10 * 60);
  assert.equal(snoozed.forecastTimeline.find(item => item.active).kind, 'focus');
  assert.equal(snoozed.dayPlans[snoozed.todayKey].revisionCount, 0);
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

function setLocalClock(core, hour, minute = 0) {
  const current = new Date(core.status().currentWallTimeISO);
  const target = new Date(current); target.setHours(hour, minute, 0, 0);
  return core.action('wall-jump', (target - current) / 60000);
}

test('planned finish replaces focus, break, idle, and inferred return guidance with end day', () => {
  for (const phase of ['focus', 'break', 'idle', 'away']) {
    const { core } = temporaryCore();
    setLocalClock(core, 16);
    core.action('start-focus');
    if (phase === 'break') core.action('start-break');
    if (phase === 'idle') core.action('end-focus');
    if (phase === 'away') core.action('away');
    core.action('advance', 60);
    if (phase === 'away') core.action('return');
    const due = core.status();
    assert.equal(due.todaySituation, 'afterDay', phase);
    assert.equal(due.guidance.action.type, 'endDay');
    assert.equal(due.breakDue, false);
    assert.equal(due.returnPrompt, null);
    const ended = core.action('end-day');
    assert.equal(ended.phase, 'idle');
    assert.equal(ended.todaySituation, 'dayEnded');
    assert.equal(ended.inferredBreakActive, false);
    assert.equal(ended.events.filter(event => event.kind === 'dayEnded').length, 1);
    if (phase === 'break') assert.equal(ended.events.filter(event => event.kind === 'breakConfirmed').length, 1);
    core.close();
  }
});

test('end day snooze preserves the plan and active session, persists, and prompts again', () => {
  const { core, dbPath } = temporaryCore();
  setLocalClock(core, 16);
  const started = core.action('start-focus');
  core.action('advance', 60);
  const snoozed = core.action('snooze-end-day', { minutes: 15 });
  assert.equal(snoozed.todaySituation, 'wrappingUp');
  assert.equal(snoozed.timer.sessionID, started.timer.sessionID);
  assert.equal(snoozed.plan.end, started.plan.end);
  assert.equal(snoozed.dayPlans[snoozed.todayKey].revisionCount, 0);
  assert.equal(snoozed.breakDue, false);
  assert.throws(() => core.action('snooze-end-day', { minutes: 7 }), /five-minute/);
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  setLocalClock(reopened, 17, 5);
  assert.equal(reopened.status().dayEndSnoozedUntil, snoozed.dayEndSnoozedUntil);
  assert.equal(reopened.status().todaySituation, 'wrappingUp');
  assert.equal(reopened.action('advance', 11).todaySituation, 'afterDay');
  reopened.close();
});

test('ended day ignores presence and session commands across restart, then resets tomorrow', () => {
  const { core, dbPath, statusPath } = temporaryCore();
  setLocalClock(core, 16);
  core.action('start-focus'); core.action('advance', 60);
  const ended = core.action('end-day');
  assert.ok(ended.focusMinutesToday >= 60);
  assert.equal(JSON.parse(readFileSync(statusPath)).phase, 'idle');
  const eventCount = ended.events.length;
  for (const action of ['away', 'return', 'lock', 'unlock', 'sleep', 'wake', 'sleep-wake', 'start-focus', 'start-break', 'start-long-break', 'finish-break', 'confirm-return', 'end-day']) core.action(action);
  core.action('advance', 10); core.action('tick', 600);
  assert.equal(core.status().events.length, eventCount);
  assert.equal(core.status().workingMinutesToday, ended.workingMinutesToday);
  assert.deepEqual(core.status().actualTimeline, ended.actualTimeline);
  const dayKey = ended.todayKey;
  core.action('save-reflection', { dayKey, note: 'A steady day. Tomorrow, take breaks sooner.' });
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.equal(reopened.status().dayEndedAt, ended.dayEndedAt);
  assert.equal(reopened.status().todayReflection, 'A steady day. Tomorrow, take breaks sooner.');
  assert.equal(reopened.status().phase, 'idle');
  const tomorrow = reopened.action('wall-jump', 24 * 60);
  assert.equal(tomorrow.dayEndedAt, null);
  assert.equal(tomorrow.dayEndSnoozedUntil, null);
  assert.equal(tomorrow.savedReflection, 'A steady day. Tomorrow, take breaks sooner.');
  assert.equal(reopened.action('start-focus').phase, 'focus');
  reopened.close();
});

test('end day and snooze install no state or partial rewards when their transaction fails', () => {
  const { core, dbPath } = temporaryCore();
  setLocalClock(core, 16);
  core.action('start-focus'); core.action('advance', 60);
  const database = new DatabaseSync(dbPath);
  database.exec("CREATE TRIGGER reject_day BEFORE INSERT ON events WHEN NEW.kind IN ('dayEnded', 'dayEndSnoozed') BEGIN SELECT RAISE(ABORT, 'write rejected'); END");
  const before = core.status();
  assert.throws(() => core.action('end-day'), /write rejected/);
  assert.equal(core.status().dayEndedAt, null);
  assert.equal(core.status().phase, 'focus');
  assert.deepEqual(core.status().events, before.events);
  assert.throws(() => core.action('snooze-end-day'), /write rejected/);
  assert.equal(core.status().dayEndSnoozedUntil, null);
  database.exec('DROP TRIGGER reject_day');
  database.close(); core.close();
});
