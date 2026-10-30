// Stream C's checks for the ground and lanes (ground.js, lanes.js, pieces.js), in Node with Three.js and
// no WebGL. The whole-scene drawing check is stability.test.js; this one looks closer at C's pieces:
// - drawing the same state twice gives identical pieces and the same coast;
// - between neighbouring sample film steps, a changed piece is within 2 grid steps of a changed point
//   (the underside within 6), and coast points move only near land that came or went;
// - every key reads back to a land point (lane pieces to a lane point), and no vertex is NaN;
// - lane tops have no cracks: every edge of a lane's top is shared by two top triangles or sits on a rim;
// - the coast loop starts at the same place when far-away land changes;
// - triangle counts for the biggest saved day-180 island (printed, for the report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { SAMPLE_NAMES, sampleFilm, sampleTown } = await import('../../town/samples.js');
const { buildTown } = await import('../../town/index.js');
const { createMaterials, TOWN } = await import('../style.js');
const { parseTown } = await import('./world.js');
const { makeModelContext } = await import('./build.js');
const { buildGround } = await import('./ground.js');
const { buildLanes } = await import('./lanes.js');
const { pointOfKey } = await import('./pieces.js');

const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../development-tools/game-gallery/states/town');
const shared = { materials: createMaterials(), blobMaterial: new THREE.MeshBasicMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1) };
const now = () => globalThis.performance?.now?.() ?? Date.now();

// Draws each island's ground and lanes with every piece logged.
function draw(world) {
  const model = parseTown(world);
  const islands = new Map();
  for (const island of model.islands) {
    const log = new Map();
    const made = makeModelContext({ ...shared, model, island, log });
    const started = now();
    const ground = buildGround(made.ctx, island);
    buildLanes(made.ctx, island);
    const meshes = made.finish();
    const ms = now() - started;
    const triangles = meshes.reduce((sum, m) => sum + m.geometry.attributes.position.count / 3, 0);
    const bad = meshes.some(m => m.geometry.attributes.position.array.some(v => !Number.isFinite(v)));
    for (const item of made.disposables) item?.dispose?.();
    islands.set(island.id, { island, log, pieces: new Map([...log].map(([key, list]) => [key, list.join(';')])), ground, triangles, calls: meshes.length, ms, bad });
  }
  return { model, islands };
}

// What one point holds that the ground and lanes draw from.
function pointText(island, p, model) {
  const door = island.doors.filter(d => d.point === p || d.outside === p).map(d => `${d.point}>${d.outside}`).join(',');
  const pad = island.things.filter(t => t.pad && (t.points.includes(p) || t.front === p)).map(t => `${t.id}:${t.front}`).join(',');
  const feet = island.feet.filter(f => f.point === p).map(f => `${f.bridge}>${f.out}`).join(',');
  return [island.land.has(p), island.lanes.has(p), door, pad, feet].join('|');
}

function stepsFrom(grid, starts) {
  const steps = new Map(starts.map(s => [s, 0]));
  const queue = [...starts];
  for (let h = 0; h < queue.length; h++) for (const n of grid.neighbours[queue[h]]) if (!steps.has(n)) { steps.set(n, steps.get(queue[h]) + 1); queue.push(n); }
  return steps;
}

