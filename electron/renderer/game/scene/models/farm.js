// One reserved parcel (six points, two cells): a low hen coop beside a fenced straw yard. The extension
// (thing.extension) swaps the coop for a little barn in the same parcel and adds one sheep to the yard.
// The animals are scenery: no care, harvesting or production.
//
// The model's own frame: x runs along the parcel's long side (the layout turns the farm that way, see
// farmYaw in town/pads.js). The plot itself is the straw yard: scene/town/pads.js draws it in straw
// instead of stone and gives the model its outline (thing.plot). The building stands at the end farther
// from the camera, so it never hides its yard: the model turns its own frame half round when that end is
// +x (see farmyard), and then draws as usual, with the building at -x. The building is as large as the
// plot allows at that end (on a plot running toward the camera it shrinks rather than slide in toward the
// camera, see BEHIND), centred across it with its door toward the yard, and it keeps the same straw
// margin as the fence. A white fence runs a little inside the plot's edge round the yard, with a gate
// where the way to the front lane crosses it, or beside the building when the front lane lies behind it.
// farm.test.js checks that every part stays on real plots and that the building is on the far side.
//
// Motion is calm (yardMoment): the animals take turns, so at most one moves at a time and each is still
// more than 80% of its loop. The yard plays that loop only on its own turns (calm.js), which also keeps
// it still while the cat or the bird has a turn, at time 0 (the scene holds t at 0 under reduced
// motion), in the done and away moods, and while a moving visitor is anywhere in the world (read from
// ctx.model, the current world, not the one the island was built with). A turn cut short eases back to
// rest over a couple of seconds.
import * as THREE from 'three';
import { P } from '../style.js';
import { place, Batch } from '../ground.js';
import { rbox, lump } from '../parts.js';
import { addRoof } from './buildings.js';
import { LOOP, createTurn } from '../calm.js';

// The roof is a warm moss green, well apart from the island's teal; the bale is a deeper gold than the straw.
const F = {
  straw: P.straw, strawDeep: P.strawDeep, tuft: '#7fcf5a', red: '#d94a3c', redDeep: '#b83a30', roof: '#8c9a45', roofLight: '#a8b563',
  hay: '#e8bb4c', twine: '#c99a3f', dark: '#5a3b2e', hen: '#fff6df', henTail: '#f2e2c2', brown: '#c8743a',
  brownDeep: '#94502a', comb: '#e8392c', beak: '#f2a93b', eye: '#3e3840', wool: '#f7f2e8', face: '#3d3540',
};
const HEN = 1.3; // hens' size: well under a helper's height, big enough to read at Today's size
const box = (ctx, base, size, at, color, r = 0.008) => ctx.add(rbox(...size, r, 1), 'matte', color, place(...at), base);

// ---------- Calm motion ----------
export const CYCLE = LOOP; // seconds: one turn (calm.js)
// Turns in one cycle: [start, seconds, animal, action]. Animals 0 and 1 are the hens, 2 the sheep (barn
// only). Each hen pecks every 15 to 18 seconds and shuffles a step out and, half a minute later, back.
// 'out' and 'back' are that small shuffle away from and back to the hen's resting spot.
export const YARD_TURNS = [
  [0.2, 1.6, 0, 'peck'], [2.2, 1.6, 1, 'peck'], [4.4, 3.5, 2, 'lift'], [8.3, 2, 0, 'out'], [10.7, 2, 1, 'out'],
  [15.2, 1.6, 0, 'peck'], [17.2, 1.6, 1, 'peck'], [31.2, 1.6, 0, 'peck'], [33.2, 1.6, 1, 'peck'],
  [35.4, 3.5, 2, 'lift'], [39.3, 2, 0, 'back'], [41.7, 2, 1, 'back'], [46.6, 1.6, 0, 'peck'], [48.6, 1.6, 1, 'peck'],
];
const ease = u => u * u * (3 - 2 * u);
const clamp01 = u => Math.min(1, Math.max(0, u));

// Each animal's pose at a time: { peck, lift, away, step } from 0 to 1. peck: head down to the ground;
// lift: the grazing sheep's head up; away: how far the hen has shuffled; step: its little hops.
export function yardMoment(time) {
  const t = ((((Number.isFinite(time) ? time : 0) % CYCLE) + CYCLE) % CYCLE);
  const poses = [0, 1, 2].map(() => ({ peck: 0, lift: 0, away: 0, step: 0 }));
  for (const [start, seconds, animal, action] of YARD_TURNS) {
    const u = clamp01((t - start) / seconds), pose = poses[animal];
    if (action === 'out') pose.away = Math.max(pose.away, ease(u));
    if (action === 'back' && t >= start) pose.away = 1 - ease(u);
    if (t < start || t >= start + seconds) continue;
    if (action === 'peck') pose.peck = ease(clamp01(u / 0.25)) * (1 - ease(clamp01((u - 0.75) / 0.25))) * (1 - 0.18 * Math.sin(Math.PI * clamp01((u - 0.3) / 0.4)) ** 2);
    if (action === 'lift') pose.lift = ease(clamp01(u / 0.3)) * (1 - ease(clamp01((u - 0.7) / 0.3)));
    if (action === 'out' || action === 'back') pose.step = Math.abs(Math.sin(u * Math.PI * 3));
  }
  return poses;
}

