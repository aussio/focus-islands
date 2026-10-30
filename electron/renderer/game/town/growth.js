// The order in which an island's grid points become land, and the land for a given count.
// Ported from the grid prototype (wonky/layout.js). Plain code: no DOM, no Three.js.
//
//   growthOrder(grid, id) => [p, ...]   every point that can ever fill, in the order it fills
//   fillLand(grid, order, count, kept) => [p, ...]   the first `count` land points, in fill order
//   straightOut(grid, from, dir) => [p, ...]   the points straight out from a point to the rim
//
// Land grows as a soft, lobed blob from the point nearest the middle, so any first n points are one
// piece. The order is fixed by the grid and the island id, so more land never moves old land.
import { canFill, mulberry, hashText, roll } from './grid.js';

const orders = new Map(); // `${grid.key}|${id}` -> frozen order

export function growthOrder(grid, id = grid.id) {
  const key = `${grid.key}|${id}`;
  if (!orders.has(key)) orders.set(key, Object.freeze(makeOrder(grid, String(id))));
  return orders.get(key);
}

// The first point: the point with exactly four cells around it that is nearest the grid's middle.
export function startPoint(grid) {
  let start = -1, best = Infinity;
  grid.points.forEach((p, i) => {
    const d = Math.hypot(p[0], p[1]);
    if (canFill(grid, i) && grid.around[i].length === 4 && d < best) { best = d; start = i; }
  });
  return start;
}

function makeOrder(grid, id) {
  // Three seeded waves around the island stretch the distance, so it grows in soft lobes.
  const rand = mulberry(hashText(`grow:${id}`));
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const lobe = a => 0.5 * Math.sin(2 * a + phases[0]) + 0.35 * Math.sin(3 * a + phases[1]) + 0.2 * Math.sin(5 * a + phases[2]);
  const start = startPoint(grid);
  const [sx, sz] = grid.points[start];
  const lobed = i => {
    const [x, z] = grid.points[i];
    const d = Math.hypot(x - sx, z - sz), a = Math.atan2(z - sz, x - sx);
    return d * (1 + 0.22 * lobe(a) * Math.min(1, d / (grid.edge * 3))) + roll('jit', id, i) * grid.edge * 0.15;
  };
  // Keep taking the waiting neighbour with the smallest lobed distance (ties: the lower point number).
  const order = [start];
  const seen = new Set([start]);
  const waiting = [];
  const push = i => {
    for (const n of grid.neighbours[i]) if (!seen.has(n) && canFill(grid, n)) { seen.add(n); waiting.push({ i: n, k: lobed(n) }); }
  };
  push(start);
  while (waiting.length) {
    let best = 0;
    for (let w = 1; w < waiting.length; w++) {
      const a = waiting[w], b = waiting[best];
      if (a.k < b.k || (a.k === b.k && a.i < b.i)) best = w;
    }
    const next = waiting[best];
    waiting[best] = waiting[waiting.length - 1];
    waiting.pop();
    order.push(next.i);
    push(next.i);
  }
  return order;
}

// Walks the order, skipping kept points. A point with no land neighbour yet waits until one fills,
// then goes next, so land is always one piece. kept: a Set (or list) of points that stay sky.
// With the same order and kept, a bigger count only adds to the end.
export function fillLand(grid, order, count, kept = null) {
  const skip = kept instanceof Set ? kept : new Set(kept ?? []);
  const land = [];
  const isLand = new Uint8Array(grid.points.length);
  const touches = i => grid.neighbours[i].some(n => isLand[n]);
  const add = i => { land.push(i); isLand[i] = 1; };
  const waiting = [];
  for (const i of order) {
    if (land.length >= count) break;
    if (skip.has(i)) continue;
    if (land.length && !touches(i)) { waiting.push(i); continue; }
    add(i);
    // Waiting points that now touch land go next, earliest first.
    for (let w = waiting.findIndex(touches); w >= 0 && land.length < count; w = waiting.findIndex(touches)) add(waiting.splice(w, 1)[0]);
  }
  return land;
}

// The points straight out from `from` along dir ([dx, dz]) to the grid's rim, for the kept sky in
// front of bridge feet and coast buildings. Each step takes the neighbour that moves on along dir and
// stays closest to the line (ties: more progress). If no neighbour moves on far enough, it takes the one
// that moves on most, so the list always ends on a rim point.
export function straightOut(grid, from, dir) {
  const length = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / length, uz = dir[1] / length;
  const [fx, fz] = grid.points[from];
  const along = i => (grid.points[i][0] - fx) * ux + (grid.points[i][1] - fz) * uz;
  const aside = i => Math.abs((grid.points[i][0] - fx) * uz - (grid.points[i][1] - fz) * ux);
  const out = [];
  let at = from;
  while (grid.fromRim[at] > 0 && out.length < 100) {
    let best = -1, most = -1;
    for (const n of grid.neighbours[at]) {
      if (along(n) > along(at) + 1e-9 && (most < 0 || along(n) > along(most))) most = n;
      if (along(n) < along(at) + grid.edge * 0.15) continue;
      if (best < 0 || aside(n) < aside(best) - 1e-9 || (Math.abs(aside(n) - aside(best)) <= 1e-9 && along(n) > along(best))) best = n;
    }
    if (best < 0) best = most;
    if (best < 0) break;
    out.push(best);
    at = best;
  }
  return out;
}
