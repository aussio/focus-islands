// Growing places: the kinds that come from break-time growth. Garden, seed nursery, orchard, lily
// pond, great tree, mushroom grotto, beehive meadow, flower bed, lantern path and the golden sapling.
// Same signature as every model: (ctx, thing, base), where base is the ground point at the middle of
// the footprint, already turned to face the thing's way. Local +z is the front (towards the path).
// See models/index.js for what ctx offers. Nothing here moves; the lanterns only light up at dusk.
import * as THREE from 'three';
import { P, CELL } from '../style.js';
import { Batch, hash01, hashString, place, taperedTube } from '../ground.js';
import { chunk, gableGeometry, glowTexture, lump, rbox } from '../parts.js';

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
  pot: '#ef8a5b', potRim: '#f7a57a', potSoil: '#9a6242', tray: '#e2b47a', roofGlass: '#bfe6ff',
  can: '#5fb8ff', mulch: '#d99a66',
  water: '#3fa9ee', shallow: '#9fe2ff', pad: ['#4fbd5b', '#73d56a', '#5cc85d'], reed: '#5aa84e', cattail: '#a8673f',
  moss: ['#6fcf6a', '#5cc85d', '#82d870'], cave: '#4a3f7a', caveDeep: '#352f63',
  hives: ['#ffd23f', '#7cc8ff', '#ff9cc0', '#7fe0b0'], slot: '#6b4a3a',
  fruit: ['#ff4f5e', '#ff9d3f', '#ffd23f'],
  bloom: ['#ff8fb4', '#ffd25e', '#b88cff', '#ff6b6b', '#ffffff', '#ff9d3f'],
  pole: '#5d6a9a', lamp: '#ffe7a0',
  gold: ['#ffd23f', '#ffc21e', '#ffe066'], goldTrunk: '#d9a066', spark: '#fff6cf',
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

// A terracotta pot with soil and a little faceted sapling.
function pottedSapling(ctx, base, x, z, s, seed) {
  const r = 0.062 * s, h = 0.1 * s;
  ctx.add(new THREE.CylinderGeometry(r, r * 0.74, h, 10), 'matte', G.pot, place(x, h / 2, z), base);
  ctx.add(new THREE.TorusGeometry(r * 1.02, 0.013 * s, 5, 14).rotateX(Math.PI / 2), 'matte', G.potRim, place(x, h, z), base, false);
  ctx.add(new THREE.CylinderGeometry(r * 0.9, r * 0.95, 0.012, 10), 'matte', G.potSoil, place(x, h + 0.003, z), base, false);
  ctx.add(new THREE.CylinderGeometry(0.009 * s, 0.013 * s, 0.13 * s, 5), 'facet', P.trunk, place(x, h + 0.065 * s, z), base, false);
  const top = h + 0.17 * s;
  ctx.add(chunk(0.075 * s, seed, [1, 0.9, 1], 0, 0.12), 'facet', P.leaf[Math.floor(seed) % 3], place(x, top, z, { ry: seed }), base, false, [top - 0.08 * s, top + 0.08 * s, 0.85, 1.1]);
}

// A shallow wooden tray of soil with rows of seedlings.
function seedTray(ctx, base, x, y, z, ry, seed) {
  const b = base.clone().multiply(place(x, y, z, { ry }));
  ctx.add(rbox(0.22, 0.04, 0.16, 0.006, 1), 'matte', G.tray, place(0, 0.02, 0), b, y > 0.05);
  ctx.add(rbox(0.19, 0.012, 0.13, 0.004, 1), 'matte', G.potSoil, place(0, 0.04, 0), b, false);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) sprout(ctx, b, -0.06 + i * 0.06, 0.045, -0.03 + k * 0.06, 0.6 + hash01(i, k, seed) * 0.3, i + k * 2 + seed);
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

