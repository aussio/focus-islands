// Bridges between islands, in world space. Stream D owns this.
//
//   deckPath(bridge, model) => [[x, y, z], ...]    the deck's middle line, foot to foot, about every 0.1
//   buildBridge(ctx, bridge, model)                draws one bridge by its type (BRIDGE_TYPES in kinds.js)
//   bridgeWays(bridge, model) => { length, forward, back }   how helpers cross it (walk.js)
//
// bridge: parseTown's { id, type, from: end, to: end }, end = { island, point, at: [x, y, z], out: [dx, dz],
// clear }. A water slide's `from` end is the higher one. model: parseTown's model (only byId or islands
// are read, for an end without `at`).
//
// The deck runs straight from each foot along its `out` for `clear`, then bends smoothly across open sky
// (a curve that leaves each straight part along its own way out), and eases in height from one island's
// lift to the other's (smoothstep over the length, so it starts and ends level). Every type is drawn
// around that same line, so it fits any pair of feet at any distance and height difference:
//
// - rope: planks every 0.17 that follow the bends and the slope, posts at each end, sagging rope rails.
// - arch: a stone deck that humps up 0.25 in the middle, low walls with white caps, and a body whose
//   underside rises from the feet to a thin crown with a keystone.
// - slide: a rounded chute from the higher foot down to a splash pool at the lower one, light stripes
//   running downhill on the water at 0.8 a second, and a narrow stair with a hand rail beside it.
// - cloudsteps: a flat-topped cloud puff every 0.45, each bobbing 0.03, out of step with its neighbours.
// - flowerarch: a plank walk under a white hoop every 0.6, each wound with leaves and flowers in the
//   nearer island's flower colours.
// - rainbow: a band 0.5 wide in six soft stripes that arcs 0.6 above the path and glows a little at dusk.
//
// Each bridge is one small group: static parts go into ctx.batch (the mood materials), and the few
// moving parts (water stripes, clouds) are their own meshes in ctx.root, driven by ctx.dynamic. Each
// type stays under 4,000 triangles at any length (long bridges get sparser hoops and puffs). With reduced
// motion the scene calls the dynamic parts with a fixed time, so the stripes and clouds hold still.
import * as THREE from 'three';
import { BRIDGE_TYPES } from '../../kinds.js';
import { P } from '../style.js';
import { Batch, hashString, place } from '../ground.js';
import { chunk } from '../parts.js';
import { PieceMesh } from './pieces.js';

const STEP = 0.1; // deck path spacing
const BEND = 1 / 3; // how far each bend handle reaches, as a share of the open gap (as town/sky.js deckLine)
export const HUMP = 0.25; // the stone arch's hump
export const RAINBOW_ARC = 0.6; // the rainbow's rise above the path
// Water slide sizes, shared by the drawing and the walk.
const CHUTE = { axis: 0.1, inner: 0.17, outer: 0.21, water: 0.05, start: 0.1 };
const POOL = { back: 0.32, radius: 0.3 }; // the splash pool's middle sits `back` from the lower foot
const STAIR = { side: 0.37, width: 0.2, every: 0.11, start: 0.25 };
const EDGE = 0.32; // about where the island's grass ends beyond a foot
const MAX_TRIANGLES = 4000;

// Each island kind's flower colours, for the flower arch.
const FLOWER_COLOURS = {
  home: ['#ff8fb4', '#ffd25e', '#ffffff'],
  mossy: ['#ffffff', '#b88cff', '#ff8fb4'],
  rocky: ['#ffd25e', '#ff9d3f', '#ffffff'],
  meadow: ['#ff6b6b', '#ffd25e', '#ff8fb4'],
  crystal: ['#b99cff', '#8fd8ff', '#ffa8e0'],
  misty: ['#ffffff', '#9fd0ff', '#d6c6ff'],
};
const RAINBOW = ['#ff9a9a', '#ffbf86', '#ffe48a', '#a8e6a0', '#9fd0ff', '#c9b0ff'];

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const smooth = t => t * t * (3 - 2 * t);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const typeOf = bridge => (BRIDGE_TYPES.includes(bridge?.type) ? bridge.type : 'rope');

// ---------- The deck's path ----------

function islandOf(model, id) {
  return model?.byId?.get?.(id) ?? model?.islands?.find(island => island.id === id) ?? null;
}

// One end in world space: { at: [x, y, z], out: [dx, dz] unit, clear }.
function endOf(end, model) {
  let at = Array.isArray(end?.at) && end.at.length === 3 && end.at.every(finite) ? end.at : null;
  if (!at) {
    const island = islandOf(model, end?.island);
    const p = island?.grid?.points?.[end?.point];
    at = island && p ? [island.at[0] + p[0], island.lift ?? 0, island.at[1] + p[1]] : [0, 0, 0];
  }
  let out = [1, 0];
  if (Array.isArray(end?.out) && end.out.every(finite) && Math.hypot(end.out[0], end.out[1]) > 1e-9) out = end.out;
  else if (finite(end?.out)) out = [Math.cos(end.out * Math.PI / 180), Math.sin(end.out * Math.PI / 180)];
  const length = Math.hypot(out[0], out[1]);
  return { at, out: [out[0] / length, out[1] / length], clear: finite(end?.clear) && end.clear > 0 ? end.clear : 0 };
}

