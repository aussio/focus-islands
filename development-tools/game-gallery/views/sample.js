// Stream F's sample view: proves the view loader and the drawing tools. Delete it once the real views
// (map, pieces, pads, town) cover the same ground.
import * as THREE from 'three';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { rbox } from '../../../electron/renderer/game/scene/parts.js';
import { SAMPLE_WORLDS } from '../../../electron/renderer/game/scene/sample-worlds.js';
import { gridFor } from '../../../electron/renderer/game/town/grid.js';
import { sampleTown } from '../../../electron/renderer/game/town/samples.js';

// A few boxes on a grass slab, with a lit window so the moods show.
function boxes(ctx) {
  const P = ctx.palette, base = place(0, 0, 0);
  ctx.piece('sample:ground');
  ctx.add(rbox(3.2, 0.2, 2.2, 0.06, 3), 'ground', P.grass ?? '#8fd16a', place(0, -0.1, 0), base, false);
  const spots = [[-1, 0, '#f4a6a0', 0.5], [0, -0.3, '#a8c8f0', 0.8], [1, 0.2, '#f6d58e', 0.35]];
  spots.forEach(([x, z, color, h], i) => {
    ctx.piece(`sample:box:${i}`);
    const at = place(x, 0, z, { ry: i * 0.3 });
    ctx.add(rbox(0.6, h, 0.6, 0.04, 3).translate(0, h / 2, 0), 'matte', color, null, at);
    ctx.add(rbox(0.16, 0.18, 0.02, 0.01, 2), 'glass', '#3d4a6b', place(0, h * 0.55, 0.31), at, false);
    ctx.blob(at, 0.95);
  });
}

// One island's grid as thin lines, added straight to ctx.root (not through the batch).
function gridLines(ctx, id, size) {
  const grid = gridFor(id, size);
  const positions = [];
  for (const cell of grid.cells) cell.forEach((p, k) => {
    const a = grid.points[p], b = grid.points[cell[(k + 1) % 4]];
    positions.push(a[0], 0.01, a[1], b[0], 0.01, b[1]);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: '#4d6b3a' });
  ctx.track(material);
  ctx.root.add(new THREE.LineSegments(geometry, material));
}

export default {
  id: 'sample',
  title: 'Sample view (stream F: proves the loader and tools)',
  sections: [
    {
      id: 'shot', title: 'shot(): boxes in every mood, then turned and tilted',
      async render(host, tools) {
        const moods = tools.grid('gallery-moods');
        for (const mood of tools.MOODS) moods.append(tools.card(mood, '', [await tools.shot(boxes, { mood, width: 330, height: 220 })]));
        tools.heading('Angles', 'yaw turns the subject; pitch tilts the camera');
        const angles = tools.grid('gallery-medium');
        for (const [label, options] of [['Today\'s angle', {}], ['yaw π/2 (from the east)', { yaw: Math.PI / 2 }], ['pitch 0.35 (low)', { pitch: 0.35 }], ['pitch 1.4 (from above)', { pitch: 1.4 }], ['aim at the blue box', { aim: [-0.35, 0.35].flatMap(x => [0, 0.85].flatMap(y => [-0.65, 0.05].map(z => [x, y, z]))) }]]) {
          const img = await tools.shot(boxes, { ...options, width: 280, height: 200 });
          angles.append(tools.card(label, `${img.stats?.triangles ?? '?'} triangles · ${img.stats?.calls ?? '?'} draw calls`, [img]));
        }
        tools.heading('Grid lines', 'gridFor(id, size), added straight to ctx.root');
        const grids = tools.grid('gallery-medium');
        for (const [id, size] of [['home', 'large'], ['isle-1', 'medium'], ['isle-2', 'small']]) {
          grids.append(tools.card(`${id} · ${size}`, `${gridFor(id, size).cells.length} cells`, [await tools.shot(ctx => gridLines(ctx, id, size), { width: 280, height: 200, pitch: 1.2 })]));
        }
        tools.heading('Errors', 'a build that throws shows its message');
        tools.grid('gallery-medium').append(tools.card('throws', '', [await tools.shot(() => { throw new Error('This build fails on purpose.'); }, { width: 280, height: 120 })]));
      },
    },
    {
      id: 'worlds', title: 'worldShot(): a square world and a town world',
      async render(host, tools) {
        const row = tools.grid('gallery-medium');
        row.append(tools.card('square: grown', 'focus', [await tools.worldShot(SAMPLE_WORLDS.grown?.world ?? Object.values(SAMPLE_WORLDS)[0].world, 'focus', { width: 330, height: 220 })]));
        row.append(tools.card('town: village sample', 'break', [await tools.worldShot(sampleTown('village'), 'break', { width: 330, height: 220 })]));
        const first = tools.data.town.states.find(entry => entry.world?.islands?.length);
        row.append(tools.card('town state', first ? first.id : tools.data.town.note || 'no town states', first ? [await tools.worldShot(first.world, 'focus', { width: 330, height: 220 })] : []));
        tools.note(`data.town.states: ${tools.data.town.states.map(s => s.id).join(', ') || 'none'}`);
      },
    },
    {
      id: 'broken', title: 'A section that throws (the others still draw)',
      async render() { throw new Error('This section fails on purpose.'); },
    },
  ],
};
