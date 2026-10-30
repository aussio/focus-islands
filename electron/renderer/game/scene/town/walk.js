// Helper routes on the town grid. Stream D owns this. Plans come one per helper, in helper order, each
// { job | rest, line } (plus target, still and fishBottom where they apply),
// where line is a motion.js timeline whose steps carry heights (y), so helpers stand at their island's
// lift and follow each bridge up and down.
//
//   planHelpers(model, mood) => [plan]     model: parseTown's model
//   walkGraph(model) => graph              the walking graph, for tests and the gallery
//
// - Helpers walk from point to neighbouring point over land that isn't a block, a pad or a blocking thing
//   (kinds.js `blocks`). A step costs its length; a step between lanes costs 0.7 of that, half on a lane 0.85.
// - Every bridge joins its two feet, whatever its type (bridges.js bridgeWays): crossing costs the deck's
//   length; on a water slide, sliding down costs 0.5 × and climbing the stair 1.5 ×. Cloud steps are hops;
//   the slide is sit down, slide, splash, stand up; the stair is a climb.
// - Routes over land get their corners rounded (smoothRoute).
// - focus: work at the nearest job spot (kinds.js JOB_SPOTS), on the helper's own island first; carry to
//   a pile on the job's island, else a house door there, and only then the nearest pile elsewhere by
//   route. break and away: sit by a fire, fish off a coast, stroll or nap. done: sleep. No job: sit
//   against the island's first tree, or nap beside it.
// - Work spots are walkable points next to the thing; the helper stands up to 0.45 of a step toward it.
// - The same model always gives the same plans: every choice is by cost, then point number.
import { JOB_SPOTS, KINDS, MODEL_SCALE } from '../../kinds.js';
import { timeline, yawTo } from '../motion.js';
import { bridgeWays } from './bridges.js';

// What each job does at its spot, and what it carries to the pile.
export const WORK = {
  wood: { anim: 'chop', tool: 'axe', item: 'log', dur: 5.4, reach: 0.02 },
  stone: { anim: 'mine', tool: 'pick', item: 'stone', dur: 4.8, reach: 0.2 },
  planks: { anim: 'saw', tool: 'saw', item: 'plank', dur: 5.0, reach: 0.05 },
  soil: { anim: 'hoe', tool: 'hoe', item: 'sack', dur: 5.6, reach: 0.06 },
  saplings: { anim: 'fill', tool: 'pail', item: 'bucket', dur: 5.2, reach: 0.06 }, // water: fill a bucket at the rain catcher
};
const LANE = 0.7; // a lane step costs this share of a grass step
const MOVE_SPEED = { hop: 0.6, slide: 1.25, climb: 0.38 }; // walking is 0.5; the slide is 2.5 × that
const MOVE_TIME = { sitdown: 0.7, splash: 1.0, standup: 0.7 };
const SLIDE_SEAT = 0.02;
const REST_CYCLE = {
  break: ['sit', 'fish', 'nap', 'sit', 'stroll', 'nap', 'fish', 'sit'],
  away: ['sit', 'nap', 'sit', 'nap'],
};

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const flat = p => [p[0], p[2]];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- The walking graph ----------

