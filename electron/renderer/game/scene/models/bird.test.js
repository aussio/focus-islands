import test from 'node:test';
import assert from 'node:assert/strict';
import { birdMoment, createBird, BIRD_SCALE, FLIGHT_RADIUS } from './bird.js';

test('on a flying turn the bird rests most of the time and circles only above scenery', () => {
  const perch = [2, 0.52, 3], top = 2.3;
  let flying = 0;
  for (let t = 0; t < 64; t += 0.125) {
    const pose = birdMoment(t, perch, top);
    assert.ok(pose.position.every(Number.isFinite));
    assert.ok(pose.position[1] >= perch[1] && pose.position[1] <= top);
    if (t >= 34 && t <= 42) assert.equal(pose.position[1], top);
    else assert.ok(Math.abs(pose.position[0] - perch[0]) < 1e-10 && Math.abs(pose.position[2] - perch[2]) < 1e-10);
    flying += pose.flying > 0 ? 1 : 0;
    // Without flying (a focus turn) or out of its turn, it stays on the perch.
    for (const still of [birdMoment(t, perch, top, { fly: false }), birdMoment(null, perch, top)]) {
      assert.deepEqual(still.position, perch);
      assert.equal(still.flying, 0);
    }
  }
  assert.ok(flying / 512 < 0.2);
  for (const t of [32, 34, 42, 44]) {
    const before = birdMoment(t - 0.00001, perch, top), after = birdMoment(t + 0.00001, perch, top);
    assert.ok(Math.hypot(...before.position.map((p, i) => p - after.position[i])) < 0.0001);
    assert.ok(Math.abs(Math.atan2(Math.sin(before.yaw - after.yaw), Math.cos(before.yaw - after.yaw))) < 0.0001);
  }
});

test('the flight circle reaches out in the chosen direction and the bird faces where it flies', () => {
  const perch = [0, 0.8, 0], top = 2;
  for (const toward of [[1, 0], [0, 1], [-1, 1], [0, -2]]) {
    const l = Math.hypot(...toward), [ex, ez] = toward.map(v => v / l);
    // Halfway round, the bird is one diameter out along toward.
    const half = birdMoment(38, perch, top, { toward });
    assert.ok(Math.hypot(half.position[0] - 2 * FLIGHT_RADIUS * ex, half.position[2] - 2 * FLIGHT_RADIUS * ez) < 1e-9);
    for (let t = 34.5; t < 41.5; t += 0.5) {
      const a = birdMoment(t, perch, top, { toward }), b = birdMoment(t + 0.01, perch, top, { toward });
      const heading = Math.atan2(b.position[0] - a.position[0], b.position[2] - a.position[2]);
      assert.ok(Math.abs(Math.atan2(Math.sin(heading - a.yaw), Math.cos(heading - a.yaw))) < 0.05, `faces forward at ${t}`);
    }
    for (const t of [32, 34, 42, 44]) {
      const before = birdMoment(t - 0.00001, perch, top, { toward }), after = birdMoment(t + 0.00001, perch, top, { toward });
      assert.ok(Math.hypot(...before.position.map((p, i) => p - after.position[i])) < 0.0001);
    }
  }
});

test('the bird is drawn a little larger than its model and disposes cleanly', () => {
  const bird = createBird();
  assert.equal(bird.root.scale.x, BIRD_SCALE);
  assert.ok(BIRD_SCALE > 1.2 && BIRD_SCALE < 1.4);
  bird.dispose(); bird.dispose();
});

test('wings beat slowly in the air: about one and a quarter beats a second', () => {
  const bird = createBird();
  try {
    const wing = bird.root.children.filter(c => c.isGroup && c.children.length === 1)[0];
    let peaks = 0, before = -Infinity, rising = false;
    for (let t = 0; t <= 4; t += 0.01) {
      bird.pose(t, 1);
      const z = Math.abs(wing.rotation.z);
      if (z < before && rising) peaks++;
      rising = z > before; before = z;
    }
    assert.ok(peaks >= 4 && peaks <= 6, `${peaks} beats in four seconds`);
  } finally { bird.dispose(); }
});
