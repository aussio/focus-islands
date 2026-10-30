// Tiny helpers: a simple rounded figure with a strong coloured silhouette (shirt + hat), a tool for
// each job, an item for each resource they carry (a full bucket for water), and break extras (fishing
// lines, sleepy Zs).
// Adding a job = one tool here, one entry in town/walk.js WORK, and a pose in motion.js if it moves differently.
import * as THREE from 'three';
import { createRig, toolMount } from './motion.js';
import { P } from './style.js';
import { textTexture, blobTexture } from './parts.js';

export const HELPER_SCALE = 0.48;

// Materials are shared between helpers (keyed by colour), and disposed with the helper set.
export function helperMaterials() {
  const cache = new Map();
  const M = (color, extra = {}) => {
    const k = color + JSON.stringify(extra);
    if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra }));
    return cache.get(k);
  };
  M.dispose = () => { for (const material of cache.values()) material.dispose(); cache.clear(); };
  M.blob = new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#3a4a7a', transparent: true, opacity: 0.3, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const dispose = M.dispose;
  M.dispose = () => { dispose(); M.blob.dispose(); };
  return M;
}

// Geometry is shared by every helper; helpers differ only in materials.
let shared = null;
function geometries() {
  if (shared) return shared;
  const seg = 12;
  shared = {
    leg: new THREE.CapsuleGeometry(0.052, 0.1, 3, seg).translate(0, -0.1, 0),
    boot: new THREE.SphereGeometry(0.06, seg, 6).scale(1, 0.6, 1.3),
    torso: new THREE.CapsuleGeometry(0.135, 0.12, 4, seg + 2),
    head: new THREE.SphereGeometry(0.155, seg + 4, seg),
    eye: new THREE.SphereGeometry(0.024, 8, 6),
    sleeve: new THREE.CapsuleGeometry(0.04, 0.1, 3, seg).translate(0, -0.08, 0),
    hand: new THREE.SphereGeometry(0.045, seg, 6),
    blob: new THREE.CircleGeometry(0.28, 18).rotateX(-Math.PI / 2),
  };
  for (const geometry of Object.values(shared)) geometry.userData.shared = true;
  return shared;
}

export function buildHelper(look, M) {
  const G = geometries();
  const rig = createRig({ hipY: 0.2, hipX: 0.065, shoulderY: 0.27, shoulderX: 0.155, neckY: 0.33, armLength: 0.18, headRadius: 0.155, bodyHalfWidth: 0.14, scale: HELPER_SCALE });
  for (const leg of [rig.legL, rig.legR]) {
    const boot = new THREE.Mesh(G.boot, M(look.boots ?? '#5a4136'));
    boot.position.set(0, -0.18, 0.02);
    leg.add(new THREE.Mesh(G.leg, M(look.pants)), boot);
  }
  const torso = new THREE.Mesh(G.torso, M(look.shirt));
  torso.scale.set(1, 1, 0.85);
  torso.position.y = 0.15;
  rig.body.add(torso);
  const head = new THREE.Mesh(G.head, M(look.skin ?? '#ffd7bf'));
  head.position.y = 0.14;
  rig.head.add(head);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(G.eye, M('#2c2533', { roughness: 0.3 }));
    eye.position.set(x, 0.15, 0.142);
    rig.head.add(eye);
  }
  rig.head.add(hat(look, M));
  for (const arm of [rig.armL, rig.armR]) {
    const hand = new THREE.Mesh(G.hand, M(look.skin ?? '#ffd7bf'));
    hand.position.y = -0.18;
    arm.add(new THREE.Mesh(G.sleeve, M(look.shirt)), hand);
  }
  addTools(rig, M);
  addItems(rig, M);
  // A soft round shadow instead of a real one, so the island's shadows can be drawn once and kept.
  const blob = new THREE.Mesh(G.blob, M.blob);
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  rig.root.add(blob);
  rig.blob = blob;
  return rig;
}

