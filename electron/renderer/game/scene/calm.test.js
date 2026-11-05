// Who may move now (calm.js), checked on its own and with the real cat, farm animals and bird:
// - each loop on an island belongs to at most one kind, some to nobody, the first after the clock
//   starts to nobody, and the pattern differs between islands and does not repeat like clockwork;
// - a turn starts only near the start of its own loop, ends with it, and is held in quiet moods, at
//   time 0, while another moving visitor is in the live world, and while its animal is not ready;
// - the cat, the farm animals and a visiting bird on one island never move in the same frame, and the
//   bird's visit does not keep the others still;
// - the bird flies only in break, on a few of its turns, and only looks aside in focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({ tagName: tag, style: {}, children: [], setAttribute() {}, getContext: type => (type === '2d' ? ctx2d : null), addEventListener() {}, removeEventListener() {} });
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { LOOP, TURNS, loopOwner, createTurn, isQuietMood, visitorMoving } = await import('./calm.js');
const { createMaterials, MOODS, TOWN } = await import('./style.js');
const { makeModelContext, makeBlobMaterial, buildTownIsland } = await import('./town/build.js');
const { parseTown } = await import('./town/world.js');
const { place } = await import('./ground.js');
const { farmyard } = await import('./models/farm.js');
const { createResidents } = await import('./residents/index.js');
const { buildTown } = await import('../town/index.js');
const { buildVisitors } = await import('./town/visitors.js');

const STATES = new URL('../../../../development-tools/game-gallery/states/town/', import.meta.url);
const state = name => JSON.parse(readFileSync(new URL(`${name}.json`, STATES)));
const shared = () => ({ materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) });

test('loops are shared out by island: one kind at most, some for nobody, never like clockwork', () => {
  const islands = ['home', 'isle-1', 'isle-2', 'isle-3'];
  const runs = islands.map(island => Array.from({ length: 4000 }, (_, n) => loopOwner(island, n)));
  for (const [i, owners] of runs.entries()) {
    assert.equal(owners[0], null, 'the first loop after the clock starts belongs to nobody');
    const count = kind => owners.slice(1).filter(o => o === kind).length / (owners.length - 1);
    for (const [kind, share] of Object.entries(TURNS)) assert.ok(Math.abs(count(kind) - share) < 0.04, `${islands[i]} ${kind}: ${count(kind)}`);
    assert.ok(count(null) > 0.05, `${islands[i]}: some loops are still`);
    assert.deepEqual(owners, Array.from({ length: 4000 }, (_, n) => loopOwner(islands[i], n)), 'the same every time');
    // No short repeating pattern.
    for (let period = 1; period <= 16; period++) assert.ok(owners.slice(1, 200).some((o, n) => o !== owners[n + 1 + period]), `${islands[i]}: not a ${period}-loop pattern`);
  }
  for (let i = 1; i < runs.length; i++) assert.notDeepEqual(runs[i].slice(1, 50), runs[0].slice(1, 50), 'each island has its own rhythm');
  assert.equal(loopOwner('home', -3), null);
  assert.deepEqual(['focus', 'break', 'done', 'away'].map(m => isQuietMood(m)), [false, false, true, true]);
  assert.equal(isQuietMood('focus', true), true, 'reduced motion is quiet too');
});

test('a turn starts only near the start of its own loop, ends with it, and is held by quiet, stillness, visitors and readiness', () => {
  const own = kind => { for (let n = 1; ; n++) if (loopOwner('home', n) === kind && loopOwner('home', n + 1) !== kind) return n * LOOP; };
  const base = own('cat'), other = (() => { for (let n = 1; ; n++) if (loopOwner('home', n) !== 'cat') return n * LOOP; })();
  let world = { islands: [{ id: 'home', visitor: null }] };
  const turn = createTurn('cat', 'home', { model: () => world, settle: 2 });
  assert.equal(turn.step(other + 0.5), null, 'not its loop');
  assert.equal(turn.step(base + 3), null, 'too late in its loop to start');
  turn.step(0.5);
  assert.ok(Math.abs(turn.step(base + 1) - 1) < 1e-9, 'its loop: seconds into the turn');
  assert.ok(Math.abs(turn.step(base + 30) - 30) < 1e-9);
  assert.equal(turn.weight, 1);
  assert.equal(turn.step(base + LOOP + 0.1), null, 'ends with its loop');
  turn.step(base + LOOP + 0.3);
  assert.ok(turn.weight > 0 && turn.weight < 1, 'and settles over a couple of seconds');
  for (const [name, options] of [['done', { mood: 'done' }], ['away', { mood: 'away' }], ['reduced motion', { still: true }], ['not ready', { ready: false }]]) {
    turn.step(0.2);
    assert.equal(turn.step(base + 0.5, options), null, `${name}: no turn`);
  }
  turn.step(0.2);
  assert.ok(Math.abs(turn.step(base + 0.5) - 0.5) < 1e-9);
  assert.equal(turn.step(0), null, 'time 0 (reduced motion) ends it at once');
  assert.equal(turn.weight, 0);
  // The live world: a moving visitor arriving anywhere holds it; a still one or the bird does not.
  world = { islands: [{ id: 'home', visitor: null }, { id: 'b', visitor: 'balloon' }] };
  assert.equal(visitorMoving(world), true);
  turn.step(0.2);
  assert.equal(turn.step(base + 0.5), null, 'a moving visitor holds it');
  world = { islands: [{ id: 'home', visitor: 'rainbow' }] };
  assert.ok(Math.abs(turn.step(base + 0.6) - 0.6) < 1e-9, 'a still visitor does not');
  world = { islands: [{ id: 'home', visitor: 'fireflies' }] };
  assert.equal(turn.step(base + 0.7), null, 'a mood change or new world mid-turn: held at once');
  world = { islands: [{ id: 'home', visitor: 'bird' }] };
  assert.equal(visitorMoving(world), false, 'the bird takes turns instead');
  turn.step(0.2);
  assert.ok(Math.abs(turn.step(base + 0.5) - 0.5) < 1e-9, 'a bird visit does not hold the cat');
  const birdBase = own('bird'), bird = createTurn('bird', 'home', { model: () => world });
  bird.step(0.1);
  assert.ok(Math.abs(bird.step(birdBase + 0.5) - 0.5) < 1e-9, 'nor the bird itself');
  // The scene clock starting again (a mood change) ends a turn.
  assert.equal(bird.step(0.4), null);
});

