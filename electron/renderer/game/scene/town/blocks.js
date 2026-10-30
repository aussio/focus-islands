// One island's block houses: walls, roofs, gables, trim, windows, doors and chimneys, drawn piece by
// piece on the island's uneven grid (pieces.js). Ported from the grid prototype (wonky/island.js), with
// gabled roofs added. Stream C2 owns this file.
//
//   buildBlocks(ctx, island)       draws every block of the island (scene/town/world.js) into ctx.batch
//   planRoofs(island) => { arms: Map(p -> Set of points), doors: Map(p -> outside), chimneys: Map(p -> cell) }
//   roofLift(armA, armB) => (a, b) => d   the roof's height in a corner piece, 0 at the eave, 1 at the ridge
//
// Everything is in island units (grid points as they are, y = 0 at the grass top).
//
// How a block is drawn
// - A block stands on its point's area: the corner pieces of the cells around that point. Each storey of
//   each corner piece is drawn on its own (keys block:<cell>:<k>:<storey>:<part>), and looks only at its
//   own point, the next and previous points of the cell and the opposite one. Blocks on neighbouring
//   points meet along the same lines, so they join without cracks.
// - Walls stand TOWN.wallInset in from the area's edge, between filled and empty parts of a piece
//   (parts() in pieces.js). Outer corners get a white corner board. Where the storey above steps in, the
//   part it leaves gets a white ledge.
// - Roofs cover the whole area, so they overhang the walls to the area's edge. The top storey's walls
//   rise to the roof's underside, so where a ridge reaches an open end the wall goes up to a point: the
//   gable, in the wall colour.
//
// Ridges and roofs
// - Each top block has arms: the neighbours its ridge runs toward.
//   - Links: every neighbour with the same number of storeys is linked, so ridges run along straight
//     rows, turn at corners and meet at Ts and crosses. A cell whose four points are all the same height
//     would make a ring of ridges with a pit in the middle, so such a cell keeps only its more
//     north-south pair of opposite sides linked: a block of four becomes two gabled rows side by side,
//     with a valley between them. Links are decided per side, so they always go both ways.
//   - Gable arms, toward lower neighbours: a row end (one link) carries its ridge on to the lower
//     neighbour most nearly opposite its link; a lone block runs its ridge between the two most nearly
//     opposite lower neighbours along its longer way, when the two split its other neighbours evenly
//     (a bent ridge over a lone block leaves an odd valley on one side). Without a fitting neighbour
//     (three-way points, and five-way points for a lone block), the end is a hip, and a lone block
//     gets a pyramid roof.
//   - Two arms that share a cell are always links: the cell between them gets a valley.
// - In a corner piece with arms toward its next point (A) and previous point (B), the roof height is
//   eave + roofRise × d(a, b) (roofLift): A only: 1 - b; B only: 1 - a; neither: min(1 - a, 1 - b), a hip;
//   both: max(1 - a, 1 - b), a valley. Along every line two pieces share, both give the same height, so
//   roofs meet without steps: on a link the ridge runs on; between same-height blocks that aren't
//   linked, and toward taller ones, both sides come down to the eave, where a ledge or a valley meets it.
// - White boards run along every open roof edge (sloped along a gable, level along an eave), with a
//   shaded underside beneath the overhang. A thin white trim runs along every ridge.
//
// Windows, doors and chimneys: every choice is a roll of the island id, the point, the cell and the
// storey (town/grid.js roll), so nothing shuffles as the town grows. Each house has one door, centred on
// the ground-floor wall that faces its outside point (where its lane arrives). Windows use the glass
// material, so they glow at dusk (moodMaterials in style.js). A join wall (one that faces a lower block,
// just behind that block's roof) has windows only when it faces the camera's side: seen side-on from
// Today, their boxes stick out past the corner board as a ragged pale strip along the lower roof.
//
// Small looks (look only; nothing is saved), each picked by hashString on the thing's own id with its own
// pick name, so the rolls above never change (chances in LOOKS, which tests and the gallery may change):
// - window boxes: about 1 in 4 windows gets a wooden box of flowers under its sill (key ...:box:<side>);
// - nests: about 1 in 6 chimneys has a twig nest on its cap (in the chimney's own piece);
// - smoke: about 3 in 5 chimneys without a nest send up a few soft puffs in the evening moods (break,
//   away, and fainter at night in done), none by day. The puffs share one instanced mesh per island,
//   rise slowly with scene time (ctx.dynamic), stand still at time 0 and never cast shadows. At most
//   SMOKE.chimneys chimneys per island smoke. They are not in the piece log or the triangle stats.
//
// What a piece draws depends only on points within two grid steps of its own: its four cell points, the
// arms of its point (which look at its neighbours and the cells around it) and the door of its point.
import * as THREE from 'three';
import { P, TOWN, HOUSE_LOOKS } from '../style.js';
import { hashString } from '../ground.js';
import { roll } from '../../town/grid.js';
import { PieceSink, cornerPiece, frameBox, midpoint, parts, shade, wallFrame } from './pieces.js';

