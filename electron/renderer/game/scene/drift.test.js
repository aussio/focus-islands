// The camera's drift as plain numbers (scene/drift.js): rests and trips, calm speeds, every island
// visited, and the same time always giving the same pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT, SWAY, blendPose, driftPose, gentle, moveSize, ovalScale, planDrift, samePlace, swayPose, swayYaw } from './drift.js';

const pose = (x, z, distance, y = 0) => ({ at: [x, y, z], distance, elevation: 0.8, yaw: 0 });
const home = pose(0, 0, 30);
const wide = pose(2, -2, 70);
const others = [pose(25, 0, 26), pose(-12, 0, 18), pose(14, -14, 24)];

test('with nowhere else to look, there is no drift', () => {
  assert.equal(planDrift({ home }), null);
  assert.equal(planDrift({ home, wide: pose(0.2, 0, 30.5) }), null, 'a "whole group" that looks like home adds nothing');
  assert.equal(planDrift({ home, others: [pose(0.1, 0, 30)] }), null);
  assert.equal(driftPose(null, 10), null);
});

test('the drift rests on the busy view first, and the same time always gives the same pose', () => {
  const route = planDrift({ home, wide, others });
  for (const s of [-5, 0, 1, DRIFT.home / 2, DRIFT.home - 0.01]) assert.deepEqual(driftPose(route, s), route.home);
  assert.deepEqual(driftPose(route, 123.4), driftPose(route, 123.4));
  assert.ok(samePlace(driftPose(route, 77.7), driftPose(route, 77.7 + route.period), 1e-9), 'it repeats after a whole round');
  assert.ok(route.period > 0 && Number.isFinite(route.period));
});

test('every other island gets a rest, nearest first, and the whole group shows on every other trip', () => {
  const route = planDrift({ home, wide, others });
  const rests = route.segments.filter(g => g.from === g.to);
  const places = rests.map(g => g.from).filter(p => p !== route.home && p !== route.wide);
  // Three islands and a pull back on even trips: six trips, so each island twice.
  assert.equal(places.length, 6);
  const order = places.slice(0, 3).map(p => p.at[0]);
  assert.deepEqual(order, [-12, 14, 25], 'nearest first');
  const wides = rests.filter(g => g.from === route.wide);
  assert.equal(wides.length, 3, 'the whole group on trips 0, 2 and 4');
  // Each trip starts with a rest at home and comes back home.
  const homes = rests.filter(g => g.from === route.home);
  assert.equal(homes.length, 6);
  for (const g of homes) assert.equal(g.seconds, DRIFT.home);
  for (const g of rests.filter(g => g.from !== route.home)) assert.equal(g.seconds, DRIFT.away);
  // Another island is never framed much closer than home.
  for (const p of route.places) assert.ok(p.distance >= home.distance * DRIFT.nearest - 1e-9);
  // One other island and no pull back: one trip, there and back.
  const one = planDrift({ home, others: [others[0]] });
  assert.equal(one.segments.length, 4);
  // Only a pull back (a close busy view on a single island): out to the whole island and back.
  const out = planDrift({ home, wide });
  assert.deepEqual(out.segments.map(g => (g.from === g.to ? 'rest' : 'move')), ['rest', 'move', 'rest', 'move']);
});