export function walkGraph(model) {
  const islands = model?.islands ?? [];
  const start = new Map();
  let total = 0;
  for (const island of islands) { start.set(island.id, total); total += island.grid.points.length; }
  const owner = new Int32Array(total);
  islands.forEach((island, i) => owner.fill(i, start.get(island.id), start.get(island.id) + island.grid.points.length));
  const node = (island, p) => start.get(island.id) + p;
  const islandOf = n => islands[owner[n]];
  const pointOf = n => n - start.get(islands[owner[n]].id);
  const blocking = thing => Boolean(thing && (thing.pad || (thing.blocks ?? KINDS[thing.kind]?.blocks ?? true)));
  const walkable = (island, p) => island.land.has(p) && !island.floors?.has(p) && !blocking(island.taken?.get(p));
  const where = (island, p) => {
    const q = island.grid.points[p];
    return [round4(island.at[0] + q[0]), round4(island.lift ?? 0), round4(island.at[1] + q[1])];
  };
  const at = n => where(islandOf(n), pointOf(n));
  const feet = new Set();
  const crossings = new Map(); // node -> [{ to, cost, legs, bridge }]
  for (const bridge of model?.bridges ?? []) {
    const a = model.byId?.get(bridge.from.island) ?? islands.find(i => i.id === bridge.from.island);
    const b = model.byId?.get(bridge.to.island) ?? islands.find(i => i.id === bridge.to.island);
    if (!a || !b) continue;
    const ways = bridgeWays(bridge, model);
    const na = node(a, bridge.from.point), nb = node(b, bridge.to.point);
    feet.add(na); feet.add(nb);
    if (!crossings.has(na)) crossings.set(na, []);
    if (!crossings.has(nb)) crossings.set(nb, []);
    crossings.get(na).push({ to: nb, cost: ways.forward.cost, legs: ways.forward.legs, bridge: bridge.id, type: ways.type });
    crossings.get(nb).push({ to: na, cost: ways.back.cost, legs: ways.back.legs, bridge: bridge.id, type: ways.type });
  }
  const open = n => walkable(islandOf(n), pointOf(n));
  // Every way out of a node: its walkable grid neighbours, then any bridges from it.
  const exits = n => {
    const island = islandOf(n), p = pointOf(n);
    const out = [];
    const lane = island.lanes.has(p);
    for (const q of island.grid.neighbours[p]) {
      if (!walkable(island, q)) continue;
      const both = lane && island.lanes.has(q), one = lane || island.lanes.has(q);
      out.push({ to: node(island, q), cost: dist2(island.grid.points[p], island.grid.points[q]) * (both ? LANE : one ? (1 + LANE) / 2 : 1) });
    }
    for (const c of crossings.get(n) ?? []) out.push(c);
    return out;
  };
  return { islands, total, node, islandOf, pointOf, walkable, open, where, at, exits, feet, crossings };
}

// Cheapest costs from some start nodes to every node (or until goal). Ties go to the lower node number.
function search(G, starts, goal = -1) {
  const cost = new Float64Array(G.total).fill(Infinity);
  const prev = new Int32Array(G.total).fill(-1);
  const via = new Array(G.total).fill(null);
  const heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = item => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i], heap[parent])) break;
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
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of starts) if (s >= 0 && cost[s] > 0) { cost[s] = 0; push([0, s]); }
  const done = new Uint8Array(G.total);
  while (heap.length) {
    const [c, n] = pop();
    if (done[n]) continue;
    done[n] = 1;
    if (n === goal) break;
    for (const e of G.exits(n)) {
      const next = c + e.cost;
      if (next < cost[e.to] - 1e-12) {
        cost[e.to] = next;
        prev[e.to] = n;
        via[e.to] = e.legs ? e : null;
        push([next, e.to]);
      }
    }
  }
  return { cost, prev, via };
}

function nodePath(found, goal) {
  if (!Number.isFinite(found.cost[goal])) return null;
  const path = [];
  for (let n = goal; n !== -1; n = found.prev[n]) path.unshift(n);
  return path;
}

// Rounds the corners of a walking route so helpers don't move like chess pieces.
function smoothRoute(points) {
  let pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-4);
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
  // Drops points bunched closer than 0.04, always keeping both ends.
  const kept = [pts[0]];
  for (const p of pts.slice(1, -1)) if (Math.hypot(p[0] - kept.at(-1)[0], p[1] - kept.at(-1)[1]) > 0.04) kept.push(p);
  const last = pts[pts.length - 1];
  if (pts.length > 1) {
    if (kept.length > 1 && Math.hypot(last[0] - kept.at(-1)[0], last[1] - kept.at(-1)[1]) <= 0.04) kept.pop();
    kept.push(last);
  }
  return kept;
}

