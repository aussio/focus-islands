// Visitors: what a surprise brings for a while (rules.js SURPRISE_FLAVOURS), drawn on its island until
// the next check-in. island.visitor is the kind (world.js), so the island redraws when one comes or goes.
// Each visitor is its own few meshes in ctx.root, never baked into the island's batch, so it leaves the
// island's pieces (and the stability check) alone.
//
//   buildVisitors(ctx, island)   draws island.visitor, if any; returns its group or null
//   VISITOR_KINDS                the kinds drawn here
//
// - raincloud: a small grey-white cloud with soft rain streaks under it, and shiny puddles on the paths.
// - tent: a small tent and campfire on a free spot at the edge, facing each other along the coast.
//   The fire follows the mood like a campfire (lit in break, embers at night, cold by day), with no light.
// - balloon: a striped hot-air balloon bobbing beside the island.
// - rainbow: a faint arc behind the island by day, fainter at dusk, hidden at night.
// - fireflies: a small cloud of firefly lights over the grass, in break and done moods only.
//
// On the busy island (model.view), the cloud, tent, balloon and fireflies gather near where Today's
// camera looks; elsewhere near the island's middle (the balloon: on the side away from its neighbours).
// The view is not in the island's draw key, but a visitor only comes at a check-in, which redraws the
// island with that check-in's view.
//
// Moving parts run from ctx.dynamic, and t = 0 is their resting pose (the scene holds t at 0 when
// still). Places come from hashString of the island's id, so the same island looks the same each time.
// Moving meshes cast no shadows (the shadow map is only redrawn on a change). Each visitor stays under
// 3,000 triangles.
import * as THREE from 'three';
import { Batch, place, hashString } from '../ground.js';
import { chunk, teardrop, logGeometry, rbox, blobTexture, glowTexture } from '../parts.js';
import { P, TOWN } from '../style.js';

export const VISITOR_KINDS = ['raincloud', 'tent', 'balloon', 'rainbow', 'fireflies'];

export function buildVisitors(ctx, island) {
  const draw = DRAW[island?.visitor];
  if (!draw) return null;
  const group = new THREE.Group();
  group.name = `visitor-${island.visitor}`;
  ctx.root.add(group);
  draw(ctx, island, group, ground(island, ctx.model));
  return group;
}

// ---------- Where things are on the island ----------

// The island's land in island units: its middle, its size, and which points are free grass. focus is
// where Today's camera looks when this is the busy island (the middle of model.view), else the middle;
// onView says which. The cloud, the fireflies, the tent and the balloon gather near it so they are seen.
function ground(island, model) {
  const at = p => island.grid.points[p];
  const feet = new Set(island.feet.map(f => f.point));
  const busy = p => !island.land.has(p) || island.lanes.has(p) || island.floors.has(p) || island.taken.has(p) || feet.has(p);
  const land = [...island.order];
  const xs = land.map(p => at(p)[0]), zs = land.map(p => at(p)[1]);
  const middle = land.length ? [xs.reduce((a, b) => a + b, 0) / land.length, zs.reduce((a, b) => a + b, 0) / land.length] : [0, 0];
  const box = land.length ? { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } : { x0: -1, x1: 1, z0: -1, z1: 1 };
  let top = 0;
  for (const floors of island.floors.values()) top = Math.max(top, floors * TOWN.storey + TOWN.roofRise);
  const ids = model?.view?.island === island.id ? (model.view.ids ?? []).filter(p => island.land.has(p)) : [];
  const focus = ids.length ? [ids.reduce((sum, p) => sum + at(p)[0], 0) / ids.length, ids.reduce((sum, p) => sum + at(p)[1], 0) / ids.length] : middle;
  return { at, busy, land, middle, box, top, focus, onView: ids.length > 0, free: land.filter(p => !busy(p)) };
}

const rank = (island, what, p) => hashString(`${island.id}:${what}:${p}`);
const byRank = (island, what) => (a, b) => rank(island, what, a) - rank(island, what, b);

