// Islands and bridges in a full sky (game/BUILD_PLAN.md, "What gets tested": sky.test.js).
// It reads the sky table from the rules (electron/core/game/sky.js), fills all three rings at random
// sizes and land, and joins every neighbour pair the table allows, in a random order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildTown, checkTown, compareTowns } from './index.js';
import { BRIDGE_TYPES } from '../kinds.js';

const require = createRequire(import.meta.url);
const sky = require('../../../core/game/sky.js');
const R = require('../../../core/game/rules.js');

const SETS = 50;
const ISLANDS = 3 * sky.PER_RING; // three full rings
const SIZES = ['small', 'medium', 'large'];

// A small seeded random (mulberry32), so a failure can be replayed.
function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One full sky. Ids come from a pool, so the grids made for 50 skies stay few enough to be quick.
function skyGame(set) {
  const random = randomFrom(1000 + set);
  const pick = list => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const rules = R.DEFAULT_RULES;
  const islands = [{ id: 'home', kind: 'home', size: 'medium', ring: 0, angle: null, lift: 0, land: between(rules.startingLand, rules.maxLand.home), buildings: [] }];
  const used = new Set(['home']);
  for (let n = 1; n <= ISLANDS; n++) {
    let id;
    do id = `isle-${between(1, 120)}`; while (used.has(id));
    used.add(id);
    const size = pick(SIZES);
    const { ring, angle } = sky.placeOf(n);
    islands.push({ id, kind: pick(R.NEW_ISLAND_KINDS), size, ring, angle, lift: Math.round((between(0, 20) * 0.05 - 0.5) * 100) / 100 || 0,
      land: between(rules.startLand[size], rules.maxLand[size]), buildings: [] });
  }
  const pairs = sky.neighbourPairs(islands);
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  // Each island's land when each of its links came up: rising from its start land to its land now.
  const start = island => (island.id === 'home' ? rules.startingLand : rules.startLand[island.size]);
  const landAt = new Map(islands.map(island => {
    const count = pairs.filter(p => p.from === island.id || p.to === island.id).length;
    const steps = Array.from({ length: count }, () => between(start(island), island.land)).sort((a, b) => a - b);
    return [island.id, steps];
  }));
  const lift = id => islands.find(i => i.id === id).lift;
  const links = pairs.map((pair, k) => {
    const types = lift(pair.from) === lift(pair.to) ? BRIDGE_TYPES.filter(t => t !== 'slide') : BRIDGE_TYPES;
    return { id: `link-${k}`, from: pair.from, to: pair.to, type: pick(types), checkIn: k + 1,
      land: { [pair.from]: landAt.get(pair.from).shift(), [pair.to]: landAt.get(pair.to).shift() } };
  });
  return { game: { islands, links, helpers: [] }, random };
}

test('a full sky: every neighbour pair gets feet, decks never cross or pass over land, islands keep their gap', () => {
  for (let set = 0; set < SETS; set++) {
    const { game } = skyGame(set);
    const world = buildTown(game);
    assert.equal(world.bridges.length, game.links.length, `set ${set}: every link has both feet`);
    assert.deepEqual(world.islands.map(i => i.borrowed).filter(Boolean), [], `set ${set}: no borrowed land`);
    assert.deepEqual(checkTown(world), [], `set ${set}`);
  }
});

test('growing one island moves feet only out along their piers and never changes a way out', () => {
  for (let set = 0; set < SETS; set++) {
    const { game, random } = skyGame(set);
    const before = buildTown(game);
    const grown = JSON.parse(JSON.stringify(game));
    const island = grown.islands[Math.floor(random() * grown.islands.length)];
    const most = island.id === 'home' ? R.DEFAULT_RULES.maxLand.home : R.DEFAULT_RULES.maxLand[island.size];
    island.land = Math.min(most, island.land + 1 + Math.floor(random() * 60));
    const after = buildTown(grown);
    assert.deepEqual(compareTowns(before, after), [], `set ${set}: ${island.id} grew`);
    assert.deepEqual(checkTown(after), [], `set ${set}: ${island.id} grew`);
  }
});
