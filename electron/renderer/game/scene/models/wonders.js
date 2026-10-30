// Starlight wonders: lighthouse, airship dock, observatory, sky waterfall and aurora garden. They are
// rare rewards, so each is the most delightful thing on its island while staying calm. The only motion
// is the lighthouse beam turning, the airship bobbing and a faint shimmer on the waterfall, all slow.
//
// Edge kinds (lighthouse, airship, skyfall) put their outward or hanging part on the side that faces open
// sky (coastFrame). On the town grid the layout says which way that is (thing.coast); on the square grid
// they look at the cells around their footprint. With no sky next to them (the gallery's small portrait
// island), they draw a version that stays on the grass.
import * as THREE from 'three';
import { CELL, P } from '../style.js';
import { Batch, place, taperedTube } from '../ground.js';
import { chunk, crystalGeometry, glowTexture, lump, rbox } from '../parts.js';
import { addRoof, addWindow } from './buildings.js';

const R = 2; // rounded-box segments
const E = 0.012; // edge rounding: a sliver, not pillowy
const RED = '#e9553f';
const BRASS = '#eab03f', BRASS_DARK = '#c88d2c';
const NAVY = '#2d3770';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const at = (frame, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frame);
const evening = name => name !== 'focus';

// ---------- Finding the coast ----------
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // grid steps: south (toward the camera), east, north, west
const SEEN = [0.3, 0.15, 0, 0.15]; // on a tie, prefer a side the camera can see

// A frame on the thing's ground point whose local +z points out to open sky, and where along that side
// the open sky is. { frame, coast, yaw (world yaw of +z), half (half the side's length), depth (centre to
// that side), along (middle of the open cells along the side, in frame x), span }.
// With no sky next to the footprint, +z is the thing's back and coast is false.
// Town things carry coast: { yaw, width } from the layout, and coastDepth (middle to the island's edge, in
// island units) and modelScale from scene/town/pads.js. Sizes come back in the model's own units.
export function coastFrame(ctx, thing, base) {
  const ry = Number.isFinite(thing.yaw) ? thing.yaw : (thing.facing ?? 0) * Math.PI / 2;
  if (thing.coast && Number.isFinite(thing.coast.yaw)) {
    const k = thing.modelScale || 1, yaw = thing.coast.yaw;
    const half = ((thing.coast.width ?? 0.65) / 2 + 0.2) / k;
    const depth = (Number.isFinite(thing.coastDepth) ? thing.coastDepth : 0.6) / k;
    return { frame: base.clone().multiply(place(0, 0, 0, { ry: yaw - ry })), coast: true, yaw, half, depth, along: 0, span: half * 2 };
  }
  const get = ctx.model?.get;
  let best = null;
  if (get && Number.isFinite(thing.c0) && Number.isFinite(thing.r0)) {
    const inside = (c, r) => c >= thing.c0 && c < thing.c0 + thing.w && r >= thing.r0 && r < thing.r0 + thing.h;
    SIDES.forEach(([dc, dr], s) => {
      const open = [];
      let reach = 0;
      for (let a = 0; a < thing.w; a++) for (let b = 0; b < thing.h; b++) {
        const c = thing.c0 + a, r = thing.r0 + b;
        if (inside(c + dc, r + dr) || get(c + dc, r + dr)) continue;
        open.push([c, r]);
        let k = 1;
        while (k < 4 && !get(c + dc * (k + 1), r + dr * (k + 1))) k++;
        reach += k;
      }
      if (!open.length) return;
      const score = open.length * 10 + reach + SEEN[s];
      if (!best || score > best.score) best = { score, dc, dr, open };
    });
  }
  const yaw = best ? Math.atan2(best.dc, best.dr) : ry + Math.PI;
  const frame = base.clone().multiply(place(0, 0, 0, { ry: yaw - ry }));
  const alongCells = best ? (best.dr ? thing.w : thing.h) : thing.fw;
  const acrossCells = best ? (best.dr ? thing.h : thing.w) : thing.fd;
  let along = 0, span = alongCells * CELL;
  if (best) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const xs = best.open.map(([c, r]) => (c - thing.c) * CELL * cos - (r - thing.r) * CELL * sin);
    along = (Math.min(...xs) + Math.max(...xs)) / 2;
    span = Math.max(...xs) - Math.min(...xs) + CELL;
  }
  return { frame, coast: Boolean(best), yaw, half: alongCells * CELL / 2, depth: acrossCells * CELL / 2, along, span };
}

// ---------- Small shared pieces ----------

// A separate merged batch with its own materials (for parts that move or glow in their own colour).
function ownBatch(ctx) {
  const batch = new Batch();
  return {
    add(geometry, mat, color, local, frame) {
      batch.add(geometry, mat, { color, matrix: frame.clone().multiply(local ?? new THREE.Matrix4()) });
      geometry.dispose();
    },
    build(materials, parent, castShadow = true) {
      const top = batch.top;
      const meshes = batch.build(materials, parent);
      for (const mesh of meshes) { mesh.castShadow = castShadow; ctx.track(mesh.geometry); }
      return { meshes, top };
    },
  };
}
// Parts drawn outside ctx.add still count toward the thing's height, so the camera keeps them in view.
const raiseTop = (ctx, y) => { if (ctx.batch && Number.isFinite(y)) ctx.batch.top = Math.max(ctx.batch.top, y); };

// A box stretched between two local points (struts, ropes with a thickness).
function between(a, b, thickness) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from), length = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return { geometry: rbox(thickness, length, thickness, thickness * 0.2, 1), local: new THREE.Matrix4().compose(from.add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) };
}

// A band on a dome: the slice of a ring between radii r0 and r1, from angle a0 to a1 above the
// horizon, in the x-y plane (x outward), width across z.
function arcBand(r0, r1, a0, a1, width, segments = 18) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * i / segments;
    if (i) shape.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); else shape.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
  }
  for (let i = segments; i >= 0; i--) { const a = a0 + (a1 - a0) * i / segments; shape.lineTo(Math.cos(a) * r0, Math.sin(a) * r0); }
  return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -width / 2);
}

