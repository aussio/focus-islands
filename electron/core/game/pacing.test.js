// Long-run pacing: months of made-up days through the real rules, checked against the design's targets.
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('./index');
const R = require('./rules');
const MD = require('./made-up-days');
const sim = require('./simulate');
const { roomProblems, blocksOn } = require('./room-check');
const sky = require('./sky');

const DAYS = 180;
const runs = {};
const runFor = id => (runs[id] ||= sim.run(id, DAYS, { snapshots: [DAYS] }));

test('steady planner: about 3 choices on day 1, the first island around active day 7-9, the first wonder in weeks 2-3', t => {
  const m = sim.milestones(runFor('steady'));
  t.diagnostic(JSON.stringify(m));
  assert.ok(m.dayOneChoices >= 2 && m.dayOneChoices <= 4, `day 1 choices: ${m.dayOneChoices}`);
  assert.ok(m.islandDays[0].activeDay >= 7 && m.islandDays[0].activeDay <= 9, `first island on active day ${m.islandDays[0].activeDay}`);
  assert.ok(m.wonderDays[0].day >= 8 && m.wonderDays[0].day <= 21, `first wonder on day ${m.wonderDays[0].day}`);
  assert.ok(m.wonderDays.length >= 4, 'roughly one wonder a month after the first');
  // Homes are offered whenever they fit (decision 7), so month 3 runs a little busier than the old 2.5 to 5.
  assert.ok(m.choicesPerWeekMonth3 >= 2.5 && m.choicesPerWeekMonth3 <= 6, `about one choice every workday: ${m.choicesPerWeekMonth3} a week`);
  assert.ok(m.surprisesPerWeek >= 1 && m.surprisesPerWeek <= 4, `a few surprises a week: ${m.surprisesPerWeek}`);
});

test('every person: saved records stay clean and every offer is a real choice', () => {
  for (const person of MD.PEOPLE) {
    const result = runFor(person.id);
    const keys = result.events.filter(e => e.uniqueKey).map(e => e.uniqueKey);
    assert.equal(new Set(keys).size, keys.length, `${person.id}: no unique key twice`);
    for (const record of result.log) {
      if (record.choice?.kind === 'build') {
        const kinds = record.choice.options.map(o => R.DEFAULT_BLUEPRINTS.find(bp => bp.id === o.blueprint).kind);
        assert.equal(new Set(kinds).size, kinds.length, `${person.id} check-in ${record.number}: one blueprint per kind`);
        assert.ok(kinds.length >= 2 || kinds[0] === 'wonder', `${person.id} check-in ${record.number}: never a pointless choice`);
        assert.ok(kinds.length <= 3);
      }
      assert.ok(record.job === null || record.built === null, 'at most one choice per check-in');
    }
    const end = result.timeline.at(-1);
    for (const r of R.RESOURCES) assert.ok(end.onHand[r] >= -0.01, `${person.id}: ${r} never goes below zero`);
    // Every building fit the room its island had when it was built, so the town layout never needs extra land.
    for (const island of result.states[DAYS].islands) assert.deepEqual(roomProblems(island), [], `${person.id} ${island.id}`);
  }
});

test('steady planner: by day 180 the islands read as a town, with at least 20 blocks and 8 on home', t => {
  const state = runFor('steady').states[DAYS];
  const blocks = state.islands.map(island => [island.id, blocksOn(island)]);
  t.diagnostic(JSON.stringify(blocks));
  const total = blocks.reduce((n, [, b]) => n + b, 0);
  assert.ok(total >= 20, `${total} blocks`);
  assert.ok(blocks[0][1] >= 8, `${blocks[0][1]} blocks on home`);
  const count = id => state.islands.reduce((n, island) => n + island.buildings.filter(b => b.blueprint === id).length, 0);
  t.diagnostic(`houses ${count('house')}, rooms ${count('room')}, floors ${count('floor')}`);
  assert.ok(count('room') >= 2 * count('house') && count('floor') >= count('house'), 'houses grow by rooms and floors more than they start');
});

test('steady planner: by day 180 every island feels lived in, and home holds at most 60% of the blocks', t => {
  const result = runFor('steady'), state = result.states[DAYS];
  const arrivedOn = k => (k ? result.timeline.find(day => day.islands > k).day : 0);
  const rows = state.islands.map((island, k) => ({ id: island.id, age: DAYS - arrivedOn(k), land: island.land,
    buildings: island.buildings.filter(b => b.blueprint !== 'flowers').length, blocks: blocksOn(island) }));
  t.diagnostic(JSON.stringify(rows));
  for (const row of rows) {
    if (row.age >= 30) assert.ok(row.buildings >= 3, `${row.id}, ${row.age} days old: ${row.buildings} buildings besides flower beds`);
  }
  const total = rows.reduce((n, row) => n + row.blocks, 0);
  assert.ok(rows[0].blocks <= 0.6 * total, `home has ${rows[0].blocks} of ${total} blocks`);
});

