const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const game = require('./index');
const play = require('./play');
const R = require('./rules');
const { scan } = require('./history');
const MD = require('./made-up-days');
const sim = require('./simulate');

// A frozen history saved by the rules at git 78be455 (a steady player, 12 days, two islands), kept
// outside electron/ so the app never ships it. `expected` is what those rules folded it into. Today's
// rules must replay it to the same town, and its next check-in must add only the one-time land top-up.
const saved = JSON.parse(readFileSync(join(__dirname, '../../../development-tools/old-saves/main-78be455-steady.json'), 'utf8'));

function town(s) {
  return { checkIns: s.checkIns, onHand: s.onHand, landProgress: s.landProgress,
    islands: s.islands.map(i => ({ id: i.id, kind: i.kind, size: i.size, land: i.land, used: i.used, golden: i.golden,
      buildings: i.buildings, keepsakes: i.keepsakes })),
    links: s.links, helpers: s.helpers, wonders: s.wonders, counts: s.counts };
}
const fold = (events, rules = R.DEFAULT_RULES) => play.fold(scan(events), rules, R.DEFAULT_BLUEPRINTS);

// One more day with a focus session and a break, then its grants, ready for a check-in.
function anotherDay(history, day) {
  const at = minutes => new Date(Date.UTC(2026, 0, 4 + day, 8, minutes)).toISOString();
  const ctx = { now: at(80), todayKey: MD.dayKeyFor(day), dayKeyOf: MD.dayKeyOf, planFor: () => ({ focusSessions: 6, focusMinutes: 60, breakMinutes: 10 }) };
  const f = `old-f${day}`, b = `old-b${day}`;
  history.append('focusStarted', { sessionID: f, targetSeconds: 3600, reason: 'suggestion' }, at(0));
  history.append('focusEnded', { sessionID: f, targetSeconds: 3600, elapsedSeconds: 3600 }, at(60));
  history.append('breakStarted', { sessionID: b, targetSeconds: 600, followsSessionID: f }, at(60));
  const rest = { sessionID: b, targetSeconds: 600, elapsedSeconds: 600 };
  history.append('breakConfirmed', rest, at(70));
  history.append('breakEnded', rest, at(70));
  game.dueGrants(history.events, ctx).forEach(history.appendRecord);
  return { history, ctx };
}
function oldSaveWithAnotherDay() {
  const history = MD.createHistory();
  for (const e of saved.events) history.append(e.kind, e.payload, e.occurredAt, e.uniqueKey ?? null);
  return anotherDay(history, 13);
}
function checkIn({ history, ctx }) {
  const view = game.gameState(history.events, ctx);
  const record = game.checkInRecord(history.events, ctx, { token: view.checkIn.token });
  history.appendRecord(record);
  return { view, record };
}

test('a history saved by older rules replays to the same town under today\'s rules', () => {
  assert.equal(saved.events[0].payload.laneShareOfLand, undefined, 'the old start record has no lane share');
  assert.deepEqual(town(fold(saved.events)), saved.expected);
});

test('an older game gets one land top-up at its next check-in, and nothing else changes', () => {
  const before = fold(saved.events);
  const old = { ...R.DEFAULT_RULES, laneShareOfLand: R.FIRST_LANE_SHARE };
  const save = oldSaveWithAnotherDay();
  const { view, record } = checkIn(save);
  const topUp = record.payload.landTopUp;
  assert.deepEqual({ from: topUp.from, to: topUp.to }, { from: R.FIRST_LANE_SHARE, to: R.DEFAULT_RULES.laneShareOfLand });
  assert.deepEqual(topUp.land.map(g => g.island), before.islands.map(i => i.id), 'every island grows');
  for (const { island: id, amount } of topUp.land) {
    const island = before.islands.find(i => i.id === id), land = island.land + amount;
    // The fewest whole points that give at least the room the island had under the old share.
    assert.ok(R.roomOf(land, 0, R.DEFAULT_RULES) >= R.roomOf(island.land, 0, old) - 1e-9, id);
    assert.ok(R.roomOf(land - 1, 0, R.DEFAULT_RULES) < R.roomOf(island.land, 0, old), id);
  }
  // One quiet line on the card, kept apart from the usual "grew" lines.
  assert.ok(view.checkIn.moments.includes(R.LAND_TOP_UP_TEXT.many));

  // Replay adds the saved amounts to the saved buildings, which keep their land when built.
  const after = fold(save.history.events);
  assert.equal(after.laneShare, R.DEFAULT_RULES.laneShareOfLand);
  for (const island of after.islands) {
    const was = before.islands.find(i => i.id === island.id);
    const grew = (topUp.land.find(g => g.island === island.id)?.amount ?? 0) + (record.payload.newLand.find(g => g.island === island.id)?.amount ?? 0);
    assert.equal(island.land, was.land + grew, island.id);
    assert.deepEqual(island.buildings.slice(0, was.buildings.length), was.buildings, island.id);
  }

  // Replay reads the record, not the rules: another lane share later does not change the saved amounts.
  const otherShare = fold(save.history.events, { ...R.DEFAULT_RULES, laneShareOfLand: 0.3 });
  assert.deepEqual(otherShare.islands.map(i => i.land), after.islands.map(i => i.land));

  // It happens once.
  const again = checkIn(anotherDay(save.history, 14));
  assert.equal(again.record.payload.landTopUp, undefined);
  assert.ok(!again.view.checkIn.moments.includes(R.LAND_TOP_UP_TEXT.many));
});

test('the top-up is part of the card, so its token covers it', () => {
  const save = oldSaveWithAnotherDay();
  const facts = scan(save.history.events), env = { rules: R.DEFAULT_RULES, blueprints: R.DEFAULT_BLUEPRINTS, dayKeyOf: MD.dayKeyOf, now: save.ctx.now };
  const state = play.fold(facts, env.rules, env.blueprints);
  const withTopUp = play.prepare(state, facts, env);
  // The same card for a game that already settled: everything but the top-up matches, and the token differs.
  const settled = play.prepare({ ...state, laneShare: R.DEFAULT_RULES.laneShareOfLand }, facts, env);
  assert.ok(withTopUp.draft.landTopUp && !settled.draft.landTopUp);
  assert.notEqual(withTopUp.draft.token, settled.draft.token);
});

test('a new game never gets a land top-up', () => {
  assert.equal(game.startRecord({ now: '2026-01-05T07:00:00.000Z' }).payload.laneShareOfLand, R.DEFAULT_RULES.laneShareOfLand);
  for (const person of ['steady', 'skipper']) {
    const run = sim.run(person, 30);
    assert.ok(run.events.some(e => e.kind === 'gameCheckedIn'));
    assert.ok(run.events.every(e => e.kind !== 'gameCheckedIn' || e.payload.landTopUp === undefined), person);
  }
});