export function deckPath(bridge, model) {
  const a = endOf(bridge.from, model), b = endOf(bridge.to, model);
  const A = [a.at[0], a.at[2]], B = [b.at[0], b.at[2]];
  const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
  // The same flat line as the layout's deckLine (town/sky.js), which checks it clears the land. Only if
  // the two straight runs would take more than 90% of the span are they shortened, so the bend has room.
  let ca = a.clear, cb = b.clear;
  if (ca + cb > span * 0.9) { const k = span * 0.9 / (ca + cb); ca *= k; cb *= k; }
  const A1 = [A[0] + a.out[0] * ca, A[1] + a.out[1] * ca], B1 = [B[0] + b.out[0] * cb, B[1] + b.out[1] * cb];
  const h = Math.hypot(B1[0] - A1[0], B1[1] - A1[1]) * BEND;
  const c1 = [A1[0] + a.out[0] * h, A1[1] + a.out[1] * h], c2 = [B1[0] + b.out[0] * h, B1[1] + b.out[1] * h];
  const dense = [A];
  const push = p => { const q = dense[dense.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) dense.push(p); };
  push(A1);
  for (let i = 1; i < 48; i++) {
    const t = i / 48, s = 1 - t;
    push([
      s * s * s * A1[0] + 3 * s * s * t * c1[0] + 3 * s * t * t * c2[0] + t * t * t * B1[0],
      s * s * s * A1[1] + 3 * s * s * t * c1[1] + 3 * s * t * t * c2[1] + t * t * t * B1[1],
    ]);
  }
  push(B1);
  push(B);
  // Even spacing along the ground plan, then the height eased from one lift to the other.
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.ceil(total / STEP));
  const out = [];
  let j = 0;
  for (let i = 0; i <= count; i++) {
    const s = total * i / count;
    while (j < dense.length - 2 && lengths[j + 1] < s) j++;
    const seg = lengths[j + 1] - lengths[j] || 1, k = Math.min(1, Math.max(0, (s - lengths[j]) / seg));
    const x = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * k, z = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * k;
    const y = a.at[1] + (b.at[1] - a.at[1]) * smooth(total > 0 ? s / total : 0);
    out.push([round4(x), round4(y), round4(z)]);
  }
  return out;
}

// A path with its lengths, for sampling at any distance along it (3D).
function makeTrack(points) {
  const d = [0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    d.push(d[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return { points, d, length: d[d.length - 1] };
}

function pointAt(track, s) {
  const { points, d } = track;
  const x = Math.min(track.length, Math.max(0, s));
  let lo = 0, hi = d.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= x) lo = mid; else hi = mid; }
  const k = (x - d[lo]) / ((d[hi] - d[lo]) || 1);
  const a = points[lo], b = points[hi];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Where the deck is at distance s: its point, its way forward (with the slope), its level way forward,
// and the level side to its right. u is s as a share of the length.
function sampleAt(track, s) {
  const p = pointAt(track, s);
  const a = pointAt(track, s - 0.06), b = pointAt(track, s + 0.06);
  const f = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (f.lengthSq() < 1e-12) f.set(0, 0, 1);
  f.normalize();
  const flat = new THREE.Vector3(f.x, 0, f.z);
  if (flat.lengthSq() < 1e-9) flat.set(0, 0, 1);
  flat.normalize();
  const side = new THREE.Vector3(flat.z, 0, -flat.x); // up × forward
  return { p, f, flat, side, u: track.length > 0 ? s / track.length : 0, s };
}

// A frame at a sample: +x the side, +y up, +z forward. tilt: follow the slope; otherwise stay upright.
function frameOf(sample, tilt = true) {
  const forward = tilt ? sample.f : sample.flat;
  const up = new THREE.Vector3().crossVectors(forward, sample.side).normalize();
  const m = new THREE.Matrix4().makeBasis(sample.side, up, forward);
  m.setPosition(sample.p[0], sample.p[1], sample.p[2]);
  return m;
}

// A point beside the deck: a across (to the right), h straight up.
const beside = (sample, a, h = 0) => [sample.p[0] + sample.side.x * a, sample.p[1] + h, sample.p[2] + sample.side.z * a];

// Distances spread from s0 to s1, about `every` apart, at most `most` of them (with both ends).
function spread(s0, s1, every, most = Infinity) {
  if (s1 <= s0) return [s0];
  const n = Math.max(1, Math.min(most - 1, Math.round((s1 - s0) / every)));
  return Array.from({ length: n + 1 }, (_, i) => s0 + (s1 - s0) * i / n);
}

// ---------- Shared bits for the drawings ----------

const put = (ctx, geometry, mat, color, matrix) => {
  ctx.batch.add(geometry, mat, { color, matrix });
  geometry.dispose();
};
const putMesh = (ctx, mesh, mat = 'matte') => {
  if (mesh.empty) return;
  const geometry = mesh.geometry();
  ctx.batch.add(geometry, mat);
  geometry.dispose();
};

// A plain tube through points (ropes, rails, stringers).
function tube(points, r, radial = 4) {
  const positions = [], index = [];
  const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    n1.crossVectors(t, up);
    if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0);
    n1.normalize();
    n2.crossVectors(n1, t).normalize();
    for (let j = 0; j < radial; j++) {
      const ang = j / radial * Math.PI * 2;
      positions.push(p[0] + (n1.x * Math.cos(ang) + n2.x * Math.sin(ang)) * r, p[1] + (n1.y * Math.cos(ang) + n2.y * Math.sin(ang)) * r, p[2] + (n1.z * Math.cos(ang) + n2.z * Math.sin(ang)) * r);
    }
  });
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A strip along the deck: for each sample, two cross-section points (a, h) to (a, h), joined to the next.
function strip(mesh, samples, from, to, colour, hint) {
  for (let i = 0; i < samples.length - 1; i++) {
    const s = samples[i], n = samples[i + 1];
    const c = typeof colour === 'function' ? colour(i) : colour;
    const fa = typeof from === 'function' ? from(s) : from, ta = typeof to === 'function' ? to(s) : to;
    const fb = typeof from === 'function' ? from(n) : from, tb = typeof to === 'function' ? to(n) : to;
    const h = typeof hint === 'function' ? hint(s) : hint;
    mesh.quad(beside(s, fa[0], fa[1]), beside(n, fb[0], fb[1]), beside(n, tb[0], tb[1]), beside(s, ta[0], ta[1]), c, h);
  }
}
const sideHint = (s, k) => [s.side.x * k, 0, s.side.z * k];

