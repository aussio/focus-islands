// Stream D's checks: helpers' walking over islands and bridges (walk.js), the bridges' shape and size
// (bridges.js), and the pads and models on an island (pads.js). In Node, with Three.js and no WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';

// A fake page, as in scene.test.js, so canvas textures can be made in Node.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop() {} })), set: () => true });
const element = tag => ({
  tagName: tag, width: 0, height: 0, style: {}, getContext: type => (type === '2d' ? ctx2d : null),
  addEventListener() {}, removeEventListener() {},
});
globalThis.document ??= { createElement: element, createElementNS: (_, tag) => element(tag), hidden: false, addEventListener() {}, removeEventListener() {} };

const THREE = await import('three');
const { SAMPLE_NAMES, sampleTown } = await import('../../town/samples.js');
const { deckLine } = await import('../../town/sky.js');
const { BRIDGE_TYPES, KINDS } = await import('../../kinds.js');
const { createMaterials } = await import('../style.js');
const { parseTown } = await import('./world.js');
const { makeModelContext, makeBlobMaterial } = await import('./build.js');
const { buildBridge, bridgeWays, deckPath, MAX_TRIANGLES } = await import('./bridges.js');
const { buildThings } = await import('./pads.js');
const { planHelpers, walkGraph, routeLegs } = await import('./walk.js');

const MOODS = ['focus', 'break', 'away', 'done'];
const many = () => parseTown(sampleTown('manyIslands'));
const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

// A route from one island's plaza to another's, as legs.
function plazaRoute(model, from, to) {
  const G = walkGraph(model);
  const a = model.byId.get(from), b = model.byId.get(to);
  const na = G.node(a, a.plaza), nb = G.node(b, b.plaza);
  return routeLegs(G, na, nb, G.at(na), G.at(nb));
}
// The same model with only some bridges, or with one bridge changed.
const withBridges = (model, bridges) => ({ ...model, bridges });

test('every sample plans every helper, in every mood, with finite steps at the right heights', () => {
  for (const name of SAMPLE_NAMES) {
    const model = parseTown(sampleTown(name));
    const lifts = model.islands.map(i => i.lift ?? 0);
    const low = Math.min(...lifts) - 0.6, high = Math.max(...lifts) + 0.9;
    for (const mood of MOODS) {
      const plans = planHelpers(model, mood);
      assert.equal(plans.length, model.helpers.length, `${name} ${mood}: one plan per helper`);
      for (const [i, plan] of plans.entries()) {
        assert.ok(plan.job || plan.rest, `${name} ${mood} helper ${i}: a job or a rest`);
        for (const s of plan.line.segments) {
          for (const v of [...s.from, ...s.to, s.yFrom, s.yTo, s.duration, s.yawTo]) assert.ok(Number.isFinite(v), `${name} ${mood} helper ${i}: finite ${s.anim}`);
          assert.ok(s.yTo >= low && s.yTo <= high, `${name} ${mood} helper ${i}: height ${s.yTo} near the islands`);
          // Only walking moves a helper; standing steps never jump.
          if (!s.walk) assert.ok(Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) < 0.05, `${name} ${mood} helper ${i}: no jump at ${s.anim}`);
        }
      }
      if (mood === 'done') assert.ok(plans.every(p => p.rest === 'sleep'), `${name}: everyone sleeps when the day is done`);
      if (mood === 'away') assert.ok(plans.every(p => ['sit', 'nap'].includes(p.rest)), `${name}: away is quiet`);
    }
  }
});

test('the same model always gives the same plans', () => {
  for (const name of SAMPLE_NAMES) {
    for (const mood of MOODS) {
      const a = planHelpers(parseTown(sampleTown(name)), mood);
      const b = planHelpers(parseTown(sampleTown(name)), mood);
      assert.deepEqual(a, b, `${name} ${mood}`);
    }
  }
});