// The legs of a route from node a to node b, starting at the world point from and ending at to.
// Runs over land are rounded; each bridge adds its own legs.
export function routeLegs(G, a, b, from, to) {
  const found = search(G, [a], b);
  const nodes = nodePath(found, b);
  if (!nodes) return null;
  const legs = [];
  let run = [from];
  const flush = () => {
    if (run.length < 2) return;
    const y = run[run.length - 1][1];
    legs.push({ move: 'walk', points: smoothRoute(run.map(flat)).map(([x, z]) => [round4(x), y, round4(z)]) });
  };
  run.push(G.at(nodes[0]));
  for (let i = 1; i < nodes.length; i++) {
    const crossing = found.via[nodes[i]];
    if (crossing) {
      flush();
      legs.push(...crossing.legs);
      run = [G.at(nodes[i])];
    } else run.push(G.at(nodes[i]));
  }
  run.push(to);
  flush();
  return legs;
}

// Timeline steps for some legs. extra (carry, tool, speed) goes on every moving step.
export function legSteps(legs, extra = {}) {
  const steps = [];
  for (const leg of legs) {
    if (leg.points) {
      const special = leg.move !== 'walk';
      for (const p of leg.points.slice(1)) {
        steps.push({ walk: [p[0], p[2]], y: p[1], ...extra, ...(special ? { anim: leg.move, speed: MOVE_SPEED[leg.move] } : {}) });
      }
    } else {
      steps.push({ at: [leg.at[0], leg.at[2]], y: leg.at[1], yaw: leg.yaw, anim: leg.move, dur: MOVE_TIME[leg.move] ?? 0.8, seat: SLIDE_SEAT, carry: extra.carry });
    }
  }
  return steps;
}

// ---------- Planning ----------

function planner(model) {
  const G = walkGraph(model);
  const taken = new Set();
  const claimed = new Map();
  const free = n => n >= 0 && !taken.has(n);
  const take = n => { if (n >= 0) taken.add(n); return n; };
  // Keeps resting helpers a little apart: a node counts as crowded if a taken node is next to it.
  const roomy = n => free(n) && G.islandOf(n).grid.neighbours[G.pointOf(n)].every(q => !taken.has(G.node(G.islandOf(n), q)));
  const plazaOf = island => {
    if (island.plaza >= 0 && G.walkable(island, island.plaza)) return G.node(island, island.plaza);
    const p = island.order?.find(q => G.walkable(island, q)) ?? [...island.land].find(q => G.walkable(island, q));
    return p === undefined ? -1 : G.node(island, p);
  };
  // Open lawn: walkable grass (not a lane or a foot) with walkable land all round.
  const openCache = new Map();
  const openOn = island => {
    if (!openCache.has(island.id)) {
      openCache.set(island.id, (island.order ?? [...island.land]).filter(p => G.walkable(island, p) && !island.lanes.has(p)
        && island.grid.neighbours[p].every(q => G.walkable(island, q))).map(p => G.node(island, p)));
    }
    return openCache.get(island.id);
  };
  const fromPlaza = new Map();
  const costsFrom = island => {
    if (!fromPlaza.has(island.id)) fromPlaza.set(island.id, search(G, [plazaOf(island)]).cost);
    return fromPlaza.get(island.id);
  };
  return { G, model, taken, claimed, free, take, roomy, plazaOf, openOn, costsFrom };
}

const islandById = (model, id) => model.byId?.get(id) ?? model.islands.find(i => i.id === id) ?? model.islands[0] ?? null;
const middleOf = (island, thing) => thing.local ?? thing.at ?? island.grid.points[thing.points[0]];
const worldOf = (island, [x, z], y = 0) => [round4(island.at[0] + x), round4((island.lift ?? 0) + y), round4(island.at[1] + z)];

