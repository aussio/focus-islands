// Corner pieces: how the town is drawn on the uneven grid. Ported from the grid prototype
// (wonky/island.js). Stage 0 wrote this; stream C owns it now.
//
// - Every cell has four points. It is cut into four corner pieces, one per point: the point, the
//   middle of the side to the next point, the cell's middle, the middle of the side to the previous point.
// - A piece is drawn in a unit square (a, b): a runs toward the next point, b toward the previous one.
//   It looks only at four points (its own, the next, the previous and the opposite one).
// - The unit square is bent into the real cell. Two pieces that share a side use the same two end
//   points and the same spacing along it, so they always meet without cracks, whatever the cell's shape.
//   Changing one point redraws only the pieces of the cells around it.
//
// Piece keys, for the stability check: what the piece is, then its cell and corner, then any more
// detail, joined by ':'. For example lane:12:3, pad:12:3, block:12:3:0:wall. Things use thing:<id>.
// pointOfKey(grid, key) reads the point back. Call ctx.piece(key) before adding a piece's geometry
// (addPiece does it for you); withPieces(ctx, log) gives a model context that method.
import * as THREE from 'three';

// The middle of the side between points i and j.
export const midpoint = (grid, i, j) => [(grid.points[i][0] + grid.points[j][0]) / 2, (grid.points[i][1] + grid.points[j][1]) / 2];

// The corner piece of point cells[cell][k], with its bend from the unit square into the cell.
//   at(a, b) => [x, z]; at3(a, b, y) => [x, y, z]; dir(a, b, da, db) => the world direction of a small
//   step (da, db) from (a, b), as [x, 0, z].
export function cornerPiece(grid, cell, k) {
  const q = grid.cells[cell];
  const s = q[k], next = q[(k + 1) % 4], opp = q[(k + 2) % 4], prev = q[(k + 3) % 4];
  const p00 = grid.points[s], p10 = midpoint(grid, s, next), p11 = grid.centres[cell], p01 = midpoint(grid, s, prev);
  const at = (a, b) => [
    (1 - a) * (1 - b) * p00[0] + a * (1 - b) * p10[0] + a * b * p11[0] + (1 - a) * b * p01[0],
    (1 - a) * (1 - b) * p00[1] + a * (1 - b) * p10[1] + a * b * p11[1] + (1 - a) * b * p01[1],
  ];
  const at3 = (a, b, y) => { const [x, z] = at(a, b); return [x, y, z]; };
  const dir = (a, b, da, db) => { const p = at(a, b), r = at(a + da * 0.01, b + db * 0.01); return [r[0] - p[0], 0, r[1] - p[1]]; };
  return { cell, k, s, next, opp, prev, at, at3, dir, key: `${cell}:${k}` };
}

// Every corner piece of one point: one per cell around it.
export const piecesAt = (grid, p) => grid.around[p].map(cell => cornerPiece(grid, cell, grid.cells[cell].indexOf(p)));

// The four parts of a corner piece, cut by the lines a = t and b = t: core (by the point), A (toward
// next), B (toward prev) and X (by the cell's middle). fA, fB, fO: whether the next, previous and
// opposite points are filled too. filled says which parts are filled; edges are the lines between a
// filled and an empty part, with the way they face (out) and which side they are on.
export function parts(t, fA, fB, fO) {
  const inX = fA && fB && fO;
  const cells = { core: [[0, 0], [t, t]], A: [[t, 0], [1, t]], B: [[0, t], [t, 1]], X: [[t, t], [1, 1]] };
  const filled = { core: true, A: fA, B: fB, X: inX };
  const edges = [];
  if (!fA) edges.push({ p: [t, 0], q: [t, t], out: [1, 0], side: 'A' });
  if (!fB) edges.push({ p: [0, t], q: [t, t], out: [0, 1], side: 'B' });
  if (fA && !inX) edges.push({ p: [t, t], q: [1, t], out: [0, 1], side: 'AX' });
  if (fB && !inX) edges.push({ p: [t, t], q: [t, 1], out: [1, 0], side: 'BX' });
  return { cells, filled, edges };
}

// ---------- Drawing pieces ----------
const colourCache = new Map();
const colour = hex => { if (!colourCache.has(hex)) colourCache.set(hex, new THREE.Color(hex)); return colourCache.get(hex); };
export const shade = (hex, k) => `#${colour(hex).clone().multiplyScalar(k).getHexString()}`;