test('every island reaches every other, both ways, across bridges', () => {
  const model = many();
  assert.ok(model.islands.length >= 4 && model.bridges.length >= model.islands.length, 'several islands, with a loop');
  for (const a of model.islands) for (const b of model.islands) {
    const legs = plazaRoute(model, a.id, b.id);
    assert.ok(legs, `${a.id} reaches ${b.id}`);
    const first = legs[0].points?.[0], last = legs[legs.length - 1].points?.at(-1);
    assert.ok(near(first, [a.at[0] + a.grid.points[a.plaza][0], a.lift, a.at[1] + a.grid.points[a.plaza][1]]), `${a.id} -> ${b.id} starts at the plaza`);
    assert.ok(near(last, [b.at[0] + b.grid.points[b.plaza][0], b.lift, b.at[1] + b.grid.points[b.plaza][1]]), `${a.id} -> ${b.id} ends at the plaza`);
    // Each leg starts where the one before ended.
    let at = first;
    for (const leg of legs) {
      const start = leg.points ? leg.points[0] : leg.at;
      assert.ok(Math.hypot(start[0] - at[0], start[2] - at[2]) < 0.05 && Math.abs(start[1] - at[1]) < 0.05, `${a.id} -> ${b.id}: ${leg.move} joins on`);
      at = leg.points ? leg.points.at(-1) : leg.at;
    }
  }
});

test('a loop: with any one bridge gone, every island is still reached', () => {
  const model = many();
  for (const gone of model.bridges) {
    const fewer = withBridges(model, model.bridges.filter(b => b !== gone));
    for (const isle of model.islands) assert.ok(plazaRoute(fewer, model.islands[0].id, isle.id), `without ${gone.id}, home reaches ${isle.id}`);
  }
});

test('the water slide: slide down, climb the stair up, at half and one and a half times the length', () => {
  const model = many();
  const slide = model.bridges.find(b => b.type === 'slide');
  assert.ok(slide, 'the sample has a water slide');
  const top = model.byId.get(slide.from.island), bottom = model.byId.get(slide.to.island);
  assert.ok(top.lift > bottom.lift, 'it runs from the higher island down');
  const only = withBridges(model, [slide]);
  const down = plazaRoute(only, top.id, bottom.id).map(l => l.move);
  const sliding = ['sitdown', 'slide', 'splash', 'standup'];
  const from = down.indexOf('sitdown');
  assert.ok(from >= 0, 'down: sits down at the top');
  assert.deepEqual(down.slice(from, from + 4), sliding, 'down: sit, slide, splash, stand up');
  const up = plazaRoute(only, bottom.id, top.id).map(l => l.move);
  assert.ok(up.includes('climb') && !up.includes('slide'), 'up: climbs the stair');
  const ways = bridgeWays(slide, model);
  assert.ok(Math.abs(ways.forward.cost - ways.length * 0.5) < 1e-6, 'sliding costs half the length');
  assert.ok(Math.abs(ways.back.cost - ways.length * 1.5) < 1e-6, 'climbing costs one and a half times');
  // With the others there too, sliding is the cheap way down.
  assert.ok(plazaRoute(model, top.id, bottom.id).some(l => l.move === 'slide'), 'the slide is the way down');
});

test('every bridge type joins its two feet, both ways, and helpers cross it', () => {
  const model = many();
  const rope = model.bridges.find(b => b.type === 'rope');
  const [a, b] = [model.byId.get(rope.from.island), model.byId.get(rope.to.island)];
  for (const type of BRIDGE_TYPES) {
    // A slide always runs from the higher island down.
    const flip = type === 'slide' && a.lift < b.lift;
    const bridge = { ...rope, type, from: flip ? rope.to : rope.from, to: flip ? rope.from : rope.to };
    const others = model.bridges.filter(x => x !== rope);
    const one = withBridges(model, [...others, bridge]);
    const path = deckPath(bridge, model);
    assert.ok(near(path[0], bridge.from.at) && near(path.at(-1), bridge.to.at), `${type}: the deck runs foot to foot`);
    for (const p of path) assert.ok(p.every(Number.isFinite), `${type}: finite deck`);
    const ways = bridgeWays(bridge, model);
    for (const [name, way] of Object.entries({ forward: ways.forward, back: ways.back })) {
      const start = way.legs[0].points?.[0] ?? way.legs[0].at, end = way.legs.at(-1).points?.at(-1) ?? way.legs.at(-1).at;
      const [s, e] = name === 'forward' ? [bridge.from.at, bridge.to.at] : [bridge.to.at, bridge.from.at];
      assert.ok(near(start, s, 0.02) && near(end, e, 0.02), `${type} ${name}: from foot to foot`);
      assert.ok(way.cost > 0 && Number.isFinite(way.cost), `${type} ${name}: a cost`);
    }
    if (type === 'cloudsteps') assert.ok(ways.forward.legs.some(l => l.move === 'hop'), 'cloud steps are hopped');
    // Helpers on these two islands cross by this bridge when the others are gone.
    const alone = withBridges(model, [bridge]);
    const there = plazaRoute(alone, a.id, b.id), back = plazaRoute(alone, b.id, a.id);
    assert.ok(there && back, `${type}: crossed both ways`);
    assert.ok(plazaRoute(one, a.id, b.id), `${type}: in the network`);
  }
});

