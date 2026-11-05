// One short ground edge on a resident's island, reachable from the existing town paths.
//
// The cat should read clearly at Today's size: orange on green grass, in a quiet corner of the town.
// Every point is scored, lower is better, and the best pair of neighbouring points wins (ties by point
// number, so the same world always gives the same spot):
// - never on a lane, the coast, a bridge foot, a block, a pad or a thing (helpers' own ground);
// - never within REST_GAP of a spot where a helper stays (works, sits or lies down to sleep) in any
//   mood, so a sleeping helper never lies on the sleeping cat;
// - well away from where helpers work, rest and walk (their planned routes in every mood), from job
//   things they may be sent to later, and from pads (big models that overhang their points);
// - never just behind something tall from the camera's side (the camera looks north and sways up to
//   45 degrees each way), so a house, windmill or tree does not hide it;
// - a little nicer next to something homely behind or beside it (a tree, bush, flower bed or house), a
//   little worse right next to the coast;
// - near the middle of the busy view, so the framed picture shows it.
// A packed island may have no such spot. Then the rules loosen in steps (FALLBACKS): first the gap from
// helpers' spots, then the coast, then the lanes. The cat never stands in a building or on a thing.
import { walkGraph, planHelpers } from '../town/walk.js';
import { JOB_SPOTS, KINDS } from '../../kinds.js';
import { TOWN } from '../style.js';
import { LOOP, ease, turnToward as turn } from '../calm.js';

const JOB_KINDS = new Set(Object.values(JOB_SPOTS).flat());
const HOMELY = new Set(['tree', 'bush', 'flower', 'flowers', 'seat', 'bench', 'goldentree']);
// Rough heights for the hiding check (island units). Pads not named use their footprint's. (The town
// builder's THING_TOP is by footprint only, for framing, so it cannot stand in for these.)
const TALL = { tree: 1.2, goldentree: 1.35, bush: 0.4, rock: 0.4, windmill: 1.9, tower: 2.1, lighthouse: 2.1, greattree: 2, observatory: 1.7, airship: 1.7, aurora: 1.6 };
const PAD_TALL = { cell: 1.2, cells: 1.2, ring: 1.5 };
const CAT_TOP = 0.2;
const SLOPE = 1 / Math.tan(0.8); // the camera's elevation (stage.js ELEVATION): ground hidden per unit of height
const SWAY = 0.95; // a little over the camera's 45 degree sway, in radians
const VIEW_WIDTH = 1.46; // picture width per unit of framed ground depth: 1.66 aspect x sin(0.8) / 0.82 of the height below the top band
// How far the cat's spots stay from where a helper stays: one lying helper at Today's largest size
// (0.4 tall x 1.4), plus the cat's own half length. A helper lies down sideways from its spot.
export const REST_GAP = 0.75;
const MOODS = ['focus', 'break', 'done', 'away'];
// Each step loosens one rule: [keep the gap, keep off the coast, keep off the lanes].
const FALLBACKS = [[true, true, true], [false, true, true], [false, false, true], [false, false, false]];

// The same layout gives the same route, so a world change that only brings a visitor or a resident
// (or nothing the helpers care about) does not plan every helper again.
const cache = new Map();
const CACHE_SIZE = 4;
const layoutKey = (model, islandId) => islandId + JSON.stringify(model.data ?? null, (name, value) =>
  (name === 'grid' && value && typeof value === 'object' ? value.key : name === 'visitor' || name === 'residents' ? undefined : value));
const copy = route => route && { ...route, points: [...route.points], from: [...route.from], to: [...route.to] };

// residentRoute(model, islandId) => { island, points, from, to, fallback } | null
//   fallback: 0 when every rule held, else how many rules were loosened (FALLBACKS)
export function residentRoute(model, islandId = 'home') {
  const island = model?.byId?.get(islandId);
  if (!island) return null;
  const key = model.data ? layoutKey(model, islandId) : null;
  if (key !== null && cache.has(key)) return copy(cache.get(key));
  const route = findRoute(model, island);
  if (key !== null) {
    cache.set(key, route);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  }
  return copy(route);
}

function findRoute(model, island) {
  const graph = walkGraph(model);
  const feet = new Set((island.feet ?? []).map(f => f.point));
  const starts = [...island.lanes].filter(p => graph.walkable(island, p));
  const reachable = new Set(starts), pending = [...starts];
  for (let i = 0; i < pending.length; i++) {
    for (const p of island.grid.neighbours[pending[i]]) {
      if (reachable.has(p) || !graph.walkable(island, p)) continue;
      reachable.add(p); pending.push(p);
    }
  }
  const ground = [...reachable].filter(p => !island.taken.has(p) && !island.floors?.has(p) && !feet.has(p));
  if (!ground.length) return null;
  const { busy, stays } = helperGround(model, island);
  const near = p => { const [x, z] = island.point(p); return stays.some(q => Math.hypot(x - q[0], z - q[1]) < REST_GAP); };
  const score = quietness(model, island, ground, feet, busy);
  for (const [fallback, [gap, coast, lanes]] of FALLBACKS.entries()) {
    const ok = new Set(ground.filter(p => !(gap && near(p)) && !(coast && island.coast.has(p)) && !(lanes && island.lanes.has(p))));
    if (!ok.size) continue;
    let best = null;
    for (const a of ok) {
      for (const b of island.grid.neighbours[a]) {
        if (!ok.has(b)) continue;
        const total = score.get(a) + score.get(b);
        if (!best || total < best.total - 1e-9 || (Math.abs(total - best.total) <= 1e-9 && (a < best.a || (a === best.a && b < best.b)))) best = { a, b, total };
      }
    }
    const pick = best ? [best.a, best.b] : [[...ok].reduce((x, y) => (score.get(y) < score.get(x) - 1e-9 || (Math.abs(score.get(y) - score.get(x)) <= 1e-9 && y < x) ? y : x))];
    return { island: island.id, points: pick, from: island.world(pick[0]), to: island.world(pick.at(-1)), fallback };
  }
  return null;
}