// Triangles with a colour each. Each face is turned to face its hint direction ([x, y, z]).
export class PieceMesh {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, hex, hint) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) return;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) [b, c] = [c, b];
    this.pos.push(...a, ...b, ...c);
    const k = colour(hex);
    for (let i = 0; i < 3; i++) this.col.push(k.r, k.g, k.b);
  }
  quad(a, b, c, d, hex, hint) { this.tri(a, b, c, hex, hint); this.tri(a, c, d, hex, hint); }
  get empty() { return !this.pos.length; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

// Adds one piece's mesh to the context's batch, tagged with its key. extra: Batch.add options (ao, ...).
export function addPiece(ctx, key, mesh, mat, extra = {}) {
  if (mesh.empty) return;
  ctx.piece?.(key);
  const geometry = mesh.geometry();
  ctx.batch.add(geometry, mat, extra);
  geometry.dispose();
}

// A raised slab piece (a lane or a pad): the core by the point, strips toward filled neighbours, and the
// whole piece when all four points are filled. Outer corners are cut and inner corners filled in.
//   width: how far the slab reaches from its point, in piece units (t); rise: its height.
//   fA, fB, fO: whether the next, previous and opposite points carry the same slab.
export function slabPiece(c, { width, rise, fA, fB, fO, top, side }) {
  const mesh = new PieceMesh();
  const t = width, y = rise;
  const { cells, filled, edges } = parts(t, fA, fB, fO);
  const cut = 0.1;
  for (const name of ['core', 'A', 'B', 'X']) {
    if (!filled[name]) continue;
    const [[a0, b0], [a1, b1]] = cells[name];
    let poly = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    if (name === 'core' && !fA && !fB) poly = [[a0, b0], [a1, b0], [a1, b1 - cut], [a1 - cut, b1], [a0, b1]];
    for (let i = 1; i < poly.length - 1; i++) mesh.tri(c.at3(...poly[0], y), c.at3(...poly[i], y), c.at3(...poly[i + 1], y), top, [0, 1, 0]);
  }
  // Inner corner: a small triangle softens the turn.
  if (fA && fB && !fO) mesh.tri(c.at3(t, t, y), c.at3(t + cut, t, y), c.at3(t, t + cut, y), top, [0, 1, 0]);
  for (const e of edges) {
    let p = e.p, q = e.q;
    // Trim the sides to the cuts.
    if (!fA && !fB && e.side === 'A') q = [t, t - cut];
    if (!fA && !fB && e.side === 'B') q = [t - cut, t];
    if (fA && fB && !fO && e.side === 'AX') p = [t + cut, t];
    if (fA && fB && !fO && e.side === 'BX') p = [t, t + cut];
    mesh.quad(c.at3(...p, -0.01), c.at3(...q, -0.01), c.at3(...q, y), c.at3(...p, y), side, c.dir(...p, ...e.out));
  }
  if (!fA && !fB) mesh.quad(c.at3(t, t - cut, -0.01), c.at3(t - cut, t, -0.01), c.at3(t - cut, t, y), c.at3(t, t - cut, y), side, c.dir(t, t, 1, 1));
  if (fA && fB && !fO) mesh.quad(c.at3(t + cut, t, -0.01), c.at3(t, t + cut, -0.01), c.at3(t, t + cut, y), c.at3(t + cut, t, y), side, c.dir(t, t, 1, 1));
  return mesh;
}

// ---------- Piece keys ----------
// Gives a model context (scene/build.js) ctx.piece(key). Everything added to ctx.batch after piece(key),
// directly or through ctx.add, belongs to that piece. With a log (a Map), each piece's vertices are
// recorded as text rounded to 4 decimals, so the stability check can compare pieces between states.
export function withPieces(ctx, log = null) {
  let current = null;
  ctx.piece = key => { current = key; };
  if (log) {
    const add = ctx.batch.add.bind(ctx.batch);
    const v = new THREE.Vector3();
    ctx.batch.add = (geometry, mat, extra = {}) => {
      if (current) {
        const position = geometry.attributes.position;
        const list = log.get(current) ?? [];
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i);
          if (extra.matrix) v.applyMatrix4(extra.matrix);
          list.push(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`);
        }
        log.set(current, list);
      }
      return add(geometry, mat, extra);
    };
  }
  return ctx;
}

// The point a corner-piece key belongs to (lane:12:3 -> cells[12][3]), or null for other keys.
export function pointOfKey(grid, key) {
  const [, cell, k] = String(key).split(':').map(Number);
  return Number.isInteger(cell) && Number.isInteger(k) && grid.cells[cell] && k >= 0 && k < 4 ? grid.cells[cell][k] : null;
}
