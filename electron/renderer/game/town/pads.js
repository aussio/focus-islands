// Special buildings on pads, flower beds and lanterns (game/BUILD_PLAN.md, "Pads for special
// buildings"). Plain code: no DOM, no Three.js.
//
//   placeBuilding(isle, id, kind) => points | null
//   footOptions(grid, foot, land, ok) => [{ points, at, cells, sides }]   every way a footprint fits
//   padFit(grid, cells) => number   a pad's cell size ÷ 0.62, kept between 0.85 and 1.15
//
// A pad sits on free land off the coast, not next to a block, and never cuts off a free point from the
// lanes or a point helpers can walk to (when nothing fits, the coast and spots beside blocks are allowed;
// when still nothing fits, it may squeeze in and cut off coast points and points that hold something,
// and a free point nobody can walk to any more gets a hedge). Its front is the point next to it closest
// to the lanes; a lane joins it and the model faces it. Coast buildings (lighthouse, sky waterfall,
// airship dock) sit with one side on the coast, face the sky, and keep a bay of sky in front of them
// open for good: every grid point ahead of that side within a wedge that starts as wide as the side and
// widens by BAY_ANGLE on each side (bayOf). It must be all sky when the building comes, and it never
// crosses a bridge's pier.
import { KINDS } from '../kinds.js';
import { roll, canFill } from './grid.js';
import { straightOut } from './growth.js';
import { joinLane } from './lanes.js';
import { round4, yawOf, middleOf, SQUEEZE } from './island.js';

const NO_WAY = 99;
export const BAY_ANGLE = 35; // degrees: how fast a coast building's bay widens on each side
const BAY_MARGIN = 0.4; // the bay's mouth is this much wider than the side on each side
const BAY_HALF = 1.6; // and it widens until it is this far from its middle line on each side (grid.test.js: room)
const BAY_COST = 0.25; // score for each point of land a bay takes from the island: shallow bays (headlands) first
// Facing cost for a way [dx, dz]: south 0, east and west 0.7, north 2.4, smooth in between.
export const facingCost = ([dx, dz]) => { const c = 1 - dz / (Math.hypot(dx, dz) || 1); return 0.2 * c + 0.5 * c * c; };
const facesNorth = ([dx, dz]) => dz < -0.5 * Math.hypot(dx, dz);

