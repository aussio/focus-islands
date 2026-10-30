import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld, worldToText, checkWorld, islandAnchor } from './index.js';
import { KINDS } from '../kinds.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATES_DIR = path.join(here, '../../../../development-tools/game-gallery/states');

// ---------- made-up game states, in the shape from game/BUILD_PLAN.md ----------

const island = (id, kind, size, land, buildings = []) => ({ id, name: id, kind, size, land, golden: false, buildings });
const game = (islands, extra = {}) => ({ rulesVersion: 1, change: 1, islands, links: [], helpers: [], wonders: [], checkIn: null, ...extra });
const building = (id, blueprint, landWhenBuilt) => ({ id, blueprint, name: blueprint, landWhenBuilt, checkIn: 1 });

const EVERYDAY = ['cottage', 'garden', 'nursery', 'sawmill', 'flowers', 'workshop', 'windmill', 'orchard', 'lanterns', 'tower', 'pond', 'greattree', 'cottage', 'orchard', 'flowers'];
const SPECIAL = { mossy: 'grotto', rocky: 'quarry', meadow: 'beehives', crystal: 'forge', misty: 'loom' };
const WONDERS = ['lighthouse', 'airship', 'observatory', 'skyfall', 'aurora'];
const NEW_ISLANDS = [['mossy', 'large'], ['rocky', 'medium'], ['meadow', 'small'], ['crystal', 'medium'], ['misty', 'large']];
const START_LAND = { small: 2, medium: 3, large: 5 };

// Plays a made-up history one check-in at a time and returns the game state after each one.
// Land grows, buildings are added in order with landWhenBuilt, islands arrive and get linked.
function madeUpHistory(checkIns, { linkTo = 'previous', islandEvery = 14, linkAfter = 4 } = {}) {
  const state = game([island('home', 'home', 'medium', 4)]);
  const states = [structuredClone(state)];
  let made = 0, everyday = 0, wonder = 0, link = 0;
  for (let n = 1; n <= checkIns; n++) {
    const islands = state.islands;
    // New land most check-ins, spread over the islands.
    if (n % 3 !== 0) islands[(n * 7) % islands.length].land += 1;
    // A new island now and then, linked a few check-ins later.
    const arrived = islands.length - 1;
    if (n % islandEvery === 0 && arrived < NEW_ISLANDS.length) {
      const [kind, size] = NEW_ISLANDS[arrived];
      islands.push(island(`isle-${arrived + 1}`, kind, size, START_LAND[size]));
    }
    for (let i = 1; i < islands.length; i++) {
      const id = islands[i].id;
      if (state.links.some(l => l.to === id) || n < (i * islandEvery) + linkAfter) continue;
      const from = linkTo === 'home' ? 'home' : islands[i - 1].id;
      state.links.push({ id: `link-${++link}`, from, to: id });
    }
    // A building most check-ins, on the island with the most free spots.
    if (n % 4 !== 1) {
      const target = [...islands].sort((a, b) => (b.land - b.buildings.length) - (a.land - a.buildings.length))[0];
      if (target.land > target.buildings.length) {
        let blueprint;
        if (n % 17 === 0 && wonder < WONDERS.length) blueprint = WONDERS[wonder++];
        else if (target.kind !== 'home' && !target.buildings.some(b => b.blueprint === SPECIAL[target.kind])) blueprint = SPECIAL[target.kind];
        else blueprint = EVERYDAY[everyday++ % EVERYDAY.length];
        target.buildings.push(building(`b${++made}`, blueprint, target.land));
      }
    }
    if (n % 5 === 0) state.helpers.push({ id: `h${state.helpers.length + 1}`, name: `Helper ${state.helpers.length + 1}`, job: n % 10 ? 'wood' : 'stone', island: islands[n % islands.length].id });
    state.change = n;
    states.push(structuredClone(state));
  }
  return states;
}

// ---------- comparing worlds ----------