// Walkable points next to a thing, best first: its lane front, then the camera side, then the sides.
function workSpots(P, island, thing) {
  const { G } = P;
  const mine = new Set(thing.points);
  const [mx, mz] = middleOf(island, thing);
  const seen = new Set();
  const list = [];
  for (const p of thing.points) for (const q of island.grid.neighbours[p]) {
    if (mine.has(q) || seen.has(q) || !G.walkable(island, q)) continue;
    seen.add(q);
    const n = G.node(island, q);
    if (G.feet.has(n)) continue;
    const [x, z] = island.grid.points[q];
    const d = Math.hypot(x - mx, z - mz) || 1;
    list.push({ n, q, score: (q === thing.front ? 1 : 0) + (z - mz) / d * 2 - Math.abs(x - mx) / d * 0.3 });
  }
  return list.sort((a, b) => b.score - a.score || a.q - b.q);
}

// Where a helper stands to work at a thing from point q: up to 0.45 of a step toward it.
function standPoint(island, q, thing, reach) {
  const [qx, qz] = island.grid.points[q];
  const near = thing.points.map(p => island.grid.points[p]).sort((a, b) => dist2(a, [qx, qz]) - dist2(b, [qx, qz]))[0];
  const step = dist2(near, [qx, qz]);
  const foot = KINDS[thing.kind]?.foot;
  const target = thing.pad ? middleOf(island, thing) : near;
  const half = thing.pad ? 0.6 * MODEL_SCALE * (thing.scale ?? 1) * (foot === 'ring' ? 1.4 : foot === 'cells' ? 1.2 : 1) : 0.14;
  const d = dist2(target, [qx, qz]) || 1;
  const move = Math.max(0, Math.min(0.45 * step, d - half - reach));
  return worldOf(island, [qx + (target[0] - qx) / d * move, qz + (target[1] - qz) / d * move]);
}

function planWork(P, helper, index) {
  const { G, model } = P;
  const spec = WORK[helper.job];
  const kinds = JOB_SPOTS[helper.job] ?? [];
  if (!spec || !kinds.length) return null;
  const home = islandById(model, helper.island);
  if (!home) return null;
  const reach = P.costsFrom(home);
  const candidates = model.things.filter(t => kinds.includes(t.kind)).map(t => {
    const island = islandById(model, t.island);
    const spots = workSpots(P, island, t).filter(s => Number.isFinite(reach[s.n]));
    const best = spots.length ? Math.min(...spots.map(s => reach[s.n])) : Infinity;
    return { t, island, spots, score: (t.island === home.id ? 0 : 60) + kinds.indexOf(t.kind) * 4 + best + (P.claimed.get(t.id) ?? 0) * 25 };
  }).filter(c => c.spots.length).sort((a, b) => a.score - b.score || (a.t.id < b.t.id ? -1 : 1));
  for (const { t: target, island, spots } of candidates) {
    const spot = spots.find(s => P.free(s.n)) ?? spots[0];
    P.claimed.set(target.id, (P.claimed.get(target.id) ?? 0) + 1);
    P.take(spot.n);
    const stand = standPoint(island, spot.q, target, spec.reach);
    const face = flat(worldOf(island, middleOf(island, target)));
    const drop = dropFor(P, spot.n, island);
    const offset = index * 2.9 + 0.4;
    if (!drop) {
      return { job: helper.job, target: target.id, line: timeline([
        { at: flat(stand), y: stand[1], face, anim: spec.anim, dur: spec.dur, tool: spec.tool },
        { at: flat(stand), y: stand[1], yaw: yawTo(face, flat(stand)), anim: 'look', dur: 2.2 },
      ], offset) };
    }
    const there = routeLegs(G, spot.n, drop.n, stand, drop.at);
    const back = routeLegs(G, drop.n, spot.n, drop.at, stand);
    if (!there || !back) continue;
    return { job: helper.job, target: target.id, carriesTo: drop.what, line: timeline([
      { at: flat(stand), y: stand[1], face, anim: spec.anim, dur: spec.dur, tool: spec.tool, still: 0.3 },
      { at: flat(stand), y: stand[1], face, anim: 'pickup', dur: 0.9, carry: spec.item },
      ...legSteps(there, { carry: spec.item }),
      { at: flat(drop.at), y: drop.at[1], face: drop.face, anim: 'drop', dur: 0.9, carry: spec.item },
      { at: flat(drop.at), y: drop.at[1], yaw: yawTo(flat(drop.at), face) + 0.6, anim: 'look', dur: 1.4 },
      ...legSteps(back, { tool: spec.tool }),
    ], offset) };
  }
  return null;
}

