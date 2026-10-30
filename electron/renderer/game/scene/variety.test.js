// The rare looks on nature models and windmills (RARE in models/nature.js): look-only surprises picked
// from each thing's own id. Checks:
// - each look shows at about its share over 2000 ids;
// - the same id always draws the same, and each look really changes the drawing;
// - each look adds only a few triangles over the plain model;
// - the day-180 town's triangle count stays within 2% of the plain drawing (before the looks it was
//   583,819 triangles for the steady planner; the same as the plain drawing here);
// - the bird on a bird bath dips about every 20 seconds, driven only by the scene's time.
// Runs on the town builder (scene/town/build.js), not the camera, like stability.test.js.
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
const { RARE, rare, lookRoll, birdTilt } = await import('./models/nature.js');
const { MODELS } = await import('./models/index.js');
const { createMaterials } = await import('./style.js');
const { place } = await import('./ground.js');
const { makeBlobMaterial, makeModelContext, createTownBuilder } = await import('./town/build.js');
const { parseTown } = await import('./town/world.js');
const { buildTown } = await import('../town/index.js');

const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../development-tools/game-gallery/states/town');
const N = 2000;
const FEW = 160; // triangles a look may add over the plain model
const PER_SUNFLOWER = 80; // sunflowers: each of the two or three, over the daisy it replaces
const ISLANDS = ['home', 'isle-1', 'isle-2', 'isle-3', 'isle-4', 'isle-5'];
// Ids shaped like the real ones: decoration on each island, and building ids for windmills.
const decorIds = Array.from({ length: N }, (_, i) => `${ISLANDS[i % ISLANDS.length]}:decor-${Math.floor(i / ISLANDS.length) * 3 + 11}`);
const buildingIds = Array.from({ length: N }, (_, i) => `b${i + 1}`);
const isPine = id => lookRoll({ id }, 'pine') < 0.3;

const shared = { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };

// Draws one model. { triangles, text }: every triangle it drew (the island batch and its own meshes,
// such as sails and the bird), and its vertices and colours as text, to compare drawings.
function draw(kind, id, { yaw = 0.7, time = 0 } = {}) {
  const { ctx, finish } = makeModelContext(shared);
  const thing = { id, kind, island: 'home', x: 0, z: 0, c: 17, r: 400, fw: kind === 'windmill' ? 2 : 1, fd: kind === 'windmill' ? 2 : 1, facing: yaw / (Math.PI / 2), yaw, old: false, modelScale: 1, blocks: true };
  MODELS[kind](ctx, thing, place(0, 0, 0, { ry: yaw }));
  finish();
  for (const fn of ctx.dynamic) fn(time);
  ctx.root.updateMatrixWorld(true);
  let triangles = 0;
  const parts = [];
  ctx.root.traverse(node => {
    const g = node.isMesh ? node.geometry : null;
    if (!g) return;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const p = g.attributes.position.clone().applyMatrix4(node.matrixWorld);
    parts.push(`${node.name}:${Array.from(p.array, v => v.toFixed(4)).join(',')}|${Array.from(g.attributes.color?.array ?? [], v => v.toFixed(3)).join(',')}`);
  });
  return { triangles: Math.round(triangles), text: parts.join('\n'), ctx };
}

// Runs fn with the given chances, all others 0, then puts the real ones back.
function withChances(chances, fn) {
  const saved = { ...RARE };
  for (const key of Object.keys(RARE)) RARE[key] = chances[key] ?? 0;
  try { return fn(); } finally { Object.assign(RARE, saved); }
}

