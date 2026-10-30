// The town layout on real rules (game/BUILD_PLAN.md, "What gets tested": town.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildTown, checkTown, compareTowns, forgetTowns } from './index.js';
import { checkShape, townKey } from './shape.js';
import { sampleTown, SAMPLE_NAMES } from './samples.js';
import { KINDS } from '../kinds.js';

const require = createRequire(import.meta.url);
const sim = require('../../../core/game/simulate.js');
const sky = require('../../../core/game/sky.js');

// Steady's states at a few days, once for the whole file.
const STEADY = sim.run('steady', 135, { snapshots: [1, 7, 30, 60, 135] }).states;
const copy = value => JSON.parse(JSON.stringify(value));

test('the same state gives a deep-equal world, with the same grids', () => {
  for (const day of [1, 60, 135]) {
    const first = buildTown(copy(STEADY[day]));
    forgetTowns();
    const again = buildTown(copy(STEADY[day]));
    assert.equal(townKey(again), townKey(first), `day ${day}`);
    first.islands.forEach((island, i) => assert.equal(again.islands[i].grid, island.grid, `day ${day}: ${island.id}'s grid`));
    assert.deepEqual(buildTown(STEADY[day]), again, `day ${day}, from the cache`);
  }
});

test('real states and the samples pass checkTown', () => {
  for (const day of [1, 7, 30, 60, 135]) {
    const world = buildTown(STEADY[day]);
    assert.deepEqual(checkShape(world), [], `day ${day}`);
    assert.deepEqual(checkTown(world), [], `day ${day}`);
  }
  for (const name of SAMPLE_NAMES) assert.deepEqual(checkTown(sampleTown(name)), [], name);
});

test('day 1 fits on home without borrowing', () => {
  const world = buildTown(STEADY[1]);
  const home = world.islands.find(i => i.id === 'home');
  assert.equal(home.borrowed, 0);
  assert.equal(home.land.length, STEADY[1].islands[0].land);
  for (const b of STEADY[1].islands[0].buildings) assert.ok(world.things.some(t => t.id === b.id) || home.houses.some(h => h.id === b.id), `${b.id} placed`);
});

// One more check-in that changes one thing, made by hand from the day-135 state.
function changed(change) {
  const game = copy(STEADY[135]);
  const last = Math.max(0, ...game.islands.flatMap(i => i.buildings.map(b => b.checkIn)), ...game.links.map(l => l.checkIn));
  const add = (islandId, blueprint, id) => {
    const island = game.islands.find(i => i.id === islandId);
    island.buildings.push({ id, blueprint, landWhenBuilt: island.land, checkIn: last + 1 });
  };
  change(game, { add, last });
  return game;
}

const blocksOf = world => world.islands.flatMap(i => i.houses.flatMap(h => h.blocks));
const floorsOf = world => blocksOf(world).reduce((sum, b) => sum + b.floors, 0);

const CHANGES = {
  'one land point': [game => { game.islands[0].land += 1; }, (before, after) => assert.equal(after.islands[0].land.length, before.islands[0].land.length + 1)],
  'one room': [(game, { add }) => add('home', 'room', 'test-room'), (before, after) => assert.equal(blocksOf(after).length, blocksOf(before).length + 1)],
  'one floor': [(game, { add }) => add('home', 'floor', 'test-floor'), (before, after) => assert.equal(floorsOf(after), floorsOf(before) + 1)],
  'a new house': [(game, { add }) => add('isle-1', 'house', 'test-house'), (before, after) => assert.ok(after.islands[1].houses.some(h => h.id === 'test-house' && h.blocks.length === 2))],
  'a pad': [(game, { add }) => add('home', 'windmill', 'test-pad'), (before, after) => assert.ok(after.things.some(t => t.id === 'test-pad' && t.pad))],
  'a coast building': [(game, { add }) => add('isle-1', 'lighthouse', 'test-coast'), (before, after) => assert.ok(after.things.some(t => t.id === 'test-coast' && t.coast))],
  'a rope bridge': [(game, { last }) => game.links.push(link(game, 'test-rope', 'rope', last + 1)), (before, after) => assert.equal(after.bridges.length, before.bridges.length + 1)],
  'a fancy bridge from a surprise': [(game, { last }) => game.links.push(link(game, 'test-gift', 'rainbow', last + 1)), (before, after) => assert.ok(after.bridges.some(b => b.id === 'test-gift' && b.type === 'rainbow'))],
};

// A link between the first neighbour pair the table allows that isn't joined yet.
function link(game, id, type, checkIn) {
  const pair = sky.neighbourPairs(game.islands).find(p => !sky.linked(p.from, p.to, game.links));
  assert.ok(pair, 'a neighbour pair is free to join');
  const land = id => game.islands.find(i => i.id === id).land;
  return { id, from: pair.from, to: pair.to, type, checkIn, land: { [pair.from]: land(pair.from), [pair.to]: land(pair.to) } };
}

