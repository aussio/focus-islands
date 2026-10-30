// One island's ground: the rounded coast, the grass slab and the faceted underside with drips and roots.
//
//   buildGround(ctx, island) => { loop, framePoints }   ctx: the model context with piece(key)
//
// Everything is in island units (grid points as they are, y = 0 at the top of the grass).
//
// - The coast follows the land points' areas: from a side's middle to a cell's middle and on, wherever
//   land meets sky (the grid prototype's coastLoops). Each walk starts at the same place for the same
//   land. Each raw point is pulled toward its neighbours, then three rounds of corner cutting soften it.
//   Every rounded point comes from a few raw points next to each other, so land that comes or goes
//   moves the coast only close by.
// - The slab is the coast's shape: a flat grass top and a soft rounded rim, in the island kind's grass.
//   Its key is `slab`; the drawing check follows it through the loop instead.
// - The underside is drawn per land point, in its corner pieces (keys under:<cell>:<k>): the deeper the
//   point sits from the coast (counted in grid steps, at most 5), the lower it hangs. So a land change
//   reshapes it only within 6 steps. Rock drips hang under some deep points and roots under some coast
//   points, both picked by rolls of the island and point.
// - Islands with a pond or a rain catcher, and mossy and misty ones, pour a waterfall off the coast
//   (water.js, its stones logged with the slab).
//
// framePoints: the underside's upper bulge (the points one and two steps in), for framing the camera.
import * as THREE from 'three';
import { P, ISLAND_GRASS } from '../style.js';
import { taperedTube } from '../ground.js';
import { roll } from '../../town/grid.js';
import { PieceSink, cornerPiece, midpoint } from './pieces.js';
import { buildWaterfall } from './water.js';

// The slab's rim, from the grass edge down: [out from the coast, height].
const RIM = [[0, 0], [0.035, -0.012], [0.068, -0.04], [0.09, -0.085], [0.1, -0.14], [0.094, -0.195], [0.072, -0.245], [0.035, -0.285], [0, -0.3]];
const UNDER_TOP = -0.22; // where the underside meets the slab, at the coast
// How far below the grass a land point hangs, by steps from the coast (1: on the coast). Steep near the
// coast so the camera (about 46 degrees down) sees the underside's sides.
const DEPTH = [0, 1.5, 2.9, 4.0, 4.9, 5.5];
const MAX_STEPS = DEPTH.length - 1;
const ROUNDS = 3; // corner-cutting rounds for the coast

