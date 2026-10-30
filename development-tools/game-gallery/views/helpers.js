// Helper poses: each job's work with its tool, carrying each item, and every way of resting, close up.
// Never ships.
//
//   #helpers          every section
//   #helpers-work     chop, mine, saw, hoe and water at their things (focus)
//   #helpers-carry    walking with each item, and dropping a log at the pile (focus)
//   #helpers-rest     sitting, stretching, napping, fishing and strolling (break), looking about (away),
//                     asleep (day done), and sitting against a tree with no job (focus)
//
// Each picture is a small town world: the home island of the 'village' sample town (town/samples.js), cut
// down to the land within a few steps of the pose, with only the things the pose needs and one helper held
// still by debugPose (scene/town/walk.js, "Gallery poses"). It is drawn with the town scene's own parts:
// parseTown, buildGround, buildLanes, buildThings, the walk.js planner, and the helper figure and its rest
// extras (the fishing line, the sleep Zs), at the helper's base size. The camera is aimed close at the
// helper and its thing, a little lower than Today's, and turned to see a helper side on when it doesn't
// face the camera (each card says by how much). Today's own camera never comes closer than 4 steps around
// world.view, where a helper is about 18 px tall: too small to check a tool in its hand. Walking across
// bridges (hops, the slide and its stair) is in #pads-crossing and #pads-crossing-2.
import { sampleTown } from '../../../electron/renderer/game/town/samples.js';
import { KINDS, MODEL_SCALE } from '../../../electron/renderer/game/kinds.js';
import { lookFor } from '../../../electron/renderer/game/scene/style.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { buildGround } from '../../../electron/renderer/game/scene/town/ground.js';
import { buildLanes } from '../../../electron/renderer/game/scene/town/lanes.js';
import { buildThings } from '../../../electron/renderer/game/scene/town/pads.js';
import { planHelpers } from '../../../electron/renderer/game/scene/town/walk.js';
import { driveHelper } from '../../../electron/renderer/game/scene/motion.js';
import { buildHelper, helperMaterials, restExtras, HELPER_SCALE } from '../../../electron/renderer/game/scene/helpers.js';

const SIZE = [260, 220];
const PITCH = 0.55; // lower than Today's 0.8, to see under tree tops and roofs
const STEPS = 2; // land kept around the pose, in grid steps
const TOP = { point: 0.8, pair: 0.3, cell: 1.0, cells: 1.1, ring: 1.2 }; // a rough height for each footprint

let village = null;
const base = () => (village ??= sampleTown('village'));
const home = () => base().islands.find(island => island.id === 'home');
const thingOf = kind => base().things.find(thing => thing.kind === kind && thing.island === 'home');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pointAt = p => home().grid.points[p];
const middle = thing => thing.at ?? pointAt(thing.points[0]);

// The land within `steps` of the given points, walking only over land, so the cut island is one piece.
function landNear(points, steps) {
  const island = home();
  const land = new Set(island.land);
  const seen = new Map(points.filter(p => land.has(p)).map(p => [p, 0]));
  const queue = [...seen.keys()];
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    if (seen.get(p) >= steps) continue;
    for (const q of island.grid.neighbours[p]) if (land.has(q) && !seen.has(q)) { seen.set(q, seen.get(p) + 1); queue.push(q); }
  }
  // In the island's own fill order, as the world lists land.
  return island.land.filter(p => seen.has(p));
}

// A world with the cut-down home island, the given things, and one helper in a pose.
// focus: grid points the pose is about (they set the cut and world.view).
function poseTown({ things, focus, job = null, pose }) {
  const island = home();
  const land = landNear(focus, STEPS);
  const on = new Set(land);
  const kept = things.filter(thing => thing.points.every(p => on.has(p)));
  return {
    islands: [{ ...island, land, lanes: island.lanes.filter(p => on.has(p)), kept: [], houses: [] }],
    things: kept,
    bridges: [],
    helpers: [{ id: 'poser', name: 'Pip', job, island: island.id, debugPose: pose }],
    view: { island: island.id, points: focus.filter(p => on.has(p)) },
  };
}