function islandCells(world, id) {
  const isle = world.islands.find(i => i.id === id);
  const cells = new Map();
  isle.rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== '.') cells.set(`${isle.origin[0] + c},${isle.origin[1] + r}`, ch);
  }));
  return cells;
}

// Everything in `before` must still be in `after`, in the same place relative to its island's pile.
function assertStable(before, after, label) {
  for (const isle of before.islands) {
    const [ax, ay] = islandAnchor(before, isle.id);
    const [bx, by] = islandAnchor(after, isle.id);
    const later = islandCells(after, isle.id);
    for (const [cell, ch] of islandCells(before, isle.id)) {
      const [c, r] = cell.split(',').map(Number);
      const moved = `${c - ax + bx},${r - ay + by}`;
      assert.ok(later.has(moved), `${label}: land at ${cell} on ${isle.id} disappeared`);
      if (ch === 'p') assert.equal(later.get(moved), 'p', `${label}: path at ${cell} on ${isle.id} is gone`);
    }
  }
  const byId = new Map(after.things.map(t => [t.id, t]));
  for (const thing of before.things) {
    const now = byId.get(thing.id);
    assert.ok(now, `${label}: ${thing.id} disappeared`);
    const [ax, ay] = islandAnchor(before, thing.island);
    const [bx, by] = islandAnchor(after, thing.island);
    assert.deepEqual(
      [now.kind, now.island, now.c - bx, now.r - by, now.w, now.h, now.facing],
      [thing.kind, thing.island, thing.c - ax, thing.r - ay, thing.w, thing.h, thing.facing],
      `${label}: ${thing.id} moved`);
  }
}

const landCount = world => world.islands.reduce((sum, isle) => sum + isle.rows.join('').replace(/\./g, '').length, 0);

// ---------- tests ----------

test('the start is a tiny rounded home island with tree, rock, pile, campfire and seats', () => {
  const world = buildWorld(game([island('home', 'home', 'medium', 4)], { helpers: [{ id: 'h1', name: 'Pip', job: 'wood', island: 'home' }] }));
  assert.deepEqual(checkWorld(world), []);
  assert.equal(world.islands.length, 1);
  const [home] = world.islands;
  assert.ok(home.rows.length >= 7 && home.rows.length <= 9, `height ${home.rows.length}`);
  assert.ok(home.rows[0].length >= 7 && home.rows[0].length <= 10, `width ${home.rows[0].length}`);
  assert.ok(landCount(world) <= 72, `land cells ${landCount(world)}`);
  const count = kind => world.things.filter(t => t.kind === kind).length;
  assert.equal(count('tree'), 1);
  assert.equal(count('rock'), 1);
  assert.equal(count('pile'), 1);
  assert.equal(count('fire'), 1);
  assert.ok(count('seat') >= 1 && count('seat') <= 2);
  for (const thing of world.things) assert.ok(!KINDS[thing.kind]?.size || !['cottage'].includes(thing.kind));
  // Seats sit beside the campfire and face it.
  const fire = world.things.find(t => t.kind === 'fire');
  for (const seat of world.things.filter(t => t.kind === 'seat')) {
    assert.equal(Math.abs(seat.c - fire.c) + Math.abs(seat.r - fire.r), 1);
    const step = [[0, 1], [1, 0], [0, -1], [-1, 0]][seat.facing];
    assert.deepEqual([seat.c + step[0], seat.r + step[1]], [fire.c, fire.r]);
  }
  assert.deepEqual(world.helpers, [{ id: 'h1', name: 'Pip', job: 'wood', island: 'home' }]);
  assert.deepEqual(world.bridges, []);
  assert.equal(world.islands[0].heights, null);
});

test('the start keeps room for four buildings without growing', () => {
  const start = buildWorld(game([island('home', 'home', 'medium', 4)]));
  const four = buildWorld(game([island('home', 'home', 'medium', 4, [
    building('a', 'cottage', 4), building('b', 'garden', 4), building('c', 'nursery', 4), building('d', 'sawmill', 4),
  ])]));
  assert.deepEqual(checkWorld(four), []);
  assert.equal(landCount(four), landCount(start));
  for (const id of ['a', 'b', 'c', 'd']) assert.ok(four.things.some(t => t.id === id), `${id} placed`);
  assertStable(start, four, 'four buildings');
});

