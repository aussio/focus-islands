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
const sky = require('./sky');

// A bare rules state for unit checks: home only, with plenty on hand. build() saves one building the
// way a check-in would, island() adds the next new island at its place in the sky table, and bridge()
// saves a rope bridge (or a fancy one, as a surprise would).
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
    island(id, size, land, kind = 'rocky', extra = {}) {
      const place = sky.placeOf(state.islands.length);
      play.applyRecord(state, record({ islands: [{ id, name: id, kind, size, land, ...place, lift: 0, appetite: 1, ...extra }] }), number, rules, R.DEFAULT_BLUEPRINTS);
    },
    bridge(from, to, type = 'rope') {
      const land = { [from]: state.islands.find(i => i.id === from).land, [to]: state.islands.find(i => i.id === to).land };
      const p = type === 'rope'
        ? record({ built: { id: `b${state.buildingsMade + 1}`, blueprint: 'bridge', name: 'Rope bridge', kind: 'decor', island: null,
          price: {}, landWhenBuilt: null, link: { from, to, type, land } } })
        : record({ surprise: { id: 'bridge', text: '', gifts: {}, island: from, link: { id: `gift-${number + 1}`, from, to, type, land } } });
      play.applyRecord(state, p, number, rules, R.DEFAULT_BLUEPRINTS);
    },
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
  const store = openStore(join(tempFolder('focus-islands-game-'), 'events.sqlite'));
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
  const { BRIDGE_TYPES } = await import('../../renderer/game/kinds.js');
  assert.deepEqual(Object.keys(R.BRIDGE_TYPES), BRIDGE_TYPES, 'bridge types match');
  assert.equal(R.DEFAULT_BLUEPRINTS.find(bp => bp.id === 'bridge').linkType, 'rope');
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

