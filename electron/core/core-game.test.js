// The core's side of the sky-island game: starting it, saving grants, status.game, the check-in
// action, the development scenarios, and the event cache that keeps all of this fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// Every temporary folder a test makes is removed when this test file finishes.
const madeFolders = [];
process.on('exit', () => { for (const folder of madeFolders) rmSync(folder, { recursive: true, force: true }); });
function tempFolder(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  madeFolders.push(folder);
  return folder;
}
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const { createCore } = require('./index');
const { openStore } = require('./store');
const game = require('./game');

function temporaryCore() {
  const directory = tempFolder('cozy-core-game-test-');
  const dbPath = join(directory, 'events.sqlite');
  return { dbPath, core: createCore({ dbPath, profile: 'testing', development: true }) };
}
function setLocalClock(core, hour, minute = 0) {
  const current = new Date(core.status().currentWallTimeISO);
  const target = new Date(current); target.setHours(hour, minute, 0, 0);
  return core.action('wall-jump', (target - current) / 60000);
}
function nextMorning(core) {
  const current = new Date(core.status().currentWallTimeISO);
  const target = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, 9, 0);
  return core.action('wall-jump', (target - current) / 60000);
}
const gameKeys = (status, prefix = 'game:') => status.events.filter(event => event.uniqueKey?.startsWith(prefix)).map(event => event.uniqueKey);
const ofKind = (status, kind) => status.events.filter(event => event.kind === kind);
const localDay = iso => { const date = new Date(iso); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
// One focus session at the plan's length, then a real break; focus starts again by itself.
function focusThenBreak(core) {
  if (core.status().phase === 'idle') core.action('start-focus');
  core.action('advance', core.status().focusLength);
  const resting = core.action('start-break');
  core.action('advance', resting.breakLength);
  return core.action('finish-break');
}

test('the island starts once per database and survives restart', () => {
  const { dbPath, core } = temporaryCore();
  const status = core.status();
  const started = ofKind(status, 'gameStarted');
  assert.equal(started.length, 1);
  assert.equal(started[0].uniqueKey, 'game:started');
  assert.equal(started[0].payload.rulesVersion, game.DEFAULT_RULES.rulesVersion);
  assert.equal(status.game.islands.length, 1);
  assert.equal(status.game.helpers.length, 1);
  assert.equal(status.game.checkIn, null);
  assert.equal(status.game.checkIns, 0);
  core.action('tick'); core.action('navigate', 'history');
  core.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.deepEqual(ofKind(reopened.status(), 'gameStarted').map(event => event.id), [started[0].id]);
  assert.deepEqual(reopened.status().game.islands, status.game.islands);
  reopened.close();
});

test('grants are saved once after focus and once after a real break, even when syncing again', () => {
  const { dbPath, core } = temporaryCore();
  setLocalClock(core, 9);
  const focusID = core.action('start-focus').timer.sessionID;
  const due = core.action('advance', 60);
  assert.deepEqual(gameKeys(due, 'game:grant:'), [], 'a running session earns nothing yet');
  const resting = core.action('start-break');
  const breakID = resting.timer.sessionID;
  assert.deepEqual(gameKeys(resting, 'game:grant:'), [`game:grant:focus:${focusID}`]);
  const focusGrant = resting.events.find(event => event.uniqueKey === `game:grant:focus:${focusID}`);
  assert.equal(focusGrant.payload.source, 'focus');
  assert.equal(focusGrant.payload.dayKey, resting.todayKey);
  assert.ok(focusGrant.payload.amounts.wood > 0 && focusGrant.payload.amounts.stone > 0);
  core.action('advance', 10);
  const back = core.action('finish-break');
  assert.deepEqual(gameKeys(back, 'game:grant:'), [`game:grant:focus:${focusID}`, `game:grant:rest:${breakID}`]);
  const restGrant = back.events.find(event => event.uniqueKey === `game:grant:rest:${breakID}`);
  assert.ok(restGrant.payload.amounts.soil > 0 && restGrant.payload.amounts.saplings > 0);
  assert.equal(restGrant.payload.amounts.starlight, 1, 'an on-plan session followed by a real break earns Starlight');
  assert.ok(Math.abs(restGrant.payload.restMinutes - 10) < 0.1);
  // More saved changes and ticks run the sync again; nothing is written twice.
  core.action('tick'); core.action('tick'); core.action('save-reflection', 'Short walk.'); core.status();
  assert.deepEqual(gameKeys(core.status(), 'game:grant:'), gameKeys(back, 'game:grant:'));
  core.close();
  // Startup runs the sync too.
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  assert.deepEqual(gameKeys(reopened.status(), 'game:grant:'), gameKeys(back, 'game:grant:'));
  assert.equal(ofKind(reopened.status(), 'gameGranted').length, 2);
  reopened.close();
});

test('focus alone brings no check-in card; finishing a break brings one', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  core.action('start-focus'); core.action('advance', 60);
  const ended = core.action('end-focus');
  assert.equal(ended.game.checkIn, null);
  assert.ok(ended.game.waiting.wood > 0, 'focus earnings wait for the next check-in');
  core.action('start-break'); core.action('advance', 10);
  const back = core.action('finish-break');
  const card = back.game.checkIn;
  assert.ok(card);
  assert.equal(card.number, 1);
  assert.equal(typeof card.token, 'string');
  assert.ok(card.collected.wood > 0 && card.collected.soil > 0);
  assert.equal(card.choice.kind, 'job');
  assert.equal(card.choice.helperName, 'Pip');
  assert.ok(card.choice.options.length >= 2);
  core.close();
});