test('the same game state always gives a deep-equal world', () => {
  const states = madeUpHistory(60);
  const last = states[states.length - 1];
  const first = buildWorld(last);
  buildWorld(states[10]); // a different state in between
  assert.deepEqual(buildWorld(structuredClone(last)), first);
  // Callers get their own copy: changing it doesn't change the next answer.
  first.things.length = 0;
  assert.notEqual(buildWorld(last).things.length, 0);
});

test('growth never moves anything already placed and never removes land', () => {
  for (const linkTo of ['previous', 'home']) {
    const states = madeUpHistory(90, { linkTo });
    let before = buildWorld(states[0]);
    const first = before;
    for (let n = 1; n < states.length; n++) {
      const after = buildWorld(states[n]);
      assert.deepEqual(checkWorld(after), [], `check-in ${n} (${linkTo})`);
      assertStable(before, after, `check-in ${n} (${linkTo})`);
      before = after;
    }
    assertStable(first, before, `start to end (${linkTo})`);
  }
});

test('buildings come in build order even when several share one land count', () => {
  // A possible history: land only grows, and each building notes the land it was built at.
  const a = building('a', 'cottage', 4), b = building('b', 'garden', 6), c = building('c', 'flowers', 6);
  const d = building('d', 'lanterns', 6), e = building('e', 'sawmill', 9);
  const history = [[4, []], [4, [a]], [6, [a]], [6, [a, b]], [6, [a, b, c]], [6, [a, b, c, d]], [9, [a, b, c, d]], [9, [a, b, c, d, e]]];
  let before = null;
  for (const [land, list] of history) {
    const after = buildWorld(game([island('home', 'home', 'medium', land, list)]));
    assert.deepEqual(checkWorld(after), []);
    for (const built of list) assert.ok(after.things.some(t => t.id === built.id), `${built.id} placed`);
    if (before) assertStable(before, after, `land ${land} with ${list.length} buildings`);
    before = after;
  }
});

test('every building faces a path, wonders fit, and coast kinds stay on the coast as land grows', () => {
  const wonders = [building('w1', 'lighthouse', 6), building('w2', 'airship', 8), building('w3', 'observatory', 10), building('w4', 'skyfall', 12), building('w5', 'aurora', 14)];
  const homes = [building('c1', 'cottage', 4), building('c2', 'garden', 5), building('c3', 'orchard', 7)];
  const all = [homes[0], homes[1], wonders[0], homes[2], ...wonders.slice(1)];
  let before = buildWorld(game([island('home', 'home', 'medium', 6, all.slice(0, 3))]));
  for (let land = 6; land <= 40; land += 2) {
    const list = all.filter(b => b.landWhenBuilt <= land);
    const world = buildWorld(game([island('home', 'home', 'medium', land, list)]));
    assert.deepEqual(checkWorld(world), [], `land ${land}`);
    assertStable(before, world, `land ${land}`);
    before = world;
  }
  for (const w of wonders) {
    const thing = before.things.find(t => t.id === w.id);
    const [sw, sh] = KINDS[w.blueprint].size;
    assert.deepEqual([thing.w, thing.h].sort(), [sw, sh].sort(), `${w.blueprint} size`);
  }
});