// Bakes some static pieces into a few meshes under group. fill(add) calls add(geometry, mat, colour, matrix, ao).
function bake(ctx, group, fill, { shadow = true } = {}) {
  const batch = new Batch();
  fill((geometry, mat, color, matrix, ao = null) => {
    batch.add(geometry, mat, { color, matrix, ao });
    geometry.dispose();
  });
  const meshes = batch.build(ctx.materials, group);
  for (const mesh of meshes) {
    ctx.track(mesh.geometry);
    if (!shadow) mesh.castShadow = false;
  }
  return meshes;
}

// ---------- Rain cloud ----------

const RAIN = { streaks: 30, speed: 1.7, length: 0.16 };

function raincloud(ctx, island, group, g) {
  const size = Math.max(0.85, Math.min(1.5, island.reach * 0.3));
  const [cx, cz] = g.focus;
  const height = Math.max(1.55, g.top + 0.55);
  const seed = rank(island, 'cloud', 0) * 100;
  // The cloud: a row of soft puffs, flat underneath, pale on top and grey below.
  const puffs = [[0, 0, 0, 0.36], [-0.34, -0.04, 0.05, 0.27], [0.33, -0.05, -0.03, 0.28], [0.12, 0.13, 0.08, 0.26], [-0.16, 0.1, -0.1, 0.24], [0.56, -0.1, 0.06, 0.18], [-0.55, -0.1, -0.04, 0.17]];
  bake(ctx, group, add => {
    puffs.forEach(([x, y, z, r], i) => {
      const geometry = flatBottom(chunk(r * size, seed + i * 3, [1.2, 0.8, 1], 1, 0.08), -r * size * 0.45);
      add(geometry, 'matte', i % 2 ? '#eef2f7' : '#f6f8fb', place(cx + x * size, height + y * size, cz + z * size), { ground: height - 0.2 * size, height: 0.3 * size, min: 0.78 });
    });
  }, { shadow: false });

  // Rain: thin streaks falling from the cloud to the grass, each on its own beat.
  const bottom = height - 0.12 * size;
  const spread = 0.62 * size;
  const streaks = [];
  for (let i = 0; i < RAIN.streaks; i++) {
    const a = rank(island, 'rain-a', i) * Math.PI * 2, r = Math.sqrt(rank(island, 'rain-r', i)) * spread;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.7;
    streaks.push({ x, z, floor: groundAt(island, g, x, z), phase: rank(island, 'rain-t', i) });
  }
  const streakShape = new THREE.BoxGeometry(0.008, RAIN.length, 0.008);
  const rainMaterial = new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.55, depthWrite: false });
  const rain = new THREE.InstancedMesh(streakShape, rainMaterial, streaks.length);
  rain.name = 'rain';
  rain.frustumCulled = false;
  group.add(rain);
  ctx.track(streakShape, rainMaterial, rain);
  const m = new THREE.Matrix4();
  const update = t => {
    streaks.forEach((s, i) => {
      const fall = bottom - s.floor;
      const y = bottom - ((s.phase + t * RAIN.speed / fall) % 1) * fall;
      m.makeTranslation(s.x, Math.max(s.floor + RAIN.length / 2, y), s.z);
      rain.setMatrixAt(i, m);
    });
    rain.instanceMatrix.needsUpdate = true;
  };
  update(0);
  ctx.dynamic.push(update);

  // Puddles on the paths (on free grass when there are none), the nearest the cloud first.
  const lanes = [...island.lanes];
  const spots = (lanes.length ? lanes : g.free)
    .map(p => ({ p, d: Math.hypot(g.at(p)[0] - cx, g.at(p)[1] - cz) + rank(island, 'puddle', p) * 0.8 }))
    .sort((a, b) => a.d - b.d).slice(0, Math.max(2, Math.min(5, Math.round(lanes.length / 6) || 2)));
  if (!spots.length) return;
  const puddleShape = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  const puddleMaterial = new THREE.MeshStandardMaterial({ color: '#bcd9f2', roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const puddles = new THREE.InstancedMesh(puddleShape, puddleMaterial, spots.length);
  puddles.name = 'puddles';
  puddles.receiveShadow = true;
  spots.forEach(({ p }, i) => {
    const [x, z] = g.at(p), k = rank(island, 'puddle-size', p);
    const y = island.lanes.has(p) ? TOWN.laneRise + 0.003 : 0.004;
    puddles.setMatrixAt(i, place(x + (k - 0.5) * 0.1, y, z + (rank(island, 'puddle-z', p) - 0.5) * 0.1, { ry: k * Math.PI, sx: 0.12 + k * 0.07, sz: 0.08 + k * 0.05 }));
  });
  group.add(puddles);
  ctx.track(puddleShape, puddleMaterial, puddles);
}

// Squashes everything below y = floor almost flat, so a puff sits on a flat underside.
function flatBottom(geometry, floor) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < floor) p.setY(i, floor + (p.getY(i) - floor) * 0.15);
  geometry.computeVertexNormals();
  return geometry;
}