test('each bridge end takes groundPerBridgeEnd on its island, rope or fancy, and a bridge never waits for room', () => {
  const rules = R.DEFAULT_RULES;
  const end = rules.groundPerBridgeEnd;
  assert.ok(end > 0, 'a foot needs a lane to the other lanes');
  const { state, island, bridge } = bareState();
  state.counts.sawmill = 1;
  for (const id of ['isle-1', 'isle-2']) island(id, 'small', 30);
  const used = () => state.islands.map(i => i.used);
  const [home, one, two] = used();
  bridge('home', 'isle-1');
  assert.deepEqual(used(), [home + end, one + end, two], 'a rope bridge: both ends');
  bridge('home', 'isle-2', 'rainbow');
  assert.deepEqual(used(), [home + 2 * end, one + end, two + end], 'a fancy bridge from a surprise: both ends too');
  assert.ok(play.roomOn(state.islands[2], rules) < 0, 'a young island can dip below 0 room until its land catches up');
  // Bridges need no spot, so they are offered and placed whatever the room.
  island('isle-3', 'small', 30);
  for (const each of state.islands) each.used = 1000;
  const bp = R.DEFAULT_BLUEPRINTS.find(b => b.id === 'bridge');
  assert.equal(play.available(bp, state, rules, R.DEFAULT_BLUEPRINTS), true);
  assert.equal(placeOf('bridge', state), 'none');
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

test('homes: a house first, rooms before another house, floors under the blocks, each island on its own', () => {
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
  // Rooms and floors only go where a house is; everything else goes to the island with the fewest buildings for its land.
  island('isle-1', 'large', 300);
  assert.equal(placeOf('garden', state), 'isle-1');
  assert.equal(placeOf('room', state), 'home');
  assert.equal(placeOf('house', state), 'isle-1');
  assert.equal(placeOf('bridge', state), 'none');
  // The second-house rule counts each island's own houses and rooms: home has 2 houses and 1 room, so no
  // third house there, but a new island still gets its first.
  build('house');
  const homeOnly = { ...state, islands: state.islands.slice(0, 1) };
  assert.equal(placeOf('house', homeOnly), null, 'home: fewer rooms than houses');
  assert.equal(placeOf('house', state), 'isle-1', 'a new island can always start its first house');
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

test('placeFor: the island with the fewest buildings for its land that has room, so young islands fill up too', () => {
  const { state, build, island } = bareState(R.DEFAULT_RULES, 300);
  for (const id of ['garden', 'nursery', 'sawmill', 'workshop', 'flowers']) build(id);
  island('isle-1', 'small', 40);
  // Home has far more room (about 136 against 8), but 5 buildings on 300 points; the young island has none.
  assert.equal(placeOf('windmill', state), 'isle-1');
  build('windmill', 'isle-1');
  assert.equal(placeOf('orchard', state), 'home', 'isle-1 has no room left for a cell pad');
  assert.equal(placeOf('flowers', state), 'home', '1 building on 40 points is more crowded than 5 on 300');
  // Ties: the most room, then the earlier island.
  const even = bareState(R.DEFAULT_RULES, 100);
  even.island('isle-1', 'large', 100);
  assert.equal(placeOf('garden', even.state), 'isle-1', 'both empty: isle-1 starts with less ground used');
  even.state.islands[1].used = even.state.islands[0].used;
  assert.equal(placeOf('garden', even.state), 'home', 'a full tie goes to the earlier island');
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

test('version-1 records still read: land × 7, a cottage is a house, islands get places, chain links become rope bridges', () => {
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
    islands: [{ id: 'isle-1', name: 'Flint Peak', kind: 'rocky', size: 'medium', land: 3 }, { id: 'isle-2', name: 'Mossy Hollow', kind: 'mossy', size: 'small', land: 2 }],
    helpersQueued: [], helpersArrived: [], arrivals: [], moments: [], firsts: ['building'],
    choice: { kind: 'build', options: [{ blueprint: 'cottage', island: 'home', price: { wood: 45, stone: 25, soil: 25, saplings: 10 } }] },
    picked: 'cottage', job: null,
    built: { id: 'b1', blueprint: 'cottage', name: 'Cottage', kind: 'decor', island: 'home', price: { wood: 45, stone: 25, soil: 25, saplings: 10 }, landWhenBuilt: 5, link: null },
  } });
  // The old chain link joined isle-1 to isle-2. Isle-2's first neighbour in the sky table is home.
  history.appendRecord({ kind: 'gameCheckedIn', uniqueKey: 'game:checkin:2', occurredAt: '2026-01-05T09:20:00.000Z', payload: {
    rulesVersion: 1, number: 2, token: 'old', covered: 4, dayKey: '2026-01-05', activeDays: 1,
    collected: { wood: 0, stone: 0, planks: 0, soil: 0, saplings: 0, starlight: 0 }, restMinutes: 0, landProgress: 5,
    newLand: [{ island: 'isle-2', amount: 1 }], surprise: null, islands: [], helpersQueued: [], helpersArrived: [],
    arrivals: [], moments: [], firsts: [], choice: { kind: 'build', options: [{ blueprint: 'bridge', island: null, price: {} }] },
    picked: 'bridge', job: null,
    built: { id: 'b2', blueprint: 'bridge', name: 'Rope bridge', kind: 'decor', island: null, price: {}, landWhenBuilt: null, link: { from: 'isle-1', to: 'isle-2' } },
  } });
  const ctx = { now: '2026-01-05T10:00:00.000Z', todayKey: '2026-01-05', dayKeyOf: MD.dayKeyOf, planFor: () => PLAN };
  const state = game.gameState(history.events, ctx);
  assert.deepEqual(state.islands.map(i => [i.id, i.land, i.ring, i.angle]), [['home', 35, 0, null], ['isle-1', 21, 1, 0], ['isle-2', 21, 1, 180]]);
  const folded = play.fold(require('./history').scan(history.events), R.DEFAULT_RULES);
  for (const [n, island] of folded.islands.entries()) {
    if (!n) { assert.deepEqual([island.lift, island.appetite], [0, R.DEFAULT_RULES.homeAppetite]); continue; }
    const rolled = sky.arrivalOf(folded.startedID, n, R.DEFAULT_RULES);
    assert.deepEqual([island.lift, island.appetite], [rolled.lift, rolled.appetite], `${island.id}: the same rolls as a new island`);
  }
  assert.deepEqual(state.links, [{ id: 'b2', from: 'home', to: 'isle-2', type: 'rope', checkIn: 2, land: { home: 35, 'isle-2': 21 } }]);
  assert.deepEqual(state.islands[0].buildings, [{ id: 'b1', blueprint: 'house', name: 'Little house', landWhenBuilt: 35, checkIn: 1 }]);
  assert.equal(state.lastCheckIn.built.blueprint, 'bridge');
  assert.equal(play.beds(play.fold(require('./history').scan(history.events), R.DEFAULT_RULES), R.DEFAULT_RULES), 5, 'the cottage still gives 2 beds');
  assert.deepEqual(state.onHand, { wood: 15, stone: 5, planks: 0, soil: 15, saplings: 15, starlight: 0 });
  // A version-2 check-in on top: the 5 waiting rest minutes and a 10-minute break become 3 points.
  history.append('breakStarted', { sessionID: 'r1', targetSeconds: 600, followsSessionID: 'f1' }, '2026-01-05T10:00:00.000Z');
  history.append('breakConfirmed', { sessionID: 'r1', targetSeconds: 600, elapsedSeconds: 600 }, '2026-01-05T10:10:00.000Z');
  history.append('breakEnded', { sessionID: 'r1', targetSeconds: 600, elapsedSeconds: 600 }, '2026-01-05T10:10:00.000Z');
  game.dueGrants(history.events, ctx).forEach(history.appendRecord);
  const card = game.gameState(history.events, ctx).checkIn;
  assert.equal(card.newLand.reduce((n, grown) => n + grown.amount, 0), 3);
  const record = game.checkInRecord(history.events, ctx, { token: card.token, pick: null });
  assert.equal(record.payload.rulesVersion, 2);
});

test('a building saved under an old name reads by its name today in History and the last check-in; the record keeps the old name', () => {
  const history = MD.createHistory();
  history.appendRecord({ kind: 'gameStarted', uniqueKey: 'game:started', occurredAt: '2026-01-05T08:00:00.000Z',
    payload: { rulesVersion: 2, startingLand: 40, startingSoil: 40, startingSaplings: 25 } });
  history.appendRecord({ kind: 'gameCheckedIn', uniqueKey: 'game:checkin:1', occurredAt: '2026-01-05T09:10:00.000Z', payload: {
    rulesVersion: 2, number: 1, token: 'old', covered: 1, dayKey: '2026-01-05', activeDays: 1,
    collected: { wood: 0, stone: 0, planks: 0, soil: 0, saplings: 0, starlight: 0 }, restMinutes: 0, landProgress: 0,
    newLand: [], surprise: null, islands: [], helpersQueued: [], helpersArrived: [], arrivals: [], moments: [], firsts: ['building'],
    choice: { kind: 'build', options: [{ blueprint: 'nursery', island: 'home', price: {} }] }, picked: 'nursery', job: null,
    built: { id: 'b1', blueprint: 'nursery', name: 'Seed nursery', kind: 'growing', island: 'home', price: {}, landWhenBuilt: 40, link: null },
  } });
  const saved = JSON.parse(JSON.stringify(history.events));
  const ctx = { now: '2026-01-05T10:00:00.000Z', todayKey: '2026-01-05', dayKeyOf: MD.dayKeyOf, planFor: () => PLAN };
  assert.equal(game.gameState(history.events, ctx).lastCheckIn.built.name, 'Rain catcher');
  const [day] = game.daySummaries(history.events, ctx, ['2026-01-05']);
  assert.deepEqual(day.happenings.filter(item => item.kind === 'built').map(item => item.name), ['Rain catcher']);
  assert.deepEqual(history.events, saved, 'the saved records are unchanged');
  assert.equal(history.events.find(e => e.uniqueKey === 'game:checkin:1').payload.built.name, 'Seed nursery');
  // A blueprint that is gone falls back to the name saved at build time.
  assert.equal(R.builtNameOf({ blueprint: 'gone', name: 'Old thing' }, R.DEFAULT_BLUEPRINTS), 'Old thing');
});

test('the simulated player: a wonder, homes for a bed, a bridge to an unjoined island, homes on every third offer, else something new', () => {
  const blueprints = R.DEFAULT_BLUEPRINTS;
  const opt = id => ({ blueprint: id, kind: blueprints.find(b => b.id === id).kind });
  const state = (ids, built = [], more = {}) => ({ islands: [{ id: 'home', buildings: built.map(blueprint => ({ blueprint })) }], links: [],
    checkIn: { choice: { kind: 'build', options: ids.map(opt) } }, ...more });
  const choose = (s, extra = {}) => sim.simulatedPlayer(s, { blueprints, helpersWaiting: 0, homesOffers: 1, ...extra });
  assert.equal(choose(state(['lighthouse', 'room', 'garden'])), 'lighthouse');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { helpersWaiting: 1 }), 'room', 'a helper needs a bed');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { homesOffers: 3 }), 'room', 'every third homes offer');
  assert.equal(choose(state(['windmill', 'room'], ['room', 'room']), { homesOffers: 4 }), 'windmill', 'otherwise something new');
  assert.equal(choose(state(['flowers', 'house'], ['flowers'])), 'house', 'a first house is something new too');
  assert.equal(choose(state(['flowers', 'sawmill'])), 'sawmill', 'a one-off before a repeatable');
  const two = [{ id: 'home', buildings: [] }, { id: 'isle-1', buildings: [] }];
  assert.equal(choose(state(['sawmill', 'bridge', 'room'], [], { islands: two })), 'bridge', 'an island is not joined yet');
  assert.equal(choose(state(['sawmill', 'bridge', 'room'], [], { islands: two }), { helpersWaiting: 1 }), 'room', 'a bed comes first');
  assert.equal(choose(state(['sawmill', 'bridge'], [], { islands: two, links: [{ id: 'b1', from: 'home', to: 'isle-1' }] })), 'sawmill', 'all joined');
  assert.equal(sim.simulatedPlayer({ checkIn: { choice: { kind: 'job', options: [{ job: 'stone' }, { job: 'wood' }] } } }, { blueprints }), 'stone');
});