test('each island kind gets its own natural things, and every new island has a tree or rock', () => {
  const kinds = { mossy: ['mushroom', 'bush'], rocky: ['rock'], meadow: ['flower'], crystal: ['crystal'], misty: ['bush'] };
  for (const [kind, natural] of Object.entries(kinds)) {
    const world = buildWorld(game([island('home', 'home', 'medium', 6), island(`a-${kind}`, kind, 'large', 8)]));
    assert.deepEqual(checkWorld(world), []);
    const mine = world.things.filter(t => t.island === `a-${kind}`);
    assert.ok(mine.some(t => t.kind === 'tree' || t.kind === 'rock'), `${kind} has a work spot`);
    assert.ok(mine.some(t => t.kind === 'pile'), `${kind} has a pile`);
    for (const k of natural) assert.ok(mine.some(t => t.kind === k), `${kind} has ${k}`);
    const decor = mine.filter(t => ['bush', 'flower', 'mushroom', 'crystal'].includes(t.kind) || (t.kind === 'rock' && kind === 'rocky'));
    assert.ok(decor.every(t => natural.includes(t.kind) || (t.kind === 'rock' && kind === 'rocky')), `${kind} decor ${decor.map(t => t.kind)}`);
  }
  const home = buildWorld(game([island('home', 'home', 'medium', 10, [building('a', 'cottage', 4), building('b', 'garden', 5)])]));
  const decor = new Set(home.things.filter(t => !['tree', 'rock', 'pile', 'fire', 'seat', 'cottage', 'garden'].includes(t.kind)).map(t => t.kind));
  assert.ok([...decor].every(k => k === 'bush' || k === 'flower'), [...decor].join());
  assert.ok(decor.has('flower') && decor.has('bush'));
});

test('lawn near buildings and paths gets flowers and bushes', () => {
  const states = madeUpHistory(40);
  const world = buildWorld(states[states.length - 1]);
  const home = world.things.filter(t => t.island === 'home');
  const decor = home.filter(t => t.kind === 'flower' || t.kind === 'bush').length;
  const lawn = islandCells(world, 'home').size - home.filter(t => t.kind !== 'flower').reduce((n, t) => n + t.w * t.h, 0);
  assert.ok(decor / lawn > 0.12, `decor ${decor} on ${lawn} lawn cells`);
});

test('islands float around home with sky between, and links become straight bridges', () => {
  const three = game([island('home', 'home', 'medium', 8), island('isle-1', 'mossy', 'medium', 5), island('isle-2', 'rocky', 'small', 4)], {
    links: [{ id: 'l1', from: 'home', to: 'isle-1' }, { id: 'l2', from: 'isle-1', to: 'isle-2' }],
  });
  const world = buildWorld(three);
  assert.deepEqual(checkWorld(world), []);
  assert.equal(world.bridges.length, 2);
  const islandAt = ([c, r]) => world.islands.find(isle => {
    const row = isle.rows[r - isle.origin[1]];
    return row && row[c - isle.origin[0]] && row[c - isle.origin[0]] !== '.';
  })?.id;
  assert.deepEqual(world.bridges.map(b => [b.id, islandAt(b.from), islandAt(b.to)]), [['l1', 'home', 'isle-1'], ['l2', 'isle-1', 'isle-2']]);

  // Without links the islands still float, apart, with no bridges.
  const loose = buildWorld({ ...three, links: [] });
  assert.deepEqual(checkWorld(loose), []);
  assert.deepEqual(loose.bridges, []);
  assert.equal(loose.islands.length, 3);
});

test('home stays in the middle with other islands on different sides', () => {
  const states = madeUpHistory(90, { linkTo: 'home' });
  const world = buildWorld(states[states.length - 1]);
  const centre = id => {
    const isle = world.islands.find(i => i.id === id);
    return [isle.origin[0] + isle.rows[0].length / 2, isle.origin[1] + isle.rows.length / 2];
  };
  const [hx, hy] = centre('home');
  const others = world.islands.filter(i => i.id !== 'home').map(i => centre(i.id));
  assert.ok(others.length >= 5);
  assert.ok(others.some(([x]) => x > hx) && others.some(([x]) => x < hx), 'islands on both sides of home');
});

