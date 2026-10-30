// The drawing check (game/BUILD_PLAN.md, "Gallery, tour and checks"): the town drawing changes only near
// what changed. Ported from the grid prototype's wonky/check.mjs, for every island and bridge.
//
// Between two states:
// - every changed piece (changed, added or removed) is within 2 grid steps of a changed point, and an
//   underside piece (key under:...) within 6;
// - no built thing's pieces (thing:<id>) change unless one of its own points did;
// - coast points (buildGround's loop) move only within 1.3 units of land that came or went;
// and drawing the same state twice gives identical pieces.
//
// States: the steady planner's town states (development-tools/game-gallery/states/town/) once the real
// layout (town/index.js buildTown) draws them; until then, the sample films (town/samples.js).
// Pieces are logged by scene/town/build.js (see withPieces in pieces.js), in island units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { SAMPLE_NAMES, sampleFilm, sampleTown } = await import('../../town/samples.js');
const { buildTown } = await import('../../town/index.js');
const { gridFor } = await import('../../town/grid.js');
const { createMaterials } = await import('../style.js');
const { pointOfKey } = await import('./pieces.js');
const { parseTown } = await import('./world.js');
const { createTownBuilder } = await import('./build.js');

const NEAR = 2; // grid steps a changed piece may be from a changed point
const NEAR_UNDER = 6; // the same for the underside
const COAST_NEAR = 1.3; // units a coast point may be from land that came or went
// Whole-island ground pieces (the slab drawn from the coast loop) are checked through the loop instead.
const WHOLE_ISLAND = ['coast', 'slab'];
const FILM_DAYS = [1, 7, 21, 30, 40, 60, 90, 130, 180];
const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../development-tools/game-gallery/states/town');

const materials = createMaterials();

// Draws a world with every piece logged. { model, logs: Map(id -> Map(key -> text)), loops: Map(id -> [[x, z]]) }
function drawTown(world) {
  const log = new Map();
  const builder = createTownBuilder(new THREE.Group(), materials, { log });
  const model = parseTown(world);
  builder.update(model);
  const loops = new Map();
  for (const [id, built] of builder.islands) loops.set(id, flatLoop(built.loop));
  builder.dispose();
  const logs = new Map([...log].map(([id, pieces]) => [id, new Map([...pieces].map(([key, list]) => [key, list.join(';')]))]));
  return { model, logs, loops };
}

// A loop may be one loop or a list of loops, of [x, z] or [x, y, z] points.
function flatLoop(loop) {
  const points = Array.isArray(loop?.[0]?.[0]) ? loop.flat() : (loop ?? []);
  return points.filter(Array.isArray).map(p => [p[0], p[p.length - 1]]);
}

// What one grid point holds, as text, so two states can be compared point by point.
function pointText(island, p, model) {
  const thing = island.taken.get(p);
  const door = island.doors.filter(d => d.point === p || d.outside === p).map(d => `${d.house}>${d.point}>${d.outside}`).join(',');
  const feet = island.feet.filter(f => f.point === p).map(f => `${f.bridge}>${f.out}`).join(',');
  const front = model.things.filter(t => t.island === island.id && t.front === p).map(t => t.id).join(',');
  return [
    island.land.has(p) ? 'L' : '', island.lanes.has(p) ? 'P' : '', island.kept.has(p) ? 'K' : '',
    island.floors.get(p) ?? 0, island.look.get(p) ?? '', island.house.get(p) ?? '', door,
    thing ? `${thing.id}:${thing.kind}:${thing.yaw}:${thing.scale}` : '', feet, front,
  ].join('|');
}

function stepsFrom(grid, starts) {
  const steps = new Map(starts.map(s => [s, 0]));
  const queue = [...starts];
  for (let h = 0; h < queue.length; h++) for (const n of grid.neighbours[queue[h]]) if (!steps.has(n)) { steps.set(n, steps.get(queue[h]) + 1); queue.push(n); }
  return steps;
}

