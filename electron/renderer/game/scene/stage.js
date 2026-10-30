// The stage around the island: sky, light, clouds, stars, moon, fireflies and the camera.
// Moods change only what is here (plus window glow and the fire); the island itself is untouched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MOODS, moodOf } from './style.js';
import { blobTexture, glowTexture, moonTexture, skyTexture } from './parts.js';
import { hash01 } from './ground.js';

const ELEVATION = 0.8; // about 46 degrees above the horizon: the base-builder view
const FOV = 20; // a narrow lens, so the island reads almost like a little map
const MAX_STARS = 160;

// The world point that appears at screen position (x, y) (-1..1, y up) at a given distance from the camera.
const ray = new THREE.Vector3();
function viewPoint(camera, x, y, depth) {
  ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(ray, depth);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloudGeometry(seed) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.5 + hash01(seed, i, 1) * 0.35;
    parts.push(new THREE.SphereGeometry(r, 16, 12).scale(1, 0.75, 1).translate((i - 2) * 0.55, Math.max(0, 0.2 - Math.abs(i - 2) * 0.12), hash01(seed, i, 2) * 0.3).toNonIndexed());
  }
  const merged = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  return merged;
}

// Fits the camera so every point is in view with even margins, seen from the base-builder angle.
export function frameCamera(camera, points, aspect, margin = [0.9, 0.86]) {
  camera.fov = FOV;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const v = new THREE.Vector3();
  let target = 0, distance = 20;
  // The world is centred on x = 0 only roughly (tall things lean the box), so aim the camera sideways too.
  let side = 0;
  for (let pass = 0; pass < 4; pass++) {
    let lo = 1, hi = 400;
    for (let i = 0; i < 32; i++) {
      distance = (lo + hi) / 2;
      const e = extentsAt(side);
      if (e.x1 - e.x0 > margin[0] * 2 || e.y1 - e.y0 > margin[1] * 2) lo = distance; else hi = distance;
    }
    distance = hi;
    const e = extentsAt(side);
    const halfHeight = Math.tan(FOV * Math.PI / 360) * distance;
    target += (e.y0 + e.y1) / 2 * halfHeight * 0.9;
    side += (e.x0 + e.x1) / 2 * halfHeight * aspect * 0.9;
  }
  extentsAt(side);
  return { distance, target, side };

  function extentsAt(x) {
    camera.position.set(x, target + Math.sin(ELEVATION) * distance, Math.cos(ELEVATION) * distance);
    camera.lookAt(x, target, 0);
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      v.set(p[0], p[1], p[2]).project(camera);
      // A point behind the camera means it is far too close.
      if (v.z > 1 || v.z < -1) return { x0: -10, x1: 10, y0: -10, y1: 10 };
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1 };
  }
}