// A soft cloud puff with a flat top at y = 0, about 0.42 across. Its colours are baked in.
function puffGeometry(seed, size = 1) {
  const flatten = (g, top) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > top) p.setY(i, top + (p.getY(i) - top) * 0.12);
    g.computeVertexNormals();
    return g;
  };
  const batch = new Batch();
  const parts = [[0, 0.2, [1.15, 0.55, 1]], [0.13, 0.13, [1, 0.62, 1]]];
  parts.forEach(([x, r, squash], i) => {
    const g = flatten(chunk(r * size, seed + i * 3, squash, 1, 0.07), 0.035 * size);
    batch.add(g, 'cloud', { color: '#ffffff', matrix: place(x * size, -0.04 * size, i ? 0.06 * size : 0), ao: { ground: -0.13 * size, height: 0.13 * size, min: 0.8 } });
    g.dispose();
  });
  const group = new THREE.Group();
  const [mesh] = batch.build({ cloud: null }, group);
  return mesh.geometry;
}

// ---------- The drawings ----------

export function buildBridge(ctx, bridge, model) {
  const path = deckPath(bridge, model);
  if (path.length < 2) return;
  ctx.piece?.(`bridge:${bridge.id}`);
  const type = typeOf(bridge);
  const seed = hashString(`${bridge.id}`) * 1000;
  const draw = { rope, arch, slide, cloudsteps, flowerarch, rainbow }[type];
  draw(ctx, makeTrack(path), { bridge, model, seed });
}

// Rope bridge: today's look, now along any path.
function rope(ctx, track, { bridge, seed }) {
  const L = track.length;
  const plank = new THREE.BoxGeometry(0.66, 0.05, 0.13);
  const count = Math.max(2, Math.round(L / 0.17));
  for (let i = 0; i < count; i++) {
    const s = sampleAt(track, (i + 0.5) / count * L);
    const jx = (hashString(`${bridge.id}:x${i}`) - 0.5) * 0.03, jr = (hashString(`${bridge.id}:r${i}`) - 0.5) * 0.08;
    ctx.batch.add(plank, 'matte', { color: i % 2 ? P.plank : P.plankDark, matrix: frameOf(s).multiply(place(jx, -0.03, 0, { ry: jr })) });
  }
  plank.dispose();
  ropeSides(ctx, track, { stringers: true });
}

