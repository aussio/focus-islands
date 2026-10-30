// Builds island ground from grid cells.
// Top: the island outline is traced through the midpoints of its outer cell edges. Points that lie on
// one straight line are merged, so a one-cell staircase becomes one straight diagonal, and only the
// real turns are left. Those are then rounded (outer corners wide, inner corners small) and the
// result is extruded as one smooth slab with a soft bevel.
// Underside: the same outline, shrunk ring by ring towards a point with a little noise.
// Static meshes go into a Batch and are merged per material, so the whole island is a few draw calls.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from './style.js';

// ---------- Static mesh batching ----------
const tmpColor = new THREE.Color();
export class Batch {
  constructor() { this.lists = new Map(); this.top = -Infinity; }
  // ao: darken towards the ground (cheap contact shading), { ground, height, min }.
  // grad: vertical light-to-dark ramp over a world height range, { y0, y1, min, max } (leaf clumps).
  add(geometry, mat, { color = '#ffffff', matrix = null, ao = null, grad = null } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    const keep = mat === 'blob' ? ['position', 'normal', 'color', 'uv'] : ['position', 'normal', 'color'];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (mat === 'blob' && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const base = tmpColor.set(color ?? '#ffffff');
    const existing = g.attributes.color;
    const colors = new Float32Array(p.count * 3);
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > top) top = y;
      let k = 1;
      if (ao) {
        const t = Math.min(1, Math.max(0, (y - ao.ground) / ao.height));
        k = ao.min + (1 - ao.min) * t * t * (3 - 2 * t);
      }
      if (grad) {
        const t = Math.min(1, Math.max(0, (y - grad.y0) / (grad.y1 - grad.y0)));
        k *= grad.min + (grad.max - grad.min) * t;
      }
      const r = existing ? existing.getX(i) : base.r, gg = existing ? existing.getY(i) : base.g, b = existing ? existing.getZ(i) : base.b;
      colors[i * 3] = r * k; colors[i * 3 + 1] = gg * k; colors[i * 3 + 2] = b * k;
    }
    if (mat !== 'blob' && mat !== 'under') this.top = Math.max(this.top, top);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.clearGroups();
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
    return this;
  }
  build(materials, parent) {
    const meshes = [];
    for (const [name, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      list.forEach(g => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materials[name]);
      mesh.castShadow = !['ground', 'under', 'glow', 'blob', 'glass'].includes(name);
      mesh.receiveShadow = name !== 'blob';
      mesh.name = `batch-${name}`;
      if (name === 'blob') mesh.renderOrder = 1;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

export function place(x, y, z, { ry = 0, rx = 0, rz = 0, s = 1, sx, sy, sz } = {}) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx ?? s, sy ?? s, sz ?? s));
}

// ---------- Smooth noise ----------
function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const hash01 = (x, y, seed = 1) => (hash(Math.round(x * 97), Math.round(y * 97), seed) + 1) / 2;
export function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dir = e => [e.b[0] - e.a[0], e.b[1] - e.a[1]];
const unit = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// Traces the outer edges of a set of cells into closed loops of cell-corner points (cell c spans c..c+1).
function traceCorners(cells, isLand) {
  const starts = new Map();
  const add = (a, b) => { const k = `${a[0]},${a[1]}`; if (!starts.has(k)) starts.set(k, []); starts.get(k).push({ a, b, used: false }); };
  for (const { c, r } of cells) {
    if (!isLand(c, r - 1)) add([c + 1, r], [c, r]);
    if (!isLand(c, r + 1)) add([c, r + 1], [c + 1, r + 1]);
    if (!isLand(c - 1, r)) add([c, r], [c, r + 1]);
    if (!isLand(c + 1, r)) add([c + 1, r + 1], [c + 1, r]);
  }
  const loops = [];
  for (const list of starts.values()) for (const first of list) {
    if (first.used) continue;
    const corners = [];
    let edge = first;
    while (edge && !edge.used) {
      edge.used = true;
      corners.push(edge.a);
      const d1 = dir(edge);
      const options = (starts.get(`${edge.b[0]},${edge.b[1]}`) ?? []).filter(e => !e.used);
      // At a pinch point (cells touching only diagonally) take the tightest turn towards the land.
      options.sort((p, q) => cross(d1, dir(p)) - cross(d1, dir(q)));
      edge = options[0];
    }
    if (corners.length >= 4) loops.push(corners);
  }
  return loops;
}

