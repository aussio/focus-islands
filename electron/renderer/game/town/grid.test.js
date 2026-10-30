// Checks the town grid, land growth and the sample towns (game/BUILD_PLAN.md, "What gets tested").
import test from 'node:test';
import assert from 'node:assert/strict';
import { gridFor, buildGrid, canFill, roll, GRID_RINGS } from './grid.js';
import { growthOrder, fillLand, startPoint, straightOut } from './growth.js';
import { checkShape, islandKey, townKey, HOUSE_LOOK_COUNT, MAX_FLOORS } from './shape.js';
import { SAMPLE_NAMES, sampleTown, sampleFilm } from './samples.js';
import { pickFoot } from './sky.js';
import { bayOf } from './pads.js';
import { KINDS, FOOTS, BRIDGE_TYPES } from '../kinds.js';
import { HOUSE_LOOKS } from '../scene/style.js';

// The most land each island can hold (the rules' maxLand). Home uses the large grid.
const MAX_LAND = { small: 320, medium: 450, large: 600, home: 600 };
const IDS = Array.from({ length: 200 }, (_, n) => `isle-${n}`);

// Kept sky cut while an island grows (the plan's "What gets tested"). Home gets 8 bridges, one along
// each of its fixed ways out, and any other island 4 (inward, two around the ring, outward); a bridge
// keeps no sky (its pier strip fills as lane, and its held points only wait), but its first foot must be
// found. Each island also gets 3 coast buildings (2, 3 and 2 points wide), each with its bay of kept sky
// (pads.js bayOf). [land when cut, way out in degrees or coast width].
const unitOf = degrees => [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];
function cutsFor(id) {
  const coast = [[140, { wide: 2 }], [220, { wide: 3 }], [300, { wide: 2 }]];
  if (id === 'home') return [...[0, 180, 315, 135, 225, 45, 270, 90].map((a, k) => [[50, 80, 110, 160, 250, 340, 420, 500][k], { out: a }]), ...coast].sort((a, b) => a[0] - b[0]);
  const angle = Math.floor(roll('angle', id) * 8) * 45;
  return [...[angle + 180, angle + 112.5, angle - 112.5, angle].map((a, k) => [[40, 90, 160, 260][k], { out: a }]), ...coast].sort((a, b) => a[0] - b[0]);
}

// Grows the island, finding bridge feet and cutting coast buildings' bays on the way, then fills to
// maxLand. Bridge feet follow the layout's rule (sky.js pickFoot); coast buildings go on a random stretch
// of coast, their middle half a cell inland.
const grown = new Map();
function growWithStrips(id, size) {
  const key = `${id}:${size}`;
  if (grown.has(key)) return grown.get(key);
  const grid = gridFor(id, size);
  const order = growthOrder(grid, id);
  const kept = new Set();
  for (const [at, cut] of cutsFor(id)) {
    const landList = fillLand(grid, order, at, kept);
    const land = new Set(landList);
    if (cut.out !== undefined) {
      const foot = pickFoot(grid, landList, p => land.has(p), unitOf(cut.out), () => true);
      assert.ok(foot, `${id}: no bridge foot toward ${cut.out}° at land ${at}`);
      continue;
    }
    const coast = landList.filter(p => grid.neighbours[p].some(n => !land.has(n)));
    const tries = coast.sort((a, b) => roll('cut', id, at, a) - roll('cut', id, at, b) || a - b);
    const cutWith = width => tries.find(p => {
      const side = [p, ...grid.neighbours[p].filter(n => coast.includes(n))].slice(0, width);
      if (side.length < width) return false;
      const length = Math.hypot(grid.points[p][0], grid.points[p][1]) || 1;
      const way = [grid.points[p][0] / length, grid.points[p][1] / length];
      if (straightOut(grid, p, way).length < 3) return false;
      const mid = [0, 1].map(i => side.reduce((sum, q) => sum + grid.points[q][i], 0) / side.length);
      const bay = bayOf(grid, { points: side, at: [mid[0] - way[0] * 0.45, mid[1] - way[1] * 0.45] }, side, way);
      if (bay.some(q => land.has(q))) return false;
      for (const q of bay) if (canFill(grid, q)) kept.add(q);
      return true;
    });
    // A wide coast building that fits nowhere goes elsewhere (or not at all).
    for (let width = cut.wide; width >= 1 && cutWith(width) === undefined; width--);
  }
  const max = MAX_LAND[id === 'home' ? 'home' : size];
  const result = { grid, order, kept, max, land: fillLand(grid, order, max, kept) };
  grown.set(key, result);
  return result;
}