export function buildGround(ctx, island) {
  const { grid, land } = island;
  if (!land.size) return { loop: [], framePoints: [] };
  const grass = ISLAND_GRASS[island.kind] ?? ISLAND_GRASS.home;
  const isLand = p => land.has(p);

  // ---- The coast and the slab ----
  const raw = coastLoops(grid, isLand);
  const loops = raw.map(points => smoothLoop(points, ROUNDS));
  if (loops.length) {
    ctx.piece('slab');
    const slab = slabGeometry(loops, grass);
    ctx.batch.add(slab, 'ground');
    slab.dispose();
    ctx.piece(null);
  }

  // ---- The underside ----
  const sink = new PieceSink(ctx);
  const steps = stepsFromCoast(grid, land, island.coast);
  const depth = new Map();
  for (const p of land) {
    const n = steps.get(p) ?? MAX_STEPS;
    depth.set(p, DEPTH[n] + (roll('under', island.id, p) - 0.5) * (n === 1 ? 0.14 : 0.4));
  }
  const vertexAt = p => { const [x, z] = grid.points[p]; return [x, -depth.get(p), z]; };
  const midAt = (p, q) => {
    const [x, z] = midpoint(grid, p, q);
    return [x, land.has(q) ? -(depth.get(p) + depth.get(q)) / 2 : UNDER_TOP, z];
  };
  const centres = new Map();
  const centreAt = cell => {
    if (!centres.has(cell)) {
      const q = grid.cells[cell], [x, z] = grid.centres[cell];
      centres.set(cell, [x, q.every(isLand) ? -q.reduce((sum, p) => sum + depth.get(p), 0) / 4 : UNDER_TOP, z]);
    }
    return centres.get(cell);
  };
  const tone = new THREE.Color();
  const DOWN = [0, -1, 0];
  const under = sink.mesh('under');
  const framePoints = [];
  for (const p of island.order) {
    const v = vertexAt(p);
    if ((steps.get(p) ?? MAX_STEPS) <= 2) framePoints.push(v);
    for (const cell of grid.around[p]) {
      const c = cornerPiece(grid, cell, grid.cells[cell].indexOf(p));
      sink.begin(`under:${c.key}`);
      const mn = midAt(p, c.next), mc = centreAt(cell), mp = midAt(p, c.prev);
      const lift = (roll('under-tone', island.id, p, cell) - 0.5) * 0.06;
      under.tri(v, mn, mc, underColour(tone, (v[1] + mn[1] + mc[1]) / -3, lift).clone(), DOWN);
      under.tri(v, mc, mp, underColour(tone, (v[1] + mc[1] + mp[1]) / -3, lift + 0.02).clone(), DOWN);
    }
  }

  // ---- Rock drips under some deep points, roots under some coast points ----
  for (const p of island.order) {
    const n = steps.get(p) ?? MAX_STEPS;
    const cell = grid.around[p][0];
    const key = `under:${cell}:${grid.cells[cell].indexOf(p)}`;
    if (n >= 3 && roll('drip', island.id, p) < 0.07) {
      sink.begin(`${key}:drip`);
      const v = vertexAt(p), width = 0.13 + roll('drip-width', island.id, p) * 0.08;
      // The drip's top ring must sit inside the rock all the way round. Around a low point the underside
      // rises steeply, and a ring only a little above the point showed as a separate spike with sky
      // between it and the island. So the ring goes up as far as the steepest rock around it rises.
      let slope = 0;
      for (const cell of grid.around[p]) {
        const c = cornerPiece(grid, cell, grid.cells[cell].indexOf(p));
        const [mn, mc, mp] = [midAt(p, c.next), centreAt(cell), midAt(p, c.prev)];
        slope = Math.max(slope, steepest(v, mn, mc), steepest(v, mc, mp));
      }
      addDrip(under, v, 0.4 + roll('drip-length', island.id, p) * 0.8, width, roll('drip-turn', island.id, p), slope * width + 0.06);
    }
    if (n === 1 && roll('root', island.id, p) < 0.3) {
      const sky = grid.neighbours[p].find(q => !land.has(q));
      if (sky === undefined) continue;
      const [px, pz] = grid.points[p], [sx, sz] = grid.points[sky];
      const dx = sx - px, dz = sz - pz, l = Math.hypot(dx, dz) || 1, ox = dx / l, oz = dz / l;
      if (oz < -0.3) continue; // roots on the far side are never seen
      sink.begin(`${key}:root`);
      const [mx, mz] = midpoint(grid, p, sky);
      const length = 0.3 + roll('root-length', island.id, p) * 0.35, sway = (roll('root-sway', island.id, p) - 0.5) * 0.16;
      const start = [mx - ox * 0.06, -0.16, mz - oz * 0.06];
      const bend = [mx + ox * 0.05 - oz * sway * 0.4, -0.16 - length * 0.55, mz + oz * 0.05 + ox * sway * 0.4];
      const end = [mx + ox * 0.07 - oz * sway, -0.16 - length, mz + oz * 0.07 + ox * sway];
      sink.geometry(taperedTube([start, bend, end], 0.03, 0.008, 5), 'facet', P.root);
    }
  }
  sink.flush();
  buildWaterfall(ctx, island, loops[0]); // some islands pour a waterfall off the south side (water.js)
  return { loop: loops[0] ?? [], framePoints };
}

// ---------- Steps from the coast ----------
// 1 for coast points, then one more per step inland, at most MAX_STEPS. Depends only on land within
// MAX_STEPS steps of a point.
function stepsFromCoast(grid, land, coast) {
  const steps = new Map();
  const queue = [];
  for (const p of coast) { steps.set(p, 1); queue.push(p); }
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h], n = steps.get(p);
    if (n >= MAX_STEPS) continue;
    for (const q of grid.neighbours[p]) if (land.has(q) && !steps.has(q)) { steps.set(q, n + 1); queue.push(q); }
  }
  return steps;
}

