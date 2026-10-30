// Finds walking routes on the grid model and writes each helper's looping routine for a mood:
// focus: work at a job spot (kinds.js JOB_SPOTS), carry to the pile, come back, like watching ants.
// break: sit by the fire, nap, fish off the edge or stroll. away: sit or nap. done: everyone sleeps.
// Helpers without a job (or without anywhere to do it) nap or sit by the old tree.
// Purely visual: nothing here changes the world.
import { JOB_SPOTS } from '../kinds.js';
import { CELL } from './style.js';
import { timeline, yawTo } from './motion.js';

const key = (c, r) => `${c},${r}`;
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// What each job does at its spot, and what it carries to the pile.
export const WORK = {
  wood: { anim: 'chop', tool: 'axe', item: 'log', dur: 5.4, reach: 0.02 },
  stone: { anim: 'mine', tool: 'pick', item: 'stone', dur: 4.8, reach: 0.2 },
  planks: { anim: 'saw', tool: 'saw', item: 'plank', dur: 5.0, reach: 0.05 },
  soil: { anim: 'hoe', tool: 'hoe', item: 'sack', dur: 5.6, reach: 0.06 },
  saplings: { anim: 'water', tool: 'can', item: 'sapling', dur: 5.2, reach: 0.06 },
};

function canStep(model, from, dc, dr) {
  const next = model.get(from.c + dc, from.r + dr);
  if (!model.walkable(next)) return null;
  // No cutting corners past blocked or empty cells.
  if (dc && dr && !(model.walkable(model.get(from.c + dc, from.r)) && model.walkable(model.get(from.c, from.r + dr)))) return null;
  return next;
}

// Labels every walkable cell with a zone number; two cells share a zone when a helper can walk between them.
export function labelZones(model) {
  let zone = 0;
  for (const cell of model.cells.values()) cell.zone = -1;
  for (const cell of model.cells.values()) {
    if (cell.zone !== -1 || !model.walkable(cell)) continue;
    const queue = [cell];
    cell.zone = zone;
    while (queue.length) {
      const at = queue.pop();
      for (const [dc, dr] of N8) {
        const next = canStep(model, at, dc, dr);
        if (next && next.zone === -1) { next.zone = zone; queue.push(next); }
      }
    }
    zone++;
  }
}

// A* over walkable cells. Paths and bridges cost less, so helpers keep to them when they can.
export function findPath(model, start, goal) {
  if (!start || !goal) return null;
  if (start === goal) return [start];
  if (start.zone !== undefined && start.zone !== goal.zone) return null;
  const goalKey = key(goal.c, goal.r);
  const h = cell => Math.hypot(cell.c - goal.c, cell.r - goal.r) * 0.7;
  const heap = [];
  const push = node => {
    heap.push(node);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= heap[i].f) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const best = new Map([[key(start.c, start.r), 0]]);
  push({ cell: start, g: 0, f: h(start), prev: null });
  const closed = new Set();
  while (heap.length) {
    const node = pop();
    const nodeKey = key(node.cell.c, node.cell.r);
    if (closed.has(nodeKey)) continue;
    closed.add(nodeKey);
    if (nodeKey === goalKey) {
      const route = [];
      for (let at = node; at; at = at.prev) route.unshift(at.cell);
      return route;
    }
    for (const [dc, dr] of N8) {
      const next = canStep(model, node.cell, dc, dr);
      if (!next) continue;
      const nextKey = key(next.c, next.r);
      if (closed.has(nextKey)) continue;
      const step = (dc && dr ? Math.SQRT2 : 1) * (next.type === 'path' || next.type === 'bridge' ? 0.7 : 1);
      const g = node.g + step;
      if (best.has(nextKey) && best.get(nextKey) <= g) continue;
      best.set(nextKey, g);
      push({ cell: next, g, f: g + h(next), prev: node });
    }
  }
  return null;
}

// Rounds the corners of a walking route so helpers do not move like chess pieces.
function smoothRoute(points) {
  let pts = points;
  for (let pass = 0; pass < 2; pass++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < pts.length - 2) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.04);
}

