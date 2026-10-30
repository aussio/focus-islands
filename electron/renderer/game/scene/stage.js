// The stage around the island: sky, light, clouds, stars, moon, fireflies and the camera.
// Moods change only what is here (plus window glow and the fire); the island itself is untouched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MOODS, moodOf } from './style.js';
import { blobTexture, glowTexture, moonTexture, skyTexture } from './parts.js';
import { hash01 } from './ground.js';
import { SWAY, blendPose, driftPose, moveSize, planDrift, samePlace, swayYaw } from './drift.js';

export const ELEVATION = 0.8; // about 46 degrees above the horizon: the base-builder view
const FOV = 20; // a narrow lens, so the island reads almost like a little map
const MAX_STARS = 160;

// How the town camera behaves between check-ins (scene/drift.js). The first is the default.
//   sway: the view turns slowly up to 14° left and right of north, all the time, even with one island;
//     with other islands it also takes the drift's trips;
//   drift: rests on the busy view, then takes slow trips to the whole group and the other islands;
//   still: stays on the busy view, as first built (decision 6).
export const CAMERA_STYLES = ['sway', 'drift', 'still'];
// The turns every framing is fitted at, so nothing framed leaves the picture or reaches into the top band
// anywhere in the swing. The shadow box covers the ground in view at each of them, so it stays put while
// the view only turns.
const TURN = SWAY.degrees * Math.PI / 180;
const SWAY_FIT = [-TURN, 0, TURN];
const SWAY_SHADOW = [-TURN, -TURN / 2, 0, TURN / 2, TURN];
const NORTH = [0];
const fitYawsFor = style => (style === 'sway' ? SWAY_FIT : NORTH);

// Shadows follow the view in steps, so a moving camera never makes them shimmer. The shadow box covers
// the ground in view. Its size comes in fixed steps (4 per doubling), and its middle moves only in steps
// of 1/8 of its half width: 128 texels of the 2048 shadow map, so the shadow map moves by whole texels and
// every shadow stays exactly where it was. It is drawn again only when the box steps, never while the
// camera rests. Soft edges are set from the camera's distance, so they look the same at every zoom.
const SHADOW_MAP = 2048;
const SHADOW = {
  levels: 4, // box sizes per doubling
  steps: 8, // steps per half width
  planes: [-0.6, 2.2], // the heights the box must cover in view: island grass (lift ±0.5) up to the roofs
  soft: 2.8, // edge softness: radius in texels × box half width ÷ camera distance (12 texels at today's old fit)
  bias: 0.022, // shadow bias in world units
  rise: 8, // the sun sits this much farther out than the box's half width
};
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

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

// Fits the camera so every point is in view with margins, seen from the base-builder angle.
// margin: [x, y] or [x, bottom, top], how far from the middle points may reach (1 is the frame's edge). A
// lower top keeps a band clear across the top of the picture (the page's resource bar sits there).
// elevation: the camera's angle above the horizon, in radians (the gallery tilts it; the scene never does).
// yaws: turns from north (radians) the fit must hold at; every point fits at each of them.
export function frameCamera(camera, points, aspect, margin = [0.9, 0.86], { elevation = ELEVATION, yaws = [0] } = {}) {
  const bottom = margin[1], top = margin[2] ?? margin[1];
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
      if (e.x1 - e.x0 > margin[0] * 2 || e.y1 - e.y0 > bottom + top) lo = distance; else hi = distance;
    }
    distance = hi;
    const e = extentsAt(side);
    const halfHeight = Math.tan(FOV * Math.PI / 360) * distance;
    target += ((e.y0 + e.y1) / 2 - (top - bottom) / 2) * halfHeight * 0.9;
    side += (e.x0 + e.x1) / 2 * halfHeight * aspect * 0.9;
  }
  extentsAt(side, 0);
  return { distance, target, side };

  // The points' reach on screen (-1..1) over every yaw, or for one yaw when `only` is given.
  function extentsAt(x, only = null) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const yaw of only === null ? yaws : [only]) {
      const flat = Math.cos(elevation) * distance;
      camera.position.set(x + Math.sin(yaw) * flat, target + Math.sin(elevation) * distance, Math.cos(yaw) * flat);
      camera.lookAt(x, target, 0);
      camera.updateMatrixWorld();
      for (const p of points) {
        v.set(p[0], p[1], p[2]).project(camera);
        // A point behind the camera means it is far too close.
        if (v.z > 1 || v.z < -1) return { x0: -10, x1: 10, y0: -10, y1: 10 };
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
    }
    return { x0, x1, y0, y1 };
  }
}

