// Islands in the sky and bridges (game/BUILD_PLAN.md, "Islands in the sky and bridges"). Plain code:
// no DOM, no Three.js. Used by the layout (index.js), the sample towns and the checks.
//
//   placeIslands(list) => [{ at, distance }]   where each island's grid middle floats; only ever outward
//   wayOut(island, other) => [dx, dz]          a bridge end's fixed way out, from the sky table only
//   pierOf(grid, base, out) => { chain, hold }  a bridge's pier: the points straight out from its first
//                                              foot, and the points that wait while the pier is short
//   pickFoot(grid, land, isLand, out, ok) => { point, pier } | null   a bridge's first foot and its pier
//   clearOf(grid, land, foot, out, base) => number   how far the deck runs straight along out from the foot
//   deckLine(world, bridge) => [[x, z], ...]   the deck's flat middle line in world units, foot to foot
//
// Piers: a bridge's first foot (its base) is a coast lane. The points straight out from it along `out`
// to the grid's rim are its pier strip (`chain`). Land may grow onto the strip, but only in order (a
// strip point only after the one inward of it), and every strip point that becomes land is a lane. The
// foot is always the outermost land point of base + strip, so as the island grows the foot moves out
// along its fixed `out`, at the end of a straight lane. Points near the deck's straight line ahead of the
// foot wait (`hold`) until the foot has passed them, so no land ever grows under a deck.
//
// The deck shape the layout checks against (the scene's deckPath adds the heights):
//   1. from each foot, straight along its `out` for its `clear`;
//   2. between the two ends of those straight parts, a cubic curve whose handles run along each end's
//      `out`, each a third of the gap long. Bridges along one angle come out (nearly) straight.
import { straightOut } from './growth.js';
import { canFill } from './grid.js';

export const SKY_GAP = 2.4; // sky kept between the land of any two islands
export const DRIFT_STEP = 0.65; // island distances grow in these steps
// Islands the rules placed before ring and angle were saved get them from the same table (fallback only).
export const ANGLES = [0, 180, 315, 135, 225, 45, 270, 90];
// clear: land beside the strip within this distance of the deck's line pushes the bend farther out.
export const CLEAR_SIDE = 2.6;
export const CLEAR_PAST = 0.65; // and the bend starts this far past that land
// Grid points this close to a deck's straight line, ahead of its foot, wait until the foot passes them.
export const DECK_ROOM = 0.4;
// The deck's first FOOT_ROOM from its foot starts on land anyway, so it doesn't count (checkTown agrees).
export const FOOT_ROOM = 0.45;
// Islands in the same ring this far apart are neighbours (the rules' sky table), and they float at most
// AROUND_SPREAD apart in distance from home.
const AROUND_ANGLE = 45;
export const AROUND_SPREAD = 3.9;
// Fixed early land that every island always has (version-1 starts were 4 and 2 spots of 7 points), for
// the lower bound on how far an island floats.
const FIRST_LAND = { home: 28, island: 14 };

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const degreesApart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const unitOf = degrees => [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];

// ---------- Where islands float ----------

// Home sits at [0, 0]. Every other island keeps its angle; its distance along it is the smallest that
// leaves SKY_GAP of sky between its land and the land of every earlier island, rounded up to DRIFT_STEP,
// and keeps it within AROUND_SPREAD of its neighbours around the ring.
//   list: [{ ring, angle, grid, land }] in arrival order, home (ring 0) first. land: points in fill order.
//
// Against home and against an island at the same angle (ring 2 beyond ring 1) it uses how far each
// island's land reaches toward the other. Against islands at other angles it uses reach circles. To
// keep "only outward" true from the state alone, every rule only grows as land grows: for an earlier
// island less than 90° away it uses the worst spot that island could have had on its way out, and for
// one 90° or more away, the closest it could ever float.
export function placeIslands(list) {
  // Around a ring, neighbours float at most AROUND_SPREAD apart in distance from home, so the bridge
  // between them only bends a little: the nearer one is pushed out. Pushing only ever moves islands out,
  // so this repeats until nothing more moves.
  const floor = list.map(() => 0);
  for (let pass = 0; ; pass++) {
    const placed = placeOnce(list, floor);
    let pushed = false;
    list.forEach((isle, i) => {
      if (!isle.ring) return;
      list.forEach((other, j) => {
        if (other.ring !== isle.ring || degreesApart(other.angle, isle.angle) !== AROUND_ANGLE) return;
        const want = placed[j].distance - AROUND_SPREAD;
        if (want > placed[i].distance + 1e-9 && want > floor[i] + 1e-9) { floor[i] = want; pushed = true; }
      });
    });
    if (!pushed || pass > 100) return placed.map(({ at, distance }) => ({ at, distance }));
  }
}