// Where helpers go on this island, in island units: busy, every planned step and route sample in every
// mood; stays, the spots where one stands still (works, sits, sleeps).
export function helperGround(model, island) {
  const busy = [], stays = [];
  const reach = island.grid.points.reduce((r, _, p) => Math.max(r, Math.hypot(...island.point(p))), 0) + 1;
  const here = (x, z) => { const local = [x - island.at[0], z - island.at[1]]; return Math.hypot(...local) <= reach ? local : null; };
  for (const mood of MOODS) {
    for (const plan of planHelpers(model, mood)) {
      for (const segment of plan.line?.segments ?? []) {
        const [x0, z0] = segment.from, [x1, z1] = segment.to;
        const length = Math.hypot(x1 - x0, z1 - z0);
        if (length < 1e-6) { const spot = here(x0, z0); if (spot) stays.push(spot); }
        const n = Math.max(1, Math.ceil(length / 0.25));
        for (let i = 0; i <= n; i++) { const p = here(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n); if (p) busy.push(p); }
      }
    }
  }
  return { busy, stays };
}

function quietness(model, island, candidates, feet, busy) {
  const at = p => island.point(p);
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const step = 0.75; // a little over one grid step (0.65 to 0.72)

  // Tall things, with their heights, for the hiding check; and busy or homely neighbours.
  const tall = [], pads = [], jobs = [], homely = [];
  for (const [p, floors] of island.floors) {
    tall.push({ at: at(p), height: floors * TOWN.storey + TOWN.roofRise, radius: 0.36 });
    homely.push(at(p));
  }
  for (const thing of island.things) {
    const scale = Number.isFinite(thing.scale) && thing.scale > 0 ? thing.scale : 1;
    const height = (TALL[thing.kind] ?? (thing.pad ? PAD_TALL[KINDS[thing.kind]?.foot] ?? 1.2 : 0.3)) * (thing.pad ? 1 : scale);
    for (const p of thing.points ?? []) {
      const where = at(p);
      if (height > CAT_TOP + 0.1) tall.push({ at: where, height, radius: thing.pad ? 0.45 : 0.3 });
      if (thing.pad) pads.push(where);
      if (JOB_KINDS.has(thing.kind) || thing.kind === 'pile' || thing.kind === 'fire') jobs.push(where);
      if (HOMELY.has(thing.kind)) homely.push(where);
    }
  }
  const doors = (island.doors ?? []).map(d => at(d.point));
  const bridgeFeet = [...feet].map(at);
  const lanes = [...island.lanes].map(at);

  // The busy view: Today frames these points (or the island whole), with the top band over the far side.
  const view = model.view?.island === island.id && model.view.ids?.length ? model.view.ids.map(at) : [];
  const middle = view.length ? view.reduce((m, p) => [m[0] + p[0] / view.length, m[1] + p[1] / view.length], [0, 0]) : [0, 0];
  const box = { x0: Math.min(...view.map(p => p[0])), x1: Math.max(...view.map(p => p[0])), z0: Math.min(...view.map(p => p[1])), z1: Math.max(...view.map(p => p[1])) };
  // The spare room around that box: Today's picture is wide (about 1.66 to 1) and the ground's depth
  // looks shorter from the camera's height, so a deep, narrow view shows land either side of it and a
  // wide one a little more in front. Kept well inside the estimate, because the camera sways.
  const wide = Math.max(box.x1 - box.x0, VIEW_WIDTH * (box.z1 - box.z0));
  box.dx = Math.max(0.3, 0.6 * (wide - (box.x1 - box.x0)) / 2);
  box.dz = Math.max(-0.2, 0.6 * (wide / VIEW_WIDTH - (box.z1 - box.z0)) / 2 - 0.2);

  // Helper points in squares one step wide, so only the nine squares around a spot are searched: a point
  // farther out is more than a step away, which scores the same as none.
  const square = ([x, z]) => [Math.floor(x / step), Math.floor(z / step)];
  const squares = new Map();
  for (const q of busy) {
    const key = square(q).join();
    if (!squares.has(key)) squares.set(key, []);
    squares.get(key).push(q);
  }
  const nearestBusy = here => {
    const [cx, cz] = square(here);
    let d = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of squares.get(`${cx + i},${cz + j}`) ?? []) d = Math.min(d, gap(here, q));
    return d;
  };

  const score = new Map();
  for (const p of candidates) {
    const here = at(p);
    let s = 0;
    // Helpers: on a route or spot is bad, next to one a little less so.
    const nearest = nearestBusy(here);
    if (nearest < 0.3) s += 4; else if (nearest < step) s += 2 * (1 - (nearest - 0.3) / (step - 0.3));
    for (const q of jobs) if (gap(here, q) < step * 1.5) s += gap(here, q) < step ? 1.5 : 0.5;
    for (const q of pads) if (gap(here, q) < step * 1.5) s += gap(here, q) < step ? 2.5 : 0.6;
    for (const q of [...doors, ...bridgeFeet]) if (gap(here, q) < step * 1.5) s += 1;
    if (lanes.some(q => gap(here, q) < step)) s += 0.4;
    // Hidden from the camera: something tall in front (toward +z), within the sway, close enough that
    // its top covers the cat.
    for (const thing of tall) {
      const dx = thing.at[0] - here[0], dz = thing.at[1] - here[1];
      if (dz <= 0.05) continue;
      const d = Math.hypot(dx, dz), off = Math.atan2(Math.abs(dx), dz);
      if (off > SWAY + 0.35 || d > (thing.height - CAT_TOP) * SLOPE + thing.radius) continue;
      s += off <= SWAY * 0.6 ? 4 : off <= SWAY ? 2 : 0.7;
    }
    // Homely: something low and friendly behind or beside it, not in front.
    if (homely.some(q => gap(here, q) < step && q[1] - here[1] <= 0.15)) s -= 0.8;
    if (island.grid.neighbours[p].some(q => island.coast.has(q))) s += 0.5;
    // In the busy view: a gentle pull toward its middle (a little toward the camera), a firmer one
    // off the far side, which sits under Today's top band, and a strong one back inside the box of
    // the framed points (Today always shows that box; the wide picture has a little room either side).
    if (view.length) {
      s += 0.3 * gap(here, [middle[0], middle[1] + 0.4]);
      s += 0.6 * Math.max(0, middle[1] - here[1]);
      const out = Math.max(0, box.x0 - box.dx - here[0], here[0] - box.x1 - box.dx) + Math.max(0, box.z0 + 0.3 - here[1], here[1] - box.z1 - box.dz);
      if (out > 0) s += 3 + 4 * out;
    }
    score.set(p, s);
  }
  return score;
}