// Where to carry from node n (on the job's island): a pile on that island first, then a house door on
// that island, and only then the nearest pile elsewhere by route. No long trips across bridges just to
// drop a log when there is somewhere close. { n, at, face, what } or null.
function dropFor(P, n, island) {
  const { G, model } = P;
  const found = search(G, [n]).cost;
  const piles = model.things.filter(t => t.kind === 'pile');
  const pileOn = (list) => {
    let best = null;
    for (const pile of list) {
      const isle = islandById(model, pile.island);
      for (const q of isle.grid.neighbours[pile.points[0]]) {
        if (!G.walkable(isle, q)) continue;
        const m = G.node(isle, q), c = found[m];
        if (!Number.isFinite(c) || (best && c >= best.c)) continue;
        best = { c, n: m, at: standPoint(isle, q, pile, 0.12), face: flat(worldOf(isle, middleOf(isle, pile))), what: pile.id };
      }
    }
    return best;
  };
  const home = pileOn(piles.filter(t => t.island === island.id));
  if (home) return home;
  let best = null;
  for (const door of island.doors ?? []) {
    const m = G.node(island, door.outside), c = found[m];
    if (!Number.isFinite(c) || (best && c >= best.c)) continue;
    const [ox, oz] = island.grid.points[door.outside], [bx, bz] = island.grid.points[door.point];
    best = { c, n: m, at: worldOf(island, [ox + (bx - ox) * 0.3, oz + (bz - oz) * 0.3]), face: flat(worldOf(island, [bx, bz])), what: `door:${door.house}` };
  }
  return best ?? pileOn(piles.filter(t => t.island !== island.id));
}

const sitLoop = (at, y, face, index, seat) => timeline([
  { at, y, face, anim: 'sit', dur: 8 + (index % 4), seat },
  { at, y, face, anim: 'standup', dur: 0.8, seat },
  { at, y, face, anim: 'stretch', dur: 2.6, seat },
  { at, y, face, anim: 'sitdown', dur: 0.8, seat },
], index * 3.1);
const napLine = (at, y, yaw, anim = 'nap') => timeline([{ at, y, yaw, anim, dur: 30 }], 0);

// The island's first tree: its start tree, else the first tree on it.
const firstTree = (model, island) => model.things.find(t => t.island === island.id && t.kind === 'tree' && t.id === `${island.id}:tree`)
  ?? model.things.find(t => t.island === island.id && t.kind === 'tree') ?? null;

// No job: sit against the island's first tree, or nap beside it.
function planIdle(P, helper, index, preferNap = index % 2 === 1) {
  const { G, model } = P;
  const island = islandById(model, helper.island);
  if (!island) return null;
  const tree = firstTree(model, island);
  let n = -1;
  if (tree) {
    const [tx, tz] = middleOf(island, tree);
    const around = island.grid.neighbours[tree.points[0]].filter(q => G.walkable(island, q) && !G.feet.has(G.node(island, q)))
      .map(q => ({ q, score: (island.grid.points[q][1] - tz) * 2 - Math.abs(island.grid.points[q][0] - tx) * 0.3 }))
      .sort((a, b) => b.score - a.score || a.q - b.q).map(e => G.node(island, e.q));
    n = around.find(P.roomy) ?? around.find(P.free) ?? -1;
  }
  if (n < 0) n = napSpot(P, island, null);
  if (n < 0) return null;
  P.take(n);
  const [x, y, z] = G.at(n);
  if (!preferNap && tree) {
    // Back to the trunk, looking out.
    const [tx, , tz] = worldOf(island, middleOf(island, tree));
    const away = yawTo([tx, tz], [x, z]);
    const at = [x - Math.sin(away) * 0.11, z - Math.cos(away) * 0.11];
    return { rest: 'sit', line: sitLoop(at, y, [at[0] + Math.sin(away), at[1] + Math.cos(away)], index, 0.02) };
  }
  return { rest: 'nap', line: napLine([x, z], y, 0.3 + index * 0.7) };
}

