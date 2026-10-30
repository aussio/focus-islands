// Helper rig, routines and poses. A routine is a looping timeline of steps (stand and work, walk,
// carry, sit...). Driving a helper means finding its step at time t and posing the rig for it.
// Nothing here changes the island; it only decides where the little helpers are and how they stand.
import * as THREE from 'three';

// Rig: root (stands on the island, faces +z) > figure > legs (pivot at hip) + body (pivot at hip) > head, arms (pivot at shoulder).
// Limbs hang along -y; a negative rotation.x swings them forward. Tools hang off handR, carried items off carry.
export function createRig({ hipY, hipX, shoulderY, shoulderX, neckY, armLength, headRadius, bodyHalfWidth, scale = 1 }) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  const figure = new THREE.Group();
  root.add(figure);
  const body = new THREE.Group();
  body.position.y = hipY;
  figure.add(body);
  const legL = new THREE.Group(); legL.position.set(hipX, hipY, 0);
  const legR = new THREE.Group(); legR.position.set(-hipX, hipY, 0);
  figure.add(legL, legR);
  const head = new THREE.Group(); head.position.y = neckY;
  const armL = new THREE.Group(); armL.position.set(shoulderX, shoulderY, 0);
  const armR = new THREE.Group(); armR.position.set(-shoulderX, shoulderY, 0);
  body.add(head, armL, armR);
  const handL = new THREE.Group(); handL.position.y = -armLength; armL.add(handL);
  const handR = new THREE.Group(); handR.position.y = -armLength; armR.add(handR);
  const carry = new THREE.Group(); carry.position.set(0, shoulderY - armLength * 0.55, armLength * 0.95); body.add(carry);
  return {
    root, figure, body, head, armL, armR, legL, legR, handL, handR, carry, tools: {}, items: {},
    hipY, headRadius, bodyHalfWidth, scale, baseScale: scale, anim: 'idle', seed: 0,
  };
}

// Tool mount: a group in the right hand whose +z points forward and a little down when the arm hangs.
export function toolMount(rig, name, build) {
  const mount = new THREE.Group();
  mount.rotation.x = 0.55;
  build(mount);
  mount.visible = false;
  rig.handR.add(mount);
  rig.tools[name] = mount;
  return mount;
}

const smooth = x => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.max(0, Math.min(1, x));
function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
export const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);

// steps: [{ at | walk, y, anim, dur, face | yaw, tool, carry, speed, seat }]. Walk steps take as long as
// the distance needs. y is the height where the step ends (the town's islands and bridges float at
// different heights); a step without one keeps the height before it, and a line without any stays at 0.
// offset shifts where in the loop the helper is at time 0.
export function timeline(steps, offset = 0) {
  let pos = steps[0].at ?? steps[0].walk, yaw = 0, time = 0, y = steps[0].y ?? 0;
  const segments = [];
  for (const step of steps) {
    let duration = step.dur ?? 1, to = step.at ?? pos, nextYaw = yaw;
    const nextY = step.y ?? y;
    if (step.walk) {
      to = step.walk;
      const distance = Math.hypot(to[0] - pos[0], to[1] - pos[1]);
      duration = Math.max(0.05, distance / (step.speed ?? 0.5));
      if (distance > 1e-4) nextYaw = yawTo(pos, to);
    }
    if (step.face && Math.hypot(step.face[0] - to[0], step.face[1] - to[1]) > 1e-4) nextYaw = yawTo(to, step.face);
    if (step.yaw !== undefined) nextYaw = step.yaw;
    segments.push({ ...step, anim: step.anim ?? (step.walk ? 'walk' : 'idle'), start: time, duration, from: pos, to, yawFrom: yaw, yawTo: nextYaw, yFrom: y, yTo: nextY });
    time += duration; pos = to; yaw = nextYaw; y = nextY;
  }
  segments[0].yawFrom = yaw;
  // Loop back cleanly: the first step starts from where the last one ended.
  segments[0].from = pos;
  segments[0].yFrom = y;
  return { segments, total: Math.max(0.1, time), offset };
}

function resetPose(rig) {
  rig.figure.position.set(0, 0, 0);
  rig.figure.rotation.set(0, 0, 0);
  rig.body.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  for (const limb of [rig.armL, rig.armR, rig.legL, rig.legR]) limb.rotation.set(0, 0, 0);
  for (const tool of Object.values(rig.tools)) tool.visible = false;
  for (const item of Object.values(rig.items)) item.visible = false;
  if (rig.pailWater) rig.pailWater.visible = false;
}

function sitPose(rig, amount, seatHeight, legAngle) {
  rig.figure.position.y = -(rig.hipY - seatHeight / rig.root.scale.y) * amount;
  rig.legL.rotation.x = rig.legR.rotation.x = legAngle * amount;
  rig.body.rotation.x = 0.08 * amount;
}