// The cat's turn: one loop (calm.js LOOP, 64 seconds) that starts and ends sitting at the route's first
// point. Two four-second strolls are surrounded by gradual turns, standing and curling. Long fully still
// holds make this an idle resident, not a patrol. time: seconds into the turn. mix: how far along the
// route, 0 at from and 1 at to.
export function residentMoment(time, route, reducedMotion = false) {
  const t = reducedMotion || route.points.length < 2 ? 0 : (((Number.isFinite(time) ? time : 0) % LOOP) + LOOP) % LOOP;
  const seatedYaw = -0.35;
  const forwardYaw = Math.atan2(route.to[0] - route.from[0], route.to[2] - route.from[2]);
  const backYaw = forwardYaw + Math.PI;
  let mix = 0, yaw = seatedYaw, sit = 1, curl = 0, stride = 0;
  const moving = (t >= 24 && t < 28) || (t >= 56 && t < 60);
  if (t >= 21 && t < 24) {
    const u = ease((t - 21) / 3); sit = 1 - u; yaw = turn(seatedYaw, forwardYaw, u);
  } else if (t >= 24 && t < 28) {
    const u = (t - 24) / 4; mix = ease(u); sit = 0; yaw = forwardYaw;
    stride = Math.sin(Math.PI * u) ** 2;
  } else if (t >= 28 && t < 31) {
    const u = ease((t - 28) / 3); mix = 1; sit = 0; curl = u; yaw = turn(forwardYaw, seatedYaw, u);
  } else if (t >= 31 && t < 51) {
    mix = 1; sit = 0; curl = 1;
  } else if (t >= 51 && t < 54) {
    mix = 1; sit = 0; curl = 1 - ease((t - 51) / 3);
  } else if (t >= 54 && t < 56) {
    mix = 1; sit = 0; yaw = turn(seatedYaw, backYaw, ease((t - 54) / 2));
  } else if (t >= 56 && t < 60) {
    const u = (t - 56) / 4; mix = 1 - ease(u); sit = 0; yaw = backYaw;
    stride = Math.sin(Math.PI * u) ** 2;
  } else if (t >= 60 && t < 63) {
    const u = ease((t - 60) / 3); sit = u; yaw = turn(backYaw, seatedYaw, u);
  }
  return {
    pose: moving ? 'walk' : curl > 0 ? 'rest' : 'sit',
    position: route.from.map((v, i) => v + mix * (route.to[i] - v)),
    mix, yaw, time: t, rig: { sit, curl, stride },
  };
}
