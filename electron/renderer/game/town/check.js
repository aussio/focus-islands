// Checks a world against the layout rules in game/BUILD_PLAN.md ("What gets tested"). Plain code: no DOM.
//
//   checkTown(world) => [problems]   plain sentences; empty when all is well
//
// It starts with checkShape (shape.js), then checks each island's land, lanes, houses and things, the
// space between islands, and the bridges.
//
// One rule from the plan is not checked: "houses and pads sit off the coast". The layout keeps them off
// the coast when it can, but lets them touch it before it would borrow land (see island.js), and a world
// can't tell which happened.
import { KINDS } from '../kinds.js';
import { checkShape, MAX_FLOORS } from './shape.js';
import { deckLine, SKY_GAP, FOOT_ROOM } from './sky.js';
import { farmYaw } from './pads.js';
import { canFill } from './grid.js';

const BLOCK_SHARE = 0.3;
const OVER_LAND = 0.3; // a deck closer than this to a land point passes over that island's land
const NEAR_FOOT = FOOT_ROOM; // ...except this close to its own feet, where it starts on land
const FACING = 0.01; // how far a pad may turn from its front, in radians (yaws are kept to 4 places)

export function checkTown(world) {
  const problems = checkShape(world);
  if (problems.length) return problems;
  const say = text => problems.push(text);
  const byId = new Map(world.islands.map(i => [i.id, i]));
  const thingsOn = new Map(world.islands.map(i => [i.id, []]));
  for (const thing of world.things) thingsOn.get(thing.island)?.push(thing);

  for (const island of world.islands) checkIsland(island, thingsOn.get(island.id), world.bridges, say);
  const land = landBuckets(world.islands);
  checkGaps(world.islands, land, say);
  checkBridges(world, byId, land, say);
  return problems;
}

