// Saved residents select figures. Their routes and poses are disposable scene state, like helpers.
// One ground resident moves at most, and only on its turn (calm.js): then it plays its routine, which
// starts and ends sitting at home (the route's first point).
//
// Between turns it settles: it finishes what it was doing by moving its own body, never by sliding.
// In the away and done moods it curls up to sleep where it stands, or first walks on to the end of its
// route it was heading for if a cut-short turn left it in between; in the other moods it uncurls, walks
// home if it is away from it, and sits. Reduced motion and a brand-new resident jump straight to that pose.
import * as THREE from 'three';
import { createCat } from './cat.js';
import { residentRoute, residentMoment } from './placement.js';
import { createTurn, isQuietMood, turnToward } from '../calm.js';

// The kinds this version can draw: a figure, its safe route and its routine on a turn. A resident of
// an unknown future kind is skipped, so newer saves stay safe to open. Every cat looks the same for
// now: a resident's appearanceSeed is kept in the save for later looks and not read here.
const RESIDENTS = {
  cat: { create: createCat, route: residentRoute, moment: residentMoment },
};

const SEATED_YAW = residentMoment(0, { points: [0], from: [0, 0, 0], to: [0, 0, 0] }).yaw;
// Settling speeds, per second: curling and sitting take about three seconds like the routine's, the
// walk covers the route in about four, turning is gentle.
const RATE = { curl: 1 / 3, sit: 1 / 3, stride: 2, walk: 1 / 4, turn: 1.5 };
const LOOK_DONE = 10; // pose time past the routine's one head turn (6 to 9 seconds in)

export function createResidents(scene) {
  const group = new THREE.Group();
  group.name = 'residents';
  scene.add(group);
  let rigs = [], mood = 'focus', model = null, scale = 1;
  function clear() {
    for (const entry of rigs) entry.figure.dispose();
    rigs = [];
  }
  const sameRoute = (a, b) => a && b && a.island === b.island && a.points.join() === b.points.join() &&
    a.from.every((v, i) => Math.abs(v - b.from[i]) < 1e-9) && a.to.every((v, i) => Math.abs(v - b.to[i]) < 1e-9);
  return {
    group,
    get rigs() { return rigs; },
    setWorld(next) {
      model = next;
      // A bounded reader also makes unknown future kinds safe for this version to open.
      const resident = (next?.residents ?? []).find(r => Object.hasOwn(RESIDENTS, r.kind));
      const kind = resident && RESIDENTS[resident.kind];
      const route = kind?.route(next, resident.island) ?? null;
      // The same resident on the same route keeps its rig, so a world change does not make it jump.
      const old = rigs[0];
      if (old && resident && old.resident.id === resident.id && old.resident.kind === resident.kind && sameRoute(old.route, route)) {
        old.resident = { ...resident };
        old.route = route;
        return;
      }
      clear();
      if (!route) return; // Never invent ground or draw an animal inside a building.
      const figure = kind.create();
      figure.root.scale.setScalar(scale);
      group.add(figure.root);
      rigs.push({
        resident: { ...resident }, route, figure, kind,
        turn: createTurn(resident.kind, resident.island, { model: () => model }),
        state: null, // set on the first update
        last: null,
      });
    },
    setMood(next) { mood = next; },
    // Today's size boost, the same as the helpers' (core.js aim).
    setScale(k) {
      scale = k;
      for (const { figure } of rigs) figure.root.scale.setScalar(k);
    },
    update(time, still = false) {
      for (const rig of rigs) {
        const t = Number.isFinite(time) ? Math.max(0, time) : 0;
        const dt = rig.last === null ? 0 : Math.min(0.25, t >= rig.last ? t - rig.last : t);
        rig.last = still ? null : t;
        const local = rig.turn.step(t, { mood, still, ready: Boolean(rig.state) && settled(rig.state) });
        if (local !== null) rig.state = fromMoment(rig.kind.moment(local, rig.route));
        else if (still || !rig.state) rig.state = rest(isQuietMood(mood));
        else settle(rig.state, rig.route, isQuietMood(mood), dt);
        show(rig);
      }
    },
    dispose() { clear(); group.removeFromParent(); },
  };
}