// Walkable points next to a thing, best first: the most nearly due east of it. (Today's walk.js prefers
// the lane front and the camera side, so on Today a worker often has its back to you; here the view is
// turned to see each helper side on, see viewYaw.)
function sideSpots(thing, taken = new Set()) {
  const island = home();
  const land = new Set(island.land);
  const mine = new Set(thing.points);
  const [mx, mz] = middle(thing);
  const spots = new Set();
  for (const p of thing.points) for (const q of island.grid.neighbours[p]) if (land.has(q) && !mine.has(q) && !taken.has(q)) spots.add(q);
  const score = q => { const [x, z] = pointAt(q); const d = dist([x, z], [mx, mz]) || 1; return (x - mx) / d - Math.abs(z - mz) / d * 0.5; };
  return [...spots].sort((a, b) => score(b) - score(a) || a - b);
}

// Where a helper stands to work at a thing from point q: up to 0.45 of a step toward it, stopping short
// of the model (as walk.js standPoint). [x, z], world units (home floats at [0, 0]).
function standAt(thing, q, reach) {
  const at = pointAt(q);
  const near = thing.points.map(pointAt).sort((a, b) => dist(a, at) - dist(b, at))[0];
  const foot = KINDS[thing.kind]?.foot;
  const target = thing.pad ? middle(thing) : near;
  const half = thing.pad ? 0.6 * MODEL_SCALE * (thing.scale ?? 1) * (foot === 'ring' ? 1.4 : foot === 'cells' ? 1.2 : 1) : 0.14;
  const d = dist(target, at) || 1;
  const move = Math.max(0, Math.min(0.45 * dist(near, at), d - half - reach));
  return [at[0] + (target[0] - at[0]) / d * move, at[1] + (target[1] - at[1]) / d * move];
}

// A point a little way off from a thing, on open land toward the camera and east: for poses that need
// room (walking, napping, stretching).
function openNear(thing, away = 1.2) {
  const island = home();
  const taken = new Set(base().things.filter(t => t.island === 'home').flatMap(t => t.points));
  const [mx, mz] = middle(thing);
  const want = [mx + away * 0.8, mz + away * 0.6];
  return island.land.filter(p => !taken.has(p) && !island.lanes.includes(p))
    .sort((a, b) => dist(pointAt(a), want) - dist(pointAt(b), want) || a - b)[0];
}

// ---------- The poses ----------

const WORK = [
  ['Chop (wood)', 'wood', 'tree', { anim: 'chop', tool: 'axe' }, 0.02],
  ['Mine (stone)', 'stone', 'rock', { anim: 'mine', tool: 'pick' }, 0.2],
  ['Saw (planks)', 'planks', 'sawmill', { anim: 'saw', tool: 'saw' }, 0.05],
  ['Hoe (soil)', 'soil', 'garden', { anim: 'hoe', tool: 'hoe' }, 0.06],
  ['Water (saplings)', 'saplings', 'nursery', { anim: 'water', tool: 'can' }, 0.06],
];

function workPose([label, job, kind, pose, reach]) {
  const thing = thingOf(kind);
  const q = sideSpots(thing)[0];
  const at = standAt(thing, q, reach);
  return { label, note: `${kind} · ${pose.tool}`, mood: 'focus', world: poseTown({ things: [thing], focus: [...thing.points, q], job, pose: { ...pose, at, face: middle(thing) } }) };
}

const CARRY = [
  ['Log', 'wood', 'log'], ['Stone', 'stone', 'stone'], ['Plank', 'planks', 'plank'], ['Soil sack', 'soil', 'sack'], ['Sapling', 'saplings', 'sapling'],
];

