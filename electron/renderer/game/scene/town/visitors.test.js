// Visitors (visitors.js): what a surprise brings until the next check-in. Checks, on a real island:
// - buildTown copies the game's visitor onto its own island only, and the island's draw key changes
//   when one comes or goes;
// - a visitor draws nothing into the island's batch (its pieces stay exactly the same);
// - the same time gives the same pose (time 0 is the still pose), it stays small, and it is freed;
// - each follows the mood: the rainbow hides at night, the fireflies show only in break and done;
// - the bird perches on a real spot, inside Today's picture on a big island framed close, and flies
//   (with a faint shadow) only on its turn in break.
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
const { createMaterials, MOODS } = await import('../style.js');
const { makeBlobMaterial, buildTownIsland } = await import('./build.js');
const { parseTown } = await import('./world.js');
const { VISITOR_KINDS } = await import('./visitors.js');
const { buildTown } = await import('../../town/index.js');
const { loopOwner } = await import('../calm.js');
const { isCreatureMaterial } = await import('../models/creature-material.js');
const { createSceneCore } = await import('../core.js');
const { birdPerch } = await import('../models/bird-perch.js');

const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../development-tools/game-gallery/states/town');
const state = JSON.parse(readFileSync(path.join(STATES, 'steady-day-60.json'), 'utf8'));
const shared = { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
const MOST = 3000; // triangles one visitor may draw

const withVisitor = (kind, island = 'home') => ({ ...state, visitor: kind ? { kind, island } : null });
const modelOf = game => parseTown(buildTown(game));
const build = (model, id = 'home') => {
  const log = new Map();
  const built = buildTownIsland(model.byId.get(id), model, shared, { log });
  return { built, pieces: log.get(id) };
};
const visitorGroup = built => built.group.children.find(child => child.name.startsWith('visitor-'));
// The start of the first loop that is the bird's turn on an island (calm.js); the bird moves only then.
const birdLoop = (island = 'home') => { for (let n = 1; ; n++) if (loopOwner(island, n) === 'bird') return n * 64; };

// Every mesh, sprite and point cloud under a group, as text: names, world positions, sizes, visibility.
function pose(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse(node => {
    if (!node.geometry && !node.isSprite) return;
    const out = [node.name, node.visible, node.matrixWorld.elements.map(v => v.toFixed(4)).join(',')];
    if (node.isInstancedMesh) out.push(Array.from(node.instanceMatrix.array, v => v.toFixed(4)).join(','));
    if (node.isPoints) out.push(Array.from(node.geometry.attributes.position.array, v => v.toFixed(4)).join(','), Array.from(node.geometry.attributes.color.array, v => v.toFixed(3)).join(','));
    parts.push(out.join('|'));
  });
  return parts.join('\n');
}

function triangles(group) {
  let n = 0;
  group.traverse(node => {
    const g = node.geometry;
    if (!g || node.isPoints) return;
    const each = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += node.isInstancedMesh ? each * node.count : each;
  });
  return Math.round(n);
}

test('the visitor is copied onto its own island, and its coming and going changes only that island', () => {
  const plain = modelOf(withVisitor(null));
  for (const kind of VISITOR_KINDS) {
    const world = buildTown(withVisitor(kind, 'isle-1'));
    assert.deepEqual(world.islands.filter(i => i.visitor).map(i => [i.id, i.visitor]), [['isle-1', kind]]);
    const model = parseTown(world);
    for (const island of model.islands) {
      const before = plain.byId.get(island.id);
      if (island.id === 'isle-1') assert.notEqual(island.key, before.key, kind);
      else assert.equal(island.key, before.key, `${kind}: ${island.id} stays`);
    }
  }
  // An unknown island or an odd visitor draws nothing.
  assert.ok(buildTown(withVisitor('balloon', 'isle-99')).islands.every(i => !i.visitor));
  assert.ok(buildTown({ ...state, visitor: { kind: 7, island: 'home' } }).islands.every(i => !i.visitor));
});

test('each visitor draws outside the island batch, holds still at a fixed time, and stays small', () => {
  const plain = build(modelOf(withVisitor(null)));
  assert.equal(visitorGroup(plain.built), undefined);
  for (const kind of VISITOR_KINDS) {
    const { built, pieces } = build(modelOf(withVisitor(kind)));
    assert.deepEqual([...pieces.keys()], [...plain.pieces.keys()], `${kind}: no new pieces`);
    for (const [key, text] of plain.pieces) assert.deepEqual(pieces.get(key), text, `${kind}: ${key} unchanged`);
    assert.equal(built.meshes.length, plain.built.meshes.length);
    const group = visitorGroup(built);
    assert.ok(group, `${kind} is drawn`);
    assert.ok(group.children.length > 0, `${kind} has parts`);
    for (const hook of built.moodHooks) hook('break', MOODS.break);
    for (const fn of built.dynamic) fn(0);
    const first = pose(group); // the still pose: the scene holds time at 0 when still
    // Times inside the bird's turn, so it moves too (the others move all the time).
    const base = birdLoop();
    for (const fn of built.dynamic) fn(base + 0.5);
    for (const fn of built.dynamic) fn(base + 7.3);
    const later = pose(group);
    for (const fn of built.dynamic) fn(base + 2.1);
    for (const fn of built.dynamic) fn(base + 7.3);
    assert.equal(pose(group), later, `${kind}: the same time gives the same pose`);
    for (const fn of built.dynamic) fn(0);
    assert.equal(pose(group), first, `${kind}: back to time 0 is the still pose again`);
    if (kind !== 'rainbow') assert.notEqual(later, first, `${kind} moves`);
    assert.ok(triangles(group) < MOST, `${kind}: ${triangles(group)} triangles`);
    // Built twice, it looks the same.
    const again = build(modelOf(withVisitor(kind))).built;
    for (const hook of again.moodHooks) hook('break', MOODS.break);
    for (const fn of again.dynamic) fn(0);
    assert.equal(pose(visitorGroup(again)), first, `${kind} draws the same each time`);
    again.dispose();
    // Disposing the island frees every shape and material the visitor made (not the shared materials,
    // nor the small creatures' material cache, which lives as long as the page).
    const made = new Set();
    const kept = m => Object.values(shared.materials).includes(m) || isCreatureMaterial(m);
    group.traverse(node => { if (node.geometry) made.add(node.geometry); for (const m of [node.material].flat()) if (m && !kept(m)) made.add(m); });
    const freed = new Set();
    for (const item of made) item.addEventListener('dispose', () => freed.add(item));
    built.dispose();
    assert.equal(freed.size, made.size, `${kind}: everything is freed`);
  }
  plain.built.dispose();
});

test('visitors follow the mood', () => {
  const shown = (kind, mood, name) => {
    const { built } = build(modelOf(withVisitor(kind)));
    for (const hook of built.moodHooks) hook(mood, MOODS[mood]);
    const node = visitorGroup(built).getObjectByName(name);
    built.dispose();
    return node.visible;
  };
  assert.deepEqual(['focus', 'break', 'away', 'done'].map(m => shown('rainbow', m, 'rainbow')), [true, true, true, false]);
  assert.deepEqual(['focus', 'break', 'away', 'done'].map(m => shown('fireflies', m, 'fireflies')), [false, true, false, true]);
});

// Triangles of the island's drawn batches, as [material, nine numbers].
function batchTriangles(built) {
  const out = [];
  for (const mesh of built.meshes) {
    const material = Object.entries(shared.materials).find(([, m]) => m === mesh.material)?.[0] ?? mesh.name;
    const p = mesh.geometry.attributes.position.array;
    for (let i = 0; i + 8 < p.length; i += 9) out.push([material, Array.from(p.subarray(i, i + 9))]);
  }
  return out;
}
function heightOver(t, x, z) {
  const ax = t[0], az = t[2], bx = t[3] - ax, bz = t[5] - az, cx = t[6] - ax, cz = t[8] - az, d = bx * cz - bz * cx;
  if (Math.abs(d) < 1e-12) return -Infinity;
  const u = ((x - ax) * cz - (z - az) * cx) / d, v = (bx * (z - az) - bz * (x - ax)) / d;
  return u < 0 || v < 0 || u + v > 1 ? -Infinity : t[1] + u * (t[4] - t[1]) + v * (t[7] - t[1]);
}

test('a crowded island still gives the bird a real flat perch on a solid roof or crown, with nothing above it', () => {
  const crowded = JSON.parse(readFileSync(path.join(STATES, 'irregular-day-180.json'), 'utf8'));
  const model = modelOf({ ...crowded, visitor: { kind: 'bird', island: 'home' } });
  const { built } = build(model);
  try {
    const bird = visitorGroup(built).getObjectByName('visiting-bird');
    assert.ok(bird);
    const all = batchTriangles(built);
    const { x, y, z } = bird.position;
    // It stands on a flat-enough, solid (never glass or glowing) surface right under its feet.
    const under = all.filter(([m, t]) => (m === 'matte' || m === 'facet') && Math.abs(heightOver(t, x, z) - (y - 0.006)) < 0.02);
    assert.ok(under.length, 'stands on a solid matte or facet surface');
    assert.ok(!all.some(([m, t]) => (m === 'glass' || m === 'glow') && heightOver(t, x, z) > y - 0.05), 'not on glass or glow');
    // Nothing drawn above its body or its takeoff column.
    for (const [dx, dz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]]) {
      assert.ok(!all.some(([m, t]) => m !== 'blob' && m !== 'under' && heightOver(t, x + dx, z + dz) > y + 0.03), `clear above at ${dx}, ${dz}`);
    }
    let top = -Infinity;
    for (const [, t] of all) top = Math.max(top, t[1], t[4], t[7]);
    for (const hook of built.moodHooks) hook('break', MOODS.break);
    const base = birdLoop();
    for (const fn of built.dynamic) fn(base + 0.5);
    for (const fn of built.dynamic) fn(base + 37);
    assert.ok(bird.position.y > top + 0.3, 'flight clears all static scenery');
  } finally { built.dispose(); }
});