test('the sky table: places, neighbours in order, pairs in table order, joined islands', () => {
  assert.deepEqual(sky.placeOf(0), { ring: 0, angle: null });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(n => sky.placeOf(n).angle), [0, 180, 315, 135, 225, 45, 270, 90]);
  assert.deepEqual([sky.placeOf(8), sky.placeOf(9), sky.placeOf(16), sky.placeOf(17)],
    [{ ring: 1, angle: 90 }, { ring: 2, angle: 0 }, { ring: 2, angle: 90 }, { ring: 3, angle: 0 }]);
  const all = [{ id: 'home', ...sky.placeOf(0) }];
  for (let n = 1; n <= 24; n++) all.push({ id: `isle-${n}`, ...sky.placeOf(n) });
  const ways = id => sky.neighboursOf(id, all).map(n => `${n.way}:${n.id}`);
  assert.deepEqual(ways('home'), [1, 2, 3, 4, 5, 6, 7, 8].map(n => `outward:isle-${n}`));
  assert.deepEqual(ways('isle-1'), ['inward:home', 'around:isle-3', 'around:isle-6', 'outward:isle-9'], '0°: 315° came before 45°');
  assert.deepEqual(ways('isle-9'), ['inward:isle-1', 'around:isle-11', 'around:isle-14', 'outward:isle-17']);
  assert.deepEqual(ways('isle-24'), ['inward:isle-16', 'around:isle-20', 'around:isle-22'], '90°: 135° came before 45°');
  for (const island of all) {
    const near = sky.neighboursOf(island.id, all);
    assert.ok(near.length <= (island.ring ? 4 : 8), `${island.id} has at most ${island.ring ? 4 : 8} neighbours`);
    for (const n of near) {
      const other = all.find(i => i.id === n.id);
      assert.ok(sky.neighboursOf(n.id, all).some(back => back.id === island.id), `${island.id} and ${n.id} see each other`);
      if (island.ring && other.ring) assert.ok(sky.degreesApart(island.angle, other.angle) <= 45, `${island.id} and ${n.id} are close`);
    }
  }
  // Only islands that have arrived count, and islands 90° apart never join, even with nothing between them.
  const four = all.slice(0, 5);
  assert.deepEqual(sky.neighboursOf('isle-1', four).map(n => n.id), ['home', 'isle-3']);
  assert.deepEqual(sky.neighbourPairs(four).map(p => `${p.from}-${p.to}`),
    ['home-isle-1', 'home-isle-2', 'home-isle-3', 'isle-1-isle-3', 'home-isle-4', 'isle-2-isle-4']);
  assert.equal(sky.neighbourPairs(all).length, 8 + 8 + 8 + 8 + 8 + 8, 'three full rings: 8 spokes and 8 around in each ring');
  // Joined: a chain of links reaches home, whichever way each link points.
  const links = [{ from: 'home', to: 'isle-2' }, { from: 'isle-4', to: 'isle-2' }, { from: 'isle-1', to: 'isle-3' }];
  assert.deepEqual([...sky.joinedSet(four, links)].sort(), ['home', 'isle-2', 'isle-4']);
  // Arrival rolls: the same island always rolls the same; lifts in steps of 0.05 from -0.5 to 0.5.
  const rules = R.DEFAULT_RULES, lifts = new Set();
  for (let n = 1; n <= 200; n++) {
    const a = sky.arrivalOf('S', n, rules);
    assert.deepEqual(a, sky.arrivalOf('S', n, rules));
    assert.deepEqual([a.ring, a.angle], [sky.placeOf(n).ring, sky.placeOf(n).angle]);
    assert.ok(a.lift >= -0.5 && a.lift <= 0.5 && Math.abs(a.lift * 20 - Math.round(a.lift * 20)) < 1e-9, `lift ${a.lift}`);
    assert.ok(a.appetite >= 0.7 && a.appetite <= 1.3, `appetite ${a.appetite}`);
    lifts.add(a.lift);
  }
  assert.ok(lifts.size >= 18 && lifts.has(-0.5) && lifts.has(0.5), `lifts spread out: ${lifts.size}`);
});