export function placeBuilding(isle, id, kind) {
  const def = KINDS[kind];
  const { grid } = isle;
  const lanterns = kind === 'lanterns';
  // Pads stay off the coast and away from blocks, unless nothing fits that way (isle.loose, LOOSE or
  // SQUEEZE: see Isle.withRoom). Flower beds and lanterns aren't pads and may stand on the coast; lanterns
  // need a lane beside them unless nothing fits.
  const ok = p => isle.isFree(p) && (def.edge || !def.pad || isle.loose || !isle.isCoast(p))
    && (!def.pad || isle.loose || !isle.nextToBlock(p))
    && (!lanterns || isle.loose || grid.neighbours[p].some(n => isle.isLane[n]));
  const fromPlaza = isle.stepsFrom([isle.plaza], p => isle.isLand(p));
  const fromLane = isle.stepsFrom(isle.lanes, p => isle.isFree(p));
  const wanted = 3 + isle.thingsCount() / 4;
  const frontOf = option => {
    const inPad = new Set(option.points);
    let best = null;
    for (const p of option.points) for (const n of grid.neighbours[p]) {
      if (inPad.has(n) || fromLane[n] < 0) continue;
      if (best === null || fromLane[n] < fromLane[best] || (fromLane[n] === fromLane[best] && n < best)) best = n;
    }
    return best;
  };
  const gapOf = option => Math.abs(Math.min(...option.points.map(p => (fromPlaza[p] < 0 ? NO_WAY : fromPlaza[p]))) - wanted);
  const options = [];
  for (const option of footOptions(grid, def.foot, isle.land, ok)) {
    const front = def.pad ? frontOf(option) : null;
    if (def.pad && front === null) continue;
    const base = 3 * isle.crowd(option.points) + 4 * roll(id, 'pad', option.points[0]) + (front === null ? 0 : 2 * fromLane[front]);
    if (def.edge) {
      // One side on the coast, with clear sky straight out from it that nothing else keeps.
      for (const side of option.sides) {
        if (!side.every(p => isle.isCoast(p))) continue;
        const mid = middleOf(side.map(p => grid.points[p]));
        const way = [mid[0] - option.at[0], mid[1] - option.at[1]];
        if (side.some(p => straightOut(grid, p, way).length < 3)) continue;
        const bay = bayOf(grid, option, side, way, p => isle.isLand(p) || isle.pierAt[p] >= 0 || isle.holds.has(p));
        if (!bay) continue;
        const room = bay.filter(p => canFill(grid, p)).length;
        options.push({ ...option, front, way, bay, side, score: 10 * facingCost(way) + (facesNorth(way) ? 100 : 0) + base + BAY_COST * room });
      }
    } else if (def.pad) {
      options.push({ ...option, front, score: 10 * gapOf(option) + facingCost([grid.points[front][0] - option.at[0], grid.points[front][1] - option.at[1]]) + base });
    } else {
      // Flower beds like to sit beside a house or a lane.
      const beside = def.foot === 'pair' && option.points.some(p => grid.neighbours[p].some(n => isle.isLane[n] || isle.blockOf[n] >= 0));
      // They keep inland points for pads where they can (5 for each inland point).
      options.push({ ...option, front: null, score: 10 * gapOf(option) + (beside ? -5 : 0) + base + 5 * option.points.filter(p => isle.isInland(p)).length });
    }
  }
  options.sort((a, b) => a.score - b.score || a.points[0] - b.points[0]);
  for (const option of options) {
    const hedges = def.pad && isle.loose === SQUEEZE ? [] : null;
    if (!isle.staysReachable(option.points, hedges)) continue;
    const thing = isle.addThing({
      id, kind, island: isle.id, points: [...option.points], at: [...option.at], yaw: yawFor(isle, def, option, id),
      scale: def.pad ? padFit(grid, option.cells) : 1, pad: Boolean(def.pad), front: option.front,
      coast: def.edge ? { yaw: yawOf(option.way), width: round4(Math.hypot(grid.points[option.side.at(-1)][0] - grid.points[option.side[0]][0], grid.points[option.side.at(-1)][1] - grid.points[option.side[0]][1])) } : null,
    });
    if (option.front !== null && !joinLane(isle, option.front)) {
      // The front can't reach the lanes once the pad stands here: take it away and try the next.
      isle.things.pop();
      for (const p of thing.points) isle.taken[p] = null;
      isle.entrance[option.front] = 0;
      isle.changed();
      continue;
    }
    if (def.edge) isle.keep(option.bay);
    // Free points the pad squeezed off, which nobody can walk to: a hedge on each, so none stays empty.
    (hedges ?? []).forEach((p, k) => isle.addThing({ id: `${id}:hedge-${k + 1}`, kind: 'bush', island: isle.id, points: [p], at: [...grid.points[p]],
      yaw: round4(roll('yaw', id, 'hedge', p) * Math.PI * 2), scale: 1, pad: false, front: null, coast: null }));
    return option.points;
  }
  return null;
}

// A coast building's bay: the grid points ahead of its coast side (along `way` from the building's
// middle), within half the side's length plus BAY_MARGIN of the middle line, plus tan(BAY_ANGLE) for
// every unit ahead up to BAY_HALF; and the points straight out from each side point, so each looks out
// onto sky. Sorted by point number. blocked(p): if any bay point is blocked, it gives up and returns null.
// It walks out from the side through neighbours a little beyond the bay (BAY_WALK), so it never looks at
// the whole grid.
const BAY_WALK = 1.0;
export function bayOf(grid, option, side, way, blocked = () => false) {
  const length = Math.hypot(way[0], way[1]) || 1;
  const ux = way[0] / length, uz = way[1] / length;
  const [ax, az] = option.at;
  const along = p => (grid.points[p][0] - ax) * ux + (grid.points[p][1] - az) * uz;
  const aside = p => Math.abs((grid.points[p][0] - ax) * uz - (grid.points[p][1] - az) * ux);
  const front = Math.max(...side.map(along));
  const half = Math.max(...side.map(aside)) + BAY_MARGIN;
  const widen = Math.tan(BAY_ANGLE * Math.PI / 180);
  const limit = a => Math.max(half, Math.min(BAY_HALF, half + Math.max(0, a) * widen));
  const own = new Set(option.points);
  const bay = new Set();
  const seen = new Set(side);
  const queue = [...side];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const a = along(p) - front;
    if (!own.has(p) && a > 0.05 && aside(p) <= limit(a)) {
      if (blocked(p)) return null;
      bay.add(p);
    }
    for (const n of grid.neighbours[p]) {
      if (seen.has(n)) continue;
      seen.add(n);
      const b = along(n) - front;
      if (b > 0.05 - BAY_WALK && aside(n) <= limit(b) + BAY_WALK) queue.push(n);
    }
  }
  for (const p of side) {
    for (const q of straightOut(grid, p, way)) {
      if (bay.has(q) || own.has(q)) continue;
      if (blocked(q)) return null;
      bay.add(q);
    }
  }
  return [...bay].sort((a, b) => a - b);
}