// A soft additive sprite (halos, mist).
function softSprite(ctx, colour, opacity, size, position, additive = true) {
  const material = new THREE.SpriteMaterial({ map: glowTexture(), color: colour, transparent: true, opacity, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.setScalar(size);
  sprite.renderOrder = 2;
  ctx.track(material);
  return sprite;
}

// ---------- Lighthouse ----------

// The lamp's beam: two crossed strips (flat and upright) that widen from the lamp along +x. The light
// fades in near the lamp, out toward the end, and toward both edges, so the beam has no hard outline.
function beamGeometry(length, spread, colour, strength) {
  const rows = 10, cols = 8, c = new THREE.Color(colour);
  const positions = [], colours = [], index = [];
  for (const upright of [false, true]) {
    const start = positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows, w = 0.03 + spread * t;
      const along = Math.pow(1 - t, 1.5) * Math.min(1, t * 5);
      for (let j = 0; j <= cols; j++) {
        const u = j / cols * 2 - 1;
        positions.push(t * length, upright ? u * w : 0, upright ? 0 : u * w);
        const k = strength * along * Math.pow(1 - Math.abs(u), 1.6);
        colours.push(c.r * k, c.g * k, c.b * k);
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = start + i * (cols + 1) + j, b = a + 1, d = a + cols + 1, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(index);
  return g;
}

// The keeper's cottage, door on its +z side.
function keeperCottage(ctx, frame) {
  const w = 0.5, d = 0.36, h = 0.34, wall = P.walls[1];
  ctx.add(rbox(w + 0.05, 0.05, d + 0.05, 0.01, R), 'matte', P.trim, place(0, 0.025, 0), frame);
  ctx.add(rbox(w, h, d, E, R), 'matte', wall, place(0, h / 2 + 0.03, 0), frame);
  ctx.add(rbox(w + 0.03, 0.035, d + 0.03, 0.006, R), 'matte', P.trim, place(0, h + 0.02, 0), frame, false);
  addRoof(ctx, frame, { w, d, top: h + 0.04, roof: RED, wall, pitch: 0.62, over: 0.06, chimney: false, gableWindow: false });
  ctx.add(rbox(0.16, 0.25, 0.03, 0.005, R), 'matte', P.trim, place(-0.1, 0.155, d / 2 + 0.008), frame);
  ctx.add(rbox(0.11, 0.2, 0.04, 0.005, R), 'matte', P.door, place(-0.1, 0.135, d / 2 + 0.014), frame, false);
  addWindow(ctx, frame, 0.12, 0.2, d / 2, 0.11);
}

function lighthouse(ctx, thing, base) {
  const cf = coastFrame(ctx, thing, base);
  const tx = clamp(cf.along, -cf.half + 0.36, cf.half - 0.36), tz = cf.depth - 0.36;
  const tower = cf.frame.clone().multiply(place(tx, 0, tz));
  const toCamera = -cf.yaw; // the frame's yaw that faces the camera

  // Rocks at the foot, on the sky side.
  [[0.24, 0.12, 0.13, P.lilac], [-0.22, 0.16, 0.11, P.boulder], [0.06, 0.27, 0.09, P.stoneDark], [-0.3, -0.12, 0.08, P.lilac]]
    .forEach(([x, z, r, colour], i) => ctx.add(chunk(r, 31 + i * 5, [1.25, 0.7, 1.1], 0, 0.16), 'facet', colour, place(x, r * 0.45, z, { ry: i * 1.7 }), tower, true, [0, 0.3, 0.88, 1.06]));

  // Tower: a stone plinth, then a tapering shaft in bold red and white bands.
  ctx.add(new THREE.CylinderGeometry(0.31, 0.34, 0.12, 10), 'facet', P.stone, place(0, 0.06, 0, { ry: 0.3 }), tower);
  ctx.add(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 24), 'matte', P.trim, place(0, 0.125, 0), tower, false);
  const y0 = 0.14, y1 = 1.34, r0 = 0.27, r1 = 0.19, bands = 7, bh = (y1 - y0) / bands;
  const radiusAt = y => r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  for (let i = 0; i < bands; i++) {
    const ya = y0 + bh * i;
    ctx.add(new THREE.CylinderGeometry(radiusAt(ya + bh), radiusAt(ya), bh, 28, 1, true), 'matte', i % 2 ? RED : P.white, place(0, ya + bh / 2, 0), tower, i === 0);
  }
  // Two small windows on the white bands, turned toward the camera.
  for (const [band, turn] of [[2, 0.45], [4, -0.35]]) {
    const y = y0 + bh * (band + 0.5), r = radiusAt(y), yaw = toCamera + turn;
    const wf = tower.clone().multiply(place(Math.sin(yaw) * r, y, Math.cos(yaw) * r, { ry: yaw }));
    ctx.add(rbox(0.1, 0.14, 0.03, 0.006, R), 'matte', P.trim, place(0, 0, 0.004), wf, false);
    ctx.add(rbox(0.06, 0.1, 0.03, 0.004, 1), 'glass', P.glass, place(0, 0, 0.012), wf, false);
  }
  // Gallery: a white corbel and deck with a railing.
  ctx.add(new THREE.CylinderGeometry(0.31, r1, 0.1, 28), 'matte', P.trim, place(0, y1 + 0.02, 0), tower, false);
  ctx.add(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 28), 'matte', P.trim, place(0, y1 + 0.09, 0), tower, false);
  const deck = y1 + 0.11;
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    ctx.add(rbox(0.016, 0.11, 0.016, 0.004, 1), 'matte', P.trim, place(Math.sin(a) * 0.31, deck + 0.055, Math.cos(a) * 0.31), tower, false);
  }
  ctx.add(new THREE.TorusGeometry(0.31, 0.014, 5, 36).rotateX(Math.PI / 2), 'matte', RED, place(0, deck + 0.115, 0), tower, false);
  // Lamp room: red base ring, glass panes with white posts, a red cap with a gold ball.
  ctx.add(new THREE.CylinderGeometry(0.2, 0.21, 0.05, 24), 'matte', RED, place(0, deck + 0.025, 0), tower, false);
  ctx.add(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8), 'glass', P.glass, place(0, deck + 0.16, 0, { ry: Math.PI / 8 }), tower, false);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    ctx.add(rbox(0.026, 0.22, 0.026, 0.005, 1), 'matte', P.trim, place(Math.sin(a) * 0.16, deck + 0.16, Math.cos(a) * 0.16), tower, false);
  }
  ctx.add(new THREE.CylinderGeometry(0.21, 0.2, 0.04, 24), 'matte', P.trim, place(0, deck + 0.29, 0), tower, false);
  ctx.add(new THREE.ConeGeometry(0.23, 0.2, 24), 'matte', RED, place(0, deck + 0.41, 0), tower, false);
  ctx.add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), 'matte', P.trim, place(0, deck + 0.53, 0), tower, false);
  ctx.add(new THREE.SphereGeometry(0.035, 12, 8), 'matte', BRASS, place(0, deck + 0.58, 0), tower, false);

  // The keeper's cottage leans on the tower's landward side, door facing inland.
  keeperCottage(ctx, cf.frame.clone().multiply(place(tx, 0, tz - 0.5, { ry: Math.PI })));
  ctx.blob(cf.frame, 0.85, 0.85, tx, tz);
  ctx.blob(cf.frame, 0.75, 0.55, tx, tz - 0.5);

  // The lamp: lit with a slowly turning, faint beam in break, away and done. Unlit in focus.
  const lamp = at(tower, 0, deck + 0.16, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beamShape = beamGeometry(2.2, 0.3, '#ffe2a0', 0.13);
  const beam = new THREE.Group();
  beam.position.copy(lamp);
  for (const turn of [0, Math.PI]) {
    const mesh = new THREE.Mesh(beamShape, beamMaterial);
    mesh.rotation.set(0, turn, -0.05);
    mesh.renderOrder = 3;
    beam.add(mesh);
  }
  const halo = softSprite(ctx, '#ffd98a', 0.55, 0.62, lamp);
  ctx.root.add(beam, halo);
  ctx.track(beamMaterial, beamShape);
  const phase = (thing.c0 ?? 0) * 0.7 + (thing.r0 ?? 0) * 0.3;
  ctx.onMood(name => {
    beam.visible = halo.visible = evening(name);
    beamMaterial.opacity = name === 'away' ? 0.7 : 1;
  });
  ctx.dynamic.push(t => { if (beam.visible) beam.rotation.y = phase + t * 0.22; });
}

