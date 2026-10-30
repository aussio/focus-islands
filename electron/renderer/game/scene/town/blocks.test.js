// Block houses (blocks.js): the roof plan and the drawn pieces, on the sample towns (town/samples.js) and
// on the real town states (development-tools/game-gallery/states/town/, drawn by town/index.js buildTown).
//
// - Ridges: links go both ways (so roofs meet), gable arms point only at lower neighbours, a lone block
//   on a four-way point gets a gable, and the four kinds of corner piece meet along every shared line.
// - Drawing the same island twice gives identical pieces.
// - Between neighbouring film steps, a block piece changes only within 2 grid steps of a block that
//   changed (storeys, colour or door).
// - Every house draws one door, on its door block, in the cell beside its lane point.
// - No block goes over 3 storeys, and nothing is drawn above the third storey's roof and chimney.
// Runs in Node with Three.js; nothing is rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A fake page, as in stability.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { SAMPLE_NAMES, sampleFilm, sampleTown } = await import('../../town/samples.js');
const { buildTown } = await import('../../town/index.js');
const { gridFor } = await import('../../town/grid.js');
const { TOWN, createMaterials } = await import('../style.js');
const { cornerPiece, pointOfKey } = await import('./pieces.js');
const { parseTown } = await import('./world.js');
const { makeModelContext } = await import('./build.js');
const { buildBlocks, planRoofs, roofLift } = await import('./blocks.js');

const NEAR = 2; // grid steps a changed block piece may be from a changed block
const MAX_FLOORS = 3;
const FILM_DAYS = [1, 7, 21, 30, 40, 60, 90, 130, 180];
const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../development-tools/game-gallery/states/town');

const materials = createMaterials();

// Draws one island's blocks alone. { log: Map(key -> text), meshes }
function drawBlocks(island, model = null) {
  const log = new Map();
  const made = makeModelContext({ materials, blobMaterial: new THREE.MeshBasicMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1), model, island, log });
  buildBlocks(made.ctx, island);
  const meshes = made.finish();
  return { log: new Map([...log].map(([key, list]) => [key, list.join(';')])), meshes };
}

// Every real town state with a grid, as [name, model].
function realModels() {
  if (!existsSync(STATES)) return [];
  const models = [];
  for (const file of readdirSync(STATES).filter(f => f.endsWith('.json')).sort()) {
    const world = buildTown(JSON.parse(readFileSync(path.join(STATES, file), 'utf8')));
    if (world?.islands?.some(i => i.grid)) models.push([file, parseTown(world)]);
  }
  return models;
}
const sampleModels = () => SAMPLE_NAMES.map(name => [name, parseTown(sampleTown(name))]);
const allModels = () => [...sampleModels(), ...realModels()];
const housed = model => model.islands.filter(island => island.floors.size);

// The steady planner's film, once the real layout draws it; the sample films otherwise.
function films() {
  const files = FILM_DAYS.map(day => path.join(STATES, `steady-day-${day}.json`));
  if (files.every(existsSync)) {
    const states = files.map(file => buildTown(JSON.parse(readFileSync(file, 'utf8'))));
    if (states[0]?.islands?.some(i => i.grid)) return [['steady planner', states.map((world, n) => ({ label: `day ${FILM_DAYS[n]}`, world }))]];
  }
  return SAMPLE_NAMES.map(name => [name, sampleFilm(name)]);
}

// What a block point holds that blocks.js draws from.
function blockText(island, p) {
  const doors = island.doors.filter(d => d.point === p || d.outside === p).map(d => `${d.point}>${d.outside}`).sort().join(',');
  return `${island.floors.get(p) ?? 0}|${island.look.get(p) ?? ''}|${doors}`;
}

function stepsFrom(grid, starts) {
  const steps = new Map(starts.map(s => [s, 0]));
  const queue = [...starts];
  for (let h = 0; h < queue.length; h++) for (const n of grid.neighbours[queue[h]]) if (!steps.has(n)) { steps.set(n, steps.get(queue[h]) + 1); queue.push(n); }
  return steps;
}

test('roof plan: links go both ways and gable arms point only at lower neighbours', () => {
  for (const [name, model] of allModels()) {
    for (const island of housed(model)) {
      const { arms } = planRoofs(island);
      const fl = p => island.floors.get(p) ?? 0;
      for (const [s, list] of arms) {
        for (const n of list) {
          assert.ok(island.grid.neighbours[s].includes(n), `${name} ${island.id}: ${s} has an arm to ${n}, which is not a neighbour`);
          if (fl(n) === fl(s)) assert.ok(arms.get(n)?.has(s), `${name} ${island.id}: ${s} links to ${n} but not back`);
          else assert.ok(fl(n) < fl(s), `${name} ${island.id}: ${s} has a gable arm toward the taller ${n}`);
        }
        // A same-height neighbour that links back is linked here too (the roofs meet on their shared line).
        for (const n of island.grid.neighbours[s]) if (fl(n) === fl(s) && arms.get(n)?.has(s)) assert.ok(list.has(n), `${name} ${island.id}: ${n} links to ${s} but not back`);
      }
    }
  }
});

