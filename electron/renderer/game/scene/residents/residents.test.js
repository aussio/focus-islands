import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { buildTown } from '../../town/index.js';
import { islandKey, townKey } from '../../town/shape.js';
import { parseTown } from '../town/world.js';
import { walkGraph, planHelpers } from '../town/walk.js';
import { loopOwner, LOOP } from '../calm.js';
import { createCat } from './cat.js';
import { createResidents } from './index.js';
import { residentRoute, residentMoment, REST_GAP } from './placement.js';

const states = new URL('../../../../../development-tools/game-gallery/states/town/', import.meta.url);
const game = JSON.parse(readFileSync(new URL('steady-day-7.json', states)));
const resident = { id: 'resident-1', kind: 'cat', island: 'home', appearanceSeed: 7, arrivedAtCheckIn: 12 };
// The scene time a loop owned by the cat on home starts at.
const CAT_LOOP = (() => { for (let n = 1; ; n++) if (loopOwner('home', n) === 'cat') return n * LOOP; })();
const gap = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('residents cross cached layout and parser without affecting historical placement or camera view', () => {
  const before = buildTown(game), after = buildTown({ ...game, residents: [resident] });
  assert.notEqual(townKey(before), townKey(after), 'arrival reaches scene change detection');
  const { residents, ...without } = after;
  assert.deepEqual(without, before, 'resident changes no static world data');
  assert.deepEqual(residents, [resident]);
  for (const island of before.islands) assert.equal(islandKey(before, island), islandKey(after, island.id));
  assert.deepEqual(parseTown(after).residents, [resident]);
  after.residents[0].kind = 'changed';
  assert.equal(buildTown({ ...game, residents: [resident] }).residents[0].kind, 'cat', 'cache returns fresh resident copies');
  assert.deepEqual(parseTown(before).residents, [], 'old world has no retroactive resident');
});

test('resident lifecycle stays bounded, yields to visitors and respects still/empty worlds', () => {
  const scene = new THREE.Scene(), residents = createResidents(scene);
  const world = buildTown({ ...game, residents: [resident, { ...resident, id: 'extra' }] });
  residents.setWorld(parseTown(world));
  assert.equal(residents.rigs.length, 1);
  const old = residents.rigs[0].figure;
  residents.update(0);
  const start = old.root.position.clone();
  residents.update(26);
  assert.deepEqual(old.root.position.toArray(), start.toArray(), 'the first loop after the clock starts belongs to nobody');
  residents.update(CAT_LOOP + 0.5);
  residents.update(CAT_LOOP + 26);
  assert.notDeepEqual(old.root.position.toArray(), start.toArray(), 'it strolls on its own turn');
  residents.update(CAT_LOOP + 26, true);
  assert.deepEqual(old.root.position.toArray(), start.toArray(), 'reduced motion is held');
  // A moving visitor arriving keeps the same cat on the same spot, but holds its turns.
  const visiting = { ...world, islands: world.islands.map(i => ({ ...i, visitor: 'balloon' })) };
  residents.setWorld(parseTown(visiting));
  assert.equal(residents.rigs[0].figure, old, 'same resident and route: the rig stays');
  residents.update(CAT_LOOP + 0.5);
  residents.update(CAT_LOOP + 26);
  assert.deepEqual(old.root.position.toArray(), start.toArray(), 'visiting motion takes precedence');
  residents.setWorld(parseTown({ ...world, residents: [{ ...resident, kind: 'unknown' }] }));
  assert.equal(old.root.parent, null, 'old rig removed');
  assert.equal(residents.rigs.length, 0, 'unknown future kind skipped');
  residents.setScale(1.3);
  residents.setWorld(parseTown(world));
  assert.equal(residents.rigs[0].figure.root.scale.x, 1.3, 'a new cat takes Today\'s size');
  residents.setScale(1.1);
  assert.equal(residents.rigs[0].figure.root.scale.x, 1.1, 'and follows it, like the helpers');
  residents.setWorld(parseTown(null));
  assert.equal(residents.group.children.length, 0, 'switching profiles clears residents');
  residents.dispose(); residents.dispose();
  assert.equal(scene.children.length, 0);
});