test('the cat, the farm animals and a visiting bird on one island never move in the same frame', () => {
  const s = shared();
  const model = parseTown(buildTown({ ...state('steady-day-7'), visitor: { kind: 'bird', island: 'home' }, residents: [{ id: 'cat', kind: 'cat', island: 'home', appearanceSeed: 1, arrivedAtCheckIn: 1 }] }));
  const made = makeModelContext({ ...s, model, island: model.byId.get('home') });
  farmyard(made.ctx, { id: 'farm', yaw: 0.4, extension: true }, place(0, TOWN.padRise, 0, { ry: 0.4 }));
  const visitor = buildVisitors(made.ctx, model.byId.get('home'));
  made.finish();
  const residents = createResidents(new THREE.Scene());
  residents.setWorld(model);
  const cat = residents.rigs[0].figure.root;
  const farm = made.ctx.root.children.filter(c => c.name.startsWith('farm-'));
  const bird = visitor.getObjectByName('visiting-bird');
  assert.ok(bird, 'the bird is drawn');
  const snapshot = () => {
    made.ctx.root.updateMatrixWorld(true); cat.updateMatrixWorld(true);
    const text = node => { const out = []; node.traverse(n => { if (n.isMesh) out.push(n.matrixWorld.elements.map(v => v.toFixed(5)).join()); }); return out.join(';'); };
    return { cat: text(cat), farm: farm.map(text).join('|'), bird: text(bird) };
  };
  try {
    for (const mood of ['focus', 'break']) {
      made.moodHooks.forEach(fn => fn(mood, MOODS[mood]));
      residents.setMood(mood);
      let before = null, catMoved = 0, farmMoved = 0, birdMoved = 0;
      for (let t = 0.1; t < 20 * LOOP; t += 0.25) {
        made.dynamic.forEach(fn => fn(t));
        residents.update(t);
        const now = snapshot();
        if (before) {
          const c = now.cat !== before.cat, f = now.farm !== before.farm, b = now.bird !== before.bird;
          assert.ok(c + f + b <= 1, `${mood}: two move at ${t.toFixed(2)} s (cat ${c}, farm ${f}, bird ${b})`);
          catMoved += c; farmMoved += f; birdMoved += b;
        }
        before = now;
      }
      assert.ok(catMoved > 0 && farmMoved > 0 && birdMoved > 0, `${mood}: each does move, the bird's visit stops nobody (${catMoved}, ${farmMoved}, ${birdMoved})`);
      assert.ok(catMoved * 0.25 < 0.35 * 20 * LOOP && farmMoved * 0.25 < 0.35 * 20 * LOOP, `${mood}: still most of the time`);
    }
  } finally {
    residents.dispose(); made.disposables.forEach(x => x?.dispose?.());
    Object.values(s.materials).forEach(m => m.dispose()); s.blobMaterial.dispose(); s.blobPlane.dispose();
  }
});

test('the bird flies only in break, on a few of its turns; in focus it only looks aside', () => {
  const s = shared();
  const model = parseTown(buildTown({ ...state('steady-day-60'), visitor: { kind: 'bird', island: 'home' } }));
  const built = buildTownIsland(model.byId.get('home'), model, s);
  try {
    const bird = built.group.getObjectByName('visiting-bird');
    const perch = bird.position.clone();
    const head = () => bird.children.find(c => c.isGroup && c.children.length >= 3)?.rotation.y ?? 0;
    for (const mood of ['focus', 'break', 'done', 'away']) {
      built.moodHooks.forEach(fn => fn(mood, MOODS[mood]));
      let flights = 0, flying = false, looked = false;
      // Ten minutes of one mood, as one visit's break might be.
      for (let t = 0.1; t < 600; t += 0.25) {
        built.dynamic.forEach(fn => fn(t));
        const up = bird.position.distanceTo(perch) > 1e-6;
        if (up && !flying) flights++;
        flying = up;
        if (Math.abs(head()) > 1e-6) looked = true;
      }
      if (mood === 'break') assert.ok(flights >= 1 && flights <= 5, `break: a few flights (${flights})`);
      else assert.equal(flights, 0, `${mood}: stays perched`);
      if (mood === 'focus') assert.ok(looked, 'focus: it looks aside now and then');
      if (mood === 'done' || mood === 'away') assert.ok(!looked, `${mood}: still`);
    }
  } finally {
    built.dispose();
    Object.values(s.materials).forEach(m => m.dispose()); s.blobMaterial.dispose(); s.blobPlane.dispose();
  }
});