// ---------- The plot ----------
// Widths in the plot's piece units (scene/town/pads.js padOutline): the straw plot itself, and the fence
// line a little inside its edge. The building's roof stays inside the fence line too, so the straw margin
// is the same all round.
const PLOT_T = { pad: 0.74, fence: 0.6 };
const GATE = 0.1; // half the gate's opening, in the model's units
// The largest building scale on the island (model scale times the pad's scale), so a big plot does not
// grow a towering building.
const TALLEST = 1.2;
// Each building's half size at scale 1 (roof edges included) and its door side's x, in its own frame.
const SHAPES = { coop: { hx: 0.3, hz: 0.27, front: 0.22, wall: 0.21 }, barn: { hx: 0.31, hz: 0.34, front: 0.26, wall: 0.27 } };
// On a plot that runs toward the camera, how far the building's middle stays behind the plot's middle (in
// model units, for each unit the plot runs toward the camera), so it clearly stands at the far end. The
// grid is uneven, so a plot's far end is often narrower or slanted; there the biggest building fits only
// by sliding in toward the middle, which is also toward the camera. It shrinks instead.
const BEHIND = 0.25;

// The plot in the model's frame: edges(t) => [[[x, z], [x, z]]], inside(x, z, t), front [x, z] or null.
// On Today it is the real plot (thing.plot, island units). Elsewhere (the gallery's close-up, tests
// with a bare thing) it is a plain rounded box, and the model draws its straw itself.
function localPlot(ctx, thing, base) {
  if (thing.plot) {
    const inv = base.clone().invert(), v = new THREE.Vector3();
    const toLocal = ([x, z]) => { v.set(x, 0, z).applyMatrix4(inv); return [v.x, v.z]; };
    const toIsland = (x, z) => { v.set(x, 0, z).applyMatrix4(base); return [v.x, v.z]; };
    return {
      edges: t => thing.plot.edges(t).map(([p, q]) => [toLocal(p), toLocal(q)]),
      inside: (x, z, t) => thing.plot.inside(toIsland(x, z), t),
      front: thing.plot.front ? toLocal(thing.plot.front) : null,
    };
  }
  const half = t => [0.86 - (PLOT_T.pad - t) * 0.4, 0.5 - (PLOT_T.pad - t) * 0.4];
  ctx.add(roundedSlab(...half(PLOT_T.pad), 0.1, 0.03), 'matte', F.straw, place(0, -0.03, 0), base, false);
  return {
    edges: t => { const [x, z] = half(t), c = [[-x, -z], [x, -z], [x, z], [-x, z]]; return c.map((p, i) => [p, c[(i + 1) % 4]]); },
    inside: (x, z, t) => { const [hx, hz] = half(t); return Math.abs(x) <= hx && Math.abs(z) <= hz; },
    front: null,
  };
}

// How far the plot reaches from (x, z) along [dx, dz] at width t, in steps of 0.01.
function reach(plot, x, z, [dx, dz], t) {
  let d = 0;
  while (d < 3 && plot.inside(x + dx * (d + 0.01), z + dz * (d + 0.01), t)) d += 0.01;
  return d;
}

// The building's scale and middle [cx, cz]: as large as fits inside the fence line at the plot's back (-x)
// end, centred across the plot there, leaving the yard at least half the plot's length. Scales run from
// `most` (roomy plots) down to 0.7. It may slide in a little from the back to fit. cam is the camera's
// way in the model's frame: on a plot that runs toward it (x above 0.25, as for the turn in farmyard), a
// spot nearer the camera than BEHIND allows is skipped, so a smaller building at the far end wins. A plot
// with no such spot keeps the plain fit.
function fitBuilding(plot, shape, back, end, most, cam) {
  const yard = Math.max(0.6, (end - back) / 2);
  const search = least => {
    for (let k = most; k >= 0.7; k -= 0.05) {
      const hx = shape.hx * k, hz = shape.hz * k;
      for (let cx = back + hx; cx <= back + hx + 0.3; cx += 0.01) {
        if (end - (cx + shape.front * k) < yard) break;
        const cz = midline(plot, cx);
        if (-(cam[0] * cx + cam[1] * cz) < least) continue;
        let fits = true;
        for (let i = 0; i <= 12 && fits; i++) for (let j = 0; j <= 8 && fits; j++) fits = plot.inside(cx - hx + (i / 6) * hx, cz - hz + (j / 4) * hz, PLOT_T.fence);
        if (fits) return { k, cx, cz };
      }
    }
    return null;
  };
  const cx = back + shape.hx * 0.7;
  return (cam[0] > 0.25 && search(BEHIND * cam[0])) || search(-Infinity) || { k: 0.7, cx, cz: midline(plot, cx) };
}

