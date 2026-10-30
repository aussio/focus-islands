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
const { createSceneCore } = await import('../core.js');
const { createIslandScene } = await import('../index.js');
const { SAMPLE_WORLDS } = await import('../sample-worlds.js');
const { AIM_SECONDS, ELEVATION, createStage } = await import('../stage.js');

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
  assert.equal(isTownWorld({ islands: [{ id: 'home', origin: [0, 0], rows: ['g'] }] }), false, 'a square world is not a town');
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

test('town and square worlds take turns cleanly', () => {
  const { core } = clockedCore();
  core.setWorld(sampleTown('village'));
  assert.ok(core.town);
  core.setWorld(SAMPLE_WORLDS.grown.world);
  assert.equal(core.town, null, 'the town is gone');
  assert.equal(core.scene.getObjectByName('town'), undefined);
  core.setWorld(sampleTown('village'));
  assert.ok(core.town && core.scene.getObjectByName('town'));
  assert.equal(core.scene.getObjectByName('island'), undefined, 'the square island is gone');
  for (const world of [{}, { islands: [] }]) { core.setWorld(world); core.update(1); }
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

test('every island\'s pieces can be logged', () => {
  const log = new Map();
  const world = sampleTown('manyIslands');
  const { core } = clockedCore({ log });
  core.setWorld(world);
  for (const island of world.islands) assert.ok(log.get(island.id) instanceof Map, `${island.id} has a piece log`);
  for (const bridge of world.bridges) assert.ok(log.get(`bridge:${bridge.id}`) instanceof Map);
  core.dispose();
});

test('createIslandScene falls back quietly without WebGL for a town too', async () => {
  const host = element('div');
  const scene = createIslandScene(host);
  assert.equal(scene.setWorld(sampleTown('village')), false, 'without WebGL, no world is shown');
  assert.equal(await scene.capture(), null);
  assert.equal(scene.stats(), null);
  assert.ok(host.children.find(child => child.className === 'cozy-island-fallback'));
  scene.dispose();
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