// Open lawn near a focus (fire or plaza), a little apart from the others.
function napSpot(P, island, focus) {
  const { G } = P;
  const centre = focus ?? G.at(P.plazaOf(island));
  const near = P.openOn(island).slice().sort((a, b) => Math.abs(dist2(flat(G.at(a)), [centre[0], centre[2]]) - 1.1) - Math.abs(dist2(flat(G.at(b)), [centre[0], centre[2]]) - 1.1) || a - b);
  let n = near.find(P.roomy) ?? near.find(P.free);
  if (n === undefined) {
    const any = (island.order ?? [...island.land]).filter(p => G.walkable(island, p)).map(p => G.node(island, p));
    n = any.find(P.free) ?? any[0] ?? -1;
  }
  return n;
}

// The fire for a helper: on its own island, else the nearest one it can walk to.
function fireFor(P, island) {
  const { G, model } = P;
  const fires = model.things.filter(t => t.kind === 'fire');
  const own = fires.find(f => f.island === island.id);
  if (own) return own;
  const reach = P.costsFrom(island);
  let best = null, bestCost = Infinity;
  for (const fire of fires) {
    const isle = islandById(model, fire.island);
    const c = Math.min(...isle.grid.neighbours[fire.points[0]].map(q => reach[G.node(isle, q)]));
    if (c < bestCost) { bestCost = c; best = fire; }
  }
  return best;
}

// Fishing spots: coast grass with open sky in front (south, east or west), away from kept sky.
function edgeSpots(P, island) {
  const { G } = P;
  const spots = [];
  for (const p of island.order ?? island.land) {
    if (!island.coast?.has(p) || island.lanes.has(p) || !G.walkable(island, p)) continue;
    const sky = island.grid.neighbours[p].filter(q => !island.land.has(q));
    if (!sky.length || sky.some(q => island.kept?.has(q))) continue;
    const [px, pz] = island.grid.points[p];
    let dx = 0, dz = 0;
    for (const q of sky) { const [qx, qz] = island.grid.points[q]; const d = Math.hypot(qx - px, qz - pz) || 1; dx += (qx - px) / d; dz += (qz - pz) / d; }
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    dx /= d; dz /= d;
    if (dz < -0.3) continue; // the north coast is hidden from the camera
    spots.push({ n: G.node(island, p), p, dir: [dx, dz], score: dz * 3 + (dx > 0 ? 1 : 0.6) * Math.abs(dx) + pz * 0.1 });
  }
  return spots.sort((a, b) => b.score - a.score || a.p - b.p);
}

