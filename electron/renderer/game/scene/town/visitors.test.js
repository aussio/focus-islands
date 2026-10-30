// Visitors (visitors.js): what a surprise brings until the next check-in. Checks, on a real island:
// - buildTown copies the game's visitor onto its own island only, and the island's draw key changes
//   when one comes or goes;
// - a visitor draws nothing into the island's batch (its pieces stay exactly the same);
// - the same time gives the same pose (time 0 is the still pose), it stays small, and it is freed;
// - each follows the mood: the rainbow hides at night, the fireflies show only in break and done.
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
    for (const fn of built.dynamic) fn(7.3);
    const later = pose(group);
    for (const fn of built.dynamic) fn(2.1);
    for (const fn of built.dynamic) fn(7.3);
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
    // Disposing the island frees every shape and material the visitor made (not the shared materials).
    const made = new Set();
    group.traverse(node => { if (node.geometry) made.add(node.geometry); for (const m of [node.material].flat()) if (m && !Object.values(shared.materials).includes(m)) made.add(m); });
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