test('roof plan: a lone block on a four-way point gets a gable; a row runs its ridge end to end', () => {
  const grid = gridFor('blocks-test', 'medium');
  let c = -1, best = Infinity;
  grid.points.forEach((q, p) => {
    if (grid.neighbours[p].length !== 4 || grid.fromRim[p] < 6 || grid.neighbours[p].some(n => grid.neighbours[n].length !== 4)) return;
    const d = Math.hypot(q[0], q[1]);
    if (d < best) { best = d; c = p; }
  });
  assert.ok(c >= 0, 'a four-way point with four-way neighbours');
  const island = blocks => parseTown({
    islands: [{ id: 'blocks-test', kind: 'home', size: 'medium', grid, at: [0, 0], lift: 0, land: [...grid.points.keys()].filter(p => grid.fromRim[p] > 2), kept: [], lanes: [], houses: [{ id: 'h', look: 0, door: null, blocks: blocks.map(point => ({ point, floors: 1 })) }] }],
    things: [], bridges: [], helpers: [],
  }).islands[0];
  const lone = planRoofs(island([c])).arms.get(c);
  assert.equal(lone.size, 2, 'two gable arms');
  const [a, b] = [...lone];
  assert.ok(!grid.around[c].some(cell => grid.cells[cell].includes(a) && grid.cells[cell].includes(b)), 'the gable arms are on opposite sides');

  // A row of three along a straight line through c.
  const [x, z] = grid.points[c];
  const [n0] = grid.neighbours[c];
  const way = n => Math.atan2(grid.points[n][1] - z, grid.points[n][0] - x);
  const n1 = grid.neighbours[c].reduce((far, n) => (Math.abs(Math.cos(way(n) - way(n0))) > 0.7 && Math.cos(way(n) - way(n0)) < Math.cos(way(far) - way(n0)) ? n : far), n0);
  assert.notEqual(n1, n0);
  const row = planRoofs(island([n0, c, n1])).arms;
  assert.deepEqual([...row.get(c)].sort(), [n0, n1].sort(), 'the middle links both ways');
  for (const end of [n0, n1]) {
    assert.ok(row.get(end).has(c), 'each end links to the middle');
    assert.equal(row.get(end).size, 2, 'and carries its ridge on to a gable');
  }
});

test('roofLift: neighbouring corner pieces meet along every shared line', () => {
  const kinds = [[false, false], [true, false], [false, true], [true, true]];
  for (let t = 0; t <= 1.0001; t += 0.125) {
    for (const [a1, b1] of kinds) {
      const lift = roofLift(a1, b1);
      for (const v of [lift(0, 0), lift(1, 0), lift(0, 1), lift(1, 1), lift(t, t)]) assert.ok(v >= 0 && v <= 1, 'between eave and ridge');
      for (const [a2, b2] of kinds) {
        const other = roofLift(a2, b2);
        // The half side from the point toward a neighbour: b = 0 in the piece where it is next, a = 0 where
        // it is previous. Both pieces have the arm, or neither.
        if (a1 === b2) assert.ok(Math.abs(lift(t, 0) - other(0, t)) < 1e-9, `half side ${a1}/${b2} at ${t}`);
        // The line between two points' areas: a = 1 on one side, b = 1 on the other. Linked both ways, or neither.
        if (a1 === b2) assert.ok(Math.abs(lift(1, t) - other(t, 1)) < 1e-9, `area line ${a1}/${b2} at ${t}`);
      }
    }
  }
});

test('blocks: drawing the same island twice gives identical pieces', () => {
  for (const [name, model] of allModels()) {
    for (const island of housed(model)) {
      const first = drawBlocks(island, model), second = drawBlocks(island, model);
      assert.ok(first.log.size > 0, `${name} ${island.id}: no block pieces`);
      assert.equal(first.log.size, second.log.size, `${name} ${island.id}: a different number of pieces`);
      for (const [key, text] of first.log) assert.equal(second.log.get(key), text, `${name} ${island.id}: ${key} drew differently`);
      for (const key of first.log.keys()) assert.match(key, /^block:\d+:[0-3]:[0-2]:[a-z]+(:[A-Z])?$/, `${name} ${island.id}: odd key ${key}`);
    }
  }
});

