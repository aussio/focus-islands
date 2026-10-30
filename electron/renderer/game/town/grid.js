// Each island's own uneven grid, made once from its id and never changed. Ported from the grid
// prototype (wonky/grid.js). Plain code: no DOM, no Three.js.
//
//   gridFor(id, size) => { key, id, size, rings, edge, points, cells, neighbours, around, centres, fromRim }
//   buildGrid(id, size) => the same grid, made fresh (no cache), for tests and timing
//
// How it is made:
//   1. a hexagon cut into triangles,
//   2. neighbouring triangles joined into four-sided shapes at random (seeded from the id),
//   3. every shape split into four-sided cells (a triangle gives 3, a four-sided shape gives 4),
//   4. 60 rounds of smoothing that pull each cell towards a square (the rim stays put).
// Points are in world units around the grid's middle, rounded to 4 decimals. Every cell has four
// points, listed in the same turning order. A grid is one shared, frozen object: never copy it.

// Hexagon radius in triangles for each island size. Home uses the large grid.
export const GRID_RINGS = { small: 7, medium: 8, large: 9 };
export const EDGE = 1.3; // one triangle side, so cells are about 0.65 across
export const RIM_MARGIN = 3; // points fewer than this many steps from the rim never fill
const SMOOTHING = 60;

// ---------- Rolls ----------
// A repeatable "dice roll": the same parts always give the same number. Seeds come only from ids
// and point numbers, never from positions in the sky.

// FNV-1a over the text.
export function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// A stream of rolls in [0, 1) from one seed.
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One roll in [0, 1) from any parts, for example roll('door', houseId, point).
export const roll = (...parts) => mulberry(hashText(parts.join('|')))();

// ---------- The grid ----------
// The grid size for an island: home always uses the large grid.
export const gridSizeOf = (id, size) => (id === 'home' ? 'large' : GRID_RINGS[size] ? size : 'medium');

const cache = new Map();

export function gridFor(id, size) {
  const key = `${id}:${gridSizeOf(String(id), size)}`;
  if (!cache.has(key)) cache.set(key, buildGrid(id, size));
  return cache.get(key);
}

// Points that can ever be land: far enough from the rim.
export const canFill = (grid, p) => grid.fromRim[p] >= RIM_MARGIN;

const round4 = v => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