test('the check-in action saves one check-in, ignores a repeated tap, and refuses an old card', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  const card = focusThenBreak(core).game.checkIn;
  const pick = card.choice.options[0].job;
  const collected = core.action('game-check-in', { token: card.token, pick });
  assert.equal(collected.statusMessage, '');
  assert.equal(collected.game.checkIn, null);
  assert.equal(collected.game.checkIns, 1);
  assert.equal(collected.game.helpers[0].job, pick);
  assert.ok(collected.game.onHand.wood > 0);
  assert.deepEqual(gameKeys(collected, 'game:checkin:'), ['game:checkin:1']);
  assert.equal(ofKind(collected, 'gameCheckedIn')[0].payload.picked, pick);
  // A double click sends the same tap again: nothing changes and no error shows.
  const repeated = core.action('game-check-in', { token: card.token, pick });
  assert.equal(repeated.statusMessage, '');
  assert.deepEqual(gameKeys(repeated, 'game:checkin:'), ['game:checkin:1']);
  // With no card waiting, a tap explains itself instead of failing.
  assert.equal(core.action('game-check-in', { token: 'none', pick: null }).statusMessage, 'There is nothing to collect right now.');
  assert.equal(core.action('game-check-in').statusMessage, 'There is nothing to collect right now.');
  // The next break brings a new card. A tap from an old card is refused and the new card stays.
  const next = focusThenBreak(core).game.checkIn;
  assert.ok(next && next.token !== card.token);
  const refused = core.action('game-check-in', { token: 'an-old-card', pick: null });
  assert.equal(refused.statusMessage, 'This card has changed. Please look at it again.');
  assert.equal(refused.game.checkIn.token, next.token);
  const wrongPick = core.action('game-check-in', { token: next.token, pick: 'not-on-the-card' });
  assert.match(wrongPick.statusMessage, next.choice ? /isn't one of the choices/ : /nothing to choose/);
  assert.deepEqual(gameKeys(wrongPick, 'game:checkin:'), ['game:checkin:1']);
  // Collecting without choosing works too.
  const second = core.action('game-check-in', { token: next.token, pick: null });
  assert.equal(second.statusMessage, '');
  assert.equal(second.game.checkIns, 2);
  assert.deepEqual(gameKeys(second, 'game:checkin:'), ['game:checkin:1', 'game:checkin:2']);
  core.close();
});

