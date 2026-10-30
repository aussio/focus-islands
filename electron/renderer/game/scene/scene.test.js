// Builds the scene in Node (no GPU) with a fake canvas, in every mood, and drives the helpers for a while.
// Checks: no errors, no NaN positions, every kind in kinds.js draws, the coastline fix, and that
// createIslandScene falls back quietly when WebGL is missing.
import test from 'node:test';
import assert from 'node:assert/strict';

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

const { KINDS } = await import('../kinds.js');
const { createSceneCore } = await import('./core.js');
const { createIslandScene } = await import('./index.js');
const { outlineLoops } = await import('./ground.js');
const { MODELS } = await import('./models/index.js');
const { SAMPLE_WORLDS, everyKindWorld, kindWorld, poseWorld } = await import('./sample-worlds.js');

const MOODS = ['focus', 'break', 'away', 'done'];
const originalError = console.error;

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

function driveAll(core, seconds = 45, step = 0.37) {
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

test('sample worlds build and helpers move in every mood', () => {
  const watch = watchErrors();
  try {
    for (const [name, { world }] of Object.entries(SAMPLE_WORLDS)) {
      const core = createSceneCore();
      assert.equal(core.setWorld(world), true);
      assert.equal(core.setWorld(JSON.parse(JSON.stringify(world))), false, 'an identical world must not rebuild');
      for (const mood of MOODS) {
        core.setMood(mood);
        assert.ok(finiteGeometry(core.scene) > 3, `${name} ${mood} drew almost nothing`);
        assert.equal(core.actors.plans.length, world.helpers.length);
        driveAll(core);
      }
      core.dispose();
    }
  } finally { watch.stop(); }
  assert.deepEqual(watch.errors, []);
});

test('focus helpers work at their job spots; break and done helpers rest', () => {
  const core = createSceneCore();
  core.setWorld(SAMPLE_WORLDS.grown.world);
  core.setMood('focus');
  const jobs = Object.fromEntries(core.actors.plans.map((plan, i) => [SAMPLE_WORLDS.grown.world.helpers[i].job ?? 'none', plan]));
  assert.equal(jobs.wood.job, 'wood');
  assert.match(jobs.wood.target, /^tree-/);
  assert.match(jobs.stone.target, /^rock-/);
  assert.equal(jobs.planks.target, 'sawmill-1');
  assert.equal(jobs.soil.target, 'garden-1');
  assert.equal(jobs.saplings.target, 'nursery-1');
  assert.ok(['sit', 'nap'].includes(jobs.none.rest), 'a helper with no job rests by the old tree');
  const anims = new Set(jobs.wood.line.segments.map(s => s.anim));
  for (const anim of ['chop', 'pickup', 'walk', 'drop']) assert.ok(anims.has(anim), `the wood routine is missing ${anim}`);
  core.setMood('break');
  const rests = new Set(core.actors.plans.map(plan => plan.rest));
  for (const rest of ['sit', 'fish', 'nap', 'stroll']) assert.ok(rests.has(rest), `break should include ${rest}`);
  core.setMood('away');
  assert.ok(core.actors.plans.every(plan => ['sit', 'nap'].includes(plan.rest)), 'away is quieter: only sitting and napping');
  core.setMood('done');
  assert.ok(core.actors.plans.every(plan => plan.rest === 'sleep'), 'everyone sleeps when the day is done');
  // Helpers cross the bridge to work on the second island and carry home.
  core.setWorld(SAMPLE_WORLDS.two.world);
  core.setMood('focus');
  assert.equal(core.actors.plans[1].target, 'rock-1');
  core.dispose();
});

test('a world with every kind in kinds.js draws, and kinds without a model use the placeholder', () => {
  const watch = watchErrors();
  try {
    const world = everyKindWorld();
    assert.deepEqual(new Set(world.things.map(t => t.kind)), new Set(Object.keys(KINDS)));
    const core = createSceneCore();
    core.setWorld(world);
    for (const mood of MOODS) { core.setMood(mood); driveAll(core, 20, 0.5); }
    assert.equal(core.model.things.length, Object.keys(KINDS).length);
    for (const thing of core.model.things) assert.ok(thing.top > 0.05, `${thing.kind} drew nothing above the ground`);
    finiteGeometry(core.scene);
    core.dispose();
    // A kind nobody has heard of still draws (as a placeholder).
    const odd = kindWorld('tree');
    odd.things[0].kind = 'mystery';
    const core2 = createSceneCore();
    core2.setWorld(odd);
    assert.ok(core2.model.things[0].top > 0.2);
    core2.dispose();
  } finally { watch.stop(); }
  assert.deepEqual(watch.errors, []);
  for (const kind of ['tree', 'rock', 'bush', 'flower', 'pile', 'fire', 'seat', 'mushroom', 'crystal', 'cottage']) assert.ok(MODELS[kind], `${kind} needs a real model`);
});

test('fixed gallery poses and odd worlds do not break the scene', () => {
  const core = createSceneCore();
  for (const pose of [{ anim: 'chop', tool: 'axe', prop: 'tree' }, { anim: 'walk', carry: 'sack' }, { anim: 'sit', prop: 'seat', seat: 0.11 }, { anim: 'fish' }, { anim: 'sleep' }]) {
    core.setWorld(poseWorld(pose));
    driveAll(core, 2, 0.5);
    assert.equal(core.actors.rigs[0].anim, pose.anim);
  }
  // Empty, missing and broken parts.
  for (const world of [{}, { islands: [] }, { islands: [{ id: 'a', origin: [0, 0], rows: ['g'] }], things: [{ id: 'x', kind: 'cottage', c: 5, r: 5 }], bridges: [{ from: [0, 0], to: [3, 3] }], helpers: [{ id: 'h', job: 'wood', island: 'zzz' }] }]) {
    core.setWorld(world);
    for (const mood of MOODS) { core.setMood(mood); driveAll(core, 3, 0.5); }
  }
  core.dispose();
});

test('diagonal coasts come out as one straight line', () => {
  // A 45-degree staircase: land below the diagonal.
  const cells = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c <= r; c++) cells.push({ c, r });
  const isLand = (c, r) => r >= 0 && r < 8 && c >= 0 && c <= r;
  const [loop] = outlineLoops(cells, isLand, { convex: 0.5, concave: 0.3, wobble: 0, spacing: 0.3 });
  // Points along the middle of the diagonal must lie on one line x - y = constant (no steps).
  const diagonal = loop.filter(([x, y]) => x > 1.5 && x < 5.5 && Math.abs((x - y) - Math.round(x - y)) < 0.6 && y < x);
  assert.ok(diagonal.length > 5, 'expected points along the diagonal');
  const offsets = diagonal.map(([x, y]) => x - y);
  assert.ok(Math.max(...offsets) - Math.min(...offsets) < 1e-6, `diagonal is stair-stepped: ${offsets.map(o => o.toFixed(2)).join(',')}`);
});

test('createIslandScene falls back quietly without WebGL', async () => {
  const host = element('div');
  const scene = createIslandScene(host);
  scene.setWorld(SAMPLE_WORLDS.tiny.world);
  scene.setMood('break');
  assert.equal(await scene.capture(), null);
  const fallback = host.children.find(child => child.className === 'cozy-island-fallback');
  assert.ok(fallback, 'a soft sky background stands in for the scene');
  assert.match(fallback.style.background, /gradient/);
  assert.equal(fallback.attributes['aria-hidden'], 'true');
  scene.dispose();
  scene.setWorld(SAMPLE_WORLDS.grown.world); // after dispose: ignored, no throw
});
