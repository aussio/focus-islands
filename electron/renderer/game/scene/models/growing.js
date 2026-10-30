// Growing places: the kinds that come from break-time growth. Garden, rain catcher, orchard, lily
// pond, great tree, mushroom grotto, beehive meadow, flower bed, lantern path and the golden sapling.
// Same signature as every model: (ctx, thing, base), where base is the ground point at the middle of
// the footprint, already turned to face the thing's way. Local +z is the front (towards the path).
// See models/index.js for what ctx offers. The buildings themselves never move (the lanterns only light
// up at dusk), but small life lives on some of them: see "Small life" below.
import * as THREE from 'three';
import { P, CELL, MOODS } from '../style.js';
import { Batch, hash01, hashString, place, taperedTube } from '../ground.js';
import { chunk, glowTexture, lump, rbox } from '../parts.js';

const R = 2; // rounded-box segments
const E = 0.012; // edge rounding: a sliver, not pillowy
const seedOf = thing => hashString(thing.id) * 1000;
const footprint = thing => [(thing.fw || 1) * CELL, (thing.fd || 1) * CELL];
// The local side that faces the camera (world south), for a model turned by yaw (any angle on the town
// grid, quarter turns on the square one). Helpers stand on that side to work.
const cameraSide = thing => {
  const yaw = Number.isFinite(thing.yaw) ? thing.yaw : (thing.facing ?? 0) * Math.PI / 2;
  return [[0, 1], [-1, 0], [0, -1], [1, 0]][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4];
};

// Colours only these models use. Everything else comes from the shared palette P.
const G = {
  ridge: '#e39a62', furrow: '#c47d4e', bedSoil: '#b9744a',
  can: '#5fb8ff', mulch: '#d99a66',
  stave: '#c48a5f', staveTop: '#a8714a', hoop: '#3a98ec', rain: '#5cb8ff', stream: '#bfe9ff',
  water: '#3fa9ee', shallow: '#9fe2ff', pad: ['#4fbd5b', '#73d56a', '#5cc85d'], reed: '#5aa84e', cattail: '#a8673f',
  moss: ['#6fcf6a', '#5cc85d', '#82d870'], cave: '#4a3f7a', caveDeep: '#352f63',
  hives: ['#ffd23f', '#7cc8ff', '#ff9cc0', '#7fe0b0'], slot: '#6b4a3a',
  fruit: ['#ff4f5e', '#ff9d3f', '#ffd23f'],
  bloom: ['#ff8fb4', '#ffd25e', '#b88cff', '#ff6b6b', '#ffffff', '#ff9d3f'],
  pole: '#5d6a9a', lamp: '#ffe7a0',
  gold: ['#ffd23f', '#ffc21e', '#ffe066'], goldTrunk: '#d9a066', spark: '#fff6cf',
  // Small life and the looks that go with it.
  wings: ['#ffd23f', '#ff9cc0', '#ffffff', '#7cc8ff', '#ff9d3f', '#b88cff'], feelers: '#4a3a5a',
  moth: ['#f3ead8', '#e8dcc0', '#ddd6ea'], mothBody: '#9a8a78',
  bee: '#ffc61e', beeBand: '#3a2a20', beeWing: '#f2fbff',
  duck: '#ffffff', duckling: '#ffe066', bill: '#ff9d3f', frog: '#7ed957', frogEye: '#ffffff',
  drop: '#9fe2ff', drizzle: '#cfefff', cloud: ['#ffffff', '#f4f6ff', '#e9eefc'],
  fallen: ['#5cc85d', '#73d56a', '#4fbd5b', '#ffd25e'],
  shirt: ['#ff6b6b', '#7cc8ff', '#7fe0b0'], sack: '#f1e2c4', hat: '#8a6a4a', straw: '#ffd25e',
};

// A small matrix for a piece sitting on a curved surface: at p, its local y turned to the normal n.
function onSurface(p, n, scale = [1, 1, 1], spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(...scale));
}

// A sprout: a short stem and two little leaves in a V.
function sprout(ctx, base, x, y, z, s, ry) {
  const b = base.clone().multiply(place(x, y, z, { ry }));
  ctx.add(new THREE.CylinderGeometry(0.007 * s, 0.009 * s, 0.05 * s, 4), 'matte', P.grassSide, place(0, 0.025 * s, 0), b, false);
  for (const side of [-1, 1]) {
    ctx.add(new THREE.IcosahedronGeometry(0.03 * s, 0).scale(1.5, 0.45, 0.85), 'facet', P.leaf[side > 0 ? 1 : 2],
      place(side * 0.03 * s, 0.055 * s, 0, { rz: side * 0.45 }), b, false);
  }
}

// A daisy-like bloom on a stem: a flat disc of colour with a yellow heart.
function daisy(ctx, base, x, z, h, colour, spin = 0) {
  ctx.add(new THREE.CylinderGeometry(0.008, 0.01, h, 4), 'matte', P.grassSide, place(x, h / 2, z), base, false);
  ctx.add(new THREE.CylinderGeometry(0.046, 0.038, 0.018, 7), 'facet', colour, place(x, h + 0.008, z, { rx: 0.2, ry: spin }), base, false);
  ctx.add(new THREE.IcosahedronGeometry(0.018, 0), 'facet', colour === '#ffd25e' ? '#ff9d3f' : '#ffcf3a', place(x, h + 0.022, z), base, false);
}

// A short white fence: posts with caps, and two rails along each run.
function fencePost(ctx, base, x, z, h) {
  ctx.add(rbox(0.045, h, 0.045, 0.008, 1), 'matte', P.trim, place(x, h / 2, z), base);
  ctx.add(rbox(0.058, 0.018, 0.058, 0.005, 1), 'matte', P.trim, place(x, h + 0.009, z), base, false);
}
function fenceRails(ctx, base, x0, z0, x1, z1, h) {
  const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
  for (const y of [h * 0.4, h * 0.78]) ctx.add(rbox(0.022, 0.028, len, 0.006, 1), 'matte', P.trim, place((x0 + x1) / 2, y, (z0 + z1) / 2, { ry }), base, false);
}

// A watering can with its spout to local +x.
function wateringCan(ctx, base, x, z, ry) {
  const b = base.clone().multiply(place(x, 0, z, { ry }));
  ctx.add(new THREE.CylinderGeometry(0.05, 0.056, 0.095, 12), 'matte', G.can, place(0, 0.0475, 0), b);
  ctx.add(new THREE.CylinderGeometry(0.01, 0.014, 0.13, 6), 'matte', G.can, place(0.082, 0.075, 0, { rz: -0.9 }), b, false);
  ctx.add(new THREE.CylinderGeometry(0.024, 0.013, 0.022, 8), 'matte', G.can, place(0.135, 0.116, 0, { rz: -0.9 }), b, false);
  ctx.add(new THREE.TorusGeometry(0.036, 0.009, 5, 10, Math.PI), 'matte', G.can, place(-0.008, 0.094, 0), b, false);
}

// A water barrel standing on the ground: bulging wooden staves (faceted, so each face reads as a
// stave), two blue hoops, and a disc of water just under the rim.
function barrel(ctx, base, x, z, r, h) {
  const profile = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    profile.push(new THREE.Vector2(r * (1 + 0.12 * Math.sin(t * Math.PI)), t * h));
  }
  ctx.add(new THREE.LatheGeometry(profile, 12), 'facet', G.stave, place(x, 0, z), base);
  for (const t of [0.2, 0.8]) {
    const hr = r * (1 + 0.12 * Math.sin(t * Math.PI)) + 0.004;
    ctx.add(new THREE.TorusGeometry(hr, 0.012, 4, 16).rotateX(Math.PI / 2), 'matte', G.hoop, place(x, t * h, z), base, false);
  }
  ctx.add(new THREE.TorusGeometry(r, 0.011, 4, 16).rotateX(Math.PI / 2), 'matte', G.staveTop, place(x, h, z), base, false);
  ctx.add(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.012, 16), 'matte', G.rain, place(x, h - 0.012, z), base, false);
}

// A small wooden bucket with a blue hoop and a wire handle, full of water.
function bucket(ctx, base, x, z, s = 1, ry = 0) {
  const b = base.clone().multiply(place(x, 0, z, { ry, s }));
  ctx.add(new THREE.CylinderGeometry(0.052, 0.04, 0.075, 10), 'facet', G.stave, place(0, 0.0375, 0), b);
  ctx.add(new THREE.TorusGeometry(0.049, 0.007, 4, 12).rotateX(Math.PI / 2), 'matte', G.hoop, place(0, 0.055, 0), b, false);
  ctx.add(new THREE.CylinderGeometry(0.046, 0.046, 0.008, 12), 'matte', G.rain, place(0, 0.068, 0), b, false);
  ctx.add(new THREE.TorusGeometry(0.048, 0.005, 4, 10, Math.PI), 'matte', P.steel, place(0, 0.075, 0, { rz: -0.35 }), b, false);
}

// A low wooden trough of water, long along local x.
function trough(ctx, base, x, z, len, ry) {
  const b = base.clone().multiply(place(x, 0, z, { ry }));
  const w = 0.17, h = 0.1, t = 0.025;
  ctx.add(rbox(len, 0.025, w, 0.005, 1), 'matte', G.staveTop, place(0, 0.0125, 0), b);
  for (const sz of [-1, 1]) ctx.add(rbox(len, h, t, 0.006, 1), 'matte', sz > 0 ? G.stave : P.post, place(0, h / 2, sz * (w - t) / 2), b);
  for (const sx of [-1, 1]) ctx.add(rbox(t, h, w, 0.006, 1), 'matte', G.stave, place(sx * (len - t) / 2, h / 2, 0), b, false);
  ctx.add(rbox(len - 2 * t, 0.01, w - 2 * t, 0.003, 1), 'matte', G.rain, place(0, h - 0.022, 0), b, false);
  for (const sx of [-0.3, 0.3]) ctx.add(rbox(0.03, 0.02, w + 0.03, 0.005, 1), 'matte', G.hoop, place(sx * len, h * 0.55, 0), b, false);
}