// Walkable cells touching a thing, best first: in front (towards the camera), then the sides, then behind.
function workCells(model, thing) {
  const seen = new Set(), list = [];
  for (const part of thing.cells) for (const [dc, dr] of N4) {
    const cell = model.get(part.c + dc, part.r + dr);
    if (!model.walkable(cell) || cell.type === 'bridge' || seen.has(key(cell.c, cell.r)) || cell.thing === thing) continue;
    seen.add(key(cell.c, cell.r));
    list.push({ cell, score: dr * 2 + Math.abs(dc) * 1.2 + (dr < 0 ? -3 : 0) });
  }
  return list.sort((a, b) => b.score - a.score).map(entry => entry.cell);
}

// Where a helper stands to work: inside the work cell, nudged towards the thing.
function standPoint(model, cell, thing, reach = 0.15) {
  const [x, z] = model.toWorld(cell.c, cell.r);
  const dx = thing.x - x, dz = thing.z - z, d = Math.hypot(dx, dz) || 1;
  const half = (Math.abs(dx) > Math.abs(dz) ? thing.w : thing.h) * CELL / 2;
  const move = Math.max(0, Math.min(CELL * 0.45, d - half - reach));
  return [x + dx / d * move, z + dz / d * move];
}

function routeBetween(model, fromCell, toCell, fromPoint, toPoint) {
  const cells = findPath(model, fromCell, toCell);
  if (!cells) return null;
  return smoothRoute([fromPoint, ...cells.map(cell => model.toWorld(cell.c, cell.r)), toPoint]);
}

// In front of a thing (towards the camera) and close to its middle scores highest.
const frontScore = (cell, thing) => (cell.r - thing.r) * 2 - Math.abs(cell.c - thing.c) * 0.3;
// Around a fire: the sides first, then behind it (facing the camera), then in front.
const ringScore = (cell, fire) => (Math.abs(cell.r - fire.r) < 0.5 ? 3 : 0) + (cell.r < fire.r ? 1 : 0) - Math.abs(cell.c - fire.c) * 0.1;
const walkSteps = (route, extra) => route.slice(1).map(point => ({ walk: point, ...extra }));
const dist = (a, b) => Math.hypot(a.c - b.c, a.r - b.r);

// Shared bookkeeping while planning one mood, so helpers spread out instead of stacking.
function planner(model) {
  labelZones(model);
  const taken = new Set();
  const claimedThings = new Map();
  const cellsList = [...model.cells.values()];
  const isOpen = cell => model.walkable(cell) && cell.type === 'grass' && !cell.thing && N8.every(([dc, dr]) => {
    const n = model.get(cell.c + dc, cell.r + dr);
    return model.walkable(n) && n.type !== 'bridge';
  });
  const open = cellsList.filter(isOpen);
  const free = cell => cell && !taken.has(key(cell.c, cell.r));
  const take = cell => { if (cell) taken.add(key(cell.c, cell.r)); return cell; };
  // Keeps resting helpers a little apart: a cell counts as crowded if a taken cell is next to it.
  const roomy = cell => free(cell) && N8.every(([dc, dr]) => !taken.has(key(cell.c + dc, cell.r + dr)));
  const islandCells = index => cellsList.filter(cell => cell.island === index && model.walkable(cell));
  const centreOf = index => {
    const list = islandCells(index);
    if (!list.length) return cellsList.find(model.walkable) ?? null;
    const c = list.reduce((s, cell) => s + cell.c, 0) / list.length, r = list.reduce((s, cell) => s + cell.r, 0) / list.length;
    return list.reduce((best, cell) => (dist(cell, { c, r }) < dist(best, { c, r }) ? cell : best), list[0]);
  };
  const nearestThing = (kind, from, zone) => model.things
    .filter(t => t.kind === kind && (zone === undefined || workCells(model, t).some(cell => cell.zone === zone)))
    .sort((a, b) => dist(a, from) - dist(b, from))[0] ?? null;
  return { taken, claimedThings, open, free, take, roomy, centreOf, nearestThing, islandCells };
}

