// The town path of the scene, in Node (Three.js, no WebGL): parseTown on the sample towns, building
// island by island, rebuilding only what changed, drifting islands, and the camera.
import test from 'node:test';
import assert from 'node:assert/strict';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({
  tagName: tag, width: 0, height: 0, style: {}, className: '', children: [], attributes: {}, isConnected: true,
  clientWidth: 600, clientHeight: 360, ownerDocument: undefined,
  setAttribute(k, v) { this.attributes[k] = v; },
  getContext: type => (type === '2d' ? ctx2d : null),
  addEventListener() {}, removeEventListener() {},
  appendChild(child) { this.children.push(child); child.parent = this; return child; },
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
});
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const { SAMPLE_NAMES, sampleTown, sampleFilm } = await import('../../town/samples.js');
const { parseTown, isTownWorld, drawKey } = await import('./world.js');
const { CLEAR_TOP, createSceneCore } = await import('../core.js');
const { AIM_SECONDS, CAMERA_STYLES, ELEVATION, createStage } = await import('../stage.js');
const { DRIFT, SWAY, samePlace } = await import('../drift.js');
const THREE = await import('three');

test('parseTown reads every sample town', () => {
  for (const name of SAMPLE_NAMES) {
    const world = sampleTown(name);
    assert.ok(isTownWorld(world), `${name} is a town world`);
    const model = parseTown(world);
    assert.equal(model.town, true);
    assert.equal(model.islands.length, world.islands.length, `${name}: every island`);
    assert.equal(model.things.length, world.things.length, `${name}: every thing`);
    assert.equal(model.bridges.length, world.bridges.length, `${name}: every bridge`);
    assert.equal(model.helpers.length, world.helpers.length, `${name}: every helper`);
    for (const [index, island] of model.islands.entries()) {
      const source = world.islands[index];
      assert.equal(island.index, index);
      assert.equal(island.grid, source.grid, 'the grid is shared, never copied');
      assert.equal(island.key, drawKey(world, source));
      assert.deepEqual([...island.land], source.land);
      assert.deepEqual([...island.lanes], source.lanes);
      assert.deepEqual([...island.kept], source.kept);
      assert.equal(island.plaza, source.lanes[0]);
      assert.equal(island.lift, source.lift);
      assert.deepEqual(island.at, source.at);
      for (const p of island.coast) assert.ok(island.land.has(p) && island.grid.neighbours[p].some(n => !island.land.has(n)));
      for (const house of source.houses) {
        for (const block of house.blocks) {
          assert.equal(island.floors.get(block.point), block.floors);
          assert.equal(island.look.get(block.point), house.look);
          assert.equal(island.house.get(block.point), house.id);
        }
        assert.ok(island.doors.some(d => d.house === house.id && d.point === house.door.point && d.outside === house.door.outside));
      }
      const [x, y, z] = island.world(island.plaza);
      assert.deepEqual([x, y, z].map(v => v.toFixed(3)), [source.at[0] + source.grid.points[island.plaza][0], source.lift, source.at[1] + source.grid.points[island.plaza][1]].map(v => v.toFixed(3)));
    }
    for (const thing of model.things) {
      const island = model.byId.get(thing.island);
      assert.ok(island.things.includes(thing));
      for (const p of thing.points) assert.equal(island.taken.get(p), thing);
      assert.equal(thing.world[0].toFixed(3), (island.at[0] + thing.at[0]).toFixed(3));
      assert.equal(thing.world[1], island.lift);
      assert.equal(thing.world[2].toFixed(3), (island.at[1] + thing.at[1]).toFixed(3));
    }
    for (const bridge of model.bridges) {
      for (const end of [bridge.from, bridge.to]) {
        const island = model.byId.get(end.island);
        assert.ok(island.lanes.has(end.point), 'a bridge foot is a lane');
        assert.equal(end.at[1], island.lift, 'a foot stands at its island\'s lift');
        assert.ok(end.out.length === 2 && Number.isFinite(end.clear) && end.clear >= 0);
        assert.ok(Math.abs(Math.hypot(...end.out) - 1) < 1e-3, 'out is a unit direction');
        assert.ok(island.feet.some(f => f.bridge === bridge.id && f.point === end.point));
      }
      // Without out from the layout, each end looks toward the other island.
      const a = model.byId.get(bridge.from.island), b = model.byId.get(bridge.to.island);
      const toward = [b.at[0] - a.at[0], b.at[1] - a.at[1]];
      if (!world.bridges.find(b => b.id === bridge.id).from.out) assert.ok(bridge.from.out[0] * toward[0] + bridge.from.out[1] * toward[1] > 0, 'the from end faces the other island');
    }
    if (world.view.island) {
      assert.equal(model.view.island, world.view.island);
      assert.deepEqual(model.view.ids, world.view.points);
      assert.equal(model.view.points.length, world.view.points.length);
      assert.ok(model.view.points.every(p => p.length === 3 && p.every(Number.isFinite)));
    }
  }
});

