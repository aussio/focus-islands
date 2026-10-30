// Waterfalls (water.js) and the cost of the small looks (water.js, blocks.js), on the real town states
// (development-tools/game-gallery/states/town/, drawn by town/index.js buildTown) and on made-up islands.
//
// - Only islands with a pond or a rain catcher (kind id 'nursery'), and mossy and misty islands, pour one.
// - The same island always gets the same spot; over 2,000 ids the picked side splits about evenly, within
//   about 26 degrees of south, so both ends of the camera's sway see it.
// - A spot is never near a bridge foot or the start of its deck; a foot put on the spot moves it.
// - Moving parts are the same at the same time, stand at their built pose at time 0, cast no shadow and
//   follow the mood.
// - At day 180 the looks (waterfalls, window boxes, nests, smoke) add under 2% to the triangle total.
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
const { buildTown } = await import('../../town/index.js');
const { createMaterials } = await import('../style.js');
const { hashString } = await import('../ground.js');
const { createSceneCore } = await import('../core.js');
const { SWAY } = await import('../drift.js');
const { parseTown } = await import('./world.js');
const { makeModelContext } = await import('./build.js');
const { buildGround } = await import('./ground.js');
const { LOOKS } = await import('./blocks.js');
const { WATER_ISLANDS, WATER_MOODS, WATER_THINGS, addWaterfall, hasWaterfall, waterfallSpot } = await import('./water.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATES = path.resolve(HERE, '../../../../../development-tools/game-gallery/states/town');
const FOOT_CLEAR = 1.3; // water.js: units kept from a bridge foot and the start of its deck
const DECK = 1.6;
const IDS = 2000;

const materials = createMaterials();

// Every real town state with a grid, as [name, world, model].
function realStates() {
  if (!existsSync(STATES)) return [];
  const list = [];
  for (const file of readdirSync(STATES).filter(f => f.endsWith('.json')).sort()) {
    const world = buildTown(JSON.parse(readFileSync(path.join(STATES, file), 'utf8')));
    if (world?.islands?.some(i => i.grid)) list.push([file, world, parseTown(world)]);
  }
  return list;
}
const STATES_LIST = realStates();

// One island's ground alone. { made, loop, root }
function drawGround(island, model = null) {
  const root = new THREE.Group();
  const made = makeModelContext({ materials, blobMaterial: new THREE.MeshBasicMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1), model, island, root, log: new Map() });
  const { loop } = buildGround(made.ctx, island);
  made.finish();
  return { made, loop, root };
}
const named = (root, name) => { const list = []; root.traverse(node => { if (node.name === name) list.push(node); }); return list; };

// A round coast (radius r around 0, 0), as buildGround's loop, for made-up islands.
const circle = (r = 5, n = 160) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]);
const bare = (id, more = {}) => ({ id, kind: 'meadow', things: [], feet: [], grid: { points: [] }, ...more });

// The moving parts' state: the water's slide and the mist's points.
function pose(fall) {
  return JSON.stringify([fall.texture.offset.y, [...fall.mist.geometry.attributes.position.array], [...fall.mist.geometry.attributes.color.array]]);
}

test('waterfalls: only islands with a pond or a rain catcher, and mossy and misty islands', () => {
  assert.equal(hasWaterfall(bare('a')), false, 'a plain meadow');
  assert.equal(hasWaterfall(bare('a', { things: [{ kind: 'well' }, { kind: 'windmill' }] })), false, 'a meadow with other things');
  assert.equal(hasWaterfall(bare('a', { things: [{ kind: 'pond' }] })), true, 'a pond');
  assert.equal(hasWaterfall(bare('a', { things: [{ kind: 'nursery' }] })), true, 'a rain catcher');
  for (const kind of WATER_ISLANDS) assert.equal(hasWaterfall(bare('a', { kind })), true, kind);
  for (const kind of ['home', 'rocky', 'crystal', 'meadow']) assert.equal(hasWaterfall(bare('a', { kind })), false, kind);
  assert.equal(hasWaterfall(null), false);

  // In the real states, a waterfall is drawn on exactly the islands that should have one and found a spot.
  let drawn = 0;
  for (const [name, , model] of STATES_LIST) {
    for (const island of model.islands) {
      const { loop, root } = drawGround(island, model);
      const spot = hasWaterfall(island) ? waterfallSpot(island, loop) : null;
      assert.equal(named(root, 'waterfall').length, spot ? 1 : 0, `${name} ${island.id} (${island.kind}): ${spot ? 'no waterfall' : 'a waterfall it should not have'}`);
      if (spot) drawn++;
    }
  }
  if (STATES_LIST.length) assert.ok(drawn > 0, 'some real island pours a waterfall');
});