test('helpers walk only on open land, and lanes are cheaper', () => {
  const model = parseTown(sampleTown('village'));
  const G = walkGraph(model);
  const island = model.islands[0];
  let lanes = 0;
  for (const p of island.land) {
    const n = G.node(island, p);
    for (const e of G.exits(n)) {
      if (e.legs) continue;
      const q = G.pointOf(e.to);
      assert.ok(island.land.has(q) && !island.floors.has(q), `step ${p} -> ${q} stays off blocks`);
      const thing = island.taken.get(q);
      assert.ok(!thing || (!thing.pad && !(thing.blocks ?? KINDS[thing.kind]?.blocks)), `step ${p} -> ${q} stays off pads and blocking things`);
      if (island.lanes.has(p) && island.lanes.has(q)) {
        const d = Math.hypot(...[0, 1].map(i => island.grid.points[p][i] - island.grid.points[q][i]));
        assert.ok(Math.abs(e.cost - d * 0.7) < 1e-9, 'a lane step costs 0.7 of its length');
        lanes++;
      }
    }
  }
  assert.ok(lanes > 0, 'the village has lane steps');
});

test('workers stand next to their job and carry: own island pile, then own island door, then a pile elsewhere', () => {
  const model = many();
  const plans = planHelpers(model, 'focus');
  const piles = model.things.filter(t => t.kind === 'pile');
  const seen = { pile: 0, door: 0, away: 0 };
  for (const [i, plan] of plans.entries()) {
    if (!plan.job) continue;
    const thing = model.things.find(t => t.id === plan.target);
    const island = model.byId.get(thing.island);
    const work = plan.line.segments.find(s => s.tool && !s.walk);
    const [x, z] = [island.at[0] + thing.at[0], island.at[1] + thing.at[1]];
    assert.ok(Math.hypot(work.to[0] - x, work.to[1] - z) < 1.6, `helper ${i} works beside ${thing.id}`);
    assert.ok(Math.abs(work.yTo - island.lift) < 1e-6, `helper ${i} works at the island's height`);
    const doors = (island.doors ?? []).map(d => `door:${d.house}`);
    if (piles.some(t => t.island === island.id)) {
      assert.equal(piles.find(t => t.id === plan.carriesTo)?.island, island.id, `helper ${i} carries to the pile on its job's island`);
      seen.pile++;
    } else if (doors.length) {
      assert.ok(doors.includes(plan.carriesTo), `helper ${i} carries to a door on its job's island, not across a bridge`);
      seen.door++;
    } else {
      assert.ok(piles.some(t => t.id === plan.carriesTo && t.island !== island.id), `helper ${i} carries to a pile elsewhere`);
      seen.away++;
    }
  }
  assert.ok(seen.pile + seen.door + seen.away >= 3, 'several workers');
  assert.ok(seen.pile > 0 && seen.door > 0, `the sample shows a home pile and a door drop (${JSON.stringify(seen)})`);
  // With no pile anywhere, a worker on the home island carries to a house door there.
  const noPile = { ...model, things: model.things.filter(t => t.kind !== 'pile') };
  const home = model.helpers.findIndex(h => h.island === model.islands[0].id && h.job === 'wood');
  assert.ok(planHelpers(noPile, 'focus')[home].carriesTo?.startsWith('door:'), 'no pile: to the door');
});