// Posts at each end, sagging rope rails with hangers, and (for the rope bridge) stringers under the planks.
function ropeSides(ctx, track, { stringers = false, rails = true } = {}) {
  const L = track.length;
  if (stringers) for (const k of [-1, 1]) {
    const pts = spread(0.05, L - 0.05, 0.3).map(d => { const s = sampleAt(track, d); return beside(s, k * 0.24, -0.07); });
    put(ctx, tube(pts, 0.025, 4), 'matte', P.post);
  }
  if (!rails) return;
  const post = new THREE.BoxGeometry(0.07, 0.42, 0.07).translate(0, 0.21, 0), cap = new THREE.BoxGeometry(0.1, 0.03, 0.1);
  const ends = [0.15, L - 0.15];
  for (const d of ends) for (const k of [-1, 1]) {
    const s = sampleAt(track, d), m = frameOf(s, false).multiply(place(k * 0.3, 0, 0));
    ctx.batch.add(post, 'matte', { color: P.post, matrix: m, ao: { ground: s.p[1], height: 0.32, min: 0.6 } });
    ctx.batch.add(cap, 'matte', { color: P.trim, matrix: m.clone().multiply(place(0, 0.43, 0)) });
  }
  post.dispose(); cap.dispose();
  const run = ends[1] - ends[0];
  const sag = u => 0.33 - Math.sin(u * Math.PI) * 0.1;
  const hanger = new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, 0.5, 0);
  for (const k of [-1, 1]) {
    const pts = spread(ends[0], ends[1], 0.3).map(d => beside(sampleAt(track, d), k * 0.3, sag((d - ends[0]) / run)));
    put(ctx, tube(pts, 0.016, 4), 'matte', P.rope);
    for (const d of spread(ends[0], ends[1], 0.5).slice(1, -1)) {
      const s = sampleAt(track, d), h = sag((d - ends[0]) / run);
      const [x, y, z] = beside(s, k * 0.3, -0.01);
      ctx.batch.add(hanger, 'matte', { color: P.rope, matrix: place(x, y, z, { sy: h }) });
    }
  }
  hanger.dispose();
}

// Stone arch: a humped deck, low walls, and a body whose underside arches up to a keystone.
function arch(ctx, track) {
  const L = track.length;
  const w = 0.3, wall = 0.08, wallH = 0.12, out = w + wall;
  const lift = u => HUMP * Math.sin(Math.PI * u);
  const depth = u => 0.1 + 0.36 * Math.pow(1 - Math.sin(Math.PI * u), 1.4);
  const samples = spread(0, L, 0.12, 90).map(d => {
    const s = sampleAt(track, d);
    return { ...s, p: [s.p[0], s.p[1] + lift(s.u), s.p[2]] };
  });
  const mesh = new PieceMesh();
  const up = [0, 1, 0], down = [0, -1, 0];
  const lilacStone = '#d3cdea', ring = ['#fffaf2', '#e4e1f0'];
  strip(mesh, samples, [-w, 0], [w, 0], i => (Math.floor(i / 2) % 2 ? P.stone : '#e6e7f0'), up);
  for (const k of [-1, 1]) {
    strip(mesh, samples, [k * w, 0], [k * w, wallH], P.stoneDark, s => sideHint(s, -k));
    strip(mesh, samples, [k * w, wallH], [k * out, wallH], P.trim, up);
    strip(mesh, samples, [k * out, wallH], s => [k * out, -depth(s.u) + 0.08], lilacStone, s => sideHint(s, k));
    strip(mesh, samples, s => [k * out, -depth(s.u) + 0.08], s => [k * out, -depth(s.u)], i => ring[i % 2], s => sideHint(s, k));
  }
  strip(mesh, samples, s => [-out, -depth(s.u)], s => [out, -depth(s.u)], P.lilac, down);
  // Close the two ends, which sit inside each island's coast.
  for (const [s, k] of [[samples[0], -1], [samples[samples.length - 1], 1]]) {
    const hint = [s.flat.x * k, 0, s.flat.z * k], dd = depth(s.u);
    mesh.quad(beside(s, -out, wallH), beside(s, out, wallH), beside(s, out, -dd), beside(s, -out, -dd), P.stoneDark, hint);
  }
  // The keystone, a little proud of each face at the crown.
  const crown = sampleAt(track, L / 2), cy = crown.p[1] + lift(0.5), dc = depth(0.5);
  for (const k of [-1, 1]) {
    const a0 = k * out, a1 = k * (out + 0.02), hint = sideHint(crown, k);
    const fw = crown.flat;
    const at = (a, along, h) => [crown.p[0] + crown.side.x * a + fw.x * along, cy + h, crown.p[2] + crown.side.z * a + fw.z * along];
    const top = 0.075, bottom = 0.05, y0 = -dc - 0.03, y1 = -dc + 0.14;
    mesh.quad(at(a1, -bottom, y0), at(a1, bottom, y0), at(a1, top, y1), at(a1, -top, y1), P.trim, hint);
    for (const e of [-1, 1]) {
      const wb = e * bottom, wt = e * top;
      mesh.quad(at(a0, wb, y0), at(a1, wb, y0), at(a1, wt, y1), at(a0, wt, y1), '#efe9f7', [fw.x * e, 0, fw.z * e]);
    }
    mesh.quad(at(a0, -bottom, y0), at(a0, bottom, y0), at(a1, bottom, y0), at(a1, -bottom, y0), '#efe9f7', down);
  }
  putMesh(ctx, mesh);
}

// The water slide's chute runs from the higher end; downhill() gives the track that way round.
function downhillTrack(track) {
  const pts = track.points;
  return pts[0][1] >= pts[pts.length - 1][1] ? track : makeTrack(pts.slice().reverse());
}

