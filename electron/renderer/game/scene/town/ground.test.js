// The island's underside: every rock drip hangs from the rock, with no sky between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { SAMPLE_NAMES, sampleTown } = await import('../../town/samples.js');
const { buildTown } = await import('../../town/index.js');
const { createMaterials } = await import('../style.js');
const { parseTown } = await import('./world.js');
const { createTownBuilder } = await import('./build.js');
const { steepest } = await import('./ground.js');

const STATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../development-tools/game-gallery/states/town');

function worlds() {
  const list = SAMPLE_NAMES.map(name => [name, sampleTown(name)]);
  if (existsSync(STATES)) {
    for (const file of readdirSync(STATES).filter(name => /^steady-day-\d+\.json$/.test(name))) {
      try { list.push([file, buildTown(JSON.parse(readFileSync(path.join(STATES, file), 'utf8')))]); } catch { /* the layout is checked elsewhere */ }
    }
  }
  return list;
}

const points = text => text.map(t => t.split(',').map(Number));

// Height of the underside at (x, z): the triangle of the underside right above or below it.
function undersideAt(triangles, x, z) {
  for (const [a, b, c] of triangles) {
    const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) return u * a[1] + v * b[1] + (1 - u - v) * c[1];
  }
  return null;
}

test('steepest measures how fast a flat triangle rises', () => {
  assert.equal(steepest([0, 0, 0], [1, 0, 0], [0, 0, 1]), 0);
  assert.ok(Math.abs(steepest([0, 0, 0], [1, 2, 0], [0, 0, 1]) - 2) < 1e-9);
  // Rising 1 along x and 1 along z: steepest along the diagonal, by the square root of 2.
  assert.ok(Math.abs(steepest([0, 0, 0], [1, 1, 0], [0, 1, 1]) - Math.SQRT2) < 1e-9);
});

test('every rock drip starts inside the rock, so no sky shows between it and the island', () => {
  const materials = createMaterials();
  let drips = 0;
  for (const [name, world] of worlds()) {
    const log = new Map();
    const builder = createTownBuilder(new THREE.Group(), materials, { log });
    builder.update(parseTown(world));
    builder.dispose();
    for (const [id, pieces] of log) {
      if (id.startsWith('bridge:')) continue;
      const triangles = [];
      for (const [key, list] of pieces) {
        if (!key.startsWith('under:') || key.endsWith(':drip') || key.endsWith(':root')) continue;
        const p = points(list);
        for (let i = 0; i + 2 < p.length; i += 3) triangles.push([p[i], p[i + 1], p[i + 2]]);
      }
      for (const [key, list] of pieces) {
        if (!key.endsWith(':drip')) continue;
        drips++;
        const p = points(list);
        const top = Math.max(...p.map(q => q[1]));
        for (const q of p.filter(q => q[1] > top - 1e-6)) {
          const rock = undersideAt(triangles, q[0], q[2]);
          if (rock === null) continue;
          assert.ok(q[1] >= rock - 1e-4, `${name} ${id} ${key}: the drip's top is ${(rock - q[1]).toFixed(3)} below the rock`);
        }
      }
    }
  }
  assert.ok(drips > 0, 'some islands have drips to check');
});
