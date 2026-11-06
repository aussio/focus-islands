// The farmyard model (farm.js), checked on real layouts:
// - both stages (coop, and barn after the extension) stay inside the farm's straw pad on real towns,
//   so the yard lines up with its six-point plot;
// - the building stands at the plot's end away from the camera, so it never hides the yard;
// - the animals take turns: at most one moves at a time and each is still at least 80% of the yard's
//   loop; they move only on the yard's turns (calm.js, tested in calm.test.js), never at time 0, in
//   quiet moods or while a moving visitor is anywhere;
// - an island kept between check-ins still sees the current world (another island's visitor);
// - its size stays modest, and everything it makes is freed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { farmyard, yardMoment, CYCLE, YARD_TURNS } = await import('./farm.js');
const { loopOwner } = await import('../calm.js');
const { createMaterials, MOODS, TOWN } = await import('../style.js');
const { makeModelContext, makeBlobMaterial, createTownBuilder } = await import('../town/build.js');
const { modelScale, padOutline } = await import('../town/pads.js');
const { piecesAt, parts, SLAB_CUT } = await import('../town/pieces.js');
const { parseTown } = await import('../town/world.js');
const { place } = await import('../ground.js');
const { buildTown } = await import('../../town/index.js');
const require = createRequire(import.meta.url);
const sim = require('../../../../core/game/simulate.js');

const STATES = new URL('../../../../../development-tools/game-gallery/states/town/', import.meta.url);
const state = name => JSON.parse(readFileSync(new URL(`${name}.json`, STATES)));
const shared = () => ({ materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) });
// The scene time a loop owned by the yard on an island starts at (drawFarm's island has no id).
const yardLoop = (island = '') => { for (let n = 1; ; n++) if (loopOwner(island, n) === 'yard') return n * CYCLE; };
const freeShared = s => { Object.values(s.materials).forEach(m => m.dispose()); s.blobMaterial.dispose(); s.blobPlane.dispose(); };

// A game with a farm (and its extension) on one island, as the gallery's fixture does.
function withFarm(name, island = 'home', extension = true) {
  const game = state(name), home = game.islands.find(i => i.id === island);
  home.land = Math.max(140, home.land);
  const checkIn = Math.max(0, ...game.islands.flatMap(i => i.buildings.map(b => b.checkIn || 0))) + 1;
  home.buildings.push({ id: 'farm-test', blueprint: 'farmyard', checkIn, landWhenBuilt: home.land });
  if (extension) home.buildings.push({ id: 'farm-test-barn', blueprint: 'farmextension', parentBuildingId: 'farm-test', checkIn: checkIn + 1, landWhenBuilt: home.land });
  return game;
}

// Draws one farm's model as Today places it on its plot (scene/town/pads.js placeModel). With a grid,
// the model gets the real plot's outline; without one, it draws its own small plot.
function drawFarm(s, thing, extension, model = null, grid = null) {
  const made = makeModelContext({ ...s, model });
  const base = place(thing.at[0], TOWN.padRise, thing.at[1], { ry: thing.yaw, s: modelScale(thing) });
  const plot = grid ? padOutline(grid, thing.points, thing.front) : undefined;
  farmyard(made.ctx, { id: thing.id, yaw: thing.yaw, extension, plot }, base);
  made.finish();
  return made;
}

// Whether an island point [x, z] is on the farm's pad, drawn as scene/town/pads.js buildPad does:
// in each corner piece around its points, the parts slabPiece fills (with its cut outer corner).
function onPad(grid, points, [x, z], slack = 0.004) {
  const mine = new Set(points), t = TOWN.padWidth;
  for (const p of points) {
    for (const piece of piecesAt(grid, p)) {
      const [a, b] = piece.unit([x, z]);
      if (a < -slack || b < -slack || a > 1 + slack || b > 1 + slack) continue;
      const fA = mine.has(piece.next), fB = mine.has(piece.prev), fO = mine.has(piece.opp);
      const { cells, filled } = parts(t, fA, fB, fO);
      for (const [name, [[a0, b0], [a1, b1]]] of Object.entries(cells)) {
        if (!filled[name] || a < a0 - slack || b < b0 - slack || a > a1 + slack || b > b1 + slack) continue;
        if (name === 'core' && !fA && !fB && a + b > 2 * t - SLAB_CUT + slack) continue;
        return true;
      }
    }
  }
  return false;
}

