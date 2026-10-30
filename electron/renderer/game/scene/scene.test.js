// The scene in Node (Three.js, no WebGL, a fake page), on town worlds: real states from the rules laid out
// by buildTown, and the sample towns. Checks: no errors, no NaN positions, helpers work or rest by mood,
// every kind in kinds.js has a model, odd worlds draw as an empty sky without throwing, dispose cleans up,
// and the scene and the page glue fall back quietly without WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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

const require = createRequire(import.meta.url);
const sim = require('../../../core/game/simulate.js');
const { KINDS } = await import('../kinds.js');
const { buildTown } = await import('../town/index.js');
const { SAMPLE_NAMES, sampleTown } = await import('../town/samples.js');
const { createSceneCore } = await import('./core.js');
const { createIslandScene } = await import('./index.js');
const { MODELS, hasModel, modelFor, placeholder } = await import('./models/index.js');

const MOODS = ['focus', 'break', 'away', 'done'];
const originalError = console.error;
// Real game states for the steady planner: a week and a month in (Today's game-week and game-month).
const STATES = sim.simulate('steady', [7, 30]);

function finiteGeometry(scene) {
  let meshes = 0;
  scene.traverse(node => {
    const position = node.geometry?.attributes?.position;
    if (!position) return;
    meshes++;
    for (let i = 0; i < position.array.length; i++) assert.ok(Number.isFinite(position.array[i]), `${node.name || node.type} has a bad vertex`);
  });
  return meshes;
}

function driveAll(core, seconds = 30, step = 0.37) {
  for (let t = 0; t < seconds; t += step) {
    core.update(t);
    for (const rig of core.actors.rigs) {
      const p = rig.root.position;
      assert.ok(Number.isFinite(p.x + p.y + p.z), `helper position is not a number at t=${t}`);
      assert.ok(Number.isFinite(rig.root.rotation.y), 'helper turn is not a number');
    }
  }
  core.update(0, true); // the still frame for reduced motion
}

// Records console.error calls so a model failing inside the builder still fails the test.
function watchErrors() {
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  return { errors, stop: () => { console.error = originalError; } };
}

const ms = since => `${(performance.now() - since).toFixed(0)} ms`;

test('real states from the rules lay out and draw, and helpers move, in every mood', t => {
  const watch = watchErrors();
  try {
    for (const [day, state] of Object.entries(STATES)) {
      let started = performance.now();
      const world = buildTown(state);
      const laidOut = ms(started);
      const core = createSceneCore();
      started = performance.now();
      assert.equal(core.setWorld(world), true);
      t.diagnostic(`day ${day}: ${world.islands.length} islands, ${world.things.length} things; buildTown ${laidOut}, setWorld ${ms(started)}, ${core.stats().triangles} triangles`);
      assert.equal(core.setWorld(buildTown(state)), false, 'the same state must not rebuild');
      assert.equal(core.town.islands.size, world.islands.length);
      assert.equal(core.actors.rigs.length, world.helpers.length);
      for (const mood of MOODS) {
        core.setMood(mood);
        assert.ok(finiteGeometry(core.scene) > 3, `day ${day} ${mood} drew almost nothing`);
        assert.equal(core.actors.plans.length, world.helpers.length);
        driveAll(core);
      }
      core.dispose();
    }
  } finally { watch.stop(); }
  assert.deepEqual(watch.errors, []);
});