test('parseTown keeps out and clear from the layout, and copes with odd worlds', () => {
  const world = sampleTown('manyIslands');
  const withEnds = { ...world, bridges: world.bridges.map(b => ({ ...b, from: { ...b.from, out: [0, 1], clear: 1.25 }, to: { ...b.to, out: [0, -2], clear: 0.5 } })) };
  const model = parseTown(withEnds);
  for (const bridge of model.bridges) {
    assert.deepEqual(bridge.from.out, [0, 1]);
    assert.deepEqual(bridge.to.out, [0, -1], 'out is made a unit direction');
    assert.equal(bridge.from.clear, 1.25);
    assert.equal(bridge.to.clear, 0.5);
  }
  // Missing out and clear: filled in.
  const bare = parseTown({ ...world, bridges: world.bridges.map(b => ({ id: b.id, type: b.type, from: { island: b.from.island, point: b.from.point }, to: { island: b.to.island, point: b.to.point } })) });
  for (const bridge of bare.bridges) for (const end of [bridge.from, bridge.to]) assert.ok(end.clear > 0 && Math.abs(Math.hypot(...end.out) - 1) < 1e-3);
  // An upgrade (type only) or a longer straight run changes no island's key; a moved foot does.
  const upgraded = { ...withEnds, bridges: withEnds.bridges.map((b, i) => (i ? b : { ...b, type: 'cloudsteps', from: { ...b.from, clear: 2 } })) };
  assert.deepEqual(parseTown(upgraded).islands.map(i => i.key), model.islands.map(i => i.key));
  for (const odd of [null, undefined, {}, { islands: [] }, { islands: [{ id: 'x' }], things: [{ id: 't', island: 'nowhere', points: [1] }], bridges: [{ from: {}, to: null }], helpers: [null] }]) {
    const m = parseTown(odd);
    assert.equal(m.islands.length, 0);
    assert.equal(m.view.island, null);
  }
  assert.equal(isTownWorld({ islands: [{ id: 'home', origin: [0, 0], rows: ['g'] }] }), false, 'a world without grids is not a town');
  assert.equal(isTownWorld(null), false);
});

test('the sample film parses at every step', () => {
  for (const name of SAMPLE_NAMES) for (const { world } of sampleFilm(name)) assert.equal(parseTown(world).islands.length, world.islands.length);
});

// ---------- The town path ----------
const MOODS = ['focus', 'break', 'away', 'done'];
const originalError = console.error;
function watchErrors() {
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  return { errors, stop: () => { console.error = originalError; } };
}
// A core with a clock the test moves by hand.
function clockedCore(options = {}) {
  const clock = { ms: 0 };
  const core = createSceneCore({ now: () => clock.ms, ...options });
  return { core, clock };
}
const copy = world => ({ ...world, islands: world.islands.map(i => ({ ...i })), things: world.things.map(t => ({ ...t })), bridges: world.bridges.map(b => ({ ...b, from: { ...b.from }, to: { ...b.to } })), helpers: world.helpers.map(h => ({ ...h })), view: { ...world.view } });
const finite = v => v.every(Number.isFinite);

test('the town path builds every sample town, island by island, in every mood', () => {
  const watch = watchErrors();
  try {
    for (const name of SAMPLE_NAMES) {
      const world = sampleTown(name);
      const { core } = clockedCore();
      assert.equal(core.setWorld(world), true);
      assert.equal(core.setWorld(copy(world)), false, 'the same world must not rebuild');
      assert.equal(core.town.islands.size, world.islands.length);
      assert.equal(core.town.bridges.size, world.bridges.length);
      for (const island of world.islands) {
        const group = core.town.islands.get(island.id).group;
        assert.equal(group.parent, core.town.root);
        assert.deepEqual([group.position.x, group.position.y, group.position.z], [island.at[0], island.lift, island.at[1]], 'each island floats at its at and lift');
      }
      assert.equal(core.actors.rigs.length, world.helpers.length);
      for (const mood of MOODS) {
        core.setMood(mood);
        for (let t = 0; t < 6; t += 0.5) core.update(t);
        core.update(0, true);
        for (const rig of core.actors.rigs) assert.ok(finite(rig.root.position.toArray()));
      }
      assert.ok(finite(core.camera.position.toArray()));
      core.dispose();
    }
  } finally { watch.stop(); }
  assert.deepEqual(watch.errors, []);
});