test('single changes keep every promise', () => {
  const before = buildTown(STEADY[135]);
  for (const [name, [change, expect]] of Object.entries(CHANGES)) {
    const after = buildTown(changed(change));
    assert.deepEqual(checkTown(after), [], name);
    assert.deepEqual(compareTowns(before, after), [], name);
    expect(before, after);
    for (const island of after.islands) assert.equal(island.borrowed, before.islands.find(i => i.id === island.id).borrowed, `${name}: ${island.id} borrowed`);
  }
});

test('an upgrade changes only that bridge type', () => {
  const before = buildTown(STEADY[135]);
  const id = STEADY[135].links[0].id;
  const after = buildTown(changed(game => { game.links[0].type = 'rainbow'; }));
  assert.deepEqual(compareTowns(before, after), []);
  const expected = JSON.parse(townKey(before));
  expected.bridges.find(b => b.id === id).type = 'rainbow';
  assert.equal(townKey(after), JSON.stringify(expected));
});

test('a water slide lists its higher end first', () => {
  const game = changed((g, { last }) => g.links.push(link(g, 'test-slide', 'slide', last + 1)));
  const world = buildTown(game);
  const slide = world.bridges.find(b => b.id === 'test-slide');
  const lift = id => world.islands.find(i => i.id === id).lift;
  assert.ok(lift(slide.from.island) > lift(slide.to.island));
  // compareTowns matches ends by island, so listing them the other way round isn't a move.
  const flipped = { ...world, bridges: world.bridges.map(b => (b.id === 'test-slide' ? { ...b, from: b.to, to: b.from } : b)) };
  assert.deepEqual(compareTowns(flipped, world), []);
});

test('checkTown and compareTowns find broken worlds', () => {
  const world = buildTown(STEADY[135]);
  const home = world.islands[0];
  const broken = copy({ ...world, islands: [] });
  const withIslands = islands => ({ ...broken, islands });
  // A house's door that no longer opens onto a lane.
  const door = home.houses[0].door.outside;
  const noLane = withIslands([{ ...home, lanes: home.lanes.filter(p => p !== door) }, ...world.islands.slice(1)]);
  assert.ok(checkTown(noLane).some(text => text.includes('lane')));
  assert.ok(compareTowns(world, noLane).some(text => text.includes('lost lane')));
  // An island pulled toward home.
  const pulled = withIslands([home, { ...world.islands[1], at: world.islands[1].at.map(v => v * 0.5) }, ...world.islands.slice(2)]);
  assert.ok(checkTown(pulled).some(text => text.includes('apart')));
  assert.ok(compareTowns(world, pulled).some(text => text.includes('closer to home')));
  // A built thing that moved, and a foot that moved inland.
  const pad = world.things.find(t => t.pad);
  const moved = { ...broken, islands: world.islands, things: world.things.map(t => (t === pad ? { ...t, yaw: t.yaw + 0.5 } : t)) };
  assert.ok(compareTowns(world, moved).some(text => text.includes(`${pad.id} changed its yaw`)));
  const bridge = world.bridges[0];
  const inland = home.land.find(p => home.grid.neighbours[p].every(q => home.land.includes(q)) && home.lanes.includes(p));
  const foot = { ...broken, islands: world.islands, bridges: world.bridges.map(b => (b === bridge ? { ...b, from: { ...b.from, point: inland } } : b)) };
  assert.ok(checkTown(foot).some(text => text.includes('coast')));
  assert.ok(compareTowns(world, foot).some(text => text.includes('moved')));
  // A pad that covers a lane.
  const onLane = { ...broken, islands: world.islands, things: world.things.map(t => (t === pad ? { ...t, points: [home.lanes[0], ...t.points.slice(1)] } : t)) };
  assert.ok(checkTown(onLane).length > 0);
  assert.ok(KINDS[pad.kind].pad);
});

test('a foot moves out along its pier as the land grows, and only that way', () => {
  const before = buildTown(STEADY[60]), after = buildTown(STEADY[135]);
  const moved = before.bridges.flatMap(b => {
    const now = after.bridges.find(x => x.id === b.id);
    return [b.from, b.to].filter(end => [now.from, now.to].find(e => e.island === end.island).point !== end.point).map(end => ({ id: b.id, end }));
  });
  assert.ok(moved.length > 0, 'some foot moved out between day 60 and day 135');
  assert.deepEqual(compareTowns(before, after), []);
  // Moving a foot sideways onto another coast lane is caught.
  const { id, end } = moved[0];
  const island = after.islands.find(i => i.id === end.island);
  const lanes = new Set(island.lanes);
  const along = p => island.grid.points[p][0] * end.out[0] + island.grid.points[p][1] * end.out[1];
  const sideways = island.lanes.find(p => p !== end.point && island.grid.neighbours[p].some(n => !island.land.includes(n))
    && Math.abs(along(p) - along(end.point)) < 0.3 && !island.grid.neighbours[end.point].includes(p) && lanes.has(p));
  assert.ok(sideways !== undefined);
  const moveTo = world => ({ ...world, bridges: world.bridges.map(b => (b.id !== id ? b : { ...b, ...Object.fromEntries(['from', 'to'].map(k => [k, b[k].island === end.island ? { ...b[k], point: sideways } : b[k]])) })) });
  assert.ok(compareTowns(before, moveTo(after)).some(text => text.includes(`${id}'s foot on ${end.island} moved`)));
});
