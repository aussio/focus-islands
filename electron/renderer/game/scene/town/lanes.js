// One island's lanes, drawn as joined slab pieces (pieces.js) with a soft sloped rim.
//
//   buildLanes(ctx, island)
//
// Each lane point draws one piece per cell around it (key lane:<cell>:<k>): a strip toward each lane
// neighbour, the whole piece when the cell's four points are all lanes, and an open corner where the
// cell has no lane neighbour (openCorner below).
// The rim slopes down to the grass on open sides only; where the lane carries on into the next piece
// (a seam), there is no rim, so joined pieces read as one smooth lane.
//
// An open corner's outline is a smooth curve worked out in world space and then bent into the piece, so
// it looks the same whatever the cell's shape: it carries on the edge of the strip that arrives on each
// side, and goes round the point where the next piece is open too. So a lone point is round, a dead end
// gets a round cap, and the outside of a turn runs straight on from one strip's edge to the next. (A
// rounded square drawn in the piece's own unit square only looked right in square cells: in narrow ones
// it bulged past the lane's edge, a knob on the outside of turns and a lobed, flared dead end.)
//
// A lane also reaches a little way toward what it serves, drawn with the lane piece in the same cell:
// - under a house's door (the block whose door opens onto this lane point), ending just under the wall;
// - under the front of a pad (D's stone pad, for a thing whose front is this lane point);
// - onto a bridge deck: a short strip from each bridge foot along its way out, past the grass edge
//   (key lane:<cell>:<k>:deck:<bridge>, with the foot's first piece).
import { P, TOWN } from '../style.js';
import { PieceSink, cornerPiece, rimmedSlab } from './pieces.js';

const T = TOWN.laneWidth; // the strip's half width, in piece units
// The curve filling a turn's inside (added to the corner at [t, t]), in piece units.
const FILL = [[0.24, 0], [0.09, 0.03], [0.03, 0.09], [0, 0.24]];
const CURVE = 6; // segments in an open corner's curve
const RIM = 0.12; // the rim's width, in piece units
const Y = TOWN.laneRise;
const TOP = P.path, RIM_COLOUR = '#efdfc4', SIDE = '#e4d2b3';
// How far the lane reaches into the target's piece, from the target's point (piece units): a block's
// wall stands at 0.83 and a pad's edge at 0.74 (TOWN.padWidth), so these end just under them.
const REACH = { door: 0.75, pad: 0.64 };
const DECK = { length: 0.44, half: 0.13, back: 0.05, low: -0.07 }; // world units

export function buildLanes(ctx, island) {
  const { grid, lanes } = island;
  if (!lanes.size) return;
  const sink = new PieceSink(ctx);
  const mesh = sink.mesh('matte');
  const style = { y: Y, w: RIM, top: TOP, rim: RIM_COLOUR };

  // What each lane point reaches toward: lane point -> Map(target point -> how far from the target).
  const reach = new Map();
  const target = (o, r, d) => {
    if (!lanes.has(o) || lanes.has(r) || !grid.neighbours[o].includes(r)) return;
    if (!reach.has(o)) reach.set(o, new Map());
    reach.get(o).set(r, Math.min(d, reach.get(o).get(r) ?? 1));
  };
  for (const door of island.doors) target(door.outside, door.point, REACH.door);
  for (const thing of island.things) if (thing.pad && thing.front !== null) for (const r of thing.points) target(thing.front, r, REACH.pad);

  for (const o of lanes) {
    const targets = reach.get(o);
    const linked = q => lanes.has(q) || (targets?.has(q) ?? false); // a strip runs toward q
    for (const cell of grid.around[o]) {
      const k = grid.cells[cell].indexOf(o);
      const c = cornerPiece(grid, cell, k);
      sink.begin(`lane:${c.key}`);
      const fA = lanes.has(c.next), fB = lanes.has(c.prev), fO = lanes.has(c.opp);
      const rA = targets?.get(c.next), rB = targets?.get(c.prev);
      if (linked(c.next) || linked(c.prev)) lanePiece(mesh, c, linked(c.next), linked(c.prev), fA && fB && fO, style);
      else { const { poly, seams } = openCorner(grid, c, linked); rimmedSlab(mesh, c, poly, seams, style); }
      // The reach goes on into the target's own piece in this cell, along the side they share.
      if (rA !== undefined) rimmedSlab(mesh, cornerPiece(grid, cell, (k + 1) % 4), [[0, rA], [T, rA], [T, 1], [0, 1]], [false, false, true, true], style);
      if (rB !== undefined) rimmedSlab(mesh, cornerPiece(grid, cell, (k + 3) % 4), [[rB, 0], [1, 0], [1, T], [rB, T]], [true, true, false, false], style);
    }
  }

  // Onto each bridge deck: a short strip from the foot along its way out.
  for (const foot of island.feet) {
    if (!Number.isInteger(foot.point) || !Array.isArray(foot.out)) continue;
    const cell = grid.around[foot.point][0];
    sink.begin(`lane:${cell}:${grid.cells[cell].indexOf(foot.point)}:deck:${foot.bridge}`);
    deckStrip(mesh, grid.points[foot.point], foot.out);
  }
  sink.flush();
}