test('moves are slow, smooth and start and stop gently', () => {
  const route = planDrift({ home, wide, others });
  const dt = 0.05;
  for (const g of route.segments.filter(g => g.from !== g.to)) {
    assert.ok(g.seconds >= DRIFT.moveMin && g.seconds <= DRIFT.moveMax);
    // A move never passes pace, unless it is as long as a move may be; then it is as slow as it can be.
    // (10% spare: a pan is measured against the distance at that moment, which changes while zooming.)
    let peak = 0;
    for (let s = g.start; s < g.start + g.seconds; s += dt) peak = Math.max(peak, moveSize(driftPose(route, s), driftPose(route, s + dt)) / dt);
    const allowed = Math.max(DRIFT.pace, 1.875 * moveSize(g.from, g.to) / DRIFT.moveMax);
    assert.ok(peak <= allowed * 1.1, `the fastest moment is ${peak.toFixed(3)} a second (allowed ${allowed.toFixed(3)})`);
    // No jolt: right at the start and end the camera is barely moving.
    const edge = moveSize(driftPose(route, g.start), driftPose(route, g.start + dt)) / dt;
    const end = moveSize(driftPose(route, g.start + g.seconds - dt), driftPose(route, g.start + g.seconds)) / dt;
    assert.ok(edge < DRIFT.pace * 0.01 && end < DRIFT.pace * 0.01, `a move starts at ${edge} and ends at ${end}`);
  }
  // Each move lands exactly on its place, with no jump into the rest that follows.
  for (const g of route.segments) assert.ok(samePlace(driftPose(route, g.start + g.seconds - 1e-6), g.to, 1e-4));
});

test('poses blend on a log scale for distance, and the drift keeps the yaw at north', () => {
  const mid = blendPose(pose(0, 0, 10), pose(10, 0, 40), 0.5);
  assert.deepEqual(mid.at, [5, 0, 0]);
  assert.ok(Math.abs(mid.distance - 20) < 1e-9);
  assert.equal(gentle(0), 0);
  assert.equal(gentle(1), 1);
  assert.ok(Math.abs(gentle(0.5) - 0.5) < 1e-12);
  const route = planDrift({ home, wide, others });
  for (let s = 0; s < route.period; s += 3) assert.equal(driftPose(route, s).yaw, 0);
});

test('the sway turns at most its set amount each way, from north', () => {
  assert.equal(swayYaw(0), 0);
  const most = SWAY.degrees * Math.PI / 180;
  let low = 0, high = 0;
  for (let s = 0; s < SWAY.seconds * 2; s += 0.25) { low = Math.min(low, swayYaw(s)); high = Math.max(high, swayYaw(s)); }
  assert.ok(Math.abs(high - most) < 1e-3 && Math.abs(low + most) < 1e-3);
  // Wide but slow: at its fastest (passing north) it turns about 0.59° a second, as the first ±14° sway did.
  let fastest = 0;
  for (let s = 0; s < SWAY.seconds; s += 0.25) fastest = Math.max(fastest, Math.abs(swayYaw(s + 0.25) - swayYaw(s)) / 0.25);
  const degrees = fastest * 180 / Math.PI;
  assert.ok(Math.abs(degrees - 0.59) < 0.01, `turns ${degrees.toFixed(3)}° a second at its fastest`);
});

test('the sway turns a pose around its look point, along its ellipse', () => {
  const home = { ...pose(3, 1, 20), oval: [0.3, -0.1] };
  assert.equal(ovalScale(home.oval, 0), 1, 'facing its own way, the camera sits at the pose\'s distance');
  assert.equal(ovalScale(undefined, 0.7), 1, 'no oval: a circle');
  const turned = swayPose(home, 0.5);
  assert.deepEqual(turned.at, home.at, 'it turns around the look point');
  assert.equal(turned.yaw, 0.5);
  assert.ok(Math.abs(turned.distance - 20 * ovalScale(home.oval, 0.5)) < 1e-12);
  // The path is an ellipse: 1 / distance² is A + B cos 2θ + C sin 2θ for any turn.
  const inv = t => 1 / ovalScale(home.oval, t) ** 2;
  for (const t of [0.2, 0.9, -1.3]) assert.ok(Math.abs(inv(t) - (1 - 0.3 + 0.3 * Math.cos(2 * t) - 0.1 * Math.sin(2 * t))) < 1e-12);
  // Trips blend the ellipse too, so the sway goes on smoothly during a move.
  const other = { ...pose(9, 1, 30), oval: [-0.1, 0.2] };
  assert.deepEqual(blendPose(home, other, 0.5).oval.map(v => Math.round(v * 1e9) / 1e9), [0.1, 0.05]);
  assert.equal('oval' in blendPose(pose(0, 0, 10), pose(1, 0, 10), 0.5), false);
});