test('status.game is null while the island cannot start, and the start is retried after the next change', () => {
  const dbPath = join(tempFolder('cozy-core-game-start-'), 'events.sqlite');
  openStore(dbPath).close();
  const database = new DatabaseSync(dbPath);
  database.exec("CREATE TRIGGER reject_game BEFORE INSERT ON events WHEN NEW.kind = 'gameStarted' BEGIN SELECT RAISE(ABORT, 'write rejected'); END");
  const logged = [], original = console.error;
  console.error = (...items) => logged.push(items.join(' '));
  try {
    const core = createCore({ dbPath, profile: 'testing', development: true });
    assert.equal(core.status().game, null);
    core.action('tick'); core.action('tick');
    assert.equal(logged.length, 1, 'the failure is logged once, not every tick');
    setLocalClock(core, 9);
    assert.equal(core.action('start-focus').phase, 'focus', 'the timer keeps working');
    database.exec('DROP TRIGGER reject_game');
    const started = core.action('advance', 1);
    assert.equal(ofKind(started, 'gameStarted').length, 1);
    assert.ok(started.game);
    core.close();
  } finally { console.error = original; database.close(); }
});

test('old acorn rows are ignored by the island', () => {
  const { dbPath, core } = temporaryCore();
  const fresh = core.status().game;
  core.close();
  const database = openStore(dbPath);
  const today = new Date();
  database.append('rewardGranted', { amount: 12, policyVersion: 1, sourceID: 'old-focus', reason: 'focus' }, { occurredAt: today, source: 'system', uniqueKey: 'grant:1:focus:old-focus' });
  database.append('rewardGranted', { amount: 8, policyVersion: 1, sourceID: 'old-break', reason: 'break' }, { occurredAt: today, source: 'system', uniqueKey: 'grant:1:break:old-break' });
  database.append('rewardDebited', { amount: -5, policyVersion: 1, sourceID: 'old-purchase', reason: 'purchase:plant' }, { occurredAt: today, uniqueKey: 'purchase:old-purchase:debit' });
  database.append('itemPurchased', { itemID: 'plant', cost: 5, purchaseID: 'old-purchase' }, { occurredAt: today, uniqueKey: 'purchase:old-purchase:unlock' });
  database.close();
  const reopened = createCore({ dbPath, profile: 'testing', development: true });
  const status = reopened.status();
  assert.deepEqual(status.game.onHand, fresh.onHand);
  assert.deepEqual(status.game.waiting, fresh.waiting);
  assert.equal(status.game.checkIn, null);
  assert.deepEqual(gameKeys(status, 'game:grant:'), []);
  setLocalClock(reopened, 9);
  const back = focusThenBreak(reopened);
  assert.equal(ofKind(back, 'gameGranted').length, 2);
  assert.ok(back.game.checkIn);
  reopened.close();
});

test('the day grant is saved when the day changes, without an End day tap', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  focusThenBreak(core);
  const stopped = core.action('end-focus');
  const day = stopped.todayKey;
  assert.deepEqual(gameKeys(stopped, `game:grant:day:${day}`), []);
  const tomorrow = nextMorning(core);
  assert.notEqual(tomorrow.todayKey, day);
  const dayGrant = tomorrow.events.find(event => event.uniqueKey === `game:grant:day:${day}`);
  assert.ok(dayGrant);
  assert.equal(dayGrant.payload.source, 'day');
  assert.equal(dayGrant.payload.dayKey, day);
  assert.equal(typeof dayGrant.payload.planMatch, 'number');
  core.action('tick');
  assert.equal(gameKeys(core.status(), 'game:grant:day:').length, 1);
  core.close();
});

test('the day grant is saved at End day, and a check-in follows', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  const back = focusThenBreak(core);
  core.action('game-check-in', { token: back.game.checkIn.token, pick: back.game.checkIn.choice.options[0].job });
  core.action('advance', 60);
  const ended = core.action('end-day');
  assert.deepEqual(gameKeys(ended, 'game:grant:day:'), [`game:grant:day:${ended.todayKey}`]);
  assert.ok(ended.game.checkIn, 'the end of the day brings a check-in');
  assert.equal(ended.game.checkIn.number, 2);
  core.close();
});