// Which side the stair takes: away from the camera (north), so the chute stays in front.
function stairSide(track) {
  const mid = sampleAt(track, track.length / 2);
  if (Math.abs(mid.side.z) > 0.15) return mid.side.z < 0 ? 1 : -1;
  return mid.side.x < 0 ? 1 : -1;
}

function slide(ctx, track0) {
  const track = downhillTrack(track0);
  const L = track.length;
  const poolAt = L - POOL.back, chuteEnd = poolAt - POOL.radius * 0.6;
  const shell = '#36bfb0', inside = '#dff6ff', water = '#62c8f5';
  // The chute: a half pipe whose axis sits CHUTE.axis above the path.
  const samples = spread(CHUTE.start - 0.05, chuteEnd, 0.14, 50).map(d => {
    const s = sampleAt(track, d);
    return { ...s, p: [s.p[0], s.p[1] + CHUTE.axis, s.p[2]] };
  });
  const mesh = new PieceMesh();
  const K = 6, arc = (r, k) => [r * Math.cos(Math.PI * k / K), -r * Math.sin(Math.PI * k / K)];
  for (let k = 0; k < K; k++) {
    const mid = Math.PI * (k + 0.5) / K;
    strip(mesh, samples, arc(CHUTE.inner, k), arc(CHUTE.inner, k + 1), inside, s => [-s.side.x * Math.cos(mid), Math.sin(mid), -s.side.z * Math.cos(mid)]);
    strip(mesh, samples, arc(CHUTE.outer, k), arc(CHUTE.outer, k + 1), shell, s => [s.side.x * Math.cos(mid), -Math.sin(mid), s.side.z * Math.cos(mid)]);
  }
  for (const k of [-1, 1]) strip(mesh, samples, [k * CHUTE.inner, 0], [k * (CHUTE.outer + 0.015), 0], P.trim, [0, 1, 0]);
  const wy = -CHUTE.inner + CHUTE.water, ww = Math.sqrt(CHUTE.inner ** 2 - wy ** 2);
  strip(mesh, samples, [-ww, wy], [ww, wy], water, [0, 1, 0]);
  // The top end is closed with a white cap.
  {
    const s = samples[0], hint = [-s.flat.x, 0, -s.flat.z];
    for (let k = 0; k < K; k++) mesh.quad(beside(s, ...arc(CHUTE.inner, k)), beside(s, ...arc(CHUTE.inner, k + 1)), beside(s, ...arc(CHUTE.outer, k + 1)), beside(s, ...arc(CHUTE.outer, k)), P.trim, hint);
  }

  // The stair beside it: level steps, a board each side, and a hand rail on the outside.
  const k = stairSide(track);
  const stairEnd = poolAt - POOL.radius - 0.1;
  // At most 70 steps: a long stair gets slightly deeper steps, so it stays inside the triangle budget.
  const stepAt = spread(STAIR.start, stairEnd, STAIR.every, 70);
  const depth = (stepAt.length > 1 ? (stepAt[stepAt.length - 1] - stepAt[0]) / (stepAt.length - 1) : STAIR.every) + 0.01;
  const step = new THREE.BoxGeometry(STAIR.width, 0.035, depth);
  const stepSamples = stepAt.map(d => sampleAt(track, d));
  stepSamples.forEach((s, i) => {
    ctx.batch.add(step, 'matte', { color: i % 2 ? P.plank : P.plankDark, matrix: frameOf(s, false).multiply(place(k * STAIR.side, -0.0175, 0)) });
  });
  step.dispose();
  for (const e of [-1, 1]) {
    const a = k * STAIR.side + e * (STAIR.width / 2 + 0.012);
    for (const hint of [-1, 1]) strip(mesh, stepSamples, [a, -0.09], [a, -0.02], P.post, s => sideHint(s, hint));
  }
  const railA = k * (STAIR.side + STAIR.width / 2 + 0.02);
  const posts = spread(STAIR.start + 0.05, stairEnd - 0.05, 0.5).map(d => sampleAt(track, d));
  const postGeometry = new THREE.BoxGeometry(0.03, 0.27, 0.03).translate(0, 0.135, 0);
  for (const s of posts) {
    const [x, y, z] = beside(s, railA, 0);
    ctx.batch.add(postGeometry, 'matte', { color: P.trim, matrix: place(x, y, z) });
  }
  postGeometry.dispose();
  put(ctx, tube(spread(STAIR.start + 0.05, stairEnd - 0.05, 0.25).map(d => beside(sampleAt(track, d), railA, 0.27)), 0.014, 4), 'matte', P.trim);

  // The splash pool at the bottom foot.
  const pool = sampleAt(track, poolAt);
  const [px, py, pz] = pool.p;
  put(ctx, new THREE.CylinderGeometry(POOL.radius, POOL.radius * 0.88, 0.14, 16), 'matte', P.stone, place(px, py - 0.02, pz));
  put(ctx, new THREE.TorusGeometry(POOL.radius - 0.015, 0.025, 4, 16).rotateX(Math.PI / 2), 'matte', P.trim, place(px, py + 0.062, pz));
  put(ctx, new THREE.CircleGeometry(POOL.radius - 0.03, 16).rotateX(-Math.PI / 2), 'matte', water, place(px, py + 0.056, pz));
  putMesh(ctx, mesh);

  // Light stripes on the water, running downhill at 0.8 a second.
  const length = chuteEnd - CHUTE.start + POOL.radius * 0.4;
  const gap = 0.3, count = Math.max(3, Math.min(40, Math.floor(length / gap)));
  const stripeGeometry = new THREE.PlaneGeometry(0.04, 0.15).rotateX(-Math.PI / 2);
  const stripeMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });
  const stripes = new THREE.InstancedMesh(stripeGeometry, stripeMaterial, count);
  stripes.name = 'slide-stripes';
  stripes.frustumCulled = false;
  ctx.root.add(stripes);
  ctx.track(stripeGeometry, stripeMaterial, stripes);
  const m = new THREE.Matrix4();
  const lanes = [-0.05, 0.035, -0.005];
  const update = t => {
    for (let i = 0; i < count; i++) {
      const along = ((i * length / count + 0.8 * t) % length + length) % length;
      const d = CHUTE.start + along, fade = Math.min(1, along / 0.3, (length - along) / 0.3);
      const s = sampleAt(track, Math.min(d, poolAt));
      m.copy(frameOf(s)).multiply(place(lanes[i % 3], CHUTE.axis + wy + 0.006, 0, { s: Math.max(0.01, fade) }));
      if (d > chuteEnd) m.setPosition(s.p[0] + s.side.x * lanes[i % 3] * 0.5, py + 0.06, s.p[2] + s.side.z * lanes[i % 3] * 0.5);
      stripes.setMatrixAt(i, m);
    }
    stripes.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.dynamic.push(update);
}