function addTools(rig, M) {
  const wood = M(P.handle), steel = M(P.steel);
  const handle = (length, radius = 0.02) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6).rotateX(Math.PI / 2), wood);
    mesh.position.z = length / 2 - 0.06;
    return mesh;
  };
  toolMount(rig, 'axe', mount => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.11), steel);
    blade.position.set(0, 0.06, 0.33);
    mount.add(handle(0.44), blade);
  });
  toolMount(rig, 'pick', mount => {
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.3, 2, 6), steel);
    head.position.set(0, 0, 0.36);
    mount.add(handle(0.44), head);
  });
  toolMount(rig, 'hammer', mount => {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), steel);
    head.position.set(0, 0, 0.25);
    mount.add(handle(0.32, 0.018), head);
  });
  toolMount(rig, 'saw', mount => {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.1), M('#e9553f'));
    grip.position.set(0, -0.01, 0.03);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.4), steel);
    blade.position.set(0, -0.03, 0.27);
    mount.add(grip, blade);
  });
  toolMount(rig, 'hoe', mount => {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.025), steel);
    blade.position.set(0, -0.05, 0.5);
    mount.add(handle(0.6), blade);
  });
  // The water carrier's bucket, held by its handle. motion.js hangs it straight down from the hand and
  // raises the water in it (rig.pailWater) while it fills at the rain catcher; it walks back empty.
  toolMount(rig, 'pail', mount => {
    const { group, water } = woodenBucket(M);
    group.position.y = -0.125;
    water.visible = false;
    water.userData.low = BUCKET.bottom + 0.012;
    water.userData.high = BUCKET.top - 0.012;
    mount.add(group);
    rig.pailWater = water;
  });
  // The fishing rod is held in both hands at the chest and points out to the helper's right and a
  // little up. (Held straight out in front it would point at the raised camera and vanish.)
  const rodMount = new THREE.Group();
  rodMount.position.copy(rig.carry.position).add(new THREE.Vector3(-0.04, -0.02, -0.04));
  rodMount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.78, 0.36, 0.52).normalize());
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.026, 1.15, 6).rotateX(Math.PI / 2), wood);
  rod.position.z = 0.5;
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10).rotateZ(Math.PI / 2), steel);
  reel.position.set(0, -0.04, 0.08);
  rig.rodTip = new THREE.Object3D();
  rig.rodTip.position.z = 1.07;
  rodMount.add(rod, reel, rig.rodTip);
  rodMount.visible = false;
  rig.body.add(rodMount);
  rig.tools.rod = rodMount;
}

// A small wooden bucket for the water carrier: light honey staves (so it stands out against the rain
// catcher's darker barrels), two blue hoops, a wire handle and the water inside.
// Its middle is at y = 0; the handle's arc rises from the rim. Returns the parts the callers move.
const BUCKET = { top: 0.065, bottom: -0.065, rimRadius: 0.085 };
function woodenBucket(M) {
  const group = new THREE.Group();
  const staves = new THREE.Mesh(new THREE.CylinderGeometry(BUCKET.rimRadius, 0.066, BUCKET.top - BUCKET.bottom, 10), M('#e0a96d', { flatShading: true }));
  const hoopGeometry = new THREE.TorusGeometry(0.083, 0.011, 4, 14).rotateX(Math.PI / 2);
  const hoop = new THREE.Mesh(hoopGeometry, M('#3a98ec'));
  hoop.position.y = 0.03;
  const lowHoop = new THREE.Mesh(hoopGeometry, M('#3a98ec'));
  lowHoop.scale.setScalar(0.85);
  lowHoop.position.y = -0.04;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.07, 0.012, 12), M('#5cb8ff'));
  water.position.y = BUCKET.top - 0.012;
  const bail = new THREE.Group();
  bail.position.y = BUCKET.top;
  const wire = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 4, 12, Math.PI), M('#e3e7ef'));
  bail.add(wire);
  group.add(staves, hoop, lowHoop, water, bail);
  return { group, water, bail };
}