// The z halfway between the fence's two long sides at x: the yard's middle line there.
function midline(plot, x) {
  return (reach(plot, x, 0, [0, 1], PLOT_T.fence) - reach(plot, x, 0, [0, -1], PLOT_T.fence)) / 2;
}

// Cuts away the parts of segments within r of point c (the gate), and the parts with x below x0.
function clipSegments(segments, x0, c, r) {
  const out = [];
  for (const [p, q] of segments) {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    let ranges = [[0, 1]];
    // x >= x0
    if (Math.abs(dx) > 1e-9) {
      const u = (x0 - p[0]) / dx;
      ranges = dx > 0 ? [[Math.max(0, u), 1]] : [[0, Math.min(1, u)]];
    } else if (p[0] < x0) ranges = [];
    // outside the gate's circle
    if (c) {
      const fx = p[0] - c[0], fz = p[1] - c[1], A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - r * r;
      const disc = B * B - 4 * A * C;
      if (A > 1e-12 && disc > 0) {
        const u0 = (-B - Math.sqrt(disc)) / (2 * A), u1 = (-B + Math.sqrt(disc)) / (2 * A);
        ranges = ranges.flatMap(([a, b]) => [[a, Math.min(b, u0)], [Math.max(a, u1), b]]);
      }
    }
    for (const [a, b] of ranges) if (b - a > 1e-3) out.push([[p[0] + dx * a, p[1] + dz * a], [p[0] + dx * b, p[1] + dz * b]]);
  }
  return out;
}

// Joins segments that meet end to end in nearly the same direction, so a straight fence has one rail.
function joinSegments(segments) {
  const list = segments.map(([p, q]) => [p, q]);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4;
  const way = ([p, q]) => Math.atan2(q[1] - p[1], q[0] - p[0]);
  for (let joined = true; joined;) {
    joined = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const [a, b] = [list[i], list[j]];
        let turn = null;
        if (near(a[1], b[0])) turn = [a[0], b[1]];
        else if (near(a[1], b[1])) turn = [a[0], b[0]];
        if (!turn) continue;
        const wa = way(a), wb = way(near(a[1], b[0]) ? b : [b[1], b[0]]);
        if (Math.abs(Math.atan2(Math.sin(wa - wb), Math.cos(wa - wb))) > 0.12) continue;
        list[i] = turn; list.splice(j, 1); joined = true;
        break outer;
      }
    }
  }
  return list;
}

// Where the ray from `from` along `way` first crosses the fence ring, or null.
function gateOn(ring, from, way) {
  let best = null, bestU = Infinity;
  for (const [p, q] of ring) {
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const d = way[0] * ez - way[1] * ex;
    if (Math.abs(d) < 1e-12) continue;
    const wx = p[0] - from[0], wz = p[1] - from[1];
    const u = (wx * ez - wz * ex) / d, v = (wx * way[1] - wz * way[0]) / d;
    if (u > 0 && v >= 0 && v <= 1 && u < bestU) { bestU = u; best = [from[0] + way[0] * u, from[1] + way[1] * u]; }
  }
  return best;
}

// The way along the fence ring at point c: the unit direction of the ring side nearest to it.
function fenceWay(ring, c) {
  let best = [1, 0], bestD = Infinity;
  for (const [p, q] of ring) {
    const ex = q[0] - p[0], ez = q[1] - p[1], l2 = ex * ex + ez * ez;
    if (l2 < 1e-9) continue;
    const u = Math.min(1, Math.max(0, ((c[0] - p[0]) * ex + (c[1] - p[1]) * ez) / l2));
    const d = Math.hypot(p[0] + ex * u - c[0], p[1] + ez * u - c[1]);
    if (d < bestD) { bestD = d; const l = Math.sqrt(l2); best = [ex / l, ez / l]; }
  }
  return best;
}