test('blocks: between film steps, block pieces change only near blocks that changed', () => {
  for (const [name, film] of films()) {
    let before = parseTown(film[0].world);
    let drawn = new Map(housed(before).map(island => [island.id, drawBlocks(island, before).log]));
    for (const step of film.slice(1)) {
      const after = parseTown(step.world);
      const now = new Map(after.islands.map(island => [island.id, island.floors.size ? drawBlocks(island, after).log : new Map()]));
      for (const island of after.islands) {
        const old = before.byId?.get(island.id) ?? before.islands.find(i => i.id === island.id);
        if (!old || old.grid !== island.grid) continue;
        const changed = [];
        for (let p = 0; p < island.grid.points.length; p++) if (blockText(old, p) !== blockText(island, p)) changed.push(p);
        const steps = stepsFrom(island.grid, changed);
        const a = drawn.get(island.id) ?? new Map(), b = now.get(island.id);
        for (const key of new Set([...a.keys(), ...b.keys()])) {
          if (a.get(key) === b.get(key)) continue;
          const p = pointOfKey(island.grid, key);
          const d = steps.get(p) ?? Infinity;
          assert.ok(d <= NEAR, `${name}, ${step.label}, ${island.id}: ${key} ${!a.has(key) ? 'appeared' : !b.has(key) ? 'went' : 'changed'} ${d === Infinity ? 'with no block changed' : `${d} steps from a change`}`);
        }
      }
      before = after;
      drawn = now;
    }
  }
});

test('blocks: every house draws one door, on its door block, beside its lane point', () => {
  for (const [name, model] of allModels()) {
    for (const island of housed(model)) {
      const { log } = drawBlocks(island, model);
      const doorPieces = [...log.keys()].filter(key => key.endsWith(':door'));
      const { doors } = planRoofs(island);
      assert.equal(doorPieces.length, doors.size, `${name} ${island.id}: ${doorPieces.length} doors drawn for ${doors.size} doors`);
      for (const house of island.houses) {
        const door = island.doors.find(d => d.house === house.id);
        if (!door) continue;
        const mine = doorPieces.filter(key => pointOfKey(island.grid, key) === door.point);
        assert.equal(mine.length, 1, `${name} ${island.id}: house ${house.id} draws ${mine.length} doors`);
        const cell = Number(mine[0].split(':')[1]);
        assert.ok(island.grid.cells[cell].includes(door.outside), `${name} ${island.id}: house ${house.id}'s door is not beside its outside point`);
        assert.ok(mine[0].split(':')[3] === '0', `${name} ${island.id}: house ${house.id}'s door is not on the ground floor`);
        if (island.lanes.size) assert.ok(island.lanes.has(door.outside), `${name} ${island.id}: house ${house.id}'s door faces ${door.outside}, which is not a lane`);
      }
    }
  }
});

test('blocks: a wall just behind a lower block\'s roof has windows only when it faces the camera', () => {
  // Today looks north, so a wall faces the camera when its outward way points south (+z). Seen side-on
  // or from behind, the window boxes on such a join wall stick out past the corner as a ragged strip.
  const T = 1 - TOWN.wallInset;
  let facing = 0;
  for (const [name, model] of allModels()) {
    for (const island of housed(model)) {
      const fl = p => island.floors.get(p) ?? 0;
      for (const key of drawBlocks(island, model).log.keys()) {
        const [, cell, k, level, kind, side] = key.split(':');
        if (kind !== 'window') continue;
        const c = cornerPiece(island.grid, Number(cell), Number(k));
        const toward = side === 'A' ? c.next : c.prev;
        if (!fl(toward)) continue;
        const [x, , z] = side === 'A' ? c.dir(T, T / 2, 1, 0) : c.dir(T / 2, T, 0, 1);
        const south = z / Math.hypot(x, z);
        assert.ok(south >= 0.2, `${name} ${island.id}: ${key} is on storey ${Number(level) + 1} of a wall behind block ${toward}'s roof, turned ${south.toFixed(2)} toward the camera`);
        if (south >= 0.6) facing++;
      }
    }
  }
  assert.ok(facing > 0, 'join walls that face the camera keep their windows');
});

test('blocks: no block goes over 3 storeys', () => {
  const ceiling = MAX_FLOORS * TOWN.storey + TOWN.roofRise + 0.25; // the top roof, its trim and a chimney
  for (const [name, model] of allModels()) {
    for (const island of housed(model)) {
      for (const [p, floors] of island.floors) assert.ok(floors >= 1 && floors <= MAX_FLOORS, `${name} ${island.id}: block ${p} has ${floors} storeys`);
      const { log, meshes } = drawBlocks(island, model);
      for (const key of log.keys()) assert.ok(Number(key.split(':')[3]) < MAX_FLOORS, `${name} ${island.id}: ${key} is above the third storey`);
      for (const mesh of meshes) {
        const array = mesh.geometry.attributes.position.array;
        for (let i = 1; i < array.length; i += 3) {
          assert.ok(Number.isFinite(array[i]), `${name} ${island.id}: a vertex is not a number`);
          assert.ok(array[i] <= ceiling, `${name} ${island.id}: something is drawn at ${array[i].toFixed(2)}, above ${ceiling.toFixed(2)}`);
        }
      }
    }
  }
});