// Drops every point that lies on the straight line between its neighbours.
export function mergeStraight(points, epsilon = 1e-6) {
  const n = points.length;
  if (n < 4) return points.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n], cur = points[i], next = points[(i + 1) % n];
    const a = [cur[0] - prev[0], cur[1] - prev[1]], b = [next[0] - cur[0], next[1] - cur[1]];
    const straight = Math.abs(cross(a, b)) <= epsilon * Math.hypot(...a) * Math.hypot(...b) && a[0] * b[0] + a[1] * b[1] > 0;
    if (!straight) out.push(cur);
  }
  return out;
}

// ---------- Outline tracing with straight diagonals and rounded turns ----------
// cells: [{c, r}], isLand(c, r). Returns loops of [x, y] points in cell units (cell centres at integers).
export function outlineLoops(cells, isLand, { convex = 0.5, concave = 0.28, wobble = 0.05, seed = 3, spacing = 0.3 } = {}) {
  const loops = [];
  for (const corners of traceCorners(cells, isLand)) {
    // Midpoint of each unit edge, shifted so cell centres sit on whole numbers.
    const n = corners.length;
    const mids = corners.map((p, i) => {
      const q = corners[(i + 1) % n];
      return [(p[0] + q[0]) / 2 - 0.5, (p[1] + q[1]) / 2 - 0.5];
    });
    const keepPoints = mergeStraight(mids);
    if (keepPoints.length < 3) continue;
    // Area sign tells outer loops from holes (holes are skipped; islands have none).
    let area = 0;
    keepPoints.forEach((p, i) => { const q = keepPoints[(i + 1) % keepPoints.length]; area += p[0] * q[1] - q[0] * p[1]; });
    if (area > 0) continue;
    const K = keepPoints.length;
    const keep = keepPoints.map((p, i) => {
      const prev = keepPoints[(i - 1 + K) % K], next = keepPoints[(i + 1) % K];
      return { p, convex: cross([p[0] - prev[0], p[1] - prev[1]], [next[0] - p[0], next[1] - p[1]]) < 0 };
    });
    // Corner radius: the style's maximum, but never more than half of either neighbouring edge, so a
    // long straight coast gets a wide soft corner and short steps become a gentle wave.
    const radii = keep.map((corner, i) => {
      const prev = keep[(i - 1 + K) % K].p, next = keep[(i + 1) % K].p, v = corner.p;
      const half = Math.min(Math.hypot(v[0] - prev[0], v[1] - prev[1]), Math.hypot(next[0] - v[0], next[1] - v[1])) / 2;
      return Math.min(corner.convex ? convex : concave, half);
    });
    const points = [];
    keep.forEach((corner, i) => {
      const prev = keep[(i - 1 + K) % K].p, next = keep[(i + 1) % K].p, v = corner.p;
      const din = unit([v[0] - prev[0], v[1] - prev[1]]), dout = unit([next[0] - v[0], next[1] - v[1]]);
      const radius = radii[i];
      const p0 = [v[0] - din[0] * radius, v[1] - din[1] * radius], p1 = [v[0] + dout[0] * radius, v[1] + dout[1] * radius];
      const steps = Math.max(3, Math.round(radius * 12));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, u = 1 - t;
        points.push([u * u * p0[0] + 2 * u * t * v[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * v[1] + t * t * p1[1]]);
      }
      // Straight run to the next corner, split so the wobble has points to move.
      const nextRadius = radii[(i + 1) % K];
      const q0 = p1, q1 = [next[0] - dout[0] * nextRadius, next[1] - dout[1] * nextRadius];
      const length = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      const pieces = Math.max(1, Math.round(length / spacing));
      for (let s = 1; s < pieces; s++) points.push([q0[0] + (q1[0] - q0[0]) * s / pieces, q0[1] + (q1[1] - q0[1]) * s / pieces]);
    });
    // Remove points closer than a hair, which would make thin slivers in the extrusion.
    const clean = points.filter((p, i) => { const q = points[(i + 1) % points.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
    // Gentle wobble along the outward normal so straight edges do not look ruled.
    const m = clean.length;
    const wobbled = clean.map((p, i) => {
      const a = clean[(i - 1 + m) % m], b = clean[(i + 1) % m];
      const t = unit([b[0] - a[0], b[1] - a[1]]);
      const k = wobble * noise2(p[0] * 0.9, p[1] * 0.9, seed);
      return [p[0] - t[1] * k, p[1] + t[0] * k];
    });
    loops.push(wobbled);
  }
  return loops;
}

// Loop in cell units -> world [x, z].
export const loopToWorld = (loop, centre) => loop.map(([x, y]) => [(x - centre[0]) * CELL, (y - centre[1]) * CELL]);

// ---------- Slabs (grass tops, raised levels) ----------
export function slabGeometry(loop, { top = 0, depth = 0.16, bevel = 0.08, segments = 3, smooth = true }) {
  const shape = new THREE.Shape(loop.map(([x, z]) => new THREE.Vector2(x, -z)));
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segments, curveSegments: 1, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, top - depth - bevel, 0); // extrusion spans -bevel..depth+bevel; this puts the top at y = top
  if (smooth) {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
  }
  return g;
}

// Grass slab colours: the flat top in grass, the rounded rim and sides a little deeper.
export function colourSlab(geometry, top, side, topY) {
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  const a = new THREE.Color(top), b = new THREE.Color(side), c = new THREE.Color();
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const up = Math.max(0, n.getY(i));
    const k = Math.min(1, Math.max(0, (up - 0.55) / 0.4)) * Math.min(1, Math.max(0, 1 - (topY - p.getY(i)) / 0.25));
    c.copy(b).lerp(a, k);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---------- Underside: rings shrinking towards a tip, with noise ----------
export function undersideGeometry(loop, { yTop, depth, rings = 6, spacing = 0.3, seed = 5, jitter = 0.12, profile = t => 1 - Math.pow(t, 1.7), colorAt }) {
  // Resample the outline evenly.
  const lengths = [0];
  for (let i = 1; i <= loop.length; i++) {
    const a = loop[i - 1], b = loop[i % loop.length];
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[lengths.length - 1];
  const n = Math.max(12, Math.round(total / spacing));
  const ring0 = [];
  for (let s = 0, j = 0; s < n; s++) {
    const d = total * s / n;
    while (j < loop.length - 1 && lengths[j + 1] < d) j++;
    const a = loop[j], b = loop[(j + 1) % loop.length], t = (d - lengths[j]) / ((lengths[j + 1] - lengths[j]) || 1);
    ring0.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  // Area centroid.
  let area = 0, cx = 0, cz = 0;
  ring0.forEach((p, i) => { const q = ring0[(i + 1) % n]; const f = p[0] * q[1] - q[0] * p[1]; area += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f; });
  if (Math.abs(area) < 1e-9) { cx = ring0[0][0]; cz = ring0[0][1]; } else { cx /= 3 * area; cz /= 3 * area; }
  const grid = [];
  for (let k = 0; k < rings; k++) {
    const t = k / rings;
    const ring = ring0.map((p, i) => {
      const wob = k === 0 ? 0 : noise2(i * 0.45, k * 1.3, seed) * jitter * (0.6 + t);
      const s = (k === 0 ? 0.99 : profile(t)) * (1 + wob);
      const y = yTop - depth * t + (k > 1 ? noise2(i * 0.6, k * 2.1, seed + 1) * depth * 0.035 : 0);
      return new THREE.Vector3(cx + (p[0] - cx) * s, y, cz + (p[1] - cz) * s);
    });
    grid.push(ring);
  }
  const tip = new THREE.Vector3(cx + noise2(1, 2, seed) * 0.2, yTop - depth * 1.06, cz + noise2(3, 4, seed) * 0.2);
  const positions = [], colors = [];
  const color = new THREE.Color();
  // Make sure faces point outwards.
  const a0 = grid[0][0], b0 = grid[0][1], c0 = grid[1][0];
  const normal = new THREE.Vector3().subVectors(c0, a0).cross(new THREE.Vector3().subVectors(b0, a0));
  const outward = new THREE.Vector3(a0.x - cx, 0, a0.z - cz);
  const flip = normal.dot(outward) < 0;
  // Flat facets: one colour per triangle, picked from its middle height.
  const tri = (p, q, r, facet) => {
    const mid = (p.y + q.y + r.y) / 3;
    colorAt(color, Math.min(1, Math.max(0, (yTop - mid) / depth)), facet);
    for (const v of flip ? [p, r, q] : [p, q, r]) { positions.push(v.x, v.y, v.z); colors.push(color.r, color.g, color.b); }
  };
  for (let k = 0; k < rings; k++) for (let i = 0; i < n; i++) {
    const a = grid[k][i], b = grid[k][(i + 1) % n];
    if (k === rings - 1) { tri(a, tip, b, k * n + i); continue; }
    const c = grid[k + 1][i], d = grid[k + 1][(i + 1) % n];
    tri(a, c, b, k * n + i);
    tri(b, c, d, k * n + i + 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return { geometry: g, centre: [cx, cz], rings: grid, tip };
}

// ---------- Tapered tube (roots, ropes) ----------
export function taperedTube(points, r0, r1, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const segments = Math.max(4, points.length * 4);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [], index = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments, centre = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    for (let j = 0; j < radial; j++) {
      const a = j / radial * Math.PI * 2;
      const v = centre.clone().addScaledVector(frames.normals[s], Math.cos(a) * r).addScaledVector(frames.binormals[s], Math.sin(a) * r);
      positions.push(v.x, v.y, v.z);
    }
  }
  for (let s = 0; s < segments; s++) for (let j = 0; j < radial; j++) {
    const a = s * radial + j, b = s * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ---------- Paths ----------
// One stepping stone on each path cell and one between joined path cells, evenly spaced.
export function pathStones(model, { y = 0.012 } = {}) {
  const list = [];
  const stone = (x, yy, z, c, r, k) => {
    const jx = (hash01(c, r, 11 + k) - 0.5) * 0.06, jz = (hash01(c, r, 21 + k) - 0.5) * 0.06;
    const s = 0.88 + hash01(c, r, 31 + k) * 0.24;
    list.push(place(x + jx, yy, z + jz, { ry: hash01(c, r, 41 + k) * 3, s }));
  };
  const isPath = (c, r) => { const cell = model.get(c, r); return cell?.type === 'path' && !cell.thing; };
  for (const cell of model.cells.values()) {
    if (!isPath(cell.c, cell.r)) continue;
    const [x, z] = model.toWorld(cell.c, cell.r);
    const yy = y + cell.height * model.level;
    stone(x, yy, z, cell.c, cell.r, 0);
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const next = model.get(cell.c + dc, cell.r + dr);
      if (!isPath(cell.c + dc, cell.r + dr) || next.height !== cell.height) continue;
      if (dc && dr && (isPath(cell.c + dc, cell.r) || isPath(cell.c, cell.r + dr))) continue;
      const [nx, nz] = model.toWorld(cell.c + dc, cell.r + dr);
      stone((x + nx) / 2, yy, (z + nz) / 2, cell.c + dc * 0.5, cell.r + dr * 0.5, 1);
    }
  }
  return list;
}
