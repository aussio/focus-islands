// Stream D's view: special buildings on their stone pads, coast buildings, every bridge type, and helpers
// crossing bridges and working on the grid. Never ships.
//
//   #pads                  every section
//   #pads-lineup, #pads-lineup-break   every special model on its pad beside a 1- and a 2-storey block
//                                      and a helper; #pads-points: the one-point things, no pads
//   #pads-coast            coast buildings on the south, east and west coasts
//   #pads-bridge-<type>    one bridge type, level, sloping by 1.0 and bent, in focus and break
//   #pads-crossing, #pads-crossing-2   a helper crossing each type there and back (the slide: down,
//                          then up the stair)
//   #pads-walking, #pads-village   helpers walking and working across a few islands, and on one, framed
//                          as Today frames them and grown by the town's helper size boost
// Each section fits one gallery screenshot.
//
// The ground, lanes and blocks here are simple stand-ins (stream C draws the real ones): a grass slab of
// corner pieces under each land point, a pale lane slab, and a plain 0.5-tall box per storey.
import * as THREE from 'three';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { rbox } from '../../../electron/renderer/game/scene/parts.js';
import { P, TOWN, lookFor } from '../../../electron/renderer/game/scene/style.js';
import { BRIDGE_TYPES, KINDS } from '../../../electron/renderer/game/kinds.js';
import { sampleTown } from '../../../electron/renderer/game/town/samples.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { addPiece, piecesAt, slabPiece } from '../../../electron/renderer/game/scene/town/pieces.js';
import { buildThings, thingMiddle } from '../../../electron/renderer/game/scene/town/pads.js';
import { buildBridge, bridgeWays } from '../../../electron/renderer/game/scene/town/bridges.js';
import { legSteps, planHelpers } from '../../../electron/renderer/game/scene/town/walk.js';
import { driveHelper, timeline } from '../../../electron/renderer/game/scene/motion.js';
import { buildHelper, helperMaterials, restExtras, HELPER_SCALE } from '../../../electron/renderer/game/scene/helpers.js';
import { fitView, pixelsPerUnit } from '../../../electron/renderer/game/scene/stage.js';

const SOIL = '#e9b98a';
const LANE_TOP = '#f6e7c8', LANE_SIDE = '#e4cfa6';
const BLOCK = ['#fff3e2', '#ffe2b8'];
const models = {};
const sampleModel = name => (models[name] ??= parseTown(sampleTown(name)));

// ---------- Stand-ins for stream C's ground, lanes and blocks ----------

// Grass slab pieces under the given land points, 0.14 deep, top at y = 0.
function standInGround(ctx, island, points = island.land) {
  const on = new Set([...points].filter(p => island.land.has(p)));
  const base = place(0, -0.14, 0);
  for (const p of on) for (const c of piecesAt(island.grid, p)) {
    const mesh = slabPiece(c, { width: 1, rise: 0.14, fA: on.has(c.next), fB: on.has(c.prev), fO: on.has(c.opp), top: P.grass, side: SOIL });
    addPiece(ctx, `stand-in:ground:${c.key}`, mesh, 'matte', { matrix: base });
  }
  return on;
}

function standInLanes(ctx, island, on) {
  for (const p of island.lanes) {
    if (!on.has(p)) continue;
    for (const c of piecesAt(island.grid, p)) {
      const lane = q => island.lanes.has(q) && on.has(q);
      addPiece(ctx, `stand-in:lane:${c.key}`, slabPiece(c, { width: TOWN.laneWidth ?? 0.42, rise: 0.02, fA: lane(c.next), fB: lane(c.prev), fO: lane(c.opp), top: LANE_TOP, side: LANE_SIDE }), 'matte');
    }
  }
}

// A plain box per storey on each block point.
function standInBlocks(ctx, island, on) {
  for (const [p, floors] of island.floors ?? []) {
    if (!on.has(p)) continue;
    const [x, z] = island.grid.points[p];
    const size = stepNear(island, p) * 0.86;
    for (let f = 0; f < floors; f++) box(ctx, x, z, f, size, 0);
  }
}

