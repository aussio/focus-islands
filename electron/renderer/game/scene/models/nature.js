// Natural kinds the layout scatters: tree, rock, bush, flower, pile, fire, seat, mushroom, crystal,
// plus the tiny lawn decorations. Every model has the same signature: (ctx, thing, base), where base
// is the thing's ground point at the middle of its footprint, already turned to face its way.
// Local +z is the thing's front. See models/index.js for what ctx offers.
import * as THREE from 'three';
import { P } from '../style.js';
import { hash01, hashString, place } from '../ground.js';
import { chunk, crystalGeometry, glowTexture, logGeometry, rbox, teardrop } from '../parts.js';

const R = 2; // rounded-box segments
const seedOf = thing => hashString(thing.id) * 1000;

function roundTree(ctx, thing, base, s, seed) {
  ctx.add(new THREE.CylinderGeometry(0.05, 0.085, 0.55, 7), 'facet', P.trunk, place(0, 0.27, 0), base);
  const clumps = [[0, 0.78, 0, 0.37], [0.21, 0.62, 0.12, 0.26], [-0.21, 0.64, 0.06, 0.26], [0.03, 1.03, -0.04, 0.25]];
  clumps.forEach(([x, y, z, r], i) => ctx.add(
    chunk(r * s, i + seed, [1, 0.9, 1], i ? 0 : 1, i ? 0.1 : 0.13), 'facet', P.leaf[i % 3],
    place(x * s, y * s, z * s, { ry: i * 0.9 + seed }), base, false, [0.35 * s, 1.25 * s, 0.8, 1.1]));
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + seed, rr = 0.31 * s;
    ctx.add(new THREE.IcosahedronGeometry(0.038, 0), 'facet', P.blossom, place(Math.cos(a) * rr, (0.7 + (i % 2) * 0.22) * s, Math.sin(a) * rr * 0.6 + 0.15 * s), base, false);
  }
}

function pineTree(ctx, thing, base, s, seed) {
  ctx.add(new THREE.CylinderGeometry(0.045, 0.075, 0.4, 7), 'facet', P.trunk, place(0, 0.2, 0), base);
  const tiers = [[0.42, 0.34, 0.5], [0.66, 0.27, 0.42], [0.88, 0.19, 0.34]];
  tiers.forEach(([y, r, h], i) => ctx.add(new THREE.ConeGeometry(r * s, h * s, 7), 'facet', P.leaf[(i + 2) % 3],
    place(0, (y + h / 2 - 0.05) * s, 0, { ry: i * 0.5 + seed }), base, false, [0.3 * s, 1.2 * s, 0.82, 1.1]));
}