const H = TOWN.storey, RISE = TOWN.roofRise, FASCIA = TOWN.fascia;
const T = 1 - TOWN.wallInset; // the wall line, in piece units
const FOOT = -0.02; // walls start a little under the grass
const LIP = 0.028; // boards stand this far above the roof
const BOARD = 0.09; // board width on the roof, in piece units
const OPPOSITE = -0.7; // two neighbours are roughly opposite when the cosine between them is below this
const RIDGE = { half: 0.022, up: 0.03, down: 0.014 }; // the ridge trim's half width and height
const CHANCE = { window: 0.88, chimney: 0.24, attic: 0.55 };
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const AO = { ground: 0, height: 0.32, min: 0.6 };
const FACING = 0.4; // a wall faces the camera's side when its outward way points at least this much south
// Chances of the small looks, and their pick names (hashString of the parts and the name).
export const LOOKS = { box: 1 / 4, nest: 1 / 6, smoke: 3 / 5 };
const LOOK_NAMES = { box: 'window-box', nest: 'chimney-nest', smoke: 'chimney-smoke' };
export const hasLook = (look, ...parts) => hashString(`${parts.join(':')}:${LOOK_NAMES[look]}`) < LOOKS[look];
// Chimney smoke: at most this many chimneys per island, puffs each, seconds per puff, how high a puff
// rises, and its strength per mood (0: none).
export const SMOKE = { chimneys: 8, puffs: 3, seconds: 9, rise: 0.55, opacity: { focus: 0, break: 0.6, away: 0.5, done: 0.32 } };
const SMOKE_COLOUR = { focus: '#f4eef6', break: '#fde8ee', away: '#e6e4f0', done: '#b8bfe6' };
const BREEZE = 0.35; // the windmills' wind (models/making.js WIND): smoke leans away from it

const edgeKey = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);
const byNumber = (a, b) => a - b;
const lookOf = n => HOUSE_LOOKS[(((Number.isInteger(n) ? n : 0) % HOUSE_LOOKS.length) + HOUSE_LOOKS.length) % HOUSE_LOOKS.length];

// ---------- The roof's shape ----------

// d(a, b) in a corner piece: 1 on the ridge, 0 at the eave. armA: the ridge runs toward the next point;
// armB: toward the previous one.
export function roofLift(armA, armB) {
  if (armA && armB) return (a, b) => Math.max(1 - a, 1 - b);
  if (armA) return (a, b) => 1 - b;
  if (armB) return a => 1 - a;
  return (a, b) => Math.min(1 - a, 1 - b);
}