// Swing cycle shared by chopping, mining and hoeing: slow wind-up, quick strike, settle.
function swing(local, period, high, low, rest) {
  const c = (local % period) / period;
  if (c < 0.62) return { arm: lerp(rest, high, smooth(c / 0.62)), c };
  if (c < 0.74) return { arm: lerp(high, low, (c - 0.62) / 0.12), c };
  return { arm: lerp(low, rest, (c - 0.74) / 0.26), c };
}

export function pose(rig, segment, local, p, t, seatHeight = 0.11) {
  const a = segment.anim;
  const show = name => { if (name && rig.tools[name]) rig.tools[name].visible = true; };
  const carry = name => { if (name && rig.items[name]) rig.items[name].visible = true; };
  rig.body.rotation.x = Math.sin(t * 1.9 + rig.seed) * 0.02;
  if (a === 'walk' || a === 'climb') {
    // climb: up the water slide's stair, the same walk with a higher step and a little lean forward.
    const climb = a === 'climb';
    const phase = local * Math.PI * (climb ? 4.8 : 4.2);
    const s = Math.sin(phase);
    rig.legL.rotation.x = s * (climb ? 0.75 : 0.6);
    rig.legR.rotation.x = -s * (climb ? 0.75 : 0.6);
    rig.figure.position.y = Math.abs(Math.cos(phase)) * (climb ? 0.09 : 0.035);
    rig.body.rotation.z = s * 0.04;
    if (climb) rig.body.rotation.x += 0.12;
    if (segment.carry) {
      rig.armL.rotation.x = rig.armR.rotation.x = -1.15;
      rig.armL.rotation.z = -0.25; rig.armR.rotation.z = 0.25;
      carry(segment.carry);
      rig.body.rotation.x = -0.06;
    } else {
      rig.armL.rotation.x = -s * 0.5;
      rig.armR.rotation.x = s * 0.5;
      show(segment.tool);
    }
  } else if (a === 'chop' || a === 'mine') {
    const { arm, c } = swing(local, a === 'chop' ? 1.15 : 0.95, -2.75, -0.7, -0.5);
    rig.armL.rotation.x = rig.armR.rotation.x = arm;
    rig.armL.rotation.z = -0.22; rig.armR.rotation.z = 0.22;
    rig.body.rotation.x = c < 0.62 ? lerp(0.05, -0.14, smooth(c / 0.62)) : lerp(0.28, 0.05, clamp01((c - 0.62) / 0.38));
    rig.figure.position.y = c > 0.62 && c < 0.8 ? -0.02 : 0;
    rig.legL.rotation.x = -0.15; rig.legR.rotation.x = 0.15;
    show(segment.tool);
  } else if (a === 'hoe') {
    // Soil: a slower, lower chop into the ground, with a step back every few strokes.
    const { arm, c } = swing(local, 1.4, -1.9, -0.55, -0.75);
    rig.armL.rotation.x = rig.armR.rotation.x = arm;
    rig.armL.rotation.z = -0.18; rig.armR.rotation.z = 0.18;
    rig.body.rotation.x = c < 0.62 ? lerp(0.12, -0.06, smooth(c / 0.62)) : lerp(0.36, 0.12, clamp01((c - 0.62) / 0.38));
    rig.legL.rotation.x = -0.25; rig.legR.rotation.x = 0.2;
    show(segment.tool);
  } else if (a === 'saw') {
    // Planks: push and pull a saw over the bench.
    const s = Math.sin(local * Math.PI * 2 / 0.8);
    rig.armR.rotation.x = -1.25 + s * 0.35;
    rig.armL.rotation.x = -0.95;
    rig.armL.rotation.z = -0.4;
    rig.body.rotation.x = 0.22 + s * 0.05;
    rig.body.rotation.y = s * 0.05;
    rig.legL.rotation.x = -0.2; rig.legR.rotation.x = 0.2;
    show(segment.tool);
  } else if (a === 'fill') {
    // Water: hold the bucket under the rain catcher's tap, turn it on, wait while it fills (looking up at
    // the sky with a hand out for rain partway through), then turn it off. p runs once over the step.
    const reachIn = smooth(clamp01(p / 0.1)) * (1 - smooth(clamp01((p - 0.95) / 0.05)));
    const turning = (p > 0.06 && p < 0.16) || (p > 0.84 && p < 0.94);
    const atTap = smooth(clamp01((p - 0.02) / 0.06)) * (1 - smooth(clamp01((p - 0.16) / 0.06)))
      + smooth(clamp01((p - 0.78) / 0.06)) * (1 - smooth(clamp01((p - 0.94) / 0.04)));
    const up = smooth(clamp01((p - 0.4) / 0.06)) * (1 - smooth(clamp01((p - 0.6) / 0.06)));
    // The bucket is held up in front of the belly, where it shows from the side.
    rig.armR.rotation.x = lerp(-0.2, -1.05, reachIn);
    rig.armR.rotation.z = 0.32 * reachIn;
    rig.armL.rotation.x = lerp(lerp(0.1, -1.3, up), -1.2, atTap);
    rig.armL.rotation.z = lerp(lerp(0.45, 0.3, up), -0.12 + (turning ? Math.sin(local * 16) * 0.14 : 0), atTap);
    rig.body.rotation.x += 0.12 * reachIn;
    rig.head.rotation.x = lerp(0.26 * reachIn, -0.45, up);
    rig.figure.position.y = Math.abs(Math.sin(local * 1.6)) * 0.008 * (1 - atTap);
    show(segment.tool);
    const water = rig.pailWater;
    if (water) {
      const fill = smooth(clamp01((p - 0.14) / 0.72));
      water.visible = fill > 0.03;
      water.position.y = lerp(water.userData.low, water.userData.high, fill);
      water.scale.x = water.scale.z = lerp(0.86, 1, fill);
    }
  } else if (a === 'hammer') {
    const c = (local % 0.55) / 0.55;
    rig.armR.rotation.x = c < 0.6 ? lerp(-1.25, -2.2, smooth(c / 0.6)) : lerp(-2.2, -1.15, (c - 0.6) / 0.4);
    rig.armL.rotation.x = -1.2;
    rig.armL.rotation.z = -0.35;
    rig.body.rotation.x = 0.08;
    show(segment.tool);
  } else if (a === 'pickup' || a === 'drop') {
    const k = Math.sin(p * Math.PI);
    rig.figure.position.y = -0.1 * k;
    rig.body.rotation.x = 0.55 * k;
    rig.armL.rotation.x = rig.armR.rotation.x = lerp(a === 'drop' ? -1.15 : -0.1, -0.75, k);
    rig.legL.rotation.x = rig.legR.rotation.x = -0.35 * k;
    if ((a === 'pickup' && p > 0.5) || (a === 'drop' && p < 0.5)) carry(segment.carry);
  } else if (a === 'look') {
    rig.head.rotation.y = Math.sin(local * 1.4) * 0.7;
    rig.head.rotation.x = -0.12;
    rig.armL.rotation.z = 0.3; rig.armR.rotation.z = -0.3;
    rig.armL.rotation.x = rig.armR.rotation.x = 0.15;
    // Now and then a hand comes up to shade the eyes, gazing out over the sky.
    const brow = smooth(clamp01((Math.sin(local * 0.6) - 0.2) / 0.5));
    rig.armR.rotation.x = lerp(0.15, -2.55, brow);
    rig.armR.rotation.z = lerp(-0.3, 0.55, brow);
  } else if (a === 'sit' || a === 'standup' || a === 'stretch' || a === 'sitdown') {
    const height = segment.seat ?? seatHeight;
    const amount = a === 'sit' ? 1 : a === 'stretch' ? 0 : a === 'standup' ? 1 - smooth(p) : smooth(p);
    sitPose(rig, amount, height, height < 0.05 ? -1.5 : -1.45);
    if (a === 'stretch') {
      const k = Math.sin(p * Math.PI);
      rig.armL.rotation.x = rig.armR.rotation.x = -2.9 * k;
      rig.armL.rotation.z = 0.35 * k; rig.armR.rotation.z = -0.35 * k;
      rig.body.rotation.x = -0.2 * k;
      rig.head.rotation.x = -0.3 * k;
      rig.figure.position.y = 0.03 * k;
    } else {
      const warm = Math.sin(t * 2.3 + 1 + rig.seed) * 0.05;
      rig.armL.rotation.x = rig.armR.rotation.x = lerp(0, -1.2 + warm, amount);
      rig.armL.rotation.z = -0.3 * amount; rig.armR.rotation.z = 0.3 * amount;
      rig.head.rotation.z = Math.sin(t * 0.7 + rig.seed) * 0.08 * amount;
    }
  } else if (a === 'nap' || a === 'sleep') {
    rig.figure.rotation.z = Math.PI / 2;
    rig.figure.position.y = rig.bodyHalfWidth * 0.9;
    rig.legL.rotation.x = -0.35; rig.legR.rotation.x = 0.1;
    rig.armL.rotation.x = -0.6; rig.armR.rotation.x = 0.2;
    rig.armL.rotation.z = -0.4;
    rig.body.rotation.x = Math.sin(t * 1.1 + rig.seed) * 0.035;
    rig.head.rotation.x = 0.15;
  } else if (a === 'fish' || a === 'reel') {
    sitPose(rig, 1, 0.02, -1.25);
    rig.legL.rotation.x += Math.sin(t * 1.6 + rig.seed) * 0.18;
    rig.legR.rotation.x -= Math.sin(t * 1.6 + rig.seed) * 0.18;
    const lift = a === 'reel' ? Math.sin(p * Math.PI) * 0.55 : 0;
    rig.armL.rotation.x = rig.armR.rotation.x = -1.05 - lift;
    rig.armL.rotation.z = -0.25; rig.armR.rotation.z = 0.25;
    rig.head.rotation.x = 0.25 - lift * 0.3;
    show('rod');
  } else if (a === 'hop') {
    // Cloud steps: crouch, jump about 0.12 (in world units, so it reads at any helper size), land.
    const up = 0.12 / (rig.root.scale.y || 1);
    const crouch = p < 0.2 ? smooth(p / 0.2) : p > 0.8 ? smooth((1 - p) / 0.2) : 0;
    const air = p >= 0.2 && p <= 0.8 ? Math.sin((p - 0.2) / 0.6 * Math.PI) : 0;
    rig.figure.position.y = air * up - crouch * 0.05;
    rig.legL.rotation.x = rig.legR.rotation.x = -0.5 * crouch - 0.35 * air;
    rig.body.rotation.x = 0.25 * crouch;
    if (segment.carry) {
      rig.armL.rotation.x = rig.armR.rotation.x = -1.15;
      rig.armL.rotation.z = -0.25; rig.armR.rotation.z = 0.25;
      carry(segment.carry);
    } else {
      rig.armL.rotation.x = rig.armR.rotation.x = 0.3 * crouch - 1.1 * air;
      rig.armL.rotation.z = -0.35 * air; rig.armR.rotation.z = 0.35 * air;
    }
  } else if (a === 'slide' || a === 'splash') {
    // Down the water slide sitting, arms up (or hugging what they carry), then a splash in the pool.
    sitPose(rig, 1, segment.seat ?? 0.02, -1.5);
    rig.body.rotation.x = a === 'slide' ? -0.22 : -0.05;
    rig.head.rotation.x = a === 'slide' ? -0.2 : 0;
    const wave = a === 'slide' ? Math.sin(local * 9) * 0.12 : Math.sin(local * 14) * 0.4 * (1 - p);
    if (segment.carry) {
      rig.armL.rotation.x = rig.armR.rotation.x = -1.15;
      rig.armL.rotation.z = -0.25; rig.armR.rotation.z = 0.25;
      carry(segment.carry);
    } else {
      rig.armL.rotation.x = rig.armR.rotation.x = a === 'slide' ? -2.75 : -1.6;
      rig.armL.rotation.z = -0.35 + wave; rig.armR.rotation.z = 0.35 - wave;
    }
  } else {
    rig.head.rotation.y = Math.sin(t * 0.8 + rig.seed) * 0.3;
    show(segment.tool);
    carry(segment.carry);
  }
  // The water carrier's bucket hangs straight down from the hand whatever the arm and body are doing.
  // Walking, it is held a little out to the side so it clears the legs.
  const pail = rig.tools.pail;
  if (pail?.visible) {
    if (a === 'walk' || a === 'climb') { rig.armR.rotation.z = -0.22; rig.armR.rotation.x *= 0.6; }
    pail.quaternion.copy(rig.figure.quaternion).multiply(rig.body.quaternion).multiply(rig.armR.quaternion).invert();
  }
}