test('land points go by appetite and age, and no island passes 85% of home', () => {
  const rules = R.DEFAULT_RULES;
  const { state, island } = bareState(rules, 300);
  island('isle-1', 'large', 40, 'rocky', { appetite: 1.3 });
  island('isle-2', 'large', 40, 'mossy', { appetite: 0.7 });
  const land = new Map(state.islands.map(i => [i.id, i.land]));
  assert.equal(play.shareLand(state.islands, land, 300, rules, 'S:checkin:9'), 300);
  const [home, one, two] = state.islands.map(i => land.get(i.id) - i.land);
  // Weights 1.3, 1.3 / 1.3 = 1, 0.7 / 1.6 = 0.44: about 130, 100 and 44 of every 274.
  assert.ok(home > one && one > two && two > 20, `shares ${home}, ${one}, ${two}`);
  const again = new Map(state.islands.map(i => [i.id, i.land]));
  play.shareLand(state.islands, again, 300, rules, 'S:checkin:9');
  assert.deepEqual([...again], [...land], 'the same check-in shares the same way');
  // Home is full at 100: the others may grow to 85 and no further, and then the points wait.
  const small = { ...rules, maxLand: { ...rules.maxLand, home: 100 } };
  const b = bareState(small, 100);
  b.island('isle-1', 'large', 84);
  const capped = new Map(b.state.islands.map(i => [i.id, i.land]));
  assert.equal(play.shareLand(b.state.islands, capped, 5, small, 'k'), 1);
  assert.deepEqual([...capped.values()], [100, 85]);
});