function planRest(P, helper, index, kind, fishers) {
  const { G, model } = P;
  const island = islandById(model, helper.island);
  if (!island) return null;
  if (kind === 'sit') {
    const fire = fireFor(P, island);
    if (fire) {
      const isle = islandById(model, fire.island);
      const fireAt = worldOf(isle, middleOf(isle, fire));
      // Log seats around the fire first, then the grass ring around it.
      const seats = model.things.filter(t => t.kind === 'seat' && t.island === isle.id && dist2(middleOf(isle, t), middleOf(isle, fire)) <= 1.6)
        .sort((a, b) => dist2(middleOf(isle, a), middleOf(isle, fire)) - dist2(middleOf(isle, b), middleOf(isle, fire)) || (a.id < b.id ? -1 : 1));
      const seat = seats.find(s => P.free(G.node(isle, s.points[0])));
      if (seat) {
        P.take(G.node(isle, seat.points[0]));
        const at = worldOf(isle, middleOf(isle, seat));
        return { rest: 'sit', line: sitLoop(flat(at), at[1], flat(fireAt), index, 0.11) };
      }
      const ring = isle.grid.neighbours[fire.points[0]].filter(q => G.walkable(isle, q) && P.free(G.node(isle, q)))
        .sort((a, b) => isle.grid.points[a][1] - isle.grid.points[b][1] || a - b);
      if (ring.length) {
        const q = ring[0];
        P.take(G.node(isle, q));
        const [fx, fz] = isle.grid.points[fire.points[0]], [qx, qz] = isle.grid.points[q];
        const d = Math.hypot(qx - fx, qz - fz) || 1;
        const at = worldOf(isle, [fx + (qx - fx) / d * 0.5, fz + (qz - fz) / d * 0.5]);
        return { rest: 'sit', line: sitLoop(flat(at), at[1], flat(fireAt), index, 0.02) };
      }
    }
    return planRest(P, helper, index, 'nap', fishers);
  }
  if (kind === 'fish') {
    const spot = edgeSpots(P, island).find(s => P.roomy(s.n) && fishers.every(f => dist2(flat(G.at(f)), flat(G.at(s.n))) >= 1.6));
    if (!spot) return planRest(P, helper, index, 'nap', fishers);
    P.take(spot.n);
    fishers.push(spot.n);
    const [px, pz] = island.grid.points[spot.p];
    const at = worldOf(island, [px + spot.dir[0] * 0.24, pz + spot.dir[1] * 0.24]);
    const yaw = Math.atan2(spot.dir[0], spot.dir[1]);
    return { rest: 'fish', fishBottom: round4((island.lift ?? 0) - 1.3), line: timeline([
      { at: flat(at), y: at[1], yaw, anim: 'fish', dur: 6.5 + (index % 3) },
      { at: flat(at), y: at[1], yaw, anim: 'reel', dur: 1.8 },
    ], index * 1.7) };
  }
  if (kind === 'stroll') {
    const fire = model.things.find(t => t.kind === 'fire' && t.island === island.id);
    const focus = flat(fire ? worldOf(island, middleOf(island, fire)) : G.at(P.plazaOf(island)));
    const open = P.openOn(island);
    if (open.length < 4) return planRest(P, helper, index, 'nap', fishers);
    const byNear = open.slice().sort((a, b) => dist2(flat(G.at(a)), focus) - dist2(flat(G.at(b)), focus) || a - b);
    const a = byNear[Math.min(byNear.length - 1, 3 + index)], b = byNear[Math.max(0, byNear.length - 2 - index)];
    if (a === b) return planRest(P, helper, index, 'nap', fishers);
    const pa = G.at(a), pb = G.at(b);
    const there = routeLegs(G, a, b, pa, pb), back = routeLegs(G, b, a, pb, pa);
    if (!there || !back) return planRest(P, helper, index, 'nap', fishers);
    return { rest: 'stroll', line: timeline([
      { at: flat(pa), y: pa[1], anim: 'look', dur: 2.4, yaw: 0 },
      ...legSteps(there, { speed: 0.35 }),
      { at: flat(pb), y: pb[1], anim: 'look', dur: 2.4, yaw: 0.5 },
      ...legSteps(back, { speed: 0.35 }),
    ], index * 2.3) };
  }
  // Nap or sleep: open lawn near the island's fire (or its plaza), a little apart from each other.
  const fire = model.things.find(t => t.kind === 'fire' && t.island === island.id);
  const fireAt = fire ? worldOf(island, middleOf(island, fire)) : null;
  const n = napSpot(P, island, fireAt);
  if (n < 0) return null;
  P.take(n);
  const [x, y, z] = G.at(n);
  const yaw = (fireAt ? yawTo([x, z], flat(fireAt)) + Math.PI / 2 : 0.3) + index * 0.5;
  return { rest: kind === 'sleep' ? 'sleep' : 'nap', line: napLine([x, z], y, yaw, kind === 'sleep' ? 'sleep' : 'nap') };
}