// Records what the scene asks the figure to show.
function watch(residents) {
  const seen = [], figure = residents.rigs[0].figure, real = figure.pose;
  figure.pose = (state, time, rig) => { seen.push({ state, curl: rig?.curl ?? 0, stride: rig?.stride ?? 0 }); return real(state, time, rig); };
  return () => seen.at(-1);
}

test('a still visitor such as the rainbow, or a bird (it takes turns), does not stop the cat', () => {
  for (const visitor of ['rainbow', 'bird']) {
    const residents = createResidents(new THREE.Scene());
    const world = buildTown({ ...game, residents: [resident] });
    residents.setWorld(parseTown({ ...world, islands: world.islands.map(i => ({ ...i, visitor })) }));
    residents.update(0);
    const start = residents.rigs[0].figure.root.position.toArray();
    residents.update(CAT_LOOP + 0.5);
    residents.update(CAT_LOOP + 26);
    assert.notDeepEqual(residents.rigs[0].figure.root.position.toArray(), start, visitor);
    residents.dispose();
  }
});

test('the cat sleeps curled in away and done, even under reduced motion, and wakes gradually', () => {
  const residents = createResidents(new THREE.Scene());
  residents.setWorld(parseTown(buildTown({ ...game, residents: [resident] })));
  const last = watch(residents), root = residents.rigs[0].figure.root;
  for (const mood of ['away', 'done']) {
    residents.setMood(mood);
    residents.update(26, true);
    assert.deepEqual(last(), { state: 'rest', curl: 1, stride: 0 }, `${mood}, reduced motion`);
    const spot = root.position.toArray();
    for (const t of [0, 10, 26, 40, 57, CAT_LOOP + 0.5, CAT_LOOP + 26]) {
      residents.update(t);
      assert.deepEqual(last(), { state: 'rest', curl: 1, stride: 0 }, `${mood} at ${t}`);
      assert.deepEqual(root.position.toArray(), spot, `${mood}: stays put`);
    }
  }
  // Morning: it uncurls over a few seconds instead of jumping up.
  residents.setMood('focus');
  residents.update(0.05); residents.update(1);
  const waking = last().curl;
  assert.ok(waking > 0 && waking < 1, `part way (${waking})`);
  for (let t = 1; t < 8; t += 0.1) residents.update(t);
  assert.notEqual(last().state, 'rest');
  // Reduced motion jumps straight to the new pose.
  residents.setMood('done');
  residents.update(0, true);
  assert.deepEqual(last(), { state: 'rest', curl: 1, stride: 0 });
  residents.dispose();
});

test('a mood change part way through a stroll never slides the cat: it walks, then curls or sits', () => {
  const route = residentRoute(parseTown(buildTown({ ...game, residents: [resident] })), 'home');
  const length = gap(route.from, route.to);
  const fastest = length / 4; // the settling walk covers the route in about four seconds
  // [moment in the cat's turn when the mood changes, new mood, the end it should settle at (0 home), curled]
  for (const [moment, mood, end, curled] of [[25.5, 'done', 1, true], [26.5, 'away', 1, true], [40, 'break', 0, false], [29, 'focus', 0, false], [57.5, 'done', 0, true]]) {
    const residents = createResidents(new THREE.Scene());
    residents.setWorld(parseTown(buildTown({ ...game, residents: [resident] })));
    const last = watch(residents), root = residents.rigs[0].figure.root;
    residents.update(0.1);
    for (let t = CAT_LOOP; t <= CAT_LOOP + moment; t += 1 / 30) residents.update(t);
    let before = root.position.clone(), wasStriding = last().stride > 0;
    residents.setMood(mood); // the scene clock starts again at 0
    for (let t = 1 / 30; t < 20; t += 1 / 30) {
      residents.update(t);
      const moved = root.position.distanceTo(before), now = last();
      assert.ok(moved <= fastest / 30 + 1e-9, `${moment} to ${mood}: no jump at ${t.toFixed(2)} s (${moved})`);
      if (moved > 1e-9) assert.ok(now.stride > 0 || wasStriding, `${moment} to ${mood}: moves only while striding at ${t.toFixed(2)} s`);
      if (moved > 1e-9) assert.equal(now.curl, 0, `${moment} to ${mood}: never moves curled`);
      before = root.position.clone(); wasStriding = now.stride > 0;
    }
    assert.equal(last().curl, curled ? 1 : 0, `${moment} to ${mood}: settled`);
    const at = root.position.toArray();
    assert.ok(gap(end ? route.to : route.from, at) < 1e-9, `${moment} to ${mood}: at the end it was heading for, or home`);
    residents.dispose();
  }
});