test('rope bridges: one per open neighbour pair, first joining each island, then closing loops', () => {
  const { state, island, bridge } = bareState();
  const bp = R.DEFAULT_BLUEPRINTS.find(b => b.id === 'bridge');
  state.counts.sawmill = 1;
  assert.equal(play.available(bp, state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS), false, 'home alone has no neighbours');
  for (const id of ['isle-1', 'isle-2', 'isle-3', 'isle-4']) island(id, 'small', 30);
  assert.equal(play.available(bp, state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS), true);
  assert.deepEqual(play.ropeTarget(state, 'k'), { from: 'home', to: 'isle-1' }, 'the earliest island that is not joined');
  bridge('home', 'isle-1');
  bridge('home', 'isle-2');
  // Isle-3 (315°) can join home (inward, weight 2) or isle-1 (around, weight 1).
  let fromHome = 0;
  for (let k = 0; k < 600; k++) {
    const target = play.ropeTarget(state, `k${k}`);
    assert.equal(target.to, 'isle-3');
    assert.ok(['home', 'isle-1'].includes(target.from));
    if (target.from === 'home') fromHome += 1;
  }
  assert.ok(fromHome > 340 && fromHome < 460, `about two in three go inward: ${fromHome} of 600`);
  bridge('isle-1', 'isle-3');
  bridge('home', 'isle-4');
  // Everyone is joined, so the next bridges close loops, in table order.
  assert.deepEqual(play.ropeTarget(state, 'k'), { from: 'home', to: 'isle-3' });
  bridge('home', 'isle-3');
  assert.deepEqual(play.ropeTarget(state, 'k'), { from: 'isle-2', to: 'isle-4' });
  bridge('isle-2', 'isle-4');
  assert.equal(play.ropeTarget(state, 'k'), null);
  assert.equal(play.available(bp, state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS), false, 'every pair has a link');
  assert.deepEqual(state.links[2], { id: 'b3', from: 'isle-1', to: 'isle-3', type: 'rope', checkIn: 7, land: { 'isle-1': 30, 'isle-3': 30 } });
});