test('bridges: every type fits any feet, inside the triangle budget', () => {
  const shared = { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  const end = (x, y, z, out, clear) => ({ island: 'none', point: 0, at: [x, y, z], out, clear });
  const cases = {
    'short level': [end(0, 0, 0, [1, 0], 0.5), end(3, 0, 0, [-1, 0], 0.5)],
    'level': [end(0, 0, 0, [1, 0], 1), end(6, 0, 0, [-1, 0], 1)],
    'sloping by 1.0': [end(0, 1, 0, [1, 0], 0.8), end(4, 0, 0, [-1, 0], 0.8)],
    'bent': [end(0, 0.5, 0, [0.7071, 0.7071], 0.7), end(4, 0, 1.5, [-1, 0], 0.7)],
    'steep and short': [end(0, 1, 0, [1, 0], 0.3), end(2, 0, 0, [-1, 0], 0.3)],
    'long and bent': [end(0, 0.5, 0, [0, 1], 2), end(9, -0.5, 6, [-1, 0], 2)],
  };
  for (const type of BRIDGE_TYPES) {
    for (const [name, [from, to]] of Object.entries(cases)) {
      const root = new THREE.Group();
      const made = makeModelContext({ ...shared, root });
      buildBridge(made.ctx, { id: `${type}-${name}`, type, from, to }, null);
      made.finish();
      for (const update of made.dynamic) update(1.7);
      let triangles = 0;
      root.traverse(node => {
        if (!node.isMesh) return;
        const g = node.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
        for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v), `${type} ${name}: finite`);
      });
      assert.ok(triangles > 0 && triangles <= MAX_TRIANGLES, `${type} ${name}: ${triangles} triangles`);
      for (const item of made.disposables) item?.dispose?.();
    }
  }
});

test("the deck follows the layout's deck line and eases between the islands' heights", () => {
  const world = sampleTown('manyIslands');
  const model = parseTown(world);
  for (const bridge of model.bridges) {
    const path = deckPath(bridge, model);
    assert.ok(near(path[0], bridge.from.at) && near(path.at(-1), bridge.to.at), `${bridge.id}: foot to foot`);
    const lo = Math.min(bridge.from.at[1], bridge.to.at[1]), hi = Math.max(bridge.from.at[1], bridge.to.at[1]);
    assert.ok(path.every(p => p[1] >= lo - 1e-6 && p[1] <= hi + 1e-6), `${bridge.id}: between the two heights`);
    // Every point of the layout's flat line lies on the drawn deck.
    const source = world.bridges.find(b => b.id === bridge.id);
    for (const [x, z] of deckLine(world, source)) {
      const d = Math.min(...path.map(p => Math.hypot(p[0] - x, p[2] - z)));
      assert.ok(d < 0.08, `${bridge.id}: ${d.toFixed(3)} from the layout's line`);
    }
  }
});

test('pads and models: every kind draws, each under its own piece keys', () => {
  const shared = { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  const models = SAMPLE_NAMES.map(name => parseTown(sampleTown(name)));
  // One sample thing for each footprint, and one coast thing, to stand every kind on.
  const byFoot = new Map();
  for (const model of models) for (const thing of model.things) {
    const foot = KINDS[thing.kind]?.foot;
    if (!byFoot.has(foot)) byFoot.set(foot, { model, thing });
    if (thing.coast && !byFoot.has('coast')) byFoot.set('coast', { model, thing });
  }
  for (const kind of Object.keys(KINDS)) {
    const { foot, edge } = KINDS[kind];
    const sample = byFoot.get(edge ? 'coast' : foot) ?? byFoot.get(foot);
    if (!sample) continue;
    const island = sample.model.byId.get(sample.thing.island);
    const thing = { ...sample.thing, id: `test:${kind}`, kind, pad: Boolean(KINDS[kind].pad), coast: edge ? (sample.thing.coast ?? { yaw: 0, width: 0.65 }) : null };
    const log = new Map();
    const made = makeModelContext({ ...shared, model: sample.model, island, log });
    const errors = [];
    const error = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    let tops;
    try { tops = buildThings(made.ctx, island, [thing]); } finally { console.error = error; }
    made.finish();
    assert.deepEqual(errors, [], `${kind}: no errors`);
    assert.ok(log.get(`thing:${thing.id}`)?.length > 0, `${kind}: drawn under thing:<id>`);
    if (thing.pad) assert.ok([...log.keys()].some(k => k.startsWith('pad:')), `${kind}: a stone pad`);
    else assert.ok(![...log.keys()].some(k => k.startsWith('pad:')), `${kind}: no pad`);
    assert.ok(tops[0].top.every(Number.isFinite), `${kind}: a top`);
    for (const item of made.disposables) item?.dispose?.();
  }
});