// Ridge arms, doors and chimneys for every block of the island.
export function planRoofs(island) {
  const { grid, floors } = island;
  const fl = p => floors.get(p) ?? 0;
  const points = [...floors.keys()].sort(byNumber);

  // Sides that stay unlinked: a cell whose four points are the same height keeps only its more
  // north-south pair of opposite sides.
  const off = new Set();
  const cells = new Set();
  for (const p of points) for (const cell of grid.around[p]) cells.add(cell);
  for (const cell of [...cells].sort(byNumber)) {
    const q = grid.cells[cell];
    const f = fl(q[0]);
    if (!f || q.some(p => fl(p) !== f)) continue;
    const [p0, p1, p2, p3] = q.map(p => grid.points[p]);
    const northSouth = (x, z) => Math.abs(z) / (Math.hypot(x, z) || 1);
    const first = northSouth(p1[0] - p0[0] + p2[0] - p3[0], p1[1] - p0[1] + p2[1] - p3[1]); // sides q0q1 and q3q2
    const second = northSouth(p2[0] - p1[0] + p3[0] - p0[0], p2[1] - p1[1] + p3[1] - p0[1]); // sides q1q2 and q0q3
    const drop = first >= second ? [[q[1], q[2]], [q[3], q[0]]] : [[q[0], q[1]], [q[2], q[3]]];
    for (const [i, j] of drop) off.add(edgeKey(i, j));
  }

  const arms = new Map();
  for (const s of points) {
    const f = fl(s);
    const near = grid.neighbours[s];
    const [sx, sz] = grid.points[s];
    const cos = (a, b) => {
      const ax = grid.points[a][0] - sx, az = grid.points[a][1] - sz, bx = grid.points[b][0] - sx, bz = grid.points[b][1] - sz;
      return (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
    };
    const together = (a, b) => grid.around[s].some(cell => grid.cells[cell].includes(a) && grid.cells[cell].includes(b));
    // a and b have as many of s's other neighbours on one side as on the other
    const turn = n => Math.atan2(grid.points[n][1] - sz, grid.points[n][0] - sx);
    const wrap = t => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const evenly = (a, b) => {
      const span = wrap(turn(b) - turn(a));
      const inside = near.filter(n => n !== a && n !== b && wrap(turn(n) - turn(a)) < span).length;
      return inside * 2 === near.length - 2;
    };
    const links = near.filter(n => fl(n) === f && !off.has(edgeKey(s, n)));
    const lower = near.filter(n => fl(n) < f);
    let list = links;
    if (links.length === 1) {
      // A row end: carry the ridge on to the lower neighbour most nearly opposite the link.
      const [n] = links;
      let best = -1, low = OPPOSITE;
      for (const m of lower) {
        if (together(n, m)) continue;
        const c = cos(n, m);
        if (c < low - 1e-9) { low = c; best = m; }
      }
      if (best >= 0) list = [n, best];
    } else if (!links.length) {
      // A lone block: the ridge runs between the two most nearly opposite lower neighbours along its
      // longer way (the farthest apart side middles).
      let best = null, long = -1;
      for (let i = 0; i < lower.length; i++) for (let j = i + 1; j < lower.length; j++) {
        const a = lower[i], b = lower[j];
        if (together(a, b) || !evenly(a, b) || cos(a, b) >= OPPOSITE) continue;
        const ma = midpoint(grid, s, a), mb = midpoint(grid, s, b);
        const length = Math.hypot(ma[0] - mb[0], ma[1] - mb[1]);
        if (length > long + 1e-9) { long = length; best = [a, b]; }
      }
      if (best) list = best;
    }
    arms.set(s, new Set(list));
  }

  // Doors: the block that carries a house's door, and the outside point it faces.
  const doors = new Map();
  for (const door of island.doors ?? []) {
    if (floors.has(door.point) && grid.neighbours[door.point].includes(door.outside) && !floors.has(door.outside)) doors.set(door.point, door.outside);
  }

  // Chimneys: some top blocks, by roll, in one of their corner pieces.
  const chimneys = new Map();
  for (const s of points) {
    if (roll('chimney', island.id, s) >= CHANCE.chimney) continue;
    const around = grid.around[s];
    chimneys.set(s, around[Math.floor(roll('chimney-cell', island.id, s) * around.length) % around.length]);
  }
  return { arms, doors, chimneys, off };
}

// ---------- Drawing ----------

export function buildBlocks(ctx, island) {
  const { grid, floors } = island ?? {};
  if (!grid || !floors?.size) return;
  const plan = planRoofs(island);
  const sink = new PieceSink(ctx);
  const fl = p => floors.get(p) ?? 0;
  const smoke = []; // chimney tops that smoke
  for (const s of [...floors.keys()].sort(byNumber)) {
    const block = {
      id: island.id, s, top: fl(s), fl, grid,
      look: lookOf(island.look?.get(s)),
      arms: plan.arms.get(s) ?? new Set(),
      door: plan.doors.get(s),
      chimney: plan.chimneys.get(s),
      smoke,
    };
    if (block.door !== undefined) {
      const cells = grid.around[s].filter(cell => grid.cells[cell].includes(block.door));
      block.doorCell = cells.length ? Math.min(...cells) : -1;
    }
    for (const cell of grid.around[s]) {
      const c = cornerPiece(grid, cell, grid.cells[cell].indexOf(s));
      for (let level = 0; level < block.top; level++) blockPiece(sink, c, level, block);
    }
  }
  sink.flush();
  if (smoke.length) addSmoke(ctx, island.id, smoke.slice(0, SMOKE.chimneys));
}

// The four parts of a corner piece as [a0, a1, b0, b1], cut at the wall line.
const PARTS = { core: [0, T, 0, T], A: [T, 1, 0, T], B: [0, T, T, 1], X: [T, 1, T, 1] };

// One storey of one corner piece.
function blockPiece(sink, c, level, block) {
  const { fl, top, look, arms, id } = block;
  const has = p => fl(p) > level;
  const fA = has(c.next), fB = has(c.prev), fO = has(c.opp);
  const isTop = level === top - 1;
  const y0 = level ? level * H : FOOT, y1 = (level + 1) * H;
  const me = parts(T, fA, fB, fO);
  const key = `block:${c.key}:${level}`;
  const armA = arms.has(c.next), armB = arms.has(c.prev);
  const lift = roofLift(armA, armB);
  const roofY = (a, b) => y1 + RISE * lift(a, b);
  const wallTop = (a, b) => (isTop ? roofY(a, b) - FASCIA : y1);

  // ---- Walls, between filled and empty parts ----
  sink.begin(`${key}:wall`);
  const wall = sink.mesh('matte');
  const from = wall.pos.length;
  for (const e of me.edges) {
    const out = c.dir((e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2, ...e.out);
    const tp = wallTop(...e.p), tq = wallTop(...e.q);
    // The ground storey in bands, so its shading toward the grass stays low on the wall.
    const cuts = level ? [y0] : [y0, 0.12, 0.26];
    for (let i = 0; i < cuts.length; i++) {
      const lo = cuts[i];
      const hp = i + 1 < cuts.length ? cuts[i + 1] : tp, hq = i + 1 < cuts.length ? cuts[i + 1] : tq;
      wall.quad(c.at3(...e.p, lo), c.at3(...e.q, lo), c.at3(...e.q, hq), c.at3(...e.p, hp), look.wall, out);
    }
  }
  if (!level) wall.ao(from, AO);

  // ---- White trim: the outer corner board, and the ledge where the storey above steps in ----
  sink.begin(`${key}:trim`);
  const trim = sink.mesh('matte');
  if (!fA && !fB) {
    const corner = c.at3(T, T, y0);
    const along = unit(c.dir(T, T / 2, 0, 1));
    let n = [along[2], 0, -along[0]];
    const outward = c.dir(T, T, 1, 1);
    if (n[0] * outward[0] + n[2] * outward[2] < 0) n = [-n[0], 0, -n[2]];
    frameBox(trim, { o: corner, u: along, n }, [-0.026, 0.026], [0, wallTop(T, T) - y0], [-0.026, 0.026], P.trim, 'fklrt');
  }
  if (!isTop) {
    const above = parts(T, fl(c.next) > level + 1, fl(c.prev) > level + 1, fl(c.opp) > level + 1);
    for (const name of ['A', 'B', 'X']) if (me.filled[name] && !above.filled[name]) flat(trim, c, PARTS[name], () => y1, P.trim, UP);
  }

  // ---- Windows and the door, on the walls that face the next or previous point ----
  for (const e of me.edges) {
    if (e.side !== 'A' && e.side !== 'B') continue;
    const toward = e.side === 'A' ? c.next : c.prev;
    if (level === 0 && block.door === toward) continue; // the door's wall
    const out = c.dir((e.p[0] + e.q[0]) / 2, (e.p[1] + e.q[1]) / 2, ...e.out);
    if (fl(toward) && !facesCamera(out)) continue; // a join wall that Today sees side-on or from behind
    const p = c.at(...e.p), q = c.at(...e.q);
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length < 0.15 || roll('window', id, c.s, c.cell, level, e.side) >= CHANCE.window) continue;
    sink.begin(`${key}:window:${e.side}`);
    const frame = wallFrame(p, q, level * H, out);
    const w = Math.min(0.12, length * 0.45);
    smallWindow(sink, frame, length / 2, H * 0.54, w, 0.16);
    if (hasLook('box', id, key, e.side)) {
      sink.begin(`${key}:box:${e.side}`);
      const pick = hashString(`${id}:${key}:${e.side}:window-box-colour`);
      windowBox(sink, frame, length / 2, H * 0.54, w, 0.16, pick);
    }
  }
  if (level === 0 && block.door !== undefined && block.doorCell === c.cell) {
    const face = wallFace(block.grid, c.s, block.door);
    if (face) { sink.begin(`${key}:door`); door(sink, face); }
  }

  if (!isTop) return;

  // ---- The roof: over the whole piece, in four parts so it bends exactly at the wall lines ----
  sink.begin(`${key}:roof`);
  const roof = sink.mesh('matte');
  for (const name of ['core', 'A', 'B', 'X']) flat(roof, c, PARTS[name], roofY, look.roof, UP);
  // Its underside, beneath the overhang.
  const under = shade(look.wall, 0.8);
  for (const name of ['A', 'B', 'X']) if (!me.filled[name]) flat(roof, c, PARTS[name], (a, b) => roofY(a, b) - FASCIA, under, DOWN);

  // ---- Boards along the open roof edges: sloped on a gable, level on an eave ----
  // Each edge is in two halves: by the side's middle, open when the neighbour isn't there at this
  // storey; by the cell's middle, also open when a taller neighbour leaves its own corner empty there.
  sink.begin(`${key}:trim`);
  const sideA = [!fA, !fA || (fl(c.next) > top && !(fO && fB))];
  const sideB = [!fB, !fB || (fl(c.prev) > top && !(fO && fA))];
  boards(trim, c, roofY, 'A', sideA);
  boards(trim, c, roofY, 'B', sideB);
  // The ridge trim, along the side line toward each arm.
  if (armA) {
    const p = c.at(0, 0), q = c.at(1, 0);
    const frame = wallFrame(p, q, y1 + RISE, c.dir(0.5, 0, 0, 1));
    frameBox(trim, frame, [0, frame.length], [-RIDGE.down, RIDGE.up], [-RIDGE.half, RIDGE.half], P.trim, 'fktlr');
  }

  // ---- A round attic window in the gable ----
  if (armA && fl(c.next) < top && roll('attic', id, c.s, c.next) < CHANCE.attic) {
    const face = wallFace(block.grid, c.s, c.next);
    if (face) { sink.begin(`${key}:attic`); atticWindow(sink, face, y1 + 0.075); }
  }

  // ---- A chimney ----
  if (block.chimney === c.cell) {
    sink.begin(`${key}:chimney`);
    const nest = hasLook('nest', id, c.s);
    const top = chimney(sink, c, y1, look, nest);
    if (!nest && hasLook('smoke', id, c.s)) block.smoke.push({ s: c.s, top });
  }
}

// A part of a corner piece as two triangles at the height y(a, b), split along the line a = b where the
// hip and valley shapes bend.
function flat(mesh, c, [a0, a1, b0, b1], y, hex, hint) {
  const p = (a, b) => c.at3(a, b, y(a, b));
  mesh.tri(p(a0, b0), p(a1, b0), p(a1, b1), hex, hint);
  mesh.tri(p(a0, b0), p(a1, b1), p(a0, b1), hex, hint);
}

// The boards on one open side of the roof: side A runs along a = 1 (toward the next point), side B along
// b = 1. halves: [by the side's middle, by the cell's middle].
function boards(mesh, c, roofY, side, halves) {
  // (across, along) -> (a, b): across = 1 on the edge, smaller inward.
  const ab = side === 'A' ? (across, along) => [across, along] : (across, along) => [along, across];
  const at = (across, along, dy) => { const [a, b] = ab(across, along); return c.at3(a, b, roofY(a, b) + dy); };
  const out = ab(1, 0), inward = ab(-1, 0);
  const inner = 1 - BOARD;
  const spans = [[0, T], [T, 1]];
  spans.forEach(([s0, s1], i) => {
    if (!halves[i]) return;
    const [ma, mb] = ab(1, (s0 + s1) / 2), [ia, ib] = ab(inner, (s0 + s1) / 2);
    // Outer face, top, inner face.
    mesh.quad(at(1, s0, -FASCIA), at(1, s1, -FASCIA), at(1, s1, LIP), at(1, s0, LIP), P.trim, c.dir(ma, mb, ...out));
    mesh.quad(at(inner, s0, LIP), at(1, s0, LIP), at(1, s1, LIP), at(inner, s1, LIP), P.trim, UP);
    mesh.quad(at(inner, s0, -0.006), at(inner, s1, -0.006), at(inner, s1, LIP), at(inner, s0, LIP), P.trim, c.dir(ia, ib, ...inward));
    // An end cap where the board stops halfway.
    if (i === 1 && !halves[0]) {
      const [ea, eb] = ab(1, T);
      mesh.quad(at(inner, T, -0.006), at(1, T, -FASCIA), at(1, T, LIP), at(inner, T, LIP), P.trim, c.dir(ea, eb, ...ab(0, -1)));
    }
  });
}

const unit = v => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
// Today's camera always looks north, so a wall faces it when its outward way ([x, 0, z]) points south (+z).
const facesCamera = v => unit(v)[2] >= FACING;

// The wall face of block s toward its neighbour n: its middle sits on the side line between them, at the
// wall line. Returns a frame { o, u, n } at the grass (u along the wall, n out toward n), or null.
function wallFace(grid, s, n) {
  const pieces = grid.around[s].filter(cell => grid.cells[cell].includes(n)).map(cell => cornerPiece(grid, cell, grid.cells[cell].indexOf(s)));
  if (!pieces.length) return null;
  const first = pieces[0];
  const centre = first.next === n ? first.at(T, 0) : first.at(0, T);
  // The face's two ends are the outer corners of its pieces (or the piece's own end when it has one).
  const ends = pieces.map(c => c.at(T, T));
  const a = ends[0], b = ends[1] ?? centre;
  let along = unit([b[0] - a[0], 0, b[1] - a[1]]);
  const [sx, sz] = grid.points[s], [nx, nz] = grid.points[n];
  let out = [along[2], 0, -along[0]];
  if (out[0] * (nx - sx) + out[2] * (nz - sz) < 0) out = [-out[0], 0, -out[2]];
  along = [out[2], 0, -out[0]]; // right-handed with up and out, so turned shapes keep their faces
  return { o: [centre[0], 0, centre[1]], u: along, n: out };
}

// A frame's matrix: x along u, y up, z along n, from o.
function frameMatrix({ o, u, n }, y = 0) {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n)).setPosition(o[0], o[1] + y, o[2]);
}