test('only changed islands rebuild; a drifting island moves; an upgrade rebuilds only its bridge', () => {
  const world = sampleTown('manyIslands');
  const { core } = clockedCore();
  core.setWorld(world);
  const built = new Map(core.town.islands);
  const bridges = new Map(core.town.bridges);

  // One island changes: only it rebuilds.
  const grown = copy(world);
  grown.islands[1].land = world.islands[1].land.slice(0, -1);
  assert.equal(core.setWorld(grown), true);
  assert.deepEqual(core.lastReport.rebuilt, [world.islands[1].id]);
  for (const island of world.islands.filter((_, i) => i !== 1)) assert.equal(core.town.islands.get(island.id), built.get(island.id), `${island.id} is kept`);
  assert.deepEqual(core.lastReport.bridges, [], 'no bridge end moved');

  // An island drifts: its group moves, nothing on it is rebuilt, and only its bridges are redrawn.
  const drifted = copy(grown);
  const isle = drifted.islands[2];
  isle.at = [isle.at[0] + 0.65, isle.at[1]];
  const before = core.town.islands.get(isle.id);
  core.setWorld(drifted);
  assert.deepEqual(core.lastReport.rebuilt, []);
  assert.deepEqual(core.lastReport.moved, [isle.id]);
  assert.equal(core.town.islands.get(isle.id), before);
  assert.equal(before.group.position.x, isle.at[0]);
  const touching = world.bridges.filter(b => b.from.island === isle.id || b.to.island === isle.id).map(b => b.id).sort();
  assert.ok(touching.length > 0);
  assert.deepEqual(core.lastReport.bridges.slice().sort(), touching);
  for (const bridge of world.bridges.filter(b => !touching.includes(b.id))) assert.equal(core.town.bridges.get(bridge.id), bridges.get(bridge.id));
  // Its frame points move with it.
  const frame = core.town.framePoints(isle.id);
  assert.ok(frame.every(p => finite(p)) && frame.length > 0);

  // An upgrade changes only the bridge's type: no island rebuilds, only that bridge.
  const upgraded = copy(drifted);
  upgraded.bridges[0].type = 'cloudsteps';
  core.setWorld(upgraded);
  assert.deepEqual(core.lastReport.rebuilt, []);
  assert.deepEqual(core.lastReport.bridges, [world.bridges[0].id]);

  // After a lost drawing context, everything is built again.
  assert.equal(core.rebuild(), true);
  assert.deepEqual(core.lastReport.rebuilt.slice().sort(), world.islands.map(i => i.id).sort());
  assert.equal(core.lastReport.bridges.length, world.bridges.length);
  core.dispose();
});

test('a town and the empty sky take turns cleanly', () => {
  const { core } = clockedCore();
  const village = sampleTown('village');
  core.setWorld(village);
  const islandGroups = () => core.town.root.children.filter(node => node.name.startsWith('island-')).length;
  assert.equal(islandGroups(), village.islands.length);
  for (const world of [{}, { islands: [] }, { islands: [{ id: 'home', origin: [0, 0], rows: ['g'] }] }]) {
    core.setWorld(world);
    assert.equal(core.town.root.children.length, 0, 'every island and bridge is gone');
    assert.equal(core.actors.rigs.length, 0, 'and every helper');
    assert.equal(core.setWorld({}), false, 'one empty sky is like another');
    core.update(1);
  }
  core.setWorld(village);
  assert.equal(islandGroups(), village.islands.length, 'the town comes back whole');
  assert.equal(core.actors.rigs.length, village.helpers.length);
  core.dispose();
});

