// One island's lanes, drawn as joined slab pieces (pieces.js) with a soft sloped rim.
//
//   buildLanes(ctx, island)
//
// Each lane point draws one piece per cell around it (key lane:<cell>:<k>): a rounded blob by the point,
// a strip toward each lane neighbour, and the whole piece when the cell's four points are all lanes.
// The rim slopes down to the grass on open sides only; where the lane carries on into the next piece
// (a seam), there is no rim, so joined pieces read as one smooth lane.
//
// A lane also reaches a little way toward what it serves, drawn with the lane piece in the same cell:
// - under a house's door (the block whose door opens onto this lane point), ending just under the wall;
// - under the front of a pad (D's stone pad, for a thing whose front is this lane point);
// - onto a bridge deck: a short strip from each bridge foot along its way out, past the grass edge
//   (key lane:<cell>:<k>:deck:<bridge>, with the foot's first piece).
import { P, TOWN } from '../style.js';
import { PieceSink, cornerPiece, rimmedSlab } from './pieces.js';

const T = TOWN.laneWidth; // the strip's half width, in piece units
// An open corner's rounded outline (times the lane's half width), and the curve filling a turn's inside
// (added to the corner at [t, t]), in piece units.
const ROUND = [[1, 0], [1, 0.42], [0.88, 0.7], [0.7, 0.88], [0.42, 1], [0, 1]];
const FILL = [[0.24, 0], [0.09, 0.03], [0.03, 0.09], [0, 0.24]];
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
    for (const cell of grid.around[o]) {
      const k = grid.cells[cell].indexOf(o);
      const c = cornerPiece(grid, cell, k);
      sink.begin(`lane:${c.key}`);
      const fA = lanes.has(c.next), fB = lanes.has(c.prev), fO = lanes.has(c.opp);
      const rA = targets?.get(c.next), rB = targets?.get(c.prev);
      lanePiece(mesh, c, fA || rA !== undefined, fB || rB !== undefined, fA && fB && fO, style);
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
//   fA, fB: the strip toward next / prev; full: all four points are lanes.
function lanePiece(mesh, c, fA, fB, full, style) {
  const t = T;
  let poly, seams;
  if (full) { poly = [[0, 0], [1, 0], [1, 1], [0, 1]]; seams = [true, true, true, true]; }
  else if (fA && fB) {
    // The inside of a turn, filled with a small curve.
    poly = [[0, 0], [1, 0], [1, t], ...FILL.map(([u, v]) => [t + u, t + v]), [t, 1], [0, 1]];
    seams = [true, true, ...FILL.map(() => false), false, true, true];
  } else if (fA) { poly = [[0, 0], [1, 0], [1, t], [0, t]]; seams = [true, true, false, true]; }
  else if (fB) { poly = [[0, 0], [t, 0], [t, 1], [0, 1]]; seams = [true, false, true, true]; }
  else {
    // An open corner, rounded: four of these make a round end or a round lone point.
    poly = [[0, 0], ...ROUND.map(([u, v]) => [u * t, v * t])];
    seams = [true, ...ROUND.slice(1).map(() => false), true];
  }
  rimmedSlab(mesh, c, poly, seams, style);
}

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