// ---------- Airship dock ----------

// Balloon with crisp lengthwise stripes, its long axis along z.
function stripedBalloon(radius, length, colours, gores = 8) {
  const g = new THREE.SphereGeometry(radius, gores * 3, 14).toNonIndexed();
  g.scale(1, length / (2 * radius), 1).rotateX(Math.PI / 2);
  const p = g.attributes.position, colourData = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const k = Math.floor(((Math.atan2(y, x) + Math.PI) / (Math.PI * 2)) * gores + 1e-4) % gores;
    c.set(colours[k % colours.length]);
    for (let j = 0; j < 3; j++) colourData.set([c.r, c.g, c.b], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colourData, 3));
  return g;
}

// The little airship, built around its gondola's middle, nose toward +z. Returns its height above that point.
function buildAirship(add) {
  const id = new THREE.Matrix4();
  add(rbox(0.17, 0.08, 0.28, 0.02, R), 'matte', P.plank, place(0, 0, 0), id);
  add(rbox(0.19, 0.025, 0.3, 0.008, R), 'matte', P.trim, place(0, 0.045, 0), id);
  add(rbox(0.175, 0.02, 0.2, 0.006, 1), 'matte', P.plankDark, place(0, -0.035, 0), id);
  for (const z of [-0.06, 0.06]) add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10).rotateZ(Math.PI / 2), 'glass', P.glass, place(0.086, 0.005, z), id);
  for (const z of [-0.06, 0.06]) add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10).rotateZ(Math.PI / 2), 'glass', P.glass, place(-0.086, 0.005, z), id);
  const by = 0.37, br = 0.19, bl = 0.84;
  add(stripedBalloon(br, bl, ['#ffd25e', '#ff7a5c']), 'matte', null, place(0, by, 0), id);
  add(new THREE.SphereGeometry(0.035, 10, 6), 'matte', P.trim, place(0, by, bl / 2 - 0.01), id);
  // Ropes from the gondola's corners up to the balloon.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const { geometry, local } = between([sx * 0.07, 0.05, sz * 0.1], [sx * 0.05, by - br * 0.9, sz * 0.15], 0.008);
    add(geometry, 'matte', P.rope, local, id);
  }
  // Tail fins in a cross.
  const fz = -bl / 2 + 0.07, fr = br * Math.sqrt(1 - Math.pow(fz / (bl / 2), 2));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    add(rbox(0.014, 0.11, 0.15, 0.004, 1), 'matte', RED, place(Math.sin(a) * (fr + 0.04), by + Math.cos(a) * (fr + 0.04), fz, { rz: -a }), id);
  }
  // A small propeller behind the gondola.
  add(new THREE.SphereGeometry(0.022, 8, 6), 'matte', BRASS, place(0, 0.01, -0.16), id);
  for (const a of [0.4, 0.4 + Math.PI / 2]) add(rbox(0.016, 0.12, 0.012, 0.004, 1), 'matte', P.trim, place(0, 0.01, -0.175, { rz: a }), id);
  return by + br;
}

function kiosk(ctx, frame) {
  const w = 0.42, d = 0.32, h = 0.32, wall = P.walls[0];
  ctx.add(rbox(w + 0.04, 0.04, d + 0.04, 0.008, R), 'matte', P.trim, place(0, 0.02, 0), frame);
  ctx.add(rbox(w, h, d, E, R), 'matte', wall, place(0, h / 2 + 0.03, 0), frame);
  ctx.add(rbox(w + 0.03, 0.035, d + 0.03, 0.006, R), 'matte', P.trim, place(0, h + 0.02, 0), frame, false);
  addRoof(ctx, frame, { w, d, top: h + 0.04, roof: P.roofs[2], wall, pitch: 0.6, over: 0.05, chimney: false, gableWindow: false });
  addWindow(ctx, frame, 0.07, 0.2, d / 2, 0.13);
  ctx.add(rbox(0.1, 0.18, 0.03, 0.005, R), 'matte', P.door, place(-0.13, 0.12, d / 2 + 0.01), frame, false);
}

const SHIP_SCALE = 1.5;

