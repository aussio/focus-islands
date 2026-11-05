// A single visiting bird. Geometry and animation only; arrival belongs to saved check-ins, and when it
// may move belongs to calm.js (scene/town/visitors.js asks).
// scale: 1.3 by default, so at Today's size it reads as a bird rather than a helper's head.
import * as THREE from 'three';
import { creatureMaterial } from './creature-material.js';
import { ease } from '../calm.js';

export const BIRD_SCALE = 1.3;

export function createBird({ scale = BIRD_SCALE } = {}) {
  const root = new THREE.Group();
  root.name = 'visiting-bird';
  root.scale.setScalar(scale);
  const shapes = new Set();
  const mesh = (parent, geometry, color, xyz) => {
    shapes.add(geometry);
    const piece = new THREE.Mesh(geometry, creatureMaterial(color));
    piece.position.set(...xyz); parent.add(piece); return piece;
  };
  const blue = '#4f9bff', cream = '#fff1d6';
  mesh(root, new THREE.IcosahedronGeometry(0.075, 1).scale(0.8, 0.9, 1.2), blue, [0, 0.09, 0]);
  mesh(root, new THREE.IcosahedronGeometry(0.052, 0).scale(0.9, 1, 0.7), cream, [0, 0.08, 0.055]);
  const head = new THREE.Group(); root.add(head); head.position.set(0, 0.175, 0.04);
  mesh(head, new THREE.IcosahedronGeometry(0.048, 1), blue, [0, 0, 0]);
  mesh(head, new THREE.ConeGeometry(0.018, 0.05, 4).rotateX(Math.PI / 2), '#ffb846', [0, -0.009, 0.062]);
  for (const side of [-1, 1]) {
    mesh(head, new THREE.SphereGeometry(0.007, 6, 4), '#33313a', [side * 0.029, 0.006, 0.035]);
    mesh(root, new THREE.CylinderGeometry(0.005, 0.005, 0.035, 5), '#d88b42', [side * 0.022, 0.018, 0.013]);
  }
  mesh(root, new THREE.ConeGeometry(0.037, 0.115, 4).rotateX(-Math.PI / 2), '#3979c5', [0, 0.09, -0.105]);
  const wings = [-1, 1].map(side => {
    const wing = new THREE.Group(); root.add(wing); wing.position.set(side * 0.052, 0.12, 0);
    mesh(wing, new THREE.IcosahedronGeometry(0.06, 0).scale(0.4, 0.6, 1.3), '#3979c5', [side * 0.008, -0.015, -0.01]);
    return { wing, side };
  });
  // time: seconds into the bird's turn (birdMoment), 0 when it is not its turn. One slow look aside at 6
  // to 9 seconds; wings beat a little over once a second in the air.
  const pose = (time = 0, flying = 0) => {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    const lift = Math.max(0, Math.min(1, flying));
    head.rotation.y = lift ? 0 : t >= 6 && t <= 9 ? 0.3 * Math.sin((t - 6) * Math.PI / 3) ** 2 : 0;
    for (const { wing, side } of wings) {
      wing.rotation.z = side * lift * (1.1 + 0.45 * Math.sin(t * Math.PI * 2 * WING_BEATS));
      wing.scale.set(1 + lift * 1.4, 1, 1);
    }
  };
  let disposed = false;
  // The shared materials stay (models/creature-material.js).
  const dispose = () => { if (disposed) return; disposed = true; root.removeFromParent(); shapes.forEach(g => g.dispose()); };
  pose();
  return { root, pose, dispose };
}

const WING_BEATS = 1.25; // per second

// The bird's turn (calm.js gives it one loop now and then). time: seconds into the turn, or null when it
// is not its turn (perched and still). It looks aside once, and with fly (break only) it also takes one
// short excursion, 12 seconds from 32 seconds in: it rises vertically, circles once above the tallest
// scenery and comes back down. perchYaw: which way it faces on the perch; in the air it turns to face
// where it flies. toward: the flat direction [x, z] the circle reaches out to from the perch (the scene
// picks one that stays over the land); the default is +x.
export const FLIGHT_RADIUS = 0.65;
export function birdMoment(time, perch, clearance, { fly = true, perchYaw = -0.5, toward = [1, 0] } = {}) {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (!fly || t < 32 || t >= 44) return { position: [...perch], flying: 0, yaw: perchYaw, time: t };
  const u = t - 32;
  const up = u < 2 ? ease(u / 2) : u > 10 ? 1 - ease((u - 10) / 2) : 1;
  const a = 2 * Math.PI * ease((u - 2) / 8);
  const [ex, ez] = flightAxes(toward), fx = -ez, fz = ex;
  const out = FLIGHT_RADIUS * (1 - Math.cos(a)), side = FLIGHT_RADIUS * Math.sin(a);
  const heading = Math.atan2(fx, fz) + a;
  return {
    position: [perch[0] + out * ex + side * fx, perch[1] + (clearance - perch[1]) * up, perch[2] + out * ez + side * fz],
    flying: up, yaw: perchYaw + Math.atan2(Math.sin(heading - perchYaw), Math.cos(heading - perchYaw)) * up, time: t,
  };
}

// The unit flat direction for toward, or +x when it has no length.
export function flightAxes(toward) {
  const [x, z] = Array.isArray(toward) ? toward : [1, 0], l = Math.hypot(x, z);
  return l > 1e-9 ? [x / l, z / l] : [1, 0];
}
