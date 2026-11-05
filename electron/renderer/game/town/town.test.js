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
function changed(change, source = STEADY[135]) {
  const game = copy(source);
  const last = Math.max(0, ...game.islands.flatMap(i => i.buildings.map(b => b.checkIn)), ...game.links.map(l => l.checkIn));
  const add = (islandId, blueprint, id) => {
    const island = game.islands.find(i => i.id === islandId);
    island.buildings.push({ id, blueprint, landWhenBuilt: island.land, checkIn: last + 1 });
  };
  const keep = (islandId, kind, id, ground = 0) => {
    const island = game.islands.find(i => i.id === islandId);
    island.keepsakes = [...(island.keepsakes ?? []), { id, kind, land: island.land, checkIn: last + 1, ...(ground ? { ground } : {}) }];
  };
  change(game, { add, keep, last });
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
  'a keepsake from a surprise': [(game, { keep }) => keep('isle-1', 'bench', 'test-bench'), (before, after) => {
    const bench = after.things.find(t => t.id === 'test-bench' && t.kind === 'bench');
    const island = after.islands.find(i => i.id === 'isle-1');
    assert.ok(bench && island.grid.neighbours[bench.points[0]].some(n => !island.land.includes(n)), 'on the coast');
  }],
  'a fountain near the square': [(game, { keep }) => keep('home', 'fountain', 'test-fountain', 1), (before, after) => {
    const fountain = after.things.find(t => t.id === 'test-fountain' && t.kind === 'fountain');
    assert.ok(fountain && !after.islands[0].lanes.includes(fountain.points[0]), 'beside the lanes');
  }],
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

test('a pad that only fits by squeezing in cuts off coast points alone, and hedges the free ones', () => {
  // Preserve this regression's construction sequence as new catalogue entries arrive.
  // The general state tests above continue to exercise the full current catalogue.
  // New islands' start land is pinned to its values then too: bigger young islands pile up past their room
  // in another order, and the 4th windmill both squeezes in and borrows.
  const { DEFAULT_BLUEPRINTS, DEFAULT_RULES } = require('../../../core/game/rules.js');
  const source = sim.run('steady', 135, {
    snapshots: [135],
    rules: { ...DEFAULT_RULES, startLand: { small: 30, medium: 40, large: 55 } },
    blueprints: DEFAULT_BLUEPRINTS.filter(b => !['farmyard', 'farmextension'].includes(b.id)),
  }).states[135];
  // Windmills piled onto the youngest island, one check-in each, until one has to squeeze in.
  const youngest = source.islands.at(-1).id;
  let before = buildTown(source), hedges = [];
  for (let k = 1; k <= 8 && !hedges.length; k++) {
    const world = buildTown(changed((game, { add }) => { for (let j = 1; j <= k; j++) add(youngest, 'windmill', `test-pad-${j}`); }, source));
    assert.deepEqual(checkTown(world), [], `${k} pads`);
    assert.deepEqual(compareTowns(before, world), [], `${k} pads`);
    assert.equal(world.islands.find(i => i.id === youngest).borrowed, 0, `${k} pads: it squeezes in before borrowing`);
    hedges = world.things.filter(t => t.id.includes(':hedge-'));
    before = world;
  }
  assert.ok(hedges.length, 'a pad squeezed in');
  const island = before.islands.find(i => i.id === youngest);
  for (const hedge of hedges) {
    assert.equal(hedge.kind, 'bush');
    assert.ok(island.grid.neighbours[hedge.points[0]].some(n => !island.land.includes(n)), `${hedge.id} is on the coast`);
  }
  // Without the hedges those points would be free and nobody could walk to them.
  const bare = { ...before, things: before.things.filter(t => !hedges.includes(t)) };
  assert.ok(checkTown(bare).some(text => text.includes('nobody can walk to')));
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
  // A pad turned away from its front (its door no longer looks onto the lane).
  const facing = world.things.find(t => t.pad && !t.coast);
  const turned = { ...broken, islands: world.islands, things: world.things.map(t => (t === facing ? { ...t, yaw: t.yaw + Math.PI } : t)) };
  assert.deepEqual(checkTown(turned), [`${facing.id} faces 180 degrees away from its front`]);
  const bridge = world.bridges[0];
  const inland = home.land.find(p => home.grid.neighbours[p].every(q => home.land.includes(q)) && home.lanes.includes(p));
  const foot = { ...broken, islands: world.islands, bridges: world.bridges.map(b => (b === bridge ? { ...b, from: { ...b.from, point: inland } } : b)) };
  assert.ok(checkTown(foot).some(text => text.includes('coast')));
  assert.ok(compareTowns(world, foot).some(text => text.includes('moved')));
  // A coast building that lost its kept sky (points land could still fill lie in front of it).
  const coast = world.things.find(t => t.coast);
  assert.ok(coast, 'day 135 has a coast building');
  const open = withIslands(world.islands.map(i => (i.id === coast.island ? { ...i, kept: [] } : i)));
  assert.ok(checkTown({ ...open, things: world.things }).some(text => text.includes(`${coast.id} has no kept sky in front`)));
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
  // Moving a foot sideways, onto another lane that is no farther out, is caught (the first moved foot,
  // onto the lane closest to its old distance out that doesn't touch it). Feet often sit at an island's
  // tip with no other lane at quite the same distance out, so the nearest one stands in.
  const sidewaysOf = ({ end }) => {
    const island = after.islands.find(i => i.id === end.island);
    const along = p => island.grid.points[p][0] * end.out[0] + island.grid.points[p][1] * end.out[1];
    const at = along(end.point);
    return island.lanes.filter(p => p !== end.point && along(p) < at + 0.3 && !island.grid.neighbours[end.point].includes(p))
      .sort((a, b) => Math.abs(along(a) - at) - Math.abs(along(b) - at) || a - b)[0];
  };
  const pick = moved.find(m => sidewaysOf(m) !== undefined);
  assert.ok(pick, 'a moved foot has another lane beside or behind it');
  const { id, end } = pick, sideways = sidewaysOf(pick);
  const moveTo = world => ({ ...world, bridges: world.bridges.map(b => (b.id !== id ? b : { ...b, ...Object.fromEntries(['from', 'to'].map(k => [k, b[k].island === end.island ? { ...b[k], point: sideways } : b[k]])) })) });
  assert.ok(compareTowns(before, moveTo(after)).some(text => text.includes(`${id}'s foot on ${end.island} moved`)));
});