function airship(ctx, thing, base) {
  const cf = coastFrame(ctx, thing, base);
  const f = cf.frame, { half, depth } = cf;
  const deckY = 0.1;
  // The airship always lies side-on to the camera (along world x). On an east or west coast that runs
  // alongside the pier; on a north or south coast it lies across the pier's end.
  const alongside = Math.abs(Math.sin(cf.yaw)) > 0.7;
  // Alongside a pier, the airship floats on the side away from the camera, so it shows above the pier
  // on screen instead of covering it.
  const side = Math.abs(Math.sin(cf.yaw)) < 0.1 ? 1 : Math.sign(Math.sin(cf.yaw));
  const pierX = clamp(cf.along, -half + 0.26, half - 0.26);
  const reach = cf.coast ? (alongside ? 0.5 : 0.36) : 0;

  // Deck: plank platform on the coast side of the footprint, with a white edge.
  const dd = Math.min(depth * 2 - 0.1, 1.2), dw = half * 2 - 0.1, dz = depth - 0.03 - dd / 2;
  ctx.add(rbox(dw, 0.07, dd, 0.01, R), 'matte', P.post, place(0, 0.035, dz), f);
  const rows = Math.max(4, Math.round(dd / 0.13));
  for (let i = 0; i < rows; i++) {
    const z = dz - dd / 2 + (i + 0.5) * dd / rows;
    ctx.add(rbox(dw - 0.05, 0.03, dd / rows - 0.012, 0.006, 1), 'matte', i % 2 ? P.plank : P.plankDark, place(0, deckY - 0.02, z), f, false);
  }
  for (const s of [-1, 1]) {
    ctx.add(rbox(0.045, 0.04, dd + 0.02, 0.008, R), 'matte', P.trim, place(s * (dw / 2 - 0.01), deckY - 0.01, dz), f, false);
    ctx.add(rbox(dw + 0.02, 0.04, 0.045, 0.008, R), 'matte', P.trim, place(0, deckY - 0.01, dz + s * (dd / 2 - 0.01)), f, false);
  }
  ctx.blob(f, dw * 1.05, dd * 1.05, 0, dz);

  // Pier: reaches out past the coast on struts that run back under the island.
  const pz0 = depth - 0.12, pz1 = depth + reach, pw = 0.34;
  const shipY = deckY + 0.14;
  let ship, mast = null;
  if (reach > 0) {
    const n = Math.round((pz1 - pz0) / 0.11);
    for (let i = 0; i < n; i++) ctx.add(rbox(pw, 0.03, (pz1 - pz0) / n - 0.012, 0.006, 1), 'matte', i % 2 ? P.plankDark : P.plank, place(pierX, deckY - 0.02, pz0 + (i + 0.5) * (pz1 - pz0) / n), f, false);
    for (const s of [-1, 1]) {
      ctx.add(rbox(0.045, 0.05, pz1 - pz0, 0.008, 1), 'matte', P.post, place(pierX + s * 0.12, deckY - 0.06, (pz0 + pz1) / 2), f, false);
      const strut = between([pierX + s * 0.12, deckY - 0.07, pz1 - 0.06], [pierX + s * 0.12, -0.42, depth - 0.16], 0.045);
      ctx.add(strut.geometry, 'matte', P.post, strut.local, f, false);
    }
    // Posts with white caps and a rope rail on the side away from the mast.
    for (const z of [pz0 + 0.06, pz1 - 0.04]) {
      ctx.add(rbox(0.05, 0.3, 0.05, 0.008, 1), 'matte', P.post, place(pierX - side * 0.15, deckY + 0.13, z), f, false);
      ctx.add(rbox(0.07, 0.025, 0.07, 0.006, 1), 'matte', P.trim, place(pierX - side * 0.15, deckY + 0.29, z), f, false);
    }
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([pierX - side * 0.15, deckY + 0.25 - Math.sin(t * Math.PI) * 0.05, pz0 + 0.06 + (pz1 - 0.1 - pz0) * t]); }
    ctx.add(taperedTube(pts, 0.013, 0.013, 5), 'matte', P.rope, null, f, false);
    mast = [pierX + side * 0.15, pz1 - 0.04];
    ship = alongside ? [pierX + side * 0.56, shipY, pz1 - 0.26] : [pierX + side * 0.18, shipY, pz1 + 0.4];
  } else {
    // No coast here: the airship hovers over the deck, tied down to two cleats.
    ship = [clamp(pierX + side * 0.1, -half + 0.3, half - 0.3), 0.62, clamp(dz + 0.1, -depth + 0.4, depth - 0.3)];
  }

  // Mooring mast with a lamp and a pennant at the pier's end.
  const mastTop = deckY + 0.78;
  if (mast) {
    const [mx, mz] = mast;
    ctx.add(rbox(0.05, 0.78, 0.05, 0.01, 1), 'matte', P.trim, place(mx, deckY + 0.39, mz), f, false);
    for (const y of [0.42, 0.6]) ctx.add(rbox(0.058, 0.06, 0.058, 0.008, 1), 'matte', RED, place(mx, deckY + y, mz), f, false);
    ctx.add(rbox(0.08, 0.07, 0.08, 0.01, 1), 'glow', '#ffe9a8', place(mx, mastTop + 0.035, mz), f, false);
    ctx.add(new THREE.ConeGeometry(0.06, 0.05, 4), 'matte', RED, place(mx, mastTop + 0.095, mz, { ry: Math.PI / 4 }), f, false);
    const flag = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.16, -0.035), new THREE.Vector2(0, -0.07)]);
    // The pennant flies back over the pier, away from the airship.
    ctx.add(new THREE.ExtrudeGeometry(flag, { depth: 0.01, bevelEnabled: false }), 'matte', '#ffd25e', place(mx - side * 0.025, mastTop - 0.03, mz, { ry: side > 0 ? Math.PI : 0 }), f, false);
  }

  // The kiosk and some cargo on the landward end.
  const kx = clamp(pierX - side * 0.42, -half + 0.28, half - 0.28), kz = -depth + 0.26;
  const onDeck = kz - 0.2 > dz - dd / 2 - 0.02;
  kiosk(ctx, f.clone().multiply(place(kx, onDeck ? deckY : 0, kz, { ry: Math.PI })));
  const cx = clamp(kx + side * 0.36, -half + 0.12, half - 0.12), cy = -depth + 0.2 < dz - dd / 2 ? 0 : deckY;
  ctx.add(rbox(0.15, 0.15, 0.15, 0.012, R), 'matte', P.plank, place(cx, cy + 0.075, -depth + 0.2, { ry: 0.2 }), f);
  ctx.add(rbox(0.12, 0.12, 0.12, 0.012, R), 'matte', P.plankDark, place(cx + side * 0.02, cy + 0.21, -depth + 0.21, { ry: -0.15 }), f, false);
  ctx.add(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12), 'matte', P.log, place(cx + side * 0.14, cy + 0.075, -depth + 0.36), f);
  for (const y of [0.03, 0.12]) ctx.add(new THREE.CylinderGeometry(0.063, 0.063, 0.015, 12), 'matte', P.post, place(cx + side * 0.14, cy + y, -depth + 0.36), f, false);

  // The airship itself, nose along world x (+x when it lies across a pier toward the camera's right).
  const group = new THREE.Group();
  group.position.copy(at(f, ...ship));
  group.rotation.y = Math.PI / 2;
  group.scale.setScalar(SHIP_SCALE);
  const own = ownBatch(ctx);
  const height = buildAirship(own.add);
  own.build(ctx.materials, group, false);
  ctx.root.add(group);
  raiseTop(ctx, group.position.y + height * SHIP_SCALE);
  // Ship axis in frame coordinates, for the lines that hold it.
  const ax = Math.cos(cf.yaw), az = Math.sin(cf.yaw);
  const balloon = [ship[0], ship[1] + 0.37 * SHIP_SCALE, ship[2]];
  if (mast) {
    // The mooring line runs from the mast's top to the near side of the balloon.
    const toMast = new THREE.Vector3(mast[0] - balloon[0], mastTop - balloon[1], mast[1] - balloon[2]).normalize().multiplyScalar(0.17 * SHIP_SCALE);
    const tip = [balloon[0] + toMast.x, balloon[1] + toMast.y, balloon[2] + toMast.z];
    const mid = [(mast[0] + tip[0]) / 2, (mastTop + tip[1]) / 2 - 0.06, (mast[1] + tip[2]) / 2];
    ctx.add(taperedTube([[mast[0], mastTop - 0.02, mast[1]], mid, tip], 0.008, 0.008, 4), 'matte', P.rope, null, f, false);
  } else {
    // Two tie-down lines from the gondola's ends to cleats on the deck.
    for (const end of [-1, 1]) {
      const top = [ship[0] + ax * end * 0.14 * SHIP_SCALE, ship[1], ship[2] + az * end * 0.14 * SHIP_SCALE];
      const foot = [ship[0] + ax * end * 0.3, deckY, ship[2] + az * end * 0.3];
      ctx.add(taperedTube([top, [(top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2, (top[2] + foot[2]) / 2], foot], 0.007, 0.007, 4), 'matte', P.rope, null, f, false);
      ctx.add(rbox(0.06, 0.05, 0.06, 0.01, 1), 'matte', P.post, place(foot[0], deckY + 0.02, foot[2]), f, false);
    }
  }
  const y0 = group.position.y, phase = (thing.c0 ?? 0) * 0.9;
  ctx.dynamic.push(t => {
    group.position.y = y0 + Math.sin(t * 0.55 + phase) * 0.016;
    group.rotation.z = Math.sin(t * 0.4 + phase + 1) * 0.02;
  });
}