// ---------- Model ----------
export function farmyard(ctx, thing, placed) {
  const barn = Boolean(thing.extension);
  // The camera looks from world south, which is x = -sin(yaw), z = cos(yaw) in the model's frame. When
  // the camera is clearly toward -x, the building (always drawn at -x) would stand in front of its yard,
  // so the frame turns half round: then -x is the end away from the camera. A plot running about east
  // and west keeps its building at the end away from the front lane. Everything below uses the turned
  // frame (base, yaw). Hens and the hay bale go on the camera's half of the yard, the trough and the
  // sheep on the far half.
  const given = Number.isFinite(thing.yaw) ? thing.yaw : 0;
  const turned = Math.sin(given) > 0.25;
  const yaw = turned ? given + Math.PI : given;
  const base = turned ? placed.clone().multiply(place(0, 0, 0, { ry: Math.PI })) : placed;
  const cz = Math.cos(yaw) >= -0.2 ? 1 : -1;
  const camYaw = Math.atan2(-Math.sin(yaw), Math.cos(yaw));
  const plot = localPlot(ctx, thing, base);
  const back = -reach(plot, 0, 0, [-1, 0], PLOT_T.fence), end = reach(plot, 0, 0, [1, 0], PLOT_T.fence);

  // The building, as large as the plot allows, at the end away from the front lane.
  const shape = barn ? SHAPES.barn : SHAPES.coop;
  const most = Math.max(0.7, Math.min(1.3, TALLEST / new THREE.Vector3().setFromMatrixScale(base).y));
  const { k, cx, cz: bz } = fitBuilding(plot, shape, back, end, most, [-Math.sin(yaw), Math.cos(yaw)]);
  (barn ? buildBarn : buildCoop)(ctx, base, cx, bz, k);
  const front = cx + shape.front * k, x0 = front + 0.03, L = end - x0;
  // The yard's middle line at x, and how far the fence is from it, on the camera's side (s = 1) or the
  // far one. Things in the yard stand at mid(x) + s * cz * (a distance less than side(x, s)).
  const mid = x => midline(plot, x);
  const side = (x, s) => reach(plot, x, mid(x), [0, s * cz], PLOT_T.fence);
  // The same, kept for a piece reaching `half` either way along x (the plot may narrow at a corner).
  const sideAround = (x, s, half) => Math.min(side(x - half, s), side(x, s), side(x + half, s));

  // Two soft, darker patches of trodden straw, and a few grass tufts.
  for (const [u, z, w, d, ry] of [[0.6, -0.12, 0.13, 0.08, 0.5], [0.3, 0.16, 0.09, 0.06, -0.4]]) {
    ctx.add(new THREE.CylinderGeometry(1, 1, 0.006, 14).scale(w, 1, d), 'matte', F.strawDeep, place(x0 + u * L, 0.003, mid(x0 + u * L) + z * cz, { ry }), base, false);
  }
  for (const [u, s, size] of [[0.88, 1, 1], [0.18, -1, 0.8], [0.62, 1, 0.7]]) {
    const x = x0 + u * L, z = mid(x) + s * cz * Math.max(0, side(x, s) - 0.06);
    for (const [dx, dz, h] of [[0, 0, 0.07], [0.025, 0.012, 0.05], [-0.02, 0.015, 0.045]]) {
      ctx.add(new THREE.ConeGeometry(0.014 * size, h * size, 4), 'matte', F.tuft, place(x + dx, h * size / 2, z + dz * s * cz), base, false);
    }
  }

  // White post-and-rail fence a little inside the plot's edge, from the building round the yard, with
  // a gate where the way to the front lane crosses it.
  const ring = plot.edges(PLOT_T.fence);
  const middle = [(x0 + end) / 2, bz];
  const toward = plot.front ? [plot.front[0] - middle[0], plot.front[1] - middle[1]] : [1, 0];
  let gate = gateOn(ring, middle, toward);
  if (gate && gate[0] < x0 + GATE + 0.04) {
    // The front lane lies behind the building: the gate goes in a long side, just past the building's
    // front, on the side nearer the lane (the camera's side when both are about as near).
    const x = x0 + GATE + 0.04;
    const [near, far] = [cz, -cz].map(s => [x, s * reach(plot, x, 0, [0, s], PLOT_T.fence)]);
    const gap = p => (plot.front ? Math.hypot(p[0] - plot.front[0], p[1] - plot.front[1]) : 0);
    gate = gap(far) < gap(near) - 0.1 ? far : near;
  }
  const rails = joinSegments(clipSegments(ring, x0, gate, GATE));
  const posts = [];
  const post = (x, z) => {
    if (posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.06)) return;
    posts.push([x, z]);
    box(ctx, base, [0.036, 0.2, 0.036], [x, 0.1, z], P.trim, 0.006);
  };
  if (gate) {
    // The gate: two taller, thicker posts with caps, so it reads from far away, and one leaf standing
    // open into the yard from the post nearer the building.
    const way = fenceWay(ring, gate);
    // Into the yard: square to the fence, toward the yard's middle.
    let inward = [-way[1], way[0]];
    if (inward[0] * (middle[0] - gate[0]) + inward[1] * (middle[1] - gate[1]) < 0) inward = [-inward[0], -inward[1]];
    // Each post steps a little into the yard where the plot's edge comes close (at a cut corner), so
    // its wider cap stays on the straw.
    const CAP = 0.034;
    const onStraw = (x, z) => [[-1, -1], [-1, 1], [1, -1], [1, 1]].every(([i, j]) => plot.inside(x + i * CAP, z + j * CAP, PLOT_T.pad - 0.02));
    const ends = [-1, 1].map(s => {
      let x = gate[0] + way[0] * GATE * s, z = gate[1] + way[1] * GATE * s;
      for (let n = 0; n < 6 && !onStraw(x, z); n++) { x += inward[0] * 0.01; z += inward[1] * 0.01; }
      return [x, z];
    }).sort((a, b) => a[0] - b[0]);
    for (const [x, z] of ends) {
      posts.push([x, z]);
      box(ctx, base, [0.052, 0.27, 0.052], [x, 0.135, z], P.trim, 0.008);
      box(ctx, base, [2 * CAP, 0.026, 2 * CAP], [x, 0.275, z], P.trim, 0.008);
    }
    const [hinge, latch] = ends;
    const along = [latch[0] - hinge[0], latch[1] - hinge[1]].map(v => v / (2 * GATE));
    // Swung 65 degrees open, and a little short of the opening so it clears the far post.
    const open = 65 * Math.PI / 180, length = 2 * GATE - 0.04;
    const dir = [along[0] * Math.cos(open) + inward[0] * Math.sin(open), along[1] * Math.cos(open) + inward[1] * Math.sin(open)];
    const leaf = base.clone().multiply(place(hinge[0] + dir[0] * (0.03 + length / 2), 0, hinge[1] + dir[1] * (0.03 + length / 2), { ry: Math.atan2(-dir[1], dir[0]) }));
    for (const y of [0.07, 0.17]) box(ctx, leaf, [length, 0.024, 0.02], [0, y, 0], P.trim, 0.005);
    box(ctx, leaf, [0.022, 0.15, 0.02], [length / 2 - 0.012, 0.12, 0], P.trim, 0.005);
    ctx.add(new THREE.BoxGeometry(Math.hypot(length - 0.03, 0.1), 0.018, 0.016), 'matte', P.trim, place(0, 0.12, 0, { rz: Math.atan2(0.1, length - 0.03) }), leaf);
  }
  const rail = ([p, q]) => {
    const dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
    if (length < 0.02) return;
    for (const y of [0.07, 0.15]) {
      ctx.add(new THREE.BoxGeometry(length, 0.02, 0.022), 'matte', P.trim, place((p[0] + q[0]) / 2, y, (p[1] + q[1]) / 2, { ry: Math.atan2(-dz, dx) }), base);
    }
    post(...p); post(...q);
    for (let n = Math.floor(length / 0.26), i = 1; i < n; i++) post(p[0] + dx * i / n, p[1] + dz * i / n);
  };
  rails.forEach(rail);
  // Short rails from the fence to the building's front corners.
  for (const s of [-1, 1]) {
    const inner = bz + s * shape.wall * k, outer = s * reach(plot, x0, 0, [0, s], PLOT_T.fence);
    if (s * (outer - inner) > 0.03) rail([[x0, inner], [x0, outer]]);
  }

  // A hay bale by the building on the camera's side, or on the far side when a gate beside the building
  // is on the camera's side, and a water trough on the far side.
  const baleX = x0 + 0.12, baleSide = gate && Math.abs(gate[0] - baleX) < 0.3 && (gate[1] - mid(gate[0])) * cz > 0 ? -1 : 1;
  const bale = base.clone().multiply(place(baleX, 0, mid(baleX) + baleSide * cz * Math.min(0.3, sideAround(baleX, baleSide, 0.1) - 0.08), { ry: 0.25 * cz }));
  box(ctx, bale, [0.16, 0.095, 0.1], [0, 0.048, 0], F.hay, 0.016);
  for (const x of [-0.042, 0.042]) box(ctx, bale, [0.014, 0.099, 0.104], [x, 0.048, 0], F.twine, 0.004);
  const troughX = end - 0.16, troughZ = mid(troughX) - cz * Math.min(0.3, sideAround(troughX, -1, 0.08) - 0.08);
  box(ctx, base, [0.15, 0.065, 0.08], [troughX, 0.032, troughZ], P.plankDark);
  box(ctx, base, [0.115, 0.008, 0.052], [troughX, 0.065, troughZ], '#8fd8ff', 0.003);

  // Animals: their own small meshes, moved in place. No shadows on moving parts.
  const make = (parent, fill) => {
    const batch = new Batch();
    fill((g, color, matrix) => { batch.add(g, 'facet', { color, matrix }); g.dispose(); });
    for (const m of batch.build(ctx.materials, parent)) { m.castShadow = false; ctx.track(m.geometry); }
  };
  const spot = (x, z, ry, s) => {
    const m = base.clone().multiply(place(x, 0, z, { ry, s }));
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), k = new THREE.Vector3();
    m.decompose(p, q, k);
    return { p, q, k };
  };
  const animals = [];
  // Hens on the camera's half of the yard: [x, distance from the middle line, turn].
  const henSpots = [[x0 + 0.3 * L, Math.min(0.15, side(x0 + 0.3 * L, 1) - 0.1), camYaw + 1.3], [x0 + 0.62 * L, 0.07, camYaw - 1.4]];
  henSpots.forEach(([x, along, ry], index) => {
    const z = mid(x) + along * cz;
    const brown = index === 1;
    const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
    ctx.root.add(root); root.add(body); body.add(head);
    root.name = `farm-hen-${index}`;
    head.position.set(0, 0.095, 0.035);
    const rest = spot(x, z, ry, HEN);
    // The shuffle: a small step forward with a little turn, then back again later.
    const step = spot(x + 0.05 * Math.sin(ry), z + 0.05 * Math.cos(ry), ry + 0.5, HEN);
    const hop = spot(x, z, ry, HEN).p.clone().sub(rest.p).add(new THREE.Vector3(0, 0.012 * rest.k.y, 0));
    root.position.copy(rest.p); root.quaternion.copy(rest.q); root.scale.copy(rest.k);
    const [coat, tail, wing] = brown ? [F.brown, F.brownDeep, F.brownDeep] : [F.hen, F.henTail, '#efe3c8'];
    make(body, add => {
      add(new THREE.IcosahedronGeometry(0.062, 1).scale(0.8, 0.85, 1.15), coat, place(0, 0.065, 0));
      add(new THREE.ConeGeometry(0.042, 0.08, 4).rotateX(-0.55), tail, place(0, 0.105, -0.058));
      for (const side of [-1, 1]) {
        add(new THREE.IcosahedronGeometry(0.03, 0).scale(0.35, 0.75, 1.3), wing, place(side * 0.047, 0.07, -0.005));
        add(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 4), F.beak, place(side * 0.02, 0.015, 0.01));
      }
    });
    make(head, add => {
      add(new THREE.IcosahedronGeometry(0.032, 1), coat, place(0, 0, 0.012));
      add(new THREE.ConeGeometry(0.012, 0.035, 4).rotateX(Math.PI / 2), F.beak, place(0, -0.004, 0.05));
      add(new THREE.SphereGeometry(0.022, 6, 4).scale(0.45, 1, 1.3), F.comb, place(0, 0.036, 0.012));
      add(new THREE.SphereGeometry(0.01, 5, 3).scale(0.6, 1.2, 0.8), F.comb, place(0, -0.026, 0.04));
      for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.0045, 5, 3), F.eye, place(side * 0.019, 0.006, 0.031));
    });
    animals.push({ index, root, body, head, rest, step, hop });
  });
  if (barn) {
    // One sheep on the far half of the yard, mostly grazing, side-on to the camera.
    const root = new THREE.Group(), head = new THREE.Group();
    ctx.root.add(root); root.add(head);
    root.name = 'farm-sheep';
    head.position.set(0, 0.165, 0.11);
    const rest = spot(x0 + 0.36 * L, mid(x0 + 0.36 * L) - cz * Math.min(0.12, side(x0 + 0.36 * L, -1) - 0.1), camYaw + Math.PI / 2 + 0.25, 0.9);
    root.position.copy(rest.p); root.quaternion.copy(rest.q); root.scale.copy(rest.k);
    make(root, add => {
      add(lump(0.1, 1, 0.1, 3, [0.95, 0.78, 1.3]), F.wool, place(0, 0.16, 0));
      add(lump(0.06, 1, 0.12, 5, [1, 0.8, 1]), F.wool, place(0, 0.225, 0.05));
      add(lump(0.055, 1, 0.12, 9, [1, 0.8, 1]), F.wool, place(0, 0.22, -0.06));
      for (const [x, z] of [[-0.045, 0.07], [0.045, 0.07], [-0.045, -0.07], [0.045, -0.07]]) {
        add(new THREE.CylinderGeometry(0.014, 0.012, 0.1, 5), F.face, place(x, 0.05, z));
      }
    });
    make(head, add => {
      add(new THREE.IcosahedronGeometry(0.045, 1).scale(0.85, 0.95, 1.35), F.face, place(0, -0.02, 0.07));
      add(new THREE.IcosahedronGeometry(0.03, 0).scale(1.1, 0.7, 1), F.wool, place(0, 0.02, 0.045));
      for (const side of [-1, 1]) add(new THREE.IcosahedronGeometry(0.02, 0).scale(1.4, 0.45, 0.7), F.face, place(side * 0.05, 0.005, 0.05, { rz: side * 0.4 }));
    });
    animals.push({ index: 2, root, head, sheep: true });
  }

  let mood = 'focus', last = yardMoment(0);
  ctx.onMood(name => { mood = name; });
  // ctx.model is the current world, so a visitor arriving or leaving on any island counts at once.
  const turn = createTurn('yard', ctx.island?.id ?? '', { model: () => ctx.model });
  const v = new THREE.Vector3();
  ctx.dynamic.push(time => {
    const local = turn.step(time, { mood });
    if (local !== null) last = yardMoment(local);
    const k = local !== null ? 1 : ease(turn.weight);
    const poses = k === 1 ? last : last.map(p => ({ peck: p.peck * k, lift: p.lift * k, away: p.away * k, step: p.step * k }));
    for (const a of animals) {
      const pose = poses[a.index];
      if (a.sheep) { a.head.rotation.x = 0.95 - 1.15 * pose.lift; continue; }
      a.body.rotation.x = 0.28 * pose.peck;
      a.head.rotation.x = 0.85 * pose.peck;
      v.copy(a.rest.p).lerp(a.step.p, pose.away).addScaledVector(a.hop, pose.step);
      a.root.position.copy(v);
      a.root.quaternion.slerpQuaternions(a.rest.q, a.step.q, pose.away);
    }
  });
}