function placeOnce(list, floor) {
  const placed = [];
  const reach = list.map(isle => Math.max(0, ...isle.land.map(p => Math.hypot(...isle.grid.points[p]))));
  const toward = (isle, [ux, uz], land = isle.land) => Math.max(-Infinity, ...land.map(p => isle.grid.points[p][0] * ux + isle.grid.points[p][1] * uz));
  const home = list.find(isle => !isle.ring);
  list.forEach((isle, i) => {
    if (!isle.ring) { placed.push({ at: [0, 0], distance: 0, u: [0, 0], low: 0 }); return; }
    const u = unitOf(isle.angle), back = [-u[0], -u[1]];
    const fromHome = home ? toward(home, u) + toward(isle, back) + SKY_GAP : SKY_GAP;
    const low = home
      ? toward(home, u, home.land.slice(0, FIRST_LAND.home)) + toward(isle, back, isle.land.slice(0, FIRST_LAND.island)) + SKY_GAP
      : SKY_GAP;
    let need = Math.max(fromHome, floor[i]);
    for (let j = 0; j < i; j++) {
      const other = list[j], spot = placed[j];
      if (!other.ring) continue;
      const c = u[0] * spot.u[0] + u[1] * spot.u[1];
      if (c > 1 - 1e-6) { need = Math.max(need, spot.distance + toward(other, u) + toward(isle, back) + SKY_GAP); continue; }
      const s = Math.sqrt(Math.max(0, 1 - c * c));
      const r = reach[j] + reach[i] + SKY_GAP;
      // Smallest d with |d·u − t·u_other| >= r is t·c + sqrt(r² − t²·s²), while t·s < r.
      const t = c > 0 ? Math.min(spot.distance, r * c / s) : spot.low;
      if (t * s < r) need = Math.max(need, t * c + Math.sqrt(r * r - t * t * s * s));
    }
    const distance = round4(Math.ceil(need / DRIFT_STEP - 1e-9) * DRIFT_STEP);
    placed.push({ at: [round4(u[0] * distance), round4(u[1] * distance)], distance, u, low });
  });
  return placed;
}

// ---------- Bridges ----------

// A ring-r island's standard spot is r units along its angle; home's is the middle.
export const standardSpot = ({ ring, angle }) => (ring ? unitOf(angle).map(v => v * ring) : [0, 0]);

// An end's way out: the direction from its island's standard spot toward the other island's. It comes
// only from the table (ring and angle), never from where the islands really float, so it never changes.
export function wayOut(island, other) {
  const a = standardSpot(island), b = standardSpot(other);
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
  return [round4(dx / length), round4(dz / length)];
}

// How far a point is from the ray that leaves the grid's middle along out.
const offRay = ([x, z], [ux, uz]) => (x * ux + z * uz < 0 ? Math.hypot(x, z) : Math.abs(x * uz - z * ux));

// A pier from its base (the first foot) along out:
//   chain: the points straight out to the grid's rim (growth.js straightOut), in order;
//   hold: Map point -> k. The point may become land only once the foot is chain point k − 1 or farther
//     out (k counts the base as 0, so a point with k = 2 waits for chain[1]). These are the points within
//     DECK_ROOM of the straight deck line from some foot the pier may still have behind them. Only points
//     land can grow on (canFill) are listed.
// Every measure is along and across the base's own line, so a pier is the same whenever it is made.
export function pierOf(grid, base, out) {
  const [bx, bz] = grid.points[base];
  const along = p => (grid.points[p][0] - bx) * out[0] + (grid.points[p][1] - bz) * out[1];
  const aside = p => (grid.points[p][0] - bx) * out[1] - (grid.points[p][1] - bz) * out[0];
  const chain = straightOut(grid, base, out);
  const feet = [base, ...chain].map(p => ({ along: along(p), aside: aside(p) }));
  const onPier = new Set([base, ...chain]);
  const hold = new Map();
  grid.points.forEach((_, p) => {
    if (onPier.has(p) || !canFill(grid, p)) return;
    const a = along(p), s = aside(p);
    if (a <= 0) return;
    let k = 0;
    feet.forEach((f, j) => {
      // How near the deck's line from this foot comes to p, leaving out its first FOOT_ROOM.
      const ahead = a - f.along, across = Math.abs(s - f.aside);
      if (ahead <= 1e-9) return;
      if ((ahead >= FOOT_ROOM ? across : Math.hypot(FOOT_ROOM - ahead, across)) < DECK_ROOM) k = j + 1;
    });
    if (k) hold.set(p, k);
  });
  return { chain, hold };
}