test('a rope bridge option names both islands, and building it saves both ends and their land', () => {
  const { state, island } = bareState();
  state.counts.sawmill = 1;
  island('isle-1', 'small', 30, 'mossy', { name: 'Mossy Hollow' });
  const offer = play.makeOffer(state, R.DEFAULT_RULES, R.DEFAULT_BLUEPRINTS, 'S:checkin:3');
  const option = offer.find(o => o.bp.id === 'bridge');
  assert.deepEqual(option.link, { from: 'home', to: 'isle-1' });
  const draft = { number: 3, token: 't', collected: play.empty(), newLand: [], arrivals: [], moments: [], firsts: [], surprise: null,
    choice: { kind: 'build', options: offer.map(o => ({ blueprint: o.bp.id, island: o.island, price: o.price, ...(o.link ? { link: o.link } : {}) })) } };
  const env = { rules: R.DEFAULT_RULES, blueprints: R.DEFAULT_BLUEPRINTS, typical: { focusMinutes: 60, breakMinutes: 10 } };
  const view = play.viewState(state, { grants: [], newestGameSequence: 1 }, { draft, work: state }, env);
  const shown = view.checkIn.choice.options.find(o => o.blueprint === 'bridge');
  assert.deepEqual(Object.keys(shown), ['blueprint', 'name', 'kind', 'does', 'price', 'island']);
  assert.equal(shown.does, 'A rope bridge from Home island to Mossy Hollow.');
  play.pick({ draft, work: state }, 'bridge', env);
  assert.deepEqual(draft.built.link, { from: 'home', to: 'isle-1', type: 'rope', land: { home: 40, 'isle-1': 30 } });
  assert.deepEqual(state.links, [{ id: draft.built.id, from: 'home', to: 'isle-1', type: 'rope', checkIn: 3, land: { home: 40, 'isle-1': 30 } }]);
});

test('fancy bridge surprises: a new link between open neighbours, else an upgrade, fewer than the islands', () => {
  const rules = R.DEFAULT_RULES;
  const { state, island, bridge } = bareState();
  const surprise = (key, number = 9) => play.fancyBridge(state, { number }, rules, key);
  assert.equal(surprise('k'), null, 'no islands, no bridges');
  island('isle-1', 'small', 30, 'mossy', { lift: 0.2 });
  island('isle-2', 'small', 33, 'rocky', { lift: -0.3 });
  // Open pairs: home-isle-1 and home-isle-2. A slide needs lifts 0.25 apart: never to isle-1 (0.2 above home).
  const types = {};
  for (let k = 0; k < 400; k++) {
    const { link, text } = surprise(`k${k}`);
    assert.equal(link.id, 'gift-9');
    assert.equal(link.from, 'home');
    assert.deepEqual(link.land, { home: 40, [link.to]: link.to === 'isle-1' ? 30 : 33 });
    assert.ok(link.type !== 'rope');
    if (link.type === 'slide') {
      assert.equal(link.to, 'isle-2');
      assert.equal(text, 'A water slide now runs from Home island down to isle-2.');
    }
    types[link.type] = (types[link.type] || 0) + 1;
  }
  assert.deepEqual(Object.keys(types).sort(), ['arch', 'cloudsteps', 'flowerarch', 'rainbow', 'slide']);
  assert.ok(types.rainbow < types.arch, 'the rainbow is rare');
  const arch = Array.from({ length: 50 }, (_, k) => surprise(`k${k}`)).find(s => s.link.type === 'arch');
  assert.equal(arch.text, `Overnight, a stone arch grew between Home island and ${arch.link.to}.`);
  // Every pair linked by rope: a surprise upgrades one, and only its type changes.
  bridge('home', 'isle-1');
  bridge('home', 'isle-2');
  const up = surprise('u1');
  assert.ok(['b1', 'b2'].includes(up.upgrade.link) && up.upgrade.type !== 'rope');
  const before = state.links.find(l => l.id === up.upgrade.link);
  const look = R.BRIDGE_TYPES[up.upgrade.type];
  assert.equal(up.text, `The rope bridge to ${before.to} turned into ${look.plural ? look.name : (/^[aeiou]/.test(look.name) ? 'an ' : 'a ') + look.name}.`);
  const kept = { ...before, land: { ...before.land } };
  play.applyRecord(state, { number: 9, collected: {}, newLand: [], landProgress: 0, surprise: { id: 'bridge', gifts: {}, island: 'home', upgrade: up.upgrade } }, 9, rules, R.DEFAULT_BLUEPRINTS);
  assert.deepEqual(state.links.find(l => l.id === up.upgrade.link), { ...kept, type: up.upgrade.type });
  // Fancy bridges stay fewer than the 2 islands besides home.
  play.applyRecord(state, { number: 10, collected: {}, newLand: [], landProgress: 0, surprise: { id: 'bridge', gifts: {}, island: 'home',
    upgrade: { link: state.links.find(l => l.type === 'rope').id, type: 'arch' } } }, 10, rules, R.DEFAULT_BLUEPRINTS);
  assert.equal(surprise('k'), null, 'two fancy bridges for two islands: the surprise falls back to seeds');
});