// Things a helper can carry (one per resource).
function addItems(rig, M) {
  const items = {
    log: () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), M(P.log)); m.rotation.z = Math.PI / 2; return m; },
    stone: () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), M(P.lilac, { flatShading: true })),
    plank: () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.045, 0.13), M(P.plank)); m.position.y = 0.03; return m; },
    sack: () => {
      const group = new THREE.Group();
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8).scale(1, 0.85, 0.9), M('#d9a86c'));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.06, 8), M('#c48f55'));
      neck.position.y = 0.1;
      const soil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M('#8a5a3c'));
      soil.position.y = 0.14;
      group.add(bag, neck, soil);
      return group;
    },
    // A full bucket of water, hugged in front with both hands, its handle laid back.
    bucket: () => {
      const { group, water, bail } = woodenBucket(M);
      water.position.y = BUCKET.top - 0.012;
      bail.rotation.x = -1.1;
      group.scale.setScalar(1.15);
      return group;
    },
  };
  for (const [name, make] of Object.entries(items)) {
    const holder = new THREE.Group();
    holder.add(make());
    holder.visible = false;
    rig.carry.add(holder);
    rig.items[name] = holder;
  }
}

function hat(look, M) {
  const seg = 12;
  const group = new THREE.Group();
  const c = look.hatColor ?? '#e2553f';
  if (look.hat === 'hood') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, seg + 2), M(c));
    cone.position.set(0, 0.36, -0.02); cone.rotation.x = -0.2;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 6, seg + 6), M(c));
    brim.rotation.x = Math.PI / 2; brim.position.y = 0.22;
    group.add(cone, brim);
  } else if (look.hat === 'hardhat') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, seg + 4, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(c));
    dome.position.y = 0.2;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, seg + 6), M(c));
    brim.position.set(0, 0.2, 0.02);
    group.add(dome, brim);
  } else if (look.hat === 'straw') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.03, seg + 8), M(c));
    brim.position.y = 0.22;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, seg + 4), M(c));
    crown.position.y = 0.28;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.151, 0.151, 0.03, seg + 4), M(look.bandColor ?? '#d9534f'));
    band.position.y = 0.245;
    group.add(brim, crown, band);
  } else if (look.hat === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.163, seg + 4, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(c));
    dome.position.y = 0.17;
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.025, seg + 4, 1, false, -Math.PI / 2, Math.PI), M(c));
    peak.position.set(0, 0.18, 0.1);
    group.add(dome, peak);
  } else {
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.165, seg + 4, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), M(c));
    beanie.position.y = 0.16;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, seg, 6), M(look.pomColor ?? '#ffffff'));
    pom.position.y = 0.34;
    group.add(beanie, pom);
  }
  return group;
}