export const NATURE = {
  // Faceted trees: mostly round with white blossoms, sometimes a stacked pine. The old (first) tree is always round.
  tree(ctx, thing, base) {
    const seed = seedOf(thing);
    const s = 0.9 + hash01(thing.c, thing.r, 2) * 0.3;
    if (!thing.old && hashString(`${thing.id}:pine`) < 0.3) pineTree(ctx, thing, base, s, seed);
    else roundTree(ctx, thing, base, thing.old ? 1.12 : s, seed);
    ctx.blob(base, 0.95 * s);
  },

  // Angular grey-lilac rocks: a big chunk and two small ones with broad flat faces.
  rock(ctx, thing, base) {
    const seed = seedOf(thing);
    const s = 0.95 + hash01(thing.c, thing.r, 3) * 0.2;
    const parts = [
      [0, 0.17, 0, 0.3, [1.2, 0.74, 1], P.boulder],
      [0.26, 0.1, 0.12, 0.17, [1, 0.85, 1.1], P.lilac],
      [-0.22, 0.08, 0.15, 0.13, [1.1, 0.8, 1], P.stoneDark],
    ];
    parts.forEach(([x, y, z, r, squash, color], i) => ctx.add(chunk(r * s, seed + i * 7 + 1, squash, 0, 0.18), 'facet', color,
      place(x * s, y * s, z * s, { ry: i * 1.3 + seed, rz: (i - 1) * 0.15 }), base, true, [0, 0.45, 0.88, 1.06]));
    ctx.blob(base, 0.95 * s, 0.8 * s, 0, 0.03);
  },

  bush(ctx, thing, base) {
    const seed = seedOf(thing);
    for (const [x, z, r, i] of [[0, 0, 0.2, 0], [0.17, 0.08, 0.15, 1], [-0.15, 0.07, 0.14, 2]]) {
      ctx.add(chunk(r, i + seed, [1, 0.85, 1], 1, 0.08), 'facet', P.leaf[i % 3], place(x, r * 0.8, z, { ry: i }), base, true, [0, 0.4, 0.8, 1.1]);
    }
    const berry = P.flower[1 + Math.floor(hashString(thing.id) * 3) % 3];
    for (const [x, y, z] of [[0.05, 0.3, 0.14], [-0.1, 0.22, 0.17], [0.19, 0.2, 0.17]]) ctx.add(new THREE.IcosahedronGeometry(0.032, 0), 'facet', berry, place(x, y, z), base, false);
    ctx.blob(base, 0.7);
  },

  // A patch of daisies in two or three colours.
  flower(ctx, thing, base) {
    const seed = hashString(thing.id);
    const colours = [P.flower[Math.floor(seed * 5) % 5], P.flower[(Math.floor(seed * 5) + 2) % 5], P.white];
    const spots = [[-0.15, -0.1], [0.12, -0.14], [0.02, 0.04], [-0.13, 0.16], [0.17, 0.12], [0.0, -0.22], [-0.2, 0.0]];
    spots.forEach(([x, z], i) => {
      const h = 0.09 + hash01(i, seed * 9, 4) * 0.06;
      ctx.add(new THREE.CylinderGeometry(0.008, 0.01, h, 4), 'matte', P.grassSide, place(x, h / 2, z), base, false);
      ctx.add(new THREE.CylinderGeometry(0.048, 0.04, 0.018, 7), 'facet', colours[i % 3], place(x, h + 0.008, z, { rx: 0.25, ry: i }), base, false);
      ctx.add(new THREE.IcosahedronGeometry(0.018, 0), 'facet', '#ffcf3a', place(x, h + 0.022, z), base, false);
    });
    for (const [x, z] of [[0.08, 0.2], [-0.06, -0.06], [0.2, -0.02]]) ctx.add(chunk(0.06, x * 50, [1, 0.6, 1], 0, 0.1), 'facet', P.leaf[1], place(x, 0.025, z), base, false);
  },

  // Storage pile: stacked logs, a few stones and planks on a little pallet.
  pile(ctx, thing, base) {
    ctx.add(rbox(0.5, 0.04, 0.42, 0.006, R), 'matte', P.plankDark, place(-0.03, 0.02, 0), base);
    for (const [x, y, z] of [[-0.05, 0.1, -0.08], [-0.05, 0.1, 0.08], [-0.05, 0.22, 0]]) ctx.add(logGeometry(0.42, 0.065, P.log, P.logCut, 8), 'facet', null, place(x, y, z), base);
    for (const [x, z, r, color] of [[0.27, 0.12, 0.08, P.lilac], [0.3, -0.05, 0.065, P.stone], [0.22, 0.02, 0.05, P.boulder]]) ctx.add(chunk(r, x * 10), 'facet', color, place(x, r * 0.7, z), base);
    for (let i = 0; i < 2; i++) ctx.add(rbox(0.4, 0.035, 0.1, 0.005, R), 'matte', i ? P.plank : P.plankDark, place(-0.05, 0.02 + i * 0.035, -0.25, { ry: i * 0.15 }), base);
    ctx.blob(base, 0.75);
  },

  // Campfire: stone ring and log teepee. Lit in break, low when away, embers at night, cold by day.
  fire(ctx, thing, base) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.add(chunk(0.055, i * 3 + 1, [1, 0.7, 1]), 'facet', i % 2 ? P.stone : P.trim, place(Math.cos(a) * 0.19, 0.035, Math.sin(a) * 0.19, { ry: i }), base);
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.3;
      ctx.add(logGeometry(0.26, 0.03, P.log, P.logCut, 6), 'facet', null, place(Math.cos(a) * 0.05, 0.07, Math.sin(a) * 0.05, { ry: -a, rz: 0.55 }), base);
    }
    const at = new THREE.Vector3().setFromMatrixPosition(base);
    // The ash bed changes colour with the mood, so it is its own small mesh.
    const bedMaterial = new THREE.MeshStandardMaterial({ color: P.ash, roughness: 0.9, emissive: '#ff7a3a', emissiveIntensity: 0 });
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 16), bedMaterial);
    bed.position.set(at.x, at.y + 0.011, at.z);
    bed.receiveShadow = true;
    const flames = new THREE.Group();
    flames.position.set(at.x, at.y + 0.03, at.z);
    const shape = teardrop(0.34, 0.09, 14);
    const parts = [[1, '#ff7a3a', 0, 0, 0], [0.7, '#ff9d3f', 0.05, 0.03, -0.35], [0.66, '#ff9d3f', -0.05, 0.02, 0.35], [0.5, '#ffe28a', 0, 0.05, 0]].map(([s, color, x, z, tilt]) => {
      const material = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(shape, material);
      mesh.position.set(x, 0, z); mesh.rotation.z = tilt; mesh.scale.setScalar(s); mesh.userData.s = s;
      flames.add(mesh);
      ctx.track(material);
      return mesh;
    });
    // Warm light pooled on the grass (a flat soft disc, so it never cuts a hard line where it meets
    // the ground), and a small halo around the flames that stays clear of the ground.
    const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff7f30', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glowShape = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const glow = new THREE.Mesh(glowShape, glowMaterial);
    glow.position.set(at.x, at.y + 0.02, at.z);
    glow.renderOrder = 2;
    const haloMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a50', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.set(at.x, at.y + 0.3, at.z);
    halo.scale.setScalar(0.42);
    halo.renderOrder = 2;
    const light = new THREE.PointLight('#ff9550', 0, 3.0, 1.8);
    light.position.set(at.x, at.y + 0.45, at.z);
    ctx.root.add(bed, flames, glow, halo, light);
    ctx.track(bedMaterial, bed.geometry, shape, glowMaterial, glowShape, haloMaterial);
    let level = 0, size = 1;
    ctx.onMood((name, mood) => {
      level = { lit: 1, low: 0.6, embers: 0.2, out: 0 }[mood.fire] ?? 0;
      size = mood.fire === 'low' ? 0.62 : 1;
      flames.visible = level >= 0.5;
      flames.scale.setScalar(size);
      glow.visible = level > 0;
      glow.scale.setScalar(level >= 0.5 ? 1.9 * size : 0.9);
      glowMaterial.opacity = level >= 0.5 ? 0.3 : 0.26;
      halo.visible = level >= 0.5;
      bedMaterial.color.set(level > 0 ? P.ember : P.ash);
      bedMaterial.emissiveIntensity = level > 0 ? 0.35 + level * 0.5 : 0;
      light.intensity = level >= 0.5 ? 2.2 * size : level * 1.6;
      light.visible = level > 0;
    });
    ctx.dynamic.push(t => {
      if (!flames.visible) return;
      parts.forEach((m, i) => m.scale.set(m.userData.s * (1 + Math.sin(t * 8 + i) * 0.06), m.userData.s * (1 + Math.sin(t * 10.5 + i * 2) * 0.16), m.userData.s));
      light.intensity = (2.2 + Math.sin(t * 11) * 0.35 + Math.sin(t * 6.3) * 0.25) * size;
    });
  },

  // A log to sit on. It lies across the thing's facing, so a sitter faces the way the seat faces.
  seat(ctx, thing, base) {
    // A chunky log resting slightly into the grass (its top is at sitting height), with a soft shadow.
    ctx.add(logGeometry(0.44, 0.068, P.log, P.logCut, 9), 'facet', null, place(0, 0.052, 0), base);
    ctx.blob(base, 0.66, 0.4, 0, 0.02);
    ctx.blob(base, 0.5, 0.26, 0, 0.02);
  },

  // Bright red-capped mushrooms with white spots, one big and two small.
  mushroom(ctx, thing, base) {
    const seed = seedOf(thing);
    const caps = [[0, 0, 1, 0], [0.18, 0.1, 0.62, 0.4], [-0.15, 0.12, 0.5, -0.3]];
    caps.forEach(([x, z, s, tilt], i) => {
      const stemH = 0.2 * s, capR = 0.17 * s;
      ctx.add(new THREE.CylinderGeometry(0.045 * s, 0.06 * s, stemH, 8), 'matte', P.mushroomStem, place(x, stemH / 2, z, { rz: tilt * 0.3 }), base);
      const cap = new THREE.SphereGeometry(capR, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1);
      ctx.add(cap, 'facet', P.mushroomCap, place(x + tilt * 0.03, stemH - 0.01, z, { rz: tilt * 0.3, ry: seed + i }), base, false);
      ctx.add(new THREE.CylinderGeometry(capR * 0.98, capR * 0.9, 0.02, 10), 'matte', P.mushroomStem, place(x + tilt * 0.03, stemH - 0.005, z, { rz: tilt * 0.3 }), base, false);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.6 + seed + i, rr = capR * 0.55;
        ctx.add(new THREE.SphereGeometry(0.022 * s + 0.008, 6, 4).scale(1, 0.45, 1), 'matte', P.white,
          place(x + tilt * 0.03 + Math.cos(a) * rr, stemH + capR * 0.52 - (k ? 0.012 : -0.01), z + Math.sin(a) * rr, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }), base, false);
      }
    });
    ctx.blob(base, 0.6);
  },

  // A cluster of glowing crystals on a rocky base.
  crystal(ctx, thing, base) {
    const seed = seedOf(thing);
    const colour = P.crystal[Math.floor(hashString(thing.id) * 3) % 3];
    ctx.add(chunk(0.2, seed, [1.3, 0.5, 1.1]), 'facet', P.lilacDeep, place(0, 0.05, 0), base);
    const spikes = [[0, 0, 0.62, 0.09, 0, 0], [0.13, 0.05, 0.4, 0.065, 0.35, 0.2], [-0.12, 0.07, 0.36, 0.06, -0.4, -0.1], [0.04, -0.12, 0.3, 0.055, 0.15, -0.45]];
    spikes.forEach(([x, z, h, r, rz, rx], i) => ctx.add(crystalGeometry(h, r), 'shine', i % 2 ? P.white : colour, place(x, 0.04, z, { rz, rx, ry: seed + i }), base, false));
    ctx.blob(base, 0.6);
  },
};

// Tiny lawn decorations on free grass: a little flower or a grass tuft. roll is 0..1.
export function decor(ctx, base, roll) {
  if (roll < 0.55) {
    const color = P.flower[Math.floor(roll * 9) % 3];
    ctx.add(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), 'matte', P.grassSide, place(0, 0.05, 0), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.042, 0), 'facet', color, place(0, 0.11, 0), base, false);
  } else {
    ctx.add(chunk(0.1, roll * 20, [1, 0.75, 1], 1, 0.08), 'facet', P.leaf[1], place(0, 0.06, 0), base, true, [0, 0.14, 0.85, 1.1]);
  }
}