test('the camera jumps on the first world, then moves slowly only when the view changes', () => {
  const film = sampleFilm('manyIslands');
  const { core, clock } = clockedCore();
  core.setWorld(film[0].world);
  assert.equal(core.moving, false, 'the first world jumps');
  // A new island drifts in, but the view stays on home's same points: no move.
  core.setWorld(film[1].world);
  assert.equal(core.moving, false, 'the view did not change, so the camera stays');
  const first = core.stage.look;

  // A mood change never moves it.
  core.setMood('break');
  assert.deepEqual(core.stage.look, first);
  assert.equal(core.moving, false);

  // A new world that looks somewhere else: a slow move.
  core.setWorld(film[2].world);
  assert.notEqual(film[2].world.view.island, film[1].world.view.island, 'the sample moves the view to a new island');
  assert.equal(core.moving, true);
  const end = core.stage.target;
  assert.deepEqual(core.stage.look, first, 'it starts where it was');
  clock.ms = AIM_SECONDS * 500;
  core.update(1);
  const middle = core.stage.look;
  assert.ok(middle.at.every((v, i) => (v - first.at[i]) * (end.at[i] - v) >= -1e-9), 'half way, it is between the two');
  assert.notDeepEqual(middle.at, first.at);
  clock.ms = AIM_SECONDS * 1000 + 1;
  core.update(2);
  assert.equal(core.moving, false);
  assert.deepEqual(core.stage.look.at.map(v => v.toFixed(4)), end.at.map(v => v.toFixed(4)));

  // The same place again (only a helper's name changed): no move.
  const renamed = copy(film[2].world);
  renamed.helpers[0].name = 'Pippa';
  core.setWorld(renamed);
  assert.equal(core.moving, false);

  // settle() finishes a move at once; ease: false jumps; a resize jumps.
  core.setWorld(film[3].world);
  if (core.moving) {
    core.settle();
    assert.equal(core.moving, false);
    assert.deepEqual(core.stage.look.at, core.stage.target.at);
  }
  core.setWorld(film[0].world, { ease: false });
  assert.equal(core.moving, false);
  core.setWorld(film[3].world);
  assert.equal(core.moving, true);
  core.resize(400, 300);
  assert.equal(core.moving, false, 'a resize jumps');
  core.dispose();
});

test('the camera frames the view island whole, or closes in so helpers stay readable', () => {
  const world = sampleTown('manyIslands');
  // At Today's size, the busy island (small, early) is framed whole.
  const { core } = clockedCore();
  core.setWorld(world);
  assert.equal(core.aimed.island, world.view.island);
  const scale = () => core.actors.rigs[0].root.scale.x / 0.48;
  assert.ok(scale() >= 1 - 1e-9 && scale() <= 1.4 + 1e-9, 'the size boost is at most 1.4');
  // Shadows cover the framed island.
  const sun = core.scene.children.find(node => node.isDirectionalLight && node.castShadow);
  const target = sun.target.position;
  for (const p of core.town.framePoints(world.view.island)) {
    assert.ok(Math.hypot(p[0] - target.x, p[1] - target.y, p[2] - target.z) <= sun.shadow.camera.right + 1e-6, 'a framed point is outside the shadow area');
  }
  // The yaw stays fixed, looking north.
  const lookDir = core.camera.getWorldDirection(core.camera.position.clone());
  assert.ok(Math.abs(lookDir.x) < 1e-6 && lookDir.z < 0, 'the camera looks north');
  // A small window: helpers would be specks, so it frames view.points and 4 steps around them.
  core.resize(160, 100);
  assert.equal(core.aimed.close, true);
  assert.ok(scale() <= 1.4 + 1e-9);
  core.resize(591, 357);
  assert.equal(core.aimed.close, false);
  core.dispose();
});

