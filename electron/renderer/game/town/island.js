// The per-island replay (game/BUILD_PLAN.md, "Replaying an island" and "The start of each island").
// Plain code: no DOM, no Three.js. Houses, pads, lanes and decoration live in houses.js, pads.js,
// lanes.js and nature.js; bridge feet use sky.js.
//
//   replayIsland(spec, events) => Isle
//     spec: { id, kind, size, land, golden }
//     events, in check-in order: { checkIn, land, building: { id, blueprint } }, { checkIn, land, foot: { link, out } }
//     or { checkIn, land, keepsake: { id, kind } }
//
// The island starts, then each event grows the land to its `land` and places its building, bridge foot
// or keepsake (a small thing a surprise left: on a free coast point facing out, the fountain beside the
// square; never on borrowed land, and left out if there is no spot). At the end the land grows to the island's `land`. Every choice is a roll from the island id, the
// building id and point numbers. Nothing placed ever moves, so a longer history only adds.
//
// If something has no place, the replay first tries looser rules (houses and pads may touch the coast,
// pads may sit beside blocks, lanterns needn't touch a lane). A pad that still has none may then squeeze
// in: it may cut off coast points and points that already hold something, and any free point it leaves
// that nobody can walk to gets a hedge. If it still has none, the replay adds the next land points until
// it fits and counts them in `borrowed`. On the real rules that should never happen (long-run.test.js
// checks it).
import { KINDS, BLOCK_BLUEPRINTS } from '../kinds.js';
import { gridFor, roll, canFill } from './grid.js';
import { growthOrder } from './growth.js';
import { stepsFrom, laneChain, joinLane } from './lanes.js';
import { newHouse, addRoom, addFloor } from './houses.js';
import { placeBuilding } from './pads.js';
import { pickFoot } from './sky.js';

// Where each island's replay starts: home 40, new islands by size. These were the rules' start land before
// lanes were counted at 0.22. Islands that arrive bigger now start here and grow to their saved land, so
// towns saved earlier never move.
export const START_LAND = { home: 40, small: 30, medium: 40, large: 55 };
// Kinds that stop helpers walking through.
const blocking = kind => Boolean(KINDS[kind]?.blocks);
const MAX_BORROW = 80; // a building that still has no place after this many extra points is left out
// How loose the placement rules are (isle.loose): the usual rules, then LOOSE (see Isle.withRoom), then
// SQUEEZE for pads only (pads.js).
export const LOOSE = 1;
export const SQUEEZE = 2;
const EXTRA_BY_KIND = { mossy: 'mushroom', rocky: 'rock', meadow: 'flower', crystal: 'crystal', misty: 'bush' };

export const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
export const yawOf = ([dx, dz]) => round4(Math.atan2(dx, dz));
export const middleOf = list => [round4(list.reduce((s, p) => s + p[0], 0) / list.length), round4(list.reduce((s, p) => s + p[1], 0) / list.length)];

// Sorts by a score (lowest first), ties by the item's own number.
export function sortBy(list, score) {
  return list.map(item => ({ item, k: score(item) }))
    .sort((a, b) => a.k - b.k || (typeof a.item === 'number' ? a.item - b.item : 0))
    .map(s => s.item);
}

// One island while it is replayed: its grid, land, lanes, houses and things, with the point tests the
// placement rules share.
export class Isle {
  constructor({ id, kind, size }) {
    this.id = id;
    this.kind = kind;
    this.size = size;
    this.grid = gridFor(id, size);
    this.order = growthOrder(this.grid, id);
    const n = this.grid.points.length;
    this.land = [];
    this.isLandMark = new Uint8Array(n);
    this.kept = [];
    this.isKept = new Uint8Array(n);
    this.lanes = [];
    this.isLane = new Uint8Array(n);
    this.blockOf = new Int16Array(n).fill(-1); // index into houses
    this.taken = new Array(n).fill(null); // the thing standing there
    this.entrance = new Uint8Array(n); // door outsides and pad fronts
    this.houses = [];
    this.things = [];
    this.feet = new Map(); // link id -> its pier: { link, base, out, chain, hold, at } (sky.js pierOf)
    this.piers = [];
    this.pierAt = new Int16Array(n).fill(-1); // for a pier strip point: its pier's index
    this.holds = new Map(); // point -> [[pier index, k], ...]: it waits until that pier's `at` reaches k
    this.plaza = -1;
    this.golden = -1;
    this.borrowed = 0;
    this.loose = 0; // LOOSE or SQUEEZE while withRoom tries looser placement rules
    this.newest = null; // the newest building: { checkIn, points }
    this.version = 0; // grows with every change, for cached searches
    this.pos = 0; // growth: the next point in the order
    this.waiting = []; // growth: points held back until they touch walkable land
    this.reachCache = { version: -1 };
  }