function checkIsland(island, things, bridges, say) {
  const { grid, id } = island;
  const n = grid.points.length;
  const land = new Uint8Array(n), lane = new Uint8Array(n), kept = new Uint8Array(n), block = new Uint8Array(n);
  const thing = new Array(n).fill(null);
  for (const p of island.land) land[p] = 1;
  for (const p of island.lanes) lane[p] = 1;
  for (const p of island.kept) kept[p] = 1;
  for (const house of island.houses) for (const b of house.blocks) block[b.point] = 1;
  for (const t of things) for (const p of t.points) thing[p] = t;
  const neighbours = grid.neighbours;

  // Land: one piece, with no holes (every sky point can reach the grid's rim through sky).
  if (island.land.length) {
    const seen = spread(grid, [island.land[0]], p => land[p]);
    if (island.land.some(p => !seen[p])) say(`${id}'s land is in more than one piece`);
    const rim = grid.points.map((_, p) => p).filter(p => grid.fromRim[p] === 0 && !land[p]);
    const sky = spread(grid, rim, p => !land[p]);
    const hole = grid.points.findIndex((_, p) => !land[p] && !sky[p]);
    if (hole >= 0) say(`${id}'s land has a hole at point ${hole}`);
  }
  for (const p of island.kept) if (land[p]) say(`${id}'s kept sky covers land at point ${p}`);

  // Nothing shares a point with a lane or a block.
  for (const p of island.lanes) {
    if (block[p]) say(`${id} has a lane under a block at point ${p}`);
    if (thing[p]) say(`${id} has a lane under ${thing[p].id} at point ${p}`);
  }
  for (const house of island.houses) for (const b of house.blocks) if (thing[b.point]) say(`${id} has ${thing[b.point].id} on a block of ${house.id}`);

  // Doors, fronts and feet open onto lanes.
  for (const house of island.houses) {
    const { point, outside } = house.door ?? {};
    if (!house.blocks.some(b => b.point === point)) say(`${house.id}'s door isn't on one of its blocks`);
    else if (!neighbours[point].includes(outside)) say(`${house.id}'s door doesn't open onto a point next to it`);
    if (!lane[outside]) say(`${house.id}'s door opens onto point ${outside}, which isn't a lane`);
    for (const b of house.blocks) if (!Number.isInteger(b.floors) || b.floors < 1 || b.floors > MAX_FLOORS) say(`${house.id} has a block with ${b.floors} floors`);
  }
  for (const t of things) {
    if (!t.pad) continue;
    if (!lane[t.front]) say(`${t.id}'s front isn't a lane`);
    else if (!t.points.some(p => neighbours[p].includes(t.front))) say(`${t.id}'s front isn't next to it`);
    // ...and faces it, so its door looks onto the lane (coast buildings face the sky instead).
    else if (!t.coast) {
      // A kind that lies along its plot (the farmyard) turns its end or side toward the front instead (farmYaw).
      const [dx, dz] = KINDS[t.kind]?.along && t.points.length === 6
        ? [Math.sin(farmYaw(grid, t.points, t.at, t.front)), Math.cos(farmYaw(grid, t.points, t.at, t.front))]
        : [grid.points[t.front][0] - t.at[0], grid.points[t.front][1] - t.at[1]];
      const off = Math.atan2(Math.sin(t.yaw) * dz - Math.cos(t.yaw) * dx, Math.sin(t.yaw) * dx + Math.cos(t.yaw) * dz);
      if (Math.abs(off) > FACING) say(`${t.id} faces ${Math.round(Math.abs(off) * 180 / Math.PI)} degrees away from its front`);
    }
  }
  for (const bridge of bridges) for (const end of [bridge.from, bridge.to]) {
    if (end.island !== id) continue;
    if (!lane[end.point]) say(`${bridge.id}'s foot on ${id} isn't a lane`);
    if (!neighbours[end.point].some(q => !land[q])) say(`${bridge.id}'s foot on ${id} isn't on the coast`);
  }

  // Lanes are one network, from the plaza.
  if (island.lanes.length) {
    const reached = spread(grid, [island.lanes[0]], p => lane[p]);
    const lost = island.lanes.find(p => !reached[p]);
    if (lost !== undefined) say(`${id}'s lanes aren't joined: point ${lost} can't be reached from the plaza`);
  }

  // Every free point can be walked to from the plaza (walking around blocks and things that block).
  const walkable = p => land[p] && !block[p] && !(thing[p] && KINDS[thing[p].kind]?.blocks);
  if (island.lanes.length) {
    const walked = spread(grid, [island.lanes[0]], walkable);
    const stuck = island.land.filter(p => !lane[p] && !block[p] && !thing[p] && !walked[p]);
    if (stuck.length) say(`${id} has ${stuck.length} free point${stuck.length === 1 ? '' : 's'} nobody can walk to (point ${stuck[0]})`);
  }

  // Coast buildings have kept sky in front: each point on their outer side looks out onto kept sky. A point
  // near the grid's rim that land can never fill (canFill) is sky for good, so it counts as kept; the layout
  // doesn't list such points as kept (island.js keep).
  for (const t of things) {
    if (!t.coast) continue;
    const way = [Math.sin(t.coast.yaw), Math.cos(t.coast.yaw)];
    const along = p => (grid.points[p][0] - t.at[0]) * way[0] + (grid.points[p][1] - t.at[1]) * way[1];
    const most = Math.max(...t.points.map(along));
    const side = t.points.filter(p => along(p) > most - 0.3);
    for (const p of side) {
      const ahead = neighbours[p].filter(q => !t.points.includes(q)).sort((a, b) => along(b) - along(a))[0];
      if (ahead === undefined || !(kept[ahead] || !canFill(grid, ahead))) say(`${t.id} has no kept sky in front of point ${p}`);
    }
  }

  // The golden tree stands on its own point.
  for (const t of things) if (t.kind === 'goldentree' && (lane[t.points[0]] || block[t.points[0]])) say(`${id}'s golden tree isn't on a free point`);

  const blocks = island.houses.reduce((sum, h) => sum + h.blocks.length, 0);
  if (blocks > BLOCK_SHARE * island.land.length + 1e-9) say(`${id}'s blocks cover ${blocks} of ${island.land.length} land points, over ${BLOCK_SHARE * 100}%`);
}