// The low hen coop at the -x end: red walls with white corners, a roof running along x so its gable and
// little pop door face the yard, a ramp, and a window on each long side. [cx, cz]: its middle; k: its scale.
function buildCoop(ctx, base, cx, cz, k) {
  const coop = base.clone().multiply(place(cx, 0, cz, { s: k }));
  const w = 0.44, d = 0.4, h = 0.26;
  box(ctx, coop, [w, h, d], [0, h / 2, 0], F.red);
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box(ctx, coop, [0.04, h, 0.04], [x, h / 2, z], P.trim, 0.006);
  box(ctx, coop, [w + 0.02, 0.035, d + 0.02], [0, 0.018, 0], P.trim, 0.006);
  addRoof(ctx, coop.clone().multiply(place(0, 0, 0, { ry: Math.PI / 2 })), { w: d, d: w, top: h, roof: F.roof, wall: F.red, chimney: false, gableWindow: false, over: 0.03 });
  // Pop door and ramp on the yard side.
  box(ctx, coop, [0.02, 0.15, 0.14], [w / 2 + 0.006, 0.105, 0], P.trim, 0.005);
  box(ctx, coop, [0.022, 0.115, 0.095], [w / 2 + 0.01, 0.092, 0], F.dark, 0.004);
  ctx.add(rbox(0.17, 0.016, 0.09, 0.004, 1), 'matte', P.plank, place(w / 2 + 0.075, 0.04, 0, { rz: -0.42 }), coop);
  // A small window with a white frame on each long side, as the camera may see either one.
  for (const side of [-1, 1]) {
    box(ctx, coop, [0.12, 0.1, 0.02], [-0.03, 0.15, side * (d / 2 + 0.006)], P.trim, 0.004);
    box(ctx, coop, [0.078, 0.064, 0.022], [-0.03, 0.15, side * (d / 2 + 0.01)], '#fff0cd', 0.003);
  }
  ctx.blob(base, 0.6 * k, 0.56 * k, cx, cz);
}