// A half disc on top of a box: the round top of a door or its frame, `depth` deep out of the wall.
function halfDisc(sink, frame, y, radius, depth, z, hex) {
  const g = new THREE.CylinderGeometry(radius, radius, depth, 12, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0, z + depth / 2);
  sink.geometry(g.applyMatrix4(frameMatrix(frame, y)), 'matte', hex);
}

// A light window: a glass pane (glows at dusk), a thin white frame, a cross bar and a sill. Plain boxes.
//   x: its middle along the wall; y: its middle above the frame's floor; w, h: the pane's size.
function smallWindow(sink, frame, x, y, w, h) {
  const f = 0.022;
  frameBox(sink.mesh('glass'), frame, [x - w / 2, x + w / 2], [y - h / 2, y + h / 2], [-0.006, 0.014], P.glass, 'f');
  const bar = (x0, x1, y0, y1, z0, z1) => frameBox(sink.mesh('matte'), frame, [x0, x1], [y0, y1], [z0, z1], P.trim, 'ftlr');
  bar(x - w / 2 - f, x + w / 2 + f, y + h / 2, y + h / 2 + f, -0.006, 0.03);
  bar(x - w / 2 - f, x - w / 2, y - h / 2, y + h / 2, -0.006, 0.03);
  bar(x + w / 2, x + w / 2 + f, y - h / 2, y + h / 2, -0.006, 0.03);
  bar(x - w / 2 - f - 0.015, x + w / 2 + f + 0.015, y - h / 2 - f * 1.1, y - h / 2, -0.01, 0.05);
  bar(x - 0.006, x + 0.006, y - h / 2, y + h / 2, -0.006, 0.023);
  bar(x - w / 2, x + w / 2, y + h * 0.12 - 0.006, y + h * 0.12 + 0.006, -0.006, 0.023);
}