// Each look: which kind and ids it may fall on, whether the thing has it (with the looks that win over
// it), its expected share there, and the chances that must be on to draw it.
const LOOKS = {
  blossom: { kind: 'tree', ids: decorIds.filter(id => !isPine(id)), has: t => rare(t, 'blossom'), share: 1 / 10 },
  autumn: { kind: 'tree', ids: decorIds.filter(id => !isPine(id)), has: t => !rare(t, 'blossom') && rare(t, 'autumn'), share: 1 / 14 },
  nest: { kind: 'tree', ids: decorIds, has: t => rare(t, 'nest'), share: 1 / 20 },
  moss: { kind: 'rock', ids: decorIds, has: t => rare(t, 'moss'), share: 1 / 4 },
  door: { kind: 'rock', ids: decorIds, has: t => rare(t, 'door'), share: 1 / 40 },
  bluecap: { kind: 'mushroom', ids: decorIds, has: t => !rare(t, 'glowcap') && rare(t, 'bluecap'), share: 1 / 6 },
  glowcap: { kind: 'mushroom', ids: decorIds, has: t => rare(t, 'glowcap'), share: 1 / 30 },
  fairyring: { kind: 'mushroom', ids: decorIds, has: t => rare(t, 'fairyring'), share: 1 / 12 },
  rose: { kind: 'crystal', ids: decorIds, has: t => rare(t, 'rose'), share: 1 / 20 },
  birdbath: { kind: 'flower', ids: decorIds, has: t => rare(t, 'birdbath'), share: 1 / 12 },
  bird: { kind: 'flower', ids: decorIds, has: t => rare(t, 'bird'), share: 1 / 3, on: { birdbath: 1 } },
  sunflowers: { kind: 'flower', ids: decorIds, has: t => !rare(t, 'birdbath') && rare(t, 'sunflowers'), share: 1 / 8 },
  stripes: { kind: 'windmill', ids: buildingIds, has: t => rare(t, 'stripes'), share: 1 / 3 },
};

test('every rare look has a share, and each shows at about its share over 2000 ids', t => {
  assert.deepEqual(Object.keys(LOOKS).sort(), Object.keys(RARE).sort(), 'every look in RARE is checked here');
  for (const [look, { ids, has, share }] of Object.entries(LOOKS)) {
    const seen = ids.filter(id => has({ id })).length / ids.length;
    const spread = 4 * Math.sqrt(share * (1 - share) / ids.length);
    t.diagnostic(`${look}: ${(seen * 100).toFixed(1)}% (about ${(share * 100).toFixed(1)}%)`);
    assert.ok(Math.abs(seen - share) <= spread, `${look} shows on ${(seen * 100).toFixed(1)}% of ${ids.length} ids, not about ${(share * 100).toFixed(1)}%`);
  }
  // Sunflowers come two or three, both often.
  const sunny = decorIds.filter(id => LOOKS.sunflowers.has({ id }));
  const two = sunny.filter(id => lookRoll({ id }, 'sunflowers') < RARE.sunflowers / 2).length;
  assert.ok(two > sunny.length * 0.35 && two < sunny.length * 0.65, `${two} of ${sunny.length} sunflower patches have two`);
});

test('the looks are picked apart from each other and from the older picks', () => {
  // Two looks on the same kind come up together about as often as chance says, so neither pick leans
  // on the other or on the pine pick.
  const pairs = [['blossom', 'autumn'], ['blossom', 'pine'], ['moss', 'door'], ['bluecap', 'fairyring'], ['nest', 'pine'], ['birdbath', 'sunflowers']];
  for (const [a, b] of pairs) {
    const chance = look => RARE[look] ?? 0.3;
    const both = decorIds.filter(id => lookRoll({ id }, a) < chance(a) && lookRoll({ id }, b) < chance(b)).length / N;
    const expected = chance(a) * chance(b);
    assert.ok(Math.abs(both - expected) <= 4 * Math.sqrt(expected / N) + 0.002, `${a} and ${b} come up together on ${(both * 100).toFixed(2)}%, not about ${(expected * 100).toFixed(2)}%`);
  }
});

test('the same id always draws the same look', () => {
  for (const kind of ['tree', 'rock', 'mushroom', 'crystal', 'flower', 'windmill']) {
    const ids = kind === 'windmill' ? buildingIds.slice(0, 40) : decorIds.slice(0, 120);
    for (const id of ids) assert.equal(draw(kind, id).text, draw(kind, id).text, `${kind} ${id} drew differently the second time`);
  }
});