export function buildGrid(gridId, gridSize) {
  const id = String(gridId), size = gridSizeOf(id, gridSize), key = `${id}:${size}`;
  const rings = GRID_RINGS[size];
  const edge = EDGE;
  const rand = mulberry(hashText(`grid:${id}`));

  // 1. Triangle corner points inside the hexagon (axial q, r), and the triangles between them.
  const pointIndex = new Map();
  const base = [];
  const at = (q, r) => pointIndex.get(`${q},${r}`);
  const inside = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= rings;
  for (let r = -rings; r <= rings; r++) for (let q = -rings; q <= rings; q++) {
    if (!inside(q, r)) continue;
    pointIndex.set(`${q},${r}`, base.length);
    base.push([(q + r / 2) * edge, r * Math.sqrt(3) / 2 * edge]);
  }
  const tris = [];
  for (let r = -rings; r <= rings; r++) for (let q = -rings; q <= rings; q++) {
    const p = at(q, r), a = at(q + 1, r), b = at(q, r + 1), c = at(q + 1, r + 1);
    if (p !== undefined && a !== undefined && b !== undefined) tris.push([p, a, b]);
    if (a !== undefined && c !== undefined && b !== undefined) tris.push([a, c, b]);
  }

  // 2. Join random neighbouring pairs of triangles into four-sided shapes.
  const edgeKey = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const edgeTris = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const e = edgeKey(t[k], t[(k + 1) % 3]);
      if (!edgeTris.has(e)) edgeTris.set(e, []);
      edgeTris.get(e).push(ti);
    }
  });
  const order = tris.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const used = new Uint8Array(tris.length);
  const shapes = [];
  for (const ti of order) {
    if (used[ti]) continue;
    const t = tris[ti];
    const options = [];
    for (let k = 0; k < 3; k++) {
      const other = edgeTris.get(edgeKey(t[k], t[(k + 1) % 3])).find(o => o !== ti && !used[o]);
      if (other !== undefined) options.push([k, other]);
    }
    used[ti] = 1;
    if (!options.length) { shapes.push(t.slice()); continue; }
    const [k, other] = options[Math.floor(rand() * options.length)];
    used[other] = 1;
    // Triangle t is (u, v, w) with the shared side v -> w; the other's third point goes between them.
    const v = t[k], w = t[(k + 1) % 3], u = t[(k + 2) % 3];
    const z = tris[other].find(p => p !== v && p !== w);
    shapes.push([v, z, w, u]);
  }
  for (const s of shapes) if (s.length === 4) fixWinding(s, base);

  // 3. Split every shape into four-sided cells: corner, side middle, shape middle, previous side middle.
  const points = base.map(p => p.slice());
  const mids = new Map();
  const midOf = (i, j) => {
    const e = edgeKey(i, j);
    if (!mids.has(e)) { mids.set(e, points.length); points.push([(points[i][0] + points[j][0]) / 2, (points[i][1] + points[j][1]) / 2]); }
    return mids.get(e);
  };
  const cells = [];
  for (const s of shapes) {
    const n = s.length;
    const c = points.length;
    points.push([s.reduce((sum, i) => sum + base[i][0], 0) / n, s.reduce((sum, i) => sum + base[i][1], 0) / n]);
    for (let k = 0; k < n; k++) cells.push([s[k], midOf(s[k], s[(k + 1) % n]), c, midOf(s[(k - 1 + n) % n], s[k])]);
  }

  // Rim points (on a cell side used by only one cell) stay put while smoothing.
  const sideCells = new Map();
  cells.forEach((q, qi) => {
    for (let k = 0; k < 4; k++) {
      const e = edgeKey(q[k], q[(k + 1) % 4]);
      if (!sideCells.has(e)) sideCells.set(e, []);
      sideCells.get(e).push(qi);
    }
  });
  const rim = new Uint8Array(points.length);
  for (const [e, list] of sideCells) if (list.length === 1) { const [i, j] = e.split(':').map(Number); rim[i] = rim[j] = 1; }

  // 4. Smooth: pull every cell towards a square of its own size and middle, a little at a time.
  const force = points.map(() => [0, 0]);
  for (let it = 0; it < SMOOTHING; it++) {
    for (const f of force) { f[0] = 0; f[1] = 0; }
    for (const q of cells) {
      let cx = 0, cz = 0;
      for (const i of q) { cx += points[i][0] / 4; cz += points[i][1] / 4; }
      // Turn corner k back by k quarter turns; for a perfect square all four then agree.
      let ax = 0, az = 0;
      for (let k = 0; k < 4; k++) {
        const [rx, rz] = turn(points[q[k]][0] - cx, points[q[k]][1] - cz, -k);
        ax += rx / 4; az += rz / 4;
      }
      for (let k = 0; k < 4; k++) {
        const [tx, tz] = turn(ax, az, k);
        force[q[k]][0] += cx + tx - points[q[k]][0];
        force[q[k]][1] += cz + tz - points[q[k]][1];
      }
    }
    for (let i = 0; i < points.length; i++) {
      if (rim[i]) continue;
      points[i][0] += force[i][0] * 0.12;
      points[i][1] += force[i][1] * 0.12;
    }
  }
  for (const p of points) { p[0] = round4(p[0]); p[1] = round4(p[1]); }

  // Neighbours (joined by a cell side) and the cells around each point, both in number order.
  const neighbours = points.map(() => new Set());
  const around = points.map(() => []);
  cells.forEach((q, qi) => {
    for (let k = 0; k < 4; k++) {
      neighbours[q[k]].add(q[(k + 1) % 4]);
      neighbours[q[k]].add(q[(k + 3) % 4]);
      around[q[k]].push(qi);
    }
  });
  const centres = cells.map(q => [round4(q.reduce((s, i) => s + points[i][0], 0) / 4), round4(q.reduce((s, i) => s + points[i][1], 0) / 4)]);

  // Steps from the rim, so land stays well inside the grid.
  const fromRim = points.map(() => Infinity);
  const queue = [];
  points.forEach((_, i) => { if (rim[i]) { fromRim[i] = 0; queue.push(i); } });
  for (let h = 0; h < queue.length; h++) {
    for (const n of neighbours[queue[h]]) if (fromRim[n] === Infinity) { fromRim[n] = fromRim[queue[h]] + 1; queue.push(n); }
  }

  const frozen = list => Object.freeze(list.map(item => Object.freeze(item)));
  return Object.freeze({
    key, id, size, rings, edge,
    points: frozen(points),
    cells: frozen(cells),
    neighbours: frozen(neighbours.map(set => [...set].sort((a, b) => a - b))),
    around: frozen(around.map(list => list.sort((a, b) => a - b))),
    centres: frozen(centres),
    fromRim: Object.freeze(fromRim),
  });
}

function turn(x, z, quarters) {
  const k = ((quarters % 4) + 4) % 4;
  if (k === 0) return [x, z];
  if (k === 1) return [-z, x];
  if (k === 2) return [-x, -z];
  return [z, -x];
}

function fixWinding(s, pts) {
  let area = 0;
  for (let k = 0; k < s.length; k++) { const a = pts[s[k]], b = pts[s[(k + 1) % s.length]]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) s.reverse();
}