// Where the cloud puffs sit: from just past one coast to just before the other.
function cloudSpots(track) {
  const L = track.length;
  if (L < 2 * EDGE + 0.2) return spread(L * 0.3, L * 0.7, 0.45);
  return spread(EDGE, L - EDGE, 0.45, 22);
}

function cloudsteps(ctx, track, { seed }) {
  const spots = cloudSpots(track).map(d => sampleAt(track, d));
  const geometry = puffGeometry(seed);
  const puffs = new THREE.InstancedMesh(geometry, ctx.materials.matte, spots.length);
  puffs.name = 'cloud-steps';
  puffs.castShadow = true;
  puffs.receiveShadow = true;
  puffs.frustumCulled = false;
  ctx.root.add(puffs);
  ctx.track(geometry, puffs);
  const phases = spots.map((_, i) => i * 2.3 + hashString(`${seed}:${i}`) * 6.28);
  const turns = spots.map((s, i) => Math.atan2(s.flat.x, s.flat.z) + (hashString(`${seed}:turn${i}`) - 0.5) * 0.8);
  const m = new THREE.Matrix4();
  const update = t => {
    spots.forEach((s, i) => {
      m.copy(place(s.p[0], s.p[1] + 0.03 * Math.sin(t * 0.8 + phases[i]), s.p[2], { ry: turns[i] }));
      puffs.setMatrixAt(i, m);
    });
    puffs.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.dynamic.push(update);
}

function flowerarch(ctx, track, { bridge, model, seed }) {
  const L = track.length;
  const plank = new THREE.BoxGeometry(0.56, 0.04, 0.13);
  const count = Math.max(2, Math.min(64, Math.round(L / 0.17)));
  const depth = Math.max(0.13, L / count - 0.04);
  plank.scale(1, 1, depth / 0.13);
  for (let i = 0; i < count; i++) {
    const s = sampleAt(track, (i + 0.5) / count * L);
    const jr = (hashString(`${bridge.id}:r${i}`) - 0.5) * 0.06;
    ctx.batch.add(plank, 'matte', { color: i % 2 ? P.plank : '#f6d6a2', matrix: frameOf(s).multiply(place(0, -0.025, 0, { ry: jr })) });
  }
  plank.dispose();
  // Side boards under the plank ends.
  const mesh = new PieceMesh();
  const boards = spread(0, L, 0.25, 34).map(d => sampleAt(track, d));
  for (const k of [-1, 1]) for (const hint of [-1, 1]) strip(mesh, boards, [k * 0.29, -0.08], [k * 0.29, -0.01], P.post, s => sideHint(s, hint));
  putMesh(ctx, mesh);
  const kinds = [islandOf(model, bridge.from?.island)?.kind, islandOf(model, bridge.to?.island)?.kind];
  const coloursAt = s => FLOWER_COLOURS[kinds[s.u < 0.5 ? 0 : 1]] ?? FLOWER_COLOURS.home;
  // Flowered rails along both sides (what reads from the side): white posts, a white rail, and leaves
  // and flowers heaped along it.
  const railY = 0.2, railA = 0.27;
  const railPost = new THREE.BoxGeometry(0.035, railY, 0.035).translate(0, railY / 2, 0);
  for (const k of [-1, 1]) {
    for (const d of spread(0.12, L - 0.12, 0.55, 10)) {
      const s = sampleAt(track, d);
      const [x, y, z] = beside(s, k * railA, 0);
      ctx.batch.add(railPost, 'matte', { color: P.trim, matrix: place(x, y, z) });
    }
    put(ctx, tube(spread(0.12, L - 0.12, 0.25, 30).map(d => beside(sampleAt(track, d), k * railA, railY)), 0.018, 4), 'matte', P.trim);
    spread(0.2, L - 0.2, 0.2, 20).forEach((d, i) => {
      const s = sampleAt(track, d);
      const h = hashString(`${seed}:rail${k}:${i}`);
      const [x, y, z] = beside(s, k * (railA + (h - 0.5) * 0.04), railY + 0.02);
      const turn = Math.atan2(s.flat.x, s.flat.z) + h * 3;
      put(ctx, chunk(0.055 + h * 0.02, seed + i * 3 + (k > 0 ? 1 : 0), [1.3, 0.75, 1], 0, 0.12), 'facet', P.leaf[(i + (k > 0 ? 1 : 0)) % 3], place(x, y, z, { ry: turn }));
      if (i % 2 === 0) {
        const colours = coloursAt(s);
        put(ctx, new THREE.IcosahedronGeometry(0.038, 0), 'facet', colours[(i / 2 + (k > 0 ? 1 : 0)) % colours.length], place(x + s.side.x * k * 0.015, y + 0.045, z + s.side.z * k * 0.015, { ry: turn }));
      }
    });
  }
  railPost.dispose();
  // Arches over the path (what reads end-on): one at each end and one in the middle of a long bridge,
  // each a thick white half ring on posts, wound with leaves and flowers.
  const hoops = L > 1.4 ? [0.3, ...(L > 2.6 && L <= 8 ? [L / 2] : []), L - 0.3] : [L / 2];
  const r = 0.3, postH = 0.26;
  const post = new THREE.BoxGeometry(0.05, postH, 0.05).translate(0, postH / 2, 0);
  const ring = new THREE.TorusGeometry(r, 0.034, 5, 12, Math.PI);
  hoops.forEach((d, j) => {
    const s = sampleAt(track, d), frame = frameOf(s, false);
    const colours = coloursAt(s);
    for (const k of [-1, 1]) ctx.batch.add(post, 'matte', { color: P.trim, matrix: frame.clone().multiply(place(k * r, 0, 0)) });
    ctx.batch.add(ring, 'matte', { color: P.trim, matrix: frame.clone().multiply(place(0, postH, 0)) });
    for (let i = 0; i < 7; i++) {
      const a = (i + 0.5) / 7 * Math.PI + (hashString(`${seed}:${j}:${i}`) - 0.5) * 0.25;
      const leaf = chunk(0.075, seed + j * 7 + i, [1.25, 0.8, 1], 0, 0.12);
      put(ctx, leaf, 'facet', P.leaf[(i + j) % 3], frame.clone().multiply(place(Math.cos(a) * r, postH + Math.sin(a) * r, 0, { ry: a })));
    }
    for (const k of [-1, 1]) for (const h of [0.35, 0.75]) {
      const leaf = chunk(0.06, seed + j * 5 + k + h * 10, [0.9, 1.3, 0.9], 0, 0.12);
      put(ctx, leaf, 'facet', P.leaf[(j + (k > 0 ? 1 : 2)) % 3], frame.clone().multiply(place(k * r, postH * h, 0)));
    }
    for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) / 6 * Math.PI;
      put(ctx, new THREE.IcosahedronGeometry(0.048, 0), 'facet', colours[(i + j) % colours.length], frame.clone().multiply(place(Math.cos(a) * (r + 0.035), postH + Math.sin(a) * (r + 0.035), 0.035 * (i % 2 ? 1 : -1))));
    }
  });
  post.dispose(); ring.dispose();
}