// ---------- Observatory ----------

function observatory(ctx, thing, base) {
  const ry = (thing.facing ?? 0) * Math.PI / 2;
  const slit = 0.85 - ry; // the slit and telescope face the camera's front right, whatever the facing
  // A round white terrace with a step at the door.
  ctx.add(new THREE.CylinderGeometry(0.82, 0.85, 0.06, 40), 'matte', P.trim, place(0, 0.03, 0), base);
  ctx.add(new THREE.CylinderGeometry(0.76, 0.76, 0.012, 40), 'matte', P.stone, place(0, 0.062, 0), base, false);
  ctx.add(rbox(0.36, 0.035, 0.14, 0.008, R), 'matte', P.trim, place(0, 0.018, 0.86), base);
  // The drum: deep periwinkle with white bands.
  const dr = 0.6, top = 0.66;
  ctx.add(new THREE.CylinderGeometry(dr + 0.03, dr + 0.04, 0.07, 40), 'matte', P.trim, place(0, 0.1, 0), base);
  ctx.add(new THREE.CylinderGeometry(dr, dr, top - 0.12, 40), 'matte', '#6f80ec', place(0, 0.06 + (top - 0.06) / 2, 0), base);
  ctx.add(new THREE.CylinderGeometry(dr + 0.05, dr + 0.03, 0.06, 40), 'matte', P.trim, place(0, top - 0.02, 0), base, false);
  // Door with a white frame and arch, and round windows around the drum.
  const door = base.clone().multiply(place(0, 0, dr - 0.012));
  ctx.add(rbox(0.3, 0.38, 0.04, 0.006, R), 'matte', P.trim, place(0, 0.32, 0.01), door);
  ctx.add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 20, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 'matte', P.trim, place(0, 0.5, 0.01), door, false);
  ctx.add(rbox(0.2, 0.3, 0.05, 0.006, R), 'matte', P.door, place(0, 0.29, 0.018), door, false);
  ctx.add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 'matte', P.door, place(0, 0.44, 0.018), door, false);
  for (const a of [-1.2, 1.2, -2.3, 2.3, Math.PI]) {
    const wf = base.clone().multiply(place(Math.sin(a) * dr, 0.4, Math.cos(a) * dr, { ry: a }));
    ctx.add(new THREE.TorusGeometry(0.075, 0.02, 6, 20), 'matte', P.trim, place(0, 0, 0.006), wf, false);
    ctx.add(new THREE.CylinderGeometry(0.068, 0.068, 0.02, 20).rotateX(Math.PI / 2), 'glass', P.glass, place(0, 0, 0), wf, false);
  }
  // Little gold stars on the drum that glow at night.
  [[-0.6, 0.24], [-0.85, 0.52], [0.6, 0.22], [0.85, 0.5], [1.7, 0.25], [-1.7, 0.27], [2.0, 0.53], [-2.0, 0.52], [2.7, 0.26], [-2.7, 0.28]].forEach(([a, y], i) => {
    ctx.add(new THREE.OctahedronGeometry(0.032 + (i % 3) * 0.006, 0).scale(1, 1, 0.45), 'glow', '#ffd23f', place(Math.sin(a) * (dr + 0.006), y, Math.cos(a) * (dr + 0.006), { ry: a }), base, false);
  });
  // Dome with an open slit and two white rails, and a brass telescope peeking out.
  ctx.add(new THREE.SphereGeometry(dr, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'matte', P.white, place(0, top, 0), base, false);
  const slitFrame = base.clone().multiply(place(0, top, 0, { ry: slit - Math.PI / 2 }));
  // The open slit: dark by day, a soft warm glow from inside after dark.
  const inside = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: '#ffc970', emissiveIntensity: 0 });
  const own = ownBatch(ctx);
  own.add(arcBand(dr - 0.02, dr + 0.012, 0.1, 1.42, 0.17), 'inside', NAVY, null, slitFrame);
  own.build({ inside }, ctx.root, false);
  ctx.track(inside);
  ctx.onMood(name => { inside.emissiveIntensity = { focus: 0, break: 0.5, away: 0.38, done: 0.6 }[name] ?? 0; });
  for (const s of [-1, 1]) ctx.add(arcBand(dr - 0.02, dr + 0.03, 0.08, 1.45, 0.03).translate(0, 0, s * 0.1), 'matte', P.trim, null, slitFrame, false);
  const e = 0.72, dir = new THREE.Vector3(Math.cos(e) * Math.sin(slit), Math.sin(e), Math.cos(e) * Math.cos(slit));
  const pivot = new THREE.Vector3(0, top + 0.08, 0);
  const along = d => pivot.clone().addScaledVector(dir, d);
  const tube = (r0, r1, d0, d1, colour) => {
    const c = along((d0 + d1) / 2);
    ctx.add(new THREE.CylinderGeometry(r1, r0, d1 - d0, 16), 'matte', colour, place(c.x, c.y, c.z, { ry: slit, rx: Math.PI / 2 - e }), base, false);
  };
  tube(0.055, 0.05, 0.3, 0.86, BRASS);
  tube(0.064, 0.064, 0.62, 0.66, BRASS_DARK);
  tube(0.066, 0.066, 0.84, 0.9, BRASS_DARK);
  const lens = along(0.902);
  ctx.add(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 16), 'glass', '#cfe9ff', place(lens.x, lens.y, lens.z, { ry: slit, rx: Math.PI / 2 - e }), base, false);
  // A small brass knob on top of the dome.
  ctx.add(new THREE.SphereGeometry(0.045, 12, 8), 'matte', BRASS, place(0, top + dr + 0.01, 0), base, false);
  // An armillary sphere and a lamp post at the front corners, two round shrubs at the back.
  const arm = base.clone().multiply(place(0.66, 0, 0.64));
  ctx.add(rbox(0.1, 0.2, 0.1, 0.01, R), 'matte', P.trim, place(0, 0.1, 0), arm);
  ctx.add(rbox(0.14, 0.03, 0.14, 0.008, R), 'matte', P.trim, place(0, 0.215, 0), arm, false);
  for (const [rx, rz] of [[Math.PI / 2, 0], [0, 0], [Math.PI / 2, 0.42]]) ctx.add(new THREE.TorusGeometry(0.1, 0.009, 5, 28), 'matte', BRASS, place(0, 0.34, 0, { rx, rz, ry: 0.5 }), arm, false);
  ctx.add(new THREE.SphereGeometry(0.03, 10, 6), 'matte', BRASS_DARK, place(0, 0.34, 0), arm, false);
  ctx.blob(arm, 0.3);
  const post = base.clone().multiply(place(-0.68, 0, 0.64));
  ctx.add(rbox(0.035, 0.46, 0.035, 0.008, 1), 'matte', NAVY, place(0, 0.23, 0), post);
  ctx.add(rbox(0.09, 0.1, 0.09, 0.012, R), 'glow', '#ffe9a8', place(0, 0.51, 0), post, false);
  ctx.add(new THREE.ConeGeometry(0.075, 0.06, 4), 'matte', NAVY, place(0, 0.59, 0, { ry: Math.PI / 4 }), post, false);
  ctx.blob(post, 0.25);
  for (const sx of [-1, 1]) ctx.add(chunk(0.14, 7 + sx, [1, 0.85, 1], 1, 0.08), 'facet', P.leaf[sx > 0 ? 0 : 2], place(sx * 0.7, 0.12, -0.68), base, true, [0, 0.25, 0.82, 1.1]);
  ctx.blob(base, 1.8, 1.8);
}

