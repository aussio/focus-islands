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
//
// Speed: an island has thousands of pieces. PieceSink collects them into one geometry per material and
// adds each to the batch once, logging every piece under its own key when withPieces has a log.
// Stream C (ground, lanes, blocks) owns this file.
import * as THREE from 'three';

// The middle of the side between points i and j.
export const midpoint = (grid, i, j) => [(grid.points[i][0] + grid.points[j][0]) / 2, (grid.points[i][1] + grid.points[j][1]) / 2];

// The corner piece of point cells[cell][k], with its bend from the unit square into the cell.
//   at(a, b) => [x, z]; at3(a, b, y) => [x, y, z]; dir(a, b, da, db) => the world direction of a small
//   step (da, db) from (a, b), as [x, 0, z]; unit([x, z]) => [a, b], the way back from at.
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
  // Newton steps on the bend: a few are plenty, as a piece is only gently bent.
  const unit = ([x, z]) => {
    const ea = [p10[0] - p00[0], p10[1] - p00[1]], eb = [p01[0] - p00[0], p01[1] - p00[1]];
    const twist = [p00[0] - p10[0] + p11[0] - p01[0], p00[1] - p10[1] + p11[1] - p01[1]];
    let a = 0, b = 0;
    for (let i = 0; i < 8; i++) {
      const [px, pz] = at(a, b), fx = px - x, fz = pz - z;
      const ja = [ea[0] + b * twist[0], ea[1] + b * twist[1]], jb = [eb[0] + a * twist[0], eb[1] + a * twist[1]];
      const det = ja[0] * jb[1] - ja[1] * jb[0];
      if (Math.abs(det) < 1e-12) break;
      a -= (fx * jb[1] - fz * jb[0]) / det;
      b -= (ja[0] * fz - ja[1] * fx) / det;
    }
    return [a, b];
  };
  return { cell, k, s, next, opp, prev, at, at3, dir, unit, key: `${cell}:${k}` };
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

// Triangles with a colour each (hex text or a THREE.Color). Each face is turned to face its hint direction ([x, y, z]).
export class PieceMesh {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, hex, hint) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) return;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) [b, c] = [c, b];
    this.pos.push(...a, ...b, ...c);
    const k = typeof hex === 'string' ? colour(hex) : hex; // a hex text or a THREE.Color
    for (let i = 0; i < 3; i++) this.col.push(k.r, k.g, k.b);
  }
  quad(a, b, c, d, hex, hint) { this.tri(a, b, c, hex, hint); this.tri(a, c, d, hex, hint); }
  // Triangles as given (no turning), from a flat list of positions; for tubes and cones.
  raw(positions, hex) {
    const k = colour(hex);
    for (let i = 0; i < positions.length; i++) this.pos.push(positions[i]);
    for (let i = 0; i < positions.length; i += 3) this.col.push(k.r, k.g, k.b);
  }
  // Darkens the vertices added since `from` toward the ground, like Batch.add's ao, so walls look grounded.
  ao(from, { ground = 0, height = 0.32, min = 0.6 } = {}) {
    for (let i = from; i < this.pos.length; i += 3) {
      const t = Math.min(1, Math.max(0, (this.pos[i + 1] - ground) / height));
      const k = min + (1 - min) * t * t * (3 - 2 * t);
      this.col[i] *= k; this.col[i + 1] *= k; this.col[i + 2] *= k;
    }
  }
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

// ---------- Fast drawing: one geometry per material ----------
// An island has thousands of pieces, so they are not added to the batch one by one. A PieceSink keeps one
// PieceMesh per material; begin(key) starts a piece, and everything written into sink.mesh(mat) until the
// next begin (or end) belongs to it. With a piece log (withPieces with a log), each piece's vertices are
// logged under its key, in the same text as withPieces. flush() adds each material's mesh to ctx.batch once.
export class PieceSink {
  constructor(ctx) { this.ctx = ctx; this.log = ctx.pieceLog ?? null; this.meshes = new Map(); this.key = null; this.marks = null; }
  mesh(mat) {
    let mesh = this.meshes.get(mat);
    if (!mesh) { mesh = new PieceMesh(); this.meshes.set(mat, mesh); }
    return mesh;
  }
  begin(key) {
    this.end();
    this.key = key;
    if (this.log) this.marks = new Map([...this.meshes].map(([mat, mesh]) => [mat, mesh.pos.length]));
  }
  end() {
    if (this.key !== null && this.log) {
      const list = this.log.get(this.key) ?? [];
      const before = list.length;
      for (const [mat, mesh] of this.meshes) {
        const pos = mesh.pos;
        for (let i = this.marks.get(mat) ?? 0; i < pos.length; i += 3) list.push(`${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`);
      }
      if (list.length > before) this.log.set(this.key, list);
    }
    this.key = null; this.marks = null;
  }
  // Any Three.js geometry (a tube, a cone) into the current piece, in one colour. Disposes the geometry.
  geometry(geometry, mat, hex) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    this.mesh(mat).raw(g.attributes.position.array, hex);
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }
  flush() {
    this.end();
    this.ctx.piece?.(null); // the merged meshes are already logged piece by piece
    for (const [mat, mesh] of this.meshes) {
      if (mesh.empty) continue;
      const geometry = mesh.geometry();
      this.ctx.batch.add(geometry, mat);
      geometry.dispose();
    }
    this.meshes.clear();
  }
}