test('waterfalls: the same island always gets the same spot, and the sides split about evenly', () => {
  // Made-up round islands: the spot is the picked bearing, within about 26 degrees of south.
  const loop = circle();
  let west = 0;
  for (let n = 0; n < IDS; n++) {
    const island = bare(`isle-${n}`);
    const spot = waterfallSpot(island, loop);
    assert.ok(spot, `isle-${n}: no spot on a round coast`);
    assert.deepEqual(waterfallSpot(island, loop), spot, `isle-${n}: a different spot the second time`);
    assert.ok(Math.abs(spot.bearing) <= 0.45 + 1e-9, `isle-${n}: ${spot.bearing.toFixed(2)} from south`);
    if (spot.bearing < 0) west++;
  }
  assert.ok(Math.abs(west / IDS - 0.5) < 0.04, `${(100 * west / IDS).toFixed(1)}% on the west side`);

  // Real islands: drawn twice, the same spot and the same water.
  for (const [name, , model] of STATES_LIST) {
    for (const island of model.islands.filter(hasWaterfall)) {
      const a = drawGround(island, model), b = drawGround(island, model);
      assert.deepEqual(waterfallSpot(island, a.loop), waterfallSpot(island, b.loop), `${name} ${island.id}: a different spot`);
      const [wa] = named(a.root, 'waterfall'), [wb] = named(b.root, 'waterfall');
      if (wa) assert.deepEqual([...wa.geometry.attributes.position.array], [...wb.geometry.attributes.position.array], `${name} ${island.id}: different water`);
    }
  }
});

test('waterfalls: on the south side, seen from both ends of the sway, never near a bridge foot', () => {
  const end = SWAY.degrees * Math.PI / 180;
  for (const [name, , model] of STATES_LIST) {
    for (const island of model.islands.filter(hasWaterfall)) {
      const { loop } = drawGround(island, model);
      const spot = waterfallSpot(island, loop);
      if (!spot) continue;
      const label = `${name} ${island.id} at ${spot.x}, ${spot.z}`;
      assert.ok(spot.out[1] > 0.5, `${label}: pours ${spot.out.map(v => v.toFixed(2))}, not south`);
      // The camera at either end of its sway looks from (sin, cos) of the turn: the water faces it.
      for (const sign of [-1, 1]) assert.ok(spot.out[0] * Math.sin(sign * end) + spot.out[1] * Math.cos(end) > 0.15, `${label}: turned away from the camera at ${sign * SWAY.degrees}°`);
      for (const foot of island.feet) {
        const [fx, fz] = island.grid.points[foot.point];
        const [ox, oz] = foot.out ?? [0, 0];
        for (let k = 0; k <= 8; k++) {
          const d = Math.hypot(spot.x - fx - ox * DECK * k / 8, spot.z - fz - oz * DECK * k / 8);
          assert.ok(d >= FOOT_CLEAR - 1e-6, `${label}: ${d.toFixed(2)} from bridge ${foot.bridge}'s foot`);
        }
      }
    }
  }

  // A bridge foot put right where the waterfall was moves it away (or there is none).
  let moved = 0;
  for (const [name, , model] of STATES_LIST) {
    for (const island of model.islands.filter(hasWaterfall)) {
      const { loop } = drawGround(island, model);
      const spot = waterfallSpot(island, loop);
      if (!spot) continue;
      let point = -1, best = Infinity;
      island.grid.points.forEach(([x, z], p) => { const d = Math.hypot(x - spot.x, z - spot.z); if (d < best) { best = d; point = p; } });
      const footed = { ...island, feet: [...island.feet, { bridge: 'test', point, out: spot.out }] };
      const again = waterfallSpot(footed, loop);
      const [fx, fz] = island.grid.points[point];
      assert.ok(!again || Math.hypot(again.x - fx, again.z - fz) >= FOOT_CLEAR - 1e-6, `${name} ${island.id}: still beside the new foot`);
      assert.notDeepEqual(again, spot, `${name} ${island.id}: did not move`);
      moved++;
    }
  }
  if (STATES_LIST.length) assert.ok(moved > 0, 'a waterfall was tried with a foot on it');
});