// The top of what stands at (x, z): a roof's eave over a block, the path over a lane, else the grass.
function groundAt(island, g, x, z) {
  let best = -1, far = Infinity;
  for (const p of g.land) {
    const [px, pz] = g.at(p), d = Math.hypot(px - x, pz - z);
    if (d < far) { far = d; best = p; }
  }
  if (best < 0) return 0;
  if (island.floors.has(best)) return island.floors.get(best) * TOWN.storey;
  if (island.taken.has(best)) return 0.3;
  return island.lanes.has(best) ? TOWN.laneRise : 0;
}

// ---------- Traveler's tent ----------

const TENT_COLOURS = [['#ff9a85', '#e2735f'], ['#7cc8ff', '#579fd6'], ['#ffd25e', '#e7ad35'], ['#8fe0b0', '#5fbf88']];

function tent(ctx, island, group, g) {
  const spot = tentSpot(island, g);
  if (!spot) return;
  const { p, toward } = spot;
  const [px, pz] = g.at(p);
  // Nudged a little inland from the coast point, so it sits on the grass.
  const inward = norm([g.middle[0] - px, g.middle[1] - pz]);
  const tx = px + inward[0] * 0.08, tz = pz + inward[1] * 0.08;
  const yaw = Math.atan2(toward[0], toward[1]);
  const fx = tx + toward[0] * 0.44, fz = tz + toward[1] * 0.44;
  const [canvas, shade] = TENT_COLOURS[Math.floor(rank(island, 'tent-colour', 0) * TENT_COLOURS.length)];
  const base = place(tx, 0, tz, { ry: yaw });
  const at = (x, y, z, o = {}) => base.clone().multiply(place(x, y, z, o));
  bake(ctx, group, add => {
    // An A-frame: a triangle 0.4 wide and 0.32 tall, 0.46 long, with a dark doorway at the front (+z).
    add(prism(0.4, 0.32, 0.46), 'facet', canvas, at(0, 0, 0), { ground: 0, height: 0.2, min: 0.7 });
    add(prism(0.2, 0.2, 0.01), 'matte', '#5a4a52', at(0, 0, 0.231));
    add(prism(0.1, 0.2, 0.012), 'facet', shade, at(-0.06, 0, 0.236, { ry: -0.5 }));
    // Poles poking out of the ridge, and a ground cloth.
    for (const z of [-0.24, 0.24]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), 'matte', P.post, at(0, 0.2, z));
    add(rbox(0.5, 0.012, 0.56, 0.004, 1), 'matte', P.plankDark, at(0, 0.006, 0.02));
    // The campfire: a ring of stones and three logs in a teepee.
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      add(chunk(0.04, i * 3 + 2, [1, 0.7, 1]), 'facet', i % 2 ? P.stone : P.trim, place(fx + Math.cos(a) * 0.13, 0.025, fz + Math.sin(a) * 0.13, { ry: i }));
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.3;
      add(logGeometry(0.18, 0.022, P.log, P.logCut, 6), 'facet', null, place(fx + Math.cos(a) * 0.035, 0.05, fz + Math.sin(a) * 0.035, { ry: -a, rz: 0.55 }));
    }
    // A log to sit on beside the fire.
    const side = [-toward[1], toward[0]];
    add(logGeometry(0.26, 0.045, P.log, P.logCut, 8), 'facet', null, place(fx + side[0] * 0.25, 0.035, fz + side[1] * 0.25, { ry: yaw }));
  });
  campfire(ctx, group, fx, fz);
}

