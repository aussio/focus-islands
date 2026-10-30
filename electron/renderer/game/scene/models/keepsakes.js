// Keepsakes: the small things a surprise leaves for good (rules.js KEEPSAKES, kinds.js). Each stands on
// one point, about half a cell across; all but the fountain stand on the coast facing out (+z is out).
// Same signature as every model (models/index.js). Looks vary by the thing's id only.
//
// - fountain: a round stone basin by the square, a little pedestal bowl, four water jets, and two soft
//   ripples that spread across the basin (ctx.dynamic; still at time 0).
// - well: a stone well under a small roof, with a bucket on a rope and a coin glinting in the water.
// - bench: a plank bench for watching the clouds.
// - cairn: smooth stones stacked into a little tower.
// - telescope: a brass telescope on a tripod, pointing up and out.
// - birdhouse: a birdhouse on a post, with a small bird on its perch.
// - lamp: a lamp post whose lantern glows after dark, with a warm pool of light on the grass.
import * as THREE from 'three';
import { place, hashString } from '../ground.js';
import { rbox, chunk, logGeometry, gableGeometry, glowTexture } from '../parts.js';
import { P, HOUSE_LOOKS } from '../style.js';

const R = 1; // rounded-box segments: one keeps each box at about 50 triangles
const K = {
  water: '#8fd0ff', waterDeep: '#5f86b8', brass: '#e2b44f', brassDark: '#b98a2e', coin: '#ffd25e',
  bird: '#ff9a85', beak: '#ffc04d', pole: '#6b6f86', lamp: '#fff1c4',
};
const pick = (list, id, what) => list[Math.floor(hashString(`${id}:${what}`) * list.length) % list.length];