export function createStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.1, 400);
  const hemi = new THREE.HemisphereLight('#ffffff', '#b7cff5', 1.35);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  sun.shadow.intensity = 0.78; // a little light still reaches the shade, so close-up shadows are not harsh
  const fill = new THREE.DirectionalLight('#ffe8f0', 0.35);
  scene.add(hemi, sun, sun.target, fill);

  // Sky dressing sits in its own group; it is placed around the camera after framing.
  const sky = new THREE.Group();
  scene.add(sky);
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.5, transparent: true });
  const cloudSpots = [[-0.82, 0.55, 1.5, 0.6], [0.84, 0.15, 1.35, 0.5], [-0.9, -0.55, 1.25, 0.5], [0.8, -0.78, 1.2, 0.45], [-0.45, -0.95, 1.4, 0.5]];
  const clouds = cloudSpots.map((spot, i) => {
    const mesh = new THREE.Mesh(cloudGeometry(i + 1), cloudMaterial);
    mesh.userData.spot = spot;
    sky.add(mesh);
    return mesh;
  });
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_STARS * 3), 3));
  const starMaterial = new THREE.PointsMaterial({ color: '#fff7e6', size: 2.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  sky.add(stars);
  const moonGlowMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: '#c9d2ff', transparent: true, opacity: 0.45, depthWrite: false, fog: false });
  const moonMaterial = new THREE.SpriteMaterial({ map: moonTexture(), color: '#ffffff', transparent: true, depthWrite: false, fog: false });
  const moonGlow = new THREE.Sprite(moonGlowMaterial), moon = new THREE.Sprite(moonMaterial);
  sky.add(moonGlow, moon);
  // Normal blending (not additive), so fireflies stay small warm dots even against a pale sky.
  const fireflyMaterial = new THREE.SpriteMaterial({ map: blobTexture(), color: '#ffe066', transparent: true, depthWrite: false, fog: false });
  const fireflies = new THREE.Group();
  scene.add(fireflies);

  let mood = MOODS.focus, distance = 20, half = [2, 2], spots = [];
  const placeSky = () => {
    for (const cloud of clouds) {
      const [x, y, depth, scale] = cloud.userData.spot;
      cloud.position.copy(viewPoint(camera, x, y, distance * depth));
      cloud.scale.setScalar(scale * distance / 20);
      cloud.userData.x0 = cloud.position.x;
    }
    const random = mulberry(9);
    const array = starGeometry.attributes.position.array;
    for (let i = 0; i < MAX_STARS; i++) array.set(viewPoint(camera, random() * 2.2 - 1.1, 0.05 + random() * 1.0, distance * 3).toArray(), i * 3);
    starGeometry.attributes.position.needsUpdate = true;
    moon.position.copy(viewPoint(camera, 0.74, 0.74, distance * 2.6));
    moonGlow.position.copy(moon.position);
    moon.scale.setScalar(distance * 0.14);
    moonGlow.scale.setScalar(distance * 0.42);
  };
  const makeFireflies = () => {
    for (const fly of [...fireflies.children]) fly.removeFromParent();
    const random = mulberry(4);
    const count = Math.min(40, Math.round(6 + half[0] * half[1] * 0.4));
    for (let i = 0; i < count; i++) {
      const fly = new THREE.Sprite(fireflyMaterial);
      fly.scale.setScalar(0.1);
      // Fireflies hover over land (a random grass cell), never out over the open sky.
      const spot = spots.length ? spots[Math.floor(random() * spots.length)] : [(random() - 0.5) * half[0] * 1.6, (random() - 0.5) * half[1] * 1.6];
      fly.userData = { x: spot[0] + (random() - 0.5) * 0.6, z: spot[1] + (random() - 0.5) * 0.6, h: 0.35 + random() * 0.9, s: 0.3 + random() * 0.4, i, phase: random() * 6 };
      fireflies.add(fly);
    }
  };

  return {
    scene, camera,
    // Fits the camera to the world's points and lays the sky out around the view.
    // points: what must stay in view. land: [x, z] spots over grass, where fireflies may hover.
    frame(points, aspect, land = []) {
      spots = land;
      const fit = frameCamera(camera, points, aspect);
      distance = fit.distance;
      camera.far = Math.max(400, distance * 4);
      camera.near = Math.max(0.05, distance * 0.02);
      camera.updateProjectionMatrix();
      let sx = 1, sz = 1;
      for (const p of points) { sx = Math.max(sx, Math.abs(p[0] - fit.side)); sz = Math.max(sz, Math.abs(p[2])); }
      half = [sx, sz];
      const span = Math.max(sx, sz) + 1.5;
      const reach = Math.max(14, span * 2);
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: reach * 3 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.userData.reach = reach;
      sun.target.position.set(fit.side, 0, 0);
      this.setMood(mood.key);
      placeSky();
      makeFireflies();
      return fit;
    },
    setMood(name) {
      const key = moodOf(name);
      mood = { key, ...MOODS[key] };
      scene.background = skyTexture(key, mood.gradient);
      scene.fog = new THREE.Fog(mood.fog, distance * mood.fogNear, distance * mood.fogFar);
      hemi.color.set(mood.hemi[0]); hemi.groundColor.set(mood.hemi[1]); hemi.intensity = mood.hemi[2];
      sun.color.set(mood.sun.color); sun.intensity = mood.sun.intensity;
      const reach = sun.userData.reach ?? 14;
      sun.position.set(sun.target.position.x + mood.sun.dir[0] * reach, mood.sun.dir[1] * reach, mood.sun.dir[2] * reach);
      fill.color.set(mood.fill[0]); fill.intensity = mood.fill[1];
      fill.position.set(-3, -4, 8);
      cloudMaterial.color.set(mood.cloud.color); cloudMaterial.emissive.set(mood.cloud.emissive);
      cloudMaterial.emissiveIntensity = mood.cloud.glow; cloudMaterial.opacity = mood.cloud.opacity;
      stars.visible = mood.stars > 0;
      starGeometry.setDrawRange(0, mood.stars);
      moon.visible = moonGlow.visible = mood.moon;
      fireflies.visible = mood.fireflies > 0;
    },
    update(t) {
      const range = distance * 1.4;
      for (const cloud of clouds) cloud.position.x = ((cloud.userData.x0 + t * 0.05 + range) % (range * 2) + range * 2) % (range * 2) - range;
      if (!fireflies.visible) return;
      for (const fly of fireflies.children) {
        const { x, z, h, s, i, phase } = fly.userData;
        fly.position.set(x + Math.sin(t * s + i) * 0.3, h + Math.sin(t * 0.9 + i) * 0.15, z + Math.cos(t * s * 0.8 + i * 2) * 0.3);
        // Shrunk in close views so a firefly stays a small dot on screen at any zoom.
        fly.scale.setScalar(Math.min(1, distance / 16) * (0.06 + (Math.sin(t * 2.4 + phase) * 0.5 + 0.5) * 0.05));
      }
    },
    dispose() {
      for (const cloud of clouds) cloud.geometry.dispose();
      cloudMaterial.dispose();
      starGeometry.dispose(); starMaterial.dispose();
      moonMaterial.dispose(); moonGlowMaterial.dispose(); fireflyMaterial.dispose();
      sun.dispose?.(); fill.dispose?.(); hemi.dispose?.();
    },
  };
}