function compare(before, after, label) {
  const problems = [];
  for (const [id, a] of before.islands) {
    const b = after.islands.get(id);
    if (!b) continue;
    const { grid } = a.island;
    const changed = [];
    for (let p = 0; p < grid.points.length; p++) if (pointText(a.island, p, before.model) !== pointText(b.island, p, after.model)) changed.push(p);
    const steps = stepsFrom(grid, changed);
    for (const key of new Set([...a.pieces.keys(), ...b.pieces.keys()])) {
      if (a.pieces.get(key) === b.pieces.get(key) || key === 'slab') continue;
      const p = pointOfKey(grid, key);
      const limit = key.startsWith('under') ? 6 : 2;
      const d = p === null ? Infinity : steps.get(p) ?? Infinity;
      if (d > limit) problems.push(`${label} ${id}: ${key} changed ${d === Infinity ? 'with nothing changed' : `${d} steps from a change`}`);
    }
    const landChanged = changed.filter(p => a.island.land.has(p) !== b.island.land.has(p)).map(p => grid.points[p]);
    const text = loop => new Set(loop.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`));
    const oldCoast = text(a.ground.loop), newCoast = text(b.ground.loop);
    for (const point of [...oldCoast].filter(t => !newCoast.has(t)).concat([...newCoast].filter(t => !oldCoast.has(t)))) {
      const [x, z] = point.split(',').map(Number);
      const d = Math.min(Infinity, ...landChanged.map(q => Math.hypot(q[0] - x, q[1] - z)));
      if (d > 1.3) { problems.push(`${label} ${id}: coast point ${point} moved ${d === Infinity ? 'with no land change' : `${d.toFixed(2)} from changed land`}`); break; }
    }
  }
  return problems;
}

// The saved day-180 states, laid out by the real layout, when they exist.
function savedDay180() {
  const file = path.join(STATES, 'steady-day-180.json');
  if (!existsSync(file)) return null;
  try {
    const world = buildTown(JSON.parse(readFileSync(file, 'utf8')));
    return world?.islands?.some(i => i.grid) ? world : null;
  } catch { return null; }
}

test('drawing the same state twice gives identical ground and lane pieces', () => {
  for (const name of SAMPLE_NAMES) {
    const world = sampleTown(name);
    const a = draw(world), b = draw(world);
    for (const [id, one] of a.islands) {
      const two = b.islands.get(id);
      assert.equal(one.pieces.size, two.pieces.size, `${name} ${id}: piece count`);
      for (const [key, text] of one.pieces) assert.equal(two.pieces.get(key), text, `${name} ${id}: ${key} drew differently`);
      assert.deepEqual(one.ground.loop, two.ground.loop, `${name} ${id}: the coast differs`);
    }
  }
});

test('between neighbouring film steps, ground and lanes change only near what changed', () => {
  for (const name of SAMPLE_NAMES) {
    const film = sampleFilm(name);
    let before = draw(film[0].world);
    for (const step of film.slice(1)) {
      const after = draw(step.world);
      assert.deepEqual(compare(before, after, `${name}, ${step.label}:`), []);
      before = after;
    }
  }
});

test('keys read back to their points, lanes to lane points, and every vertex is a number', () => {
  const worlds = SAMPLE_NAMES.map(name => sampleTown(name));
  const saved = savedDay180();
  if (saved) worlds.push(saved);
  for (const world of worlds) {
    for (const [id, drawn] of draw(world).islands) {
      const { island } = drawn;
      assert.ok(!drawn.bad, `${id}: a vertex is not a number`);
      if (island.land.size) assert.ok(drawn.pieces.has('slab'), `${id}: no slab`);
      for (const key of drawn.pieces.keys()) {
        if (key === 'slab') continue;
        const p = pointOfKey(island.grid, key);
        assert.ok(p !== null && island.land.has(p), `${id}: ${key} is not on a land point`);
        if (key.startsWith('lane:')) assert.ok(island.lanes.has(p), `${id}: ${key} is not on a lane point`);
        else assert.ok(key.startsWith('under:'), `${id}: unexpected key ${key}`);
      }
      assert.ok(drawn.ground.loop.length >= 3 || !island.land.size, `${id}: no coast`);
      for (const point of drawn.ground.framePoints) assert.ok(point.length === 3 && point.every(Number.isFinite), `${id}: a bad frame point`);
    }
  }
});

test('lane tops have no cracks: each top edge is shared by two top triangles or sits on a rim', () => {
  const worlds = SAMPLE_NAMES.map(name => sampleTown(name));
  const saved = savedDay180();
  if (saved) worlds.push(saved);
  const top = TOWN.laneRise.toFixed(4);
  for (const world of worlds) {
    for (const [id, drawn] of draw(world).islands) {
      const uses = new Map(), rims = new Set();
      const edge = (u, v) => (u < v ? `${u}|${v}` : `${v}|${u}`);
      for (const [key, list] of drawn.log) {
        if (!key.startsWith('lane:') || key.includes(':deck:')) continue;
        for (let i = 0; i < list.length; i += 3) {
          const tri = [list[i], list[i + 1], list[i + 2]];
          const high = tri.map(v => v.split(',')[1] === top);
          for (let j = 0; j < 3; j++) {
            const u = tri[j], v = tri[(j + 1) % 3];
            if (!high[j] || !high[(j + 1) % 3]) continue;
            if (high.every(Boolean)) uses.set(edge(u, v), (uses.get(edge(u, v)) ?? 0) + 1);
            else rims.add(edge(u, v));
          }
        }
      }
      const open = [...uses].filter(([e, n]) => n === 1 && !rims.has(e));
      assert.deepEqual(open.slice(0, 5), [], `${id}: ${open.length} lane top edges with nothing on the other side`);
    }
  }
});

test('the coast starts at the same place when land changes far away', () => {
  const world = sampleTown('manyIslands');
  const home = world.islands[0];
  const before = draw(world).islands.get(home.id).ground.loop;
  // One more land point on the side away from where the loop starts.
  const [sx, sz] = before[0];
  const land = new Set(home.land);
  const far = home.land.flatMap(p => home.grid.neighbours[p]).filter(p => !land.has(p) && !home.kept.includes(p))
    .sort((a, b) => Math.hypot(home.grid.points[b][0] - sx, home.grid.points[b][1] - sz) - Math.hypot(home.grid.points[a][0] - sx, home.grid.points[a][1] - sz))[0];
  const grown = { ...world, islands: world.islands.map((i, n) => (n ? i : { ...i, land: [...i.land, far] })) };
  const after = draw(grown).islands.get(home.id).ground.loop;
  assert.deepEqual(after[0], before[0]);
  assert.notDeepEqual(after, before);
});

test('triangle counts for a day-180 island (for the report)', t => {
  const saved = savedDay180();
  if (!saved) { t.skip('no saved day-180 state yet'); return; }
  const drawn = draw(saved);
  const rows = [...drawn.islands.values()].map(d => ({ id: d.island.id, land: d.island.land.size, lanes: d.island.lanes.size, triangles: Math.round(d.triangles), calls: d.calls, ms: Math.round(d.ms) }));
  t.diagnostic(`ground + lanes at day 180: ${rows.map(r => `${r.id} (${r.land} land, ${r.lanes} lanes): ${r.triangles} triangles, ${r.calls} draw calls, ${r.ms} ms`).join('; ')}`);
  t.diagnostic(`all islands: ${rows.reduce((s, r) => s + r.triangles, 0)} triangles, ${rows.reduce((s, r) => s + r.calls, 0)} draw calls`);
  for (const row of rows) assert.ok(row.triangles > 0);
});