// The first foot: the coast point nearest the ray from the grid's middle along out (ties: the lower
// number) that ok(p, pier) accepts and whose pier strip and held points are all sky. isLand(p) and
// ok(p, pier) are the caller's tests; ok is asked lazily, nearest first, so it may be slow.
// Returns { point, pier } or null.
export function pickFoot(grid, land, isLand, out, ok) {
  const coast = land.filter(p => grid.neighbours[p].some(n => !isLand(n)));
  const off = new Map(coast.map(p => [p, offRay(grid.points[p], out)]));
  coast.sort((a, b) => off.get(a) - off.get(b) || a - b);
  for (const p of coast) {
    const chain = straightOut(grid, p, out);
    if (!chain.length || chain.some(isLand)) continue;
    const pier = pierOf(grid, p, out);
    if ([...pier.hold.keys()].some(isLand)) continue;
    if (!ok(p, pier)) continue;
    return { point: p, pier };
  }
  return null;
}

// How far the deck runs straight from the foot: past every land point that lies beside the base's line
// (within CLEAR_SIDE of it) and ahead of the foot, plus CLEAR_PAST. Measured along the base's line, so
// the bend (foot + out × clear) only ever moves out: as land grows near the line it moves out, and as
// the foot moves out along its pier, clear shrinks to match. base: the pier's first foot (the foot
// itself when left out).
export function clearOf(grid, land, foot, out, base = foot) {
  const [bx, bz] = grid.points[base];
  const along = p => (grid.points[p][0] - bx) * out[0] + (grid.points[p][1] - bz) * out[1];
  const from = along(foot);
  let most = from;
  for (const p of land) {
    const a = along(p);
    if (a > most && Math.abs((grid.points[p][0] - bx) * out[1] - (grid.points[p][1] - bz) * out[0]) <= CLEAR_SIDE) most = a;
  }
  return round4(most - from + CLEAR_PAST);
}

// The deck's flat middle line in world units, foot to foot, about `step` apart along the curve.
export function deckLine(world, bridge, step = 0.25) {
  const ends = [bridge.from, bridge.to].map(end => {
    const island = world.islands.find(i => i.id === end.island);
    const [x, z] = island.grid.points[end.point];
    const foot = [island.at[0] + x, island.at[1] + z];
    return { foot, out: end.out, bend: [foot[0] + end.out[0] * end.clear, foot[1] + end.out[1] * end.clear] };
  });
  const [a, b] = ends;
  const gap = Math.hypot(b.bend[0] - a.bend[0], b.bend[1] - a.bend[1]);
  const h = gap / 3;
  const c1 = [a.bend[0] + a.out[0] * h, a.bend[1] + a.out[1] * h];
  const c2 = [b.bend[0] + b.out[0] * h, b.bend[1] + b.out[1] * h];
  const line = [];
  const straight = (from, to) => {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
    for (let k = 0; k < n; k++) line.push([from[0] + (to[0] - from[0]) * k / n, from[1] + (to[1] - from[1]) * k / n]);
  };
  straight(a.foot, a.bend);
  const n = Math.max(1, Math.ceil(gap / step));
  for (let k = 0; k < n; k++) {
    const t = k / n, m = 1 - t;
    line.push([0, 1].map(i => m * m * m * a.bend[i] + 3 * m * m * t * c1[i] + 3 * m * t * t * c2[i] + t * t * t * b.bend[i]));
  }
  straight(b.bend, b.foot);
  line.push(b.foot);
  return line;
}