// A big mushroom: pale stem, a red faceted cap with white spots and a pale rim underneath.
function bigMushroom(ctx, base, x, y, z, s, tilt, seed, cap = P.mushroomCap) {
  const stemH = 0.36 * s, capR = 0.2 * s;
  ctx.add(new THREE.CylinderGeometry(0.048 * s, 0.07 * s, stemH, 8), 'matte', P.mushroomStem, place(x, y + stemH / 2, z, { rz: tilt }), base);
  const topX = x - Math.sin(tilt) * stemH / 2, topY = y + stemH / 2 + Math.cos(tilt) * stemH / 2;
  const capBase = base.clone().multiply(place(topX, topY - 0.02 * s, z, { rz: tilt, ry: seed }));
  ctx.add(new THREE.SphereGeometry(capR, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.66, 1), 'facet', cap, null, capBase, false);
  ctx.add(new THREE.CylinderGeometry(capR * 0.98, capR * 0.8, 0.024 * s, 12), 'matte', P.mushroomStem, place(0, 0.006, 0), capBase, false);
  const spots = [[0, 1.45], [1.3, 0.75], [2.5, 0.55], [3.7, 0.8], [4.9, 0.6], [0.6, 0.35], [3.1, 0.3], [5.6, 0.3]];
  for (const [a, e] of spots) {
    const p = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    const n = new THREE.Vector3(p.x, p.y / (0.66 * 0.66), p.z);
    p.set(p.x * capR, p.y * capR * 0.66, p.z * capR);
    ctx.add(new THREE.SphereGeometry(0.03 * s, 7, 4), 'matte', P.white, onSurface(p, n, [1, 0.32, 1]), capBase, false);
  }
}

// A box beehive on a little stand: three stacked boxes with white seams, an entrance slot with a
// landing board, and a flat white lid (a pitched roof made them read as tiny houses).
function hive(ctx, base, x, z, ry, colour) {
  const b = base.clone().multiply(place(x, 0, z, { ry }));
  for (const sx of [-1, 1]) ctx.add(rbox(0.045, 0.06, 0.22, 0.008, 1), 'matte', P.plankDark, place(sx * 0.095, 0.03, 0), b);
  const w = 0.28, d = 0.25, y0 = 0.06;
  ctx.add(rbox(w + 0.03, 0.02, d + 0.03, 0.005, 1), 'matte', P.trim, place(0, y0 + 0.01, 0), b);
  let y = y0 + 0.02;
  [0.13, 0.13, 0.075].forEach((bh, i) => {
    ctx.add(rbox(w, bh, d, E, R), 'matte', colour, place(0, y + bh / 2, 0), b, i === 0);
    y += bh;
    if (i < 2) { ctx.add(rbox(w + 0.014, 0.016, d + 0.014, 0.004, 1), 'matte', P.trim, place(0, y, 0), b, false); }
  });
  // Entrance slot and landing board on the front of the lower box.
  ctx.add(rbox(0.14, 0.026, 0.02, 0.005, 1), 'matte', G.slot, place(0, y0 + 0.045, d / 2 + 0.002), b, false);
  ctx.add(rbox(0.18, 0.014, 0.055, 0.004, 1), 'matte', P.trim, place(0, y0 + 0.027, d / 2 + 0.024), b, false);
  // A flat white lid with a slight overhang and a low raised middle, like a real hive cover.
  ctx.add(rbox(w + 0.04, 0.032, d + 0.04, 0.008, R), 'matte', P.trim, place(0, y + 0.014, 0), b, false);
  ctx.add(rbox(w - 0.06, 0.02, d - 0.06, 0.006, R), 'matte', P.trim, place(0, y + 0.036, 0), b, false);
}