test('waterfalls: moving parts follow scene time, rest at time 0, cast no shadow and follow the mood', () => {
  const build = () => {
    const made = makeModelContext({ materials, blobMaterial: new THREE.MeshBasicMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1) });
    const fall = addWaterfall(made.ctx, { x: 0, y: -0.2, z: 4, out: [0, 1], seed: 0.3 });
    const meshes = made.finish(); // the stone and rocks: still, so they may cast shadows
    return { made, fall, meshes };
  };
  const a = build(), b = build();
  const built = pose(a.fall);
  for (const t of [0, 1.5, 7.25, 60, 900]) {
    for (const fn of a.made.dynamic) fn(t);
    for (const fn of b.made.dynamic) fn(t);
    assert.equal(pose(a.fall), pose(b.fall), `different at ${t} s`);
  }
  for (const fn of a.made.dynamic) fn(12);
  assert.notEqual(pose(a.fall), built, 'nothing moved at 12 s');
  for (const fn of a.made.dynamic) fn(0);
  assert.equal(pose(a.fall), built, 'not back at the built pose at 0 s');
  for (const fn of a.made.dynamic) fn(NaN);
  assert.equal(pose(a.fall), built, 'a bad time is time 0');

  let moving = 0;
  a.made.ctx.root.traverse(node => {
    if (!(node.isMesh || node.isPoints) || a.meshes.includes(node)) return;
    assert.equal(node.castShadow, false, `${node.name} casts a shadow`);
    moving++;
  });
  assert.equal(moving, 2, 'the water and the mist');
  const looks = {};
  for (const mood of Object.keys(WATER_MOODS)) {
    for (const fn of a.made.moodHooks) fn(mood, {});
    looks[mood] = [a.fall.mist.material.color.getHexString(), a.fall.mist.material.opacity, a.fall.water.material.emissiveIntensity];
  }
  assert.notDeepEqual(looks.focus, looks.done, 'the mood changes nothing');
  assert.ok(looks.done[2] > looks.focus[2], 'the water glows more at dusk');
});

test('looks: no Math.random in water.js and blocks.js', () => {
  for (const file of ['water.js', 'blocks.js']) {
    const text = readFileSync(path.join(HERE, file), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random/.test(text), `${file} uses Math.random`);
  }
  // The picks are the island's own: hashString of the id with the pick's own name.
  assert.equal(typeof hashString('home:waterfall-side'), 'number');
});

test('looks: at day 180 the waterfalls, window boxes, nests and smoke add under 2% to the triangles', () => {
  const files = ['steady-day-180.json', 'long-day-180.json'].filter(f => existsSync(path.join(STATES, f)));
  if (!files.length) return;
  const saved = { looks: { ...LOOKS }, things: [...WATER_THINGS], islands: [...WATER_ISLANDS] };
  const off = () => { for (const k in LOOKS) LOOKS[k] = 0; WATER_THINGS.clear(); WATER_ISLANDS.clear(); };
  const on = () => { Object.assign(LOOKS, saved.looks); saved.things.forEach(k => WATER_THINGS.add(k)); saved.islands.forEach(k => WATER_ISLANDS.add(k)); };
  // Batch triangles (core.stats) and the moving parts' own meshes, which stats leave out.
  const measure = world => {
    const core = createSceneCore({ now: () => 0 });
    core.setWorld(world, { ease: false });
    core.setMood('break');
    let own = 0;
    for (const built of core.town.islands.values()) built.group.traverse(node => {
      if (!(node.isMesh || node.isPoints) || built.meshes.includes(node)) return;
      const g = node.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      own += n * (node.isInstancedMesh ? node.count : 1);
    });
    const { triangles } = core.stats();
    core.dispose();
    return { triangles, own };
  };
  try {
    for (const file of files) {
      const world = buildTown(JSON.parse(readFileSync(path.join(STATES, file), 'utf8')));
      off();
      const plain = measure(world);
      on();
      const looked = measure(world);
      const added = looked.triangles - plain.triangles, moving = looked.own - plain.own;
      assert.ok(added >= 0 && added / plain.triangles < 0.02, `${file}: the looks add ${added} batch triangles to ${plain.triangles}`);
      assert.ok((added + moving) / (plain.triangles + plain.own) < 0.02, `${file}: the looks add ${added + moving} triangles in all`);
    }
  } finally { on(); }
});