// The front door: a step, a white surround with a round top, and a coloured door, centred on the face.
function door(sink, frame) {
  const mesh = sink.mesh('matte');
  frameBox(mesh, frame, [-0.11, 0.11], [FOOT, 0.03], [-0.01, 0.075], P.trim, 'ftlr');
  frameBox(mesh, frame, [-0.098, 0.098], [0.03, 0.26], [-0.006, 0.018], P.trim, 'ftlr');
  halfDisc(sink, frame, 0.26, 0.098, 0.024, -0.006, P.trim);
  frameBox(mesh, frame, [-0.074, 0.074], [0.03, 0.26], [0, 0.03], P.door, 'ftlr');
  halfDisc(sink, frame, 0.26, 0.074, 0.03, 0, P.door);
  frameBox(mesh, frame, [0.036, 0.052], [0.14, 0.156], [0.03, 0.042], P.trim, 'ftlr'); // the knob
}

// A round window high in a gable.
function atticWindow(sink, frame, y) {
  const disc = (radius, depth, z, mat, hex) => {
    const g = new THREE.CylinderGeometry(radius, radius, depth, 14).rotateX(Math.PI / 2).translate(0, 0, z + depth / 2);
    sink.geometry(g.applyMatrix4(frameMatrix(frame, y)), mat, hex);
  };
  disc(0.05, 0.016, -0.006, 'matte', P.trim);
  disc(0.035, 0.022, -0.006, 'glass', P.glass);
  frameBox(sink.mesh('matte'), { ...frame, o: [frame.o[0], frame.o[1] + y, frame.o[2]] }, [-0.035, 0.035], [-0.005, 0.005], [-0.006, 0.019], P.trim, 'ft');
}

