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
const game = require('./index');
const R = require('./rules');
const { roll, pickOne } = require('./dice');
const MD = require('./made-up-days');
const sim = require('./simulate');
const { openStore, encodePayload, decodePayload } = require('../store');

const PLAN = { focusSessions: 6, focusMinutes: 60, breakMinutes: 10 };

// A small hand-driven history in the shape of the app's saved events.
function setup({ plan = PLAN } = {}) {
  const history = MD.createHistory();
  let clock = Date.UTC(2026, 0, 5, 8, 0), day = 1, counter = 0, lastFocus = null;
  const iso = () => new Date(clock).toISOString();
  const ctx = (extra = {}) => ({ now: iso(), todayKey: MD.dayKeyFor(day), dayKeyOf: MD.dayKeyOf, planFor: () => plan, ...extra });
  const h = {
    history, ctx,
    get events() { return history.events; },
    start() { history.appendRecord(game.startRecord(ctx())); return h; },
    focus(minutes, { target = 60, reason = 'suggestion', id = `f${++counter}` } = {}) {
      history.append('focusStarted', { sessionID: id, targetSeconds: target * 60, reason }, iso());
      clock += minutes * 60000;
      history.append('focusEnded', { sessionID: id, targetSeconds: target * 60, elapsedSeconds: minutes * 60 }, iso());
      lastFocus = id;
      return id;
    },
    rest(minutes, { target = 10, confirm = true, follows = lastFocus, id = `b${++counter}` } = {}) {
      history.append('breakStarted', { sessionID: id, targetSeconds: target * 60, ...(follows ? { followsSessionID: follows } : {}) }, iso());
      clock += minutes * 60000;
      const payload = { sessionID: id, targetSeconds: target * 60, elapsedSeconds: minutes * 60 };
      if (confirm) history.append('breakConfirmed', payload, iso());
      history.append('breakEnded', payload, iso());
      return id;
    },
    away(minutes, { counted = true, follows = lastFocus, target = 10 } = {}) {
      clock += minutes * 60000;
      return history.append('awayEnded', counted ? { reason: 'input resumed', countedAsBreak: true, restSeconds: minutes * 60,
        targetSeconds: target * 60, ...(follows ? { followsSessionID: follows } : {}) } : { reason: 'input resumed' }, iso(), null, 'inferred').id;
    },
    endDay() { history.append('dayEnded', { dayKey: MD.dayKeyFor(day) }, iso()); },
    nextDay() { day += 1; clock = Date.UTC(2026, 0, 4 + day, 8, 0); },
    grants(extra) { const due = game.dueGrants(history.events, ctx(extra)); due.forEach(history.appendRecord); return due; },
    state(extra) { return game.gameState(history.events, ctx(extra)); },
    checkIn(pick = null, extra) {
      const state = h.state(extra);
      const record = game.checkInRecord(history.events, ctx(extra), { token: state.checkIn.token, pick });
      history.appendRecord(record);
      return record;
    },
  };
  return h;
}
const grantFor = (h, key) => h.events.find(e => e.uniqueKey === key);
const { roomProblems } = require('./room-check');
const play = require('./play');

// A bare rules state for unit checks: home only, with plenty on hand. build() saves one building the
// way a check-in would, and island() adds a new island.
function bareState(rules = R.DEFAULT_RULES, land = undefined) {
  const state = play.initialState({ id: 'S', sequence: 1, payload: { rulesVersion: 2, startingLand: land } }, rules);
  Object.assign(state.onHand, { wood: 5000, stone: 5000, planks: 5000, soil: 5000, saplings: 5000 });
  let number = 0;
  const record = extra => ({ number: ++number, collected: {}, landProgress: state.landProgress, newLand: [], ...extra });
  return {
    state,
    build(blueprint, island = 'home', blueprints = R.DEFAULT_BLUEPRINTS) {
      const bp = blueprints.find(b => b.id === blueprint);
      const where = state.islands.find(i => i.id === island);
      play.applyRecord(state, record({ built: { id: `b${state.buildingsMade + 1}`, blueprint, name: bp.name, kind: bp.kind, island,
        price: {}, landWhenBuilt: where.land, link: null } }), number, rules, blueprints);
    },
    island(id, size, land, kind = 'rocky') { play.applyRecord(state, record({ islands: [{ id, name: id, kind, size, land }] }), number, rules, R.DEFAULT_BLUEPRINTS); },
  };
}
const placeOf = (bp, state, rules = R.DEFAULT_RULES) => {
  const i = play.placeFor(R.DEFAULT_BLUEPRINTS.find(b => b.id === bp), state, rules);
  return i === null ? null : i < 0 ? 'none' : state.islands[i].id;
};

test('a real break and the 10/20-minute rest curve', () => {
  const rules = R.DEFAULT_RULES;
  const brk = (minutes, target = 10) => ({ kind: 'break', elapsedSeconds: minutes * 60, targetSeconds: target * 60 });
  assert.equal(R.isRealBreak(brk(2.9, 1), rules), false, 'under 3 minutes is never real');
  assert.equal(R.isRealBreak(brk(3, 1), rules), true);
  assert.equal(R.isRealBreak(brk(7.4), rules), false, 'under 75% of a 10-minute plan');
  assert.equal(R.isRealBreak(brk(7.5), rules), true);
  assert.equal(R.isRealBreak({ ...brk(20), kind: 'focus' }, rules), false);
  assert.deepEqual([0, 5, 10, 15, 20, 40].map(m => R.restValue(m, rules)), [0, 5, 10, 12.5, 15, 15]);
  const on = (elapsed, target) => R.focusOnPlan({ kind: 'focus', elapsedSeconds: elapsed * 60, targetSeconds: target * 60 }, rules);
  assert.equal(on(51, 60), true);
  assert.equal(on(50, 60), false);
  assert.equal(on(69, 60), true);
  assert.equal(on(70, 60), false);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => R.islandDueAt(rules, i)), [7, 21, 51, 96, 156]);
  assert.equal(R.helperDueAt(rules, 0), 2);
  assert.ok(Math.abs(R.helperDueAt(rules, 1) - 4.6) < 1e-9);
});