// ---------- Sky waterfall ----------

// A water surface in the x-z plane at height y: an oval pool, plus a channel to (lipX, lipZ) if given.
function poolShape(pool, channel) {
  const pts = [];
  const { x, z, rx, rz } = pool;
  if (channel) {
    const { lipX, lipZ, width } = channel;
    const right = Math.acos(clamp((lipX + width / 2 - x) / rx, -1, 1)), left = Math.acos(clamp((lipX - width / 2 - x) / rx, -1, 1));
    // From the channel's left bank, round the back of the pool to its right bank, then out along the channel.
    for (let i = 0; i <= 28; i++) { const a = left + (Math.PI * 2 - (left - right)) * i / 28; pts.push([x + Math.cos(a) * rx, z + Math.sin(a) * rz]); }
    pts.push([lipX + width / 2, lipZ], [lipX - width / 2, lipZ]);
  } else {
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; pts.push([x + Math.cos(a) * rx, z + Math.sin(a) * rz]); }
  }
  // ShapeGeometry lies in x-y facing +z; laying it down maps shape y to -z.
  const shape = new THREE.Shape(pts.map(([px, pz]) => new THREE.Vector2(px, -pz)));
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

// The falling water: from (x, y, z) over the lip it arcs out (+z) and down as a flattened, rounded
// column (so it reads from the side too), widening and (unless fade is false) fading out toward the bottom.
function fallGeometry(x, y, z, width, drop, fade = true) {
  const rows = 22, around = 14;
  const positions = [], colours = [], index = [];
  const foam = new THREE.Color('#ffffff'), light = new THREE.Color('#c8f1ff'), deep = new THREE.Color('#86d8fb'), c = new THREE.Color();
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, d = drop * s * s; // rows bunch up near the top, where the water curves over
    const out = 0.32 * Math.sqrt(d), w = width * (1 + 0.6 * s), thick = width * (0.5 + 0.3 * s);
    const alpha = fade ? 0.85 * (1 - THREE.MathUtils.smoothstep(s, 0.3, 1)) : 0.85;
    for (let j = 0; j <= around; j++) {
      const a = j / around * Math.PI * 2;
      positions.push(x + Math.cos(a) * w / 2, y - d, z + out + Math.sin(a) * thick / 2);
      // Soft lighter streaks down the water, foam at the top.
      const streak = 0.5 + 0.5 * Math.cos(a * 3 + 0.6);
      c.copy(deep).lerp(light, 0.35 + streak * 0.5).lerp(foam, Math.max(0, 1 - s * 7));
      colours.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + 1, cc = a + around + 1, dd = cc + 1;
    index.push(a, b, cc, b, dd, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function skyfall(ctx, thing, base) {
  const cf = coastFrame(ctx, thing, base);
  // Inland there is no edge to face, so turn the pool to put the spring at the far side, cascade toward the viewer.
  const f = cf.coast ? cf.frame : base.clone().multiply(place(0, 0, 0, { ry: -(thing.facing ?? 0) * Math.PI / 2 }));
  const { half, depth } = cf;
  const waterY = 0.065;
  const lipX = clamp(cf.along, -half + 0.3, half - 0.3);
  const pool = cf.coast ? { x: lipX * 0.45, z: -0.08, rx: 0.4, rz: 0.31 } : { x: 0, z: 0.02, rx: 0.42, rz: 0.36 };
  const width = 0.17, lipZ = depth + 0.12;
  const channel = cf.coast ? { lipX, lipZ, width } : null;

  // Water: its own gently luminous material, so it reads as water in every mood.
  const water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, emissive: '#8fe3ff', emissiveIntensity: 0.15 });
  const own = ownBatch(ctx);
  own.add(poolShape(pool, channel), 'water', '#5fc6f4', place(0, waterY, 0), f);
  for (const [dx, dz, r] of [[-0.12, 0.05, 0.1], [0.14, -0.06, 0.07]]) {
    own.add(new THREE.CircleGeometry(r, 16).rotateX(-Math.PI / 2).scale(1.6, 1, 0.7), 'water', '#a8e9ff', place(pool.x + dx, waterY + 0.002, pool.z + dz), f);
  }
  own.build({ water }, ctx.root, false);
  ctx.track(water);
  // A pale sandy bed under the pool's rim.
  ctx.add(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2).scale(pool.rx + 0.07, 1, pool.rz + 0.07), 'matte', '#f2e2c2', place(pool.x, 0.03, pool.z), f, false);

  // Stones around the pool, leaving a gap where it runs out to the lip.
  const stones = 15;
  for (let i = 0; i < stones; i++) {
    const a = i / stones * Math.PI * 2 + 0.1;
    const sx = pool.x + Math.cos(a) * (pool.rx + 0.05), sz = pool.z + Math.sin(a) * (pool.rz + 0.05);
    if (channel && Math.abs(sx - lipX) < width / 2 + 0.06 && sz > pool.z) continue;
    const r = 0.065 + ((i * 7) % 4) * 0.012;
    ctx.add(chunk(r, 50 + i * 3, [1.2, 0.65, 1.05], 0, 0.14), 'facet', [P.trim, P.stone, P.boulder][i % 3], place(sx, r * 0.35, sz, { ry: a }), f, true, [0, 0.2, 0.9, 1.05]);
  }
  // The spring: a little rock cliff at the back of the pool, with a short cascade from a white ledge.
  const sz = pool.z - pool.rz - 0.04;
  [[-0.16, 0.02, 0.16, P.lilac, [1, 1.05, 1], 0.12], [0.16, 0.03, 0.14, P.boulder, [1, 0.95, 1], 0.1], [0, -0.05, 0.16, P.lilac, [1.25, 1, 1], 0.12], [0.01, -0.07, 0.14, P.lilacDeep, [1.3, 0.8, 1.05], 0.25]]
    .forEach(([x, z, r, colour, squash, y], i) => ctx.add(chunk(r, 70 + i * 4, squash, 0, 0.14), 'facet', colour, place(pool.x + x, y, sz + z, { ry: i * 2.1 }), f, true, [0, 0.4, 0.86, 1.06]));
  ctx.add(rbox(0.17, 0.035, 0.15, 0.012, R), 'matte', P.trim, place(pool.x, 0.33, sz + 0.05), f);
  for (const [x, z, r] of [[0.0, 0.27, 0.035], [-0.05, 0.3, 0.025], [0.05, 0.29, 0.022], [0.02, 0.33, 0.02]]) ctx.add(new THREE.IcosahedronGeometry(r, 0), 'facet', P.white, place(pool.x + x, waterY + 0.008, sz + z), f, false);
  // Ferns and flowers by the water.
  ctx.add(chunk(0.1, 91, [1, 0.8, 1], 1, 0.08), 'facet', P.leaf[0], place(pool.x - pool.rx - 0.03, 0.08, pool.z - 0.12), f, true, [0, 0.2, 0.82, 1.1]);
  for (const [x, z, k] of [[pool.x + pool.rx + 0.04, pool.z - 0.16, 1], [pool.x - pool.rx + 0.02, pool.z + 0.22, 3]]) {
    ctx.add(new THREE.CylinderGeometry(0.007, 0.007, 0.1, 4), 'matte', P.grassSide, place(x, 0.05, z), f, false);
    ctx.add(new THREE.IcosahedronGeometry(0.035, 0), 'facet', P.flower[k], place(x, 0.11, z), f, false);
  }
  ctx.blob(f, pool.rx * 2.4, pool.rz * 2.4, pool.x, pool.z);

  // Falling water shares one softly bright material: the spring's cascade, and the big fall off the edge.
  const fallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.3, metalness: 0, emissive: '#d4f3ff', emissiveIntensity: 0.3 });
  ctx.track(fallMaterial);
  const addFall = shape => {
    shape.applyMatrix4(f);
    const mesh = new THREE.Mesh(shape, fallMaterial);
    mesh.renderOrder = 2;
    ctx.root.add(mesh);
    ctx.track(shape);
  };
  addFall(fallGeometry(pool.x, 0.345, sz + 0.11, 0.09, 0.28, false));

  const mist = [];
  if (cf.coast) {
    // The channel's banks and the lip stone the water pours over.
    const bankZ0 = pool.z + pool.rz * 0.7;
    for (const s of [-1, 1]) for (let z = bankZ0; z < depth - 0.02; z += 0.11) {
      ctx.add(chunk(0.055, 80 + z * 40 + s, [1.1, 0.7, 1.1], 0, 0.12), 'facet', z * 10 % 2 > 1 ? P.trim : P.stone, place(lipX + s * (width / 2 + 0.05), 0.025, z, { ry: z * 9 }), f, true, [0, 0.2, 0.9, 1.05]);
    }
    ctx.add(rbox(width + 0.16, 0.06, 0.3, 0.014, R), 'matte', P.trim, place(lipX, 0.03, depth - 0.02), f);
    ctx.add(chunk(0.12, 97, [1.4, 0.8, 1], 0, 0.14), 'facet', P.lilac, place(lipX, -0.08, depth + 0.02), f, false);
    // The fall itself, fading into mist far below.
    addFall(fallGeometry(lipX, waterY, lipZ - 0.02, width, 1.45));
    for (const [dx, y, dz, size] of [[0, -0.95, 0.4, 0.5], [-0.2, -1.1, 0.46, 0.48], [0.22, -1.18, 0.45, 0.42], [0.04, -1.32, 0.52, 0.6]]) {
      mist.push(softSprite(ctx, '#ffffff', 0.5, size, at(f, lipX + dx, y, lipZ + dz), false));
    }
    ctx.root.add(...mist);
  }

  const MIST = { focus: ['#ffffff', 0.55], break: ['#ffe4ee', 0.45], away: ['#e2e2f2', 0.4], done: ['#aab6f0', 0.32] };
  let glow = 0.3;
  ctx.onMood(name => {
    const [colour, opacity] = MIST[name] ?? MIST.focus;
    for (const sprite of mist) { sprite.material.color.set(colour); sprite.material.opacity = opacity; }
    glow = evening(name) ? 0.42 : 0.3;
    water.emissiveIntensity = evening(name) ? 0.28 : 0.15;
    fallMaterial.emissiveIntensity = glow;
  });
  // A slow, faint shimmer on the falling water.
  ctx.dynamic.push(t => { fallMaterial.emissiveIntensity = glow + Math.sin(t * 1.3) * 0.05; });
}