// True when every point shows inside the picture, and no higher than `top` (1 is the top edge).
const inView = (camera, points, top = 1) => points.every(p => {
  const v = new THREE.Vector3(...p).project(camera);
  return Math.abs(v.x) <= 1 + 1e-6 && v.y >= -1 - 1e-6 && v.y <= top + 1e-6;
});
// The share of points outside the picture or above `top`: what has slipped out of view.
const slipped = (camera, points, top = 1) => points.filter(p => !inView(camera, [p], top)).length / points.length;
const restingAt = (route, seconds) => route.segments.find(g => (seconds % route.period) < g.start + g.seconds);
// The town's shadow box: it sits on the shadow map's texel grid and covers every corner of the picture on
// the ground, at any island height.
function checkShadow(core) {
  const sun = core.scene.children.find(node => node.isDirectionalLight && node.castShadow);
  const z = sun.position.clone().sub(sun.target.position).normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
  const y = z.clone().cross(x);
  const half = sun.shadow.camera.right;
  const texel = 2 * half / sun.shadow.mapSize.x;
  for (const axis of [x, y]) {
    const steps = sun.target.position.dot(axis) / texel;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-4, 'the box sits on the texel grid');
  }
  const ray = new THREE.Vector3(), hit = new THREE.Vector3();
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (const plane of [-0.5, 0.5]) {
    ray.set(sx, sy, 0.5).unproject(core.camera).sub(core.camera.position).normalize();
    hit.copy(core.camera.position).addScaledVector(ray, (plane - core.camera.position.y) / ray.y).sub(sun.target.position);
    assert.ok(Math.abs(hit.dot(x)) <= half && Math.abs(hit.dot(y)) <= half, 'the ground in view has shadows');
  }
}
const at = (core, clock, seconds) => { clock.ms = seconds * 1000; core.update(seconds); };
// A town big enough to drift in: several islands, at Today's size. These tests look at the drift's
// trips alone, so the camera keeps facing north unless a style is given.
function driftingCore({ style = 'drift', name = 'manyIslands', ...options } = {}) {
  const world = sampleTown(name);
  const { core, clock } = clockedCore(options);
  core.cameraStyle = style;
  core.resize(591, 357);
  core.setWorld(world);
  return { world, core, clock, route: core.stage.route };
}

test('between check-ins the camera drifts: a rest on the busy view, then the whole group and every island whole', () => {
  const { world, core, clock, route } = driftingCore();
  assert.ok(route, 'a town with several islands has somewhere else to look');
  const home = core.stage.look;
  for (const s of [1, 30, DRIFT.home - 0.5]) {
    at(core, clock, s);
    assert.deepEqual(core.stage.look, home, `at ${s} s it still rests on the busy view`);
  }
  assert.equal(core.moving, false, 'the drift is not a check-in move');
  // At the middle of each rest, what it rests on is fully in view; over a round, every island is.
  const seen = new Set();
  let wholeGroup = false;
  for (const g of route.segments.filter(g => g.from === g.to)) {
    at(core, clock, g.start + g.seconds / 2);
    for (const island of world.islands) if (inView(core.camera, core.town.framePoints(island.id))) seen.add(island.id);
    if (g.from === route.wide) wholeGroup ||= world.islands.every(island => inView(core.camera, core.town.framePoints(island.id)));
  }
  assert.deepEqual([...seen].sort(), world.islands.map(i => i.id).sort(), 'every island is seen whole at some point');
  assert.ok(wholeGroup, 'the pull back shows every island at once');
  // The yaw stays fixed all the way round.
  for (let s = 0; s < route.period; s += 5) {
    at(core, clock, s);
    const d = core.camera.getWorldDirection(new THREE.Vector3());
    assert.ok(Math.abs(d.x) < 1e-6 && d.z < 0, 'the drift always looks north');
  }
  // The same moment gives exactly the same picture, in another core too.
  const twin = driftingCore();
  for (const s of [12, 75.5, 140.25]) {
    at(core, clock, s);
    at(twin.core, twin.clock, s);
    assert.deepEqual(twin.core.camera.position.toArray(), core.camera.position.toArray());
  }
  twin.core.dispose();
  core.dispose();
});

test('a check-in eases from wherever the drift is to the busy view, then the drift starts again from its rest', () => {
  const { world, core, clock, route } = driftingCore();
  const away = route.segments.find(g => g.from === g.to && g.from !== route.home);
  at(core, clock, away.start + away.seconds / 2);
  const out = core.stage.look;
  assert.ok(!samePlace(out, core.stage.target), 'out on a trip');
  // A mood change never moves it.
  core.setMood('break');
  assert.deepEqual(core.stage.look, out);
  // A new world (here only a helper's name changed): ease home from right here.
  const renamed = copy(world);
  renamed.helpers[0].name = 'Pippa';
  core.setWorld(renamed);
  assert.equal(core.moving, true, 'it eases home');
  assert.ok(samePlace(core.stage.look, out, 1e-9), 'starting where it was');
  assert.equal(core.stage.driftSeconds, 0, 'the drift starts again');
  at(core, clock, clock.ms / 1000 + AIM_SECONDS / 2);
  assert.equal(core.moving, true, 'it takes at least AIM_SECONDS');
  at(core, clock, clock.ms / 1000 + AIM_SECONDS * 2.4);
  assert.equal(core.moving, false, 'and at most 2.4 times that');
  assert.ok(samePlace(core.stage.look, core.stage.target, 1e-9), 'then it rests on the busy view');
  at(core, clock, clock.ms / 1000 + DRIFT.home - AIM_SECONDS * 3);
  assert.ok(samePlace(core.stage.look, core.stage.target, 1e-9), 'for the rest of the drift\'s first rest');
  core.dispose();
});