// Every vertex [x, y, z] under the context's root, in island units, except the soft shadow.
function vertices(ctx) {
  ctx.root.updateMatrixWorld(true);
  const out = [], v = new THREE.Vector3();
  ctx.root.traverse(node => {
    const p = node.geometry?.attributes?.position;
    if (!p || node.name === 'batch-blob') return;
    for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld).toArray());
  });
  return out;
}

// The farm's animals: the groups it adds straight under the root. Each one's pose, as text.
const animals = ctx => ctx.root.children.filter(c => c.name.startsWith('farm-'));
function poseOf(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(node => { if (node.isMesh) parts.push(node.matrixWorld.elements.map(v => v.toFixed(5)).join(',')); });
  return parts.join(';');
}

// A farm added to each island of each saved gallery town (simulated players, days 7 to 180), plus the
// farms one simulated player builds by day 180: [label, world, thing].
let found = null;
function realFarms() {
  if (found) return found;
  const farms = [];
  for (const file of readdirSync(STATES).filter(n => n.endsWith('.json'))) {
    const name = file.replace(/\.json$/, '');
    for (const island of state(name).islands.map(i => i.id)) {
      const world = buildTown(withFarm(name, island, false));
      const thing = world.things.find(t => t.id === 'farm-test');
      if (thing) farms.push([`${name} ${island}`, world, thing]);
    }
  }
  const played = buildTown(sim.run('steady', 180, { snapshots: [180] }).states[180]);
  for (const thing of played.things.filter(t => t.kind === 'farmyard')) farms.push([`steady sim ${thing.island}`, played, thing]);
  return (found = farms);
}

test('both stages fill their real plot and stay on it', () => {
  const farms = realFarms();
  assert.ok(farms.length >= 30, `enough real farms to check (${farms.length})`);
  const s = shared();
  try {
    for (const [where, world, thing] of farms) {
      const grid = world.islands.find(i => i.id === thing.island).grid;
      for (const extension of [null, 'barn']) {
        const made = drawFarm(s, thing, extension, null, grid);
        try {
          const label = `${where} ${extension ? 'barn' : 'coop'}`;
          // The plot's length along the model's x axis, through its middle, and how much of it the
          // model covers (the building at one end, the fence at the other).
          const axis = [Math.cos(thing.yaw), -Math.sin(thing.yaw)];
          const along = ([x, z]) => (x - thing.at[0]) * axis[0] + (z - thing.at[1]) * axis[1];
          const reach = sign => { let d = 0; while (d < 3 && onPad(grid, thing.points, [thing.at[0] + axis[0] * sign * (d + 0.005), thing.at[1] + axis[1] * sign * (d + 0.005)])) d += 0.005; return d; };
          let low = Infinity, high = -Infinity;
          // Each vertex's footprint, to the nearest millimetre of island, checked once.
          let off = 0;
          const seen = new Set();
          for (const [x, y, z] of vertices(made.ctx)) {
            const a = along([x, z]); low = Math.min(low, a); high = Math.max(high, a);
            assert.ok([x, y, z].every(Number.isFinite));
            assert.ok(y < 1.1, `${label}: modest height`);
            const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!onPad(grid, thing.points, [x, z])) off++;
          }
          assert.equal(off, 0, `${label}: every part is on the plot`);
          const cover = (high - low) / (reach(1) + reach(-1));
          assert.ok(cover > 0.8, `${label}: fills its plot (${(cover * 100).toFixed(0)}% of its length)`);
        } finally { made.disposables.forEach(x => x?.dispose?.()); }
      }
    }
  } finally { freeShared(s); }
});