const fromMoment = m => ({ mix: m.mix, yaw: m.yaw, ...m.rig, clock: m.time });
const rest = sleeping => ({ mix: 0, yaw: SEATED_YAW, sit: sleeping ? 0 : 1, curl: sleeping ? 1 : 0, stride: 0, clock: LOOK_DONE });
// Home, sitting still: ready for a turn.
const settled = s => s.mix === 0 && s.curl === 0 && s.sit === 1 && s.stride === 0 && Math.abs(s.yaw - SEATED_YAW) < 1e-6;
const toward = (value, goal, step) => (value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step));
const turnBy = (from, to, step) => {
  const gap = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return Math.abs(gap) <= step ? to : turnToward(from, to, step / Math.abs(gap));
};

// One step of settling, changing s in place. Each part waits for the one before: uncurl, stand, face the
// way, walk (the body moves only as fast as the legs stride), stop, face the camera, then curl or sit.
function settle(s, route, sleeping, dt) {
  s.clock = Math.max(s.clock < 6 || s.clock > 9 ? s.clock : LOOK_DONE, LOOK_DONE) + dt;
  const length = Math.hypot(route.to[0] - route.from[0], route.to[2] - route.from[2]);
  // Where to settle, chosen once: home when awake; to sleep, the end it is walking toward, or the
  // nearer one.
  if (s.goal === undefined || s.sleeping !== sleeping) {
    const forward = Math.atan2(route.to[0] - route.from[0], route.to[2] - route.from[2]);
    s.sleeping = sleeping;
    s.goal = !sleeping || length <= 1e-6 ? 0 : s.stride > 0 ? Number(Math.cos(s.yaw - forward) > 0) : Math.round(s.mix);
  }
  const goal = s.goal;
  const away = Math.abs(goal - s.mix);
  if (away > 1e-6 && length > 1e-6) {
    const way = Math.atan2(route.to[0] - route.from[0], route.to[2] - route.from[2]) + (goal < s.mix ? Math.PI : 0);
    if (s.curl > 0) { s.curl = toward(s.curl, 0, RATE.curl * dt); s.stride = 0; return; }
    if (s.sit > 0) { s.sit = toward(s.sit, 0, RATE.sit * dt); s.stride = 0; return; }
    const facing = Math.abs(Math.atan2(Math.sin(way - s.yaw), Math.cos(way - s.yaw))) < 0.05;
    s.yaw = turnBy(s.yaw, way, RATE.turn * dt);
    if (!facing) { s.stride = toward(s.stride, 0, RATE.stride * dt); return; }
    // Full stride until the last bit, then a shorter one so it arrives without stopping dead.
    s.stride = toward(s.stride, Math.max(0.25, Math.min(1, away / 0.15)), RATE.stride * dt);
    const move = RATE.walk * s.stride * dt;
    s.mix = away <= move ? goal : s.mix + Math.sign(goal - s.mix) * move;
    return;
  }
  s.mix = goal;
  if (s.stride > 0) { s.stride = toward(s.stride, 0, RATE.stride * dt); return; }
  // Already curling: a sleepy cat finishes curling as it lies; an awake one uncurls first.
  if (s.curl > 0) { s.curl = toward(s.curl, sleeping ? 1 : 0, RATE.curl * dt); return; }
  if (Math.abs(Math.atan2(Math.sin(SEATED_YAW - s.yaw), Math.cos(SEATED_YAW - s.yaw))) > 1e-6) {
    s.yaw = turnBy(s.yaw, SEATED_YAW, RATE.turn * dt);
    if (s.sit === 0) return; // turn standing, then sit or curl
  }
  if (!sleeping) s.sit = toward(s.sit, 1, RATE.sit * dt);
  else if (s.sit > 0) s.sit = toward(s.sit, 0, RATE.sit * dt);
  else s.curl = toward(s.curl, 1, RATE.curl * dt);
}

function show({ figure, route, state: s }) {
  const pose = s.stride > 0 ? 'walk' : s.curl > 0 ? 'rest' : 'sit';
  figure.pose(pose, s.clock, { sit: s.sit, curl: s.curl, stride: s.stride });
  figure.root.position.fromArray(route.from.map((v, i) => v + s.mix * (route.to[i] - v)));
  figure.root.rotation.y = s.yaw;
}