test('the event cache returns exactly what a full read returns', () => {
  const dbPath = join(tempFolder('cozy-event-cache-'), 'events.sqlite');
  const store = openStore(dbPath);
  assert.deepEqual(store.allEvents(), []);
  const day = new Date(2026, 9, 29);
  store.append('dayPlan', { day: day.toISOString(), dayKey: '2026-10-29', start: new Date(2026, 9, 29, 9).toISOString(),
    end: new Date(2026, 9, 29, 17).toISOString(), meetings: [], focusMinutes: 60, breakMinutes: 10 });
  store.append('focusStarted', { sessionID: 'f1', targetSeconds: 3600, reason: 'manual' });
  assert.deepEqual(store.allEvents(), store.readAllEvents());
  store.transaction(() => {
    store.append('focusEnded', { sessionID: 'f1', targetSeconds: 3600, elapsedSeconds: 3600 });
    store.append('gameGranted', { source: 'focus', sourceID: 'f1', amounts: { wood: 1 } }, { uniqueKey: 'game:grant:focus:f1' });
  });
  assert.deepEqual(store.allEvents(), store.readAllEvents());
  // Rows read inside a transaction that is undone don't stay behind.
  assert.throws(() => store.transaction(() => {
    store.append('breakStarted', { sessionID: 'b1', targetSeconds: 600 });
    assert.equal(store.allEvents().length, 5);
    throw new Error('undo');
  }), /undo/);
  assert.equal(store.allEvents().length, 4);
  assert.deepEqual(store.allEvents(), store.readAllEvents());
  // Rows written by another connection are picked up.
  const other = openStore(dbPath);
  other.append('breakStarted', { sessionID: 'b2', targetSeconds: 600 });
  other.close();
  assert.deepEqual(store.allEvents(), store.readAllEvents());
  // Callers get their own array.
  const copy = store.allEvents();
  copy.pop(); copy.push({ kind: 'not saved' });
  assert.deepEqual(store.allEvents(), store.readAllEvents());
  assert.equal(store.hasUniqueKey('game:grant:focus:f1'), true);
  assert.equal(store.hasUniqueKey('game:grant:focus:nope'), false);
  store.close();
});

test('game-first-break leaves the first check-in waiting with Pip\'s job choice', () => {
  const { dbPath, core } = temporaryCore();
  const status = core.action('scenario', 'game-first-break');
  const local = new Date(status.currentWallTimeISO);
  assert.equal(local.getHours(), 10);
  assert.equal(local.getMinutes(), 10);
  assert.equal(status.phase, 'focus', 'focus starts by itself after the break, as in real use');
  assert.equal(status.page, 'today');
  assert.equal(ofKind(status, 'gameGranted').length, 2);
  assert.equal(status.game.checkIn.number, 1);
  assert.equal(status.game.checkIn.choice.kind, 'job');
  assert.equal(status.game.checkIn.choice.helperName, 'Pip');
  assert.throws(() => core.action('scenario', 'game-first-break'), /fresh island/);
  const reader = openStore(dbPath);
  assert.deepEqual(core.status().events, reader.readAllEvents());
  reader.close();
  core.close();
});

test('game-week plays seven steady days from 9 AM and collects every check-in', () => {
  const { dbPath, core } = temporaryCore();
  const status = core.action('scenario', 'game-week');
  assert.equal(status.game.activeDays, 7);
  assert.equal(status.game.checkIn, null);
  assert.equal(status.game.checkIns, ofKind(status, 'gameCheckedIn').length);
  assert.equal(status.game.checkIns, ofKind(status, 'breakEnded').length + ofKind(status, 'dayEnded').length,
    'one check-in after every break and every day end');
  assert.equal(status.phase, 'idle');
  assert.equal(new Date(status.currentWallTimeISO).getHours(), 9);
  assert.equal(ofKind(status, 'gameGranted').length,
    ofKind(status, 'focusEnded').length + ofKind(status, 'breakConfirmed').length + 7);
  // Sessions stay inside one local day, and each day starts at 9 AM.
  const starts = new Map();
  for (const event of status.events) {
    if (['focusStarted', 'breakStarted'].includes(event.kind)) starts.set(event.payload.sessionID, event.occurredAt);
    if (['focusEnded', 'breakEnded'].includes(event.kind)) assert.equal(localDay(event.occurredAt), localDay(starts.get(event.payload.sessionID)));
  }
  const firstFocus = new Map();
  for (const event of ofKind(status, 'focusStarted')) if (!firstFocus.has(localDay(event.occurredAt))) firstFocus.set(localDay(event.occurredAt), event);
  assert.equal(firstFocus.size, 7);
  for (const event of firstFocus.values()) {
    assert.equal(new Date(event.occurredAt).getHours(), 9);
    assert.equal(event.payload.reason, 'suggestion');
  }
  const reader = openStore(dbPath);
  assert.deepEqual(core.status().events, reader.readAllEvents());
  reader.close();
  core.close();
});