test('the flying bird has a faint soft shadow on the land; perched, at night and held still it has none', () => {
  const { built } = build(modelOf(withVisitor('bird')));
  try {
    const group = visitorGroup(built), shadow = group.getObjectByName('bird-shadow'), bird = group.getObjectByName('visiting-bird');
    assert.ok(shadow && !shadow.castShadow && !shadow.receiveShadow);
    const at = t => { for (const fn of built.dynamic) fn(t); return shadow.visible; };
    const hook = mood => { for (const h of built.moodHooks) h(mood, MOODS[mood]); };
    const base = birdLoop();
    hook('focus');
    assert.equal(at(0), false, 'held still: perched, no shadow');
    assert.equal(at(base + 0.5), false, 'perched: no shadow');
    for (let t = base + 1; t < base + 60; t += 0.5) assert.equal(at(t), false, 'focus: it never flies');
    hook('break');
    at(0);
    assert.equal(at(base + 0.5), false, 'break, start of its turn: still perched');
    let seen = 0;
    for (let t = base + 1; t < base + 44; t += 0.5) {
      if (!at(t)) continue;
      seen++;
      assert.ok(shadow.material.opacity > 0 && shadow.material.opacity <= 0.15 + 1e-9);
      assert.ok(Math.abs(shadow.position.x - bird.position.x) < 1e-9 && Math.abs(shadow.position.z - bird.position.z) < 1e-9, 'right under the bird');
      assert.ok(shadow.position.y < bird.position.y - 0.5, 'on the ground, well below the bird');
    }
    assert.ok(seen > 12, `shown for most of the flight (${seen})`);
    for (const mood of ['away', 'done']) {
      hook(mood);
      at(0);
      for (let t = base + 0.5; t < base + 44; t += 0.5) assert.equal(at(t), false, `${mood}: stays perched`);
    }
  } finally { built.dispose(); }
});