// The first land count at which the land is in two pieces or has a hole, or 0 if never.
function firstBroken(grid, land) {
  const parent = Int32Array.from({ length: grid.points.length + 1 }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a === b) return false; parent[a] = b; return true; };
  // Land pieces, adding points in order.
  const isLand = new Uint8Array(grid.points.length);
  let pieces = 0;
  for (let n = 0; n < land.length; n++) {
    const p = land[n];
    isLand[p] = 1;
    pieces++;
    for (const q of grid.neighbours[p]) if (isLand[q] && join(p, q)) pieces--;
    if (pieces !== 1) return n + 1;
  }
  // Sky pieces, taking points away from the end. The outside (the last number) joins every rim point.
  parent.forEach((_, i) => { parent[i] = i; });
  const outside = grid.points.length;
  const sky = new Uint8Array(grid.points.length);
  let skyPieces = 1, broken = 0;
  const open = p => {
    sky[p] = 1;
    skyPieces++;
    if (grid.fromRim[p] === 0 && join(p, outside)) skyPieces--;
    for (const q of grid.neighbours[p]) if (sky[q] && join(p, q)) skyPieces--;
  };
  grid.points.forEach((_, p) => { if (!isLand[p]) open(p); });
  if (skyPieces !== 1) broken = land.length;
  for (let n = land.length - 1; n >= 1; n--) {
    open(land[n]);
    if (skyPieces !== 1) broken = n;
  }
  return broken;
}

test('the same id and size give the same grid, shared and frozen', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    const grid = gridFor('same', size);
    assert.equal(gridFor('same', size), grid);
    assert.deepEqual(buildGrid('same', size), grid);
    assert.ok(Object.isFrozen(grid) && Object.isFrozen(grid.points) && Object.isFrozen(grid.points[0]));
    assert.notDeepEqual(gridFor('other', size).points, grid.points);
  }
  assert.equal(gridFor('home', 'medium'), gridFor('home', 'large'), 'home always uses the large grid');
  for (const [x, z] of gridFor('same', 'small').points) {
    assert.equal(Math.round(x * 1e4) / 1e4, x);
    assert.equal(Math.round(z * 1e4) / 1e4, z);
  }
});

test('every cell has four points joined by its sides', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    const grid = gridFor(`cells-${size}`, size);
    grid.cells.forEach((cell, c) => {
      assert.equal(new Set(cell).size, 4);
      cell.forEach((p, k) => {
        assert.ok(grid.neighbours[p].includes(cell[(k + 1) % 4]));
        assert.ok(grid.around[p].includes(c));
      });
    });
    grid.neighbours.forEach((list, p) => { for (const q of list) assert.ok(grid.neighbours[q].includes(p)); });
    assert.equal(grid.centres.length, grid.cells.length);
  }
});

test('the growth order covers every point that can fill, once, from a four-cell point', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    const grid = gridFor(`order-${size}`, size);
    const order = growthOrder(grid, grid.id);
    assert.equal(order, growthOrder(grid, grid.id));
    assert.equal(grid.around[order[0]].length, 4);
    assert.equal(new Set(order).size, order.length);
    assert.equal(order.length, grid.points.filter((_, p) => canFill(grid, p)).length);
    // A bigger count only adds to the end.
    assert.deepEqual(fillLand(grid, order, 120), fillLand(grid, order, 200).slice(0, 120));
  }
});

test('straight strips out to the sky always end on the rim', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    const grid = gridFor(`strip-${size}`, size);
    grid.points.forEach((_, p) => {
      if (!canFill(grid, p)) return;
      for (let k = 0; k < 8; k++) {
        const strip = straightOut(grid, p, [Math.sin(k * Math.PI / 4), Math.cos(k * Math.PI / 4)]);
        assert.equal(grid.fromRim[strip.at(-1)], 0, `${grid.key} from ${p}`);
        strip.forEach((q, n) => assert.ok(grid.neighbours[n ? strip[n - 1] : p].includes(q)));
      }
    });
  }
});