// Every land point in the sky, in buckets SKY_GAP wide, for the two checks below.
function landBuckets(islands) {
  const buckets = new Map();
  for (const island of islands) {
    for (const p of island.land) {
      const x = island.at[0] + island.grid.points[p][0], z = island.at[1] + island.grid.points[p][1];
      const key = `${Math.floor(x / SKY_GAP)},${Math.floor(z / SKY_GAP)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ id: island.id, x, z });
    }
  }
  // Land points of any island within `far` (at most SKY_GAP) of [x, z].
  const near = (x, z, far) => {
    const found = [];
    const bx = Math.floor(x / SKY_GAP), bz = Math.floor(z / SKY_GAP);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const spot of buckets.get(`${bx + i},${bz + j}`) ?? []) if (Math.hypot(spot.x - x, spot.z - z) < far) found.push(spot);
    }
    return found;
  };
  return { buckets, near };
}

// Every pair of islands keeps SKY_GAP of sky between their land points.
function checkGaps(islands, land, say) {
  const least = new Map();
  for (const spots of land.buckets.values()) {
    for (const a of spots) {
      for (const b of land.near(a.x, a.z, SKY_GAP - 1e-6)) {
        if (b.id <= a.id) continue;
        const key = `${a.id} and ${b.id}`, d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!least.has(key) || d < least.get(key)) least.set(key, d);
      }
    }
  }
  for (const [pair, d] of least) say(`${pair} are only ${d.toFixed(2)} apart`);
}

function checkBridges(world, byId, land, say) {
  const lines = world.bridges.map(bridge => deckLine(world, bridge));
  world.bridges.forEach((bridge, k) => {
    const from = byId.get(bridge.from.island), to = byId.get(bridge.to.island);
    if (bridge.type === 'slide' && !(from.lift > to.lift)) say(`${bridge.id} is a water slide that doesn't run downhill`);
    // No deck passes over land, except where it starts at its own feet.
    const feet = [bridge.from, bridge.to].map(end => {
      const island = byId.get(end.island);
      return [island.at[0] + island.grid.points[end.point][0], island.at[1] + island.grid.points[end.point][1]];
    });
    const over = new Set();
    for (const [x, z] of lines[k]) {
      if (feet.some(([fx, fz]) => Math.hypot(x - fx, z - fz) < NEAR_FOOT)) continue;
      for (const spot of land.near(x, z, OVER_LAND)) over.add(spot.id);
    }
    for (const id of over) say(`${bridge.id}'s deck passes over ${id}'s land`);
  });
  // No two decks cross.
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      if (polylinesCross(lines[a], lines[b])) say(`${world.bridges[a].id} and ${world.bridges[b].id} cross`);
    }
  }
  // Every joined island can be walked to from home's plaza, over lanes and bridges.
  const home = byId.get('home');
  if (!home || !home.lanes.length) return;
  const lanesOf = new Map(world.islands.map(i => [i.id, new Set(i.lanes)]));
  const crossings = new Map();
  for (const bridge of world.bridges) {
    const [a, b] = [bridge.from, bridge.to].map(end => `${end.island}:${end.point}`);
    if (!crossings.has(a)) crossings.set(a, []);
    if (!crossings.has(b)) crossings.set(b, []);
    crossings.get(a).push(b);
    crossings.get(b).push(a);
  }
  const seen = new Set([`home:${home.lanes[0]}`]);
  const queue = [['home', home.lanes[0]]];
  for (let head = 0; head < queue.length; head++) {
    const [id, p] = queue[head];
    const next = byId.get(id).grid.neighbours[p].filter(q => lanesOf.get(id).has(q)).map(q => [id, q]);
    for (const key of crossings.get(`${id}:${p}`) ?? []) { const [other, q] = splitKey(key); next.push([other, q]); }
    for (const [i, q] of next) {
      const key = `${i}:${q}`;
      if (!seen.has(key)) { seen.add(key); queue.push([i, q]); }
    }
  }
  const reached = new Set([...seen].map(key => splitKey(key)[0]));
  const joined = new Set(world.bridges.flatMap(b => [b.from.island, b.to.island]));
  for (const id of joined) if (!reached.has(id)) say(`${id} is joined by a bridge but can't be walked to from home's plaza`);
}

const splitKey = key => { const at = key.lastIndexOf(':'); return [key.slice(0, at), Number(key.slice(at + 1))]; };

// Points reachable from `starts` through points that pass ok (starts always count).
function spread(grid, starts, ok) {
  const seen = new Uint8Array(grid.points.length);
  const queue = [];
  for (const s of starts) if (!seen[s]) { seen[s] = 1; queue.push(s); }
  for (let head = 0; head < queue.length; head++) {
    for (const q of grid.neighbours[queue[head]]) if (!seen[q] && ok(q)) { seen[q] = 1; queue.push(q); }
  }
  return seen;
}

// Do two polylines cross (or touch) anywhere?
function polylinesCross(a, b) {
  const box = line => line.reduce((m, [x, z]) => [Math.min(m[0], x), Math.min(m[1], z), Math.max(m[2], x), Math.max(m[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const [ax0, az0, ax1, az1] = box(a), [bx0, bz0, bx1, bz1] = box(b);
  if (ax1 < bx0 || bx1 < ax0 || az1 < bz0 || bz1 < az0) return false;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
  }
  return false;
}

function segmentsCross(p, q, r, s) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = cross(r, s, p), d2 = cross(r, s, q), d3 = cross(p, q, r), d4 = cross(p, q, s);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (o, a, b) => Math.min(o[0], a[0]) - 1e-9 <= b[0] && b[0] <= Math.max(o[0], a[0]) + 1e-9 && Math.min(o[1], a[1]) - 1e-9 <= b[1] && b[1] <= Math.max(o[1], a[1]) + 1e-9;
  return (Math.abs(d1) < 1e-12 && on(r, s, p)) || (Math.abs(d2) < 1e-12 && on(r, s, q)) || (Math.abs(d3) < 1e-12 && on(p, q, r)) || (Math.abs(d4) < 1e-12 && on(p, q, s));
}