function planWork(model, helper, index, P) {
  const spec = WORK[helper.job];
  const kinds = JOB_SPOTS[helper.job] ?? [];
  if (!spec || !kinds.length) return null;
  const home = P.centreOf(helper.island);
  if (!home) return null;
  const candidates = model.things.filter(t => kinds.includes(t.kind)).map(t => {
    const cells = workCells(model, t);
    return { t, cells, score: (t.island === helper.island ? 0 : 60) + kinds.indexOf(t.kind) * 4 + dist(t, home) + (P.claimedThings.get(t) ?? 0) * 25 };
  }).filter(entry => entry.cells.length).sort((a, b) => a.score - b.score);
  for (const { t: target, cells } of candidates) {
    const workCell = cells.find(P.free) ?? cells[0];
    const zone = workCell.zone;
    const pile = P.nearestThing('pile', target, zone) ?? P.nearestThing('cottage', target, zone);
    P.claimedThings.set(target, (P.claimedThings.get(target) ?? 0) + 1);
    P.take(workCell);
    const stand = standPoint(model, workCell, target, spec.reach);
    const face = [target.x, target.z];
    if (!pile) {
      return { job: helper.job, target: target.id, line: timeline([
        { at: stand, face, anim: spec.anim, dur: spec.dur, tool: spec.tool },
        { at: stand, yaw: yawTo(face, stand), anim: 'look', dur: 2.2 },
      ], index * 2.9 + 0.4) };
    }
    const dropCells = workCells(model, pile).filter(cell => cell.zone === zone);
    const dropCell = dropCells.find(P.free) ?? dropCells.sort((a, b) => dist(a, workCell) - dist(b, workCell))[0];
    const dropPoint = standPoint(model, dropCell, pile, 0.12);
    const there = routeBetween(model, workCell, dropCell, stand, dropPoint);
    const back = routeBetween(model, dropCell, workCell, dropPoint, stand);
    if (!there || !back) continue;
    const pileFace = [pile.x, pile.z];
    return { job: helper.job, target: target.id, line: timeline([
      { at: stand, face, anim: spec.anim, dur: spec.dur, tool: spec.tool, still: 0.3 },
      { at: stand, face, anim: 'pickup', dur: 0.9, carry: spec.item },
      ...walkSteps(there, { carry: spec.item }),
      { at: dropPoint, face: pileFace, anim: 'drop', dur: 0.9, carry: spec.item },
      { at: dropPoint, yaw: yawTo(dropPoint, face) + 0.6, anim: 'look', dur: 1.4 },
      ...walkSteps(back, { tool: spec.tool }),
    ], index * 2.9 + 0.4) };
  }
  return null;
}

const sitLoop = (at, face, index, seat) => timeline([
  { at, face, anim: 'sit', dur: 8 + (index % 4), seat },
  { at, face, anim: 'standup', dur: 0.8, seat },
  { at, face, anim: 'stretch', dur: 2.6, seat },
  { at, face, anim: 'sitdown', dur: 0.8, seat },
], index * 3.1);
const napLine = (at, yaw, anim = 'nap') => timeline([{ at, yaw, anim, dur: 30 }], 0);

// No job: sit against the old tree or nap beside it.
function planIdle(model, helper, index, P, preferNap = index % 2 === 1) {
  const home = P.centreOf(helper.island);
  if (!home) return null;
  const trees = model.things.filter(t => t.kind === 'tree');
  const tree = trees.find(t => t.island === helper.island && workCells(model, t).some(c => c.zone === home.zone)) ?? trees.find(t => t.island === helper.island) ?? trees[0];
  const around = tree
    ? N8.map(([dc, dr]) => model.get(tree.cells[0].c + dc, tree.cells[0].r + dr)).filter(cell => model.walkable(cell) && cell.type !== 'bridge')
      .sort((a, b) => frontScore(b, tree) - frontScore(a, tree))
    : [];
  const cell = around.find(P.roomy) ?? around.find(P.free) ?? P.open.filter(P.roomy).sort((a, b) => dist(a, home) - dist(b, home))[0] ?? home;
  P.take(cell);
  const [x, z] = model.toWorld(cell.c, cell.r);
  if (!preferNap && tree) {
    // Back to the trunk, looking out.
    const away = yawTo([tree.x, tree.z], [x, z]);
    const at = [x - Math.sin(away) * CELL * 0.18, z - Math.cos(away) * CELL * 0.18];
    return { rest: 'sit', line: sitLoop(at, [at[0] + Math.sin(away), at[1] + Math.cos(away)], index, 0.02) };
  }
  return { rest: 'nap', line: napLine([x, z], 0.3 + index * 0.7) };
}