// A free coast point for the tent, with a free neighbour for the fire. Points away from houses, things
// and bridge feet come first, then the front half of the island (toward the camera); the hash picks.
function tentSpot(island, g) {
  const near = p => island.grid.neighbours[p];
  const clear = p => near(p).every(n => !island.floors.has(n) && !island.taken.has(n) && !island.feet.some(f => f.point === n));
  const coast = g.free.filter(p => island.coast.has(p));
  if (!coast.length) return null;
  // A clear spot first; then, on the busy island, one of the four nearest the camera's view, else one on
  // the front half.
  const zs = coast.map(p => g.at(p)[1]).sort((a, b) => a - b), mid = zs[Math.floor(zs.length / 2)];
  const distance = p => Math.hypot(g.at(p)[0] - g.focus[0], g.at(p)[1] - g.focus[1]);
  const nearest = new Set(coast.slice().sort((a, b) => distance(a) - distance(b) || a - b).slice(0, 4));
  const score = p => (clear(p) ? 0 : 2) + (g.onView ? (nearest.has(p) ? 0 : 1) : (g.at(p)[1] >= mid ? 0 : 1));
  const best = Math.min(...coast.map(score));
  const [p] = coast.filter(q => score(q) === best).sort(byRank(island, 'tent'));
  const free = near(p).filter(n => island.land.has(n) && !g.busy(n));
  const along = free.filter(n => island.coast.has(n));
  const n = (along.length ? along : free).sort(byRank(island, 'fire'))[0];
  const [px, pz] = g.at(p);
  const toward = n !== undefined ? norm([g.at(n)[0] - px, g.at(n)[1] - pz]) : norm([g.middle[0] - px, g.middle[1] - pz]);
  return { p, toward };
}

// A tent body: a triangle w wide and h tall, standing on y = 0, d long along z.
function prism(w, h, d) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// Flames and a warm glow that follow the mood like the campfire model, without its light.
function campfire(ctx, group, x, z) {
  const flames = new THREE.Group();
  flames.position.set(x, 0.02, z);
  const shape = teardrop(0.22, 0.06, 10);
  const parts = [[1, '#ff7a3a', 0, 0, 0], [0.7, '#ff9d3f', 0.03, 0.02, -0.35], [0.5, '#ffe28a', -0.01, 0.03, 0.3]].map(([s, color, fx, fz, tilt]) => {
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(shape, material);
    mesh.position.set(fx, 0, fz); mesh.rotation.z = tilt; mesh.scale.setScalar(s); mesh.userData.s = s;
    flames.add(mesh);
    ctx.track(material);
    return mesh;
  });
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff7f30', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const glowShape = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const glow = new THREE.Mesh(glowShape, glowMaterial);
  glow.position.set(x, 0.015, z);
  glow.renderOrder = 2;
  group.add(flames, glow);
  ctx.track(shape, glowMaterial, glowShape);
  let size = 1;
  ctx.onMood((name, mood) => {
    const level = { lit: 1, low: 0.6, embers: 0.2, out: 0 }[mood?.fire] ?? 0;
    size = mood?.fire === 'low' ? 0.62 : 1;
    flames.visible = level >= 0.5;
    flames.scale.setScalar(size);
    glow.visible = level > 0;
    glow.scale.setScalar(level >= 0.5 ? 1.2 * size : 0.6);
    glowMaterial.opacity = level >= 0.5 ? 0.3 : 0.22;
  });
  ctx.dynamic.push(t => {
    if (!flames.visible) return;
    parts.forEach((m, i) => m.scale.set(m.userData.s * (1 + Math.sin(t * 8 + i) * 0.06), m.userData.s * (1 + Math.sin(t * 10.5 + i * 2) * 0.16), m.userData.s));
  });
}

// ---------- Hot-air balloon ----------

const BALLOON_COLOURS = [['#ff9a85', '#fff3e2'], ['#7cc8ff', '#ffd25e'], ['#b9a8f5', '#fff3e2'], ['#e9553f', '#ffd25e']];
// The envelope's outline, bottom to top: [radius, height].
const ENVELOPE = [[0.05, 0], [0.1, 0.04], [0.19, 0.14], [0.25, 0.3], [0.26, 0.42], [0.22, 0.55], [0.13, 0.64], [0, 0.67]];