test('game-month plays thirty days quickly', () => {
  const { core } = temporaryCore();
  const began = performance.now();
  const status = core.action('scenario', 'game-month');
  assert.ok(performance.now() - began < 10000, 'well inside the development control timeout');
  assert.equal(status.game.activeDays, 30);
  assert.equal(status.game.checkIn, null);
  assert.ok(status.game.islands.length > 1);
  core.close();
});

// Review fixes, through the real app paths. Each once saved a wrong value for good.

test('a long break ended at 20 minutes is a real break, and its focus session keeps its Starlight', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  core.action('start-focus'); core.action('advance', 60);
  const resting = core.action('start-long-break');
  assert.equal(resting.timer.targetSeconds, 30 * 60);
  core.action('advance', 20);
  const back = core.action('finish-break');
  assert.equal(back.breakMinutesToday, 20);
  const grant = back.events.find(event => event.uniqueKey === `game:grant:rest:${resting.timer.sessionID}`);
  assert.equal(grant.payload.restMinutes, 15);
  assert.equal(grant.payload.amounts.starlight, 1);
  assert.ok(grant.payload.amounts.soil > 0 && grant.payload.amounts.saplings > 0);
  core.close();
});

test('focus that starts by itself and is stopped at once does not use up the day\'s Starlight places', () => {
  const { core } = temporaryCore();
  setLocalClock(core, 9);
  let status = core.action('start-focus');
  const planned = status.plannedTimeline.filter(block => block.kind === 'focus').length;
  assert.ok(planned >= 5);
  const starlight = [];
  for (let i = 0; i < planned; i++) {
    if (i > 0) { core.action('end-focus'); status = core.action('start-focus'); }  // stop the focus that started by itself
    core.action('advance', status.focusLength);
    const resting = core.action('start-break'); core.action('advance', resting.breakLength);
    const back = core.action('finish-break');
    starlight.push(back.events.find(event => event.uniqueKey === `game:grant:rest:${resting.timer.sessionID}`).payload.amounts.starlight || 0);
  }
  assert.deepEqual(starlight, Array(planned).fill(1));
  core.close();
});

test('opening the same history in another time zone writes no second day grant', () => {
  const dbPath = join(tempFolder('cozy-core-game-tz-'), 'events.sqlite');
  const script = `
    const { createCore } = require(${JSON.stringify(join(__dirname, 'index.js'))});
    const [dbPath, step] = process.argv.slice(1);
    const core = createCore({ dbPath, profile: 'testing', development: true });
    const jumpTo = target => core.action('wall-jump', (target - new Date(core.status().currentWallTimeISO)) / 60000);
    if (step === 'work') {
      jumpTo(new Date(2026, 9, 28, 16, 0));
      core.action('start-focus'); core.action('advance', 60); core.action('start-break'); core.action('advance', 10);
      core.action('finish-break'); core.action('end-day');
    } else jumpTo(new Date(2026, 9, 30, 9, 0));
    const grants = core.status().events.filter(event => event.kind === 'gameGranted' && event.payload.source === 'day');
    console.log(JSON.stringify(grants.map(event => event.uniqueKey)));
    core.close();`;
  const run = (zone, step) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', '-e', script, dbPath, step],
    { env: { ...process.env, TZ: zone }, encoding: 'utf8' }).trim().split('\n').at(-1));
  assert.deepEqual(run('Pacific/Auckland', 'work'), ['game:grant:day:2026-10-28']);
  assert.deepEqual(run('America/Los_Angeles', 'reopen'), ['game:grant:day:2026-10-28']);
});