// One lane piece's outline in its unit square, with which edges are seams (the lane carries on there).
//   fA, fB: the strip toward next / prev (at least one); full: all four points are lanes.
function lanePiece(mesh, c, fA, fB, full, style) {
  const t = T;
  let poly, seams;
  if (full) { poly = [[0, 0], [1, 0], [1, 1], [0, 1]]; seams = [true, true, true, true]; }
  else if (fA && fB) {
    // The inside of a turn, filled with a small curve.
    poly = [[0, 0], [1, 0], [1, t], ...FILL.map(([u, v]) => [t + u, t + v]), [t, 1], [0, 1]];
    seams = [true, true, ...FILL.map(() => false), false, true, true];
  } else if (fA) { poly = [[0, 0], [1, 0], [1, t], [0, t]]; seams = [true, true, false, true]; }
  else { poly = [[0, 0], [t, 0], [t, 1], [0, 1]]; seams = [true, false, true, true]; }
  rimmedSlab(mesh, c, poly, seams, style);
}

// An open corner: piece c of a lane point has no strip toward next or prev. Its outline runs from the
// lane's edge on the side toward next (at(t, 0)) to its edge on the side toward prev (at(0, t)), as a
// curve in world space bent back into the piece.
//   linked(q): a strip runs from this point toward q.
//   => { poly, seams, ends: [[x, z], [x, z]], ways: [[dx, dz], [dx, dz]], curve: [[x, z], ...] }
// At each end the curve carries on the way the outline already runs there (ways): along the edge of
// the strip in the next piece round, if that piece has one; else square to the side, so the open
// pieces round a point join into one round curve. A cubic between the two ends, with handles for a
// circle's arc, keeps it round where it turns and straight where it doesn't.
export function openCorner(grid, c, linked) {
  const t = T;
  const p = grid.points[c.s];
  const start = c.at(t, 0), end = c.at(0, t);
  const out1 = unit2([start[0] - p[0], start[1] - p[1]]), out2 = unit2([end[0] - p[0], end[1] - p[1]]);
  const sense = out1[0] * out2[1] - out1[1] * out2[0] < 0 ? -1 : 1; // which way round the outline runs
  const square = v => [-v[1] * sense, v[0] * sense];
  const w1 = stripWay(grid, c, c.next, linked, true) ?? square(out1);
  const w2 = stripWay(grid, c, c.prev, linked, false) ?? square(out2);
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const turn = Math.acos(Math.max(-1, Math.min(1, w1[0] * w2[0] + w1[1] * w2[1])));
  const handle = turn > 1e-3 ? chord * (2 / 3) * Math.tan(turn / 4) / Math.sin(turn / 2) : chord / 3;
  const h1 = [start[0] + w1[0] * handle, start[1] + w1[1] * handle], h2 = [end[0] - w2[0] * handle, end[1] - w2[1] * handle];
  const curve = [];
  for (let i = 1; i < CURVE; i++) {
    const s = i / CURVE, r = 1 - s;
    const k0 = r * r * r, k1 = 3 * r * r * s, k2 = 3 * r * s * s, k3 = s * s * s;
    curve.push([k0 * start[0] + k1 * h1[0] + k2 * h2[0] + k3 * end[0], k0 * start[1] + k1 * h1[1] + k2 * h2[1] + k3 * end[1]]);
  }
  const poly = [[0, 0], [t, 0], ...curve.map(c.unit), [0, t]];
  const seams = poly.map((_, i) => i === 0 || i === poly.length - 1);
  return { poly, seams, ends: [start, end], ways: [w1, w2], curve };
}

// The way the outline runs where it crosses the side from c's point toward m (c.next or c.prev), when
// the piece across that side has a strip (toward its other neighbour): along the strip's outer edge,
// arriving (into c) or leaving (out of c). null when that piece is open too.
function stripWay(grid, c, m, linked, arriving) {
  const cell = grid.around[c.s].find(e => e !== c.cell && grid.cells[e].includes(m));
  if (cell === undefined) return null;
  const d = cornerPiece(grid, cell, grid.cells[cell].indexOf(c.s));
  const far = d.next === m ? d.prev : d.next;
  if (!linked(far)) return null;
  // The strip toward far: its outer edge runs from the shared side (a) away from it (b).
  const [a, b] = far === d.next ? [d.at(0, T), d.at(1, T)] : [d.at(T, 0), d.at(T, 1)];
  return arriving ? unit2([a[0] - b[0], a[1] - b[1]]) : unit2([b[0] - a[0], b[1] - a[1]]);
}

const unit2 = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// A straight strip from a foot point along `out` (a unit [dx, dz]), at lane height, with sloped sides
// and an end that drops below the grass edge so it reads as running onto the deck.
function deckStrip(mesh, [x, z], [dx, dz]) {
  const side = [-dz, dx];
  const at = (along, across, y) => [x + dx * along + side[0] * across, y, z + dz * along + side[1] * across];
  const { length, half, back, low } = DECK, inner = half - 0.03;
  const up = [0, 1, 0];
  mesh.quad(at(-back, -inner, Y), at(length, -inner, Y), at(length, inner, Y), at(-back, inner, Y), TOP, up);
  for (const s of [-1, 1]) {
    const out = [side[0] * s, 0.6, side[1] * s];
    mesh.quad(at(-back, s * inner, Y), at(length, s * inner, Y), at(length, s * half, -0.004), at(-back, s * half, -0.004), RIM_COLOUR, out);
    mesh.quad(at(length * 0.4, s * half, -0.004), at(length, s * half, -0.004), at(length, s * half, low), at(length * 0.4, s * half, low), SIDE, [side[0] * s, 0, side[1] * s]);
  }
  const end = [dx, 0, dz];
  mesh.quad(at(length, -inner, Y), at(length, inner, Y), at(length, half, -0.004), at(length, -half, -0.004), RIM_COLOUR, [dx, 0.6, dz]);
  mesh.quad(at(length, -half, -0.004), at(length, half, -0.004), at(length, half, low), at(length, -half, low), SIDE, end);
}