// Fishing lines and sleepy Zs for whichever helpers are fishing or sleeping, and a splash for helpers
// whose routine lands in a water slide's pool. Returns { update(t), dispose() }. A plan's own fishBottom
// (town islands float at different heights) wins over bottomY.
const tipPos = new THREE.Vector3(), headPos = new THREE.Vector3();
const SPLASH_DROPS = 7;
export function restExtras(parent, rigs, plans, { bottomY }) {
  const updates = [];
  const disposables = [];
  const zTexture = textTexture('z', { font: '900 54px ui-rounded, "SF Pro Rounded", sans-serif', color: '#ffffff', stroke: '#7a6bd0' });
  plans.forEach((plan, index) => {
    const rig = rigs[index];
    if (!rig || !plan) return;
    if (plan.rest === 'fish') {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const lineMaterial = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
      const line = new THREE.Line(geometry, lineMaterial);
      line.frustumCulled = false;
      const bobberGeometry = new THREE.SphereGeometry(0.04, 10, 8);
      const bobberMaterial = new THREE.MeshStandardMaterial({ color: '#ff5a4f', roughness: 0.5 });
      const bobber = new THREE.Mesh(bobberGeometry, bobberMaterial);
      parent.add(line, bobber);
      disposables.push(geometry, lineMaterial, bobberGeometry, bobberMaterial, line, bobber);
      updates.push(t => {
        const visible = Boolean(rig.rodTip && rig.tools.rod?.visible);
        line.visible = bobber.visible = visible;
        if (!visible) return;
        rig.rodTip.updateWorldMatrix(true, false);
        rig.rodTip.getWorldPosition(tipPos);
        parent.worldToLocal(tipPos);
        const bottom = (plan.fishBottom ?? bottomY) + Math.sin(t * 2.2 + index) * 0.04 + (rig.anim === 'reel' ? 0.3 : 0);
        geometry.attributes.position.array.set([tipPos.x, tipPos.y, tipPos.z, tipPos.x, bottom, tipPos.z]);
        geometry.attributes.position.needsUpdate = true;
        bobber.position.set(tipPos.x, bottom, tipPos.z);
      });
    }
    if (plan.line?.segments?.some(segment => segment.anim === 'splash')) {
      // Drops thrown up in a ring and a ripple spreading on the pool, while the helper splashes down.
      const dropGeometry = new THREE.IcosahedronGeometry(0.035, 0);
      const dropMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false });
      const drops = Array.from({ length: SPLASH_DROPS }, () => new THREE.Mesh(dropGeometry, dropMaterial));
      const rippleGeometry = new THREE.RingGeometry(0.8, 1, 24);
      rippleGeometry.rotateX(-Math.PI / 2);
      const rippleMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const ripple = new THREE.Mesh(rippleGeometry, rippleMaterial);
      parent.add(ripple, ...drops);
      disposables.push(dropGeometry, dropMaterial, rippleGeometry, rippleMaterial, ripple, ...drops);
      updates.push(() => {
        const on = rig.anim === 'splash';
        ripple.visible = on;
        for (const drop of drops) drop.visible = on;
        if (!on) return;
        const p = rig.animP ?? 0, k = rig.root.scale.x / HELPER_SCALE;
        const { x, y, z } = rig.root.position;
        const fade = Math.max(0, 1 - p * 1.15);
        dropMaterial.opacity = 0.9 * fade;
        rippleMaterial.opacity = 0.55 * fade;
        drops.forEach((drop, i) => {
          const a = (i / SPLASH_DROPS) * Math.PI * 2 + index;
          const r = (0.06 + p * 0.3) * k;
          drop.position.set(x + Math.sin(a) * r, y + (0.04 + Math.sin(Math.min(1, p * 1.4) * Math.PI) * (0.2 + (i % 3) * 0.05)) * k, z + Math.cos(a) * r);
          drop.scale.setScalar(Math.sqrt(k) * (1 - p * 0.5));
        });
        ripple.position.set(x, y + 0.012, z);
        ripple.scale.setScalar((0.12 + p * 0.3) * k);
      });
    }
    if (plan.rest === 'nap' || plan.rest === 'sleep') {
      const zs = [0, 1, 2].map(() => {
        const material = new THREE.SpriteMaterial({ map: zTexture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        parent.add(sprite);
        disposables.push(material, sprite);
        return sprite;
      });
      updates.push(t => {
        rig.head.updateWorldMatrix(true, false);
        rig.head.getWorldPosition(headPos);
        parent.worldToLocal(headPos);
        const k = rig.root.scale.x / HELPER_SCALE;
        zs.forEach((sprite, z) => {
          const u = (t * 0.32 + z / 3 + index * 0.17) % 1;
          sprite.visible = rig.anim === 'nap' || rig.anim === 'sleep';
          sprite.position.set(headPos.x + (0.06 + u * 0.22 + Math.sin(u * 6 + z) * 0.03) * k, headPos.y + (0.1 + u * 0.45) * k, headPos.z + 0.05 * k);
          sprite.material.opacity = Math.sin(u * Math.PI);
          const size = 0.24 * Math.sqrt(k) * (0.55 + u * 0.6);
          sprite.scale.set(size, size, size);
        });
      });
    }
  });
  return {
    update: t => { for (const update of updates) update(t); },
    dispose: () => {
      for (const item of disposables) {
        if (item.isObject3D) item.removeFromParent();
        else item.dispose();
      }
    },
  };
}