// Where the camera looks to fit every point, without moving the real camera:
// { look: [x, y, z], distance, elevation }. The same fit as frameCamera, for points anywhere in the sky:
// the yaw stays fixed (looking north) and the look point follows the points' middle. Used by aim().
// top: how high points may reach (frame edge 1; see frameCamera's margin). yaws: turns the fit must hold at
// (the sway style fits its whole swing).
export const TOP = 0.86;
const scratch = new THREE.PerspectiveCamera(FOV, 1.6, 0.1, 400);
export function fitView(points, aspect, { elevation = ELEVATION, top = TOP, yaws = [0] } = {}) {
  if (!points.length) return { look: [0, 0, 0], distance: 20, elevation };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const fit = frameCamera(scratch, points.map(p => [p[0] - cx, p[1], p[2] - cz]), aspect, [0.9, 0.86, top], { elevation, yaws });
  return { look: [cx + fit.side, fit.target, cz], distance: fit.distance, elevation };
}

// How tall one world unit is on screen, in pixels, at the look point.
export const pixelsPerUnit = (distance, height) => height / (2 * distance * Math.tan(FOV * Math.PI / 360));

// Check-in moves: 2.5 s, easing in and out; up to 2.4 times longer when the camera is far from the new
// busy view (out on a trip), so a big way home is never fast.
export const AIM_SECONDS = 2.5;
const AIM_LONGEST = 2.4;
const easeInOut = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const aimSeconds = (from, to) => AIM_SECONDS * Math.min(AIM_LONGEST, Math.max(1, moveSize(from, to)));
const copyPose = pose => pose && { ...pose, at: pose.at.slice() };