const RAINBOW_GLOW = { focus: 0, break: 0.32, away: 0.22, done: 0.4 };

function rainbow(ctx, track, { seed }) {
  const L = track.length;
  const half = 0.25, thick = 0.035, n = RAINBOW.length;
  const samples = spread(0, L, 0.1, 100).map(d => {
    const s = sampleAt(track, d);
    return { ...s, p: [s.p[0], s.p[1] + RAINBOW_ARC * Math.sin(Math.PI * s.u), s.p[2]] };
  });
  const mesh = new PieceMesh(), glow = new PieceMesh();
  for (let b = 0; b < n; b++) {
    const a0 = -half + 2 * half * b / n, a1 = -half + 2 * half * (b + 1) / n;
    strip(mesh, samples, [a0, 0], [a1, 0], RAINBOW[b], [0, 1, 0]);
    strip(glow, samples, [a0, 0.002], [a1, 0.002], RAINBOW[b], [0, 1, 0]);
  }
  strip(mesh, samples, [-half, -thick], [half, -thick], '#f4ecff', [0, -1, 0]);
  strip(mesh, samples, [-half, 0], [-half, -thick], RAINBOW[0], s => sideHint(s, -1));
  strip(mesh, samples, [half, 0], [half, -thick], RAINBOW[n - 1], s => sideHint(s, 1));
  putMesh(ctx, mesh);
  // A soft glow at dusk: the same stripes again, added on top.
  const geometry = glow.geometry();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const shine = new THREE.Mesh(geometry, material);
  shine.name = 'rainbow-glow';
  shine.visible = false;
  shine.renderOrder = 2;
  ctx.root.add(shine);
  ctx.track(geometry, material);
  ctx.onMood(name => {
    material.opacity = RAINBOW_GLOW[name] ?? 0;
    shine.visible = material.opacity > 0;
  });
  // Soft clouds where it meets each island, so the rainbow rises out of a cloud: a big puff on the
  // stripes and a smaller one beside it.
  if (L > 2 * EDGE + 0.3) {
    for (const [d, i] of [[EDGE + 0.04, 0], [L - EDGE - 0.04, 1]]) {
      const s = sampleAt(track, d);
      const y = s.p[1] + RAINBOW_ARC * Math.sin(Math.PI * s.u) - 0.03, turn = Math.atan2(s.flat.x, s.flat.z);
      put(ctx, puffGeometry(seed + 11 + i, 1.5), 'matte', null, place(s.p[0], y, s.p[2], { ry: turn + i }));
      const k = i ? -1 : 1;
      put(ctx, puffGeometry(seed + 21 + i, 1.0), 'matte', null, place(s.p[0] + s.side.x * 0.24 * k + s.flat.x * 0.08 * k, y - 0.03, s.p[2] + s.side.z * 0.24 * k + s.flat.z * 0.08 * k, { ry: turn - i }));
    }
  }
}