test('focus helpers work at their job spots; break, away and done helpers rest', () => {
  const world = sampleTown('village');
  const jobs = ['wood', 'stone', 'planks', 'soil', 'saplings', null];
  world.helpers = jobs.map((job, i) => ({ id: `h${i}`, name: `H${i}`, job, island: 'home' }));
  const core = createSceneCore();
  core.setWorld(world);
  core.setMood('focus');
  const plans = Object.fromEntries(core.actors.plans.map((plan, i) => [jobs[i] ?? 'none', plan]));
  const kindOf = id => world.things.find(thing => thing.id === id)?.kind;
  assert.equal(plans.wood.job, 'wood');
  assert.equal(kindOf(plans.wood.target), 'tree');
  assert.ok(['rock', 'quarry'].includes(kindOf(plans.stone.target)));
  assert.equal(kindOf(plans.planks.target), 'sawmill');
  assert.equal(kindOf(plans.soil.target), 'garden');
  assert.equal(kindOf(plans.saplings.target), 'nursery');
  assert.ok(['sit', 'nap'].includes(plans.none.rest), 'a helper with no job rests by the first tree');
  const anims = new Set(plans.wood.line.segments.map(s => s.anim));
  for (const anim of ['chop', 'pickup', 'walk', 'drop']) assert.ok(anims.has(anim), `the wood routine is missing ${anim}`);
  core.setMood('break');
  const rests = new Set(core.actors.plans.map(plan => plan.rest));
  for (const rest of ['sit', 'fish', 'nap', 'stroll']) assert.ok(rests.has(rest), `break should include ${rest}`);
  core.setMood('away');
  assert.ok(core.actors.plans.every(plan => ['sit', 'nap'].includes(plan.rest)), 'away is quieter: only sitting and napping');
  core.setMood('done');
  assert.ok(core.actors.plans.every(plan => plan.rest === 'sleep'), 'everyone sleeps when the day is done');
  core.dispose();
});

test('moods change the sky and the helpers, never the town', () => {
  const core = createSceneCore();
  core.setWorld(sampleTown('manyIslands'));
  const built = new Map(core.town.islands);
  const report = core.lastReport;
  let sky = core.scene.background;
  for (const mood of ['break', 'away', 'done', 'focus']) {
    assert.equal(core.setMood(mood), true);
    assert.equal(core.setMood(mood), false, 'the same mood again changes nothing');
    assert.notEqual(core.scene.background, sky, `${mood} has its own sky`);
    sky = core.scene.background;
    assert.equal(core.lastReport, report, 'a mood never rebuilds');
    for (const [id, island] of core.town.islands) assert.equal(island, built.get(id));
  }
  // An unknown mood reads as focus.
  core.setMood('nonsense');
  assert.equal(core.mood, 'focus');
  core.dispose();
});

test('every kind in kinds.js has a real model; an unknown kind draws as the placeholder', () => {
  for (const kind of Object.keys(KINDS)) assert.ok(hasModel(kind), `${kind} needs a real model`);
  for (const kind of Object.keys(MODELS)) assert.ok(KINDS[kind], `${kind} has a model but no kind`);
  assert.equal(modelFor('mystery'), placeholder);
  const watch = watchErrors();
  try {
    const world = sampleTown('village');
    const odd = world.things.find(thing => thing.pad);
    odd.kind = 'mystery';
    const core = createSceneCore();
    core.setWorld(world);
    for (const mood of MOODS) { core.setMood(mood); driveAll(core, 4, 0.5); }
    finiteGeometry(core.scene);
    core.dispose();
  } finally { watch.stop(); }
  assert.deepEqual(watch.errors, []);
});

test('gallery poses and odd worlds do not break the scene', () => {
  const core = createSceneCore();
  const world = sampleTown('village');
  for (const pose of [{ anim: 'chop', tool: 'axe' }, { anim: 'walk', carry: 'sack' }, { anim: 'sit', seat: 0.11 }, { anim: 'fish' }, { anim: 'sleep' }]) {
    core.setWorld({ ...world, helpers: [{ id: 'posed', name: 'Posed', job: null, island: 'home', debugPose: pose }] });
    driveAll(core, 2, 0.5);
    assert.equal(core.actors.rigs[0].anim, pose.anim);
  }
  // A walk across bridges, there and back.
  const many = sampleTown('manyIslands');
  const far = many.islands[1];
  core.setWorld({ ...many, helpers: [{ id: 'walker', name: 'W', job: null, island: 'home', debugPose: { walk: { from: { island: 'home', point: many.islands[0].lanes[0] }, to: { island: far.id, point: far.lanes[0] } } } }] });
  assert.equal(core.actors.plans[0].rest, 'walk');
  driveAll(core, 20, 0.5);

  // Anything that isn't a town world draws as an empty sky: no islands, no helpers, no throw.
  const circular = sampleTown('firstDay');
  circular.self = circular;
  const odd = [
    null, undefined, 42, 'island', {}, { islands: [] }, { islands: 'nope' },
    { islands: [{ id: 'a', origin: [0, 0], rows: ['g'] }], things: [{ id: 'x', kind: 'tree', c: 5, r: 5 }], bridges: [{ from: [0, 0], to: [3, 3] }], helpers: [{ id: 'h', job: 'wood', island: 'zzz' }] },
  ];
  for (const bad of odd) {
    assert.doesNotThrow(() => core.setWorld(bad));
    assert.equal(core.model.islands.length, 0);
    assert.equal(core.town.islands.size, 0);
    assert.equal(core.actors.rigs.length, 0);
    assert.equal(core.hasWorld, true, 'the empty sky still draws');
    for (const mood of MOODS) { core.setMood(mood); driveAll(core, 2, 0.5); }
    assert.ok(core.camera.position.toArray().every(Number.isFinite));
  }
  // A town with broken parts keeps what it can.
  const broken = sampleTown('firstDay');
  broken.things = [...broken.things, { id: 'lost', kind: 'tree', island: 'nowhere', points: [1] }, { id: 'off', kind: 'rock', island: 'home', points: [-4, 1e9] }];
  broken.bridges = [{ id: 'half', type: 'rope', from: { island: 'home', point: 0 }, to: null }];
  broken.helpers = [...broken.helpers, null, { id: 'stray', job: 'wood', island: 'zzz' }];
  broken.view = { island: 'gone', points: ['x'] };
  for (const bad of [broken, circular]) {
    assert.doesNotThrow(() => core.setWorld(bad));
    assert.equal(core.town.islands.size, 1);
    for (const mood of MOODS) { core.setMood(mood); driveAll(core, 2, 0.5); }
  }
  // And back to a whole town.
  assert.equal(core.setWorld(world), true);
  assert.equal(core.town.islands.size, world.islands.length);
  core.dispose();
});