// ---------- Coast ----------
// Loops of [x, z] along the edges of the land points' areas, the biggest first. Each loop starts at the
// same raw point for the same land (the one whose name sorts first), so it starts at the same place.
export function coastLoops(grid, isLand) {
  const out = new Map();
  const pointOf = new Map();
  const add = (from, to, fromP, toP, corner) => {
    pointOf.set(from, fromP); pointOf.set(to, toP);
    if (!out.has(from)) out.set(from, []);
    out.get(from).push({ from, to, corner, used: false });
  };
  const midKey = (i, j) => (i < j ? `m${i}:${j}` : `m${j}:${i}`);
  grid.cells.forEach((q, cell) => {
    for (let k = 0; k < 4; k++) {
      const s = q[k];
      if (!isLand(s)) continue;
      const next = q[(k + 1) % 4], prev = q[(k + 3) % 4];
      if (!isLand(next)) add(midKey(s, next), `c${cell}`, midpoint(grid, s, next), grid.centres[cell], `${cell}:${k}`);
      if (!isLand(prev)) add(`c${cell}`, midKey(prev, s), grid.centres[cell], midpoint(grid, prev, s), `${cell}:${k}`);
    }
  });
  const loops = [];
  for (const list of out.values()) for (const first of list) {
    if (first.used) continue;
    const keys = [];
    let seg = first;
    while (seg && !seg.used) {
      seg.used = true;
      keys.push(seg.from);
      const options = (out.get(seg.to) ?? []).filter(s => !s.used);
      // Where two land areas touch only at a cell's middle, stay with the same corner piece.
      seg = options.find(s => s.corner === seg.corner) ?? options[0];
    }
    if (keys.length < 3) continue;
    let start = 0;
    keys.forEach((key, i) => { if (key < keys[start]) start = i; });
    const points = [...keys.slice(start), ...keys.slice(0, start)].map(key => pointOf.get(key));
    if (Math.abs(area(points)) > 0.05) loops.push(points);
  }
  return loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}

export function area(loop) {
  let s = 0;
  loop.forEach((p, i) => { const q = loop[(i + 1) % loop.length]; s += p[0] * q[1] - q[0] * p[1]; });
  return s / 2;
}

// Corner cutting: each side gives two points, a quarter of the way in from each end. Each new point
// comes from two neighbouring old ones, so the loop stays the same away from a change.
function smoothLoop(points, rounds) {
  // First pull each raw point half way toward its neighbours' middle: this irons out the zigzag between
  // side middles and cell middles, which corner cutting alone leaves as small teeth.
  let loop = points.map((p, i) => {
    const a = points[(i - 1 + points.length) % points.length], b = points[(i + 1) % points.length];
    return [p[0] * 0.5 + (a[0] + b[0]) * 0.25, p[1] * 0.5 + (a[1] + b[1]) * 0.25];
  });
  for (let r = 0; r < rounds; r++) {
    const next = [];
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    });
    loop = next;
  }
  return loop.map(([x, z]) => [round4(x), round4(z)]);
}
const round4 = v => Math.round(v * 1e4) / 1e4 + 0;