// A flat-topped slab piece with a soft sloped rim, drawn in a corner piece's unit square.
//   poly: its outline, [a, b] points going counter-clockwise (a right, b up), star-shaped from poly[0].
//   seams[i]: the edge from poly[i] to poly[i + 1] is shared with the same slab in the next piece, so it
//   gets no rim; next to a seam, the rim's top edge starts exactly w along the seam, whatever the angle
//   the outline leaves the seam at, so the pieces on both sides of a seam always meet.
//   y: the top's height; low: where the rim meets the ground; w: the rim's width in piece units.
export function rimmedSlab(mesh, c, poly, seams, { y, low = -0.004, w, top, rim }) {
  const n = poly.length;
  const unit = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const inner = poly.map((v, i) => {
    const before = (i - 1 + n) % n, s0 = seams[before], s1 = seams[i];
    if (s0 && s1) return v;
    const d0 = unit(poly[before], v), d1 = unit(v, poly[(i + 1) % n]);
    const n0 = [-d0[1], d0[0]], n1 = [-d1[1], d1[0]]; // inward
    if (!s0 && !s1) {
      const k = Math.max(0.3, 1 + n0[0] * n1[0] + n0[1] * n1[1]);
      return [v[0] + w * (n0[0] + n1[0]) / k, v[1] + w * (n0[1] + n1[1]) / k];
    }
    // Slide w along the seam: back along the edge coming in, or on along the edge going out.
    const u = s0 ? [-d0[0], -d0[1]] : d1;
    return [v[0] + u[0] * w, v[1] + u[1] * w];
  });
  for (let i = 1; i < n - 1; i++) mesh.tri(c.at3(...inner[0], y), c.at3(...inner[i], y), c.at3(...inner[i + 1], y), top, UP);
  for (let i = 0; i < n; i++) {
    if (seams[i]) continue;
    const j = (i + 1) % n, d = unit(poly[i], poly[j]);
    const m = [(poly[i][0] + poly[j][0]) / 2, (poly[i][1] + poly[j][1]) / 2];
    const out = c.dir(...m, d[1], -d[0]);
    mesh.quad(c.at3(...poly[i], low), c.at3(...poly[j], low), c.at3(...inner[j], y), c.at3(...inner[i], y), rim, [out[0] * 100, 0.5, out[2] * 100]);
  }
}
const UP = [0, 1, 0];

// A box in a local frame: o [x, y, z] the origin, u the way along (a horizontal unit [x, 0, z]), n the
// way out (horizontal unit, square to u). x runs along u, y up, z along n. faces: any of 'f' (front,
// +z), 'k' (back), 't' (top), 'd' (down), 'l' (-x), 'r' (+x).
export function frameBox(mesh, { o, u, n }, [x0, x1], [y0, y1], [z0, z1], hex, faces = 'ftlr') {
  const P = (x, y, z) => [o[0] + u[0] * x + n[0] * z, o[1] + y, o[2] + u[2] * x + n[2] * z];
  if (faces.includes('f')) mesh.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), hex, n);
  if (faces.includes('k')) mesh.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), hex, [-n[0], 0, -n[2]]);
  if (faces.includes('t')) mesh.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), hex, UP);
  if (faces.includes('d')) mesh.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), hex, [0, -1, 0]);
  if (faces.includes('l')) mesh.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), hex, [-u[0], 0, -u[2]]);
  if (faces.includes('r')) mesh.quad(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), hex, u);
}

// A frame on a wall line from p to q ([x, z]), at height y, facing `out` (any [x, 0, z] pointing outward).
export function wallFrame(p, q, y, out) {
  const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
  const u = [dx / l, 0, dz / l];
  let n = [u[2], 0, -u[0]];
  if (n[0] * out[0] + n[2] * out[2] < 0) n = [-n[0], 0, -n[2]];
  return { o: [p[0], y, p[1]], u, n, length: l };
}

// ---------- Piece keys ----------
// Gives a model context (town/build.js) ctx.piece(key). Everything added to ctx.batch after piece(key),
// directly or through ctx.add, belongs to that piece. With a log (a Map), each piece's vertices are
// recorded as text rounded to 4 decimals, so the stability check can compare pieces between states.
export function withPieces(ctx, log = null) {
  let current = null;
  ctx.piece = key => { current = key; };
  ctx.pieceLog = log; // PieceSink logs straight into it, piece by piece
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