test('the building stands at the end away from the camera', () => {
  // The camera looks from the south (+z), so the building's roof (the middle of its top part) must be
  // clearly north of the plot's middle when the plot runs at all north and south. A plot running about
  // east and west keeps its building at the end away from its lane, at most a little south. The roof is
  // the top part above the gate's capped posts (0.288 high in the model), which a small coop's top part
  // would otherwise take in.
  const s = shared();
  let leaning = 0;
  try {
    for (const [where, world, thing] of realFarms()) {
      const grid = world.islands.find(i => i.id === thing.island).grid;
      const north = Math.abs(Math.sin(thing.yaw)) > 0.3;
      if (north) leaning++;
      for (const extension of [null, 'barn']) {
        const made = drawFarm(s, thing, extension, null, grid);
        try {
          const all = vertices(made.ctx), high = Math.max(...all.map(v => v[1]));
          const above = Math.max(0.6 * (high - TOWN.padRise), 0.3 * modelScale(thing));
          const roof = all.filter(v => v[1] > TOWN.padRise + above);
          const z = roof.reduce((sum, v) => sum + v[2], 0) / roof.length;
          const label = `${where} ${extension ? 'barn' : 'coop'}`;
          assert.ok(z <= thing.at[1] + 0.1, `${label}: the building is not on the camera's side`);
          if (north) assert.ok(z < thing.at[1] - 0.15 * Math.abs(Math.sin(thing.yaw)), `${label}: the building is at the north end (${(z - thing.at[1]).toFixed(2)})`);
        } finally { made.disposables.forEach(x => x?.dispose?.()); }
      }
    }
  } finally { freeShared(s); }
  assert.ok(leaning >= 5, `enough plots running north and south to check (${leaning})`);
});

test('the yard animals take turns on the yard\'s loop and rest most of it', () => {
  const s = shared();
  const made = drawFarm(s, { id: 'farm', at: [0, 0], yaw: 0.4, scale: 1, pad: true, kind: 'farmyard' }, 'barn');
  try {
    const groups = animals(made.ctx);
    assert.equal(groups.length, 3, 'two hens and a sheep');
    const base = yardLoop();
    const at = t => { made.ctx.dynamic.forEach(fn => fn(base + t)); return groups.map(poseOf); };
    const rest = at(0);
    const step = 0.1, moving = groups.map(() => 0);
    for (let t = 0; t < CYCLE; t += step) {
      const a = at(t), b = at(t + step);
      const now = a.map((p, i) => p !== b[i]);
      now.forEach((m, i) => { if (m) moving[i] += step; });
      assert.ok(now.filter(Boolean).length <= 1, `at most one animal moves at ${t.toFixed(1)} s`);
    }
    for (const seconds of moving) {
      assert.ok(seconds > 0, 'every animal does something');
      assert.ok(seconds <= 0.2 * CYCLE, `still at least 80% of the time (moved ${seconds.toFixed(1)} s)`);
    }
    assert.deepEqual(at(CYCLE), rest, 'each turn ends where it began');
    assert.deepEqual(yardMoment(0), yardMoment(CYCLE * 3));
    // Each hen pecks every 15 to 20 seconds, around the loop.
    for (const hen of [0, 1]) {
      const pecks = YARD_TURNS.filter(([, , animal, action]) => animal === hen && action === 'peck').map(([start]) => start).sort((x, y) => x - y);
      pecks.forEach((start, i) => {
        const gap = i ? start - pecks[i - 1] : start + CYCLE - pecks.at(-1);
        assert.ok(gap >= 15 && gap <= 20, `hen ${hen} pecks ${gap.toFixed(1)} s apart`);
      });
    }
    // A turn cut short (here by reduced motion's time 0, then by a mood change) never leaves a hen out.
    at(9.3);
    assert.deepEqual(at(-base), rest, 'held still: straight back to rest');
  } finally { made.disposables.forEach(x => x?.dispose?.()); freeShared(s); }
});