test('for 200 ids of each size, the land can reach maxLand even with bays cut while it grows', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    let spare = Infinity;
    for (const id of IDS) {
      const { grid, kept, max, land } = growWithStrips(id, size);
      assert.equal(land.length, max, `${id} (${size}) reaches only ${land.length} land points`);
      spare = Math.min(spare, grid.points.filter((_, p) => canFill(grid, p)).length - kept.size - max);
    }
    assert.ok(spare >= 0, `${size}: ${spare}`);
  }
  const home = growWithStrips('home', 'large');
  assert.equal(home.land.length, MAX_LAND.home);
});

test('the first n land points are one piece with no holes, with and without bays', () => {
  for (const size of Object.keys(GRID_RINGS)) {
    for (const id of IDS) {
      const grid = gridFor(id, size);
      const order = growthOrder(grid, id);
      assert.equal(firstBroken(grid, fillLand(grid, order, Infinity)), 0, `${id} (${size}) without strips`);
      const { land, kept } = growWithStrips(id, size);
      assert.equal(firstBroken(grid, land), 0, `${id} (${size}) with strips`);
      assert.ok(land.every(p => !kept.has(p)));
    }
  }
});

test('kinds have footprints, and the house colours match the shape', () => {
  for (const [kind, def] of Object.entries(KINDS)) {
    assert.ok(FOOTS[def.foot], `${kind} has no foot`);
    if (def.pad) assert.ok(['cell', 'cells', 'ring'].includes(def.foot), `${kind} pad on a ${def.foot}`);
    if (def.edge) assert.ok(def.pad, `${kind} is a coast building without a pad`);
  }
  assert.equal(HOUSE_LOOKS.length, HOUSE_LOOK_COUNT);
});

test('the sample towns pass the shape check at every step, and cover every piece', () => {
  const seen = { foots: new Set(), floors: new Set(), types: new Set(), coast: 0, lone: 0, joined: 0, lifts: new Set(), sizes: new Set(), golden: 0 };
  for (const name of SAMPLE_NAMES) {
    for (const { label, world } of sampleFilm(name)) assert.deepEqual(checkShape(world), [], `${name}: ${label}`);
    const world = sampleTown(name);
    // Same script, deep-equal world, with the same grid objects.
    const again = sampleTown(name);
    assert.deepEqual(again, world);
    assert.equal(again.islands[0].grid, world.islands[0].grid);
    assert.equal(townKey(again), townKey(world));
    for (const island of world.islands) {
      assert.equal(islandKey(world, island.id), islandKey(again, island));
      seen.lifts.add(island.lift);
      seen.sizes.add(island.land.length);
      for (const house of island.houses) {
        for (const block of house.blocks) seen.floors.add(block.floors);
        if (house.blocks.length === 1) seen.lone++;
        const mine = new Set(house.blocks.map(b => b.point));
        const others = new Set(island.houses.filter(h => h !== house).flatMap(h => h.blocks.map(b => b.point)));
        if ([...mine].some(p => island.grid.neighbours[p].some(q => others.has(q)))) seen.joined++;
      }
    }
    for (const thing of world.things) {
      seen.foots.add(KINDS[thing.kind].foot);
      if (thing.coast) seen.coast++;
      if (thing.kind === 'goldentree') seen.golden++;
    }
    for (const bridge of world.bridges) seen.types.add(bridge.type);
    if (world.view.island !== 'home') seen.otherView = true;
  }
  assert.deepEqual([...seen.foots].sort(), Object.keys(FOOTS).sort());
  assert.ok([1, 2, MAX_FLOORS].every(n => seen.floors.has(n)));
  assert.deepEqual([...seen.types].sort(), [...BRIDGE_TYPES].sort(), 'every bridge type');
  assert.ok(seen.coast >= 2 && seen.lone >= 1 && seen.joined >= 2 && seen.golden >= 1 && seen.otherView);
  assert.ok(seen.lifts.size >= 3, 'islands at different heights');
  assert.ok([...seen.lifts].every(lift => lift >= -0.5 && lift <= 0.5), 'lifts from -0.5 to 0.5');
  // A loop: some island is joined to two others that are joined to each other.
  const world = sampleTown('manyIslands');
  const links = world.bridges.map(b => [b.from.island, b.to.island]);
  const joined = (a, b) => links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  assert.ok(world.islands.some(a => world.islands.some(b => world.islands.some(c => a !== b && b !== c && a !== c && joined(a.id, b.id) && joined(b.id, c.id) && joined(a.id, c.id)))));
  assert.ok(world.islands.some(i => links.filter(l => l.includes(i.id)).length >= 3), 'an island with three bridges');
  const lift = id => world.islands.find(i => i.id === id).lift;
  assert.ok(world.bridges.some(b => b.type === 'slide' && lift(b.from.island) - lift(b.to.island) >= 1 - 1e-9), 'a slide that drops the full 1.0');
  // Clearly different sizes, home the largest.
  const sizes = world.islands.map(i => i.land.length);
  assert.equal(Math.max(...sizes), world.islands.find(i => i.id === 'home').land.length);
  assert.ok(Math.max(...sizes.slice(1)) >= 1.4 * Math.min(...sizes.slice(1)));
  // Islands float on the table's angles (multiples of 45°), and every bridge joins table neighbours:
  // its two ways out face each other, along one angle or 112.5° around a ring.
  const angleOf = ([x, z]) => ((Math.atan2(z, x) * 180 / Math.PI) + 360) % 360;
  for (const island of world.islands.slice(1)) assert.ok(Math.abs(angleOf(island.at) / 45 - Math.round(angleOf(island.at) / 45)) < 1e-3, island.id);
  let bent = 0;
  for (const bridge of world.bridges) {
    assert.ok(Math.abs(bridge.from.out[0] + bridge.to.out[0]) < 1e-3 && Math.abs(bridge.from.out[1] + bridge.to.out[1]) < 1e-3, bridge.id);
    assert.ok(Math.abs(angleOf(bridge.from.out) / 22.5 - Math.round(angleOf(bridge.from.out) / 22.5)) < 1e-3, bridge.id);
    const [a, b] = [bridge.from, bridge.to].map(end => world.islands.find(i => i.id === end.island).at);
    if (Math.abs(Math.hypot(...a) - Math.hypot(...b)) > 0.5 && Math.min(Math.hypot(...a), Math.hypot(...b)) > 0) bent++;
  }
  assert.ok(bent >= 1, 'a bridge around a ring between islands at different distances');
});