// A chimney standing out of the roof a little off its middle, in the wall colour with a white cap.
// nest: a twig nest sits on the cap instead of the dark flue. Returns the top's middle [x, y, z].
function chimney(sink, c, y1, look, nest = false) {
  const o = c.at3(0.42, 0.42, y1);
  const u = unit(c.dir(0.42, 0.42, 1, 0));
  const frame = { o, u, n: [u[2], 0, -u[0]] };
  const mesh = sink.mesh('matte');
  const height = RISE + 0.1;
  frameBox(mesh, frame, [-0.04, 0.04], [0, height], [-0.04, 0.04], shade(look.wall, 0.92), 'fklr');
  frameBox(mesh, frame, [-0.052, 0.052], [height, height + 0.03], [-0.052, 0.052], P.trim, 'fklrtd');
  if (nest) chimneyNest(sink, frame, height + 0.03);
  else frameBox(mesh, frame, [-0.028, 0.028], [height + 0.03, height + 0.031], [-0.028, 0.028], '#5d4f66', 't');
  return [o[0], o[1] + height + 0.031, o[2]];
}

// A twig nest on a chimney's cap at y: a wide, faceted bowl a little wider than the cap, a dark hollow
// and two twigs poking out. Its top stays 0.045 above the cap, under the blocks' ceiling.
const NEST = { brown: '#a8774f', dark: '#6b4a34' };
function chimneyNest(sink, frame, y) {
  const at = new THREE.Matrix4().makeTranslation(frame.o[0], frame.o[1] + y, frame.o[2]);
  sink.geometry(new THREE.CylinderGeometry(0.078, 0.056, 0.045, 7).translate(0, 0.0215, 0).applyMatrix4(at), 'facet', NEST.brown);
  sink.geometry(new THREE.CircleGeometry(0.056, 7).rotateX(-Math.PI / 2).translate(0, 0.0445, 0).applyMatrix4(at), 'matte', NEST.dark);
  const twigs = sink.mesh('matte');
  frameBox(twigs, { ...frame, o: [frame.o[0], frame.o[1] + y, frame.o[2]] }, [-0.1, 0.03], [0.028, 0.04], [0.035, 0.047], P.log, 'ftlr');
  frameBox(twigs, { ...frame, o: [frame.o[0], frame.o[1] + y, frame.o[2]] }, [0.04, 0.052], [0.022, 0.034], [-0.095, 0.0], P.log, 'ftlr');
}