function yawFor(isle, def, option, id) {
  const { grid } = isle;
  if (def.edge) return yawOf(option.way);
  if (option.front !== null) return yawOf([grid.points[option.front][0] - option.at[0], grid.points[option.front][1] - option.at[1]]);
  if (def.foot === 'pair') {
    // A flower bed lies along its two points and faces the camera's side.
    const [a, b] = option.points.map(p => grid.points[p]);
    const along = [b[0] - a[0], b[1] - a[1]];
    return yawOf(along[0] >= 0 ? [-along[1], along[0]] : [along[1], -along[0]]);
  }
  // Lanterns face their lane.
  const p = option.points[0];
  const lane = grid.neighbours[p].find(n => isle.isLane[n]);
  return lane === undefined ? round4(roll('yaw', id) * Math.PI * 2) : yawOf([grid.points[lane][0] - grid.points[p][0], grid.points[lane][1] - grid.points[p][1]]);
}

// The points a footprint could cover, where every point passes ok. Each option has its points (in the
// order shape.js gives), its middle `at`, its cells, and its sides (for coast buildings).
export function footOptions(grid, foot, land, ok) {
  const out = [];
  if (foot === 'point') for (const p of land) if (ok(p)) out.push({ points: [p], at: [...grid.points[p]], cells: [], sides: [] });
  if (foot === 'pair') {
    for (const p of land) if (ok(p)) for (const q of grid.neighbours[p]) if (q > p && ok(q)) out.push({ points: [p, q], at: middleOf([grid.points[p], grid.points[q]]), cells: [], sides: [] });
  }
  if (foot === 'cell' || foot === 'cells') {
    const good = [...new Set(land.flatMap(p => grid.around[p]))].filter(c => grid.cells[c].every(ok)).sort((a, b) => a - b);
    const isGood = new Set(good);
    for (const c of good) {
      const q = grid.cells[c];
      if (foot === 'cell') { out.push({ points: [...q], at: [...grid.centres[c]], cells: [c], sides: q.map((p, k) => [p, q[(k + 1) % 4]]) }); continue; }
      for (let k = 0; k < 4; k++) {
        // The cell across side k (q[k], q[k + 1]), if it is good too.
        const d = grid.around[q[k]].find(e => e !== c && grid.cells[e].includes(q[(k + 1) % 4]));
        if (d === undefined || d <= c || !isGood.has(d)) continue;
        const r = grid.cells[d];
        // Turn both cells so the shared side comes first: q = s1 s2 a3 a4, r = s2 s1 b3 b4.
        const a = [0, 1, 2, 3].map(i => q[(k + i) % 4]);
        const j = r.indexOf(a[1]);
        const b = [0, 1, 2, 3].map(i => r[(j + i) % 4]);
        out.push({
          points: [...q, ...r.filter(p => !q.includes(p))], at: middleOf([grid.centres[c], grid.centres[d]]), cells: [c, d],
          sides: [[a[3], a[0], b[2]], [b[3], a[1], a[2]]], // the two long sides
        });
      }
    }
  }
  if (foot === 'ring') {
    for (const m of land) {
      if (grid.around[m].length !== 4) continue;
      const points = [...new Set(grid.around[m].flatMap(c => grid.cells[c]))];
      if (points.length !== 9 || !points.every(ok)) continue;
      out.push({ points: [m, ...points.filter(p => p !== m).sort((a, b) => a - b)], at: [...grid.points[m]], cells: [...grid.around[m]], sides: [] });
    }
  }
  return out;
}

export function padFit(grid, cells) {
  if (!cells.length) return 1;
  const size = cells.reduce((sum, c) => {
    const q = grid.cells[c].map(p => grid.points[p]);
    return sum + (Math.hypot(q[0][0] - q[2][0], q[0][1] - q[2][1]) + Math.hypot(q[1][0] - q[3][0], q[1][1] - q[3][1])) / 2 / Math.SQRT2;
  }, 0) / cells.length;
  return round4(Math.min(1.15, Math.max(0.85, size / 0.62)));
}