test('the sample films only ever add', () => {
  for (const name of SAMPLE_NAMES) {
    const film = sampleFilm(name);
    for (let n = 1; n < film.length; n++) {
      const before = film[n - 1].world, after = film[n].world;
      const where = `${name} step ${n + 1}`;
      for (const old of before.islands) {
        const now = after.islands.find(i => i.id === old.id);
        assert.equal(now.grid, old.grid, where);
        for (const list of ['land', 'lanes', 'kept']) assert.deepEqual(now[list].slice(0, old[list].length), old[list], `${where}: ${old.id} ${list}`);
        assert.ok(now.land.every(p => !now.kept.includes(p)), where);
        for (const house of old.houses) {
          const later = now.houses.find(h => h.id === house.id);
          assert.equal(later.look, house.look);
          assert.deepEqual(later.door, house.door);
          house.blocks.forEach((block, k) => {
            assert.equal(later.blocks[k].point, block.point);
            assert.ok(later.blocks[k].floors >= block.floors, `${where}: floors went down`);
          });
        }
        // Islands only drift outward along their own line from home.
        assert.ok(Math.hypot(...now.at) >= Math.hypot(...old.at) - 1e-9, where);
        assert.ok(Math.abs(now.at[0] * old.at[1] - now.at[1] * old.at[0]) < 1e-3, where);
      }
      for (const thing of before.things) assert.deepEqual(after.things.find(t => t.id === thing.id), thing, `${where}: ${thing.id} moved`);
      // Bridge ends never move; clear may only grow as land grows near a foot.
      const fixed = ({ clear, ...end }) => end;
      for (const bridge of before.bridges) {
        const later = after.bridges.find(b => b.id === bridge.id);
        assert.equal(later.type, bridge.type, `${where}: ${bridge.id} type`);
        for (const side of ['from', 'to']) {
          assert.deepEqual(fixed(later[side]), fixed(bridge[side]), `${where}: ${bridge.id} moved`);
          assert.ok(later[side].clear >= bridge[side].clear, `${where}: ${bridge.id} clear shrank`);
        }
      }
    }
  }
});