export const GROWING = {
  // Garden plot: tilled rows of warm soil with sprouts inside a low white fence. The gate in the
  // middle of the front is open, so a helper can stand there and hoe the front of the rows.
  garden(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    const fx = W / 2 - 0.05, fz = D / 2 - 0.05, gate = Math.min(0.3, W * 0.25), h = 0.17;
    const bedW = W - 0.26, back = -D / 2 + 0.12, front = D / 2 - 0.22;
    const bedD = front - back, mid = (front + back) / 2;
    ctx.add(rbox(bedW, 0.04, bedD, 0.01, R), 'matte', G.bedSoil, place(0, 0.02, mid), base, false);
    const rows = Math.max(2, Math.round(bedW / 0.24)), pitch = bedW / rows;
    for (let i = 0; i < rows; i++) {
      const x = -bedW / 2 + pitch * (i + 0.5);
      ctx.add(rbox(pitch * 0.7, 0.06, bedD - 0.04, 0.022, R), 'matte', G.ridge, place(x, 0.055, mid), base, false);
      const plants = Math.max(2, Math.round(bedD / 0.26));
      for (let k = 0; k < plants; k++) {
        const z = back + 0.1 + (k + 0.5) / plants * (bedD - 0.2);
        if (i % 2) ctx.add(chunk(0.052, seed + i * 7 + k, [1, 0.8, 1], 1, 0.08), 'facet', '#9be07a', place(x, 0.11, z, { ry: k + i }), base, false, [0.07, 0.16, 0.85, 1.1]);
        else sprout(ctx, base, x, 0.085, z, 1.1 + hash01(i, k, 3) * 0.3, seed + i + k);
      }
    }
    // The fence has an open gate at the front, and another on the camera side, where helpers stand.
    const [cx, cz] = cameraSide(thing);
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
  },

  // Seed nursery: a little glass greenhouse at the back, potted saplings and seedling trays in front.
  // The front middle stays low, so a helper can stand at the edge and water the trays.
  nursery(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    // Greenhouse: white kerb, a block of glass, a glass roof prism and a crisp white frame.
    const gw = W - 0.3, gd = 0.44, gz = -D / 2 + 0.08 + gd / 2, wallH = 0.3, rise = 0.21, y0 = 0.06;
    const gb = base.clone().multiply(place(0, 0, gz));
    ctx.add(rbox(gw + 0.05, y0, gd + 0.05, E, R), 'matte', P.trim, place(0, y0 / 2, 0), gb);
    ctx.add(rbox(gw - 0.02, wallH, gd - 0.02, 0.004, 1), 'glass', P.glass, place(0, y0 + wallH / 2, 0), gb, false);
    const top = y0 + wallH, inner = gd - 0.02;
    // The roof glass stays unlit, so at dusk only the walls glow, like windows.
    ctx.add(gableGeometry(gw - 0.02, inner, rise), 'matte', G.roofGlass, place(0, top, 0), gb, false);
    const f = 0.026;
    for (const sz of [-1, 1]) {
      for (let i = 0; i <= 4; i++) ctx.add(rbox(f, wallH, f, 0.004, 1), 'matte', P.trim, place(-gw / 2 + (gw / 4) * i, y0 + wallH / 2, sz * (gd / 2 - 0.005)), gb, false);
      ctx.add(rbox(gw + 0.03, 0.03, 0.034, 0.005, 1), 'matte', P.trim, place(0, top, sz * (gd / 2 - 0.005)), gb, false);
      ctx.add(rbox(gw, 0.02, 0.022, 0.004, 1), 'matte', P.trim, place(0, y0 + wallH * 0.5, sz * (gd / 2 - 0.006)), gb, false);
      // Rafters down each roof slope.
      const pitch = Math.atan2(rise, inner / 2), len = Math.hypot(rise, inner / 2);
      for (let i = 0; i <= 4; i++) {
        ctx.add(rbox(0.022, 0.02, len + 0.02, 0.004, 1), 'matte', P.trim,
          place(-gw / 2 + (gw / 4) * i, top + rise / 2 + Math.cos(pitch) * 0.008, sz * (inner / 4 + Math.sin(pitch) * 0.008), { rx: sz * pitch }), gb, false);
      }
    }
    for (const sx of [-1, 1]) ctx.add(rbox(0.022, wallH, f, 0.004, 1), 'matte', P.trim, place(sx * (gw / 2 - 0.005), y0 + wallH / 2, 0), gb, false);
    ctx.add(rbox(gw + 0.05, 0.034, 0.034, 0.005, 1), 'matte', P.trim, place(0, top + rise + 0.01, 0), gb, false);
    // Front door of the greenhouse.
    ctx.add(rbox(0.13, 0.22, 0.02, 0.004, 1), 'matte', P.door, place(gw / 4 + 0.005, y0 + 0.11, gd / 2 + 0.004), gb, false);
    // Potted saplings on the left, seedling trays on the right and at the front.
    const left = -W / 2 + 0.17;
    pottedSapling(ctx, base, left - 0.01, 0.07, 1.3, seed);
    pottedSapling(ctx, base, left + 0.24, 0.12, 1.0, seed + 3);
    pottedSapling(ctx, base, left + 0.11, 0.4, 0.9, seed + 5);
    seedTray(ctx, base, 0.28, 0, 0.12, -0.08, seed);
    seedTray(ctx, base, 0.07, 0, 0.38, 0.06, seed + 2);
    seedTray(ctx, base, 0.32, 0, 0.38, -0.03, seed + 4);
    ctx.blob(base, W * 0.92, D * 0.92);
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
  // pads, a lily flower or two and a few reeds at the back.
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
    const pads = [[-0.14, 0.12, 0.085, 0.4], [0.16, -0.06, 0.075, 2.2], [0.05, 0.2, 0.06, 4.1], [-0.25, 0.0, 0.062, 1.2], [0.2, 0.17, 0.05, 5.3]];
    pads.forEach(([x, z, r, spin], i) => {
      ctx.add(new THREE.CylinderGeometry(r, r, 0.012, 16, 1, false, 0.25, Math.PI * 2 - 0.5), 'facet', G.pad[i % 3], place(x, waterY + 0.007, z, { ry: spin + seed }), base, false);
      if (i === 0 || i === 1) lily(ctx, base, x * 1.02, waterY + 0.012, z, i ? P.flower[3] : P.flower[1], spin);
    });
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
  },

  // The great tree: a huge old faceted tree, half again as tall as any other, with thick roots
  // spreading over the ground.
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

  // Beehive meadow: three bright box hives with flat white lids among clumps of flowers.
  beehives(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const seed = seedOf(thing);
    // One hive is always honey yellow; the other two take bright colours that differ per meadow.
    const roll = Math.floor(hashString(`${thing.id}:hives`) * 3);
    const colours = [G.hives[0], G.hives[1 + roll % 3], G.hives[1 + (roll + 1) % 3]];
    const sx = W / 1.2, sz = D / 1.2;
    [[-0.28, -0.2, 0.12], [0.28, -0.24, -0.1], [0.02, 0.2, 0.04]].forEach(([x, z, ry], i) => {
      hive(ctx, base, x * sx, z * sz, ry, colours[(i + 2) % 3]);
      ctx.blob(base, 0.46, 0.42, x * sx, z * sz);
    });
    // No clumps tucked behind the back hives, where they would peek out round the hive sides.
    const clumps = [[-0.02, -0.5], [-0.5, 0.08], [0.5, 0.04], [0, -0.08], [-0.33, 0.3], [0.36, 0.26], [-0.2, 0.48], [0.25, 0.48], [-0.48, 0.48], [0.5, 0.46]];
    clumps.forEach(([cx, cz], i) => {
      const x = cx * sx, z = cz * sz;
      const tint = [G.bloom[(i + Math.floor(seed)) % 5], G.bloom[(i + Math.floor(seed) + 2) % 5], P.white];
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + i, d = 0.045;
        daisy(ctx, base, x + Math.cos(a) * d, z + Math.sin(a) * d, 0.07 + hash01(i, k, seed) * 0.05, tint[k], a);
      }
      ctx.add(chunk(0.06, i + seed, [1, 0.55, 1], 0, 0.1), 'facet', P.leaf[i % 3], place(x, 0.02, z), base, false);
    });
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
    for (let i = 0; i < cols; i++) for (let k = 0; k < rowsN; k++) {
      const x = -iw / 2 + (i + 0.5 + (k % 2 ? 0.2 : -0.2)) / cols * iw, z = -id / 2 + (k + 0.5) / rowsN * id;
      const colour = palette[(Math.floor(i / 2) + shift) % palette.length];
      const y = 0.105 + hash01(i, k, seed) * 0.022;
      ctx.add(new THREE.IcosahedronGeometry(0.047, 0).scale(1, 0.8, 1), 'facet', colour, place(x, y, z, { ry: i + k }), base, false);
    }
    ctx.blob(base, W * 0.95, D * 0.95);
  },

  // Lantern path: two small lantern posts either side of the cell, lamps glowing at dusk.
  lanterns(ctx, thing, base) {
    const [W, D] = footprint(thing);
    const cap = hashString(`${thing.id}:cap`) < 0.5 ? P.roofs[0] : P.roofs[2];
    const lamps = [[-W * 0.36, -D * 0.1], [W * 0.36, D * 0.1]].map(([x, z]) => [x, lanternPost(ctx, base, x, z, cap), z]);
    for (const [x, , z] of lamps) ctx.blob(base, 0.2, 0.2, x, z);
    lampGlow(ctx, base, lamps, { pool: 0.6, halo: 0.3 });
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