  // ---- Point tests ----
  isLand(p) { return this.isLandMark[p] === 1; }
  isCoast(p) { return this.isLandMark[p] === 1 && this.grid.neighbours[p].some(n => !this.isLandMark[n]); }
  isInland(p) { return this.isLandMark[p] === 1 && this.grid.neighbours[p].every(n => this.isLandMark[n]); }
  // Land with nothing on it: no lane, block or thing, and not the golden point.
  isFree(p) { return this.isLandMark[p] === 1 && !this.isLane[p] && this.blockOf[p] < 0 && !this.taken[p] && p !== this.golden; }
  // Where helpers can walk: land that isn't a block, a blocking thing or the golden point (it may become a tree).
  isWalkable(p) { return this.isLandMark[p] === 1 && this.blockOf[p] < 0 && p !== this.golden && !(this.taken[p] && blocking(this.taken[p].kind)); }
  nextToBlock(p) { return this.grid.neighbours[p].some(n => this.blockOf[n] >= 0); }
  nextToPad(p) { return this.grid.neighbours[p].some(n => this.taken[n]?.pad); }
  touching(p, set) { let k = 0; for (const n of this.grid.neighbours[p]) if (set.has(n)) k++; return k; }
  // Used points (blocks and things) within 2 steps, not counting the points themselves.
  crowd(points) {
    const own = new Set(points), near = new Set();
    for (const p of points) for (const n of this.grid.neighbours[p]) { near.add(n); for (const m of this.grid.neighbours[n]) near.add(m); }
    let k = 0;
    for (const q of near) if (!own.has(q) && (this.blockOf[q] >= 0 || this.taken[q])) k++;
    return k;
  }
  stepsFrom(starts, ok) { return stepsFrom(this.grid, starts, ok); }
  thingsCount() { return this.things.length; }

  // Steps from the plaza over walkable land, and from the lanes over free land, cached until something
  // changes.
  walkSteps() { return this.cached('walk', () => stepsFrom(this.grid, [this.plaza], p => this.isWalkable(p))); }
  laneSteps() { return this.cached('lane', () => stepsFrom(this.grid, this.lanes, p => this.isFree(p))); }
  cached(name, make) {
    if (this.reachCache.version !== this.version) this.reachCache = { version: this.version };
    if (!this.reachCache[name]) this.reachCache[name] = make();
    return this.reachCache[name];
  }

  // With these points shut, does every free point the lanes can reach now (through free points) stay
  // reachable, so a lane can still get to it later? And does every point helpers can walk to stay
  // walkable from the plaza?
  // With a `hedges` list (a pad squeezing in), only free inland points must stay reachable: coast points
  // and points that hold something may be cut off. The free ones nobody can walk to any more are added
  // to `hedges`, for the caller to cover.
  staysReachable(shut, hedges = null) {
    if (this.plaza < 0) return true;
    const closed = new Set(shut);
    if (closed.has(this.plaza)) return false;
    const cut = new Set(), stranded = [];
    const lane = this.laneSteps();
    const laneAfter = stepsFrom(this.grid, this.lanes.filter(p => !closed.has(p)), p => !closed.has(p) && this.isFree(p));
    for (const p of this.land) {
      if (lane[p] > 0 && !closed.has(p) && laneAfter[p] < 0) { if (!hedges) return false; cut.add(p); }
    }
    const walk = this.walkSteps();
    const walkAfter = stepsFrom(this.grid, [this.plaza], p => !closed.has(p) && this.isWalkable(p));
    for (const p of this.land) {
      if (walk[p] >= 0 && !closed.has(p) && walkAfter[p] < 0) { if (!hedges) return false; cut.add(p); stranded.push(p); }
    }
    if ([...cut].some(p => this.isFree(p) && !this.isCoast(p))) return false;
    if (hedges) hedges.push(...stranded.filter(p => this.isFree(p)));
    return true;
  }