test('keyed dice give the same roll for the same text, and spread out', () => {
  assert.equal(roll('abc:checkin:3:surprise'), roll('abc:checkin:3:surprise'));
  const rolls = Array.from({ length: 2000 }, (_, i) => roll(`start:checkin:${i}:surprise`));
  assert.ok(rolls.every(x => x >= 0 && x < 1));
  const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean}`);
  assert.equal(new Set(rolls).size, rolls.length);
  assert.equal(pickOne('x', ['a', 'b', 'c']), pickOne('x', ['a', 'b', 'c']));
});

test('nothing exists before the game starts, and earlier history never counts', () => {
  const h = setup();
  h.focus(60);
  assert.equal(game.gameState(h.events, h.ctx()), null);
  assert.deepEqual(game.dueGrants(h.events, h.ctx()), []);
  h.start();
  assert.deepEqual(game.dueGrants(h.events, h.ctx()), [], 'a focus session saved before the start earns nothing');
  h.rest(10);
  const [rest] = h.grants();
  assert.equal(rest.payload.source, 'rest');
  assert.equal(rest.payload.amounts.starlight, undefined, 'the focus session before the start earns no Starlight');
  const start = game.startRecord({ now: '2026-01-05T08:00:00.000Z' });
  assert.deepEqual(start, { kind: 'gameStarted', uniqueKey: 'game:started', occurredAt: '2026-01-05T08:00:00.000Z',
    payload: { rulesVersion: 2, startingLand: 40, startingSoil: 40, startingSaplings: 25 } });
  const state = h.state();
  assert.equal(state.rulesVersion, 2);
  assert.deepEqual(state.islands.map(i => [i.id, i.kind, i.land]), [['home', 'home', 40]]);
  assert.deepEqual(state.helpers, [{ id: 'h1', name: 'Pip', job: null, island: 'home' }]);
});

test('focus earns materials, real rests earn growth, and each grant is written once', () => {
  const h = setup().start();
  const f1 = h.focus(60);
  const due = game.dueGrants(h.events, h.ctx());
  assert.deepEqual(due.map(g => g.uniqueKey), [`game:grant:focus:${f1}`]);
  assert.deepEqual(game.dueGrants(h.events, h.ctx()), due, 'asking twice without writing gives the same answer');
  due.forEach(h.history.appendRecord);
  assert.deepEqual(game.dueGrants(h.events, h.ctx()), [], 'nothing is returned twice once written');
  assert.deepEqual(due[0].payload, { rulesVersion: 2, source: 'focus', sourceID: f1, dayKey: '2026-01-05',
    amounts: { wood: 21, stone: 15 }, restMinutes: 0 });
  assert.equal(due[0].occurredAt, h.ctx().now);

  const b1 = h.rest(15);
  const [rest] = h.grants();
  assert.equal(rest.uniqueKey, `game:grant:rest:${b1}`);
  assert.deepEqual(rest.payload.amounts, { soil: 37.5, saplings: 25, starlight: 1 });
  assert.equal(rest.payload.restMinutes, 12.5);

  h.focus(30);
  const short = h.rest(2);
  const unconfirmed = h.rest(12, { confirm: false });
  const grants = h.grants();
  assert.deepEqual(grants.map(g => g.uniqueKey).sort(), [`game:grant:focus:f3`, `game:grant:rest:${short}`].sort());
  assert.deepEqual(grantFor(h, `game:grant:rest:${short}`).payload.amounts, {}, 'a short confirmed break is saved as earning nothing');
  assert.equal(grantFor(h, `game:grant:rest:${unconfirmed}`), undefined, 'an unconfirmed break is not a rest');

  h.focus(60);
  const counted = h.away(20);
  h.away(20, { counted: false });
  const [away] = h.grants().filter(g => g.payload.source === 'rest');
  assert.equal(away.uniqueKey, `game:grant:rest:${counted}`);
  assert.equal(away.payload.restMinutes, 15);
  assert.equal(h.grants().length, 0);
});

test('Starlight: on plan with a real break after it, the first break decides, snoozes never count', () => {
  const h = setup().start();
  h.focus(58); h.rest(12);                         // on plan, real break: +1
  h.focus(40); h.rest(12);                         // too short: nothing
  h.focus(60); h.rest(2); h.rest(12);              // a short break came first: nothing
  h.focus(60, { reason: 'snooze' }); h.rest(12);   // started instead of a break: nothing
  const f = h.focus(60); h.rest(12, { follows: undefined }); // no followsSessionID: falls back to the last focus session
  const stars = h.grants().filter(g => g.payload.source === 'rest').map(g => g.payload.amounts.starlight || 0);
  assert.deepEqual(stars, [1, 0, 0, 0, 0, 1]);
  assert.ok(f);
});

test('Starlight: only the planned number of sessions, and away time saved before its focus session still counts', () => {
  const h = setup({ plan: { focusSessions: 1, focusMinutes: 60, breakMinutes: 10 } }).start();
  h.focus(60); h.rest(12);
  h.focus(60); h.rest(12);
  assert.deepEqual(h.grants().filter(g => g.payload.source === 'rest').map(g => g.payload.amounts.starlight || 0), [1, 0]);

  // The core saves counted away time before the focusEnded it follows, backdated. followsSessionID links them.
  const h2 = setup().start();
  h2.history.append('focusStarted', { sessionID: 'fa', targetSeconds: 3600 }, '2026-01-05T08:00:00.000Z');
  h2.history.append('awayEnded', { reason: 'input resumed', countedAsBreak: true, restSeconds: 900, targetSeconds: 600, followsSessionID: 'fa' }, '2026-01-05T09:15:00.000Z');
  h2.history.append('focusEnded', { sessionID: 'fa', targetSeconds: 3600, elapsedSeconds: 3500 }, '2026-01-05T09:00:00.000Z');
  const due = h2.grants();
  assert.deepEqual(due.map(g => g.payload.source), ['rest', 'focus']);
  assert.equal(due[0].payload.amounts.starlight, 1);
});

test('day grants wait for the day to end and carry the last session and the plan match', () => {
  const h = setup().start();
  for (let i = 0; i < 6; i++) { h.focus(60); if (i < 5) h.rest(10); }
  assert.equal(h.grants().filter(g => g.payload.source === 'day').length, 0, 'not due while the day is going');
  h.endDay();
  const [day] = h.grants();
  assert.equal(day.uniqueKey, 'game:grant:day:2026-01-05');
  assert.deepEqual(day.payload.amounts, { starlight: 5 }, 'the last on-plan session plus a matched day');
  assert.equal(day.payload.planMatch, 1);

  const h2 = setup().start();
  h2.focus(60); h2.rest(10); h2.focus(60);
  h2.grants();
  h2.nextDay();
  const [late] = h2.grants();
  assert.equal(late.uniqueKey, 'game:grant:day:2026-01-05', 'due once today is a later day');
  assert.equal(late.payload.amounts.starlight, 1);
  h2.nextDay();
  assert.deepEqual(h2.grants(), [], 'a day with no game activity gets no grant');
});

test('a check-in is ready after a break or a day end, never when focus ends, and only with something in it', () => {
  const h = setup().start();
  h.focus(60); h.grants();
  assert.equal(h.state().checkIn, null, 'not at the moment focus ends');
  assert.equal(h.state().waiting.wood, 21);
  h.rest(10); h.grants();
  const first = h.state().checkIn;
  assert.equal(first.number, 1);
  assert.equal(first.choice.kind, 'job', 'the first check-in gives Pip a job');
  assert.equal(first.choice.helperName, 'Pip');
  assert.deepEqual(first.choice.options.map(o => o.job).sort(), ['stone', 'wood']);
  assert.deepEqual(first.collected, { wood: 21, stone: 15, planks: 0, soil: 30, saplings: 20, starlight: 1 });
  h.checkIn('wood');
  let state = h.state();
  assert.equal(state.checkIn, null);
  assert.equal(state.helpers[0].job, 'wood');
  assert.deepEqual(state.onHand, { wood: 21, stone: 15, planks: 0, soil: 70, saplings: 45, starlight: 1 });
  assert.deepEqual(state.waiting, { wood: 0, stone: 0, planks: 0, soil: 0, saplings: 0, starlight: 0 });
  assert.equal(state.lastCheckIn.job.job, 'wood');
  assert.ok(state.lastCheckIn.moments.includes('Pip picked up a first job. The island is waking up.'));

  h.rest(2, { confirm: false }); h.grants();
  assert.equal(h.state().checkIn, null, 'back from a break, but nothing to collect or decide');
  h.focus(20); h.grants();
  assert.equal(h.state().checkIn, null);
  h.endDay(); h.grants();
  state = h.state();
  assert.ok(state.checkIn, 'ready after the day ends');
  assert.equal(state.checkIn.collected.wood, 7.56, 'Pip the Woodcutter adds 8%');
  assert.equal(state.checkIn.choice, null, 'only one kind of thing is affordable, so there is no pointless choice');
  assert.equal(state.checkIn.nextUp, 'Next choice: Flower bed or Little house, about 1 more focus session away. Lighthouse: 1 of 90 Starlight.');
});

test('a card already waiting stays through later focus and collects it too; counted time away makes a card ready', () => {
  const h = setup().start();
  h.focus(60); h.rest(10); h.grants();
  const card = h.state().checkIn;
  h.focus(60); h.grants();
  const later = h.state().checkIn;
  assert.ok(later, 'still waiting after focus ends');
  assert.equal(later.number, card.number);
  assert.equal(later.collected.wood, card.collected.wood + 21);
  assert.notEqual(later.token, card.token, 'the card changed, so an old tap would be refused');

  // The core saves counted away time, then the focus session it ended (backdated), in one go.
  const h2 = setup().start();
  h2.focus(60); h2.rest(10); h2.grants(); h2.checkIn('wood');
  h2.history.append('focusStarted', { sessionID: 'fa', targetSeconds: 3600 }, '2026-01-05T10:00:00.000Z');
  h2.history.append('awayEnded', { reason: 'input resumed', countedAsBreak: true, restSeconds: 900, targetSeconds: 600, followsSessionID: 'fa' }, '2026-01-05T11:15:00.000Z');
  h2.history.append('focusEnded', { sessionID: 'fa', targetSeconds: 3600, elapsedSeconds: 3500 }, '2026-01-05T11:00:00.000Z');
  h2.grants();
  assert.ok(h2.state().checkIn, 'back from time away that counted as a break');
});

test('rewards wait and never expire: a later check-in collects everything since the last one', () => {
  const h = setup().start();
  h.focus(60); h.rest(10); h.focus(60); h.rest(10); h.focus(60); h.endDay(); h.grants();
  h.nextDay(); h.nextDay(); h.nextDay();
  h.focus(60); h.rest(10); h.grants();
  const card = h.state().checkIn;
  assert.equal(card.number, 1);
  assert.equal(card.collected.wood, 84);
  assert.equal(card.collected.soil, 90);
});

test('the token and the pick are checked before anything is saved', () => {
  const h = setup().start();
  assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token: 'x', pick: null }), /nothing to collect/);
  h.focus(60); h.rest(10); h.grants();
  const { token } = h.state().checkIn;
  assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token: 'old', pick: 'wood' }), /card has changed/);
  assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token, pick: 'planks' }), /isn't one of the choices/);
  assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token, pick: 'sawmill' }), /isn't one of the choices/);
  // Progress records saved while the card waits don't change it.
  h.history.append('focusResumed', { sessionID: 'f1', elapsedSeconds: 30 }, '2026-01-05T10:00:00.000Z');
  assert.equal(h.state().checkIn.token, token);
  const record = game.checkInRecord(h.events, h.ctx(), { token, pick: 'stone' });
  assert.equal(record.kind, 'gameCheckedIn');
  assert.equal(record.uniqueKey, 'game:checkin:1');
  assert.equal(record.payload.covered, h.events.at(-1).sequence);
  assert.equal(record.payload.picked, 'stone');
  h.history.appendRecord(record);
  assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token, pick: 'stone' }), /nothing to collect/, 'a second tap is refused, not saved twice');
  // Collecting without choosing is always allowed, and a card with no choice refuses a pick.
  h.focus(60); h.rest(10); h.grants();
  const card = h.state().checkIn;
  if (!card.choice) assert.throws(() => game.checkInRecord(h.events, h.ctx(), { token: card.token, pick: 'garden' }), /nothing to choose/);
  const collect = game.checkInRecord(h.events, h.ctx(), { token: card.token, pick: null });
  assert.equal(collect.payload.picked, null);
});

test('building: price, land, stable ids, and the record replays exactly as shown', () => {
  const result = sim.run('steady', 10);
  const built = result.log.filter(l => l.built);
  assert.ok(built.length >= 5);
  assert.deepEqual(built.map(l => l.built.id), built.map((_, i) => `b${i + 1}`));
  const state = game.gameState(result.events, { todayKey: MD.dayKeyFor(10), dayKeyOf: MD.dayKeyOf });
  const ids = state.islands.flatMap(i => i.buildings.map(b => b.id)).concat(state.links.map(l => l.id));
  assert.deepEqual(ids.slice().sort((a, b) => a.slice(1) - b.slice(1)), built.map(l => l.built.id));
  assert.deepEqual(state.islands.map(i => i.id), ['home', 'isle-1']);
  assert.deepEqual(state.helpers.map(h => h.id), state.helpers.map((_, i) => `h${i + 1}`));
  for (const island of state.islands) {
    assert.ok(roomProblems(island).length === 0, roomProblems(island).join('; '));
    for (const b of island.buildings) assert.ok(b.landWhenBuilt <= island.land && b.checkIn >= 1);
  }
  // The money adds up: start + everything collected + gifts - everything spent.
  const total = { wood: 0, stone: 0, planks: 0, soil: 40, saplings: 25, starlight: 0 };
  for (const l of result.log) {
    for (const [r, n] of Object.entries(l.collected)) total[r] += n;
    for (const [r, n] of Object.entries(l.surprise?.gifts || {})) total[r] += n;
    for (const [r, n] of Object.entries(l.built?.price || {})) total[r] -= n;
  }
  for (const r of R.RESOURCES) assert.ok(Math.abs(total[r] - state.onHand[r]) < 0.05, r);
});

test('the same events always give the same state, and a rules change never rewrites a past check-in', () => {
  const result = sim.run('steady', 30);
  const ctx = { todayKey: MD.dayKeyFor(30), dayKeyOf: MD.dayKeyOf, planFor: () => PLAN };
  const before = game.gameState(result.events, ctx);
  assert.deepEqual(game.gameState(JSON.parse(JSON.stringify(result.events)), ctx), before);
  const changed = {
    ...ctx,
    rules: { ...R.DEFAULT_RULES, rulesVersion: 3, woodPerFocusMinute: 9, restMinutesPerLand: 1, startingSoil: 999, startingLand: 120,
      islandGapsDays: [1, 1, 1], realBreakMinimumMinutes: 1, helperBoost: 3, surpriseChance: 1, surpriseChanceAfterBreak: 1 },
    blueprints: R.DEFAULT_BLUEPRINTS.map(bp => ({ ...bp, cost: Object.fromEntries(Object.entries(bp.cost).map(([r, n]) => [r, Math.ceil(n / 3)])) })),
  };
  const after = game.gameState(result.events, changed);
  for (const key of ['onHand', 'waiting', 'islands', 'links', 'helpers', 'wonders', 'checkIns', 'activeDays']) {
    assert.deepEqual(after[key], before[key], key);
  }
  assert.deepEqual(game.dueGrants(result.events, changed), [], 'past sessions are never granted again under new numbers');
});

test('island kinds come from keyed dice by island number, not from when they arrive', () => {
  const steady = sim.simulate('steady', [30])[30];
  const vacation = sim.simulate('vacation', [30])[30];
  const first = island => ({ id: island.id, name: island.name, kind: island.kind, size: island.size });
  assert.deepEqual(first(steady.islands[1]), first(vacation.islands[1]));
});

test('game records survive the store unchanged, including a real SQLite round trip', () => {
  const result = sim.run('steady', 12);
  for (const event of result.events.filter(e => game.GAME_KINDS.includes(e.kind))) {
    assert.deepEqual(JSON.parse(encodePayload(event.payload)), event.payload, event.uniqueKey);
    assert.deepEqual(decodePayload({ kind: event.kind, payloadJSON: encodePayload(event.payload) }), event.payload);
  }
  const store = openStore(join(tempFolder('cozy-game-'), 'events.sqlite'));
  try {
    const ctx = () => ({ now: new Date().toISOString(), todayKey: '2099-01-01', dayKeyOf: iso => iso.slice(0, 10), planFor: () => PLAN });
    const write = record => store.append(record.kind, record.payload, { occurredAt: record.occurredAt, source: 'system', uniqueKey: record.uniqueKey });
    write(game.startRecord(ctx()));
    store.append('focusStarted', { sessionID: 'F1', targetSeconds: 3600, reason: 'suggestion' }, { occurredAt: '2099-01-01T09:00:00Z' });
    store.append('focusEnded', { sessionID: 'F1', targetSeconds: 3600, elapsedSeconds: 3580 }, { occurredAt: '2099-01-01T10:00:00Z' });
    store.append('breakStarted', { sessionID: 'B1', targetSeconds: 600, followsSessionID: 'F1' }, { occurredAt: '2099-01-01T10:00:00Z' });
    store.append('breakConfirmed', { sessionID: 'B1', targetSeconds: 600, elapsedSeconds: 640 }, { occurredAt: '2099-01-01T10:11:00Z' });
    store.append('breakEnded', { sessionID: 'B1', targetSeconds: 600, elapsedSeconds: 640 }, { occurredAt: '2099-01-01T10:11:00Z' });
    store.transaction(() => game.dueGrants(store.allEvents(), ctx()).forEach(write));
    assert.deepEqual(game.dueGrants(store.allEvents(), ctx()), []);
    assert.throws(() => write(game.startRecord(ctx())), /unique key/);
    const state = game.gameState(store.allEvents(), ctx());
    const record = game.checkInRecord(store.allEvents(), ctx(), { token: state.checkIn.token, pick: 'wood' });
    write(record);
    const after = game.gameState(store.allEvents(), ctx());
    assert.equal(after.checkIns, 1);
    assert.equal(after.helpers[0].job, 'wood');
    assert.equal(after.onHand.starlight, 1);
  } finally { store.close(); }
});

// Review fixes. Each of these once saved a wrong value for good, because grants never change once written.

test('a real break is judged against the day plan\'s usual break, not the break\'s own timer', () => {
  // Take long break sets a 30-minute timer. Ended at 20 minutes it is still a real break, as the timer says.
  const h = setup({ plan: { focusSessions: 2, focusMinutes: 60, breakMinutes: 10 } }).start();
  h.focus(60); h.rest(20, { target: 30 });
  h.focus(60); h.rest(5, { target: 30 });          // under 75% of the usual 10 minutes: not real
  const rests = h.grants().filter(g => g.payload.source === 'rest');
  assert.equal(rests[0].payload.restMinutes, 15);
  assert.equal(rests[0].payload.amounts.starlight, 1, 'the focus session before it keeps its Starlight');
  assert.ok(rests[0].payload.amounts.soil > 0 && rests[0].payload.amounts.saplings > 0);
  assert.deepEqual(rests[1].payload.amounts, {});
  // The day match counts the long break as real too.
  const h2 = setup({ plan: { focusSessions: 2, focusMinutes: 60, breakMinutes: 10 } }).start();
  h2.focus(60); h2.rest(20, { target: 30 }); h2.focus(60); h2.endDay();
  assert.equal(h2.grants().find(g => g.payload.source === 'day').payload.planMatch, 1);
  // Without a saved plan, the usual break is 10 minutes, like the timer.
  const h3 = setup({ plan: null }).start();
  h3.focus(60); h3.rest(8, { target: 30 }); h3.focus(60); h3.rest(7, { target: 30 });
  assert.deepEqual(h3.grants().filter(g => g.payload.source === 'rest').map(g => g.payload.restMinutes), [8, 0]);
});

test('Starlight places go to the first planned number of sessions that could earn it', () => {
  // After each break focus starts by itself. Stopping it at once, or a snooze, must not use up a place.
  const h = setup({ plan: { focusSessions: 3, focusMinutes: 60, breakMinutes: 10 } }).start();
  h.focus(60); h.rest(10);
  h.focus(0, { reason: 'afterBreak' }); h.focus(15, { target: 15, reason: 'snooze' }); h.focus(60); h.rest(10);
  h.focus(0, { reason: 'afterBreak' }); h.focus(60); h.rest(10);
  h.focus(0, { reason: 'afterBreak' }); h.focus(60); h.rest(10);   // a fourth on-plan session: past the plan
  const stars = h.grants().filter(g => g.payload.source === 'rest').map(g => g.payload.amounts.starlight || 0);
  assert.deepEqual(stars, [1, 1, 1, 0]);
});

test('a source that already has a grant keeps the day saved in it when the Mac changes time zone', () => {
  const h = setup().start();
  h.focus(60); h.rest(10); h.focus(60); h.endDay();
  const first = h.grants();
  assert.deepEqual(first.filter(g => g.payload.source === 'day').map(g => g.payload.dayKey), ['2026-01-05']);
  // The Mac moves 20 hours west: every saved time now falls on the day before.
  const west = iso => MD.dayKeyOf(new Date(Date.parse(iso) - 20 * 3600000).toISOString());
  h.nextDay();
  assert.deepEqual(game.dueGrants(h.events, h.ctx({ dayKeyOf: west })), [], 'no second day grant for the same work');
  // New work after the move uses the new local day.
  h.focus(60); h.rest(10);
  const later = game.dueGrants(h.events, h.ctx({ dayKeyOf: west }));
  assert.deepEqual(later.map(g => g.payload.dayKey), [west(h.events.at(-1).occurredAt), west(h.events.at(-1).occurredAt)]);
});

// The town (version 2).

test('blueprint ids, footprints and homes match electron/renderer/game/kinds.js', async () => {
  const { KINDS, FOOTS, BLOCK_BLUEPRINTS } = await import('../../renderer/game/kinds.js');
  const GROUND = { point: 1, pair: 2, cell: 5, cells: 7, ring: 11 };
  assert.deepEqual(Object.keys(GROUND).sort(), Object.keys(FOOTS).sort());
  const homes = R.DEFAULT_BLUEPRINTS.filter(bp => bp.kind === 'homes').map(bp => bp.id);
  assert.deepEqual(homes, BLOCK_BLUEPRINTS);
  assert.ok(!R.DEFAULT_BLUEPRINTS.some(bp => bp.id === 'cottage'), 'cottages are block houses now');
  for (const bp of R.DEFAULT_BLUEPRINTS) {
    assert.equal(typeof bp.ground, 'number', `${bp.id} has a ground`);
    if (bp.kind === 'homes' || bp.noSpot) continue;
    assert.ok(KINDS[bp.id], `${bp.id} is a kind`);
    assert.equal(bp.ground, GROUND[KINDS[bp.id].foot], `${bp.id}: ground matches its ${KINDS[bp.id].foot} footprint`);
  }
  assert.deepEqual(['house', 'room', 'floor'].map(id => R.DEFAULT_BLUEPRINTS.find(bp => bp.id === id).ground), [3, 1, 0]);
  assert.equal(R.DEFAULT_BLUEPRINTS.find(bp => bp.id === 'bridge').ground, 0);
  assert.deepEqual(R.KIND_NAMES, { making: 'making things', growing: 'growing things', decor: 'pretty things', homes: 'homes', wonder: 'Starlight wonder' });
});

test('the room sum: home starts with room for one cell pad, and a day of breaks makes room for a second', () => {
  const rules = R.DEFAULT_RULES;
  const room = R.roomOf(40, 4, rules);
  assert.ok(room >= 5 && room < 10, `room ${room}`);
  assert.ok(R.roomOf(40, 4 + 5, rules) < 5, 'not a second cell pad yet');
  assert.ok(R.roomOf(48, 4 + 5, rules) >= 5, 'about 8 more points (40 rest minutes) make room for the second');
  for (const land of [40, 100, 300, 600]) assert.ok(R.roomOf(land + 1, 0, rules) > R.roomOf(land, 0, rules), 'more land is always more room');
  const { state, island } = bareState();
  island('isle-1', 'small', rules.startLand.small);
  assert.deepEqual(state.islands.map(i => [i.id, i.used]), [['home', 4], ['isle-1', 2]], 'start things use 4 on home and 2 on a new island');
  assert.deepEqual(state.islands.map(i => R.maxLandOf(i, rules)), [600, 320]);
});

test("priceOf reads a blueprint's own step before the shared ones", () => {
  const bp = id => R.DEFAULT_BLUEPRINTS.find(b => b.id === id);
  const price = (id, owned) => R.priceOf(bp(id), { counts: { [id]: owned } }, R.DEFAULT_RULES);
  assert.deepEqual(price('room', 0), { wood: 20, stone: 12, soil: 10, saplings: 5 });
  assert.deepEqual(price('room', 10), { wood: 32, stone: 19, soil: 16, saplings: 8 }, '6% for each one owned');
  assert.deepEqual(price('house', 4), { wood: 80, stone: 40, soil: 40, saplings: 20 }, '25% for each one owned');
  assert.deepEqual(price('flowers', 1), { wood: 50, stone: 20, soil: 50, saplings: 30 }, 'cheap decor still doubles');
  assert.deepEqual(price('windmill', 1), { stone: 140, planks: 126, soil: 84, saplings: 49 });
});

test('homes: a house first, rooms before another house, floors under the blocks, on the island with the most room', () => {
  const { state, build, island } = bareState(R.DEFAULT_RULES, 100);
  assert.equal(placeOf('house', state), 'home', 'the first house is always allowed');
  assert.equal(placeOf('room', state), null, 'a room needs a house');
  assert.equal(play.available(R.DEFAULT_BLUEPRINTS.find(b => b.id === 'floor'), state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS), false, 'a floor needs the Sawmill');
  build('house');
  assert.equal(placeOf('house', state), null, 'houses grow before new ones start');
  assert.equal(placeOf('room', state), 'home');
  build('room');
  assert.equal(placeOf('house', state), 'home');
  assert.equal(placeOf('floor', state), 'home', 'tier 2 is checked by available(), the island only needs floors under its blocks');
  build('floor'); build('floor'); build('floor');
  assert.equal(placeOf('floor', state), null, 'three floors on three blocks: no more until the house grows');
  assert.equal(play.beds(state, R.DEFAULT_RULES), 3 + 6, 'one bed per block storey: 2 for the house, 1 for the room, 1 per floor');
  // Rooms and floors only go where a house is; everything else goes to the island with the most room.
  island('isle-1', 'large', 300);
  assert.equal(placeOf('garden', state), 'isle-1');
  assert.equal(placeOf('room', state), 'home');
  assert.equal(placeOf('house', state), 'isle-1');
  assert.equal(placeOf('bridge', state), 'none');
  // Not enough room for the ground: nowhere.
  const small = bareState();
  small.build('garden');
  assert.equal(placeOf('house', small.state), null, `room ${play.roomOn(small.state.islands[0], R.DEFAULT_RULES).toFixed(2)} is under 3`);
  // Blocks cover at most 30% of an island's land.
  const open = { ...R.DEFAULT_RULES, coastPerRootLand: 0, laneShareOfLand: 0 };
  const tiny = bareState(open);
  tiny.state.islands[0].land = 20;
  tiny.build('house'); tiny.build('room'); tiny.build('room'); tiny.build('room'); tiny.build('room');
  assert.equal(tiny.state.islands[0].blocks, 6);
  assert.equal(placeOf('room', tiny.state, open), null, '7 blocks would cover 35% of 20 points');
});

test('the homes slot shows the affordable homes blueprint with the lowest number owned ÷ weight', () => {
  const { state, build } = bareState(R.DEFAULT_RULES, 200);
  build('sawmill');
  build('house'); build('room'); build('room');
  const homesIn = offer => offer.find(o => o.bp.kind === 'homes')?.bp.id;
  const offer = key => play.makeOffer(state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS, key);
  assert.equal(homesIn(offer('a')), 'floor', 'house 1 ÷ 1, room 2 ÷ 3, floor 0 ÷ 2');
  build('floor'); build('floor');
  assert.equal(homesIn(offer('a')), 'room', 'house 1 ÷ 1, room 2 ÷ 3, floor 2 ÷ 2');
  state.onHand.planks = 0;
  build('room');
  assert.equal(homesIn(offer('a')), 'house', 'floors cost planks, so the next lowest that is affordable');
  for (const key of ['a', 'b', 'c', 'd']) {
    const kinds = offer(key).map(o => o.bp.kind);
    assert.ok(kinds.length >= 2 && kinds.length <= 3 && new Set(kinds).size === kinds.length);
  }
});

test('homes are offered whenever they fit, and a helper with no bed hears about houses and rooms', () => {
  const rules = { ...R.DEFAULT_RULES, startingBeds: 1, firstHelperGapDays: 0.5 };
  const h = setup().start();
  h.focus(60); h.rest(10); h.grants({ rules });
  const card = h.state({ rules }).checkIn;
  assert.ok(card.arrivals.includes('Wren would like to move in, but every bed is taken. A new house or room would give them a home.'), card.arrivals.join(' | '));
  // With beds to spare the house is still on offer (decision 7).
  const { state } = bareState();
  assert.ok(play.beds(state, R.DEFAULT_RULES) > state.helpers.length);
  assert.ok(play.makeOffer(state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS, 'k').some(o => o.bp.id === 'house'));
});

test('rest minutes become land points; full islands are skipped and the minutes wait when all are full', () => {
  const h = setup().start();
  h.focus(60); h.rest(10); h.grants();
  const first = h.checkIn('wood');
  assert.deepEqual(first.payload.newLand, [{ island: 'home', amount: 2 }], 'a 10-minute break grows 2 points');
  assert.equal(first.payload.landProgress, 0);
  assert.equal(h.state().islands[0].land, 42);

  const full = { ...R.DEFAULT_RULES, startingLand: 598 };
  const h2 = setup();
  h2.history.appendRecord(game.startRecord(h2.ctx({ rules: full })));
  h2.focus(60); h2.rest(15); h2.grants();
  const a = h2.checkIn('wood');
  assert.deepEqual([a.payload.newLand, a.payload.landProgress], [[{ island: 'home', amount: 2 }], 2.5], '12.5 rest minutes: 2 points to reach 600, 2.5 minutes over');
  h2.focus(60); h2.rest(10); h2.grants();
  const b = h2.checkIn(null);
  assert.deepEqual([b.payload.newLand, b.payload.landProgress, h2.state().islands[0].land], [[], 12.5, 600], 'home is full, so the minutes wait');
});

test('"next up" counts the land points still missing', () => {
  const { state, build } = bareState();
  build('garden');
  const typical = { focusMinutes: 60, breakMinutes: 10 };
  // Room 0.9 after the garden. A Flower bed needs 2 more land points (one 10-minute break); a pad needs 8.
  assert.equal(play.teaser(state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS, typical), 'Next up: Flower bed, about 1 more break away.');
  assert.equal(play.landPointsNeeded(R.DEFAULT_BLUEPRINTS.find(b => b.id === 'nursery'), state, R.DEFAULT_RULES), 8);
  state.landProgress = 9;
  assert.equal(play.landPointsNeeded(R.DEFAULT_BLUEPRINTS.find(b => b.id === 'nursery'), state, R.DEFAULT_RULES), 8, 'progress is minutes, counted by the caller');
});

test('version-1 records still read: land × 7, a cottage is a house', () => {
  const history = MD.createHistory();
  const at = '2026-01-05T08:00:00.000Z';
  history.appendRecord({ kind: 'gameStarted', uniqueKey: 'game:started', occurredAt: at,
    payload: { rulesVersion: 1, startingLand: 4, startingSoil: 40, startingSaplings: 25 } });
  history.append('focusStarted', { sessionID: 'f1', targetSeconds: 3600, reason: 'suggestion' }, at);
  history.append('focusEnded', { sessionID: 'f1', targetSeconds: 3600, elapsedSeconds: 3600 }, '2026-01-05T09:00:00.000Z');
  history.appendRecord({ kind: 'gameCheckedIn', uniqueKey: 'game:checkin:1', occurredAt: '2026-01-05T09:10:00.000Z', payload: {
    rulesVersion: 1, number: 1, token: 'old', covered: 3, dayKey: '2026-01-05', activeDays: 1,
    collected: { wood: 60, stone: 30, planks: 0, soil: 0, saplings: 0, starlight: 0 }, restMinutes: 40, landProgress: 5,
    newLand: [{ island: 'home', amount: 1 }], surprise: null,
    islands: [{ id: 'isle-1', name: 'Flint Peak', kind: 'rocky', size: 'medium', land: 3 }],
    helpersQueued: [], helpersArrived: [], arrivals: [], moments: [], firsts: ['building'],
    choice: { kind: 'build', options: [{ blueprint: 'cottage', island: 'home', price: { wood: 45, stone: 25, soil: 25, saplings: 10 } }] },
    picked: 'cottage', job: null,
    built: { id: 'b1', blueprint: 'cottage', name: 'Cottage', kind: 'decor', island: 'home', price: { wood: 45, stone: 25, soil: 25, saplings: 10 }, landWhenBuilt: 5, link: null },
  } });
  const ctx = { now: '2026-01-05T10:00:00.000Z', todayKey: '2026-01-05', dayKeyOf: MD.dayKeyOf, planFor: () => PLAN };
  const state = game.gameState(history.events, ctx);
  assert.deepEqual(state.islands.map(i => [i.id, i.land]), [['home', 35], ['isle-1', 21]]);
  assert.deepEqual(state.islands[0].buildings, [{ id: 'b1', blueprint: 'house', name: 'Little house', landWhenBuilt: 35, checkIn: 1 }]);
  assert.equal(state.lastCheckIn.built.blueprint, 'house');
  assert.equal(play.beds(play.fold(require('./history').scan(history.events), R.DEFAULT_RULES), R.DEFAULT_RULES), 5, 'the cottage still gives 2 beds');
  assert.deepEqual(state.onHand, { wood: 15, stone: 5, planks: 0, soil: 15, saplings: 15, starlight: 0 });
  // A version-2 check-in on top: the 5 waiting rest minutes and a 10-minute break become 3 points, for
  // the island with the least land for its size.
  history.append('breakStarted', { sessionID: 'r1', targetSeconds: 600, followsSessionID: 'f1' }, '2026-01-05T10:00:00.000Z');
  history.append('breakConfirmed', { sessionID: 'r1', targetSeconds: 600, elapsedSeconds: 600 }, '2026-01-05T10:10:00.000Z');
  history.append('breakEnded', { sessionID: 'r1', targetSeconds: 600, elapsedSeconds: 600 }, '2026-01-05T10:10:00.000Z');
  game.dueGrants(history.events, ctx).forEach(history.appendRecord);
  const card = game.gameState(history.events, ctx).checkIn;
  assert.deepEqual(card.newLand, [{ island: 'isle-1', amount: 3 }]);
  const record = game.checkInRecord(history.events, ctx, { token: card.token, pick: null });
  assert.equal(record.payload.rulesVersion, 2);
});

test('the simulated player: a wonder, then homes for a bed or on every third homes offer, else something new', () => {
  const blueprints = R.DEFAULT_BLUEPRINTS;
  const opt = id => ({ blueprint: id, kind: blueprints.find(b => b.id === id).kind });
  const state = (ids, built = []) => ({ islands: [{ buildings: built.map(blueprint => ({ blueprint })) }], links: [],
    checkIn: { choice: { kind: 'build', options: ids.map(opt) } } });
  const choose = (s, extra = {}) => sim.simulatedPlayer(s, { blueprints, helpersWaiting: 0, homesOffers: 1, ...extra });
  assert.equal(choose(state(['lighthouse', 'room', 'garden'])), 'lighthouse');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { helpersWaiting: 1 }), 'room', 'a helper needs a bed');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { homesOffers: 3 }), 'room', 'every third homes offer');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { homesOffers: 4 }), 'windmill', 'otherwise something new');
  assert.equal(choose(state(['flowers', 'house'], ['flowers'])), 'house', 'a first house is something new too');
  assert.equal(choose(state(['flowers', 'sawmill'])), 'sawmill', 'a one-off before a repeatable');
  assert.equal(sim.simulatedPlayer({ checkIn: { choice: { kind: 'job', options: [{ job: 'stone' }, { job: 'wood' }] } } }, { blueprints }), 'stone');
});