function box(ctx, x, z, storey, size, yaw) {
  const h = TOWN.storey ?? 0.5;
  ctx.piece(`stand-in:block:${x.toFixed(2)}:${z.toFixed(2)}:${storey}`);
  ctx.add(rbox(size, h - 0.01, size, 0.04, 2).translate(0, h / 2, 0), 'matte', BLOCK[storey % 2], place(x, storey * h, z, { ry: yaw }), null);
}

// The mean step to a point's neighbours.
function stepNear(island, p) {
  const [x, z] = island.grid.points[p];
  const n = island.grid.neighbours[p];
  return n.reduce((s, q) => s + Math.hypot(island.grid.points[q][0] - x, island.grid.points[q][1] - z), 0) / Math.max(1, n.length);
}

// Draws into an island's own frame: everything added while fn runs is moved to [at.x, lift, at.z].
function inIsland(ctx, island, fn) {
  const [ax, az] = island.at, lift = island.lift ?? 0;
  const offset = place(ax, lift, az);
  const add = ctx.batch.add.bind(ctx.batch), root = ctx.root;
  const group = new THREE.Group();
  group.position.set(ax, lift, az);
  root.add(group);
  ctx.root = group;
  ctx.batch.add = (geometry, mat, extra = {}) => add(geometry, mat, {
    ...extra,
    matrix: offset.clone().multiply(extra.matrix ?? new THREE.Matrix4()),
    ao: extra.ao ? { ...extra.ao, ground: (extra.ao.ground ?? 0) + lift } : extra.ao,
    grad: extra.grad ? { ...extra.grad, y0: extra.grad.y0 + lift, y1: extra.grad.y1 + lift } : extra.grad,
  });
  try { return fn(); } finally { ctx.batch.add = add; ctx.root = root; }
}

// ---------- The town's camera and helper size boost (copied from scene/core.js and town/build.js) ----------
// Helpers grow until they stand 18 px tall, by at most 1.4; past that, the camera frames 4 steps around the
// view's points instead of the whole island. With no view island, every island is framed.
const HELPER_MIN_PX = 18, HELPER_HEIGHT = 0.4, TOWN_MAX_BOOST = 1.4, CLOSE_STEPS = 4;
const THING_TOP = { point: 0.5, pair: 0.3, cell: 1.0, cells: 1.1, ring: 1.2 };
const FOOT_OF = { 1: 'point', 2: 'pair', 4: 'cell', 6: 'cells', 9: 'ring' };
const thingTop = thing => (THING_TOP[FOOT_OF[thing.points.length]] ?? 0.5) * thing.scale;

// World points that frame one island whole: coast, roofs, thing tops, and the underside's bulge.
function islandFrame(island) {
  const [ax, az] = island.at, at = (p, y) => [ax + island.grid.points[p][0], island.lift + y, az + island.grid.points[p][1]];
  const points = [...island.coast].map(p => at(p, 0));
  for (const [p, floors] of island.floors ?? []) points.push(at(p, floors * TOWN.storey + TOWN.roofRise));
  for (const thing of island.things) points.push([ax + thing.at[0], island.lift + thingTop(thing), az + thing.at[1]]);
  [...island.coast].forEach((p, i) => { if (i % 3 === 0) points.push(at(p, -0.45)); });
  return points;
}

// World points for some grid points and every land point within `steps` of them, with roof and thing tops.
function closePoints(island, ids, steps) {
  const [ax, az] = island.at, { grid } = island;
  const near = new Map(ids.map(p => [p, 0])), queue = [...ids];
  for (let h = 0; h < queue.length; h++) {
    if (near.get(queue[h]) >= steps) continue;
    for (const n of grid.neighbours[queue[h]]) if (!near.has(n)) { near.set(n, near.get(queue[h]) + 1); queue.push(n); }
  }
  const points = [];
  for (const p of near.keys()) {
    if (!island.land.has(p)) continue;
    const floors = island.floors.get(p), thing = island.taken.get(p);
    const top = floors ? floors * TOWN.storey + TOWN.roofRise : thing ? thingTop(thing) : 0;
    const [x, z] = grid.points[p];
    points.push([ax + x, island.lift, az + z]);
    if (top) points.push([ax + x, island.lift + top, az + z]);
  }
  return points;
}