// A small lantern post: stone footing, slim pole, a glowing box lamp with white frame and a little cap.
function lanternPost(ctx, base, x, z, cap) {
  ctx.add(rbox(0.1, 0.05, 0.1, 0.014, R), 'matte', P.stone, place(x, 0.025, z), base);
  ctx.add(rbox(0.032, 0.34, 0.032, 0.006, 1), 'matte', G.pole, place(x, 0.05 + 0.17, z), base);
  const y0 = 0.39;
  ctx.add(rbox(0.12, 0.022, 0.12, 0.005, 1), 'matte', P.trim, place(x, y0, z), base, false);
  ctx.add(rbox(0.084, 0.1, 0.084, 0.008, 1), 'glow', G.lamp, place(x, y0 + 0.06, z), base, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.add(rbox(0.016, 0.104, 0.016, 0.003, 1), 'matte', P.trim, place(x + sx * 0.044, y0 + 0.06, z + sz * 0.044), base, false);
  ctx.add(rbox(0.126, 0.02, 0.126, 0.005, 1), 'matte', P.trim, place(x, y0 + 0.12, z), base, false);
  ctx.add(new THREE.ConeGeometry(0.088, 0.075, 4).rotateY(Math.PI / 4), 'facet', cap, place(x, y0 + 0.167, z), base, false);
  ctx.add(new THREE.IcosahedronGeometry(0.02, 0), 'facet', cap, place(x, y0 + 0.215, z), base, false);
  return y0 + 0.06;
}

// Warm light for lamps at dusk: a soft pool on the ground and a small halo round each lamp.
// Static; it only switches on with the mood, a little stronger the darker the evening.
function lampGlow(ctx, base, lamps, { pool = 0.7, halo = 0.34, colour = '#ffc56a' } = {}) {
  const poolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: colour, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const haloMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: colour, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const items = [];
  for (const [x, y, z] of lamps) {
    const at = new THREE.Vector3(x, 0.02, z).applyMatrix4(base);
    const glow = new THREE.Mesh(plane, poolMaterial);
    glow.position.copy(at);
    glow.scale.setScalar(pool);
    glow.renderOrder = 2;
    const sprite = new THREE.Sprite(haloMaterial);
    sprite.position.copy(new THREE.Vector3(x, y, z).applyMatrix4(base));
    sprite.scale.setScalar(halo);
    sprite.renderOrder = 2;
    items.push(glow, sprite);
  }
  for (const item of items) item.visible = false;
  ctx.root.add(...items);
  ctx.track(poolMaterial, haloMaterial, plane);
  ctx.onMood((name, mood) => {
    const on = mood?.windows || 0;
    for (const item of items) item.visible = on > 0;
    poolMaterial.opacity = 0.12 + on * 0.1;
    haloMaterial.opacity = 0.24 + on * 0.16;
  });
}

// A flat disc of water whose edge follows outline(angle) -> [x, z]: deeper blue in the middle,
// lighter at the edge (vertex colours, so the shading is baked in).
function waterGeometry(outline, inner, outer, rings = 5, segments = 40) {
  const pos = [0, 0, 0], col = [], idx = [];
  const ci = new THREE.Color(inner), co = new THREE.Color(outer), c = new THREE.Color();
  col.push(ci.r, ci.g, ci.b);
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    c.copy(ci).lerp(co, t * t * t);
    for (let j = 0; j < segments; j++) {
      const [x, z] = outline(j / segments * Math.PI * 2);
      pos.push(x * t, 0, z * t);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < segments; j++) idx.push(0, 1 + (j + 1) % segments, 1 + j);
  for (let i = 1; i < rings; i++) {
    const a = 1 + (i - 1) * segments, b = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      idx.push(a + j, b + j1, b + j, a + j, a + j1, b + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A lily flower: six pink petals turned up round a yellow heart.
function lily(ctx, base, x, y, z, colour, spin) {
  for (let i = 0; i < 6; i++) {
    const a = spin + i / 6 * Math.PI * 2;
    ctx.add(new THREE.IcosahedronGeometry(0.026, 0).scale(0.6, 0.4, 1.3), 'facet', i % 2 ? colour : P.white,
      place(x + Math.cos(a) * 0.026, y + 0.016, z + Math.sin(a) * 0.026, { ry: Math.PI / 2 - a, rx: -0.55 }), base, false);
  }
  ctx.add(new THREE.IcosahedronGeometry(0.018, 0), 'facet', '#ffcf3a', place(x, y + 0.02, z), base, false);
}

// A small round fruit tree: whitewashed trunk foot, a round faceted crown dotted with fruit.
function fruitTree(ctx, base, x, z, s, seed, fruit) {
  ctx.add(new THREE.CylinderGeometry(0.13 * s, 0.14 * s, 0.018, 12), 'matte', G.mulch, place(x, 0.009, z), base, false);
  ctx.add(new THREE.CylinderGeometry(0.036 * s, 0.044 * s, 0.12 * s, 7), 'facet', P.trim, place(x, 0.06 * s, z), base);
  ctx.add(new THREE.CylinderGeometry(0.03 * s, 0.036 * s, 0.2 * s, 7), 'facet', P.trunk, place(x, 0.21 * s, z), base);
  const cy = 0.42 * s, r = 0.185 * s;
  ctx.add(chunk(r, seed, [1, 0.9, 1], 1, 0.06), 'facet', P.leaf[Math.floor(seed) % 3], place(x, cy, z, { ry: seed }), base, false, [cy - r, cy + r, 0.8, 1.12]);
  const count = 9;
  for (let i = 0; i < count; i++) {
    const a = seed + i * 2.39996, e = -0.25 + (i / (count - 1)) * 1.25;
    const n = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e) * 0.9, Math.cos(e) * Math.sin(a));
    const p = n.clone().multiplyScalar(r * 0.97).add(new THREE.Vector3(x, cy, z));
    ctx.add(new THREE.IcosahedronGeometry(0.036 * s, 0), 'facet', fruit, place(p.x, p.y, p.z, { ry: i }), base, false);
  }
}

// A scarecrow (a look on about 1 in 3 gardens): a pole with a crossbar, a sack head under a floppy brown
// hat, and a shirt with a patch and straw at the cuffs. Arms held straight out and no legs, so it never
// reads as a helper. Faces local +z.
function scarecrow(ctx, base, x, z, ry, shirt) {
  const b = base.clone().multiply(place(x, 0, z, { ry }));
  ctx.add(new THREE.CylinderGeometry(0.011, 0.014, 0.3, 5), 'facet', P.post, place(0, 0.15, 0), b);
  ctx.add(rbox(0.2, 0.016, 0.016, 0.004, 1), 'matte', P.post, place(0, 0.226, -0.012), b, false);
  ctx.add(rbox(0.085, 0.1, 0.05, 0.012, 1), 'matte', shirt, place(0, 0.2, 0, { rz: 0.04 }), b, false);
  ctx.add(rbox(0.17, 0.036, 0.042, 0.01, 1), 'matte', shirt, place(0, 0.228, 0), b, false);
  ctx.add(rbox(0.03, 0.03, 0.008, 0.004, 1), 'matte', G.straw, place(0.018, 0.188, 0.025, { rz: 0.2 }), b, false);
  for (const sx of [-1, 1]) {
    ctx.add(new THREE.ConeGeometry(0.018, 0.04, 5).rotateZ(-sx * Math.PI / 2), 'facet', G.straw, place(sx * 0.1, 0.228, 0), b, false);
  }
  ctx.add(new THREE.ConeGeometry(0.034, 0.035, 6).rotateX(Math.PI), 'facet', G.straw, place(0, 0.14, 0), b, false);
  ctx.add(new THREE.IcosahedronGeometry(0.04, 1), 'facet', G.sack, place(0, 0.285, 0), b, false);
  for (const sx of [-1, 1]) ctx.add(new THREE.IcosahedronGeometry(0.0075, 0), 'matte', G.feelers, place(sx * 0.015, 0.293, 0.036), b, false);
  ctx.add(new THREE.CylinderGeometry(0.068, 0.068, 0.01, 10), 'matte', G.hat, place(0, 0.318, 0, { rz: 0.12 }), b, false);
  ctx.add(new THREE.CylinderGeometry(0.03, 0.038, 0.05, 8), 'matte', G.hat, place(0.004, 0.345, 0, { rz: 0.18 }), b, false);
}

// ---------- Small life ----------
// Butterflies, bees, moths, ducks, a frog, ripples, falling leaves, a drip and a drizzle cloud: small
// moving details on the growing places. How they stay calm and cheap:
// - Poses come only from the scene time t (through ctx.dynamic) and hashes of the thing's id, so the same
//   t always gives the same picture. Nothing is picked at random.
// - At t = 0 everything is at rest: flyers sit on a spot, ducks float, nothing is in the air or
//   mid-ripple. A scene held still (reduced motion) passes t = 0, so it shows them resting.
// - Which ones show follows the mood (ctx.onMood): butterflies and bees by day, moths while the lamps are
//   lit, the drizzle cloud only at break. At night (done) the ducks and the frog keep still.
// - Every creature on an island is made of copies of one small faceted blob, all in one InstancedMesh
//   (one draw call, the shared facet material); every ripple is a copy of one ring in one more; the
//   drizzle cloud's soft puffs and drops are copies of one round blob in a third, lit like the sky's
//   clouds (shown only at break). None casts a shadow. Each starts hidden and shows from the first mood
//   hook that has something of it on, so none sways framing.
// - Counts are capped per thing (most) and per island (island) in LIFE; parts is copies per creature.
export const LIFE = {
  butterfly: { parts: 3, most: 3, island: 6 },
  bee: { parts: 3, most: 5, island: 10 },
  moth: { parts: 3, most: 2, island: 6 },
  duck: { parts: 4, most: 2, island: 6 },
  frog: { parts: 3, most: 1, island: 3 },
  leaf: { parts: 1, most: 3, island: 6 },
  drip: { parts: 1, most: 1, island: 2 },
  cloud: { parts: 12, most: 1, island: 2, mesh: 'clouds' },
  ripple: { parts: 1, most: 3, island: 14, mesh: 'ripples' },
};
// Who shows in which mood. Ducks, the frog, ripples, leaves and the drip are always there.
const LIFE_WHEN = {
  butterfly: mood => mood === 'focus',
  bee: mood => mood === 'focus',
  moth: (mood, settings) => (settings?.windows ?? 0) > 0,
  cloud: mood => mood === 'break',
};

const TAU = Math.PI * 2;
const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
// Scratch values, reused every frame so nothing is made per frame.
const _out = new THREE.Matrix4(), _part = new THREE.Matrix4(), _wing = new THREE.Matrix4(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3(), _sv = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color();
const blobPart = (x, y, z, sx, sy, sz, rx = 0) => place(x, y, z, { rx, sx, sy, sz });

const lives = new WeakMap(); // model context -> Map(mesh name -> swarm)

// The island's small life: Map(mesh name -> { mesh, movers, taken }). For tests and the gallery.
export const lifeOf = ctx => lives.get(ctx) ?? new Map();

function swarmOf(ctx, name) {
  let all = lives.get(ctx);
  if (!all) lives.set(ctx, (all = new Map()));
  if (!all.has(name)) all.set(name, makeSwarm(ctx, name));
  return all.get(name);
}

// One InstancedMesh for every copy of one shape on an island, with one update and one mood hook.
function makeSwarm(ctx, name) {
  const ripples = name === 'ripples', clouds = name === 'clouds', own = ripples || clouds;
  const capacity = Object.values(LIFE).filter(rule => (rule.mesh ?? 'critters') === name).reduce((n, rule) => n + rule.parts * rule.island, 0);
  let geometry, material;
  if (ripples) {
    geometry = new THREE.RingGeometry(0.8, 1, 24, 1).rotateX(-Math.PI / 2);
    material = new THREE.MeshBasicMaterial({ color: '#dff6ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  } else if (clouds) {
    // Smooth and softly self-lit like the sky's clouds (stage.js), so the puffs never read as rocks.
    geometry = new THREE.IcosahedronGeometry(1, 1);
    geometry.deleteAttribute('uv');
    material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0.5 });
  } else {
    // A plain white blob: each copy gets its colour from its instance colour.
    geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.deleteAttribute('uv');
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
    material = ctx.materials.facet;
  }
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = `life-${name}`;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = !own;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
  ctx.root.add(mesh);
  ctx.track(geometry, mesh, ...(own ? [material] : []));
  const swarm = { name, mesh, movers: [], taken: {}, mood: 'focus', settings: MOODS.focus, tinted: false, last: NaN };
  ctx.dynamic.push(t => {
    // A scene held still passes the same time every frame: then there is nothing new to send.
    if (t === swarm.last) return;
    swarm.last = t;
    for (const m of swarm.movers) {
      if (m.on) m.pose(t, swarm.mood);
      else for (let i = 0; i < m.n; i++) m.hide(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (swarm.tinted) { mesh.instanceColor.needsUpdate = true; swarm.tinted = false; }
  });
  ctx.onMood((mood, settings) => {
    swarm.mood = mood;
    swarm.settings = settings ?? MOODS[mood] ?? MOODS.focus;
    swarm.last = NaN;
    let any = false;
    for (const m of swarm.movers) any = (m.on = m.when(mood, swarm.settings)) || any;
    mesh.visible = any;
    if (ripples) material.opacity = mood === 'done' ? 0.3 : 0.5;
    const sky = swarm.settings?.cloud;
    if (clouds && sky) { material.color.set(sky.color); material.emissive.set(sky.emissive); material.emissiveIntensity = sky.glow; }
  });
  return swarm;
}

// Adds one creature (a mover: { pose(t, mood), colours? }) of a kind to the island's swarm, posed by base
// (the thing's matrix) times its own local matrices. False when the island has its share of that kind.
// Flyers and the frog set mover.flying while in the air (tests check it is false at t = 0).
function addLife(ctx, thing, base, kind, mover) {
  const rule = LIFE[kind], swarm = swarmOf(ctx, rule.mesh ?? 'critters');
  if ((swarm.taken[kind] ?? 0) >= rule.island) return false;
  swarm.taken[kind] = (swarm.taken[kind] ?? 0) + 1;
  const { mesh } = swarm, first = mesh.count;
  mesh.count += rule.parts;
  Object.assign(mover, {
    kind, owner: thing.id, first, n: rule.parts,
    when: LIFE_WHEN[kind] ?? (() => true),
    put: (i, local) => mesh.setMatrixAt(first + i, _out.multiplyMatrices(base, local)),
    hide: i => mesh.setMatrixAt(first + i, HIDDEN),
    tint: (i, colour, k = 1) => { mesh.setColorAt(first + i, _c.set(colour).multiplyScalar(k)); swarm.tinted = true; },
  });
  for (let i = 0; i < rule.parts; i++) { mover.hide(i); mover.tint(i, mover.colours?.[i] ?? '#ffffff'); }
  mover.on = mover.when(swarm.mood, swarm.settings);
  swarm.movers.push(mover);
  return true;
}

// A small flyer's day: rest on a spot, fly to the next, rest again. Time runs in slots of one length;
// each slot rests first and flies at its end, and the phase keeps t = 0 inside a rest. spots are
// [{ p: Vector3, q?: Quaternion }] in the thing's local units; without q it rests level, facing a hashed way.
//   slot: seconds per slot; fly: [shortest, longest] flight; lift: how high it rises on the way.
//   weave: side-to-side swing (butterflies); zig: quick side-to-side (bees); flutter: small bobs.
//   around: { c: Vector3, out } to circle a point (moths round a lamp) instead of going straight.
// Returns state(t, pos, quat) -> how far into a flight (0..1), or -1 when resting.
function flight(seed, spots, { slot, fly: [f0, f1], lift, weave = 0, zig = 0, flutter = 0, around = null }) {
  const phase = hash01(seed, 1, 17) * (slot - f1) * 0.9;
  const spotAt = k => spots[Math.floor(hash01(k, 3, seed) * spots.length) % spots.length];
  const flyOf = k => f0 + hash01(k, 5, seed) * (f1 - f0);
  const restQuat = (k, spot, q) => (spot.q ? q.copy(spot.q) : q.setFromAxisAngle(Y_AXIS, hash01(k, 7, seed) * TAU));
  const path = (k, s, out) => {
    const A = spotAt(k).p, B = spotAt(k + 1).p, e = smooth(s), env = Math.sin(Math.PI * s);
    const turn = hash01(k, 13, seed) < 0.5 ? 1 : -1;
    if (around) {
      const { c } = around;
      const a0 = Math.atan2(A.x - c.x, A.z - c.z);
      let d = Math.atan2(B.x - c.x, B.z - c.z) - a0;
      d = (((d * turn) % TAU) + TAU) % TAU; // the way round it turns, then at least half a turn
      d = (d < Math.PI ? d + TAU : d) * turn;
      const r0 = Math.hypot(A.x - c.x, A.z - c.z), r1 = Math.hypot(B.x - c.x, B.z - c.z);
      const a = a0 + d * e, r = r0 + (r1 - r0) * e + around.out * env;
      return out.set(c.x + Math.sin(a) * r, A.y + (B.y - A.y) * e + lift * env * (0.7 + 0.3 * Math.sin(TAU * 2 * s)), c.z + Math.cos(a) * r);
    }
    out.lerpVectors(A, B, e);
    let dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    if (len < 1e-3) { const a = hash01(k, 11, seed) * TAU; dx = Math.sin(a); dz = Math.cos(a); len = 1; }
    const side = weave * env * Math.sin(TAU * s * (hash01(k, 15, seed) < 0.5 ? 1 : 2)) * turn + zig * env * Math.sin(TAU * 3 * s);
    out.x += dz / len * side;
    out.z -= dx / len * side;
    out.y += lift * env + flutter * env * Math.sin(TAU * 4 * s);
    return out;
  };
  return (t, pos, quat) => {
    const u = t + phase, k = Math.floor(u / slot), w = u - k * slot, rest = slot - flyOf(k);
    const from = spotAt(k);
    if (w < rest) { pos.copy(from.p); restQuat(k, from, quat); return -1; }
    const s = (w - rest) / (slot - rest);
    path(k, s, pos);
    path(k, Math.min(1, s + 0.02), _b);
    path(k, Math.max(0, s - 0.02), _a);
    const dx = _b.x - _a.x, dy = _b.y - _a.y, dz = _b.z - _a.z;
    _e.set(Math.max(-0.45, Math.min(0.45, -0.5 * Math.atan2(dy, Math.hypot(dx, dz)))), Math.atan2(dx, dz), 0);
    _qb.setFromEuler(_e);
    // Turn smoothly from the rest pose on take-off and into the next one on landing.
    if (s < 0.2) quat.copy(restQuat(k, from, _qa)).slerp(_qb, smooth(s / 0.2));
    else if (s > 0.8) quat.copy(_qb).slerp(restQuat(k + 1, spotAt(k + 1), _qa), smooth((s - 0.8) / 0.2));
    else quat.copy(_qb);
    return s;
  };
}

const seedFor = text => Math.floor(hashString(text) * 1e6);
const pick = (list, text) => list[Math.floor(hashString(text) * list.length) % list.length];

// Butterflies and moths: a slim dark body and two flat wings hinged along it. At rest the wings stay
// open and flex slowly; in flight they beat about twice a second.
const BODY = blobPart(0, 0.007, 0, 0.008, 0.008, 0.03);
const WINGS = [1, -1].map(side => blobPart(side * 0.034, 0, 0.004, 0.034, 0.0035, 0.03));
function winged(seed, spots, { colour, body, size = 1, moth = false, around = null }) {
  const fly = flight(seed, spots, moth
    ? { slot: 9 + hash01(seed, 3, 1) * 3, fly: [4, 6], lift: 0.05, around }
    : { slot: 10 + hash01(seed, 3, 1) * 4, fly: [3.5, 5.5], lift: 0.12 + hash01(seed, 4, 1) * 0.08, weave: 0.07, flutter: 0.012 });
  const frame = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3(size, size, size);
  const restBeat = 3 + hash01(seed, 5, 1) * 2, beat = moth ? 2.6 : 2.2, phase = hash01(seed, 6, 1) * TAU;
  const open = moth ? 0.08 : 0.28;
  return {
    colours: [body, colour, colour],
    pose(t) {
      const s = fly(t, pos, quat);
      this.flying = s >= 0;
      frame.compose(pos, quat, scale);
      const rest = open + 0.16 * (0.5 - 0.5 * Math.cos(TAU * t / restBeat + phase));
      const flap = 0.15 + 0.95 * (0.5 - 0.5 * Math.cos(TAU * beat * t));
      const g = s < 0 ? 0 : Math.min(smooth(s / 0.1), smooth((1 - s) / 0.1));
      const a = rest + (flap - rest) * g;
      this.put(0, _part.multiplyMatrices(frame, BODY));
      for (let i = 0; i < 2; i++) {
        _wing.makeRotationZ((i ? -1 : 1) * a).setPosition(0, 0.008, 0).multiply(WINGS[i]);
        this.put(1 + i, _part.multiplyMatrices(frame, _wing));
      }
    },
  };
}

// Bees: a yellow body with a dark band and a pale wing on top. Short zigzag hops between flowers and
// the hives' landing boards.
const BEE = [blobPart(0, 0.014, 0, 0.016, 0.014, 0.024), blobPart(0, 0.014, -0.003, 0.0168, 0.0148, 0.007), blobPart(0, 0.028, -0.004, 0.02, 0.003, 0.011)];
function bee(seed, spots) {
  const fly = flight(seed, spots, { slot: 6 + hash01(seed, 3, 2) * 3, fly: [2, 3.2], lift: 0.07, zig: 0.035 });
  const frame = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  return {
    colours: [G.bee, G.beeBand, G.beeWing],
    pose(t) {
      this.flying = fly(t, pos, quat) >= 0;
      frame.compose(pos, quat, ONE);
      for (let i = 0; i < 3; i++) this.put(i, _part.multiplyMatrices(frame, BEE[i]));
    },
  };
}

// Ducks: a white duck (and on some ponds a yellow duckling behind it) paddling slowly round a lily.
// One lap takes about a minute. At night they float still.
const DUCK = [
  blobPart(0, 0.016, 0, 0.045, 0.03, 0.066), blobPart(0, 0.033, -0.058, 0.022, 0.012, 0.03, 0.5),
  blobPart(0, 0.064, 0.04, 0.026, 0.026, 0.028), blobPart(0, 0.058, 0.07, 0.016, 0.006, 0.018),
];
function duck(seed, { c, r, y, period, turn, behind = 0, size = 1, colour }) {
  const start = hash01(seed, 1, 3) * TAU, wobble = hash01(seed, 2, 3) * TAU;
  const frame = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3(size, size, size);
  const at = (a, out) => {
    const k = r * (1 + 0.06 * Math.sin(2 * a + wobble));
    return out.set(c.x + Math.sin(a) * k, y, c.z + Math.cos(a) * k);
  };
  return {
    colours: [colour, colour, colour, G.bill],
    pose(t, mood) {
      const time = mood === 'done' ? 0 : t;
      const a = start + turn * (TAU * time / period - behind);
      at(a, pos);
      at(a + turn * 0.02, _v);
      pos.y += 0.003 * Math.sin(TAU * time / 2.6);
      quat.setFromAxisAngle(Y_AXIS, Math.atan2(_v.x - pos.x, _v.z - pos.z));
      frame.compose(pos, quat, scale);
      for (let i = 0; i < 4; i++) this.put(i, _part.multiplyMatrices(frame, DUCK[i]));
    },
  };
}

// The frog: sits on one pad, and about every half minute hops to the other one, then turns round to
// face back. clock(t) says which pad it is on and how long since it landed (shared with its ripple).
const FROG = [blobPart(0, 0.018, 0, 0.03, 0.02, 0.036), blobPart(0.016, 0.034, 0.02, 0.011, 0.011, 0.011), blobPart(-0.016, 0.034, 0.02, 0.011, 0.011, 0.011)];
const HOP = 0.8;
function frogClock(seed) {
  const slot = 26 + hash01(seed, 1, 4) * 8, phase = 2.6 + hash01(seed, 2, 4) * (slot - 4.2);
  const now = { k: 0, w: 0, slot };
  return (t, mood) => {
    const u = (mood === 'done' ? 0 : t) + phase;
    now.k = Math.floor(u / slot);
    now.w = u - now.k * slot;
    return now;
  };
}
function frog(seed, clock, spots) {
  const frame = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const way = hash01(seed, 3, 4) < 0.5 ? 1 : -1;
  return {
    colours: [G.frog, G.frogEye, G.frogEye],
    pose(t, mood) {
      const { k, w, slot } = clock(t, mood);
      const here = spots[k % 2], there = spots[(k + 1) % 2];
      const toThere = Math.atan2(there.x - here.x, there.z - here.z);
      let yaw, pitch = 0;
      this.flying = w >= slot - HOP;
      if (this.flying) {
        const s = (w - slot + HOP) / HOP;
        pos.lerpVectors(here, there, s);
        pos.y += 0.07 * Math.sin(Math.PI * s);
        yaw = toThere;
        pitch = -0.35 * Math.sin(TAU * s);
      } else {
        pos.copy(here);
        yaw = toThere + Math.PI + way * Math.PI * smooth((w - 0.8) / 1.6);
      }
      _e.set(pitch, yaw, 0);
      frame.compose(pos, quat.setFromEuler(_e), ONE);
      for (let i = 0; i < 3; i++) this.put(i, _part.multiplyMatrices(frame, FROG[i]));
    },
  };
}

// Ripples: a ring that widens and fades over a few seconds. ripple() makes one at a hashed place in
// the water about every period seconds; the first comes after t = 0.
const RIPPLE_TIME = 3.6;
function ring(mover, x, y, z, radius, w, time) {
  const s = w / time, r = radius * (0.15 + 0.85 * (1 - (1 - s) * (1 - s)));
  mover.put(0, _m.makeScale(r, 1, r).setPosition(x, y, z));
  mover.tint(0, '#ffffff', smooth(w / 0.4) * (1 - s) * (1 - s));
}
function ripple(seed, { c, spread, y, period, size }) {
  const offset = 1 + hash01(seed, 1, 5) * (period - RIPPLE_TIME - 1);
  return {
    pose(t) {
      const u = t - offset, k = Math.floor(u / period), w = u - k * period;
      if (u < 0 || w > RIPPLE_TIME) return this.hide(0);
      const a = hash01(k, 2, seed) * TAU, d = Math.sqrt(hash01(k, 3, seed)) * spread;
      ring(this, c.x + Math.sin(a) * d, y, c.z + Math.cos(a) * d, size, w, RIPPLE_TIME);
    },
  };
}

// A leaf from the great tree: falls slowly from under the crown, swaying and turning, lies a moment on
// the grass, then shrinks away. Each of a tree's leaves comes round about every 12 seconds.
function leaf(seed, lane) {
  const slot = 12 + hash01(seed, lane, 6) * 3, offset = 1.5 + lane * 4 + hash01(seed, lane, 7);
  const fall = 7, lie = 2, fade = 1.5;
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  let last = -1;
  return {
    pose(t) {
      const u = t - offset, k = Math.floor(u / slot), w = u - k * slot;
      if (u < 0 || w > fall + lie + fade) return this.hide(0);
      if (k !== last) { last = k; this.tint(0, G.fallen[hash01(k, lane, seed) < 0.22 ? 3 : Math.floor(hash01(k, lane + 9, seed) * 3)]); }
      const a = hash01(k, lane + 3, seed) * TAU, r0 = 0.4 + hash01(k, lane + 5, seed) * 0.08, r1 = r0 + 0.06 + hash01(k, lane + 7, seed) * 0.08;
      const s = Math.min(1, w / fall), calm = 1 - smooth((s - 0.85) / 0.15);
      const r = r0 + (r1 - r0) * s, sway = 0.05 * Math.sin(TAU * 0.45 * w) * calm, b = a + 0.25 * s;
      pos.set(Math.sin(b) * r + Math.cos(b) * sway, 1.02 + (0.012 - 1.02) * s, Math.cos(b) * r - Math.sin(b) * sway);
      _e.set(0.7 * Math.sin(TAU * 0.45 * w + 1) * calm, b + 0.9 * Math.min(w, fall), 0.4 * Math.cos(TAU * 0.3 * w) * calm);
      const size = smooth(w / 0.5) * (1 - smooth((w - fall - lie) / fade));
      this.put(0, _m.compose(pos, quat.setFromEuler(_e), _sv.set(0.03 * size, 0.005 * size, 0.022 * size)));
    },
  };
}

// The rain catcher's tap drips: a drop swells at the spout for two seconds, falls, and rings the puddle.
const dripClock = seed => {
  const slot = 5.5 + hash01(seed, 1, 8) * 1.5, offset = 0.5 + hash01(seed, 2, 8) * 0.5;
  return t => { const u = t - offset, k = Math.floor(u / slot); return u < 0 ? -1 : u - k * slot; };
};
const SWELL = 2, DROP = 0.4;
function drip(clock, tip, floor) {
  return {
    colours: [G.drop],
    pose(t) {
      const w = clock(t);
      if (w < 0 || w > SWELL + DROP) return this.hide(0);
      const grow = smooth(w / SWELL), s = Math.max(0, (w - SWELL) / DROP);
      const y = tip.y - 0.012 * grow - (tip.y - 0.012 - floor) * s * s;
      this.put(0, _m.makeScale(0.011 * grow, 0.014 * grow * (1 + 0.4 * Math.min(1, s * 3)), 0.011 * grow).setPosition(tip.x, y, tip.z));
    },
  };
}
function puddleRing(clock, x, y, z) {
  return {
    pose(t) {
      const w = clock(t) - SWELL - DROP;
      if (w < 0 || w > 1.6) return this.hide(0);
      ring(this, x, y, z, 0.045, w, 1.6);
    },
  };
}

// The drizzle cloud over the rain catcher at break: a few faceted puffs that bob gently, and thin drops
// falling from it onto the roof. roofY(z) is the roof's top at local z.
const PUFFS = [[-0.13, -0.01, 0, 0.085], [-0.04, 0.03, -0.02, 0.11], [0.07, 0.02, 0.01, 0.1], [0.15, -0.015, -0.01, 0.075], [0, -0.025, 0.06, 0.08], [0.03, -0.02, -0.08, 0.075]];
function drizzle(seed, c, roofY) {
  const lanes = PUFFS.length;
  return {
    colours: [...PUFFS.map((_, i) => G.cloud[i % 3]), ...PUFFS.map(() => G.drizzle)],
    pose(t) {
      const dx = 0.025 * Math.sin(TAU * t / 19), dy = 0.012 * Math.sin(TAU * t / 6.5);
      PUFFS.forEach(([x, y, z, r], i) => this.put(i, _m.makeScale(r, r * 0.78, r).setPosition(c.x + x + dx, c.y + y + dy, c.z + z)));
      for (let j = 0; j < lanes; j++) {
        const period = 1.3 + hash01(j, 1, seed) * 0.4, offset = 0.2 + j * 0.2 + hash01(j, 2, seed) * 0.3, time = 0.7;
        const u = t - offset, k = Math.floor(u / period), w = u - k * period;
        if (u < 0 || w > time) { this.hide(lanes + j); continue; }
        const x = c.x + dx - 0.14 + 0.28 * hash01(k, j + 3, seed), z = c.z - 0.08 + 0.16 * hash01(k, j + 11, seed);
        const top = c.y + dy - 0.06, s = w / time, shrink = 1 - smooth((s - 0.85) / 0.15);
        this.put(lanes + j, _m.makeScale(0.005 * shrink, 0.022 * shrink, 0.005 * shrink).setPosition(x, top + (roofY(z) + 0.02 - top) * s, z));
      }
    },
  };
}

// ---------- Who lives where ----------
// Up to count butterflies (never more than LIFE's most) resting on spots (local Vector3s) of one thing.
function butterflies(ctx, thing, base, spots, count) {
  const list = spots.map(p => ({ p }));
  for (let i = 0; i < Math.min(count, LIFE.butterfly.most); i++) {
    const seed = seedFor(`${thing.id}:butterfly:${i}`);
    addLife(ctx, thing, base, 'butterfly', winged(seed, list, { colour: pick(G.wings, `${thing.id}:wing:${i}`), body: G.feelers }));
  }
}

// Spots on a lamp's four glass sides (centre lamp, local), each with the turn that sets a moth flat
// against the glass, head up, back to the outside.
function lampSpots(lamp) {
  return [0, 1, 2, 3].map(j => {
    const a = j * Math.PI / 2, dy = [0.012, -0.015, 0.02, -0.005][j];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, a + Math.PI, 0, 'YXZ'));
    return { p: new THREE.Vector3(lamp.x + Math.sin(a) * 0.048, lamp.y + dy, lamp.z + Math.cos(a) * 0.048), q };
  });
}

// The pond's open water and pads (local), shared by its life and its looks. Ducks circle the lily on
// pad 1, inside the ring of the other pads; the frog hops between pad 2 and a pad of its own (frogPad);
// the lilies look adds flowers on pads 3 and 4 and two small budding pads at the front.
const POND = {
  pads: [[-0.14, 0.12, 0.085, 0.4], [0.16, -0.06, 0.075, 2.2], [0.05, 0.2, 0.06, 4.1], [-0.25, 0.0, 0.062, 1.2], [0.2, 0.17, 0.05, 5.3]],
  ducks: { c: [0.16, -0.06], r: 0.12 },
  frogPad: [-0.06, -0.1, 0.05],
  frogSpots: [[0.05, 0.19], [-0.06, -0.1]],
  buds: [[-0.28, 0.18, 0.045, 0.7], [-0.05, 0.3, 0.04, 3.3]],
};

export const GROWING = {
  // Garden plot: tilled rows of warm soil with sprouts inside a low white fence. The gate in the
  // middle of the front is open, so a helper can stand there and hoe the front of the rows. About 1 in 3
  // gardens has a scarecrow at the far side from the camera. Butterflies visit by day.
  garden(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    const fx = W / 2 - 0.05, fz = D / 2 - 0.05, gate = Math.min(0.3, W * 0.25), h = 0.17;
    const bedW = W - 0.26, back = -D / 2 + 0.12, front = D / 2 - 0.22;
    const bedD = front - back, mid = (front + back) / 2;
    ctx.add(rbox(bedW, 0.04, bedD, 0.01, R), 'matte', G.bedSoil, place(0, 0.02, mid), base, false);
    const rows = Math.max(2, Math.round(bedW / 0.24)), pitch = bedW / rows;
    const plants = Math.max(2, Math.round(bedD / 0.26)), tops = [];
    for (let i = 0; i < rows; i++) {
      const x = -bedW / 2 + pitch * (i + 0.5);
      ctx.add(rbox(pitch * 0.7, 0.06, bedD - 0.04, 0.022, R), 'matte', G.ridge, place(x, 0.055, mid), base, false);
      for (let k = 0; k < plants; k++) {
        const z = back + 0.1 + (k + 0.5) / plants * (bedD - 0.2);
        if (i % 2) ctx.add(chunk(0.052, seed + i * 7 + k, [1, 0.8, 1], 1, 0.08), 'facet', '#9be07a', place(x, 0.11, z, { ry: k + i }), base, false, [0.07, 0.16, 0.85, 1.1]);
        else sprout(ctx, base, x, 0.085, z, 1.1 + hash01(i, k, 3) * 0.3, seed + i + k);
        tops.push(new THREE.Vector3(x, 0.16, z));
      }
    }
    // The fence has an open gate at the front, and another on the camera side, where helpers stand.
    const [cx, cz] = cameraSide(thing);
    // The scarecrow stands in the bed on the side away from the camera, between rows or plants, facing it.
    if (hashString(`${thing.id}:scarecrow`) < 1 / 3) {
      const gapX = -bedW / 2 + pitch * Math.round(rows / 2), gapZ = back + 0.1 + (bedD - 0.2) * Math.ceil(plants / 2) / plants;
      const [x, z] = cz ? [gapX, cz > 0 ? back + 0.06 : front - 0.06] : [-cx * (bedW / 2 - 0.06), gapZ];
      scarecrow(ctx, base, x, z, Math.atan2(cx, cz), pick(G.shirt, `${thing.id}:shirt`));
    }
    const sides = [[0, 1, true], [0, -1, cx === 0 && cz === -1], [-1, 0, cx === -1], [1, 0, cx === 1]];
    for (const [x, z] of [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz]]) fencePost(ctx, base, x, z, h);
    for (const [sx, sz, open] of sides) {
      // Each side runs from corner a to corner b; along is the unit step between them.
      const a = sz ? [-fx, sz * fz] : [sx * fx, -fz], b = sz ? [fx, sz * fz] : [sx * fx, fz];
      const along = sz ? [1, 0] : [0, 1], half = sz ? fx : fz;
      if (open) {
        for (const k of [-1, 1]) fencePost(ctx, base, (a[0] + b[0]) / 2 + along[0] * k * gate, (a[1] + b[1]) / 2 + along[1] * k * gate, h);
        fenceRails(ctx, base, a[0], a[1], a[0] + along[0] * (half - gate), a[1] + along[1] * (half - gate), h);
        fenceRails(ctx, base, b[0] - along[0] * (half - gate), b[1] - along[1] * (half - gate), b[0], b[1], h);
      } else {
        fencePost(ctx, base, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, h);
        fenceRails(ctx, base, a[0], a[1], b[0], b[1], h);
      }
    }
    // The can stands clear of the gate post, its spout over the front of the first row.
    wateringCan(ctx, base, -fx + 0.15, fz - 0.08, 1.9);
    ctx.blob(base, W * 0.9, D * 0.9);
    // Two or three butterflies rest on the plants and the corner posts.
    for (const [x, z] of [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz]]) tops.push(new THREE.Vector3(x, h + 0.02, z));
    butterflies(ctx, thing, base, tops, hashString(`${thing.id}:butterflies`) < 0.5 ? 3 : 2);
  },

  // Rain catcher (the nursery kind): sky islands have no rivers, so water is caught from the sky. A
  // small wooden lean-to, high at the back and low at the front, whose white gutter along the front
  // edge pours from its right end into a big barrel. A second barrel with a tap stands at the front
  // middle, where a helper fills a bucket, and a trough of water sits at the front left. The tap drips
  // into a small puddle, and at break a little drizzle cloud rains on the roof.
  nursery(ctx, thing, base) {
    const [W, D] = footprint(thing);
    // The lean-to: a plank back wall, two front posts, and a board roof sloping down to the front.
    const back = -D / 2 + 0.1, front = 0.06, high = 0.78, low = 0.5, half = W / 2 - 0.1;
    ctx.add(rbox(W - 0.16, high - 0.04, 0.05, E, R), 'matte', P.post, place(0, (high - 0.04) / 2, back), base);
    for (let i = 0; i < 5; i++) ctx.add(rbox(0.012, high - 0.1, 0.012, 0.003, 1), 'matte', G.staveTop, place(-half + 0.1 + i * (2 * half - 0.2) / 4, (high - 0.1) / 2 + 0.02, back + 0.028), base, false);
    for (const sx of [-1, 1]) {
      ctx.add(rbox(0.06, low, 0.06, E, 1), 'matte', P.post, place(sx * (half - 0.02), low / 2, front), base);
      ctx.add(rbox(0.05, 0.05, front - back, E, 1), 'matte', P.post, place(sx * (half - 0.02), low + (high - low) / 2 - 0.04, (front + back) / 2, { rx: Math.atan2(high - low, front - back) }), base, false);
    }
    const slope = Math.atan2(high - low, front - back), run = Math.hypot(high - low, front - back) + 0.14;
    const boards = 6, bw = (W - 0.04) / boards;
    for (let i = 0; i < boards; i++) {
      ctx.add(rbox(bw - 0.008, 0.035, run, 0.006, 1), 'matte', i % 2 ? P.plank : P.plankDark,
        place(-W / 2 + 0.02 + bw * (i + 0.5), (high + low) / 2 + 0.035, (front + back) / 2 + 0.01, { rx: slope }), base, false);
    }
    // The gutter: a white half pipe under the front edge, a little water in it, running to a spout.
    const gy = low + 0.02, gz = front + 0.09, gl = W - 0.06;
    ctx.add(new THREE.CylinderGeometry(0.04, 0.04, gl, 10, 1, true, Math.PI / 2, Math.PI).rotateZ(Math.PI / 2), 'matte', P.trim, place(0, gy, gz), base, false);
    ctx.add(rbox(gl - 0.02, 0.008, 0.05, 0.002, 1), 'matte', G.rain, place(0, gy - 0.012, gz), base, false);
    const sx = W / 2 - 0.2, sz = gz + 0.02;
    ctx.add(new THREE.CylinderGeometry(0.022, 0.026, 0.1, 8), 'matte', P.trim, place(W / 2 - 0.06, gy - 0.035, gz, { rz: -0.9 }), base, false);
    // The big barrel under the spout, with the stream of water falling into it.
    const r1 = 0.15, h1 = 0.3, bx = sx, bz = sz + 0.04;
    barrel(ctx, base, bx, bz, r1, h1);
    ctx.add(new THREE.CylinderGeometry(0.016, 0.022, gy - 0.07 - h1, 6), 'matte', G.stream, place(W / 2 - 0.1, (gy - 0.07 + h1) / 2, gz + 0.01, { rz: 0.12 }), base, false);
    // The tap barrel at the front middle, a short pipe joining it to the big one, and its tap.
    const r2 = 0.12, h2 = 0.24, tx = -0.02, tz = 0.32;
    barrel(ctx, base, tx, tz, r2, h2);
    const pipe = Math.hypot(bx - tx, bz - tz) - r1 - r2 + 0.04;
    ctx.add(new THREE.CylinderGeometry(0.018, 0.018, pipe, 6).rotateZ(Math.PI / 2), 'matte', P.trim,
      place((bx + tx) / 2, h2 * 0.8, (bz + tz) / 2, { ry: -Math.atan2(bz - tz, bx - tx) }), base, false);
    ctx.add(rbox(0.03, 0.03, 0.07, 0.006, 1), 'matte', P.steel, place(tx, 0.15, tz + r2 + 0.02), base, false);
    ctx.add(rbox(0.05, 0.016, 0.016, 0.004, 1), 'matte', G.hoop, place(tx, 0.175, tz + r2 + 0.03), base, false);
    // The trough at the front left, and a spare bucket by the big barrel.
    trough(ctx, base, -W / 2 + 0.25, 0.34, 0.34, 0.25);
    bucket(ctx, base, bx + 0.05, bz + r1 + 0.1, 1.2, 0.6);
    ctx.blob(base, W * 0.92, D * 0.92);
    // Life: the drip from the tap, its ring on the puddle, and the drizzle cloud over the roof at break.
    const px = tx, pz = tz + r2 + 0.05;
    ctx.add(new THREE.CylinderGeometry(0.055, 0.058, 0.008, 14), 'matte', G.rain, place(px, 0.006, pz, { sx: 1.15 }), base, false);
    const clock = dripClock(seedFor(`${thing.id}:drip`));
    if (addLife(ctx, thing, base, 'drip', drip(clock, new THREE.Vector3(tx, 0.133, tz + r2 + 0.045), 0.012))) {
      addLife(ctx, thing, base, 'ripple', puddleRing(clock, px, 0.0125, pz));
    }
    const zc = (front + back) / 2 + 0.01, yc = (high + low) / 2 + 0.035 + 0.0175 / Math.cos(slope);
    addLife(ctx, thing, base, 'cloud', drizzle(seedFor(`${thing.id}:drizzle`), new THREE.Vector3(0.02, 1.2, -0.12), z => yc - (z - zc) * Math.tan(slope)));
  },

  // Orchard: small round fruit trees in a tidy grid, one fruit colour per orchard, and a crate of fruit.
  orchard(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    const roll = hashString(`${thing.id}:fruit`);
    const fruit = roll < 0.55 ? G.fruit[0] : roll < 0.8 ? G.fruit[1] : G.fruit[2];
    const nx = Math.max(1, Math.round(W / CELL)), nz = Math.max(1, Math.round(D / CELL));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = (i + 0.5) / nx * W - W / 2, z = (k + 0.5) / nz * D - D / 2;
      fruitTree(ctx, base, x, z, 0.95 + hash01(i, k, seed) * 0.12, seed + i * 13 + k * 5, fruit);
      ctx.blob(base, 0.55, 0.55, x, z);
    }
    // A crate of picked fruit between the front trees.
    const cz = D / 2 - 0.12;
    ctx.add(rbox(0.17, 0.08, 0.12, 0.008, 1), 'matte', P.plank, place(0, 0.04, cz, { ry: 0.1 }), base);
    ctx.add(rbox(0.18, 0.02, 0.13, 0.005, 1), 'matte', P.plankDark, place(0, 0.03, cz, { ry: 0.1 }), base, false);
    for (const [x, z] of [[-0.045, -0.025], [0.0, 0.025], [0.045, -0.02], [-0.02, 0.02], [0.04, 0.03]]) {
      ctx.add(new THREE.IcosahedronGeometry(0.03, 0), 'facet', fruit, place(x, 0.085, cz + z, { ry: x * 40 }), base, false);
    }
  },

  // Lily pond: clear blue water, deeper in the middle, inside a soft rim of rounded stones, with lily
  // pads, a lily flower or two and a few reeds at the back. About 1 in 3 ponds has more lilies, and about
  // 1 in 3 a frog. A duck (sometimes with a duckling) paddles round, and ripples ring the water.
  pond(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    const rx = W / 2 - 0.17, rz = D / 2 - 0.17;
    const outline = a => {
      const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), n = 2.6;
      const k = Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
      const wobble = 1 + 0.045 * Math.sin(2 * a + seed) + 0.03 * Math.sin(3 * a + seed * 1.7);
      return [Math.cos(a) * rx * k * wobble, Math.sin(a) * rz * k * wobble];
    };
    const waterY = 0.04;
    ctx.add(waterGeometry(outline, G.water, G.shallow), 'matte', null, place(0, waterY, 0), base, false);
    // The rim: rounded stones that overlap, so no gap shows the water's edge.
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i + (hash01(i, 3, seed) - 0.5) * 0.25) / n * Math.PI * 2;
      const [x, z] = outline(a);
      const len = Math.hypot(x, z), r = 0.078 + hash01(i, 5, seed) * 0.02;
      const colour = [P.stone, P.boulder, P.trim, P.stone, P.lilac][(i * 3 + Math.floor(seed)) % 5];
      ctx.add(lump(r, 1, 0.07, seed + i, [1.3, 0.55, 0.95]), 'matte', colour,
        place(x + x / len * 0.035, 0.022, z + z / len * 0.035, { ry: -a - Math.PI / 2 }), base, false, [-0.02, 0.07, 0.86, 1.04]);
    }
    // Lily pads (a disc with a notch), two with flowers.
    const lilies = hashString(`${thing.id}:lilies`) < 1 / 3, hasFrog = hashString(`${thing.id}:frog`) < 1 / 3;
    const pad = (x, z, r, spin, colour) => ctx.add(new THREE.CylinderGeometry(r, r, 0.012, 16, 1, false, 0.25, Math.PI * 2 - 0.5), 'facet', colour, place(x, waterY + 0.007, z, { ry: spin + seed }), base, false);
    POND.pads.forEach(([x, z, r, spin], i) => {
      pad(x, z, r, spin, G.pad[i % 3]);
      if (i === 0 || i === 1) lily(ctx, base, x * 1.02, waterY + 0.012, z, i ? P.flower[3] : P.flower[1], spin);
      // The lilies look: two more flowers, on the pads at the left and the front right.
      if (lilies && (i === 3 || i === 4)) lily(ctx, base, x, waterY + 0.012, z, i === 3 ? P.flower[2] : P.flower[1], spin + 1);
    });
    if (lilies) {
      for (const [x, z, r, spin] of POND.buds) {
        pad(x, z, r, spin, G.pad[1]);
        ctx.add(new THREE.IcosahedronGeometry(0.02, 0).scale(0.8, 1.3, 0.8), 'facet', P.flower[1], place(x + 0.01, waterY + 0.03, z), base, false);
      }
    }
    if (hasFrog) pad(POND.frogPad[0], POND.frogPad[1], POND.frogPad[2], 2.9, G.pad[2]);
    // Reeds and two cattails standing in the back corner of the water.
    const [cx, cz] = outline(Math.PI * 1.25);
    const ox = cx * 0.72, oz = cz * 0.72;
    for (const [dx, dz, hgt, lean] of [[0, 0, 0.3, 0.12], [0.05, 0.03, 0.24, -0.2], [-0.04, 0.04, 0.2, 0.3], [0.03, -0.04, 0.26, -0.05]]) {
      ctx.add(new THREE.ConeGeometry(0.016, hgt, 4), 'facet', G.reed, place(ox + dx, waterY + hgt / 2, oz + dz, { rz: lean, ry: dx * 30 }), base, false);
    }
    for (const [dx, dz, hgt] of [[0.015, 0.012, 0.32], [-0.022, -0.008, 0.27]]) {
      ctx.add(new THREE.CylinderGeometry(0.005, 0.006, hgt, 4), 'matte', G.reed, place(ox + dx, waterY + hgt / 2, oz + dz), base, false);
      ctx.add(new THREE.CapsuleGeometry(0.016, 0.05, 2, 6), 'matte', G.cattail, place(ox + dx, waterY + hgt - 0.02, oz + dz), base, false);
    }
    // Life: a duck round the lily on pad 1, half the time with a duckling behind; the frog; two ripples.
    const c = new THREE.Vector3(POND.ducks.c[0], 0, POND.ducks.c[1]);
    const period = 50 + hashString(`${thing.id}:ducks`) * 20, turn = hashString(`${thing.id}:ducks:turn`) < 0.5 ? 1 : -1;
    const ducks = hashString(`${thing.id}:duckling`) < 0.5 ? 2 : 1;
    for (let i = 0; i < Math.min(ducks, LIFE.duck.most); i++) {
      addLife(ctx, thing, base, 'duck', duck(seedFor(`${thing.id}:ducks`), { c, r: POND.ducks.r, y: waterY, period, turn, behind: i ? 1.05 : 0, size: i ? 0.6 : 1, colour: i ? G.duckling : G.duck }));
    }
    if (hasFrog) {
      const seed = seedFor(`${thing.id}:frog`), clock = frogClock(seed);
      const spots = POND.frogSpots.map(([x, z]) => new THREE.Vector3(x, waterY + 0.013, z));
      if (addLife(ctx, thing, base, 'frog', frog(seed, clock, spots))) {
        // When it lands, a ring spreads round the pad it landed on.
        addLife(ctx, thing, base, 'ripple', {
          pose(t, mood) {
            const { k, w } = clock(t, mood), at = spots[k % 2];
            if (k < 1 || w > 2.4) return this.hide(0);
            ring(this, at.x, waterY + 0.003, at.z, 0.14, w, 2.4);
          },
        });
      }
    }
    for (let i = 0; i < 2; i++) {
      addLife(ctx, thing, base, 'ripple', ripple(seedFor(`${thing.id}:ripple:${i}`), { c: new THREE.Vector3(0.02, 0, 0), spread: 0.24, y: waterY + 0.003, period: 9 + i * 4, size: 0.1 }));
    }
  },

  // The great tree: a huge old faceted tree, half again as tall as any other, with thick roots
  // spreading over the ground. Now and then a leaf drifts down from under the crown.
  greattree(ctx, thing, base) {
    const seed = seedOf(thing);
    const roots = 7;
    for (let i = 0; i < roots; i++) {
      const a = (i + hash01(i, 1, seed) * 0.4) / roots * Math.PI * 2 + seed;
      const len = 0.42 + hash01(i, 2, seed) * 0.1;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [[ca * 0.1, 0.24, sa * 0.1], [ca * 0.25, 0.1, sa * 0.25], [ca * (len - 0.08), 0.03, sa * (len - 0.08)], [ca * len, -0.08, sa * len]];
      ctx.add(taperedTube(pts, 0.1, 0.02, 6), 'facet', P.trunk, null, base, true);
    }
    ctx.add(new THREE.CylinderGeometry(0.2, 0.29, 0.16, 8), 'facet', P.trunk, place(0, 0.08, 0, { ry: seed }), base);
    ctx.add(new THREE.CylinderGeometry(0.15, 0.21, 0.5, 8), 'facet', P.trunk, place(0, 0.4, 0, { ry: seed }), base);
    ctx.add(new THREE.CylinderGeometry(0.11, 0.15, 0.42, 8), 'facet', P.trunk, place(0.012, 0.84, 0, { rz: -0.06, ry: seed }), base);
    ctx.add(new THREE.CylinderGeometry(0.04, 0.07, 0.42, 6), 'facet', P.trunk, place(0.17, 1.0, 0.04, { rz: -0.85 }), base);
    ctx.add(new THREE.CylinderGeometry(0.04, 0.07, 0.4, 6), 'facet', P.trunk, place(-0.16, 1.03, -0.03, { rz: 0.8 }), base);
    // A broad crown: a ring of clumps round a big middle one, and two smaller clumps on top.
    const leaves = ['#4fbd5b', '#5cc85d', '#45b457', '#73d56a'];
    const clumps = [[0, 1.45, 0, 0.44]];
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2 + 0.35 + seed * 0.01;
      clumps.push([Math.cos(a) * 0.31, 1.2 + (k % 2) * 0.06, Math.sin(a) * 0.31, 0.28]);
    }
    clumps.push([0.07, 1.76, 0.03, 0.27], [-0.17, 1.66, -0.1, 0.22]);
    clumps.forEach(([x, y, z, r], i) => ctx.add(chunk(r, seed + i, [1, 0.86, 1], i ? 0 : 1, i ? 0.1 : 0.12), 'facet', leaves[i % 4],
      place(x, y, z, { ry: i * 0.9 + seed }), base, false, [0.95, 2.05, 0.8, 1.1]));
    // White blossoms on the lit front and top faces, where they show.
    for (let i = 0; i < 7; i++) {
      const [x, y, z, r] = clumps[[0, 1, 2, 6, 0, 3, 7][i]];
      const n = new THREE.Vector3(Math.sin(i * 2.3 + seed) * 0.7, 0.55 + (i % 3) * 0.15, 0.7).normalize();
      const p = new THREE.Vector3(x + n.x * r * 0.95, y + n.y * r * 0.84, z + n.z * r * 0.95);
      ctx.add(new THREE.IcosahedronGeometry(0.05, 0), 'facet', P.blossom, onSurface(p, n, [1, 0.36, 1], i), base, false);
    }
    ctx.blob(base, 1.25, 1.2);
    for (let lane = 0; lane < LIFE.leaf.most; lane++) addLife(ctx, thing, base, 'leaf', leaf(seedFor(`${thing.id}:leaves`), lane));
  },

  // Mushroom grotto: a mossy mound with a stone-arched cave mouth and giant spotted mushrooms.
  grotto(ctx, thing, base) {
    const seed = seedOf(thing);
    ctx.add(chunk(0.5, seed, [1.08, 0.6, 0.82], 1, 0.1), 'facet', P.lilac, place(0, 0.08, -0.12, { ry: seed }), base, true, [0, 0.4, 0.85, 1.05]);
    ctx.add(chunk(0.45, seed + 3, [1.06, 0.56, 0.82], 1, 0.1), 'facet', G.moss[0], place(0.01, 0.19, -0.15, { ry: seed + 1 }), base, false, [0.1, 0.45, 0.82, 1.08]);
    ctx.add(chunk(0.22, seed + 5, [1.1, 0.6, 1], 1, 0.12), 'facet', G.moss[2], place(-0.2, 0.36, -0.2, { ry: seed + 2 }), base, false, [0.25, 0.5, 0.85, 1.1]);
    // Cave mouth: a dark arch set into the front, framed by a stone arch on two short pillars.
    const ax = -0.1, az = 0.31, aw = 0.15, ph = 0.13;
    const arch = new THREE.Shape();
    arch.moveTo(-aw, 0); arch.lineTo(aw, 0); arch.lineTo(aw, ph); arch.absarc(0, ph, aw, 0, Math.PI, false); arch.lineTo(-aw, 0);
    const mouth = new THREE.ExtrudeGeometry(arch, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
    const ab = base.clone().multiply(place(ax, 0, az, { rx: -0.12 }));
    ctx.add(mouth, 'matte', G.caveDeep, place(0, 0, -0.03), ab, false);
    ctx.add(new THREE.TorusGeometry(aw + 0.01, 0.042, 6, 14, Math.PI), 'facet', P.stone, place(0, ph, 0.03), ab, false);
    for (const sx of [-1, 1]) ctx.add(rbox(0.08, ph + 0.01, 0.08, 0.012, 1), 'facet', P.stone, place(sx * (aw + 0.01), (ph + 0.01) / 2, 0.03), ab, true);
    ctx.add(chunk(0.06, seed + 9, [1.2, 0.7, 1]), 'facet', P.boulder, place(0, ph + aw + 0.04, 0.03), ab, false);
    // Giant mushrooms: a tall one at the back right, a middle one at the front right, a small one by the mouth.
    bigMushroom(ctx, base, 0.27, 0.12, -0.18, 1.25, -0.12, seed);
    bigMushroom(ctx, base, 0.33, 0, 0.27, 0.9, 0.1, seed + 1);
    bigMushroom(ctx, base, -0.42, 0, 0.34, 0.6, 0.25, seed + 2);
    // Two small glowing mushrooms at the mouth, faint by day and lit with a cool halo at dusk.
    const glowing = [[-0.35, 0.46, 1.5], [0.15, 0.47, 1.2]];
    for (const [x, z, s] of glowing) {
      ctx.add(new THREE.CylinderGeometry(0.012 * s, 0.016 * s, 0.06 * s, 6), 'matte', P.mushroomStem, place(x, 0.03 * s, z), base, false);
      ctx.add(new THREE.SphereGeometry(0.04 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), 'shine', P.crystal[1], place(x, 0.055 * s, z), base, false);
    }
    lampGlow(ctx, base, glowing.map(([x, z, s]) => [x, 0.07 * s, z]), { pool: 0.3, halo: 0.2, colour: '#7fe3ff' });
    ctx.blob(base, 1.25, 1.1, 0, -0.04);
  },

  // Beehive meadow: three bright box hives with flat white lids among clumps of flowers. By day three to
  // five bees hop between each hive's landing board and the flowers in front of it.
  beehives(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    // One hive is always honey yellow; the other two take bright colours that differ per meadow.
    const roll = Math.floor(hashString(`${thing.id}:hives`) * 3);
    const colours = [G.hives[0], G.hives[1 + roll % 3], G.hives[1 + (roll + 1) % 3]];
    const sx = W / 1.2, sz = D / 1.2, boards = [];
    [[-0.28, -0.2, 0.12], [0.28, -0.24, -0.1], [0.02, 0.2, 0.04]].forEach(([x, z, ry], i) => {
      hive(ctx, base, x * sx, z * sz, ry, colours[(i + 2) % 3]);
      ctx.blob(base, 0.46, 0.42, x * sx, z * sz);
      boards.push(new THREE.Vector3(0, 0.094, 0.15).applyMatrix4(place(x * sx, 0, z * sz, { ry })));
    });
    // No clumps tucked behind the back hives, where they would peek out round the hive sides.
    const clumps = [[-0.02, -0.5], [-0.5, 0.08], [0.5, 0.04], [0, -0.08], [-0.33, 0.3], [0.36, 0.26], [-0.2, 0.48], [0.25, 0.48], [-0.48, 0.48], [0.5, 0.46]];
    const blooms = [];
    clumps.forEach(([cx, cz], i) => {
      const x = cx * sx, z = cz * sz;
      const tint = [G.bloom[(i + Math.floor(seed)) % 5], G.bloom[(i + Math.floor(seed) + 2) % 5], P.white];
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + i, d = 0.045, h = 0.07 + hash01(i, k, seed) * 0.05;
        daisy(ctx, base, x + Math.cos(a) * d, z + Math.sin(a) * d, h, tint[k], a);
        if (k === 0) blooms.push(new THREE.Vector3(x + Math.cos(a) * d, h + 0.03, z + Math.sin(a) * d));
      }
      ctx.add(chunk(0.06, i + seed, [1, 0.55, 1], 0, 0.1), 'facet', P.leaf[i % 3], place(x, 0.02, z), base, false);
    });
    // Each bee keeps to one hive and the clumps in front of it, so it never flies through a hive.
    const near = [[1, 4], [2, 5], [6, 7]];
    const bees = Math.min(3 + Math.floor(hashString(`${thing.id}:bees`) * 3), LIFE.bee.most);
    for (let i = 0; i < bees; i++) {
      const spots = [boards[i % 3], ...near[i % 3].map(j => blooms[j])].map(p => ({ p }));
      addLife(ctx, thing, base, 'bee', bee(seedFor(`${thing.id}:bee:${i}`), spots));
    }
  },

  // Flower bed: a low white-edged bed packed with blooms in bands of colour. Helpers walk over it.
  flowers(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    const w = W - 0.08, d = D - 0.12, t = 0.045, h = 0.06;
    for (const sz of [-1, 1]) ctx.add(rbox(w, h, t, 0.01, R), 'matte', P.trim, place(0, h / 2, sz * (d / 2 - t / 2)), base, false);
    for (const sx of [-1, 1]) ctx.add(rbox(t, h, d - t * 2 + 0.002, 0.01, R), 'matte', P.trim, place(sx * (w / 2 - t / 2), h / 2, 0), base, false);
    ctx.add(rbox(w - t * 2, 0.04, d - t * 2, 0.006, 1), 'matte', G.bedSoil, place(0, 0.02, 0), base, false);
    const iw = w - t * 2 - 0.06, id = d - t * 2 - 0.04;
    // Leafy mass under the blooms.
    const nl = Math.max(2, Math.round(iw / 0.2));
    for (let i = 0; i < nl; i++) {
      ctx.add(chunk(0.11, seed + i, [1.05, 0.42, id / 0.24], 0, 0.1), 'facet', P.leaf[i % 3], place(-iw / 2 + (i + 0.5) / nl * iw, 0.055, 0, { ry: i * 0.3 }), base, false);
    }
    const palette = G.bloom.slice(0, 5);
    const shift = Math.floor(hashString(`${thing.id}:bloom`) * palette.length);
    const cols = Math.max(2, Math.round(iw / 0.098)), rowsN = Math.max(1, Math.round(id / 0.09));
    const tops = [];
    for (let i = 0; i < cols; i++) for (let k = 0; k < rowsN; k++) {
      const x = -iw / 2 + (i + 0.5 + (k % 2 ? 0.2 : -0.2)) / cols * iw, z = -id / 2 + (k + 0.5) / rowsN * id;
      const colour = palette[(Math.floor(i / 2) + shift) % palette.length];
      const y = 0.105 + hash01(i, k, seed) * 0.022;
      ctx.add(new THREE.IcosahedronGeometry(0.047, 0).scale(1, 0.8, 1), 'facet', colour, place(x, y, z, { ry: i + k }), base, false);
      tops.push(new THREE.Vector3(x, y + 0.036, z));
    }
    ctx.blob(base, W * 0.95, D * 0.95);
    // By day none, one or two butterflies (about 3 in 10 beds have none).
    const roll = hashString(`${thing.id}:butterflies`);
    butterflies(ctx, thing, base, tops, roll < 0.3 ? 0 : roll < 0.75 ? 1 : 2);
  },

  // Lantern path: two small lantern posts either side of the cell, lamps glowing at dusk.
  lanterns(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const cap = hashString(`${thing.id}:cap`) < 0.5 ? P.roofs[0] : P.roofs[2];
    const lamps = [[-W * 0.36, -D * 0.1], [W * 0.36, D * 0.1]].map(([x, z]) => [x, lanternPost(ctx, base, x, z, cap), z]);
    for (const [x, , z] of lamps) ctx.blob(base, 0.2, 0.2, x, z);
    lampGlow(ctx, base, lamps, { pool: 0.6, halo: 0.3 });
    // While the lamps are lit, about one lamp in two has a moth: it rests on the glass, then circles.
    lamps.forEach(([x, y, z], j) => {
      if (hashString(`${thing.id}:moth:${j}`) >= 0.5) return;
      const c = new THREE.Vector3(x, y, z), seed = seedFor(`${thing.id}:moth:${j}`);
      addLife(ctx, thing, base, 'moth', winged(seed, lampSpots(c), { colour: pick(G.moth, `${thing.id}:mothwing:${j}`), body: G.mothBody, size: 0.75, moth: true, around: { c, out: 0.06 } }));
    });
  },

  // Golden sapling from a surprise: a slender young tree with faceted golden leaves and a soft warm
  // glow at dusk. No bigger than a normal tree. The leaves are their own mesh with a warm inner light,
  // so they stay gold in the blue night light instead of turning olive. (The shared 'shine' material
  // gives a lilac light, which turns gold leaves pink.)
  goldentree(ctx, thing, base) {
    const seed = seedOf(thing);
    ctx.add(new THREE.CylinderGeometry(0.03, 0.052, 0.5, 6), 'facet', G.goldTrunk, place(0, 0.25, 0, { ry: seed }), base);
    ctx.add(new THREE.CylinderGeometry(0.013, 0.022, 0.2, 5), 'facet', G.goldTrunk, place(0.07, 0.5, 0, { rz: -0.7 }), base, false);
    const clumps = [[0, 0.66, 0, 0.21], [0.15, 0.55, 0.06, 0.14], [-0.14, 0.57, 0.04, 0.14], [0.02, 0.86, -0.02, 0.15]];
    const crown = new Batch(), ground = base.elements[13];
    const crownMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0, emissive: '#ffb21e', emissiveIntensity: 0.04 });
    clumps.forEach(([x, y, z, r], i) => {
      const g = chunk(r, seed + i, [1, 0.92, 1], 0, 0.12);
      crown.add(g, 'crown', { color: G.gold[i % 3], matrix: base.clone().multiply(place(x, y, z, { ry: i * 0.9 + seed })), grad: { y0: ground + 0.4, y1: ground + 1.0, min: 0.86, max: 1.1 } });
      g.dispose();
    });
    const top = crown.top;
    for (const mesh of crown.build({ crown: crownMaterial }, ctx.root)) ctx.track(mesh.geometry);
    ctx.track(crownMaterial);
    // Parts drawn outside ctx.add still count towards the thing's height, so the camera keeps them in view.
    if (ctx.batch && Number.isFinite(top)) ctx.batch.top = Math.max(ctx.batch.top, top);
    ctx.onMood((name, mood) => { crownMaterial.emissiveIntensity = mood?.windows ? 0.22 + mood.windows * 0.12 : 0.04; });
    // Little sparkles set into the leaves (on the surface, so none float). They glow at dusk.
    for (let i = 0; i < 5; i++) {
      const [x, y, z, r] = clumps[i % 4];
      const n = new THREE.Vector3(Math.sin(i * 2.1 + seed) * 0.8, 0.5, 0.75).normalize();
      ctx.add(new THREE.OctahedronGeometry(0.026, 0), 'glow', G.spark, place(x + n.x * r * 0.92, y + n.y * r * 0.85, z + n.z * r * 0.92, { ry: i }), base, false);
    }
    ctx.blob(base, 0.75);
    lampGlow(ctx, base, [[0, 0.68, 0]], { pool: 0.9, halo: 0.7, colour: '#ffcf5a' });
  },
};
