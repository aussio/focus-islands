// The town camera's slow drift: where the camera looks at any moment, as a pure function of time.
// No Three.js and no clock here; the stage passes the seconds since the drift started.
//
// After every world change the camera rests on the busy view (home: decision 6's view of view.island).
// Then it takes slow trips and comes back. On every other trip it first pulls back to show the whole
// group of islands. Each trip then glides to one other island, framed whole, and back home. Trips visit
// the other islands in turn, nearest first. Moves ease in and out gently (smootherstep: no jolt as
// they start or stop), and take longer the farther they go, so even at their fastest (half way) they
// cross at most 6% of the picture's width a second.
//
//   planDrift({ home, wide, others }, timing?) => route, or null when there is nowhere else to look
//   driftPose(route, seconds) => pose      the pose at that many seconds after the drift started
//   blendPose(a, b, k) => pose             k (0..1) of the way from a to b; distance on a log scale
//   moveSize(a, b)                         how big a move looks: screen widths panned plus doublings zoomed
//   samePlace(a, b)                        true when two poses would look alike on screen
//   swayYaw(seconds)                       the "sway" style's slow turn left and right, in radians
//
// A pose is { at: [x, y, z], distance, elevation, yaw }: the look point, the camera's distance from it,
// its angle above the horizon and its turn from looking north (radians; 0 is north).

export const DRIFT = {
  home: 60, // seconds resting on the busy view, after every world change and between trips
  away: 20, // seconds resting at each other place
  pace: 0.06, // fastest speed of a move, in moveSize per second (6% of a picture's width a second)
  moveMin: 16, // seconds for the smallest move
  moveMax: 40, // seconds for the largest move (it may go a little faster than pace)
  nearest: 0.9, // another island is never framed closer than this share of home's distance
};
const PEAK = 1.875; // smootherstep's fastest speed, as a share of its average
export const SWAY = { degrees: 14, seconds: 150 }; // the "sway" style: ±14° over a 150 s swing

// Smootherstep: starts and stops with no speed and no sudden push, for the long drift moves.
export const gentle = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

export const blendPose = (a, b, k) => ({
  at: a.at.map((v, i) => v + (b.at[i] - v) * k),
  distance: a.distance * Math.pow(b.distance / a.distance, k),
  elevation: a.elevation + (b.elevation - a.elevation) * k,
  yaw: (a.yaw ?? 0) + ((b.yaw ?? 0) - (a.yaw ?? 0)) * k,
});

// Screen widths panned (a frame is about 0.6 of the camera's distance across) plus doublings of zoom.
export function moveSize(a, b) {
  const pan = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]) / ((a.distance + b.distance) / 2) / 0.6;
  const zoom = Math.abs(Math.log2(b.distance / a.distance));
  const turn = Math.abs((b.yaw ?? 0) - (a.yaw ?? 0)) / 0.5 + Math.abs(b.elevation - a.elevation) / 0.5;
  return Math.hypot(pan, zoom, turn);
}
export const samePlace = (a, b, tolerance = 0.12) => Boolean(a && b) && moveSize(a, b) < tolerance;

export const moveSeconds = (a, b, timing = DRIFT) => Math.min(timing.moveMax, Math.max(timing.moveMin, PEAK * moveSize(a, b) / timing.pace));

// home: the busy view. wide: the whole group (or null). others: one pose per other island, each
// framing it whole. Poses too close to home (or wide to nothing new) are left out.
export function planDrift({ home, wide = null, others = [] }, timing = DRIFT) {
  if (!home) return null;
  const spot = pose => ({ ...pose, at: pose.at.slice(), yaw: pose.yaw ?? 0 });
  const far = pose => Math.hypot(pose.at[0] - home.at[0], pose.at[2] - home.at[2]);
  const places = others
    .map((pose, i) => ({ pose: spot({ ...pose, distance: Math.max(pose.distance, home.distance * timing.nearest) }), i }))
    .filter(({ pose }) => !samePlace(pose, home))
    .sort((a, b) => far(a.pose) - far(b.pose) || a.i - b.i)
    .map(({ pose }) => pose);
  // Pulling back must show clearly more than home does.
  const pull = wide && !samePlace(wide, home, 0.2) ? spot(wide) : null;
  if (!places.length && !pull) return null;
  // Trip j pulls back first when j is even. With an odd number of islands that takes two rounds.
  const trips = !places.length ? 1 : pull && places.length % 2 ? places.length * 2 : places.length;
  const segments = [];
  let t = 0;
  const add = (from, to, seconds) => { segments.push({ from, to, start: t, seconds }); t += seconds; };
  const base = spot(home);
  for (let j = 0; j < trips; j++) {
    add(base, base, timing.home);
    const stops = [pull && j % 2 === 0 ? pull : null, places.length ? places[j % places.length] : null].filter(Boolean);
    let here = base;
    for (const stop of stops) {
      add(here, stop, moveSeconds(here, stop, timing));
      add(stop, stop, timing.away);
      here = stop;
    }
    add(here, base, moveSeconds(here, base, timing));
  }
  return { segments, period: t, home: base, wide: pull, places };
}

// The pose at `seconds` after the drift started. Before the start it is home.
export function driftPose(route, seconds) {
  if (!route) return null;
  if (!(seconds > 0)) return route.home;
  const s = seconds % route.period;
  const segment = route.segments.find(g => s < g.start + g.seconds) ?? route.segments[route.segments.length - 1];
  if (segment.from === segment.to) return segment.from;
  return blendPose(segment.from, segment.to, gentle((s - segment.start) / segment.seconds));
}

// The sway style's yaw: a slow swing to each side and back, starting (and passing) at north.
export const swayYaw = (seconds, sway = SWAY) => (seconds > 0 ? Math.sin(2 * Math.PI * seconds / sway.seconds) * sway.degrees * Math.PI / 180 : 0);