  // ---- Changes ----
  changed() { this.version++; }
  addLand(p) {
    this.land.push(p);
    this.isLandMark[p] = 1;
    // A pier strip point becomes a lane, and its pier's foot moves out onto it.
    const i = this.pierAt[p];
    if (i >= 0) { this.piers[i].at += 1; this.addLane(p); }
    this.changed();
  }
  addLane(p) { if (!this.isLane[p]) { this.isLane[p] = 1; this.lanes.push(p); this.changed(); } }
  keep(points) {
    for (const p of points) {
      if (this.isKept[p] || this.isLandMark[p] || !canFill(this.grid, p)) continue;
      this.isKept[p] = 1;
      this.kept.push(p);
      const w = this.waiting.indexOf(p);
      if (w >= 0) this.waiting.splice(w, 1);
    }
    this.changed();
  }
  addThing(thing) {
    this.things.push(thing);
    for (const p of thing.points) this.taken[p] = thing;
    if (thing.front !== null && thing.front !== undefined) this.entrance[thing.front] = 1;
    this.changed();
    return thing;
  }
  addBlock(house, p) {
    house.blocks.push({ point: p, floors: 1 });
    this.blockOf[p] = this.houses.indexOf(house);
    this.changed();
  }

  // Can point p become land now? It must touch land helpers can walk to from the plaza (so land stays
  // one piece and every new point can be walked to, even beside a corner a pad squeezed off). A pier
  // strip point waits for the strip point inward of it, and a point near a deck's line waits until that
  // pier's foot has passed it (sky.js pierOf).
  canGrow(p) {
    const walk = this.plaza < 0 ? null : this.walkSteps();
    if (!this.grid.neighbours[p].some(n => this.isLandMark[n] && (walk ? walk[n] >= 0 : this.isWalkable(n)))) return false;
    const i = this.pierAt[p];
    if (i >= 0 && this.piers[i].chain[this.piers[i].at] !== p) return false;
    const holds = this.holds.get(p);
    return !holds || holds.every(([j, k]) => this.piers[j].at >= k);
  }

  // Grows the land along the growth order to `count` points, skipping kept points. Points that can't
  // grow yet (canGrow) wait, and go as soon as they can, earliest first.
  // Same order, same events: same land, and more land only adds to the end.
  growTo(count) {
    const { order } = this;
    const ready = i => this.canGrow(i);
    const flush = () => {
      for (let w = this.waiting.findIndex(ready); w >= 0 && this.land.length < count; w = this.waiting.findIndex(ready)) {
        this.addLand(this.waiting.splice(w, 1)[0]);
      }
    };
    flush();
    while (this.pos < order.length && this.land.length < count) {
      const i = order[this.pos++];
      if (this.isKept[i]) continue;
      if (this.land.length && !ready(i)) { this.waiting.push(i); continue; }
      this.addLand(i);
      flush();
    }
  }

  // Tries `attempt` and, while it finds no place, adds one more land point and tries again.
  // Before each new point it tries looser rules, up to `most`: LOOSE lets houses and pads touch the
  // coast (and pads sit beside blocks, and lanterns away from lanes); SQUEEZE lets a pad cut off coast
  // points (pads.js).
  withRoom(attempt, most = LOOSE) {
    for (let extra = 0; extra <= MAX_BORROW; extra++) {
      if (extra) {
        const before = this.land.length;
        this.growTo(before + 1);
        if (this.land.length === before) return null;
        this.borrowed++;
      }
      for (let level = 0; level <= most; level++) {
        this.loose = level;
        const done = attempt();
        this.loose = 0;
        if (done) return done;
      }
    }
    return null;
  }
}

// ---------- The replay ----------