// Where Today's town camera looks and how big it draws helpers: { aim, boost, close }.
// whole: frame every island (the town's choice when nothing is in view), else the view island.
function townView(model, [width, height], { whole = false } = {}) {
  const boostAt = points => HELPER_MIN_PX / Math.max(1e-3, HELPER_HEIGHT * pixelsPerUnit(fitView(points, width / height).distance, height));
  const island = whole ? null : model.byId.get(model.view?.island) ?? null;
  let aim = island ? islandFrame(island) : model.islands.flatMap(islandFrame);
  let boost = boostAt(aim), close = false;
  if (island && boost > TOWN_MAX_BOOST) {
    const ids = model.view.ids.length ? model.view.ids : [island.plaza].filter(p => p >= 0);
    const near = closePoints(island, ids, CLOSE_STEPS);
    if (near.length) { aim = near; boost = boostAt(aim); close = true; }
  }
  return { aim, boost: Math.min(TOWN_MAX_BOOST, Math.max(1, boost)), close };
}

// A whole town with stand-in ground, its things and bridges, and (with plans) its helpers at time t,
// grown by boost as the town does.
function drawTown(ctx, model, { mood = 'focus', t = 0, plans = null, near = null, boost = 1 } = {}) {
  for (const island of model.islands) {
    inIsland(ctx, island, () => {
      const points = near ? [...island.land].filter(p => near(island, p)) : island.land;
      const on = standInGround(ctx, island, points);
      standInLanes(ctx, island, on);
      standInBlocks(ctx, island, on);
      buildThings(ctx, island, island.things.filter(thing => thing.points.every(p => on.has(p))));
    });
  }
  for (const bridge of model.bridges) buildBridge(ctx, bridge, model);
  if (plans) poseHelpers(ctx, model, plans, t, boost);
}

function poseHelpers(ctx, model, plans, t, boost = 1) {
  const M = helperMaterials();
  ctx.track(M);
  const rigs = model.helpers.map((helper, index) => {
    const rig = buildHelper(lookFor(helper, index), M);
    rig.root.scale.setScalar(HELPER_SCALE * boost);
    rig.seed = index * 1.7;
    driveHelper(rig, plans[index]?.line, t, { still: Boolean(plans[index]?.still) });
    ctx.root.add(rig.root);
    return rig;
  });
  const lift = model.byId?.get(model.view?.island)?.lift ?? 0;
  const extras = restExtras(ctx.root, rigs, plans, { bottomY: lift - 1.5 });
  extras.update(t);
}

// ---------- The scale line-up ----------

// One sample thing for each footprint (and one coast thing), to stand every kind on.
function footSamples() {
  const byFoot = new Map();
  for (const name of ['village', 'manyIslands', 'firstDay']) {
    const model = sampleModel(name);
    for (const thing of model.things) {
      const foot = KINDS[thing.kind]?.foot;
      const key = thing.coast ? `coast:${foot}` : foot;
      if (!byFoot.has(key)) byFoot.set(key, { model, thing });
    }
  }
  return byFoot;
}

// Where a kind stands in the line-up: on a sample thing's points (a coast one for coast kinds).
function lineUpPlace(kind, samples) {
  const { foot, edge } = KINDS[kind];
  const { model, thing: source } = samples.get(edge ? `coast:${foot}` : foot) ?? samples.get(edge ? 'coast:cell' : foot) ?? samples.get(foot);
  const island = model.byId.get(source.island);
  const thing = { ...source, id: `lineup:${kind}`, kind, pad: Boolean(KINDS[kind].pad), coast: edge ? (source.coast ?? { yaw: source.yaw ?? 0, width: 0.65 }) : null };
  const [mx, mz] = thingMiddle(island, thing);
  const yaw = thing.yaw ?? 0;
  return { model, island, thing, mx, mz, yaw, fx: Math.sin(yaw), fz: Math.cos(yaw), sx: Math.cos(yaw), sz: -Math.sin(yaw) };
}