// now: a clock in milliseconds, for the town camera's moves (tests pass their own).
export function createStage({ now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.1, 400);
  const hemi = new THREE.HemisphereLight('#ffffff', '#b7cff5', 1.35);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  // Soft edges (in shadow map texels): at 4 a faceted tree crown printed as a hard-edged polygon.
  sun.shadow.radius = 12;
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
  // The town camera. look: the pose on screen now. target: the busy view, where every drift starts and
  // rests. route: the drift's trips (drift.js), or null. started: when the drift started (ms, now()).
  // swayed: when the sway started (ms, now()); unlike the drift it does not start again at a check-in, so
  // the turn never snaps back to north. move: a check-in move in progress ({ from, start, seconds }) or
  // null; it eases from where the camera was toward the drift's pose, which is the busy view for the
  // drift's first DRIFT.home (60) seconds.
  let look = null, target = null, route = null, started = 0, swayed = null, move = null, style = CAMERA_STYLES[0];
  let shadowKey = '', shadowMoved = false;
  const placeCamera = pose => {
    const { at, distance: d, elevation, yaw = 0 } = pose;
    distance = d;
    const flat = Math.cos(elevation) * d;
    camera.position.set(at[0] + Math.sin(yaw) * flat, at[1] + Math.sin(elevation) * d, at[2] + Math.cos(yaw) * flat);
    camera.lookAt(at[0], at[1], at[2]);
    camera.far = Math.max(400, d * 4);
    camera.near = Math.max(0.05, d * 0.02);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (scene.fog) { scene.fog.near = d * mood.fogNear; scene.fog.far = d * mood.fogFar; }
    look = { at: at.slice(), distance: d, elevation, yaw };
  };
  // The pose for now: the drift's pose (or the busy view when still), eased from a check-in move's start.
  const poseNow = (still = false) => {
    if (!target) return null;
    const seconds = (now() - started) / 1000;
    let base = target;
    if (!still && style !== 'still') {
      base = driftPose(route, seconds) ?? target;
      if (style === 'sway') base = { ...base, yaw: (base.yaw ?? 0) + swayYaw((now() - (swayed ?? now())) / 1000) };
    }
    if (!move) return base;
    const k = (now() - move.start) / (move.seconds * 1000);
    if (k >= 1) { move = null; return base; }
    return blendPose(move.from, base, easeInOut(k));
  };
  // Puts the camera at the pose for now. Nothing happens while the pose holds still (a rest), unless forced.
  const show = (still = false, force = false) => {
    const pose = poseNow(still);
    if (!pose) return false;
    if (!force && look && pose.distance === look.distance && pose.elevation === look.elevation && (pose.yaw ?? 0) === look.yaw && pose.at.every((v, i) => v === look.at[i])) return false;
    placeCamera(pose);
    placeSky();
    fitShadow();
    return true;
  };
  // The shadow box for the camera as it is now (see SHADOW above). force: set it even if it hasn't
  // stepped (a new mood turns the sun).
  // With the sway, the box covers the ground in view at every turn of the swing (SWAY_SHADOW), so it
  // holds still while the view only turns and shadows never redraw during a rest.
  const lightX = new THREE.Vector3(), lightY = new THREE.Vector3(), lightZ = new THREE.Vector3();
  const corner = new THREE.Vector3(), hit = new THREE.Vector3();
  const turned = new THREE.PerspectiveCamera();
  const fitShadow = (force = false) => {
    lightZ.set(...mood.sun.dir).normalize();
    lightX.set(0, 1, 0).cross(lightZ).normalize();
    lightY.copy(lightZ).cross(lightX);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const cover = view => {
      for (const [sx, sy] of CORNERS) {
        corner.set(sx, sy, 0.5).unproject(view).sub(view.position).normalize();
        for (const plane of SHADOW.planes) {
          // A corner that looks above the horizon (only in the gallery's low views) reaches 4 distances out.
          const k = corner.y < -1e-3 ? Math.min((plane - view.position.y) / corner.y, distance * 4) : distance * 4;
          hit.copy(view.position).addScaledVector(corner, Math.max(0, k));
          const x = hit.dot(lightX), y = hit.dot(lightY);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    };
    if (style === 'sway' && look) {
      const flat = Math.cos(look.elevation) * look.distance;
      turned.copy(camera);
      for (const yaw of SWAY_SHADOW) {
        turned.position.set(look.at[0] + Math.sin(yaw) * flat, look.at[1] + Math.sin(look.elevation) * look.distance, look.at[2] + Math.cos(yaw) * flat);
        turned.lookAt(...look.at);
        turned.updateMatrixWorld();
        cover(turned);
      }
    } else cover(camera);
    // Snapping moves the middle by up to half a step, so the box needs that much more room.
    const need = Math.max(x1 - x0, y1 - y0) / 2 * (1 + 1 / SHADOW.steps);
    const level = Math.ceil(Math.log2(Math.max(0.5, need)) * SHADOW.levels);
    const size = 2 ** (level / SHADOW.levels);
    const step = size / SHADOW.steps;
    const ix = Math.round((x0 + x1) / 2 / step), iy = Math.round((y0 + y1) / 2 / step);
    const iz = Math.round((look?.at ?? [0, 0, 0]).reduce((sum, v, i) => sum + v * lightZ.getComponent(i), 0) / size);
    sun.shadow.radius = SHADOW.soft * distance / size;
    const key = `${mood.key}|${level}|${ix}|${iy}|${iz}`;
    if (key === shadowKey && !force) return;
    shadowKey = key;
    shadowMoved = true;
    const reach = size + SHADOW.rise;
    sun.target.position.set(0, 0, 0).addScaledVector(lightX, ix * step).addScaledVector(lightY, iy * step).addScaledVector(lightZ, iz * size);
    sun.position.copy(sun.target.position).addScaledVector(lightZ, reach);
    Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 0.5, far: reach * 2 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -SHADOW.bias / (reach * 2 - 0.5);
    sun.userData.reach = reach;
  };
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
      // A spot may carry a third number: the ground's height there (a town island's lift).
      fly.userData = { x: spot[0] + (random() - 0.5) * 0.6, z: spot[1] + (random() - 0.5) * 0.6, h: (spot[2] ?? 0) + 0.35 + random() * 0.9, s: 0.3 + random() * 0.4, i, phase: random() * 6 };
      fireflies.add(fly);
    }
  };

  return {
    scene, camera,
    // Fits the camera to the world's points and lays the sky out around the view.
    // points: what must stay in view. land: [x, z] spots over grass, where fireflies may hover.
    // elevation: the camera's angle above the horizon (gallery only; the scene keeps Today's).
    frame(points, aspect, land = [], { elevation = ELEVATION } = {}) {
      spots = land;
      look = target = move = route = null; // a framed view never moves the camera
      shadowKey = '';
      sun.shadow.bias = -0.0005;
      sun.shadow.radius = 12;
      const fit = frameCamera(camera, points, aspect, undefined, { elevation });
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
    // The town camera. Fits the busy view to the points (world [x, y, z]) looking north, and plans the
    // drift's trips from it (drift.js): wide is every island's points (the whole group), others one list
    // of points per other island. Without them the camera stays on the busy view.
    // ease: move from where the camera is now to the busy view, over AIM_SECONDS (longer from far away);
    // otherwise (and for the first aim) jump. restart: start the drift again from its rest on the busy
    // view (every new world); a resize keeps its place in the drift. A new aim at the busy view it is
    // already moving to keeps that move. The shadow box follows the view (fitShadow).
    // land: [x, z, y] spots over grass, where fireflies may hover. elevation: the camera's angle above the
    // horizon (gallery only; the scene keeps Today's). top: how high points may reach in the picture (see
    // frameCamera; lower keeps a band clear at the top). Returns { look, distance, elevation } of the busy view.
    aim(points, aspect, { ease = false, land = [], elevation = ELEVATION, top = TOP, wide = null, others = [], restart = true } = {}) {
      camera.fov = FOV;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const yaws = fitYawsFor(style);
      const fit = fitView(points, aspect, { elevation, top, yaws });
      const end = { at: fit.look, distance: fit.distance, elevation, yaw: 0 };
      const poseFor = list => { const f = fitView(list, aspect, { elevation, top, yaws }); return { at: f.look, distance: f.distance, elevation, yaw: 0 }; };
      const keep = ease && move && samePlace(target, end, 1e-3);
      route = planDrift({ home: end, wide: wide?.length ? poseFor(wide) : null, others: others.filter(list => list?.length).map(poseFor) });
      target = end;
      spots = land;
      let sx = 1, sz = 1;
      for (const p of points) { sx = Math.max(sx, Math.abs(p[0] - end.at[0])); sz = Math.max(sz, Math.abs(p[2] - end.at[2])); }
      half = [sx, sz];
      if (restart || !look) started = now();
      swayed ??= now();
      if (!keep) {
        move = null;
        const to = poseNow();
        if (ease && look && !samePlace(look, to, 1e-3)) move = { from: copyPose(look), start: now(), seconds: aimSeconds(look, to) };
      }
      show(false, true);
      fitShadow(true);
      makeFireflies();
      return fit;
    },
    // Finishes a check-in move at once. The drift goes on from where it is.
    settle() {
      if (!move) return false;
      move = null;
      show();
      return true;
    },
    // How the camera behaves between check-ins: one of CAMERA_STYLES. A change starts the drift (and the
    // sway) again from its rest on the busy view, facing north, and the camera eases there from wherever it is.
    get style() { return style; },
    set style(next) {
      if (!CAMERA_STYLES.includes(next) || next === style) return;
      style = next;
      started = now();
      swayed = now();
      if (!target || !look) return;
      move = null;
      const to = poseNow();
      if (!samePlace(look, to, 1e-3)) move = { from: copyPose(look), start: now(), seconds: aimSeconds(look, to) };
      show();
    },
    // True while a check-in (or style) move is under way. The drift itself never counts as moving.
    get moving() { return Boolean(move); },
    // The turns a framing must fit at for the current style (fitView's yaws).
    get fitYaws() { return fitYawsFor(style); },
    // The drift's plan (drift.js planDrift), or null when the camera has nowhere else to look.
    get route() { return route; },
    // Seconds since the drift started (it starts again at each new world and style).
    get driftSeconds() { return target ? (now() - started) / 1000 : 0; },
    // Seconds since the sway started (at the first world, and again at each style change).
    get swaySeconds() { return swayed === null ? 0 : (now() - swayed) / 1000; },
    get look() { return copyPose(look); },
    get target() { return copyPose(target); },
    // True once after the shadow box stepped, so the shadow map needs drawing again.
    takeShadowMoved() { const was = shadowMoved; shadowMoved = false; return was; },
    setMood(name) {
      const key = moodOf(name);
      mood = { key, ...MOODS[key] };
      scene.background = skyTexture(key, mood.gradient);
      scene.fog = new THREE.Fog(mood.fog, distance * mood.fogNear, distance * mood.fogFar);
      hemi.color.set(mood.hemi[0]); hemi.groundColor.set(mood.hemi[1]); hemi.intensity = mood.hemi[2];
      sun.color.set(mood.sun.color); sun.intensity = mood.sun.intensity;
      if (look) fitShadow(true); // the town camera: the sun turns, so its shadow box turns with it
      else {
        const reach = sun.userData.reach ?? 14;
        const aimAt = sun.target.position;
        sun.position.set(aimAt.x + mood.sun.dir[0] * reach, aimAt.y + mood.sun.dir[1] * reach, aimAt.z + mood.sun.dir[2] * reach);
      }
      fill.color.set(mood.fill[0]); fill.intensity = mood.fill[1];
      fill.position.set(-3, -4, 8);
      cloudMaterial.color.set(mood.cloud.color); cloudMaterial.emissive.set(mood.cloud.emissive);
      cloudMaterial.emissiveIntensity = mood.cloud.glow; cloudMaterial.opacity = mood.cloud.opacity;
      stars.visible = mood.stars > 0;
      starGeometry.setDrawRange(0, mood.stars);
      moon.visible = moonGlow.visible = mood.moon;
      fireflies.visible = mood.fireflies > 0;
    },
    // Moves the camera along the drift or a check-in move, then the clouds and fireflies.
    // still: the camera stays on the busy view (reduced motion), and only a check-in move finishes.
    update(t, still = false) {
      show(still);
      // Clouds drift slowly to the right and wrap around within a band centred on the view.
      const range = distance * 1.4, middle = look?.at[0] ?? 0;
      for (const cloud of clouds) cloud.position.x = middle + ((cloud.userData.x0 - middle + t * 0.05 + range) % (range * 2) + range * 2) % (range * 2) - range;
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