// The little barn at the -x end: a two-step (gambrel) roof running along x, big double doors with white X
// braces toward the yard, a hayloft door above them, X-braced panels on both long sides (the camera may
// see either) and a small cupola on the ridge. [cx, cz]: its middle; k: its scale.
function buildBarn(ctx, base, cx, cz, k) {
  const barn = base.clone().multiply(place(cx, 0, cz, { s: k }));
  const w = 0.52, hd = 0.26, h = 0.37, over = 0.04, end = 0.03;
  box(ctx, barn, [w, h, hd * 2], [0, h / 2, 0], F.red);
  for (const x of [-w / 2, w / 2]) for (const z of [-hd, hd]) box(ctx, barn, [0.045, h, 0.045], [x, h / 2, z], P.trim, 0.006);
  box(ctx, barn, [w + 0.02, 0.035, hd * 2 + 0.02], [0, 0.018, 0], P.trim, 0.006);
  // The roof line in (z, y): eave E, knee K, ridge R. The lower slope is steep, the upper one shallow.
  const steep = 1.5, shallow = 0.5;
  const E = [hd + over, h - over * steep], K = [0.19, h + (hd - 0.19) * steep], R = [0, h + (hd - 0.19) * steep + 0.19 * shallow];
  const len = w + end * 2, T = 0.045;
  for (const side of [-1, 1]) {
    for (const [a, b] of [[K, E], [R, K]]) {
      const dz = b[0] - a[0], dy = a[1] - b[1], slope = Math.hypot(dz, dy), angle = Math.atan2(dy, dz);
      const mz = (a[0] + b[0]) / 2 + Math.sin(angle) * T / 2, my = (a[1] + b[1]) / 2 + Math.cos(angle) * T / 2;
      ctx.add(rbox(len, T, slope + 0.012, 0.008, 1), 'matte', F.roof, place(0, my, side * mz, { rx: side * angle }), barn);
      // A lighter shingle row along the middle of each slope, so the roof reads as two steps from above.
      const bz = (a[0] + b[0]) / 2 + Math.sin(angle) * T, by = (a[1] + b[1]) / 2 + Math.cos(angle) * T;
      ctx.add(rbox(len - 0.02, 0.012, 0.03, 0.004, 1), 'matte', F.roofLight, place(0, by, side * bz, { rx: side * angle }), barn, false);
    }
    // White trim along the eave and the knee, so both steps read from far away.
    box(ctx, barn, [len + 0.02, 0.036, 0.036], [0, E[1] + 0.005, side * (E[0] + 0.003)], P.trim, 0.006);
    box(ctx, barn, [len + 0.02, 0.03, 0.035], [0, K[1] + T * 0.9, side * K[0]], P.trim, 0.006);
  }
  box(ctx, barn, [len + 0.03, 0.04, 0.075], [0, R[1] + T, 0], P.trim, 0.008);
  // Gable ends: the five-sided wall under the roof, and white boards up each edge.
  const gable = new THREE.Shape([[-hd, h - 0.01], [hd, h - 0.01], [K[0], K[1]], [0, R[1]], [-K[0], K[1]]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const x of [-w / 2 + 0.012, w / 2 - 0.012]) {
    ctx.add(new THREE.ExtrudeGeometry(gable, { depth: 0.024, bevelEnabled: false }).translate(0, 0, -0.012).rotateY(Math.PI / 2), 'matte', F.red, place(x, 0, 0), barn, false);
  }
  // Big double doors toward the yard: white frame, two leaves, each with a white X.
  const fx = w / 2 + 0.01, dw = 0.12, dh = 0.24;
  box(ctx, barn, [0.02, dh + 0.04, dw * 2 + 0.06], [fx, dh / 2 + 0.02, 0], P.trim, 0.005);
  for (const side of [-1, 1]) {
    const z = side * (dw / 2 + 0.006);
    box(ctx, barn, [0.024, dh - 0.02, dw - 0.02], [fx + 0.004, dh / 2 + 0.03, z], F.redDeep, 0.004);
    xBrace(ctx, barn, [fx + 0.018, dh / 2 + 0.03, z], dw - 0.03, dh - 0.04, 'x');
  }
  // The hayloft door, with a tuft of hay showing under it.
  box(ctx, barn, [0.02, 0.11, 0.11], [fx, h + 0.075, 0], P.trim, 0.005);
  box(ctx, barn, [0.024, 0.08, 0.08], [fx + 0.002, h + 0.075, 0], F.dark, 0.004);
  box(ctx, barn, [0.03, 0.022, 0.066], [fx + 0.008, h + 0.045, 0], F.hay, 0.006);
  // X-braced panels on the long sides.
  for (const side of [-1, 1]) {
    const z = side * (hd + 0.01);
    box(ctx, barn, [0.26, 0.2, 0.02], [-0.03, 0.145, z], P.trim, 0.005);
    box(ctx, barn, [0.22, 0.16, 0.022], [-0.03, 0.145, z + side * 0.002], F.redDeep, 0.004);
    xBrace(ctx, barn, [-0.03, 0.145, z + side * 0.014], 0.2, 0.14, 'z');
  }
  // A small white cupola with a cap in the roof's colour and a thin vane on top.
  const top = R[1] + T;
  box(ctx, barn, [0.085, 0.07, 0.085], [0.04, top + 0.04, 0], P.trim, 0.008);
  box(ctx, barn, [0.05, 0.035, 0.089], [0.04, top + 0.045, 0], F.dark, 0.004);
  ctx.add(new THREE.ConeGeometry(0.078, 0.06, 4).rotateY(Math.PI / 4), 'matte', F.roof, place(0.04, top + 0.105, 0), barn, false);
  ctx.add(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 4), 'matte', F.dark, place(0.04, top + 0.17, 0), barn, false);
  ctx.add(new THREE.ConeGeometry(0.013, 0.06, 4).rotateZ(-Math.PI / 2), 'matte', F.dark, place(0.04, top + 0.19, 0), barn, false);
  ctx.blob(base, 0.72 * k, 0.66 * k, cx, cz);
}