// The points to frame: the model, both blocks and the helper, not the whole patch of ground.
function lineUpAim(kind, samples) {
  const { mx, mz, fx, fz, sx, sz } = lineUpPlace(kind, samples);
  const aim = [];
  for (const k of [-1.6, 1.6]) for (const y of [0, 1.05]) aim.push([mx + sx * k, y, mz + sz * k]);
  aim.push([mx + fx * 1.05, 0, mz + fz * 1.05], [mx - fx * 0.7, 0.9, mz - fz * 0.7]);
  return aim;
}

// A kind on a real pad from a sample island, a 1- and a 2-storey block either side, and a helper in front.
function lineUp(kind, samples) {
  return ctx => {
    const { island, thing, mx, mz, yaw, fx, fz, sx, sz } = lineUpPlace(kind, samples);
    const on = standInGround(ctx, island, [...island.land].filter(p => Math.hypot(island.grid.points[p][0] - mx, island.grid.points[p][1] - mz) < 2.3));
    standInLanes(ctx, island, on);
    buildThings(ctx, island, [thing]);
    const size = stepNear(island, thing.points[0]) * 0.86;
    box(ctx, mx + sx * 1.25, mz + sz * 1.25, 0, size, yaw);
    box(ctx, mx - sx * 1.25, mz - sz * 1.25, 0, size, yaw);
    box(ctx, mx - sx * 1.25, mz - sz * 1.25, 1, size, yaw);
    const M = helperMaterials();
    ctx.track(M);
    const rig = buildHelper(lookFor({ name: 'Pip', job: 'wood' }, 0), M);
    rig.root.position.set(mx + fx * 0.85 + sx * 0.55, 0, mz + fz * 0.85 + sz * 0.55);
    rig.root.rotation.y = yaw;
    ctx.root.add(rig.root);
  };
}

// The one-point things and the flower bed in a row, without pads, beside a block.
function pointRow(ctx) {
  const model = sampleModel('village');
  const island = model.byId.get('home');
  const kinds = Object.keys(KINDS).filter(k => ['point', 'pair'].includes(KINDS[k].foot) && k !== 'cottage');
  const row = [...island.land].filter(p => !island.floors.has(p) && !island.taken.has(p) && !island.lanes.has(p))
    .sort((a, b) => island.grid.points[a][1] - island.grid.points[b][1] || island.grid.points[a][0] - island.grid.points[b][0]);
  // Points along one line across the island, about a step apart.
  const line = row.filter(p => Math.abs(island.grid.points[p][1] - 0.4) < 0.35).sort((a, b) => island.grid.points[a][0] - island.grid.points[b][0]);
  const picked = [];
  for (const p of line) if (!picked.length || island.grid.points[p][0] - island.grid.points[picked.at(-1)][0] > 0.55) picked.push(p);
  const things = [];
  kinds.forEach((kind, i) => {
    const p = picked[i];
    if (p === undefined) return;
    const points = KINDS[kind].foot === 'pair' ? [p, island.grid.neighbours[p].find(q => !picked.includes(q) && island.land.has(q)) ?? p] : [p];
    things.push({ id: `row:${kind}`, kind, island: island.id, points, yaw: 0, scale: 1, pad: false });
  });
  const on = standInGround(ctx, island, [...island.land].filter(p => Math.abs(island.grid.points[p][1] - 0.4) < 1.3 && things.some(t => Math.abs(island.grid.points[t.points[0]][0] - island.grid.points[p][0]) < 1)));
  buildThings(ctx, island, things.filter(t => t.points.every(p => on.has(p))));
  const first = island.grid.points[picked[0]];
  box(ctx, first[0] - 0.9, first[1], 0, 0.55, 0);
  return things.map(t => t.kind);
}

// ---------- Coast buildings ----------