// Fishing spots: grass on a straight stretch of coast, with open sky in front (south, east or west).
function edgeSpots(model) {
  const spots = [];
  for (const cell of model.cells.values()) {
    if (!model.walkable(cell) || cell.type !== 'grass' || cell.thing) continue;
    for (const [dc, dr, bonus] of [[0, 1, 3], [1, 0, 1], [-1, 0, 0.6]]) {
      if (model.get(cell.c + dc, cell.r + dr)) continue;
      const side = [dr, dc];
      const straight = [-1, 1].every(s => {
        const n = model.get(cell.c + side[0] * s, cell.r + side[1] * s);
        return n && n.type !== 'bridge' && !model.get(n.c + dc, n.r + dr);
      });
      if (straight) spots.push({ cell, dir: [dc, dr], score: bonus + cell.r * 0.3 });
    }
  }
  return spots.sort((a, b) => b.score - a.score);
}

function planRest(model, helper, index, P, kind, extras) {
  const home = P.centreOf(helper.island);
  if (!home) return null;
  const fire = P.nearestThing('fire', home, home.zone) ?? P.nearestThing('fire', home);
  const focusPoint = fire ?? home;
  if (kind === 'sit') {
    // Log seats around the fire first, then the grass ring around it.
    const seats = model.things.filter(t => t.kind === 'seat' && (!fire || dist(t, fire) <= 2.5)).sort((a, b) => dist(a, focusPoint) - dist(b, focusPoint));
    const seat = seats.find(s => P.free(s.cells[0]));
    if (seat) {
      P.take(seat.cells[0]);
      const face = fire ? [fire.x, fire.z] : [seat.x + Math.sin(seat.facing * Math.PI / 2), seat.z + Math.cos(seat.facing * Math.PI / 2)];
      return { rest: 'sit', line: sitLoop([seat.x, seat.z], face, index, 0.11) };
    }
    if (fire) {
      const ring = N8.map(([dc, dr]) => model.get(fire.cells[0].c + dc, fire.cells[0].r + dr))
        .filter(cell => model.walkable(cell) && cell.type !== 'bridge' && P.free(cell))
        .sort((a, b) => ringScore(b, fire) - ringScore(a, fire));
      const cell = ring[0];
      if (cell) {
        P.take(cell);
        const [x, z] = model.toWorld(cell.c, cell.r);
        const d = Math.hypot(x - fire.x, z - fire.z) || 1;
        const at = [fire.x + (x - fire.x) / d * CELL * 0.85, fire.z + (z - fire.z) / d * CELL * 0.85];
        return { rest: 'sit', line: sitLoop(at, [fire.x, fire.z], index, 0.02) };
      }
    }
    return planRest(model, helper, index, P, 'nap', extras);
  }
  if (kind === 'fish') {
    const spot = extras.edges.find(s => P.roomy(s.cell) && extras.fishers.every(f => dist(f, s.cell) >= 3));
    if (!spot) return planRest(model, helper, index, P, 'nap', extras);
    P.take(spot.cell);
    extras.fishers.push(spot.cell);
    const [x, z] = model.toWorld(spot.cell.c, spot.cell.r);
    const at = [x + spot.dir[0] * CELL * 0.42, z + spot.dir[1] * CELL * 0.42];
    const yaw = Math.atan2(spot.dir[0], spot.dir[1]);
    return { rest: 'fish', line: timeline([
      { at, yaw, anim: 'fish', dur: 6.5 + (index % 3) },
      { at, yaw, anim: 'reel', dur: 1.8 },
    ], index * 1.7) };
  }
  if (kind === 'stroll') {
    const zoneOpen = P.open.filter(cell => cell.zone === home.zone);
    if (zoneOpen.length < 4) return planRest(model, helper, index, P, 'nap', extras);
    const byNear = zoneOpen.slice().sort((a, b) => dist(a, focusPoint) - dist(b, focusPoint));
    const a = byNear[Math.min(byNear.length - 1, 3 + index)], b = byNear[Math.max(0, byNear.length - 2 - index)];
    const pa = model.toWorld(a.c, a.r), pb = model.toWorld(b.c, b.r);
    const there = routeBetween(model, a, b, pa, pb), back = routeBetween(model, b, a, pb, pa);
    if (!there || !back || a === b) return planRest(model, helper, index, P, 'nap', extras);
    return { rest: 'stroll', line: timeline([
      { at: pa, anim: 'look', dur: 2.4, yaw: 0 },
      ...walkSteps(there, { speed: 0.35 }),
      { at: pb, anim: 'look', dur: 2.4, yaw: 0.5 },
      ...walkSteps(back, { speed: 0.35 }),
    ], index * 2.3) };
  }
  // Nap or sleep: open grass near the fire (or the island's middle), a little apart from each other.
  const near = P.open.filter(cell => cell.zone === home.zone || home.zone === undefined)
    .sort((a, b) => Math.abs(dist(a, focusPoint) - 1.8) - Math.abs(dist(b, focusPoint) - 1.8));
  const cell = near.find(P.roomy) ?? near.find(P.free)
    ?? N8.map(([dc, dr]) => model.get(home.c + dc, home.r + dr)).find(c => model.walkable(c) && P.free(c)) ?? home;
  P.take(cell);
  const [x, z] = model.toWorld(cell.c, cell.r);
  return { rest: kind === 'sleep' ? 'sleep' : 'nap', line: napLine([x, z], (fire ? yawTo([x, z], [fire.x, fire.z]) + Math.PI / 2 : 0.3) + index * 0.5, kind === 'sleep' ? 'sleep' : 'nap') };
}