// A white X across a rectangle (w wide, h high) on a wall facing x ('x') or z ('z').
function xBrace(ctx, base, [x, y, z], w, h, facing) {
  const length = Math.hypot(w, h), angle = Math.atan2(h, w);
  for (const s of [-1, 1]) {
    if (facing === 'x') ctx.add(rbox(0.012, 0.02, length, 0.004, 1), 'matte', P.trim, place(x, y, z, { rx: s * angle }), base, false);
    else ctx.add(rbox(length, 0.02, 0.012, 0.004, 1), 'matte', P.trim, place(x, y, z, { rz: s * angle }), base, false);
  }
}

// A flat slab with rounded corners (half sizes hx, hz, corner radius r, height h), its foot at y = 0.
function roundedSlab(hx, hz, r, h) {
  const shape = new THREE.Shape();
  // Round corners as true arcs, so the outline never pokes past the circle the pad check uses.
  shape.moveTo(-hx + r, -hz);
  shape.lineTo(hx - r, -hz); shape.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0);
  shape.lineTo(hx, hz - r); shape.absarc(hx - r, hz - r, r, 0, Math.PI / 2);
  shape.lineTo(-hx + r, hz); shape.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-hx, -hz + r); shape.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5);
  return new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 3 }).rotateX(Math.PI / 2).translate(0, h, 0);
}