test('the animals stay still in quiet moods and while a moving visitor is anywhere', () => {
  const s = shared();
  const thing = { id: 'farm', at: [0, 0], yaw: 0, scale: 1, pad: true, kind: 'farmyard' };
  try {
    for (const [visitor, mood] of [[null, 'done'], [null, 'away'], ['raincloud', 'focus'], ['balloon', 'break']]) {
      const made = drawFarm(s, thing, 'barn', { islands: [{ id: 'a', visitor: null }, { id: 'b', visitor }] });
      try {
        made.moodHooks.forEach(fn => fn(mood, MOODS[mood]));
        made.ctx.dynamic.forEach(fn => fn(0)); const before = animals(made.ctx).map(poseOf);
        for (const t of [0.5, 9, 12, 15, 19, 33, 46]) { made.ctx.dynamic.forEach(fn => fn(yardLoop() + t)); assert.deepEqual(animals(made.ctx).map(poseOf), before, `${visitor ?? mood} at ${t}`); }
      } finally { made.disposables.forEach(x => x?.dispose?.()); }
    }
    // A tent stays put, and a bird takes turns (calm.js), so neither stops them.
    for (const visitor of ['tent', 'bird']) {
      const made = drawFarm(s, thing, 'barn', { islands: [{ id: 'b', visitor }] });
      try {
        made.ctx.dynamic.forEach(fn => fn(0)); const before = animals(made.ctx).map(poseOf);
        for (const t of [0.5, 9.3]) made.ctx.dynamic.forEach(fn => fn(yardLoop() + t));
        assert.notDeepEqual(animals(made.ctx).map(poseOf), before, visitor);
      } finally { made.disposables.forEach(x => x?.dispose?.()); }
    }
  } finally { freeShared(s); }
});

test('a farm island kept between check-ins sees another island\'s visitor come and go', () => {
  const s = shared();
  const builder = createTownBuilder(new THREE.Group(), s.materials);
  try {
    const game = withFarm('steady-day-60', 'home', false);
    const other = game.islands.find(i => i.id !== 'home').id;
    const plain = parseTown(buildTown(game));
    const visited = parseTown(buildTown({ ...game, visitor: { kind: 'balloon', island: other } }));
    builder.update(plain);
    const home = builder.islands.get('home');
    const hens = () => home.group.children.filter(c => c.name.startsWith('farm-')).map(poseOf);
    const moves = () => { builder.animate(0); const a = hens(); builder.animate(yardLoop('home') + 0.5); builder.animate(yardLoop('home') + 9.3); return JSON.stringify(hens()) !== JSON.stringify(a); };
    assert.equal(hens().length, 2);
    assert.ok(moves(), 'a hen pecks with no visitor about');
    const report = builder.update(visited);
    assert.ok(report.kept.includes('home') && report.rebuilt.includes(other), 'only the visited island is rebuilt');
    assert.equal(builder.islands.get('home'), home);
    assert.ok(!moves(), 'the hens keep still while a balloon visits another island');
    builder.update(plain);
    assert.ok(moves(), 'and peck again once it has gone');
  } finally { builder.dispose(); freeShared(s); }
});

test('the farm stays modest in triangles and draws', () => {
  const s = shared();
  try {
    for (const extension of [null, 'barn']) {
      const made = drawFarm(s, { id: 'farm', at: [0, 0], yaw: 0, scale: 1, pad: true, kind: 'farmyard' }, extension);
      try {
        let triangles = 0, meshes = 0;
        made.ctx.root.traverse(node => {
          if (!node.isMesh) return;
          meshes++;
          const g = node.geometry;
          triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
          if (node.parent !== made.ctx.root) assert.equal(node.castShadow, false, 'moving parts cast no shadow');
        });
        // In line with other pad buildings (a garden is about 7,300, beehives 8,900, a sawmill 12,100).
        assert.ok(triangles < 9500, `${extension ? 'barn' : 'coop'}: ${triangles} triangles`);
        assert.ok(meshes <= (extension ? 9 : 7), `${extension ? 'barn' : 'coop'}: ${meshes} meshes`);
      } finally { made.disposables.forEach(x => x?.dispose?.()); }
    }
  } finally { freeShared(s); }
});