test('each look changes the drawing, adds only a few triangles, and colour looks add none', t => {
  const colourOnly = new Set(['blossom', 'autumn', 'bluecap', 'glowcap', 'rose']);
  for (const [look, { kind, ids, on = {} }] of Object.entries(LOOKS)) {
    // A few ids, turned different ways, so a detail meant for the camera's side always finds room.
    for (const [n, id] of ids.slice(0, 12).entries()) {
      const yaw = n * 0.55;
      const plain = withChances(on, () => draw(kind, id, { yaw }));
      const shown = withChances({ ...on, [look]: 1 }, () => draw(kind, id, { yaw, time: 3 }));
      assert.notEqual(shown.text, plain.text, `${look} did not change ${kind} ${id}`);
      const added = shown.triangles - plain.triangles;
      if (colourOnly.has(look)) assert.equal(added, 0, `${look} should only change colours, but added ${added} triangles`);
      else {
        const most = look === 'sunflowers' ? 3 * PER_SUNFLOWER : FEW;
        assert.ok(added <= most, `${look} added ${added} triangles to ${kind} ${id} (at most ${most})`);
      }
      if (n === 0) t.diagnostic(`${look}: ${plain.triangles} -> ${shown.triangles} triangles`);
    }
  }
  // Fairy rings are only for decoration mushrooms: an island's start mushroom keeps its three caps.
  const start = withChances({}, () => draw('mushroom', 'isle-1:extra'));
  assert.equal(withChances({ fairyring: 1 }, () => draw('mushroom', 'isle-1:extra')).text, start.text);
  // Each island's first tree keeps its green crown (its id is the same in every town).
  const old = id => { const { ctx } = makeModelContext(shared); MODELS.tree(ctx, { id, kind: 'tree', c: 1, r: 1, yaw: 0, old: true }, place(0, 0, 0)); return ctx.batch.lists.get('facet').map(g => Array.from(g.attributes.color.array.slice(0, 3)).join()).join(';'); };
  assert.equal(withChances({ blossom: 1 }, () => old('home:tree')), withChances({}, () => old('home:tree')));
});

test("the day-180 town's triangle count stays within 2% of the plain drawing", t => {
  for (const name of ['steady-day-180', 'long-day-180']) {
    const world = buildTown(JSON.parse(readFileSync(path.join(STATES, `${name}.json`), 'utf8')));
    const count = () => {
      const builder = createTownBuilder(new THREE.Group(), shared.materials);
      builder.update(parseTown(world));
      const { triangles } = builder.stats();
      builder.dispose();
      return triangles;
    };
    const plain = withChances({}, count), looks = count();
    t.diagnostic(`${name}: ${plain} triangles plain, ${looks} with the rare looks (${((looks / plain - 1) * 100).toFixed(2)}%)`);
    assert.ok(Math.abs(looks / plain - 1) <= 0.02, `${name}: ${looks} triangles with the looks, ${plain} without`);
  }
});

test('the bird dips about every 20 seconds, only by the time the scene hands it', () => {
  const birds = decorIds.filter(id => rare({ id }, 'birdbath') && rare({ id }, 'bird')).slice(0, 6);
  assert.ok(birds.length >= 3);
  for (const id of birds) {
    const thing = { id };
    let dips = 0, still = 0, steps = 0, was = 0;
    for (let time = 0; time < 200; time += 0.05, steps++) {
      const tilt = birdTilt(thing, time);
      assert.equal(tilt, birdTilt(thing, time), 'the same time gives the same pose');
      assert.ok(tilt >= 0 && tilt <= 1, 'the bird leans forward only, and not too far');
      if (tilt > 0.05 && was <= 0.05) dips++;
      if (tilt === 0) still++;
      was = tilt;
    }
    // Two quick dips each turn, a turn every 17 to 23 seconds.
    assert.ok(dips >= 2 * 8 && dips <= 2 * 12 + 2, `${id} dipped ${dips} times in 200 s`);
    assert.ok(still / steps > 0.85, `${id} sits still most of the time`);
  }
  // The bird is its own small mesh, moved by ctx.dynamic (so it freezes when the scene is held still).
  const id = birds[0];
  let deepest = 0;
  for (let time = 0; time < 25; time += 0.05) if (birdTilt({ id }, time) > birdTilt({ id }, deepest)) deepest = time;
  const sitting = draw('flower', id, { time: deepest + 5 }), drinking = draw('flower', id, { time: deepest });
  assert.notEqual(sitting.text, drinking.text, 'the bird moves with the scene time');
  assert.equal(draw('flower', id, { time: deepest }).text, drinking.text);
});