test('a six-month world stays under 4000 land cells', () => {
  // About 6 islands and 60+ buildings, with plenty of spare land.
  const states = madeUpHistory(200);
  const last = states[states.length - 1];
  assert.ok(last.islands.length >= 6);
  assert.ok(last.islands.reduce((n, i) => n + i.buildings.length, 0) >= 60);
  const world = buildWorld(last);
  assert.deepEqual(checkWorld(world), []);
  assert.ok(landCount(world) < 4000, `land cells ${landCount(world)}`);
});

test('a golden island shows one golden sapling, and it can appear any day without moving anything', () => {
  const states = madeUpHistory(120);
  for (const n of [0, 20, 60, 120]) {
    const plain = states[n];
    const golden = structuredClone(plain);
    for (const isle of golden.islands) isle.golden = true;
    const before = buildWorld(plain), after = buildWorld(golden);
    assert.deepEqual(checkWorld(after), [], `check-in ${n}`);
    assert.equal(before.things.filter(t => t.kind === 'goldentree').length, 0, `check-in ${n}: no sapling without golden`);
    for (const isle of golden.islands) {
      const saplings = after.things.filter(t => t.kind === 'goldentree' && t.island === isle.id);
      assert.equal(saplings.length, 1, `${isle.id} at check-in ${n}`);
    }
    // Everything else stays exactly where it was.
    assert.deepEqual({ ...after, things: after.things.filter(t => t.kind !== 'goldentree') }, before, `check-in ${n}`);
  }
  // Turning golden on part way through a history keeps every step stable, sapling included.
  let before = buildWorld(states[0]);
  for (let n = 1; n <= 80; n++) {
    const state = structuredClone(states[n]);
    if (n >= 30) state.islands[0].golden = true;
    if (n >= 50 && state.islands[2]) state.islands[2].golden = true;
    const after = buildWorld(state);
    assert.deepEqual(checkWorld(after), [], `check-in ${n}`);
    assertStable(before, after, `check-in ${n}`);
    assert.equal(after.things.filter(t => t.kind === 'goldentree').length, (n >= 30) + (n >= 50 && Boolean(state.islands[2])), `check-in ${n}`);
    before = after;
  }
});

test('worldToText draws sky, land, paths, things and bridges', () => {
  const world = buildWorld(game([island('home', 'home', 'medium', 5, [building('a', 'cottage', 4)]), island('isle-1', 'rocky', 'small', 2)], {
    links: [{ id: 'l1', from: 'home', to: 'isle-1' }],
  }));
  const text = worldToText(world, { legend: true });
  for (const ch of ['T', 'R', 'P', 'F', 's', 'H', 'o']) assert.ok(text.includes(ch), `map has ${ch}`);
  assert.match(text, /[=|]/);
  assert.match(text, /H cottage a at \d+,\d+ 2x2 faces (south|east|north|west)/);
});

test('gallery states from the rules lay out cleanly and stay stable day to day', t => {
  if (!fs.existsSync(STATES_DIR)) return t.skip('no gallery states yet');
  const files = fs.readdirSync(STATES_DIR).filter(f => /^day-\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!files.length) return t.skip('no gallery states yet');
  let before = null;
  for (const file of files) {
    const state = JSON.parse(fs.readFileSync(path.join(STATES_DIR, file), 'utf8'));
    const world = buildWorld(state);
    assert.deepEqual(checkWorld(world), [], file);
    const placed = new Set(world.things.map(thing => thing.id));
    for (const isle of state.islands) for (const b of isle.buildings) assert.ok(placed.has(String(b.id)), `${file}: ${b.id} placed`);
    assert.equal(world.bridges.length, state.links.length, `${file}: every link has a bridge`);
    assert.ok(landCount(world) < 4000, `${file}: land cells ${landCount(world)}`);
    // Days come from one made-up person, so each day should grow out of the one before.
    const sameRun = before && before.state.islands.every(isle => {
      const later = state.islands.find(i => i.id === isle.id);
      return later && isle.buildings.every((b, i) => later.buildings[i]?.id === b.id);
    });
    if (sameRun) assertStable(before.world, world, `${before.file} to ${file}`);
    before = { file, state, world };
  }
});