// A wooden window box under a window's sill (x, y, w, h as in smallWindow), with a green strip of
// leaves and three chunky flowers along its front, in two colours picked by pick (0..1).
function windowBox(sink, frame, x, y, w, h, pick) {
  const f = 0.022;
  const x0 = x - w / 2 - f - 0.012, x1 = x + w / 2 + f + 0.012;
  const sill = y - h / 2 - f * 1.1; // the sill's underside
  const main = P.flower[1 + Math.floor(pick * 4) % 4], other = P.flower[Math.floor(pick * 20) % 5];
  const matte = sink.mesh('matte');
  frameBox(matte, frame, [x0, x1], [sill - 0.05, sill + 0.012], [0, 0.075], P.log, 'ftlrd');
  frameBox(matte, frame, [x0 + 0.008, x1 - 0.008], [sill + 0.012, sill + 0.036], [0.012, 0.068], P.leaf[0], 'ftlr');
  [main, other === main ? P.flower[0] : other, main].forEach((hex, k) => {
    const xc = x0 + (k + 0.5) * (x1 - x0) / 3;
    frameBox(matte, frame, [xc - 0.022, xc + 0.022], [sill + 0.024, sill + 0.06 - (k % 2) * 0.008], [0.03, 0.078], hex, 'ftlr');
  });
}