// Places one helper for time t on its looping timeline. still: freeze at the first step (reduced motion).
// y lifts the whole line; each step's own height (timeline y) comes on top.
export function driveHelper(rig, line, t, { still = false, seatHeight, y = 0 } = {}) {
  if (!line) return;
  const time = still ? 0 : ((t + line.offset) % line.total + line.total) % line.total;
  let segment = line.segments[0];
  for (const candidate of line.segments) if (time >= candidate.start) segment = candidate;
  const local = still ? (segment.still ?? 0) : time - segment.start;
  const p = segment.duration > 0 ? clamp01(local / segment.duration) : 1;
  const tt = still ? 0 : t;
  const yFrom = segment.yFrom ?? 0, yTo = segment.yTo ?? 0;
  if (still) rig.root.position.set(segment.to[0], y + yTo, segment.to[1]);
  else rig.root.position.set(lerp(segment.from[0], segment.to[0], p), y + lerp(yFrom, yTo, p), lerp(segment.from[1], segment.to[1], p));
  rig.root.rotation.y = still ? segment.yawTo : lerpAngle(segment.yawFrom, segment.yawTo, smooth(clamp01(local / 0.35)));
  resetPose(rig);
  pose(rig, segment, local, p, tt, seatHeight);
  rig.anim = segment.anim;
  rig.animP = p;
}