test('the cat\'s spot is quiet grass: never a lane, coast, building or bridge foot; the same world gives the same spot', () => {
  let checked = 0;
  for (const file of readdirSync(states).filter(f => f.endsWith('.json'))) {
    const world = buildTown({ ...JSON.parse(readFileSync(new URL(file, states))), residents: [resident] });
    const before = JSON.stringify(world);
    const model = parseTown(world), island = model.byId.get('home'), graph = walkGraph(model);
    const route = residentRoute(model, 'home');
    assert.ok(route, `${file}: a spot exists`);
    assert.equal(route.fallback, 0, `${file}: every rule held`);
    checked++;
    const feet = new Set((island.feet ?? []).map(f => f.point));
    for (const p of route.points) {
      assert.ok(graph.walkable(island, p), `${file}: walkable`);
      for (const [name, set] of [['lane', island.lanes], ['coast', island.coast], ['taken', island.taken], ['bridge foot', feet]]) {
        assert.ok(!set.has(p), `${file}: not on a ${name}`);
      }
      assert.ok(!island.floors.has(p), `${file}: not inside a building`);
    }
    if (route.points.length === 2) assert.ok(island.grid.neighbours[route.points[0]].includes(route.points[1]), `${file}: one edge`);
    assert.deepEqual(residentRoute(model, 'home'), route, `${file}: same model`);
    assert.deepEqual(residentRoute(parseTown(buildTown({ ...JSON.parse(readFileSync(new URL(file, states))), residents: [resident] })), 'home'), route, `${file}: same world`);
    assert.equal(JSON.stringify(world), before, `${file}: the town is not changed`);
  }
  assert.ok(checked > 10, `${checked} towns`);
});