test('reduced motion and the still style keep the camera on the busy view; sway turns it', () => {
  const { core, clock, route } = driftingCore();
  const away = route.segments.find(g => g.from === g.to && g.from !== route.home);
  const seconds = away.start + away.seconds / 2;
  // A still frame (reduced motion) shows the busy view even while the drift is out.
  clock.ms = seconds * 1000;
  core.update(seconds, true);
  assert.ok(samePlace(core.stage.look, core.stage.target, 1e-9));
  core.update(seconds);
  assert.ok(!samePlace(core.stage.look, core.stage.target), 'a moving frame shows the drift');
  // The still style eases home and stays there.
  core.cameraStyle = 'still';
  assert.equal(core.cameraStyle, 'still');
  assert.equal(core.moving, true);
  for (const later of [10, 100, 1000]) {
    at(core, clock, seconds + later);
    assert.ok(samePlace(core.stage.look, core.stage.target, 1e-9), `still home ${later} s later`);
  }
  core.cameraStyle = 'spin';
  assert.equal(core.cameraStyle, 'still', 'an unknown style is ignored');
  // Sway: the drift, plus a slow turn of at most SWAY.degrees from north.
  core.cameraStyle = 'sway';
  const from = clock.ms / 1000;
  let most = 0;
  for (let s = 0; s < SWAY.seconds / 2; s += 2) {
    at(core, clock, from + s);
    if (core.moving) continue;
    most = Math.max(most, Math.abs(core.stage.look.yaw));
  }
  assert.ok(most > 0.6 && most <= SWAY.degrees * Math.PI / 180 + 1e-9, `sway turned ${most}`);
  core.dispose();
});

test('the sway is the default: one island turns slowly around its middle, keeping the zoom and nearly all of the island', () => {
  assert.equal(CAMERA_STYLES[0], 'sway');
  const { core, clock } = clockedCore();
  core.resize(591, 357);
  core.setWorld(sampleTown('firstDay'));
  assert.equal(core.cameraStyle, 'sway', 'the default');
  assert.equal(core.stage.route, null, 'one island: no trips');
  const top = 1 - 2 * CLEAR_TOP / 357;
  const points = core.town.framePoints(core.aimed.island);
  const home = core.stage.target;
  const most = SWAY.degrees * Math.PI / 180;
  let low = 0, high = 0, fastest = 0, last = core.stage.look.yaw, near = Infinity, far = 0, lost = 0;
  core.update(0);
  core.takeChanged();
  for (let s = 0.5; s <= SWAY.seconds * 1.25; s += 0.5) {
    at(core, clock, s);
    const { at: middle, yaw, distance } = core.stage.look;
    low = Math.min(low, yaw); high = Math.max(high, yaw);
    fastest = Math.max(fastest, Math.abs(yaw - last) / 0.5);
    last = yaw;
    assert.deepEqual(middle, home.at, 'it turns around the busy view\'s middle');
    near = Math.min(near, distance / home.distance); far = Math.max(far, distance / home.distance);
    lost = Math.max(lost, slipped(core.camera, points, top + 0.01));
    if (s % 40 === 0) checkShadow(core);
    assert.equal(core.takeChanged(), false, `no shadow redraw while the view only turns (${s} s)`);
  }
  assert.ok(Math.abs(high - most) < 1e-3 && Math.abs(low + most) < 1e-3, `turned from ${low} to ${high}`);
  // At most 2π × 45° / 480 s: about 0.59° a second, at the middle of the swing.
  assert.ok(fastest <= 2 * Math.PI * most / SWAY.seconds * 1.001, `turned ${(fastest * 180 / Math.PI).toFixed(2)}° a second`);
  // Its ellipse keeps the island about the same size: a little closer or farther, never a big pull back.
  assert.ok(near > 0.85 && far < 1.15 && far - near > 0.01, `distance ${near.toFixed(3)} to ${far.toFixed(3)} times the busy view's`);
  // Edges may slip out near the ends of the swing, but nearly all of the island stays in view.
  assert.ok(lost <= 0.05, `${(lost * 100).toFixed(1)}% of the island's framing points slipped out`);
  // Facing north it shows exactly the busy view, whole.
  at(core, clock, SWAY.seconds);
  assert.ok(Math.abs(core.stage.look.distance - home.distance) < 1e-9 && Math.abs(core.stage.look.yaw) < 1e-9);
  assert.ok(inView(core.camera, points, top + 0.01), 'facing north the island is whole and below the band');
  // No pull back for the swing: every style frames the same.
  at(core, clock, SWAY.seconds * 1.25);
  core.cameraStyle = 'drift';
  assert.deepEqual(core.stage.target, home, 'the drift frames the same busy view');
  assert.equal(core.moving, true, 'and eases back to north');
  at(core, clock, clock.ms / 1000 + AIM_SECONDS * 3);
  assert.equal(core.stage.look.yaw, 0, 'facing north again');
  assert.equal(core.stage.look.distance, home.distance);
  core.cameraStyle = 'sway';
  assert.deepEqual(core.stage.target, home);
  core.dispose();
  // The sway never changes whether a town is framed whole or close, at any size.
  for (const name of SAMPLE_NAMES) for (const size of [[591, 357], [400, 300], [160, 100]]) {
    const pick = style => { const made = driftingCore({ style, name }); made.core.resize(...size); const close = made.core.aimed.close; made.core.dispose(); return close; };
    assert.equal(pick('sway'), pick('drift'), `${name} at ${size}`);
  }
});

