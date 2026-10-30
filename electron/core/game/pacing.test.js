// Long-run pacing: months of made-up days through the real rules, checked against the design's
// targets and against the pacing prototype's own replay of the same days.
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const game = require('./index');
const R = require('./rules');
const MD = require('./made-up-days');
const sim = require('./simulate');

const DAYS = 180;
const PROTOTYPE = join(__dirname, '..', '..', '..', '.build', 'prototype-ref', 'game', 'prototypes', 'pacing-prototype.html');
const runs = {};
const runFor = id => (runs[id] ||= sim.run(id, DAYS));

test('steady planner: about 3 choices on day 1, the first island around active day 7-9, the first wonder in weeks 2-3', t => {
  const m = sim.milestones(runFor('steady'));
  t.diagnostic(JSON.stringify(m));
  assert.ok(m.dayOneChoices >= 2 && m.dayOneChoices <= 4, `day 1 choices: ${m.dayOneChoices}`);
  assert.ok(m.islandDays[0].activeDay >= 7 && m.islandDays[0].activeDay <= 9, `first island on active day ${m.islandDays[0].activeDay}`);
  assert.ok(m.wonderDays[0].day >= 8 && m.wonderDays[0].day <= 21, `first wonder on day ${m.wonderDays[0].day}`);
  assert.ok(m.wonderDays.length >= 4, 'roughly one wonder a month after the first');
  assert.ok(m.choicesPerWeekMonth3 >= 2.5 && m.choicesPerWeekMonth3 <= 5, `about one choice every workday or two: ${m.choicesPerWeekMonth3} a week`);
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
  }
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

// The prototype's SkyRules and MadeUpDays, run from its HTML with today's numbers.
function prototypeModules() {
  const html = readFileSync(PROTOTYPE, 'utf8');
  const grab = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
  return new Function(`${grab('sky-rules')}\n${grab('made-up-days')}\nreturn { SkyRules, MadeUpDays };`)();
}

test('matches the pacing prototype run on the same made-up days', { skip: !existsSync(PROTOTYPE) && 'prototype export not found' }, t => {
  const { SkyRules, MadeUpDays } = prototypeModules();
  const rules = JSON.parse(JSON.stringify(R.DEFAULT_RULES)), blueprints = JSON.parse(JSON.stringify(R.DEFAULT_BLUEPRINTS));
  const rows = [];
  for (const person of MD.PEOPLE) {
    const madeUp = MadeUpDays.days(person.id, DAYS, MD.SEED);
    assert.deepEqual(madeUp, MD.days(person.id, DAYS), `${person.id}: the made-up days are the prototype's`);
    const proto = SkyRules.replay(madeUp, rules, blueprints, MD.SEED);
    const pt = proto.timeline;
    const protoWonders = proto.state.buildings.filter(b => b.kind === 'wonder').map(b => b.builtDay);
    const protoIslands = proto.state.islands.slice(1).map(i => i.arrivedDay);
    const p = {
      dayOneChoices: pt[1].choicesToday,
      choicesPerWeekMonth3: Math.round(SkyRules.sumOver(pt, 'choicesToday', 61, 90) / (30 / 7) * 10) / 10,
      helpers: pt[DAYS].helpers, buildings: pt[DAYS].buildings,
    };
    const m = sim.milestones(runFor(person.id));
    const mine = { islands: m.islandDays.map(x => x.day), wonders: m.wonderDays.map(x => x.day) };
    rows.push(`${person.id}: day-1 choices ${m.dayOneChoices} (prototype ${p.dayOneChoices}); islands ${mine.islands.join(',')} (${protoIslands.join(',')}); ` +
      `wonders ${mine.wonders.join(',') || 'none'} (${protoWonders.join(',') || 'none'}); choices/week month 3 ${m.choicesPerWeekMonth3} (${p.choicesPerWeekMonth3}); ` +
      `helpers ${m.helpers} (${p.helpers}); buildings ${m.buildings} (${p.buildings})`);
    assert.deepEqual(mine.islands, protoIslands, `${person.id}: islands arrive on the same days`);
    assert.ok(Math.abs(m.dayOneChoices - p.dayOneChoices) <= 1, `${person.id}: day-1 choices`);
    assert.equal(mine.wonders.length > 0, protoWonders.length > 0, `${person.id}: wonders reached or not`);
    // Only on-plan sessions take one of the day's planned Starlight places (the prototype counted every
    // session). Someone with 9-10 uneven sessions a day earns more Starlight, so their first wonder
    // can come earlier (day 88 against the prototype's 110), never later.
    if (mine.wonders.length && person.id === 'long') assert.ok(mine.wonders[0] <= protoWonders[0] + 7, `${person.id}: first wonder no later than a week after`);
    else if (mine.wonders.length) assert.ok(Math.abs(mine.wonders[0] - protoWonders[0]) <= 7, `${person.id}: first wonder within a week`);
    assert.ok(Math.abs(m.helpers - p.helpers) <= 2, `${person.id}: helpers`);
    assert.ok(Math.abs(m.buildings - p.buildings) <= 0.1 * p.buildings, `${person.id}: buildings`);
    // Check-ins now come after breaks instead of after every focus session, so someone who skips
    // most breaks gets fewer choices. Everyone else should stay close.
    if (person.id !== 'skipper') assert.ok(Math.abs(m.choicesPerWeekMonth3 - p.choicesPerWeekMonth3) <= 1, `${person.id}: choices per week`);
    else assert.ok(m.choicesPerWeekMonth3 <= p.choicesPerWeekMonth3);
  }
  for (const row of rows) t.diagnostic(row);
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