function carryPoses() {
  const pile = thingOf('pile');
  const spot = openNear(pile, 1.0);
  const walking = CARRY.map(([label, job, carry]) => ({
    label, note: `walking with a ${carry}`, mood: 'focus',
    world: poseTown({ things: [pile], focus: [spot, pile.points[0]], job, pose: { anim: 'walk', carry, at: spot, yaw: 1.1, local: 0.3 } }),
  }));
  const q = sideSpots(pile)[0];
  const drop = {
    label: 'Drop at the pile', note: 'a log onto the pile', mood: 'focus',
    world: poseTown({ things: [pile], focus: [pile.points[0], q], job: 'wood', pose: { anim: 'drop', carry: 'log', at: standAt(pile, q, 0.12), face: middle(pile), local: 0.3 } }),
  };
  return [...walking, drop];
}

function restPoses() {
  const fire = thingOf('fire');
  const seats = base().things.filter(t => t.kind === 'seat' && t.island === 'home');
  const tree = thingOf('tree');
  const around = [fire, ...seats];
  const focus = around.flatMap(t => t.points);
  const taken = new Set(focus);
  // Sitting on the grass by the fire: its north side, facing the camera across the fire (as walk.js).
  const ring = home().grid.neighbours[fire.points[0]].filter(q => home().land.includes(q) && !taken.has(q))
    .sort((a, b) => pointAt(a)[1] - pointAt(b)[1] || a - b);
  const [fx, fz] = middle(fire), [rx, rz] = pointAt(ring[0]);
  const rd = dist([fx, fz], [rx, rz]) || 1;
  const byFire = [fx + (rx - fx) / rd * 0.5, fz + (rz - fz) / rd * 0.5];
  const lawn = openNear(fire, 1.1);
  const rest = (label, note, mood, pose) => ({ label, note, mood, world: poseTown({ things: around, focus: [...focus, lawn], pose }) });
  // Fishing: the southmost coast point of the cut island, casting out over the open sky in front.
  const fishWorld = (() => {
    const land = new Set(landNear([lawn], STEPS));
    const island = home();
    const edge = [...land].filter(p => island.grid.neighbours[p].some(q => !land.has(q)))
      .sort((a, b) => pointAt(b)[1] - pointAt(a)[1] || a - b)[0];
    const [ex, ez] = pointAt(edge);
    let dx = 0, dz = 0;
    for (const q of island.grid.neighbours[edge]) if (!land.has(q)) { const [qx, qz] = pointAt(q); const d = dist([qx, qz], [ex, ez]) || 1; dx += (qx - ex) / d; dz += (qz - ez) / d; }
    const d = Math.hypot(dx, dz) || 1;
    const at = [ex + dx / d * 0.24, ez + dz / d * 0.24];
    return poseTown({ things: [], focus: [lawn], pose: { anim: 'fish', at, yaw: Math.atan2(dx / d, dz / d), local: 1.2 } });
  })();
  // No job: back against the tree, looking out (as walk.js planIdle).
  const treeQ = sideSpots(tree)[0];
  const [tx, tz] = middle(tree), [qx, qz] = pointAt(treeQ);
  const away = Math.atan2(qx - tx, qz - tz);
  const againstTree = [qx - Math.sin(away) * 0.11, qz - Math.cos(away) * 0.11];
  return [
    rest('Sit on a log seat', 'by the fire', 'break', { anim: 'sit', at: middle(seats[0]), face: middle(fire), seat: 0.11 }),
    rest('Sit by the fire', 'on the grass', 'break', { anim: 'sit', at: byFire, face: middle(fire), seat: 0.02 }),
    rest('Stretch', 'between sits', 'break', { anim: 'stretch', at: lawn, yaw: 0.3, local: 1.2 }),
    rest('Nap', 'on the lawn', 'break', { anim: 'nap', at: lawn, yaw: 0.3 }),
    { label: 'Fish off the edge', note: 'the line hangs down past the underside', mood: 'break', world: fishWorld },
    rest('Stroll', 'walking with nothing', 'break', { anim: 'walk', at: lawn, yaw: 1.5, local: 0.3 }),
    rest('Look around', 'away from the Mac', 'away', { anim: 'look', at: lawn, yaw: 0.25, local: 1.0 }),
    rest('Asleep', 'day done', 'done', { anim: 'sleep', at: lawn, yaw: 0.3 }),
    { label: 'Sit against a tree', note: 'no job yet (focus)', mood: 'focus', world: poseTown({ things: [tree], focus: [...tree.points, treeQ], pose: { anim: 'sit', at: againstTree, face: [againstTree[0] + Math.sin(away), againstTree[1] + Math.cos(away)], seat: 0.02 } }) },
  ];
}