export const KEEPSAKES = {
  fountain(ctx, thing, base) {
    // The basin: a low stone drum with a pale rim, and water inside.
    ctx.add(new THREE.CylinderGeometry(0.25, 0.28, 0.1, 18), 'matte', P.stone, place(0, 0.05, 0), base);
    ctx.add(new THREE.TorusGeometry(0.245, 0.03, 4, 18).rotateX(Math.PI / 2), 'matte', P.trim, place(0, 0.105, 0), base, false);
    ctx.add(new THREE.CircleGeometry(0.225, 18).rotateX(-Math.PI / 2), 'matte', K.water, place(0, 0.104, 0), base, false);
    // The pedestal and its little bowl.
    ctx.add(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 8), 'matte', P.trim, place(0, 0.2, 0), base, false);
    ctx.add(new THREE.CylinderGeometry(0.1, 0.055, 0.05, 12), 'matte', P.stone, place(0, 0.31, 0), base, false);
    ctx.add(new THREE.CircleGeometry(0.085, 12).rotateX(-Math.PI / 2), 'matte', K.water, place(0, 0.336, 0), base, false);
    // Four little jets arching from the bowl down into the basin: beads of water along each arc.
    for (let j = 0; j < 4; j++) {
      const a = j / 4 * Math.PI * 2 + Math.PI / 4;
      for (let k = 0; k < 3; k++) {
        const u = (k + 1) / 4, r = 0.06 + u * 0.12, y = 0.36 + 0.07 * Math.sin(Math.PI * u * 0.9) - u * 0.2;
        ctx.add(new THREE.IcosahedronGeometry(0.018 - k * 0.002, 0), 'matte', '#d8f0ff', place(Math.cos(a) * r, y, Math.sin(a) * r), base, false);
      }
    }
    ctx.add(new THREE.IcosahedronGeometry(0.03, 1), 'matte', '#e4f5ff', place(0, 0.36, 0, { sy: 1.4 }), base, false);
    ctx.blob(base, 0.75);
    // Two soft rings spreading across the water, one after the other.
    const ringShape = new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2);
    const rings = [0, 1].map(() => {
      const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ringShape, material);
      mesh.renderOrder = 2;
      ctx.root.add(mesh);
      ctx.track(material);
      return mesh;
    });
    ctx.track(ringShape);
    const at = new THREE.Vector3(0, 0.108, 0).applyMatrix4(base);
    const scale = new THREE.Vector3().setFromMatrixScale(base).x;
    const update = t => {
      rings.forEach((ring, i) => {
        const u = ((t * 0.35 + i * 0.5) % 1 + 1) % 1;
        ring.position.copy(at);
        ring.scale.setScalar((0.06 + u * 0.15) * scale);
        ring.material.opacity = 0.45 * (1 - u) * Math.min(1, u * 6);
      });
    };
    update(0);
    ctx.dynamic.push(update);
  },

  well(ctx, thing, base) {
    // The round stone wall, with a ring of stones on top and dark water inside.
    ctx.add(new THREE.CylinderGeometry(0.16, 0.175, 0.17, 12), 'facet', P.stone, place(0, 0.085, 0), base);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      ctx.add(chunk(0.04, i * 5 + 3, [1.2, 0.6, 1]), 'facet', i % 3 ? P.boulder : P.trim, place(Math.cos(a) * 0.15, 0.18, Math.sin(a) * 0.15, { ry: -a }), base, false);
    }
    ctx.add(new THREE.CircleGeometry(0.125, 12).rotateX(-Math.PI / 2), 'matte', K.waterDeep, place(0, 0.172, 0), base, false);
    // A coin glinting at the bottom (it glows a little at night).
    ctx.add(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 8), 'glow', K.coin, place(0.04, 0.175, 0.03), base, false);
    // Two posts, a crossbar with a crank, and a little roof.
    for (const x of [-0.17, 0.17]) ctx.add(new THREE.BoxGeometry(0.035, 0.36, 0.035), 'matte', P.post, place(x, 0.18 + 0.18, 0), base, false);
    ctx.add(logGeometry(0.4, 0.016, P.log, P.logCut, 6), 'facet', null, place(0, 0.42, 0), base, false);
    ctx.add(new THREE.BoxGeometry(0.02, 0.07, 0.02), 'matte', P.handle, place(0.215, 0.39, 0.03), base, false);
    const roof = pick(HOUSE_LOOKS, thing.id, 'roof').roof;
    for (const side of [-1, 1]) ctx.add(rbox(0.46, 0.02, 0.2, 0.004, 1), 'matte', roof, place(0, 0.53, side * 0.075, { rx: side * 0.62 }), base, false);
    ctx.add(gableGeometry(0.36, 0.22, 0.1), 'matte', P.plankDark, place(0, 0.45, 0), base, false);
    // The bucket on its rope.
    ctx.add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3), 'matte', P.rope, place(0, 0.36, 0), base, false);
    ctx.add(new THREE.CylinderGeometry(0.035, 0.028, 0.05, 8), 'matte', P.plank, place(0, 0.28, 0), base, false);
    ctx.blob(base, 0.55);
  },

  bench(ctx, thing, base) {
    // Seat, back and legs; the sitter faces +z, out to the sky.
    ctx.add(rbox(0.42, 0.025, 0.12, 0.008, R), 'matte', P.plank, place(0, 0.13, 0.01), base);
    for (const x of [-0.17, 0.17]) {
      ctx.add(new THREE.BoxGeometry(0.03, 0.13, 0.1), 'matte', P.plankDark, place(x, 0.065, 0.01), base);
      ctx.add(new THREE.BoxGeometry(0.026, 0.2, 0.026), 'matte', P.plankDark, place(x, 0.2, -0.05, { rx: -0.12 }), base, false);
    }
    for (const y of [0.22, 0.28]) ctx.add(rbox(0.42, 0.04, 0.018, 0.006, R), 'matte', P.plank, place(0, y, -0.055 + (y - 0.22) * -0.12, { rx: -0.12 }), base, false);
    ctx.blob(base, 0.5, 0.26);
  },

  cairn(ctx, thing, base) {
    // Four or five smooth stones, each smaller than the one below, a little off-centre.
    const count = 4 + Math.floor(hashString(`${thing.id}:stones`) * 2);
    const colours = [P.stone, P.boulder, P.lilac, P.trim, P.stoneDark];
    let y = 0;
    for (let i = 0; i < count; i++) {
      const r = 0.11 * (1 - i * 0.15), h = r * 0.62;
      const dx = (hashString(`${thing.id}:x${i}`) - 0.5) * 0.03, dz = (hashString(`${thing.id}:z${i}`) - 0.5) * 0.03;
      ctx.add(chunk(r, i * 7 + 1, [1, 0.62, 0.9], 1, 0.05), 'matte', colours[(i + Math.floor(hashString(`${thing.id}:hue`) * 5)) % colours.length], place(dx, y + h * 0.9, dz, { ry: i * 1.3 }), base, i === 0);
      y += h * 1.65;
    }
    ctx.blob(base, 0.42);
  },

  telescope(ctx, thing, base) {
    // A tripod meeting at the head, and a brass tube tipped up and out (+z).
    const head = new THREE.Vector3(0, 0.3, 0);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + Math.PI;
      const foot = new THREE.Vector3(Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12);
      ctx.add(new THREE.CylinderGeometry(0.008, 0.01, foot.distanceTo(head), 5), 'matte', P.post, between(foot, head), base, false);
    }
    const tilt = -0.5; // rx: tips the tube's front (+z) up
    ctx.add(new THREE.CylinderGeometry(0.032, 0.024, 0.32, 10).rotateX(Math.PI / 2), 'matte', K.brass, place(0, 0.34, 0.02, { rx: tilt }), base, false);
    for (const z of [-0.1, 0.06, 0.17]) ctx.add(new THREE.CylinderGeometry(0.035, 0.035, 0.014, 10).rotateX(Math.PI / 2), 'matte', K.brassDark, place(0, 0.34 - z * Math.sin(tilt), 0.02 + z * Math.cos(tilt), { rx: tilt }), base, false);
    ctx.add(new THREE.CircleGeometry(0.03, 10), 'glass', P.glass, place(0, 0.34 + 0.161 * Math.sin(-tilt), 0.02 + 0.161 * Math.cos(tilt), { rx: tilt }), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.022, 0), 'facet', K.brassDark, place(head.x, head.y + 0.01, head.z), base, false);
    ctx.blob(base, 0.36);
  },

  birdhouse(ctx, thing, base) {
    // A post, a little house in one of the house colours, its roof, a round door and a perch.
    const look = pick(HOUSE_LOOKS, thing.id, 'look');
    ctx.add(new THREE.BoxGeometry(0.035, 0.34, 0.035), 'matte', P.post, place(0, 0.17, 0), base);
    ctx.add(rbox(0.14, 0.15, 0.13, 0.012, R), 'matte', look.wall, place(0, 0.41, 0), base, false);
    for (const side of [-1, 1]) ctx.add(rbox(0.11, 0.016, 0.2, 0.004, 1), 'matte', look.roof, place(side * 0.045, 0.515, 0, { rz: -side * 0.75 }), base, false);
    ctx.add(new THREE.CircleGeometry(0.026, 10), 'matte', '#4a3b45', place(0, 0.43, 0.0655), base, false);
    ctx.add(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 4).rotateX(Math.PI / 2), 'matte', P.post, place(0, 0.38, 0.09), base, false);
    // The bird on the perch: a round body, a head and a beak.
    const bird = pick([K.bird, '#7cc8ff', '#ffd25e'], thing.id, 'bird');
    ctx.add(new THREE.IcosahedronGeometry(0.022, 1), 'matte', bird, place(0, 0.4, 0.105, { sy: 0.9, sz: 1.2 }), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.015, 1), 'matte', bird, place(0, 0.428, 0.118), base, false);
    ctx.add(new THREE.ConeGeometry(0.006, 0.016, 4).rotateX(Math.PI / 2), 'matte', K.beak, place(0, 0.428, 0.136), base, false);
    ctx.blob(base, 0.24);
  },

  lamp(ctx, thing, base) {
    // A stone foot, a dark pole, a crossarm and a hanging lantern with glowing panes.
    ctx.add(rbox(0.1, 0.05, 0.1, 0.014, R), 'matte', P.stone, place(0, 0.025, 0), base);
    ctx.add(new THREE.CylinderGeometry(0.014, 0.018, 0.56, 6), 'matte', K.pole, place(0, 0.05 + 0.28, 0), base, false);
    ctx.add(new THREE.BoxGeometry(0.12, 0.016, 0.016), 'matte', K.pole, place(0.05, 0.6, 0), base, false);
    ctx.add(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 3), 'matte', K.pole, place(0.1, 0.58, 0), base, false);
    ctx.add(rbox(0.06, 0.075, 0.06, 0.006, 1), 'glow', K.lamp, place(0.1, 0.525, 0), base, false);
    ctx.add(new THREE.ConeGeometry(0.05, 0.035, 4).rotateY(Math.PI / 4), 'facet', K.pole, place(0.1, 0.578, 0), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.018, 0), 'facet', K.pole, place(0, 0.625, 0), base, false);
    ctx.blob(base, 0.22);
    // A warm pool on the grass and a soft halo, after dark only.
    const poolMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffc56a', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const haloMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffc56a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(plane, poolMaterial);
    pool.position.copy(new THREE.Vector3(0.05, 0.02, 0).applyMatrix4(base));
    pool.scale.setScalar(0.6);
    pool.renderOrder = 2;
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.copy(new THREE.Vector3(0.1, 0.525, 0).applyMatrix4(base));
    halo.scale.setScalar(0.28);
    halo.renderOrder = 2;
    pool.visible = halo.visible = false;
    ctx.root.add(pool, halo);
    ctx.track(poolMaterial, haloMaterial, plane);
    ctx.onMood((name, mood) => {
      const on = mood?.windows || 0;
      pool.visible = halo.visible = on > 0;
      poolMaterial.opacity = 0.12 + on * 0.1;
      haloMaterial.opacity = 0.24 + on * 0.16;
    });
  },
};

// A matrix that stands a y-axis shape (centred, of length |b - a|) from point a to point b.
function between(a, b) {
  const middle = a.clone().add(b).multiplyScalar(0.5);
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return new THREE.Matrix4().compose(middle, turn, new THREE.Vector3(1, 1, 1));
}