// A cell (or two for a 6-point footprint) on the coast farthest along d, all land, free.
function coastSpot(island, d, foot) {
  const g = island.grid;
  const ok = cell => g.cells[cell].every(p => island.land.has(p) && !island.floors.has(p) && !island.taken.has(p));
  const score = cell => g.cells[cell].reduce((s, p) => s + g.points[p][0] * d[0] + g.points[p][1] * d[1], 0) / 4;
  const cells = g.cells.map((_, i) => i).filter(i => ok(i) && g.cells[i].some(p => island.coast.has(p))).sort((a, b) => score(b) - score(a));
  for (const cell of cells) {
    if (foot !== 'cells') return [...g.cells[cell]];
    const shared = other => g.cells[other].filter(p => g.cells[cell].includes(p)).length === 2;
    const next = cells.filter(o => o !== cell && shared(o)).sort((a, b) => score(b) - score(a))[0];
    if (next !== undefined) return [...new Set([...g.cells[cell], ...g.cells[next]])];
  }
  return null;
}

const COASTS = [['south', [0, 1]], ['east', [1, 0]], ['west', [-1, 0]]];

function coastShot(kind) {
  return ctx => {
    const model = sampleModel('manyIslands');
    const island = model.byId.get('home');
    standInGround(ctx, island);
    const things = [];
    for (const [side, d] of COASTS) {
      const points = coastSpot(island, d, KINDS[kind].foot);
      if (!points) continue;
      const yaw = Math.atan2(d[0], d[1]);
      things.push({ id: `coast:${kind}:${side}`, kind, island: island.id, points, yaw, scale: 1, pad: true, coast: { yaw, width: KINDS[kind].foot === 'cells' ? 1.1 : 0.65 } });
    }
    buildThings(ctx, island, things);
  };
}

// ---------- Bridges ----------

const end = (x, y, z, out, clear = 0.6) => ({ island: 'none', point: 0, at: [x, y, z], out, clear });
const SHAPES = {
  level: [end(0, 0, 0, [1, 0]), end(4, 0, 0, [-1, 0])],
  'sloping by 1.0': [end(0, 1, 0, [1, 0]), end(4, 0, 0, [-1, 0])],
  bent: [end(0, 0.4, 0, [0.6, 0.8]), end(4, 0, 0, [-0.6, 0.8])],
};

// A round grass top and soil body behind each foot, so the feet read as island edges.
function footIslands(ctx, bridge) {
  for (const e of [bridge.from, bridge.to]) {
    const [x, y, z] = e.at;
    const cx = x - e.out[0] * 0.7, cz = z - e.out[1] * 0.7;
    ctx.piece(`stand-in:foot:${x}:${z}`);
    ctx.add(new THREE.CylinderGeometry(0.8, 0.74, 0.14, 24).translate(0, -0.07, 0), 'matte', P.grass, place(cx, y, cz), null);
    ctx.add(new THREE.CylinderGeometry(0.74, 0.25, 0.55, 12).translate(0, -0.415, 0), 'matte', SOIL, place(cx, y, cz), null);
  }
}

function bridgeShot(type, shape) {
  return ctx => {
    const [from, to] = SHAPES[shape];
    const bridge = { id: `${type}-${shape}`, type, from, to };
    footIslands(ctx, bridge);
    buildBridge(ctx, bridge, null);
  };
}

// The same helper at several moments of one crossing (there, or back), like a long exposure. Helpers are
// drawn 1.6 times their base size, as the town scene boosts them so they stay readable.
const CROSS_BOOST = 1.6;
const crossBridge = type => ({ id: `cross-${type}`, type, from: end(0, 0.7, 0, [1, 0]), to: end(4, 0, 0.5, [-1, 0]) });
function crossingShot(type, way) {
  return ctx => {
    const bridge = crossBridge(type);
    footIslands(ctx, bridge);
    buildBridge(ctx, bridge, null);
    const legs = bridgeWays(bridge, null)[way].legs;
    const start = legs[0].points?.[0] ?? legs[0].at;
    const line = timeline([{ at: [start[0], start[2]], y: start[1], anim: 'look', dur: 0.3, yaw: Math.PI / 2 }, ...legSteps(legs)]);
    const M = helperMaterials();
    ctx.track(M);
    for (const t of momentsOf(line)) {
      const rig = buildHelper(lookFor({ name: 'Moss', job: 'soil' }, 1), M);
      rig.root.scale.multiplyScalar(CROSS_BOOST);
      driveHelper(rig, line, t);
      ctx.root.add(rig.root);
      restExtras(ctx.root, [rig], [{ rest: 'walk', line }], { bottomY: -1 }).update(t);
    }
  };
}