// Beside the island. On the busy island, just off the coast nearest the camera's view, so it is seen;
// elsewhere on the side away from its neighbours, leaning toward the front.
function balloonSpot(ctx, island, g) {
  if (g.onView && island.coast.size) {
    const distance = p => Math.hypot(g.at(p)[0] - g.focus[0], g.at(p)[1] - g.focus[1]);
    const [p] = [...island.coast].sort((a, b) => distance(a) - distance(b) || a - b);
    const [px, pz] = g.at(p);
    const out = norm([px - g.middle[0], pz - g.middle[1]]);
    return [px + out[0] * 0.8, pz + out[1] * 0.8];
  }
  const away = [0, 0.9];
  for (const other of ctx.model?.islands ?? []) {
    if (other === island || !other.at) continue;
    const d = [island.at[0] - other.at[0], island.at[1] - other.at[1]], len = Math.hypot(...d) || 1;
    away[0] += d[0] / len / len * 4; away[1] += d[1] / len / len * 4;
  }
  const side = rank(island, 'balloon-side', 0) < 0.5 ? -1 : 1;
  const dir = norm([away[0] + side * 0.6, away[1]]);
  const out = island.reach + 0.75; // reach is measured from the grid's middle
  return [dir[0] * out, dir[1] * out];
}

function balloon(ctx, island, group, g) {
  const [bx, bz] = balloonSpot(ctx, island, g);
  const by = 0.95 + rank(island, 'balloon-height', 0) * 0.3;
  const [a, b] = BALLOON_COLOURS[Math.floor(rank(island, 'balloon-colour', 0) * BALLOON_COLOURS.length)];
  const lift = new THREE.Group();
  lift.position.set(bx, by, bz);
  lift.scale.setScalar(1.3); // a little bigger than a house, as a real one would be
  group.add(lift);
  bake(ctx, lift, add => {
    add(stripedEnvelope(a, b), 'facet', null, place(0, 0.3, 0));
    // The basket, its rim and four ropes up to the envelope's mouth.
    add(rbox(0.13, 0.09, 0.13, 0.015, 2), 'matte', P.plankDark, place(0, 0, 0));
    add(rbox(0.145, 0.018, 0.145, 0.006, 1), 'matte', P.log, place(0, 0.045, 0));
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const from = new THREE.Vector3(x * 0.055, 0.05, z * 0.055), to = new THREE.Vector3(x * 0.04, 0.31, z * 0.04);
      const length = from.distanceTo(to);
      const rope = new THREE.CylinderGeometry(0.004, 0.004, length, 3);
      const m = new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()), new THREE.Vector3(1, 1, 1));
      add(rope, 'matte', P.rope, m);
    }
  }, { shadow: false });
  // The burner's flame, bright in the evening.
  const flameMaterial = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 });
  const flameShape = teardrop(0.08, 0.025, 8);
  const flame = new THREE.Mesh(flameShape, flameMaterial);
  flame.position.set(0, 0.2, 0);
  lift.add(flame);
  ctx.track(flameMaterial, flameShape);
  ctx.onMood(name => { flame.visible = name !== 'focus'; });
  const phase = rank(island, 'balloon-phase', 0) * 6.28;
  const update = t => {
    lift.position.set(bx + Math.sin(t * 0.21 + phase) * 0.08 - Math.sin(phase) * 0.08, by + Math.sin(t * 0.6) * 0.05, bz);
    lift.rotation.z = Math.sin(t * 0.45) * 0.03;
    flame.scale.setScalar(1 + Math.sin(t * 9) * 0.12);
  };
  update(0);
  ctx.dynamic.push(update);
}