test('the sway goes on through check-ins and trips; reduced motion shows the busy view facing north', () => {
  const { world, core, clock, route } = driftingCore({ style: 'sway' });
  assert.ok(route, 'with other islands the sway takes the drift\'s trips too');
  const top = 1 - 2 * CLEAR_TOP / 357;
  // At each rest it turns around that view's own middle, at the view's own zoom facing north, and what it
  // rests on stays nearly whole wherever the swing is. Shadows cover the view and only redraw on a trip.
  let lost = 0;
  for (const g of route.segments.filter(g => g.from === g.to)) {
    const list = g.from === route.home ? core.town.framePoints(core.aimed.island)
      : g.from === route.wide ? world.islands.flatMap(i => core.town.framePoints(i.id)) : null;
    at(core, clock, g.start + 0.25);
    core.takeChanged();
    for (let s = g.start + 0.5; s < g.start + g.seconds; s += 0.5) {
      at(core, clock, s);
      assert.equal(core.takeChanged(), false, `no shadow redraw while resting (${s} s)`);
      if (s % 5) continue;
      assert.deepEqual(core.stage.look.at, g.from.at, `the rest at ${g.start} s turns around its own middle`);
      if (list) lost = Math.max(lost, slipped(core.camera, list, top + 0.01));
      checkShadow(core);
    }
  }
  assert.ok(lost <= 0.08, `a rest lost ${(lost * 100).toFixed(1)}% of its view`);
  assert.equal(route.home.distance, core.stage.target.distance);
  const drifting = driftingCore();
  assert.deepEqual(drifting.route.segments.map(g => [g.from.distance, g.to.distance]), route.segments.map(g => [g.from.distance, g.to.distance]), 'every stop keeps the drift\'s zoom');
  drifting.core.dispose();
  // A check-in that keeps the same busy view: the drift starts again, the sway does not, nothing jumps.
  at(core, clock, SWAY.seconds / 4 + 3 * SWAY.seconds);
  const swaying = core.stage.swaySeconds;
  const yaw = core.stage.look.yaw;
  assert.ok(Math.abs(yaw) > 0.2, 'turned well away from north');
  const renamed = copy(world);
  renamed.helpers[0].name = 'Pippa';
  core.setWorld(renamed);
  assert.equal(core.stage.driftSeconds, 0, 'the drift starts again');
  assert.equal(core.stage.swaySeconds, swaying, 'the sway goes on');
  at(core, clock, clock.ms / 1000 + 0.5);
  assert.ok(Math.abs(core.stage.look.yaw - yaw) < 0.01, 'no snap back to north');
  // A still frame (reduced motion; the page never eases then, and settles any move): the busy view,
  // facing north.
  core.settle();
  core.update(clock.ms / 1000, true);
  assert.ok(samePlace(core.stage.look, core.stage.target, 1e-9));
  assert.equal(core.stage.look.yaw, 0);
  core.dispose();
});