// Problems between two drawings of neighbouring states, as sentences. Also returns counts for the report.
function compareDrawings(before, after, label = '') {
  const problems = [];
  const counts = { pieces: 0, kept: 0, changed: 0 };
  for (const island of before.model.islands) {
    const next = after.model.byId.get(island.id);
    if (!next) continue;
    const { grid } = island;
    if (next.grid !== grid) { problems.push(`${label} ${island.id}: the grid changed`); continue; }
    const changed = [];
    for (let p = 0; p < grid.points.length; p++) if (pointText(island, p, before.model) !== pointText(next, p, after.model)) changed.push(p);
    const steps = stepsFrom(grid, changed);
    const a = before.logs.get(island.id) ?? new Map(), b = after.logs.get(island.id) ?? new Map();
    const things = new Map([...before.model.things, ...after.model.things].filter(t => t.island === island.id).map(t => [t.id, t]));
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      counts.pieces++;
      if (a.get(key) === b.get(key)) { counts.kept++; continue; }
      counts.changed++;
      const what = !a.has(key) ? 'appeared' : !b.has(key) ? 'went' : 'changed';
      if (WHOLE_ISLAND.some(prefix => key.startsWith(prefix))) continue;
      if (key.startsWith('thing:')) {
        // thing:<id>, or thing:<id>:<part> (ids may hold ':' too).
        const rest = key.slice(6);
        const thing = things.get(rest) ?? [...things.values()].find(t => rest.startsWith(`${t.id}:`));
        const own = thing ? [...thing.points, ...(thing.front === null ? [] : [thing.front])] : [];
        if (what === 'changed' && !own.some(p => steps.get(p) === 0)) problems.push(`${label} ${island.id}: ${key} ${what} though none of its points did`);
        continue;
      }
      const p = pointOfKey(grid, key);
      if (p === null) { problems.push(`${label} ${island.id}: ${key} ${what}, and it has no grid point to check`); continue; }
      const limit = key.startsWith('under') ? NEAR_UNDER : NEAR;
      const d = steps.get(p) ?? Infinity;
      if (d > limit) problems.push(`${label} ${island.id}: ${key} ${what} ${d === Infinity ? 'with nothing changed' : `${d} steps from a change`} (allowed ${limit})`);
    }
    // Coast points move only near land that came or went.
    const landChanged = changed.filter(p => island.land.has(p) !== next.land.has(p)).map(p => grid.points[p]);
    const text = loop => new Set(loop.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`));
    const oldCoast = text(before.loops.get(island.id) ?? []), newCoast = text(after.loops.get(island.id) ?? []);
    for (const point of [...oldCoast].filter(t => !newCoast.has(t)).concat([...newCoast].filter(t => !oldCoast.has(t)))) {
      const [x, z] = point.split(',').map(Number);
      const d = Math.min(Infinity, ...landChanged.map(q => Math.hypot(q[0] - x, q[1] - z)));
      if (d > COAST_NEAR) problems.push(`${label} ${island.id}: coast point ${point} moved ${d === Infinity ? 'with no land change' : `${d.toFixed(2)} from changed land`}`);
    }
  }
  // Bridges: a bridge whose ends, clear and type stayed the same draws the same.
  for (const bridge of before.model.bridges) {
    const next = after.model.bridges.find(b => b.id === bridge.id);
    if (!next || JSON.stringify([next.type, next.from, next.to]) !== JSON.stringify([bridge.type, bridge.from, bridge.to])) continue;
    const a = before.logs.get(`bridge:${bridge.id}`), b = after.logs.get(`bridge:${bridge.id}`);
    if (!sameMap(a, b)) problems.push(`${label} bridge ${bridge.id} changed though its ends and type did not`);
  }
  return { problems, counts };
}

const sameMap = (a = new Map(), b = new Map()) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

function sameDrawing(a, b) {
  const problems = [];
  for (const id of new Set([...a.logs.keys(), ...b.logs.keys()])) if (!sameMap(a.logs.get(id), b.logs.get(id))) problems.push(`${id} drew different pieces`);
  for (const [id, loop] of a.loops) if (JSON.stringify(loop) !== JSON.stringify(b.loops.get(id))) problems.push(`${id} drew a different coast`);
  return problems;
}

// The steady planner's states at the film days, once the real layout draws them; otherwise null.
function realFilm() {
  const files = FILM_DAYS.map(day => path.join(STATES, `steady-day-${day}.json`));
  if (!files.every(existsSync)) return null;
  const states = files.map(file => JSON.parse(readFileSync(file, 'utf8')));
  if (!buildTown(states[0])?.islands?.some(i => i.grid)) return null;
  return states.map((game, n) => ({ label: `day ${FILM_DAYS[n]}`, world: buildTown(game) }));
}
const films = () => {
  const real = realFilm();
  return real ? [['steady planner', real]] : SAMPLE_NAMES.map(name => [name, sampleFilm(name)]);
};

test('drawing the same state twice gives identical pieces', () => {
  for (const [name, film] of films()) {
    const last = film[film.length - 1].world;
    assert.deepEqual(sameDrawing(drawTown(last), drawTown(last)), [], `${name}: the same state drew differently`);
  }
});

test('between film steps, the drawing changes only near what changed', () => {
  for (const [name, film] of films()) {
    let before = drawTown(film[0].world);
    for (const step of film.slice(1)) {
      const after = drawTown(step.world);
      const { problems } = compareDrawings(before, after, `${name}, ${step.label}:`);
      assert.deepEqual(problems, []);
      before = after;
    }
  }
});

test('single changes stay local: one land point, one more storey, one lane point, a bridge upgrade', () => {
  const world = sampleTown('manyIslands');
  const base = drawTown(world);
  const home = world.islands[0];
  const land = new Set(home.land);
  const check = (label, changed) => assert.deepEqual(compareDrawings(base, drawTown(changed), label).problems, []);
  // One more land point on the coast.
  const sky = home.grid.neighbours[home.land[home.land.length - 1]].find(n => !land.has(n) && !home.kept.includes(n));
  check('one land point', { ...world, islands: world.islands.map((i, n) => (n ? i : { ...i, land: [...i.land, sky] })) });
  // One more storey on a block.
  const house = home.houses[0];
  check('one storey', { ...world, islands: world.islands.map((i, n) => (n ? i : { ...i, houses: i.houses.map(h => (h !== house ? h : { ...h, blocks: h.blocks.map((b, k) => (k ? b : { ...b, floors: Math.min(3, b.floors + 1) })) })) })) });
  // One more lane point next to a lane.
  const taken = new Set([...home.lanes, ...home.houses.flatMap(h => h.blocks.map(b => b.point)), ...world.things.filter(t => t.island === 'home').flatMap(t => t.points)]);
  const lane = home.lanes.flatMap(p => home.grid.neighbours[p]).find(p => land.has(p) && !taken.has(p));
  check('one lane point', { ...world, islands: world.islands.map((i, n) => (n ? i : { ...i, lanes: [...i.lanes, lane] })) });
  // A bridge upgrade changes only that bridge's pieces, and nothing on either island.
  const upgraded = drawTown({ ...world, bridges: world.bridges.map((b, n) => (n ? b : { ...b, type: 'flowerarch' })) });
  for (const island of world.islands) assert.ok(sameMap(base.logs.get(island.id), upgraded.logs.get(island.id)), `${island.id} changed on an upgrade`);
  for (const bridge of world.bridges.slice(1)) assert.ok(sameMap(base.logs.get(`bridge:${bridge.id}`), upgraded.logs.get(`bridge:${bridge.id}`)));
});

// The check itself, on a made-up drawing: one corner piece per land point and cell, shaped by the four
// points of its cell (like a real piece). A piece shaped by something far away must be caught.
test('the check catches a piece that changes far from any change', () => {
  const grid = gridFor('check-island', 'small');
  const fakeDrawing = (land, far = 0) => {
    const world = { islands: [{ id: 'x', kind: 'home', size: 'small', grid, at: [0, 0], lift: 0, land, kept: [], lanes: [], houses: [], reach: 1 }], things: [], bridges: [], helpers: [], view: { island: 'x', points: [] } };
    const model = parseTown(world);
    const island = model.islands[0];
    const pieces = new Map();
    for (const p of island.land) for (const cell of grid.around[p]) {
      const k = grid.cells[cell].indexOf(p);
      const shape = grid.cells[cell].map(q => (island.land.has(q) ? 1 : 0)).join('');
      pieces.set(`lane:${cell}:${k}`, `${shape}:${far}`);
    }
    return { model, logs: new Map([['x', pieces]]), loops: new Map() };
  };
  const land = sampleTown('firstDay').islands[0].land.length;
  const order = [...Array(grid.points.length).keys()].filter(p => grid.fromRim[p] >= 3).sort((a, b) => Math.hypot(...grid.points[a]) - Math.hypot(...grid.points[b]));
  const a = order.slice(0, land), b = order.slice(0, land + 1);
  assert.deepEqual(compareDrawings(fakeDrawing(a), fakeDrawing(b)).problems, [], 'a local change passes');
  assert.ok(compareDrawings(fakeDrawing(a), fakeDrawing(b, 1)).problems.length > 0, 'a change everywhere is caught');
});