// ---------- Aurora garden ----------

const GLOW_LEVEL = { focus: 0.16, break: 0.85, away: 0.6, done: 1.05 };

function aurora(ctx, thing, base) {
  const green = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, flatShading: true, emissive: '#3dffa6', emissiveIntensity: GLOW_LEVEL.focus });
  const violet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, flatShading: true, emissive: '#b36dff', emissiveIntensity: GLOW_LEVEL.focus });
  ctx.track(green, violet);
  const own = ownBatch(ctx);
  const GREEN = '#8affc4', VIOLET = '#cfa6ff';
  const glowing = (geometry, isGreen, local) => own.add(geometry, isGreen ? 'auroraGreen' : 'auroraViolet', isGreen ? GREEN : VIOLET, local, base);

  // A round bed with a low white wall, open at the front, and gate posts topped with glowing orbs.
  const ring = [[0.88, 0], [0.88, 0.07], [0.86, 0.09], [0.8, 0.09], [0.78, 0.07], [0.78, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  ctx.add(new THREE.LatheGeometry(ring, 44, 0.36, Math.PI * 2 - 0.72), 'matte', P.trim, place(0, 0, 0), base);
  ctx.add(new THREE.CylinderGeometry(0.79, 0.79, 0.04, 44), 'matte', '#4fb58f', place(0, 0.02, 0), base, false);
  for (const s of [-1, 1]) {
    const a = s * 0.36, x = Math.sin(a) * 0.83, z = Math.cos(a) * 0.83;
    ctx.add(rbox(0.1, 0.2, 0.1, 0.012, R), 'matte', P.trim, place(x, 0.1, z, { ry: a }), base);
    ctx.add(rbox(0.13, 0.03, 0.13, 0.008, R), 'matte', P.trim, place(x, 0.215, z, { ry: a }), base, false);
    glowing(new THREE.IcosahedronGeometry(0.05, 1), s > 0, place(x, 0.28, z));
  }
  // Stepping stones in to the middle.
  for (const [z, k] of [[0.8, 0], [0.6, 1], [0.42, 2]]) ctx.add(lump(0.09, 2, 0.05, 4 + k, [1, 0.3, 0.85]), 'matte', P.path, place((k - 1) * 0.03, 0.05, z, { ry: k }), base, false);

  // The centre: a rock with tall violet and green crystals.
  ctx.add(chunk(0.24, 13, [1.3, 0.55, 1.1], 0, 0.16), 'facet', P.lilacDeep, place(0, 0.08, 0.02), base, true, [0, 0.25, 0.85, 1.05]);
  [[0, 0, 1.0, 0.12, 0, 0, false], [0.13, 0.06, 0.68, 0.09, 0.32, 0.15, true], [-0.13, 0.08, 0.6, 0.085, -0.36, -0.08, true], [0.03, -0.14, 0.48, 0.075, 0.12, -0.4, false], [-0.09, -0.08, 0.34, 0.06, -0.3, -0.35, false]]
    .forEach(([x, z, h, r, rz, rx, isGreen], i) => glowing(crystalGeometry(h, r), isGreen, place(x, 0.06, z, { rz, rx, ry: i * 1.3 })));

  // Tall glowing plants in two rings, leaving the path clear: orbs on stems, bells and leafy spires.
  const plants = [];
  for (let i = 0; i < 7; i++) plants.push([0.5 + i / 7 * (Math.PI * 2 - 1.0), 0.44, i]);
  for (let i = 0; i < 9; i++) plants.push([0.42 + i / 9 * (Math.PI * 2 - 0.84) + 0.2, 0.66, i + 7]);
  for (const [a, r, i] of plants) {
    const x = Math.sin(a) * r, z = Math.cos(a) * r, isGreen = i % 2 === 0;
    const h = 0.38 + ((i * 5) % 7) / 7 * 0.34 + (r < 0.5 ? 0.12 : 0);
    const kind = i % 3;
    const lean = [Math.sin(a) * 0.05, Math.cos(a) * 0.05];
    if (kind === 0) {
      // A glowing orb on a slender stem, with two leaves.
      ctx.add(taperedTube([[x, 0.03, z], [x + lean[0] * 0.5, h * 0.55, z + lean[1] * 0.5], [x + lean[0], h, z + lean[1]]], 0.018, 0.01, 5), 'matte', '#3f9e72', null, base, true);
      for (const s of [-1, 1]) ctx.add(new THREE.ConeGeometry(0.035, 0.16, 4).scale(1, 1, 0.35), 'facet', P.leaf[2], place(x + s * 0.035, 0.12, z, { rz: -s * 0.7, ry: a }), base, false);
      glowing(new THREE.IcosahedronGeometry(0.06, 1), isGreen, place(x + lean[0], h + 0.04, z + lean[1]));
    } else if (kind === 1) {
      // A bell flower nodding from a curved stem.
      const tip = [x + lean[0] * 2.2, h * 0.9, z + lean[1] * 2.2];
      ctx.add(taperedTube([[x, 0.03, z], [x + lean[0] * 0.4, h * 0.7, z + lean[1] * 0.4], [x + lean[0] * 1.4, h, z + lean[1] * 1.4], tip], 0.016, 0.009, 5), 'matte', '#3f9e72', null, base, true);
      glowing(new THREE.ConeGeometry(0.055, 0.1, 6, 1, false), isGreen, place(tip[0], tip[1] - 0.03, tip[2], { rx: Math.PI }));
    } else {
      // A leafy spire with a small glowing crystal at its tip.
      for (const [y, rr, hh] of [[0.14, 0.09, 0.26], [0.3, 0.07, 0.24], [0.44, 0.05, 0.2]]) {
        ctx.add(new THREE.ConeGeometry(rr, hh * (h / 0.6), 6), 'facet', y > 0.3 ? P.leaf[1] : '#3fae7a', place(x, y * (h / 0.6) + 0.04, z, { ry: a + y * 5 }), base, y < 0.2, [0, h, 0.8, 1.1]);
      }
      glowing(crystalGeometry(0.16, 0.035), isGreen, place(x, h * 0.98 + 0.04, z, { ry: a }));
    }
  }
  // Little crystal clusters at the bed's edge.
  for (const [a, k] of [[1.3, 0], [2.6, 1], [-1.5, 2], [-2.7, 3]]) {
    const x = Math.sin(a) * 0.72, z = Math.cos(a) * 0.72;
    for (let j = 0; j < 3; j++) glowing(crystalGeometry(0.12 + j * 0.05, 0.03 + j * 0.006), (k + j) % 2 === 0, place(x + (j - 1) * 0.04, 0.03, z + (j % 2) * 0.03, { rz: (j - 1) * 0.35, ry: a + j }));
  }
  const { top } = own.build({ auroraGreen: green, auroraViolet: violet }, ctx.root);
  raiseTop(ctx, top);
  ctx.blob(base, 1.85, 1.85);

  // After dark: a soft green and violet light pooled in the bed, and halos round the tallest crystals.
  const origin = at(base, 0, 0, 0);
  const poolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#6df0c0', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const poolShape = new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2);
  const light = new THREE.Mesh(poolShape, poolMaterial);
  light.position.set(origin.x, origin.y + 0.05, origin.z);
  light.renderOrder = 2;
  const halos = [softSprite(ctx, '#b98cff', 0.4, 0.9, at(base, 0, 0.7, 0)), softSprite(ctx, '#6dffbf', 0.3, 0.6, at(base, 0.18, 0.5, 0.06)), softSprite(ctx, '#6dffbf', 0.22, 0.5, at(base, -0.5, 0.45, -0.3))];
  ctx.root.add(light, ...halos);
  ctx.track(poolMaterial, poolShape);
  ctx.onMood(name => {
    const level = GLOW_LEVEL[name] ?? GLOW_LEVEL.focus;
    green.emissiveIntensity = violet.emissiveIntensity = level;
    light.visible = evening(name);
    for (const halo of halos) halo.visible = evening(name);
    poolMaterial.opacity = name === 'away' ? 0.16 : 0.22;
  });
}

export const WONDERS = { lighthouse, airship, observatory, skyfall, aurora };