export function replayIsland(spec, events) {
  const isle = new Isle(spec);
  const startAt = Math.min(START_LAND[spec.id === 'home' ? 'home' : spec.size] ?? 40, spec.land, ...events.map(e => e.land));
  isle.growTo(startAt);
  startIsland(isle);
  for (const event of events) {
    isle.growTo(event.land);
    const points = event.foot ? placeFoot(isle, event.foot) : event.keepsake ? placeKeepsake(isle, event.keepsake) : build(isle, event.building);
    if (points && event.building) isle.newest = { checkIn: event.checkIn, points };
  }
  isle.growTo(spec.land);
  if (spec.golden && isle.golden >= 0) {
    isle.addThing({ id: `${isle.id}:golden`, kind: 'goldentree', island: isle.id, points: [isle.golden], at: [...isle.grid.points[isle.golden]],
      yaw: round4(roll('yaw', isle.id, 'golden') * Math.PI * 2), scale: 1, pad: false, front: null, coast: null });
  }
  return isle;
}

// Places one building. Returns the points it used (for the view), or null.
function build(isle, building) {
  const { id, blueprint } = building;
  // An extension (a record with a saved parent building) changes its parent in place: it takes no ground
  // and is drawn by the parent's model (thing.extension). Each parent takes one. Only farm records carry a
  // parent; house rooms and floors find their house in houses.js as before.
  if (building.parentBuildingId) {
    const parent = isle.things.find(t => t.id === building.parentBuildingId);
    if (!parent || parent.extension) return null;
    parent.extension = id;
    isle.changed();
    return parent.points;
  }
  if (blueprint === 'house') return isle.withRoom(() => newHouse(isle, id, 2));
  if (blueprint === 'room') return isle.withRoom(() => addRoom(isle, id));
  if (blueprint === 'floor') return addFloor(isle, id);
  if (BLOCK_BLUEPRINTS.includes(blueprint) || !KINDS[blueprint]) return null; // the rope bridge, or a kind this layout doesn't know
  return isle.withRoom(() => placeBuilding(isle, id, blueprint), SQUEEZE);
}

// ---------- The start ----------

function startIsland(isle) {
  const { grid, id } = isle;
  isle.plaza = isle.order[0];
  isle.addLane(isle.plaza);
  const byRoll = (list, what) => list.slice().sort((a, b) => roll(what, id, a) - roll(what, id, b) || a - b);
  const point = (thingId, kind, options, yawFor) => isle.withRoom(() => placePoint(isle, thingId, kind, options(), yawFor));
  if (id === 'home') {
    // The plaza is three lane points; the pile sits beside it and the campfire 2 steps away.
    for (const n of byRoll(grid.neighbours[isle.plaza].filter(p => isle.isLand(p)), 'plaza').slice(0, 2)) isle.addLane(n);
    const fromPlaza = () => isle.stepsFrom(isle.lanes, p => isle.isLand(p));
    point('home:pile', 'pile', () => { const s = fromPlaza(); return byRoll(isle.land.filter(p => s[p] === 1 && isle.isInland(p)), 'pile'); });
    const fire = point('home:fire', 'fire', () => { const s = fromPlaza(); return byRoll(isle.land.filter(p => s[p] === 2), 'fire'); });
    if (fire) {
      const at = grid.points[fire.points[0]];
      for (const n of [1, 2]) {
        point(`home:seat-${n}`, 'seat', () => byRoll(grid.neighbours[fire.points[0]].filter(p => isle.isLand(p)), `seat${n}`),
          p => yawOf([at[0] - grid.points[p][0], at[1] - grid.points[p][1]]));
      }
    }
    // The old tree and the big rock on the coast, 2 to 3 steps out, on opposite sides.
    const coastal = () => { const s = fromPlaza(); return isle.land.filter(p => isle.isCoast(p) && s[p] >= 2 && s[p] <= 3); };
    const tree = point('home:tree', 'tree', () => byRoll(coastal(), 'tree'));
    const from = tree ? grid.points[tree.points[0]] : [0, 0];
    const far = p => -Math.hypot(grid.points[p][0] - from[0], grid.points[p][1] - from[1]);
    point('home:rock', 'rock', () => sortBy(byRoll(coastal(), 'rock'), far));
  } else {
    // The plaza point, a tree and a rock (work for any woodcutter or stone gatherer sent here), and one
    // extra by the island's kind.
    const near = () => { const s = isle.stepsFrom([isle.plaza], p => isle.isLand(p)); return isle.land.filter(p => s[p] >= 1 && s[p] <= 3); };
    point(`${id}:tree`, 'tree', () => byRoll(near(), 'tree'));
    point(`${id}:rock`, 'rock', () => byRoll(near(), 'rock'));
    point(`${id}:extra`, EXTRA_BY_KIND[isle.kind] ?? 'bush', () => byRoll(near(), 'extra'));
  }
  // The golden point: of the first 12 growth points, the free one with the lowest roll, kept for good.
  const golden = byRoll(isle.order.slice(0, 12), 'golden').find(p => isle.isFree(p) && isle.staysReachable([p]));
  if (golden !== undefined) { isle.golden = golden; isle.changed(); }
}