// ---------- The slab ----------
// One geometry for every loop: loops turning the same way as the biggest are land, the others holes in
// the land around them. A flat grass top and a rounded rim, with smooth normals.
function slabGeometry(loops, grass) {
  const sign = Math.sign(area(loops[0])) || 1;
  const outers = loops.filter(loop => Math.sign(area(loop)) === sign);
  const holes = loops.filter(loop => Math.sign(area(loop)) !== sign);
  const positions = [], colors = [], index = [];
  const top = new THREE.Color(grass.top), side = new THREE.Color(grass.side), deep = new THREE.Color(grass.side).multiplyScalar(0.88);
  const c = new THREE.Color();
  const vertex = (x, y, z, color) => { positions.push(x, y, z); colors.push(color.r, color.g, color.b); return positions.length / 3 - 1; };
  // The flat top.
  for (const outer of outers) {
    const inside = holes.filter(hole => contains(outer, hole[0]));
    const flat = [outer, ...inside];
    const faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, z]) => new THREE.Vector2(x, z)), inside.map(h => h.map(([x, z]) => new THREE.Vector2(x, z))));
    const base = positions.length / 3;
    for (const loop of flat) for (const [x, z] of loop) vertex(x, 0, z, top);
    const all = flat.flat();
    for (const [a, b, d] of faces) {
      const pa = all[a], pb = all[b], pd = all[d];
      const up = (pb[0] - pa[0]) * (pd[1] - pa[1]) - (pb[1] - pa[1]) * (pd[0] - pa[0]); // > 0: faces down
      if (up > 0) index.push(base + a, base + d, base + b); else index.push(base + a, base + b, base + d);
    }
  }
  // The rim around every loop, out from the land.
  for (const loop of loops) {
    const n = loop.length, base = positions.length / 3;
    const normals = loop.map((p, i) => {
      const a = loop[(i - 1 + n) % n], b = loop[(i + 1) % n];
      const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
      const n1 = [e1[1] / l1 * sign, -e1[0] / l1 * sign], n2 = [e2[1] / l2 * sign, -e2[0] / l2 * sign];
      const m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(...m) || 1;
      const k = Math.min(1.6, 1 / Math.max(0.3, (m[0] / ml) * n1[0] + (m[1] / ml) * n1[1]));
      return [m[0] / ml * k, m[1] / ml * k];
    });
    RIM.forEach(([out, y], r) => {
      const t = r / (RIM.length - 1);
      c.copy(top).lerp(side, Math.min(1, t * 2.4));
      if (t > 0.5) c.lerp(deep, (t - 0.5) * 2);
      for (let i = 0; i < n; i++) vertex(loop[i][0] + normals[i][0] * out, y, loop[i][1] + normals[i][1] * out, c);
    });
    // Which way round the rim's faces go, so they face out: tried on the widest band's first face.
    const at = v => positions.slice(v * 3, v * 3 + 3);
    const w = Math.floor(RIM.length / 2), a0 = at(base + w * n), b0 = at(base + w * n + 1), d0 = at(base + (w + 1) * n);
    const u1 = [d0[0] - a0[0], d0[1] - a0[1], d0[2] - a0[2]], u2 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
    const nx = u1[1] * u2[2] - u1[2] * u2[1], nz = u1[0] * u2[1] - u1[1] * u2[0];
    const flip = nx * normals[0][0] + nz * normals[0][1] < 0;
    for (let r = 0; r < RIM.length - 1; r++) for (let i = 0; i < n; i++) {
      const a = base + r * n + i, b = base + r * n + (i + 1) % n, d = a + n, e = b + n;
      if (!flip) index.push(a, d, b, b, d, e); else index.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function contains(loop, [x, z]) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i], [xj, zj] = loop[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- Underside pieces ----------
// Soil near the top, lilac rock lower down; a little darker the deeper it hangs. t: depth below the grass.
const UNDER_STOPS = [[0, P.soil], [1.0, P.soilDeep], [2.3, P.rock], [5.5, P.rockDeep]].map(([t, hex]) => [t, new THREE.Color(hex)]);
function underColour(color, depth, lift = 0) {
  let i = 0;
  while (i < UNDER_STOPS.length - 2 && depth > UNDER_STOPS[i + 1][0]) i++;
  const [t0, c0] = UNDER_STOPS[i], [t1, c1] = UNDER_STOPS[i + 1];
  color.copy(c0).lerp(c1, Math.min(1, Math.max(0, (depth - t0) / (t1 - t0))));
  return color.multiplyScalar(1 - Math.min(1, depth / 5.5) * 0.1 + lift);
}

// How steeply the flat triangle v, a, b rises from v at its steepest (height per unit across).
export function steepest(v, a, b) {
  const ax = a[0] - v[0], az = a[2] - v[2], bx = b[0] - v[0], bz = b[2] - v[2];
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) return 0;
  const ha = a[1] - v[1], hb = b[1] - v[1];
  return Math.hypot((ha * bz - hb * az) / det, (ax * hb - bx * ha) / det);
}

// A rock drip: a five-sided point hanging from v, with a bend half way. rise: how far above v its top
// ring sits, so the ring is hidden inside the rock.
function addDrip(mesh, v, length, width, turn, rise = 0.12) {
  const ring = (y, r, spin) => Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5 + spin) * Math.PI * 2;
    return [v[0] + Math.cos(a) * r, y, v[2] + Math.sin(a) * r];
  });
  const topRing = ring(v[1] + Math.max(0.12, rise), width, turn), midRing = ring(v[1] - length * 0.45, width * 0.55, turn + 0.1);
  const tip = [v[0] + (turn - 0.5) * 0.06, v[1] - length, v[2] + (turn - 0.5) * 0.04];
  const colourAt = d => underColour(new THREE.Color(), d, 0);
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    const out = [(topRing[i][0] + topRing[j][0]) / 2 - v[0], -0.2, (topRing[i][2] + topRing[j][2]) / 2 - v[2]];
    mesh.quad(topRing[i], topRing[j], midRing[j], midRing[i], colourAt(-v[1] + length * 0.2), out);
    mesh.tri(midRing[i], midRing[j], tip, colourAt(-v[1] + length * 0.7).multiplyScalar(0.95), out);
  }
}