test('a helper never lies down on the cat: its spots keep a lying helper\'s length from every helper\'s spot in every mood', () => {
  let checked = 0;
  for (const file of readdirSync(states).filter(f => f.endsWith('.json'))) {
    const model = parseTown(buildTown({ ...JSON.parse(readFileSync(new URL(file, states))), residents: [resident] }));
    const route = residentRoute(model, 'home');
    const spots = [route.from, route.to];
    for (const mood of ['focus', 'break', 'done', 'away']) {
      for (const plan of planHelpers(model, mood)) {
        for (const segment of plan.line.segments) {
          if (Math.hypot(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]) > 1e-6) continue;
          const [x, z] = segment.from, y = 0;
          for (const spot of spots) assert.ok(gap(spot, [x, y, z]) >= REST_GAP - 1e-9, `${file}, ${mood}: ${gap(spot, [x, y, z]).toFixed(2)} from a helper's ${segment.anim} spot`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 100, `${checked} helper spots`);
});

test('a packed island still gets a cat, on the best ground left, never in a building', () => {
  const fresh = () => { const model = parseTown(buildTown({ ...game, residents: [resident] })); return { ...model, data: undefined }; };
  const check = (model, name) => {
    const island = model.byId.get('home');
    const route = residentRoute(model, 'home');
    assert.ok(route, `${name}: still a spot`);
    for (const p of route.points) assert.ok(!island.taken.has(p) && !island.floors.has(p), `${name}: not on a thing or in a building`);
    return { route, island };
  };
  // No grass away from the coast: it sits by the water.
  let model = fresh(), island = model.byId.get('home');
  for (const p of island.grid.points.keys()) if (!island.lanes.has(p)) island.coast.add(p);
  let { route } = check(model, 'coast only');
  assert.equal(route.fallback, 2);
  assert.ok(route.points.every(p => island.coast.has(p)));
  // Every free spot built over: it sits on a lane.
  model = fresh(); island = model.byId.get('home');
  for (const p of island.grid.points.keys()) if (!island.lanes.has(p) && !island.taken.has(p)) island.taken.set(p, { kind: 'test' });
  ({ route } = check(model, 'lanes only'));
  assert.equal(route.fallback, 3);
  assert.ok(route.points.every(p => island.lanes.has(p)));
});

test('the cat\'s routine rests most of the time, never leaves its edge and is continuous', () => {
  const route = { points: [1, 2], from: [3, 0.5, 4], to: [3.4, 0.5, 4.4] };
  let walks = 0;
  for (let time = 0; time < 64; time += 0.25) {
    const pose = residentMoment(time, route);
    walks += Number(pose.pose === 'walk');
    assert.ok(pose.position[0] >= 3 && pose.position[0] <= 3.4);
    assert.ok(pose.position[2] >= 4 && pose.position[2] <= 4.4);
    assert.equal(pose.position[1], 0.5);
  }
  assert.equal(walks / 256, 0.125);
  const single = { points: [1], from: route.from, to: route.from };
  assert.equal(residentMoment(26, single).pose, 'sit');
  assert.deepEqual(residentMoment(26, single).position, single.from);
  for (const to of [[1, 0, 1], [-1, 0, -1], [0, 0, -1]]) {
    const edge = { points: [1, 2], from: [0, 0, 0], to };
    for (const boundary of [21, 24, 28, 31, 51, 54, 56, 60, 63]) {
      const before = residentMoment(boundary - 0.0001, edge), after = residentMoment(boundary + 0.0001, edge);
      assert.ok(Math.hypot(...after.position.map((v, i) => v - before.position[i])) < 0.0001, `position at ${boundary}`);
      assert.ok(Math.abs(Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw))) < 0.0001, `yaw at ${boundary}`);
      for (const key of ['sit', 'curl', 'stride']) assert.ok(Math.abs(after.rig[key] - before.rig[key]) < 0.0001, `${key} at ${boundary}`);
    }
    // It starts and ends its turn the same way: sitting at home, facing the camera.
    const { time: t0, ...first } = residentMoment(0, edge), { time: t1, ...end } = residentMoment(63.99, edge);
    assert.deepEqual(end, first);
  }
});

// Every visible vertex of the cat, in world space.
function vertices(cat) {
  cat.root.updateMatrixWorld(true);
  const out = [], point = new THREE.Vector3();
  cat.root.traverseVisible(node => {
    const positions = node.geometry?.attributes?.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) out.push(...point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).toArray());
  });
  return out;
}

test('the cat stays grounded through its routine, keeps its sleeping shape and needs no frame history', () => {
  const cat = createCat(), route = { points: [1, 2], from: [0, 0, 0], to: [0.4, 0, 0.4] };
  try {
    cat.pose('rest', 0);
    const sleep = vertices(cat);
    for (let time = 0; time < 64; time += 0.25) {
      const moment = residentMoment(time, route);
      cat.pose(moment.pose, moment.time, moment.rig);
      const expected = vertices(cat);
      assert.ok(expected.every(Number.isFinite), `finite geometry at ${time}`);
      const heights = expected.filter((_, i) => i % 3 === 1);
      assert.ok(Math.min(...heights) >= -0.00001, `grounded at ${time}`);
      assert.ok(Math.max(...heights) < 0.32, `same cat scale at ${time}`);
      if (time >= 31 && time < 51) assert.deepEqual(expected, sleep, `approved sleep silhouette at ${time}`);
      cat.pose('walk', 0.73);
      cat.pose(moment.pose, moment.time, moment.rig);
      assert.deepEqual(vertices(cat), expected, `pose independent of prior frame at ${time}`);
    }
  } finally { cat.dispose(); cat.dispose(); }
});
