// Resident figure. Local +z is forward; root stays at ground level. The caller owns
// placement and movement along a safe route. pose() only changes the figure, never the world.
import * as THREE from 'three';
import { rbox } from '../parts.js';
import { creatureMaterial as material } from '../models/creature-material.js';

export function createCat({ scale = 1 } = {}) {
  const root = new THREE.Group();
  root.name = 'resident-cat';
  root.scale.setScalar(scale);
  const geometries = new Set();
  const fur = '#df914c', cream = '#fff2d5', dark = '#74482e', pink = '#d58278';
  function mesh(parent, geometry, color, at = [0, 0, 0]) {
    geometries.add(geometry);
    const piece = new THREE.Mesh(geometry, material(color));
    piece.position.set(...at);
    // Like helpers, animals do not invalidate the town's cached shadow map each frame.
    piece.castShadow = false;
    parent.add(piece);
    return piece;
  }
  const ellipsoid = (x, y, z) => new THREE.SphereGeometry(1, 10, 6).scale(x, y, z);
  function tube(parent, points, radius, color) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(parent, new THREE.TubeGeometry(curve, 16, radius, 6, false), color);
  }
  function head(parent, sleeping = false) {
    const group = new THREE.Group();
    group.userData.eyes = [];
    parent.add(group);
    mesh(group, rbox(0.13, 0.105, 0.115, 0.025, 2), fur);
    // Triangular ears carry the identity at the tiny Today camera scale.
    for (const x of [-0.046, 0.046]) {
      const ear = mesh(group, new THREE.ConeGeometry(0.036, 0.075, 3), fur, [x, 0.071, -0.005]);
      ear.rotation.y = Math.PI / 3;
      mesh(group, new THREE.ConeGeometry(0.017, 0.043, 3), pink, [x, 0.075, 0.011]).rotation.y = Math.PI / 3;
      const eye = mesh(group, rbox(0.012, sleeping ? 0.003 : 0.014, 0.006, 0.002, 1), '#33313a', [x * 0.58, 0.009, 0.059]);
      group.userData.eyes.push(eye);
      if (sleeping) eye.rotation.z = x < 0 ? -0.2 : 0.2;
    }
    mesh(group, ellipsoid(0.043, 0.025, 0.024), cream, [0, -0.024, 0.057]);
    mesh(group, new THREE.ConeGeometry(0.009, 0.013, 3), dark, [0, -0.012, 0.079]).rotation.z = Math.PI;
    return group;
  }

  const awake = new THREE.Group();
  root.add(awake);
  const body = mesh(awake, ellipsoid(0.079, 0.066, 0.15), fur, [0, 0.12, -0.015]);
  const chest = mesh(awake, ellipsoid(0.05, 0.058, 0.03), cream, [0, 0.13, 0.083]);
  const face = head(awake);
  const legs = [];
  for (const z of [-0.085, 0.073]) for (const x of [-0.049, 0.049]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.088, z);
    awake.add(leg);
    mesh(leg, rbox(0.035, 0.072, 0.035, 0.009, 1), fur, [0, -0.036, 0]);
    mesh(leg, ellipsoid(0.023, 0.016, 0.033), cream, [0, -0.071, 0.01]);
    legs.push(leg);
  }
  const tail = new THREE.Group();
  tail.position.z = -0.03;
  awake.add(tail);
  const uprightTail = tube(tail, [[0, 0.125, -0.12], [0.015, 0.17, -0.17], [0.035, 0.255, -0.185], [0.075, 0.265, -0.17]], 0.021, fur);
  const tailTip = mesh(tail, ellipsoid(0.023, 0.022, 0.021), cream, [0.075, 0.265, -0.17]);

  // A separate curled silhouette avoids shrinking a standing cat into an indistinct dot.
  const curled = new THREE.Group();
  root.add(curled);
  mesh(curled, ellipsoid(0.105, 0.066, 0.12), fur, [0, 0.071, -0.01]);
  const sleepyHead = head(curled, true);
  sleepyHead.position.set(-0.041, 0.071, 0.077);
  sleepyHead.rotation.set(-0.15, 0.48, -0.12);
  const curledTail = tube(curled, [[0.065, 0.064, -0.09], [0.112, 0.044, -0.025], [0.103, 0.036, 0.08], [0.055, 0.033, 0.13], [-0.006, 0.031, 0.122]], 0.025, fur);
  mesh(curled, ellipsoid(0.031, 0.025, 0.025), cream, [-0.008, 0.031, 0.122]);

  // Both tails have the same topology. Morph their vertices rather than cross-fading two cats.
  const tailStart = uprightTail.geometry.attributes.position.array.slice();
  const tailEnd = curledTail.geometry.attributes.position.array;
  const blend = (a, b, u) => a + (b - a) * u;
  const clamp = x => Math.max(0, Math.min(1, x));
  const sleepingRotation = sleepyHead.quaternion.clone();
  const awakeRotation = new THREE.Quaternion();
  const faceEuler = new THREE.Euler();
  const eyeStarts = face.userData.eyes.map(eye => eye.geometry.attributes.position.array.slice());
  let lastCurl = null;
  function pose(state = 'sit', time = 0, rig = null) {
    if (!['sit', 'rest', 'walk'].includes(state)) throw new Error(`Unknown cat pose: ${state}`);
    const t = Number.isFinite(time) ? time : 0;
    const sit = clamp(rig?.sit ?? (state === 'sit' ? 1 : 0));
    const curl = clamp(rig?.curl ?? (state === 'rest' ? 1 : 0));
    const stride = clamp(rig?.stride ?? (state === 'walk' ? 1 : 0));
    awake.visible = curl < 1;
    curled.visible = curl === 1;
    const gait = stride * Math.sin(t * Math.PI * 2 * 0.8);
    body.position.set(0, blend(blend(0.12, 0.112, sit), 0.071, curl), blend(-0.015, -0.01, curl));
    body.scale.set(blend(1, 0.105 / 0.079, curl), blend(blend(1, 1.35, sit), 1, curl), blend(blend(1, 0.85, sit), 0.12 / 0.15, curl));
    chest.position.set(0, blend(0.13, 0.14, sit), blend(0.103, 0.073, sit));
    chest.scale.setScalar(1 - curl);
    face.position.set(blend(0, -0.041, curl), blend(blend(0.166, 0.195, sit), 0.071, curl), blend(blend(0.132, 0.076, sit), 0.077, curl));
    const look = sit * 0.2 * Math.sin(Math.min(1, Math.max(0, t - 6) / 3) * Math.PI);
    awakeRotation.setFromEuler(faceEuler.set(0, look, 0));
    face.quaternion.copy(awakeRotation).slerp(sleepingRotation, curl);
    for (const [i, eye] of face.userData.eyes.entries()) {
      if (curl !== lastCurl) {
        const points = eye.geometry.attributes.position;
        const target = sleepyHead.userData.eyes[i].geometry.attributes.position.array;
        for (let j = 0; j < points.array.length; j++) points.array[j] = blend(eyeStarts[i][j], target[j], curl);
        points.needsUpdate = true;
        eye.geometry.computeVertexNormals();
      }
      eye.rotation.z = (i === 0 ? -0.2 : 0.2) * curl;
    }
    for (let i = 0; i < legs.length; i++) {
      const rear = i < 2;
      legs[i].position.set(i % 2 ? 0.049 : -0.049, rear ? blend(0.088, 0.05, sit) + Math.abs(gait) * 0.012 : 0.088 + Math.abs(gait) * 0.012, rear ? -0.11 : blend(0.093, 0.062, sit));
      legs[i].scale.set(1 - curl, (rear ? blend(1, 0.5, sit) : 1) * (1 - curl), 1 - curl);
      legs[i].rotation.x = gait * (i === 0 || i === 3 ? 0.3 : -0.3);
    }
    tail.rotation.z = gait * 0.04;
    if (curl !== lastCurl) {
      const vertices = uprightTail.geometry.attributes.position;
      for (let i = 0; i < tailStart.length; i++) {
        vertices.array[i] = blend(tailStart[i], tailEnd[i] + (i % 3 === 2 ? 0.03 : 0), curl);
      }
      vertices.needsUpdate = true;
      uprightTail.geometry.computeVertexNormals();
      uprightTail.geometry.computeBoundingSphere();
      lastCurl = curl;
    }
    tailTip.position.set(blend(0.075, -0.008, curl), blend(0.265, 0.031, curl), blend(-0.17, 0.152, curl));
    tailTip.scale.set(blend(1, 0.031 / 0.023, curl), blend(1, 0.025 / 0.022, curl), blend(1, 0.025 / 0.021, curl));
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose(); // the shared materials stay
    root.removeFromParent();
  }
  pose();
  return { root, pose, dispose };
}