// The balloon's envelope: a lathe with flat stripes of two colours, 12 around.
function stripedEnvelope(a, b) {
  const segments = 12;
  const geometry = new THREE.LatheGeometry(ENVELOPE.map(([r, y]) => new THREE.Vector2(r, y)), segments).toNonIndexed();
  geometry.computeVertexNormals();
  const p = geometry.attributes.position, colors = new Float32Array(p.count * 3);
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const stripe = Math.floor(((Math.atan2(x, z) / (Math.PI * 2) + 1) % 1) * segments);
    const c = stripe % 2 ? cb : ca;
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// ---------- Rainbow ----------

const RAINBOW = ['#ff9a9a', '#ffbf86', '#ffe48a', '#a8e6a0', '#9fd0ff', '#c9b0ff'];
const RAINBOW_SHOWN = { focus: 0.5, break: 0.3, away: 0.22, done: 0 };

function rainbow(ctx, island, group, g) {
  const { box } = g;
  const radius = Math.max(1.3, Math.min(4, (box.x1 - box.x0) * 0.55));
  const thick = Math.max(0.24, Math.min(0.5, radius * 0.12));
  const geometry = new THREE.RingGeometry(radius - thick, radius, 40, RAINBOW.length, 0, Math.PI).toNonIndexed();
  const p = geometry.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    let r = 0;
    for (let k = 0; k < 3; k++) r += Math.hypot(p.getX(i + k), p.getY(i + k)) / 3;
    const band = Math.max(0, Math.min(RAINBOW.length - 1, Math.floor((r - (radius - thick)) / thick * RAINBOW.length)));
    c.set(RAINBOW[RAINBOW.length - 1 - band]);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const arc = new THREE.Mesh(geometry, material);
  arc.name = 'rainbow';
  // Behind the island, its feet sunk below the grass so it rises from behind the land.
  arc.position.set((box.x0 + box.x1) / 2, -0.35, box.z0 - 0.45);
  arc.renderOrder = 1;
  group.add(arc);
  ctx.track(geometry, material);
  ctx.onMood(name => {
    material.opacity = RAINBOW_SHOWN[name] ?? 0;
    arc.visible = material.opacity > 0;
  });
}

// ---------- Fireflies ----------

const FLIES = 18;

function fireflies(ctx, island, group, g) {
  // Over free grass near the middle (any land when it is all built on).
  const spots = (g.free.length ? g.free : g.land)
    .map(p => ({ p, d: Math.hypot(g.at(p)[0] - g.focus[0], g.at(p)[1] - g.focus[1]) }))
    .sort((a, b) => a.d - b.d).slice(0, 6).map(s => s.p).sort(byRank(island, 'flies'));
  if (!spots.length) return;
  const [sx, sz] = g.at(spots[0]);
  const flies = Array.from({ length: FLIES }, (_, i) => ({
    x: sx + (rank(island, 'fly-x', i) - 0.5) * 0.9, z: sz + (rank(island, 'fly-z', i) - 0.5) * 0.7,
    y: 0.22 + rank(island, 'fly-y', i) * 0.5, s: 0.4 + rank(island, 'fly-s', i) * 0.5, phase: rank(island, 'fly-p', i) * 6.28,
  }));
  const positions = new Float32Array(FLIES * 3), colors = new Float32Array(FLIES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ map: blobTexture(), size: 0.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const points = new THREE.Points(geometry, material);
  points.name = 'fireflies';
  points.frustumCulled = false;
  group.add(points);
  ctx.track(geometry, material);
  ctx.onMood(name => { points.visible = name === 'break' || name === 'done'; });
  const warm = new THREE.Color('#ffe066');
  const update = t => {
    flies.forEach((f, i) => {
      positions[i * 3] = f.x + Math.sin(t * f.s + i) * 0.12 - Math.sin(i) * 0.12;
      positions[i * 3 + 1] = f.y + Math.sin(t * 0.9 + f.phase) * 0.06 - Math.sin(f.phase) * 0.06;
      positions[i * 3 + 2] = f.z + Math.cos(t * f.s * 0.8 + i * 2) * 0.12 - Math.cos(i * 2) * 0.12;
      const k = 0.45 + 0.55 * (Math.sin(t * 2.4 + f.phase) * 0.5 + 0.5);
      colors.set([warm.r * k, warm.g * k, warm.b * k], i * 3);
    });
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  };
  update(0);
  ctx.dynamic.push(update);
}

const norm = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

const DRAW = { raincloud, tent, balloon, rainbow, fireflies };