// Times worth showing: evenly along the crossing, the middle of each sit, splash and stand, and hops at
// their highest.
function momentsOf(line) {
  const picks = [];
  const special = new Set(['sitdown', 'splash', 'standup']);
  for (const s of line.segments) if (special.has(s.anim)) picks.push(s.start + s.duration * (s.anim === 'splash' ? 0.3 : 0.5));
  for (let i = 0; i < 6; i++) {
    let t = 0.3 + (line.total - 0.4) * (i + 0.5) / 6;
    const s = [...line.segments].reverse().find(x => x.start <= t);
    if (s?.anim === 'hop') t = s.start + s.duration * 0.5;
    picks.push(t);
  }
  picks.sort((a, b) => a - b);
  return picks.filter((t, i) => i === 0 || t - picks[i - 1] > 0.35);
}

// ---------- The view ----------

const pretty = text => text[0].toUpperCase() + text.slice(1);

function lineupSection(mood) {
  return {
    id: mood === 'focus' ? 'lineup' : `lineup-${mood}`,
    title: `Scale line-up (${mood}): every special model on its pad, beside a 1- and a 2-storey block and a helper`,
    async render(host, tools) {
      tools.note('Stand-in ground and plain 0.5-tall boxes per storey (stream C draws the real ones). Each picture is turned so the model faces the camera.');
      const samples = footSamples();
      const row = tools.grid('gallery-medium');
      for (const kind of Object.keys(KINDS).filter(k => KINDS[k].pad)) {
        const { yaw } = lineUpPlace(kind, samples);
        const img = await tools.shot(lineUp(kind, samples), { mood, width: 250, height: 160, yaw, aim: lineUpAim(kind, samples) });
        row.append(tools.card(kind, `${KINDS[kind].foot} · ${img.stats?.triangles ?? '?'} tris`, [img]));
      }
    },
  };
}

function bridgeSection(type) {
  return {
    id: `bridge-${type}`, title: `Bridge: ${type}, level, sloping by 1.0, and bent`,
    async render(host, tools) {
      tools.note(`Feet 4 apart; the left foot is the higher one. ${type === 'slide' ? 'The slide runs from the higher foot down; the stair is on its far side.' : ''}`);
      const row = tools.grid('gallery-medium');
      for (const mood of ['focus', 'break']) {
        for (const shape of Object.keys(SHAPES)) {
          const img = await tools.shot(bridgeShot(type, shape), { mood, width: 420, height: 250 });
          row.append(tools.card(`${shape} · ${mood}`, `${img.stats?.triangles ?? '?'} triangles in the picture`, [img]));
        }
      }
    },
  };
}

function crossingSection(id, types) {
  return {
    id, title: `A helper crossing ${types.join(', ')}, there and back`,
    async render(host, tools) {
      tools.note(`One helper drawn at several moments of one crossing, at ${CROSS_BOOST} times base size. The left foot is 0.7 higher. The slide: sit, slide, splash, stand going down; the stair going up.`);
      const row = tools.grid('gallery-medium');
      for (const type of types) {
        const bridge = crossBridge(type);
        const aim = [[-0.3, 0.9, -0.5], [4.3, 0.9, -0.5], [-0.3, -0.2, 0.9], [4.3, -0.2, 0.9]];
        for (const way of ['forward', 'back']) {
          row.append(tools.card(`${type} · ${way === 'forward' ? 'there (down)' : 'back (up)'}`, '', [await tools.shot(crossingShot(type, way), { width: 560, height: 250, aim })]));
        }
      }
    },
  };
}