// ---------- How helpers cross ----------

// legs: [{ move: 'walk' | 'hop' | 'slide' | 'climb', points: [[x, y, z], ...] }
//        | { move: 'sitdown' | 'splash' | 'standup', at: [x, y, z], yaw }]
// forward runs from the `from` foot to the `to` foot, back the other way. cost: what the walk pays.
export function bridgeWays(bridge, model) {
  const path = deckPath(bridge, model);
  const track = makeTrack(path);
  const L = track.length;
  const type = typeOf(bridge);
  const line = (lift = () => 0, every = 0.2) => spread(0, L, every).map(d => {
    const s = sampleAt(track, d);
    return [round4(s.p[0]), round4(s.p[1] + lift(s.u)), round4(s.p[2])];
  });
  const reversed = legs => legs.slice().reverse().map(leg => (leg.points ? { ...leg, points: leg.points.slice().reverse() } : leg));
  const ends = [path[0], path[path.length - 1]];
  let forward, back, costs = [L, L];
  if (type === 'cloudsteps') {
    const hops = [ends[0], ...cloudSpots(track).map(d => pointAt(track, d).map(round4)), ends[1]];
    forward = [{ move: 'hop', points: hops }];
    back = reversed(forward);
  } else if (type === 'slide') {
    const down = downhillTrack(track);
    const flipped = down !== track;
    const top = down.points[0], bottom = down.points[down.points.length - 1];
    const poolAt = down.length - POOL.back;
    const wy = CHUTE.axis - CHUTE.inner + CHUTE.water;
    const chute = spread(CHUTE.start + 0.02, poolAt, 0.2).map(d => { const p = pointAt(down, d); return [round4(p[0]), round4(p[1] + wy), round4(p[2])]; });
    const pool = pointAt(down, poolAt).map(round4);
    pool[1] = round4(pool[1] + 0.03);
    const start = sampleAt(down, CHUTE.start + 0.02);
    const yaw = Math.atan2(start.flat.x, start.flat.z);
    const k = stairSide(down);
    const stairEnd = poolAt - POOL.radius - 0.1;
    const stair = spread(STAIR.start, stairEnd, 0.2).map(d => beside(sampleAt(down, d), k * STAIR.side, 0).map(round4)).reverse();
    const downLegs = [
      { move: 'walk', points: [top, chute[0]] },
      { move: 'sitdown', at: chute[0], yaw },
      { move: 'slide', points: [...chute, pool] },
      { move: 'splash', at: pool, yaw },
      { move: 'standup', at: pool, yaw },
      { move: 'walk', points: [pool, bottom] },
    ];
    const upLegs = [{ move: 'climb', points: [bottom, ...stair, top] }];
    forward = flipped ? upLegs : downLegs;
    back = flipped ? downLegs : upLegs;
    costs = flipped ? [1.5 * L, 0.5 * L] : [0.5 * L, 1.5 * L];
  } else {
    const lift = type === 'arch' ? u => HUMP * Math.sin(Math.PI * u) : type === 'rainbow' ? u => RAINBOW_ARC * Math.sin(Math.PI * u) : () => 0;
    forward = [{ move: 'walk', points: line(lift) }];
    back = reversed(forward);
  }
  return { id: bridge.id, type, length: L, forward: { legs: forward, cost: costs[0] }, back: { legs: back, cost: costs[1] } };
}

export { MAX_TRIANGLES };