test('the shadow box covers the view, moves only by whole shadow texels, and is never redrawn during a rest', () => {
  const { core, clock, route } = driftingCore();
  core.update(0);
  core.takeChanged();
  for (let s = 0.5; s < DRIFT.home; s += 0.5) {
    at(core, clock, s);
    assert.equal(core.takeChanged(), false, `no shadow redraw while resting (${s} s)`);
  }
  const check = () => checkShadow(core);
  check();
  let redraws = 0;
  for (let s = 0; s < route.period; s += 1 / 30) {
    at(core, clock, s);
    if (!core.takeChanged()) continue;
    redraws++;
    const g = restingAt(route, s);
    assert.notEqual(g.from, g.to, `a redraw during a rest at ${s.toFixed(2)} s`);
    check();
  }
  assert.ok(redraws > 0 && redraws <= route.period / 2, `${redraws} shadow redraws in a ${route.period.toFixed(0)} s round`);
  // A new mood turns the sun: the box is set again for it.
  core.setMood('break');
  check();
  core.dispose();
});

test('the busy view keeps a band clear across the top, and a resize keeps the drift\'s place', () => {
  const { world, core, clock } = driftingCore();
  const top = 1 - 2 * CLEAR_TOP / 357;
  const island = core.aimed.island;
  assert.ok(inView(core.camera, core.town.framePoints(island), top + 0.01), 'nothing framed reaches into the band');
  assert.ok(!inView(core.camera, core.town.framePoints(island), top - 0.08), 'and the town reaches up close to it');
  core.clearTop = 0;
  assert.ok(!inView(core.camera, core.town.framePoints(island), top + 0.01), 'with no band, the town frames higher');
  core.clearTop = CLEAR_TOP;
  at(core, clock, 100);
  const seconds = core.stage.driftSeconds;
  core.resize(600, 360);
  assert.equal(core.stage.driftSeconds, seconds, 'a resize keeps the drift\'s place');
  assert.equal(core.moving, false, 'and jumps');
  void world;
  core.dispose();
});

test('every island\'s pieces can be logged', () => {
  const log = new Map();
  const world = sampleTown('manyIslands');
  const { core } = clockedCore({ log });
  core.setWorld(world);
  for (const island of world.islands) assert.ok(log.get(island.id) instanceof Map, `${island.id} has a piece log`);
  for (const bridge of world.bridges) assert.ok(log.get(`bridge:${bridge.id}`) instanceof Map);
  core.dispose();
});

test('the gallery can tilt the camera; the scene keeps Today\'s angle', () => {
  const stage = createStage();
  const points = [[-2, 0, -2], [2, 0, -2], [-2, 0.5, 2], [2, 0.5, 2]];
  const angle = () => { const d = stage.camera.getWorldDirection(stage.camera.position.clone()); return Math.asin(-d.y); };
  stage.aim(points, 1.6);
  assert.ok(Math.abs(angle() - ELEVATION) < 1e-6);
  stage.aim(points, 1.6, { elevation: 1.3 });
  assert.ok(Math.abs(angle() - 1.3) < 1e-6);
  stage.frame(points, 1.6, [], { elevation: 0.4 });
  assert.ok(Math.abs(angle() - 0.4) < 1e-6);
  stage.frame(points, 1.6);
  assert.ok(Math.abs(angle() - ELEVATION) < 1e-6);
  stage.dispose();
});


test('a left inset frames the town beside the card and survives resize and sway', () => {
  const { core, clock } = clockedCore({ clearLeft: 376 });
  core.setWorld(sampleTown('manyIslands'));
  for (const [width, height] of [[1200, 650], [1920, 900]]) {
    core.resize(width, height);
    core.update(0, true);
    const leftEdge = -1 + 2 * 376 / width;
    for (const point of core.town.framePoints(core.aimed.island)) {
      const screen = new THREE.Vector3(...point).project(core.camera);
      assert.ok(screen.x >= leftEdge - 0.01 && screen.x <= 1.01, 'town fits beside the card');
    }
    clock.ms += 100000;
    core.update(clock.ms / 1000);
    assert.equal(core.camera.view.offsetX, -376, 'sway keeps the screen offset');
  }
  core.dispose();
});