test('the game state shows each island\'s place and lift, and links with their type, check-in and land', () => {
  const state = sim.simulate('steady', [40])[40];
  assert.ok(state.islands.length >= 2);
  for (const island of state.islands) {
    assert.deepEqual(Object.keys(island), ['id', 'name', 'kind', 'size', 'land', 'golden', 'ring', 'angle', 'lift', 'buildings', 'keepsakes']);
  }
  assert.deepEqual(state.islands.map(i => [i.ring, i.angle]), state.islands.map((_, n) => [sky.placeOf(n).ring, sky.placeOf(n).angle]));
  assert.equal(state.islands[0].lift, 0);
  assert.ok(state.links.length >= 1, 'the steady planner has joined its first island by day 40');
  for (const link of state.links) {
    assert.deepEqual(Object.keys(link), ['id', 'from', 'to', 'type', 'checkIn', 'land']);
    assert.deepEqual(Object.keys(link.land).sort(), [link.from, link.to].sort());
    assert.ok(sky.neighboursOf(link.to, state.islands).some(n => n.id === link.from), `${link.id} joins neighbours`);
  }
});

test("today: what today's check-ins collected, gifts included and spending not taken off; it starts at zero each day", () => {
  const h = setup().start();
  const nothing = state => Object.values(state.today).every(amount => amount === 0);
  h.focus(60); h.rest(10); h.grants();
  assert.ok(nothing(h.state()), 'a waiting card is not counted until it is collected');
  const records = [h.checkIn(h.state().checkIn.choice.options[0].job)];
  h.focus(60); h.rest(10); h.grants();
  const card = h.state().checkIn;
  assert.equal(card.choice?.kind, 'build');
  records.push(h.checkIn(card.choice.options[0].blueprint));
  const expected = {};
  for (const { payload } of records) {
    for (const amounts of [payload.collected, payload.surprise?.gifts]) {
      for (const [resource, amount] of Object.entries(amounts || {})) expected[resource] = (expected[resource] || 0) + amount;
    }
  }
  const after = h.state();
  for (const resource of Object.keys(after.today)) assert.ok(Math.abs(after.today[resource] - (expected[resource] || 0)) < 0.01, resource);
  assert.ok(after.onHand.wood < after.today.wood, 'the building was paid for out of what was on hand, not out of today');
  h.nextDay();
  assert.ok(nothing(h.state()));
  assert.equal(h.state().onHand.wood, after.onHand.wood);
});

// ---- History: what happened on each day (days.js).

test('History days: earned counts grants by their day, waiting cards included, plus gifts; sessions and real breaks on plan', () => {
  const h = setup().start();
  const sumGrants = dayKey => {
    const total = Object.fromEntries(R.RESOURCES.map(r => [r, 0]));
    for (const event of h.events) {
      if (event.kind !== 'gameGranted' || event.payload.dayKey !== dayKey) continue;
      for (const [r, n] of Object.entries(event.payload.amounts)) total[r] += n;
    }
    for (const event of h.events) {
      if (event.kind !== 'gameCheckedIn' || event.payload.dayKey !== dayKey) continue;
      for (const [r, n] of Object.entries(event.payload.surprise?.gifts || {})) total[r] += n;
    }
    return total;
  };
  const close = (actual, expected) => R.RESOURCES.every(r => Math.abs(actual[r] - expected[r]) < 0.01);
  const fresh = h.state().todaySummary;
  assert.deepEqual(fresh, { dayKey: '2026-01-05', focusSessions: 0, onPlanSessions: 0, realBreaks: 0, plannedSessions: 6,
    planMatch: null, planFit: null, checkIns: 0, happenings: [], earned: { wood: 0, stone: 0, planks: 0, soil: 0, saplings: 0, starlight: 0 } });

  h.focus(60); h.rest(10); h.focus(30); h.rest(2); h.focus(60, { reason: 'snooze' }); h.grants();
  let day = h.state().todaySummary;
  assert.equal(day.focusSessions, 3);
  assert.equal(day.onPlanSessions, 1, 'a session far from its planned length and a snooze are not on plan');
  assert.equal(day.realBreaks, 1, 'a 2-minute break is too short to be real');
  assert.ok(h.state().checkIn, 'a card is waiting');
  assert.ok(day.earned.wood > 0 && day.earned.soil > 0 && day.earned.starlight === 1, 'what the waiting card holds is already earned');
  assert.ok(close(day.earned, sumGrants('2026-01-05')));
  assert.equal(day.checkIns, 0);

  const pick = h.state().checkIn.choice.options[0].job;
  h.checkIn(pick);
  day = h.state().todaySummary;
  assert.equal(day.checkIns, 1);
  assert.deepEqual(day.happenings.filter(item => item.kind === 'job'), [{ kind: 'job', helper: 'Pip', job: R.JOBS[pick].name }]);
  assert.ok(close(day.earned, sumGrants('2026-01-05')), 'collecting a card changes nothing that was earned');

  h.endDay(); h.grants();
  const dayGrant = grantFor(h, 'game:grant:day:2026-01-05');
  day = h.state().todaySummary;
  assert.equal(day.planMatch, dayGrant.payload.planMatch);
  assert.equal(day.planFit, day.planMatch >= R.DEFAULT_RULES.onPlanDayThreshold ? 'on' : day.planMatch >= R.DEFAULT_RULES.nearPlanDayThreshold ? 'near' : 'off');
  assert.ok(close(day.earned, sumGrants('2026-01-05')), 'the day grant is earned on its day');

  h.nextDay();
  assert.equal(h.state().todaySummary.dayKey, '2026-01-06');
  assert.equal(h.state().todaySummary.focusSessions, 0);
  assert.ok(R.RESOURCES.every(r => h.state().todaySummary.earned[r] === 0), 'a new day starts at zero');
  const [past] = game.daySummaries(h.events, h.ctx({ planFor: undefined }), ['2026-01-05']);
  assert.deepEqual({ ...past, plannedSessions: 6 }, { ...day, checkIns: past.checkIns, happenings: past.happenings },
    'the same day reads the same later; without plans it just has no planned sessions');
  assert.equal(past.plannedSessions, null);
  assert.equal(game.daySummaries(setup().events, h.ctx(), ['2026-01-05']), null, 'nothing before the game starts');
});