test('dispose takes everything out of the scene and frees what it built', () => {
  const core = createSceneCore();
  core.setWorld(sampleTown('manyIslands'));
  core.setMood('break');
  driveAll(core, 2, 0.5);
  const freed = new Set();
  const geometries = new Set();
  core.town.root.traverse(node => { if (node.isMesh) geometries.add(node.geometry); });
  assert.ok(geometries.size > 10);
  for (const geometry of geometries) geometry.addEventListener('dispose', () => freed.add(geometry));
  core.dispose();
  assert.equal(freed.size, geometries.size, 'every island and bridge mesh is freed');
  assert.equal(core.scene.getObjectByName('town'), undefined);
  assert.equal(core.scene.getObjectByName('helpers'), undefined);
  assert.equal(core.town, null);
});

test('createIslandScene falls back quietly without WebGL', async () => {
  const host = element('div');
  const scene = createIslandScene(host);
  assert.equal(scene.setWorld(sampleTown('village')), false, 'without WebGL, no world is shown');
  scene.setMood('break');
  assert.equal(await scene.capture(), null);
  assert.equal(scene.stats(), null);
  const fallback = host.children.find(child => child.className === 'cozy-island-fallback');
  assert.ok(fallback, 'a soft sky background stands in for the scene');
  assert.match(fallback.style.background, /gradient/);
  assert.equal(fallback.attributes['aria-hidden'], 'true');
  scene.dispose();
  assert.equal(scene.setWorld(sampleTown('village')), false, 'after dispose: ignored, no throw');
  scene.setMood('done');
});

test('the page glue lays out the town and never throws into the page', async () => {
  globalThis.window ??= globalThis;
  await import('../index.js');
  const glue = globalThis.window.cozyGame;
  const host = element('div');
  host.ownerDocument = globalThis.document;
  const watch = watchErrors();
  try {
    glue.mount(host);
    assert.equal(host.children.length, 0, 'the slot keeps its plain sky until there is a game');
    glue.show({ game: STATES[30], mood: 'focus', profile: 'testing' });
    const stage = host.children.find(child => child.className === 'cozy-island-stage');
    assert.ok(stage, 'the scene gets its own box');
    assert.equal(stage.attributes['aria-hidden'], 'true');
    for (const game of [STATES[7], null, {}, { islands: 'x' }, { islands: [null, { id: 7 }] }, { change: 3, islands: [{ id: 'home', land: 'lots', buildings: [null] }] }]) {
      assert.doesNotThrow(() => glue.show({ game, mood: 'break', profile: 'testing' }));
    }
    glue.show({ game: STATES[30], mood: 'done', profile: 'testing' });
    assert.equal(await glue.capture(), false, 'without WebGL nothing is drawn');
    glue.mount(null);
    glue.show();
  } finally { watch.stop(); }
});