export default {
  id: 'pads',
  title: 'Pads, models, bridges and walking (stream D)',
  sections: [
    lineupSection('focus'),
    lineupSection('break'),
    {
      id: 'points', title: 'Without pads: one-point things and the flower bed, beside a 1-storey block',
      async render(host, tools) {
        const row = tools.grid('gallery-medium');
        for (const mood of ['focus', 'break']) row.append(tools.card(mood, '', [await tools.shot(pointRow, { mood, width: 640, height: 300 })]));
      },
    },
    {
      id: 'coast', title: 'Coast buildings on the south, east and west coasts',
      async render(host, tools) {
        tools.note('One copy on each coast of a sample island (stand-in ground). The building faces out to sea.');
        const row = tools.grid('gallery-medium');
        for (const kind of Object.keys(KINDS).filter(k => KINDS[k].edge)) {
          for (const mood of ['focus', 'break']) row.append(tools.card(`${kind} · ${mood}`, 'south, east, west', [await tools.shot(coastShot(kind), { mood, width: 400, height: 260 })]));
          row.append(tools.card(`${kind} · from the east`, '', [await tools.shot(coastShot(kind), { width: 400, height: 260, yaw: Math.PI / 2 })]));
        }
      },
    },
    ...BRIDGE_TYPES.map(bridgeSection),
    crossingSection('crossing', BRIDGE_TYPES.slice(0, 3)),
    crossingSection('crossing-2', BRIDGE_TYPES.slice(3)),
    {
      id: 'walking', title: 'Helpers walking and working across islands',
      async render(host, tools) {
        const model = sampleModel('manyIslands');
        const size = tools.TODAY_SIZE;
        const plans = { focus: planHelpers(model, 'focus'), break: planHelpers(model, 'break') };
        const say = mood => plans[mood].map((p, i) => `${model.helpers[i].name} ${p.job ? `${p.job} → ${p.carriesTo ?? 'nowhere'}` : p.rest}`).join(', ');
        tools.note(`Stand-in ground, lanes and blocks; helpers posed from walk.js plans, grown by the town's size boost. Top: every island (the boost stops at 1.4). Bottom: Today's own view of this town (${model.view.island}).`);
        tools.note(`focus: ${say('focus')}. break: ${say('break')}.`);
        const views = [['every island', townView(model, size, { whole: true }), 4], ["Today's view", townView(model, size), 19]];
        const row = tools.grid('gallery-medium');
        for (const [label, { aim, boost, close }, t] of views) {
          for (const mood of ['focus', 'break']) {
            row.append(tools.card(`${label}${close ? ' (close)' : ''} · ${mood} · ${t}s · helpers ×${boost.toFixed(2)}`, '',
              [await tools.shot(ctx => drawTown(ctx, model, { mood, t, plans: plans[mood], boost }), { mood, width: size[0], height: size[1], time: t, aim })]));
          }
        }
      },
    },
    {
      id: 'village', title: "Helpers on one island, at Today's size",
      async render(host, tools) {
        tools.note("Framed as Today's town camera frames the view island: whole if helpers stay 18 px tall with a boost of at most 1.4, else 4 steps around the view's points.");
        const village = sampleModel('village');
        const { aim, boost, close } = townView(village, tools.TODAY_SIZE);
        const row = tools.grid('gallery-medium');
        for (const mood of ['focus', 'break']) {
          const plans = planHelpers(village, mood);
          row.append(tools.card(`village · ${mood} · ${close ? 'close view' : 'whole island'} · helpers ×${boost.toFixed(2)}`, '', [await tools.shot(ctx => drawTown(ctx, village, { mood, t: 6, plans, boost }), { mood, width: tools.TODAY_SIZE[0], height: tools.TODAY_SIZE[1], time: 6, aim })]));
        }
        row.append(tools.card('manyIslands through the town scene', "createIslandScene, as Today will draw it (stream C's ground may still be a stub)", [await tools.worldShot(sampleTown('manyIslands'), 'focus', { width: tools.TODAY_SIZE[0], height: tools.TODAY_SIZE[1] })]));
      },
    },
  ],
};
