import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildTown } from '../../town/index.js';
import { parseTown } from '../town/world.js';
import { birdPerch, BRANCH } from './bird-perch.js';

const fixtures = new URL('../../../../../development-tools/game-gallery/states/town/', import.meta.url);
const pointSegmentGap = (point, a, b) => {
  let closest = Infinity;
  // Independently sample a short branch at less than .002 world-unit intervals.
  for (let step = 0; step <= 512; step++) {
    const mix = step / 512;
    closest = Math.min(closest, Math.hypot(point[0] - a[0] - mix * (b[0] - a[0]), point[1] - a[2] - mix * (b[2] - a[2])));
  }
  return closest;
};

test('bird branches and takeoff columns clear occupied neighbors across existing town fixtures', t => {
  let checked = 0, skipped = 0;
  for (const file of readdirSync(fixtures).filter(f => f.endsWith('.json'))) {
    const world = buildTown(JSON.parse(readFileSync(new URL(file, fixtures))));
    const before = JSON.stringify(world), model = parseTown(world);
    for (const island of model.islands) {
      const site = birdPerch(island);
      if (!site) { skipped++; continue; }
      checked++;
      assert.deepEqual(birdPerch(island), site);
      // A short branch at leaf height, its tip a little higher, the bird just inside the tip.
      assert.equal(site.from[1], BRANCH.height);
      assert.equal(site.to[1], BRANCH.height + BRANCH.rise);
      assert.ok(site.from[1] >= 0.7 && site.from[1] <= 0.8, `${file}/${island.id}: leaf height`);
      const length = Math.hypot(site.to[0] - site.from[0], site.to[2] - site.from[2]);
      assert.ok(length >= 0.35 && length <= 0.45, `${file}/${island.id}: short branch ${length}`);
      assert.ok(site.perch[1] > site.from[1] && site.perch[1] < site.to[1] + 0.02);
      assert.ok(pointSegmentGap([site.perch[0], site.perch[2]], site.from, site.to) < 1e-3, 'perch on the branch');
      assert.ok(Math.hypot(site.perch[0] - site.to[0], site.perch[2] - site.to[2]) <= BRANCH.seat + 1e-9, 'perch near the tip');
      const centers = [...island.floors.keys()].map(p => [island.point(p), 0.45]);
      for (const thing of island.things) {
        if (thing.id === site.tree || !(thing.pad || thing.blocks)) continue;
        if (thing.kind === 'tree' || thing.kind === 'goldentree') centers.push([thing.local, 0.72 * Math.max(1, thing.scale || 1)]);
        else for (const p of thing.points) centers.push([island.point(p), thing.pad ? 0.45 : 0.38]);
      }
      for (const [at, radius] of centers) {
        assert.ok(pointSegmentGap(at, site.from, site.to) >= radius + 0.034, `${file}/${island.id}: clear branch`);
        assert.ok(Math.hypot(at[0] - site.perch[0], at[1] - site.perch[2]) >= radius + 0.14 - 1e-9, `${file}/${island.id}: clear takeoff`);
      }
    }
    assert.equal(JSON.stringify(world), before, 'no world changes');
  }
  assert.ok(checked > 20);
  t.diagnostic(`${checked} safe perches; ${skipped} crowded islands safely omitted`);
});

test('no tree or a surrounded tree returns no invented perch', () => {
  assert.equal(birdPerch(null), null);
  const blocked = { id: 'home', grid: { points: [] }, things: [{ id: 'home:tree', kind: 'tree', local: [0, 0], points: [0], blocks: true }],
    floors: new Map([[1, 1]]), land: new Set([0]), point: () => [0, 0] };
  assert.equal(birdPerch(blocked), null);
});