test('History days: buildings, helpers, new islands, surprises and new land, each on the day of its check-in', () => {
  const result = sim.run('steady', 21);
  const keys = Array.from({ length: 21 }, (_, i) => MD.dayKeyFor(i + 1));
  const ctx = { todayKey: MD.dayKeyFor(22), dayKeyOf: MD.dayKeyOf };
  const days = game.daySummaries(result.events, ctx, keys);
  assert.deepEqual(game.daySummaries(JSON.parse(JSON.stringify(result.events)), ctx, keys), days, 'the same events give the same days');
  const state = game.gameState(result.events, ctx);
  const all = days.flatMap(day => day.happenings);
  const of = kind => all.filter(item => item.kind === kind);
  assert.equal(days.reduce((n, day) => n + day.checkIns, 0), result.log.length);
  assert.deepEqual(of('built').map(item => item.name), result.log.filter(l => l.built).map(l => l.built.name));
  assert.deepEqual(of('island').map(item => item.name), state.islands.slice(1).map(island => island.name));
  assert.ok(of('island').every(item => typeof item.label === 'string'));
  assert.deepEqual(of('arrived').map(item => item.helper), state.helpers.slice(1).map(helper => helper.name));
  assert.deepEqual(of('job').map(item => item.helper).sort(), state.helpers.filter(helper => helper.job).map(helper => helper.name).sort());
  assert.deepEqual(of('surprise').map(item => item.text), result.log.filter(l => l.surprise).map(l => l.surprise.text));
  const names = new Set(state.islands.map(island => island.name));
  for (const item of of('built')) {
    if (item.between) assert.ok(item.between.every(name => names.has(name)) && item.island === null, 'a bridge names both islands');
    else assert.ok(names.has(item.island));
  }
  for (const day of days) {
    const grew = day.happenings.filter(item => item.kind === 'grew');
    assert.equal(new Set(grew.map(item => item.island)).size, grew.length, 'one line per island per day');
    assert.ok(grew.every(item => names.has(item.island) && item.amount > 0));
  }
  const land = result.log.reduce((n, l) => n + (l.newLand || []).reduce((m, grown) => m + grown.amount, 0), 0);
  assert.ok(Math.abs(of('grew').reduce((n, item) => n + item.amount, 0) - land) < 0.05);
  // Everything earned over the days, less what was spent, is what's on hand now (plus the starting pouch).
  for (const r of R.RESOURCES) {
    const earned = days.reduce((n, day) => n + day.earned[r], 0);
    const spent = result.log.reduce((n, l) => n + (l.built?.price?.[r] || 0), 0);
    const start = { soil: 40, saplings: 25 }[r] || 0;
    const waiting = state.waiting[r] || 0;
    assert.ok(Math.abs(start + earned - spent - waiting - state.onHand[r]) < 0.1, r);
  }
  assert.ok(days.filter(day => day.planMatch !== null).every(day => ['on', 'near', 'off'].includes(day.planFit)));
});