test('every person: home has the most land on every day', () => {
  for (const person of MD.PEOPLE) {
    for (const day of runFor(person.id).timeline) {
      const [home, ...others] = day.land;
      assert.ok(others.every(land => land < home), `${person.id} day ${day.day}: land ${day.land.join(', ')}`);
    }
  }
});

test('steady planner: by day 180 islands differ in size, all are joined with a loop, and 2 to 4 bridges are fancy', t => {
  const state = runFor('steady').states[DAYS];
  const land = state.islands.slice(1).map(island => island.land);
  t.diagnostic(`land ${state.islands.map(i => i.land).join(', ')}; links ${state.links.map(l => `${l.from}-${l.to} ${l.type}`).join(', ')}`);
  assert.ok(land.length >= 2 && Math.max(...land) >= 1.4 * Math.min(...land), `new islands' land: ${land.join(', ')}`);
  assert.equal(sky.joinedSet(state.islands, state.links).size, state.islands.length, 'every island is joined to home');
  assert.ok(state.links.length >= state.islands.length, 'at least one loop: more links than a plain chain needs');
  const fancy = state.links.filter(link => link.type !== 'rope').length;
  assert.ok(fancy >= 2 && fancy <= 4, `${fancy} fancy bridges`);
  for (const link of state.links) assert.ok(sky.neighboursOf(link.to, state.islands).some(n => n.id === link.from), `${link.id} joins sky-table neighbours`);
});

test('vacation pauses the island clock, and skipping breaks piles up materials without taking anything away', () => {
  const vacation = runFor('vacation').timeline;
  const before = vacation[34], back = vacation[48];
  assert.deepEqual([back.activeDays, back.islands, back.helpers], [before.activeDays, before.islands, before.helpers]);
  const steady = runFor('steady').timeline.at(-1), skipper = runFor('skipper').timeline.at(-1);
  const materials = s => s.onHand.wood + s.onHand.stone + s.onHand.planks, growth = s => s.onHand.soil + s.onHand.saplings;
  assert.ok(materials(skipper) / growth(skipper) > 2 * materials(steady) / growth(steady), 'materials pile up when breaks are skipped');
  assert.ok(skipper.buildings < steady.buildings && skipper.islands < steady.islands);
});

// Six months with the app's 30-second progress records, about 100,000 events.
function withProgressRecords(events) {
  const out = [], renumber = new Map();
  const push = event => { out.push(event); renumber.set(event.sequence, out.length); };
  for (const event of events) {
    if (event.kind === 'focusEnded' || event.kind === 'breakEnded') {
      const kind = event.kind === 'focusEnded' ? 'focusResumed' : 'breakProgress', base = Date.parse(event.occurredAt) - event.payload.elapsedSeconds * 1000;
      for (let s = 30; s < event.payload.elapsedSeconds; s += 30) {
        out.push({ sequence: 0, id: `P${out.length}`, kind, occurredAt: new Date(base + s * 1000).toISOString(), source: 'system',
          payload: { sessionID: event.payload.sessionID, targetSeconds: event.payload.targetSeconds, elapsedSeconds: s }, uniqueKey: null });
      }
    }
    push({ ...event });
  }
  out.forEach((event, i) => { event.sequence = i + 1; });
  for (const event of out) if (event.kind === 'gameCheckedIn') event.payload = { ...event.payload, covered: renumber.get(event.payload.covered) };
  return out;
}

test('six months of history stays well under 20 ms for dueGrants and gameState', t => {
  const events = withProgressRecords(runFor('steady').events);
  assert.ok(events.length > 90000, `${events.length} events`);
  const ctx = { now: '2026-07-04T08:00:00.000Z', todayKey: MD.dayKeyFor(DAYS + 1), dayKeyOf: MD.dayKeyOf, planFor: () => ({ focusSessions: 6, focusMinutes: 60, breakMinutes: 10 }) };
  const reference = game.gameState(runFor('steady').events, ctx);
  assert.deepEqual({ ...game.gameState(events, ctx), change: reference.change }, reference, 'progress records change nothing');
  const time = fn => { fn(); fn(); const t0 = performance.now(); for (let i = 0; i < 10; i++) fn(); return (performance.now() - t0) / 10; };
  const grantsMs = time(() => game.dueGrants(events, ctx)), stateMs = time(() => game.gameState(events, ctx));
  t.diagnostic(`${events.length} events: dueGrants ${grantsMs.toFixed(2)} ms, gameState ${stateMs.toFixed(2)} ms`);
  assert.ok(grantsMs < 20, `dueGrants took ${grantsMs} ms`);
  assert.ok(stateMs < 20, `gameState took ${stateMs} ms`);
});