// ---------- Drawing ----------

// The cut island, its things, and the posed helper, as the town scene draws them.
function drawPose(world, mood) {
  return ctx => {
    const model = parseTown(world);
    const island = model.islands[0];
    buildGround(ctx, island);
    buildLanes(ctx, island);
    buildThings(ctx, island, island.things);
    const plans = planHelpers(model, mood);
    const M = helperMaterials();
    ctx.track(M);
    const rigs = model.helpers.map((helper, index) => {
      const rig = buildHelper(lookFor(helper, index), M);
      rig.root.scale.setScalar(HELPER_SCALE);
      rig.seed = index * 1.7;
      driveHelper(rig, plans[index]?.line, 0, { still: true });
      ctx.root.add(rig.root);
      return rig;
    });
    restExtras(ctx.root, rigs, plans, { bottomY: -1.5 }).update(0);
  };
}

// How far to turn the view (shot's yaw) to see a helper side on, so neither it nor the thing it faces
// hides the other. A helper already facing the camera keeps Today's view.
function viewYaw(world) {
  const pose = world.helpers[0].debugPose;
  if (!Array.isArray(pose.face) && !Number.isInteger(pose.face)) return 0;
  const island = world.islands[0];
  const spot = v => (Number.isInteger(v) ? island.grid.points[v] : v);
  const [hx, hz] = spot(pose.at), [fx, fz] = spot(pose.face);
  const d = Math.hypot(fx - hx, fz - hz) || 1;
  const f = [(fx - hx) / d, (fz - hz) / d]; // which way it faces; +z is toward Today's camera
  if (f[1] > 0.5) return 0;
  const left = [-f[1], f[0]], right = [f[1], -f[0]];
  const side = left[1] >= right[1] ? left : right; // at right angles to its facing, on the camera's (+z) side
  return Math.atan2(side[0], side[1]);
}

// What to frame: the helper (and below it for fishing, where the line hangs) and the things it uses.
function aimOf(world) {
  const pose = world.helpers[0].debugPose;
  const island = world.islands[0];
  const spot = v => (Number.isInteger(v) ? island.grid.points[v] : v);
  const [hx, hz] = spot(pose.at);
  const box = ([x, z], [y0, y1], r) => [y0, y1].flatMap(y => [[x - r, y, z - r], [x + r, y, z - r], [x - r, y, z + r], [x + r, y, z + r]]);
  const aim = box([hx, hz], [0, 0.55], 0.35);
  if (pose.anim === 'fish') aim.push(...box([hx, hz], [-0.9, -0.9], 0.3));
  for (const thing of world.things) aim.push(...box(thing.at, [0, (TOP[KINDS[thing.kind]?.foot] ?? 0.5) * (thing.scale ?? 1)], 0.3));
  return aim;
}

// ---------- The view ----------

function section(id, title, list) {
  return {
    id, title,
    async render(host, tools) {
      const row = tools.grid('gallery-medium');
      for (const { label, note, mood, world } of list()) {
        const yaw = viewYaw(world);
        const img = await tools.shot(drawPose(world, mood), { mood, width: SIZE[0], height: SIZE[1], aim: aimOf(world), yaw, pitch: PITCH });
        row.append(tools.card(label, `${note} · ${mood}${Math.abs(yaw) > 0.05 ? ` · view turned ${Math.round(yaw * 180 / Math.PI)}°` : ''}`, [img]));
      }
    },
  };
}

export default {
  id: 'helpers',
  title: 'Helper poses: work, carry and rest, close up',
  sections: [
    section('work', "Each job's work, with its tool, at its thing", () => WORK.map(workPose)),
    section('carry', 'Carrying each item, and dropping one at the pile', carryPoses),
    section('rest', 'Resting: sit, stretch, nap, fish, stroll, look about, sleep', restPoses),
  ],
};