// ---------- Chimney smoke ----------

// Soft puffs that rise slowly from chimney tops ([{ s, top }]) in the evening moods: one instanced mesh
// for the island, its puffs sharing one small shape (freed with the island). Each puff grows as it rises,
// leans with the breeze and shrinks away; each chimney starts its puffs at its own turn. update(0) is the
// built pose.
export function addSmoke(ctx, id, tops) {
  if (!tops.length) return null;
  const puffShape = new THREE.IcosahedronGeometry(1, 1);
  const count = tops.length * SMOKE.puffs;
  const material = new THREE.MeshStandardMaterial({ color: SMOKE_COLOUR.break, emissive: SMOKE_COLOUR.break, emissiveIntensity: 0.18, roughness: 1, metalness: 0, transparent: true, opacity: SMOKE.opacity.break, depthWrite: false });
  const mesh = new THREE.InstancedMesh(puffShape, material, count);
  mesh.name = 'chimney-smoke';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // the puffs move
  mesh.renderOrder = 2;
  mesh.visible = false; // until a mood shows it
  const turns = tops.map(({ s }) => hashString(`${id}:${s}:chimney-smoke-turn`));
  const lean = [-Math.sin(BREEZE), -Math.cos(BREEZE)];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const update = t => {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0;
    tops.forEach(({ top }, i) => {
      for (let k = 0; k < SMOKE.puffs; k++) {
        const f = (time / SMOKE.seconds + k / SMOKE.puffs + turns[i]) % 1;
        const r = (0.045 + 0.065 * f) * Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.15)), 0.6);
        v.set(top[0] + lean[0] * f * f * 0.2, top[1] + 0.035 + f * SMOKE.rise, top[2] + lean[1] * f * f * 0.2);
        mesh.setMatrixAt(i * SMOKE.puffs + k, m.compose(v, q, sc.set(r, r * 0.85, r)));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.root.add(mesh);
  ctx.track(material, mesh, puffShape);
  ctx.dynamic.push(update);
  ctx.onMood(name => {
    const strength = SMOKE.opacity[name] ?? 0;
    mesh.visible = strength > 0;
    material.opacity = strength;
    material.color.set(SMOKE_COLOUR[name] ?? SMOKE_COLOUR.break);
    material.emissive.set(SMOKE_COLOUR[name] ?? SMOKE_COLOUR.break);
  });
  return { mesh, update };
}