// Gallery poses and walks. debugPose: { anim, tool, carry, at, face, yaw, seat, local } where at and face
// are points on the helper's island or [x, z] in world space; or { walk: { from: { island, point },
// to: { island, point }, carry, tool } } for a walk there and back (across any bridges between).
function planPose(P, helper) {
  const { G, model } = P;
  const pose = helper.debugPose;
  const island = islandById(model, helper.island);
  const spot = v => (Number.isInteger(v) ? G.where(island, v) : Array.isArray(v) ? [v[0], island?.lift ?? 0, v[1]] : null);
  if (pose.walk) {
    const end = e => { const isle = islandById(model, e?.island ?? helper.island); return isle && Number.isInteger(e?.point) ? G.node(isle, e.point) : -1; };
    const a = end(pose.walk.from), b = end(pose.walk.to);
    if (a < 0 || b < 0) return null;
    const pa = G.at(a), pb = G.at(b);
    const extra = { ...(pose.walk.carry ? { carry: pose.walk.carry } : {}), ...(pose.walk.tool ? { tool: pose.walk.tool } : {}) };
    const there = routeLegs(G, a, b, pa, pb), back = routeLegs(G, b, a, pb, pa);
    if (!there || !back) return null;
    return { rest: 'walk', line: timeline([
      { at: flat(pa), y: pa[1], anim: 'look', dur: 1.2, yaw: 0 },
      ...legSteps(there, extra),
      { at: flat(pb), y: pb[1], anim: 'look', dur: 1.2, yaw: 0 },
      ...legSteps(back, extra),
    ], (pose.walk.offset ?? 0)) };
  }
  const at = spot(pose.at) ?? G.at(P.plazaOf(island));
  const face = spot(pose.face);
  return { rest: pose.anim, still: true, line: timeline([{ at: flat(at), y: at[1] + (pose.y ?? 0), face: face ? flat(face) : undefined, yaw: face ? undefined : (pose.yaw ?? 0), anim: pose.anim, tool: pose.tool, carry: pose.carry, seat: pose.seat, dur: 10, still: pose.local ?? 0.4 }], 0) };
}

// Plans every helper's routine for this mood. Returns [{ job | rest, line }] in helper order.
export function planHelpers(model, mood) {
  const helpers = model?.helpers ?? [];
  if (!model?.islands?.length) return helpers.map((h, index) => ({ rest: 'idle', line: timeline([{ at: [0, 0], anim: 'look', dur: 3, yaw: 0 }], index) }));
  const P = planner(model);
  const fishers = [];
  const plans = new Array(helpers.length);
  // Fixed poses first, then workers (they need the job spots), then everyone else.
  const order = helpers.map((helper, index) => ({ helper, index }))
    .sort((a, b) => Number(Boolean(b.helper.debugPose)) - Number(Boolean(a.helper.debugPose)));
  for (const { helper, index } of order) {
    let plan = null;
    if (helper.debugPose) plan = planPose(P, helper);
    else if (mood === 'focus') plan = planWork(P, helper, index) ?? planIdle(P, helper, index);
    else if (mood === 'done') plan = planRest(P, helper, index, 'sleep', fishers);
    else {
      const cycle = REST_CYCLE[mood] ?? REST_CYCLE.break;
      plan = planRest(P, helper, index, cycle[index % cycle.length], fishers);
    }
    if (!plan) {
      const island = islandById(model, helper.island);
      const n = island ? P.plazaOf(island) : -1;
      const at = n >= 0 ? P.G.at(n) : [0, 0, 0];
      plan = { rest: 'idle', line: timeline([{ at: flat(at), y: at[1], anim: 'look', dur: 3, yaw: 0 }], index) };
    }
    plans[index] = plan;
  }
  return plans;
}
