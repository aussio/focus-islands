// Natural decoration (game/BUILD_PLAN.md, "Natural things"). Plain code: no DOM, no Three.js.
//
//   decorate(isle) => [thing]   flowers, bushes, mushrooms, rocks, crystals and big coast trees
//
// Start things and the golden sapling are built things and never move. Everything here is light
// decoration, worked out fresh from the finished island. A free point shows something only if its own
// roll is under the chance for its place: beside a building, beside a lane, on the coast, or open lawn.
// Each point's answer depends only on the point, the points that share a cell with it, and fixed rolls,
// so decoration changes only right next to something new.
//
// Things helpers can't walk through (bushes, rocks, trees...) only go on "spaced" points: points whose
// spacing roll is the lowest of every grid point within 2 steps, fixed by the grid and island id. So two
// of them are never within 2 steps of each other. Each one also needs the walkable points that share a
// cell with it to stay joined around it, so it can never cut a way through.
import { KINDS } from '../kinds.js';
import { roll } from './grid.js';
import { round4 } from './island.js';

// Kinds and chances by island kind, moved over from the square layout (layout/island.js DECOR).
// Each list is [[kind, weight], ...] for a point beside a building, beside a lane, on the coast, or in
// open lawn; chance is how likely a free point there gets something.
export const DECOR = {
  home: {
    building: [['flower', 3], ['bush', 2]],
    path: [['flower', 5], ['bush', 1]],
    coast: [['bush', 3], ['flower', 2]],
    open: [['flower', 3], ['bush', 1]],
    chance: { building: 0.45, path: 0.4, coast: 0.3, open: 0.18 },
  },
  mossy: {
    building: [['mushroom', 2], ['bush', 2]],
    path: [['mushroom', 3], ['bush', 2]],
    coast: [['bush', 3], ['mushroom', 2]],
    open: [['mushroom', 2], ['bush', 1]],
    chance: { building: 0.35, path: 0.3, coast: 0.3, open: 0.12 },
  },
  rocky: {
    building: [['rock', 1]], path: [['rock', 1]], coast: [['rock', 1]], open: [['rock', 1]],
    chance: { building: 0.2, path: 0.15, coast: 0.25, open: 0.08 },
  },
  meadow: {
    building: [['flower', 1]], path: [['flower', 1]], coast: [['flower', 1]], open: [['flower', 1]],
    chance: { building: 0.55, path: 0.5, coast: 0.35, open: 0.25 },
  },
  crystal: {
    building: [['crystal', 1]], path: [['crystal', 1]], coast: [['crystal', 1]], open: [['crystal', 1]],
    chance: { building: 0.2, path: 0.15, coast: 0.25, open: 0.08 },
  },
  misty: {
    building: [['bush', 1]], path: [['bush', 1]], coast: [['bush', 1]], open: [['bush', 1]],
    chance: { building: 0.3, path: 0.25, coast: 0.3, open: 0.1 },
  },
};
// Big trees on coast points, by island kind.
export const BIG_TREE = { home: 0.06, mossy: 0.06, meadow: 0.06, misty: 0.06 };
// Things that count as buildings for "beside a building".
const BUILT = new Set(['pile', 'fire', 'flowers', 'lanterns']);

// Every point that shares a cell with p, p left out, in number order. Fixed by the grid.
const rings = new WeakMap();
export function ringOf(grid, p) {
  if (!rings.has(grid)) rings.set(grid, new Map());
  const cache = rings.get(grid);
  if (!cache.has(p)) cache.set(p, [...new Set(grid.around[p].flatMap(c => grid.cells[c]))].filter(q => q !== p).sort((a, b) => a - b));
  return cache.get(p);
}

// Points where a blocking decoration may stand: the lowest spacing roll of every point within 2 steps.
const spacedCache = new Map();
export function spacedPoints(grid, id) {
  const key = `${grid.key}|${id}`;
  if (!spacedCache.has(key)) {
    const rolls = grid.points.map((_, p) => roll('space', id, p));
    const mark = new Uint8Array(grid.points.length);
    grid.points.forEach((_, p) => {
      const near = new Set();
      for (const n of grid.neighbours[p]) { near.add(n); for (const m of grid.neighbours[n]) near.add(m); }
      near.delete(p);
      if ([...near].every(q => rolls[p] < rolls[q] || (rolls[p] === rolls[q] && p < q))) mark[p] = 1;
    });
    spacedCache.set(key, mark);
  }
  return spacedCache.get(key);
}

function pickWeighted(list, r) {
  const total = list.reduce((sum, [, weight]) => sum + weight, 0);
  let at = r * total;
  for (const [kind, weight] of list) { if (at < weight) return kind; at -= weight; }
  return list[list.length - 1][0];
}

// The walkable points that share a cell with p are one group (moving between them only), and at least
// one of p's neighbours can be walked on. Then something standing on p can't cut a way through.
function staysJoinedAround(isle, p) {
  const { grid } = isle;
  const open = ringOf(grid, p).filter(q => isle.isWalkable(q));
  if (!open.length || !grid.neighbours[p].some(q => isle.isWalkable(q))) return false;
  const inRing = new Set(open);
  const seen = new Set([open[0]]);
  const queue = [open[0]];
  for (let head = 0; head < queue.length; head++) {
    for (const n of grid.neighbours[queue[head]]) if (inRing.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen.size === open.length;
}

export function decorate(isle) {
  const { grid, id } = isle;
  const table = DECOR[isle.kind] ?? DECOR.home;
  const spaced = spacedPoints(grid, id);
  const things = [];
  for (const p of [...isle.land].sort((a, b) => a - b)) {
    if (!isle.isFree(p)) continue;
    const near = grid.neighbours[p];
    if (near.some(n => isle.entrance[n])) continue;
    const building = near.some(n => isle.blockOf[n] >= 0 || isle.taken[n]?.pad || BUILT.has(isle.taken[n]?.kind));
    const lane = near.some(n => isle.isLane[n]);
    const coast = near.some(n => !isle.isLand(n));
    const canBlock = () => spaced[p] && staysJoinedAround(isle, p);
    let kind = null;
    if (coast && roll('bigtree', id, p) < (BIG_TREE[isle.kind] ?? 0) && canBlock()) kind = 'tree';
    else {
      const place = building ? 'building' : lane ? 'path' : coast ? 'coast' : 'open';
      const { chance } = table;
      const odds = Math.max(chance.open, building ? chance.building : 0, lane ? chance.path : 0, coast ? chance.coast : 0);
      if (roll('decor', id, p) >= odds) continue;
      kind = pickWeighted(table[place], roll('decor-kind', id, p));
      if (KINDS[kind].blocks && !canBlock()) {
        if (!table[place].some(([k]) => k === 'flower')) continue;
        kind = 'flower';
      }
    }
    things.push({ id: `${id}:decor-${p}`, kind, island: id, points: [p], at: [...grid.points[p]],
      yaw: round4(roll('decor-yaw', id, p) * Math.PI * 2), scale: 1, pad: false, front: null, coast: null });
  }
  return things;
}