// A thing on one point: the first free option that keeps every free and walkable point reachable.
export function placePoint(isle, id, kind, options, yawFor = () => round4(roll('yaw', id) * Math.PI * 2)) {
  const p = options.find(q => isle.isFree(q) && isle.staysReachable([q]));
  if (p === undefined) return null;
  return isle.addThing({ id, kind, island: isle.id, points: [p], at: [...isle.grid.points[p]], yaw: yawFor(p), scale: 1, pad: false, front: null, coast: null });
}

// ---------- Keepsakes ----------

// A keepsake on one free point, chosen by roll(island, id, 'spot'). The fountain takes the free point
// nearest the square (rules.js counts its ground); the rest take a free coast point (the coast share the
// rules hold back) and face out to the sky. Never borrows land: with no spot it is left out.
function placeKeepsake(isle, { id, kind }) {
  if (!KINDS[kind]) return null;
  const { grid } = isle;
  const byRoll = list => list.slice().sort((a, b) => roll(isle.id, id, 'spot', a) - roll(isle.id, id, 'spot', b) || a - b);
  let options;
  if (kind === 'fountain') {
    const steps = isle.stepsFrom([isle.plaza], p => isle.isLand(p));
    options = sortBy(byRoll(isle.land.filter(p => steps[p] >= 1 && isle.isFree(p))), p => steps[p]);
  } else {
    options = byRoll(isle.land.filter(p => isle.isCoast(p) && isle.isFree(p)));
  }
  const out = p => yawOf(grid.points[p]);
  const thing = placePoint(isle, id, kind, options, kind === 'fountain' ? undefined : out);
  return thing ? thing.points : null;
}

// ---------- Bridge feet ----------

// The first foot for one end of a link: see sky.js pickFoot. It becomes a lane joined to the others,
// and its pier starts (see sky.js): later land on the pier strip becomes lane and the foot moves out.
// Free: not a block, thing or the golden point; an existing lane is fine, but not another pier's.
// A pier must not cross another pier, its held points, or kept sky (a coast building's bay), so no pier
// ever waits on another or stops short.
function placeFoot(isle, { link, out }) {
  const found = isle.withRoom(() => pickFoot(isle.grid, isle.land, p => isle.isLand(p), out,
    (p, pier) => (isle.isLane[p] || isle.isFree(p)) && isle.pierAt[p] < 0 && !isle.piers.some(o => o.base === p)
      && pierFits(isle, pier) && laneChain(isle, p) !== null));
  if (!found) return null;
  joinLane(isle, found.point);
  const index = isle.piers.length;
  const pier = { link, base: found.point, out, chain: found.pier.chain, hold: found.pier.hold, at: 0 };
  isle.piers.push(pier);
  isle.feet.set(link, pier);
  for (const p of pier.chain) isle.pierAt[p] = index;
  for (const [p, k] of pier.hold) {
    if (!isle.holds.has(p)) isle.holds.set(p, []);
    isle.holds.get(p).push([index, k]);
  }
  isle.changed();
  return [found.point];
}

function pierFits(isle, pier) {
  const fillable = p => canFill(isle.grid, p);
  if (pier.chain.some(p => fillable(p) && (isle.pierAt[p] >= 0 || isle.holds.has(p) || isle.isKept[p]))) return false;
  for (const p of pier.hold.keys()) if (isle.pierAt[p] >= 0) return false;
  return true;
}

// Where a link's foot is now: the outermost land point of its pier.
export const footOf = pier => (pier.at ? pier.chain[pier.at - 1] : pier.base);