// A fixed pose for the gallery: { anim, tool, carry, at: [c, r], face: [c, r] | yaw, local, seat }.
function planPose(model, helper) {
  const pose = helper.debugPose;
  const at = model.toWorld(pose.at?.[0] ?? model.centre[0], pose.at?.[1] ?? model.centre[1]);
  const face = pose.face ? model.toWorld(pose.face[0], pose.face[1]) : undefined;
  return { rest: pose.anim, still: true, line: timeline([{ at, face, yaw: face ? undefined : (pose.yaw ?? 0), anim: pose.anim, tool: pose.tool, carry: pose.carry, seat: pose.seat, dur: 10, still: pose.local ?? 0.4 }], 0) };
}

const REST_CYCLE = {
  break: ['sit', 'fish', 'nap', 'sit', 'stroll', 'nap', 'fish', 'sit'],
  away: ['sit', 'nap', 'sit', 'nap'],
};

// Plans every helper's routine for this mood. Returns [{ job | rest, line }] in helper order.
export function planHelpers(model, mood) {
  const P = planner(model);
  const extras = { edges: edgeSpots(model), fishers: [] };
  const fallback = model.toWorld(model.centre[0], model.centre[1]);
  const plans = new Array(model.helpers.length);
  // Fixed poses first, then workers (they need the job spots), then everyone else.
  const order = model.helpers.map((helper, index) => ({ helper, index }))
    .sort((a, b) => Number(Boolean(b.helper.debugPose)) - Number(Boolean(a.helper.debugPose)));
  for (const { helper, index } of order) {
    let plan = null;
    if (helper.debugPose) plan = planPose(model, helper);
    else if (mood === 'focus') plan = planWork(model, helper, index, P) ?? planIdle(model, helper, index, P);
    else if (mood === 'done') plan = planRest(model, helper, index, P, 'sleep', extras);
    else {
      const cycle = REST_CYCLE[mood] ?? REST_CYCLE.break;
      plan = planRest(model, helper, index, P, cycle[index % cycle.length], extras);
    }
    plans[index] = plan ?? { rest: 'idle', line: timeline([{ at: fallback, anim: 'look', dur: 3, yaw: 0 }], index) };
  }
  return plans;
}