test("on a big island framed close, the bird perches inside Today's picture", () => {
  // Where the perched bird lands in Today's picture (-1 to 1 across and up), and where the first
  // tree's branch would have put it.
  const sight = world => {
    const core = createSceneCore();
    try {
      core.resize(591, 357); // Today's picture size
      core.setWorld(world, { ease: false });
      core.settle();
      core.update(0, true);
      core.scene.updateMatrixWorld(true);
      const bird = core.scene.getObjectByName('visiting-bird');
      const island = parseTown(world).byId.get(world.view.island);
      const branch = birdPerch(island); // null on an island with no tree that has room (it uses a roof)
      const first = branch && new THREE.Vector3(...branch.perch).applyMatrix4(bird.parent.matrixWorld).project(core.camera);
      return { close: core.aimed.close, bird: bird.getWorldPosition(new THREE.Vector3()).project(core.camera), first };
    } finally { core.dispose(); }
  };
  const inside = v => Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9;
  for (const name of ['steady-day-180', 'long-day-180', 'irregular-day-180']) {
    const game = JSON.parse(readFileSync(path.join(STATES, `${name}.json`), 'utf8'));
    const island = buildTown(game).view.island;
    const seen = sight(buildTown({ ...game, visitor: { kind: 'bird', island } }));
    assert.ok(inside(seen.bird), `${name}: in the picture (${seen.bird.x.toFixed(2)}, ${seen.bird.y.toFixed(2)})`);
  }
  // A view far from the home tree: its branch would be far out of the picture, so the bird picks a
  // perch in the view instead.
  const game = JSON.parse(readFileSync(path.join(STATES, 'steady-day-180.json'), 'utf8'));
  const world = buildTown({ ...game, visitor: { kind: 'bird', island: 'home' } });
  const home = parseTown(world).byId.get('home'), tree = home.things.find(t => t.id === 'home:tree').local;
  const far = home.things.filter(t => t.points?.length && !t.pad)
    .sort((a, b) => Math.hypot(b.local[0] - tree[0], b.local[1] - tree[1]) - Math.hypot(a.local[0] - tree[0], a.local[1] - tree[1]))
    .slice(0, 2).flatMap(t => t.points);
  const seen = sight({ ...world, view: { island: 'home', points: far } });
  assert.ok(seen.close, 'framed close');
  assert.ok(!inside(seen.first), 'the home tree is out of this picture');
  assert.ok(inside(seen.bird), `the bird is in it (${seen.bird.x.toFixed(2)}, ${seen.bird.y.toFixed(2)})`);
});
