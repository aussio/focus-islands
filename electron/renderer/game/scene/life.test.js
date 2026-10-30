// Small life on the growing places (the "Small life" part of models/growing.js): butterflies, bees,
// moths, ducks, the frog, ripples, falling leaves, the rain catcher's drip and its drizzle cloud, plus
// two looks (more lilies on a pond, a scarecrow in a garden). Checks:
// - the same time always gives the same picture, and time 0 is a resting picture;
// - butterflies and bees show only by day, moths only while the lamps are lit, the drizzle cloud only at
//   break; at night the ducks and the frog keep still;
// - counts stay capped per thing and per island;
// - every creature on an island shares one mesh, every ripple one more, the drizzle cloud a third (seen
//   only at break), and none casts a shadow;
// - nothing in growing.js uses Math.random;
// - the looks and the frog each show on about 1 in 3;
// - what the day-180 town pays for it (shown as diagnostics).
// Runs on the model context (scene/town/build.js), not the camera, like variety.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { LIFE, lifeOf } = await import('./models/growing.js');
const { MODELS } = await import('./models/index.js');
const { createMaterials, MOODS } = await import('./style.js');
const { place } = await import('./ground.js');
const { makeBlobMaterial, makeModelContext, createTownBuilder } = await import('./town/build.js');
const { parseTown } = await import('./town/world.js');
const { buildTown } = await import('../town/index.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATES = path.resolve(HERE, '../../../../development-tools/game-gallery/states/town');
const shared = { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
const KINDS = ['garden', 'flowers', 'lanterns', 'pond', 'beehives', 'greattree', 'nursery'];
const MOOD_NAMES = ['focus', 'break', 'away', 'done'];
const ids = n => Array.from({ length: n }, (_, i) => `b${i + 1}`);

// A thing as the town hands it to a model, with the footprint its kind is designed for.
function thingOf(kind, id, x = 0, z = 0) {
  const [fw, fd] = kind === 'flowers' ? [1 / 0.6, 0.5 / 0.6] : kind === 'lanterns' ? [1, 1] : [2, 2];
  const pad = fw === 2;
  return { id, kind, island: 'home', x, z, c: 7, r: 211, c0: 7, r0: 211, fw, fd, w: fw, h: fd, facing: 0.4, yaw: 0.63, height: 0, blocks: pad, old: false, modelScale: pad ? 0.9 : 1, coast: null };
}

// Builds things ([kind, id] pairs) into one island context, sets the mood and poses them at time t.
function island(list, { mood = 'focus', time = 0 } = {}) {
  const made = makeModelContext(shared);
  list.forEach(([kind, id], i) => {
    const thing = thingOf(kind, id, (i % 5) * 1.4, Math.floor(i / 5) * 1.4);
    MODELS[kind](made.ctx, thing, place(thing.x, 0, thing.z, { ry: thing.yaw, s: thing.modelScale }));
  });
  made.finish();
  const swarms = lifeOf(made.ctx);
  const pose = (m, t) => { for (const hook of made.moodHooks) hook(m, MOODS[m]); for (const fn of made.dynamic) fn(t); };
  pose(mood, time);
  const movers = [...swarms.values()].flatMap(s => s.movers.map(m => Object.assign(m, { swarm: s })));
  return { ...made, swarms, movers, pose };
}

// A mover's instance matrices, as plain numbers.
const partsOf = m => Array.from(m.swarm.mesh.instanceMatrix.array.slice(m.first * 16, (m.first + m.n) * 16));
const hidden = (m, i) => partsOf(m).slice(i * 16, i * 16 + 15).every(v => v === 0);
const allHidden = m => Array.from({ length: m.n }, (_, i) => i).every(i => hidden(m, i));
const one = kind => KINDS.map((k, i) => [k, `b${i + 1}`]).filter(([k]) => k === kind);

test('the same time always gives the same picture, and time moves things', () => {
  for (const kind of KINDS) {
    for (const id of ids(6)) {
      const a = island([[kind, id]], { time: 37.3 }), b = island([[kind, id]], { time: 37.3 });
      assert.deepEqual(a.movers.map(partsOf), b.movers.map(partsOf), `${kind} ${id} differs at the same time`);
    }
  }
  // Over a minute, every kind of creature moves at least once.
  const all = island(KINDS.flatMap(kind => ids(4).map(id => [kind, `${id}-${kind}`])), { mood: 'focus', time: 0 });
  const start = all.movers.map(partsOf), moved = new Set();
  for (let t = 0.5; t < 70; t += 0.5) {
    all.pose('focus', t);
    all.movers.forEach((m, i) => { if (partsOf(m).some((v, k) => Math.abs(v - start[i][k]) > 1e-6)) moved.add(m.kind); });
  }
  const night = island([['lanterns', 'b2'], ['lanterns', 'b3'], ['lanterns', 'b5'], ['nursery', 'b1']], { mood: 'break' });
  const nightStart = night.movers.map(partsOf);
  for (let t = 0.5; t < 30; t += 0.5) {
    night.pose('break', t);
    night.movers.forEach((m, i) => { if (partsOf(m).some((v, k) => Math.abs(v - nightStart[i][k]) > 1e-6)) moved.add(m.kind); });
  }
  assert.deepEqual([...moved].sort(), Object.keys(LIFE).sort());
});

test('at time 0 everything rests: nothing in the air, no ripple, no falling leaf or drop', () => {
  for (const mood of MOOD_NAMES) {
    const all = island(KINDS.flatMap(kind => ids(30).map(id => [kind, `${id}-${kind}`])).slice(0, 200), { mood, time: 0 });
    for (const m of all.movers) {
      assert.ok(!m.flying, `${m.kind} on ${m.owner} is in the air at time 0 (${mood})`);
      if (['ripple', 'leaf', 'drip'].includes(m.kind)) assert.ok(allHidden(m), `${m.kind} on ${m.owner} shows at time 0`);
      if (m.kind === 'cloud') for (let i = 6; i < 12; i++) assert.ok(hidden(m, i), `drizzle drop ${i} falls at time 0`);
    }
  }
});

test('butterflies and bees by day, moths while the lamps are lit, the drizzle cloud only at break', () => {
  const list = KINDS.flatMap(kind => ids(8).map(id => [kind, `${id}-${kind}`]));
  for (const mood of MOOD_NAMES) {
    const all = island(list, { mood, time: 12 });
    const shows = kind => all.movers.filter(m => m.kind === kind).some(m => !allHidden(m));
    const any = kind => all.movers.some(m => m.kind === kind);
    for (const kind of ['butterfly', 'bee', 'moth', 'cloud', 'duck']) assert.ok(any(kind), `no ${kind} at all`);
    assert.equal(shows('butterfly'), mood === 'focus', `butterflies in ${mood}`);
    assert.equal(shows('bee'), mood === 'focus', `bees in ${mood}`);
    assert.equal(shows('moth'), MOODS[mood].windows > 0, `moths in ${mood}`);
    assert.equal(shows('cloud'), mood === 'break', `drizzle cloud in ${mood}`);
    assert.ok(shows('duck'), `ducks in ${mood}`);
  }
  // A garden alone at break: nothing of it shows, so its mesh is hidden too (no empty draw).
  const garden = island([['garden', 'b1']], { mood: 'break', time: 5 });
  assert.equal(garden.swarms.get('critters').mesh.visible, false);
  // At night the ducks and the frog keep still.
  const pond = ids(40).find(id => island([['pond', id]]).movers.some(m => m.kind === 'frog'));
  const done = island([['pond', pond]], { mood: 'done', time: 3 }), still = done.movers.filter(m => m.kind !== 'ripple').map(partsOf);
  done.pose('done', 41);
  assert.deepEqual(done.movers.filter(m => m.kind !== 'ripple').map(partsOf), still);
});

test('counts stay capped per thing and per island', () => {
  const per = new Map();
  for (const kind of KINDS) {
    for (const id of ids(300)) {
      const { movers } = island([[kind, id]]);
      for (const m of movers) per.set(`${m.kind}:${id}:${kind}`, (per.get(`${m.kind}:${id}:${kind}`) ?? 0) + 1);
    }
  }
  const most = (kind, on) => Math.max(0, ...[...per].filter(([k]) => k.startsWith(`${kind}:`) && k.endsWith(`:${on}`)).map(([, n]) => n));
  const least = (kind, on) => Math.min(...ids(300).map(id => per.get(`${kind}:${id}:${on}`) ?? 0));
  assert.ok(most('butterfly', 'garden') <= 3 && least('butterfly', 'garden') >= 2);
  assert.ok(most('butterfly', 'flowers') <= 2);
  assert.ok(most('duck', 'pond') <= 2 && least('duck', 'pond') >= 1);
  assert.ok(most('frog', 'pond') <= 1);
  assert.ok(most('bee', 'beehives') <= 5 && least('bee', 'beehives') >= 3);
  assert.ok(most('moth', 'lanterns') <= 2);
  assert.ok(most('leaf', 'greattree') <= 3);
  for (const [kind, rule] of Object.entries(LIFE)) {
    for (const on of KINDS) assert.ok(most(kind, on) <= rule.most, `${kind} on a ${on}: ${most(kind, on)} > ${rule.most}`);
  }
  // A crowded island: each kind stops at its island share, and the meshes never overflow.
  const crowd = island(KINDS.flatMap(kind => ids(12).map(id => [kind, `${id}-${kind}`])));
  for (const [kind, rule] of Object.entries(LIFE)) {
    const n = crowd.movers.filter(m => m.kind === kind).length;
    assert.ok(n <= rule.island, `${n} ${kind}s on one island (at most ${rule.island})`);
  }
  for (const swarm of crowd.swarms.values()) assert.ok(swarm.mesh.count <= swarm.mesh.instanceMatrix.count);
});

test('every creature on an island shares one mesh, every ripple one more, the drizzle cloud a third; none casts a shadow', () => {
  const all = island(KINDS.flatMap(kind => ids(3).map(id => [kind, `${id}-${kind}`])));
  const life = [];
  all.ctx.root.traverse(node => { if (node.name?.startsWith('life-')) life.push(node); });
  assert.deepEqual(life.map(n => n.name).sort(), ['life-clouds', 'life-critters', 'life-ripples']);
  for (const mesh of life) {
    assert.ok(mesh.isInstancedMesh);
    assert.equal(mesh.castShadow, false);
  }
  const critters = all.swarms.get('critters').mesh;
  assert.equal(critters.material, shared.materials.facet, 'creatures use the shared facet material');
  for (const m of all.movers) assert.equal(m.swarm.mesh, life.find(n => n.name === `life-${LIFE[m.kind].mesh ?? 'critters'}`));
  // The island's own clean-up disposes the meshes' geometry.
  let disposed = 0;
  critters.geometry.addEventListener('dispose', () => disposed++);
  for (const item of all.disposables) item.dispose?.();
  assert.equal(disposed, 1);
});

test('nothing in growing.js uses Math.random', () => {
  const text = readFileSync(path.join(HERE, 'models/growing.js'), 'utf8');
  assert.ok(!/Math\s*\.\s*random/.test(text));
});

test('more lilies, the frog and the scarecrow each show on about 1 in 3, and change the drawing', () => {
  const triangles = (kind, id) => {
    const made = makeModelContext(shared), thing = thingOf(kind, id);
    MODELS[kind](made.ctx, thing, place(0, 0, 0, { ry: thing.yaw, s: thing.modelScale }));
    made.finish();
    let n = 0;
    made.ctx.root.traverse(node => { if (node.isMesh && !node.name?.startsWith('life-')) n += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; });
    return Math.round(n);
  };
  const N = 600;
  const counts = kind => { const tally = new Map(); for (const id of ids(N)) { const n = triangles(kind, id); tally.set(n, (tally.get(n) ?? 0) + 1); } return tally; };
  // Ponds: plain, more lilies, a frog's pad, or both; gardens: with or without the scarecrow.
  const pond = counts('pond'), garden = counts('garden');
  const plainPond = Math.min(...pond.keys()), plainGarden = Math.min(...garden.keys());
  assert.ok(pond.size >= 3 && pond.size <= 4, `pond drawings: ${[...pond.keys()]}`);
  assert.equal(garden.size, 2, `garden drawings: ${[...garden.keys()]}`);
  const share = (tally, plain) => (N - tally.get(plain)) / N;
  assert.ok(Math.abs(share(garden, plainGarden) - 1 / 3) < 0.06, `scarecrows on ${share(garden, plainGarden)}`);
  assert.ok(Math.abs(share(pond, plainPond) - (1 - (2 / 3) ** 2)) < 0.06, `ponds with a look or frog: ${share(pond, plainPond)}`);
  const frogs = ids(N).filter(id => island([['pond', id]]).movers.some(m => m.kind === 'frog')).length / N;
  assert.ok(Math.abs(frogs - 1 / 3) < 0.06, `frogs on ${frogs}`);
  // Each look is small.
  for (const [n] of pond) assert.ok(n - plainPond <= 600, `a pond look adds ${n - plainPond} triangles`);
  for (const [n] of garden) assert.ok(n - plainGarden <= 700, `the scarecrow adds ${n - plainGarden} triangles`);
});

test('what small life costs the day-180 town', t => {
  for (const name of ['steady-day-180', 'long-day-180']) {
    const world = buildTown(JSON.parse(readFileSync(path.join(STATES, `${name}.json`), 'utf8')));
    const root = new THREE.Group(), builder = createTownBuilder(root, shared.materials);
    builder.update(parseTown(world));
    for (const mood of MOOD_NAMES) {
      builder.applyMood(mood, MOODS[mood]);
      builder.animate(20);
      let calls = 0, triangles = 0, creatures = 0;
      root.traverse(node => {
        if (!node.name?.startsWith('life-') || !node.visible) return;
        calls++;
        const g = node.geometry, per = (g.index ? g.index.count : g.attributes.position.count) / 3;
        triangles += per * node.count;
        if (node.name === 'life-critters') creatures += node.count;
      });
      t.diagnostic(`${name} ${mood}: ${calls} more draws, ${Math.round(triangles)} more triangles at most (${creatures} creature parts), ${builder.stats().triangles} static triangles`);
      assert.ok(calls <= (mood === 'break' ? 3 : 2) * builder.stats().islands, `${calls} draws for ${builder.stats().islands} islands`);
      assert.ok(triangles < 12000, `${Math.round(triangles)} triangles of small life`);
    }
    builder.dispose();
  }
});
