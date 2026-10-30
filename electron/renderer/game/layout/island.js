// Lays out one island on its own local grid by replaying its growth.
//
// The hub (the storage pile) sits at local 0,0 and never moves. Every land spot is a "plot": a
// 2x2 core kept free for one building, a planned front cell, and a planned path from that front to
// the paths already there. Plots, and the land around them, are chosen when the land grows and
// never change afterwards. Buildings take the free plot nearest the hub, in the order they were
// built, after the island has been grown to the land count it had then (landWhenBuilt).
// Decorations never sit on a kept spot or a planned path, and never cut a cell off from the paths,
// so later growth always finds room and nothing has to move or vanish. Coast that planned paths
// can reach stays bare, so the island can always grow. Each island also keeps one cell from the
// start for a golden sapling (see keepGoldenSpot). Coast buildings keep the
// sky straight out from one side open for good, so they stay on the coast. Variety comes only
// from the island id and local cell positions.
import { KINDS } from '../kinds.js';
import { key, keyX, keyY, STEP, RING8, hashText, mix, roll, pickWeighted } from './grid.js';

const DEFAULT_KIND = { size: [2, 2], blocks: true };
export const kindOf = kind => KINDS[kind] ?? DEFAULT_KIND;

// What each roll is for, so different choices never share a roll.
const FOR_PLOT = 1, FOR_DECOR = 2, FOR_DECOR_KIND = 3, FOR_FACING = 4, FOR_START = 5, FOR_GOLDEN = 6;

// How much each facing costs when choosing plots and building spots: south (toward the camera)
// reads best, east and west are fine, north shows the back of the building.
const FACING_COST = [0, 0.7, 2.4, 0.7];

// Islands grow a little wider than tall, to suit the wide panel.
const WIDE = 1.35;

// Each new land spot must add at least this many cells of new land, so the island grows.
const MIN_FRESH = 3;

// The home island at the start (land 4): rounded 9x8 patch, old tree (T), big rock (R), storage
// pile (P, the hub), campfire (F) with two log seats (s), short paths (p), and four kept building
// spots (1-4, 2x2 each). HOME_PLOT_FACING gives the way each kept spot faces.
const HOME_START = [
  '..ggggg..',
  '.g11g22g.',
  'gT11g22Rg',
  'gpppppppg',
  'g33pPg44g',
  'g33pFs44g',
  '.ggpsggg.',
  '..ggggg..',
];
const HOME_PLOT_FACING = { 1: 0, 2: 0, 3: 1, 4: 3 };

// New islands start as a small rounded patch sized by the island's size.
const START_RADII = { small: [2.6, 2.1], medium: [3.0, 2.4], large: [3.5, 2.8] };

// Natural decorations by island kind. Each list is [[kind, weight], ...] for a cell beside a
// building, beside a path, on the coast, or in open lawn; chance is how likely a free cell there
// gets something.
const DECOR = {
  home: {
    building: [['flower', 3], ['bush', 2]],
    path: [['flower', 5], ['bush', 1]],
    coast: [['bush', 3], ['flower', 2]],
    open: [['flower', 3], ['bush', 1]],
    chance: { building: 0.45, path: 0.4, coast: 0.3, open: 0.18 },
  },
  mossy: {
    building: [['mushroom', 2], ['bush', 2]],
    path: [['mushroom', 3], ['bush', 2]],
    coast: [['bush', 3], ['mushroom', 2]],
    open: [['mushroom', 2], ['bush', 1]],
    chance: { building: 0.35, path: 0.3, coast: 0.3, open: 0.12 },
  },
  rocky: {
    building: [['rock', 1]], path: [['rock', 1]], coast: [['rock', 1]], open: [['rock', 1]],
    chance: { building: 0.2, path: 0.15, coast: 0.25, open: 0.08 },
  },
  meadow: {
    building: [['flower', 1]], path: [['flower', 1]], coast: [['flower', 1]], open: [['flower', 1]],
    chance: { building: 0.55, path: 0.5, coast: 0.35, open: 0.25 },
  },
  crystal: {
    building: [['crystal', 1]], path: [['crystal', 1]], coast: [['crystal', 1]], open: [['crystal', 1]],
    chance: { building: 0.2, path: 0.15, coast: 0.25, open: 0.08 },
  },
  misty: {
    building: [['bush', 1]], path: [['bush', 1]], coast: [['bush', 1]], open: [['bush', 1]],
    chance: { building: 0.3, path: 0.25, coast: 0.3, open: 0.1 },
  },
};
const NATURAL_DECOR = new Set(['bush', 'flower', 'mushroom', 'crystal', 'rock', 'tree', 'goldentree']);

const rectCells = (x, y, w, h) => {
  const cells = [];
  for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) cells.push(key(x + a, y + b));
  return cells;
};

// Cells just outside one side of a w x h rectangle at x, y.
function sideCells(x, y, w, h, facing) {
  if (facing === 0) return rectCells(x, y + h, w, 1);
  if (facing === 1) return rectCells(x + w, y, 1, h);
  if (facing === 2) return rectCells(x, y - 1, w, 1);
  return rectCells(x - 1, y, 1, h);
}

const facingToward = (from, to) => {
  const dx = keyX(to) - keyX(from), dy = keyY(to) - keyY(from);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy < 0 ? 2 : 0;
};

export class IslandBuilder {
  constructor(island) {
    this.id = String(island.id);
    this.kind = island.kind ?? 'home';
    this.size = island.size ?? 'medium';
    this.seed = hashText(this.id);
    this.decor = DECOR[this.kind] ?? DECOR.home;
    this.land = new Set();
    this.path = new Set();
    this.occ = new Map(); // cell -> thing covering it
    this.things = [];
    this.plots = [];
    this.reserved = new Map(); // cell -> free plot that keeps it (core or planned path)
    this.cores = new Map(); // cell -> free plot whose core it is
    this.built = new Set(); // cells under buildings
    this.routeOwner = new Map(); // planned path cell -> { plot, index }
    this.box = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.dirty = []; // cells changed since the last decoration pass
    this.harbours = []; // sky kept open in front of coast buildings, so they stay on the coast
    this.keepSky = (x, y) => this.harbours.some(z => z.axis === 'y'
      ? x >= z.from && x <= z.to && (z.sign < 0 ? y <= z.line : y >= z.line)
      : y >= z.from && y <= z.to && (z.sign < 0 ? x <= z.line : x >= z.line));
  }

  addPath(k) {
    if (this.path.has(k)) return;
    this.path.add(k);
    this.dirty.push(k);
  }

  // ---------- basic cell questions ----------

  addLand(k) {
    if (this.land.has(k)) return false;
    if (!this.land.size) this.box = { minX: keyX(k), maxX: keyX(k), minY: keyY(k), maxY: keyY(k) };
    this.land.add(k);
    this.dirty.push(k);
    const x = keyX(k), y = keyY(k), box = this.box;
    if (x < box.minX) box.minX = x;
    if (x > box.maxX) box.maxX = x;
    if (y < box.minY) box.minY = y;
    if (y > box.maxY) box.maxY = y;
    return true;
  }

  walkable(k, blocked) {
    if (!this.land.has(k) || blocked?.has(k)) return false;
    const thing = this.occ.get(k);
    return !thing || !thing.blocks;
  }

  // Free lawn: land with nothing on it and nothing planned for it.
  isFreeLawn(k) {
    return this.land.has(k) && !this.occ.has(k) && !this.path.has(k) && !this.reserved.has(k);
  }

  addThing(kind, x, y, w, h, facing, id, extra = {}) {
    const def = kindOf(kind);
    const thing = {
      id: id ?? `${this.id}:${kind}:${x},${y}`,
      kind, x, y, w, h, facing,
      blocks: Boolean(def.blocks), work: def.work ?? null, ...extra,
    };
    for (const k of rectCells(x, y, w, h)) {
      this.occ.set(k, thing);
      if (!NATURAL_DECOR.has(kind)) this.dirty.push(k);
    }
    this.things.push(thing);
    return thing;
  }

  naturalFacing(x, y) {
    return mix(this.seed, FOR_FACING, x, y) % 4;
  }

  // ---------- start ----------

  start() {
    if (this.kind === 'home') this.startFromTemplate(HOME_START, HOME_PLOT_FACING);
    else this.startPatch();
    this.smooth();
    this.keepGoldenSpot();
    this.decorate();
  }

  // Every island keeps one cell from the start for a golden sapling, chosen only from its start
  // shape and seed. The sapling is laid out as a real thing whether or not the island is golden,
  // so every later choice is the same either way; the world only shows it on golden islands. That
  // way it can appear on any day without moving anything else.
  keepGoldenSpot() {
    const pile = this.things.find(t => t.kind === 'pile');
    const cells = [...this.land].sort((a, b) => a - b);
    // First try a coast cell a little away from the pile, then any free lawn.
    for (const strict of [true, false]) {
      let best = null;
      for (const k of cells) {
        if (!this.isFreeLawn(k)) continue;
        const x = keyX(k), y = keyY(k);
        const far = Math.hypot(x - pile.x, y - pile.y);
        if (strict) {
          if (far < 2 || !STEP.some(([dx, dy]) => !this.land.has(key(x + dx, y + dy)))) continue;
          if (!this.canBlock(x, y)) continue;
        }
        if (!this.keepsRoutes(x, y) || !this.accessOK(new Set([k]))) continue;
        const score = Math.abs(far - 3) * 0.4 + roll(this.seed, FOR_GOLDEN, x, y);
        if (!best || score < best.score) best = { score, x, y };
      }
      if (best) {
        this.addThing('goldentree', best.x, best.y, 1, 1, this.naturalFacing(best.x, best.y), undefined, { start: true, golden: true });
        return;
      }
    }
  }

  startFromTemplate(rows, plotFacing) {
    let ax = 0, ay = 0;
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'P') { ax = x; ay = y; } }));
    const plotCells = {};
    const things = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const lx = x - ax, ly = y - ay, k = key(lx, ly);
      this.addLand(k);
      if (ch === 'p') this.path.add(k);
      else if (/[0-9]/.test(ch)) (plotCells[ch] ??= []).push([lx, ly]);
      else if (ch !== 'g') things.push([ch, lx, ly]);
    }));
    const kindByLetter = { T: 'tree', R: 'rock', P: 'pile', F: 'fire', s: 'seat' };
    const fire = things.find(([ch]) => ch === 'F');
    for (const [ch, x, y] of things) {
      const kind = kindByLetter[ch];
      let facing = this.naturalFacing(x, y);
      if (kind === 'pile' || kind === 'fire') facing = 0;
      if (kind === 'seat' && fire) facing = facingToward(key(x, y), key(fire[1], fire[2]));
      this.addThing(kind, x, y, 1, 1, facing, undefined, { start: true });
    }
    for (const name of Object.keys(plotCells).sort()) {
      const cells = plotCells[name];
      const x = Math.min(...cells.map(c => c[0])), y = Math.min(...cells.map(c => c[1]));
      const facing = plotFacing[name] ?? 0;
      const fronts = sideCells(x, y, 2, 2, facing)
        .filter(k => this.land.has(k) && !this.occ.has(k))
        .sort((a, b) => Math.hypot(keyX(a), keyY(a)) - Math.hypot(keyX(b), keyY(b)));
      const dist = this.distanceField();
      const front = fronts[0];
      const { route, target } = this.traceRoute(front, dist);
      this.addPlot({ x, y, w: 2, h: 2, facing, front, route, target });
    }
  }

  startPatch() {
    const [rx, ry] = START_RADII[this.size] ?? START_RADII.medium;
    const reach = Math.ceil(Math.max(rx, ry));
    for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
      if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) this.addLand(key(x, y));
    }
    const side = roll(this.seed, FOR_START, 1) < 0.5 ? -1 : 1;
    const up = roll(this.seed, FOR_START, 2) < 0.5 ? -1 : 1;
    this.addThing('pile', 0, 0, 1, 1, side > 0 ? 1 : 3, undefined, { start: true });
    this.path.add(key(side, 0));
    this.path.add(key(2 * side, 0));
    const work = this.kind === 'rocky' || this.kind === 'crystal' ? 'rock' : 'tree';
    this.addLand(key(2 * side, up));
    this.addThing(work, 2 * side, up, 1, 1, this.naturalFacing(2 * side, up), undefined, { start: true });
  }

  // ---------- plots and paths ----------

  addPlot({ x, y, w, h, facing, front, route, target, custom = false }) {
    const plot = { n: this.plots.length, x, y, w, h, facing, front, route, target, free: true, custom };
    for (const k of rectCells(x, y, w, h)) {
      this.reserved.set(k, plot);
      this.cores.set(k, plot);
    }
    route.forEach((k, index) => {
      this.reserved.set(k, plot);
      this.routeOwner.set(k, { plot, index });
    });
    this.plots.push(plot);
    return plot;
  }

  // Cells a planned path may cross: plain land with nothing on it and no building spot.
  passable(k) {
    return this.land.has(k) && !this.occ.has(k) && !this.cores.has(k) && !this.built.has(k);
  }

  isPathTarget(k) {
    return this.path.has(k) || this.routeOwner.has(k);
  }

  // Steps from each passable cell to the nearest path or planned path (0 on them).
  distanceField() {
    const dist = new Map();
    let queue = [];
    for (const k of this.path) { dist.set(k, 0); queue.push(k); }
    for (const k of this.routeOwner.keys()) if (!dist.has(k)) { dist.set(k, 0); queue.push(k); }
    queue.sort((a, b) => a - b);
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        const d = dist.get(k), x = keyX(k), y = keyY(k);
        for (const [dx, dy] of STEP) {
          const n = key(x + dx, y + dy);
          if (dist.has(n) || !this.passable(n) || this.isPathTarget(n)) continue;
          dist.set(n, d + 1);
          next.push(n);
        }
      }
      queue = next;
    }
    return dist;
  }

  // Would every cell that can reach the paths now still reach them with `blocked` filled in?
  // extraLand: cells about to become land. extraTargets: cells about to be planned path.
  keepsReach(dist, blocked, extraLand, extraTargets = []) {
    const open = k => (this.land.has(k) || extraLand?.has(k)) && !this.occ.has(k) && !this.cores.has(k)
      && !this.built.has(k) && !blocked.has(k);
    const seen = new Set();
    let queue = [];
    for (const k of [...this.path, ...this.routeOwner.keys(), ...extraTargets]) {
      if (!seen.has(k)) { seen.add(k); queue.push(k); }
    }
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        const x = keyX(k), y = keyY(k);
        for (const [dx, dy] of STEP) {
          const n = key(x + dx, y + dy);
          if (seen.has(n) || !open(n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      queue = next;
    }
    for (const k of dist.keys()) if (!blocked.has(k) && !seen.has(k)) return false;
    return true;
  }

  // Cost of joining a front cell to the paths, or Infinity. A front on sky joins through land.
  frontCost(front, dist, avoid) {
    if (this.isPathTarget(front)) return 0;
    if (this.land.has(front)) return this.passable(front) && dist.has(front) ? dist.get(front) : Infinity;
    let best = Infinity;
    const x = keyX(front), y = keyY(front);
    for (const [dx, dy] of STEP) {
      const n = key(x + dx, y + dy);
      if (avoid?.has(n) || !dist.has(n)) continue;
      best = Math.min(best, dist.get(n) + 1);
    }
    return best;
  }

  // Walks downhill on the distance field from the front, keeping straight where it can.
  traceRoute(front, dist) {
    if (this.isPathTarget(front)) return { route: [], target: front };
    const route = [front];
    let cur = front, dir = -1, guard = 0;
    let curDist = this.land.has(front) ? dist.get(front) : Infinity;
    while (guard++ < 400) {
      const x = keyX(cur), y = keyY(cur);
      let best = null, bestDir = -1, bestDist = Infinity;
      const order = dir >= 0 ? [dir, 0, 1, 2, 3] : [0, 1, 2, 3];
      for (const d of order) {
        const n = key(x + STEP[d][0], y + STEP[d][1]);
        if (!dist.has(n)) continue;
        const nd = dist.get(n);
        if (nd < bestDist && nd < curDist) { best = n; bestDir = d; bestDist = nd; }
      }
      if (best === null) return { route: null, target: null };
      if (bestDist === 0) return { route, target: best };
      route.push(best);
      cur = best; dir = bestDir; curDist = bestDist;
    }
    return { route: null, target: null };
  }

  // Turns a plot's planned path into real path, and any planned path it joins.
  materialize(plot, from = 0) {
    for (let i = from; i < plot.route.length; i++) this.addPath(plot.route[i]);
    const t = plot.target;
    if (t !== null && t !== undefined && !this.path.has(t)) {
      const owner = this.routeOwner.get(t);
      if (owner) this.materialize(owner.plot, owner.index);
    }
  }

  // Adds one land spot: picks a plot spot near the middle, grows land around it, plans its path.
  // size/edge are used for a spot made for one particular building.
  createPlot({ size = [2, 2], edge = false, custom = false } = {}) {
    const dist = this.distanceField();
    const { minX, maxX, minY, maxY } = this.box;
    const options = [];
    const shapes = size[0] === size[1]
      ? [[size[0], size[1], [0, 1, 2, 3]]]
      : [[size[0], size[1], [0, 2]], [size[1], size[0], [1, 3]]];
    for (const [w, h, facings] of shapes) {
      for (let y = minY - h; y <= maxY + 1; y++) for (let x = minX - w; x <= maxX + 1; x++) {
        // One pass over the core and its rim: no other spot or building nearby, the core free,
        // touching the island, and adding enough new land that each spot grows the island.
        let fresh = 0, touching = false, ok = true;
        for (let b = -1; b <= h && ok; b++) for (let a = -1; a <= w; a++) {
          const k = key(x + a, y + b);
          if (this.cores.has(k) || this.built.has(k)) { ok = false; break; }
          if (!this.land.has(k)) {
            if (this.keepSky(x + a, y + b) && a >= 0 && a < w && b >= 0 && b < h) { ok = false; break; }
            fresh++;
            continue;
          }
          touching = true;
          if (a >= 0 && a < w && b >= 0 && b < h && (this.occ.has(k) || this.path.has(k) || this.reserved.has(k))) { ok = false; break; }
        }
        if (!ok || !touching || fresh < (custom ? 1 : MIN_FRESH)) continue;
        const coreSet = new Set(rectCells(x, y, w, h));
        if (edge && !this.openSides(x, y, w, h, coreSet).length) continue;
        const cx = x + (w - 1) / 2, cy = y + (h - 1) / 2;
        const spread = Math.hypot(cx / WIDE, cy);
        for (const facing of facings) {
          for (const front of sideCells(x, y, w, h, facing)) {
            if (this.occ.has(front) || this.cores.has(front) || this.built.has(front)) continue;
            if (!this.land.has(front) && this.keepSky(keyX(front), keyY(front))) continue;
            const cost = this.frontCost(front, dist, coreSet);
            if (!Number.isFinite(cost)) continue;
            const score = spread + cost * 0.55 + FACING_COST[facing] + fresh * 0.02
              + roll(this.seed, FOR_PLOT, x, y, facing) * 0.5;
            options.push({ score, x, y, w, h, facing, front, coreSet });
          }
        }
      }
    }
    options.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x || a.facing - b.facing);
    for (const option of options) {
      const { x, y, w, h, facing, front, coreSet } = option;
      let traced;
      if (this.land.has(front)) traced = this.traceRoute(front, dist);
      else {
        // The front is new land: step onto the best land neighbour, then walk on from there.
        let best = null, bestDist = Infinity;
        for (const [dx, dy] of STEP) {
          const n = key(keyX(front) + dx, keyY(front) + dy);
          if (coreSet.has(n) || !dist.has(n)) continue;
          if (dist.get(n) < bestDist) { best = n; bestDist = dist.get(n); }
        }
        if (best === null) continue;
        if (bestDist === 0) traced = { route: [front], target: best };
        else {
          const rest = this.traceRoute(best, dist);
          traced = rest.route ? { route: [front, ...rest.route], target: rest.target } : rest;
        }
      }
      if (!traced.route || traced.route.some(k => coreSet.has(k))) continue;
      // Grow: the core, a one-cell lawn rim (not for a coast-hugging building), and the front.
      const grow = [...coreSet, front];
      if (!edge) {
        for (let b = -1; b <= h; b++) for (let a = -1; a <= w; a++) {
          const k = key(x + a, y + b);
          if (!this.land.has(k) && this.keepSky(x + a, y + b)) continue;
          const corner = (a === -1 || a === w) && (b === -1 || b === h);
          if (corner) {
            // Leave out rim corners that would stick out into the sky, so plots stay rounded.
            const ox = a === -1 ? -1 : 1, oy = b === -1 ? -1 : 1;
            const outA = key(x + a + ox, y + b), outB = key(x + a, y + b + oy);
            if (!this.land.has(outA) && !this.land.has(outB)) continue;
          }
          grow.push(k);
        }
      }
      if (edge) {
        // Check the building would still touch the sky once the land is smoothed.
        const trial = new Set(this.land);
        for (const k of grow) trial.add(k);
        smoothLand(trial, this.boxOf(trial), grow, this.keepSky);
        if (!option.coreSet || ![...coreSet].some(k => STEP.some(([dx, dy]) => !trial.has(key(keyX(k) + dx, keyY(k) + dy))))) continue;
      }
      if (!this.keepsReach(dist, coreSet, new Set(grow), traced.route)) continue;
      for (const k of grow) this.addLand(k);
      this.smooth(grow);
      return this.addPlot({ x, y, w, h, facing, front, route: traced.route, target: traced.target, custom });
    }
    return null;
  }

  boxOf(cells) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of cells) {
      const x = keyX(k), y = keyY(k);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  }

  smooth(near) {
    for (const k of smoothLand(this.land, this.box, near ?? this.land, this.keepSky)) {
      this.land.delete(k); // re-add through addLand so the box stays right
      this.addLand(k);
    }
  }

  growTo(count) {
    let guard = 0;
    while (this.plots.length < count && guard++ < 1000) {
      if (!this.createPlot()) break;
      this.decorate();
    }
  }

  // ---------- buildings ----------

  build(building) {
    const kind = building.blueprint;
    const def = kindOf(kind);
    let spot = this.chooseSpot(def, false);
    for (let tries = 0; !spot && tries < 3; tries++) {
      const plot = this.createPlot({ size: def.size, edge: Boolean(def.edge), custom: true });
      if (!plot) break;
      spot = this.spotInPlot(plot, def, false);
    }
    if (!spot) spot = this.chooseSpot(def, true);
    if (!spot) return null;
    const { plot, x, y, w, h, facing, front, link } = spot;
    if (link !== null) this.addPath(link);
    const thing = this.addThing(kind, x, y, w, h, facing, String(building.id), { building: true, front });
    for (const k of rectCells(x, y, w, h)) this.built.add(k);
    if (def.edge) this.keepHarbour(x, y, w, h);
    plot.free = false;
    for (const k of rectCells(plot.x, plot.y, plot.w, plot.h)) {
      this.reserved.delete(k);
      this.cores.delete(k);
      this.dirty.push(k);
    }
    this.materialize(plot);
    this.decorate();
    return thing;
  }

  // Keeps the sky open straight out from the side of a coast building that has the most sky, so
  // later growth goes around it (leaving a little bay) and it stays on the coast for good.
  keepHarbour(x, y, w, h) {
    const sides = this.openSides(x, y, w, h);
    if (!sides.length) return;
    const f = sides.sort((a, b) => b.open - a.open || a.facing - b.facing)[0].facing;
    if (f === 0) this.harbours.push({ axis: 'y', sign: 1, line: y + h, from: x - 1, to: x + w });
    else if (f === 2) this.harbours.push({ axis: 'y', sign: -1, line: y - 1, from: x - 1, to: x + w });
    else if (f === 1) this.harbours.push({ axis: 'x', sign: 1, line: x + w, from: y - 1, to: y + h });
    else this.harbours.push({ axis: 'x', sign: -1, line: x - 1, from: y - 1, to: y + h });
  }

  // Sides of a rectangle with sky straight out to the edge of the island's box (no land further
  // out), as [{ facing, open }] where open counts such cells. extraLand counts as land.
  openSides(x, y, w, h, extraLand) {
    const { minX, maxX, minY, maxY } = this.box;
    const isLand = k => this.land.has(k) || Boolean(extraLand?.has(k));
    const out = [];
    for (let facing = 0; facing < 4; facing++) {
      const [dx, dy] = STEP[facing];
      let open = 0;
      for (const start of sideCells(x, y, w, h, facing)) {
        let cx = keyX(start), cy = keyY(start), clear = true;
        while (cx >= minX - 1 && cx <= maxX + 1 && cy >= minY - 1 && cy <= maxY + 1) {
          if (isLand(key(cx, cy))) { clear = false; break; }
          cx += dx; cy += dy;
        }
        if (clear) open++;
      }
      if (open) out.push({ facing, open });
    }
    return out;
  }

  chooseSpot(def, ignoreEdge) {
    const free = this.plots.filter(plot => plot.free)
      .sort((a, b) => Math.hypot((a.x + a.w / 2 - 0.5) / WIDE, a.y + a.h / 2 - 0.5)
        - Math.hypot((b.x + b.w / 2 - 0.5) / WIDE, b.y + b.h / 2 - 0.5) || a.n - b.n);
    for (const plot of free) {
      const spot = this.spotInPlot(plot, def, ignoreEdge);
      if (spot) return spot;
    }
    return null;
  }

  // The best footprint for a building in (and around) a free plot, or null.
  spotInPlot(plot, def, ignoreEdge) {
    const [sw, sh] = def.size;
    const coreCount = plot.w * plot.h;
    const options = [];
    for (let facing = 0; facing < 4; facing++) {
      const [w, h] = facing % 2 ? [sh, sw] : [sw, sh];
      for (let y = plot.y - h + 1; y <= plot.y + plot.h - 1; y++) for (let x = plot.x - w + 1; x <= plot.x + plot.w - 1; x++) {
        const cells = rectCells(x, y, w, h);
        const cellSet = new Set(cells);
        let covered = 0, ok = true;
        for (const k of cells) {
          if (!this.land.has(k) || this.occ.has(k) || this.path.has(k) || this.built.has(k) || this.routeOwner.has(k)) { ok = false; break; }
          const keeper = this.reserved.get(k);
          if (keeper && keeper !== plot) { ok = false; break; }
          if (this.cores.get(k) === plot) covered++;
        }
        if (!ok || !covered) continue;
        // Keep a gap to other buildings and other kept spots.
        for (let b = -1; b <= h && ok; b++) for (let a = -1; a <= w; a++) {
          const k = key(x + a, y + b);
          if (cellSet.has(k)) continue;
          const core = this.cores.get(k);
          if (this.built.has(k) || (core && core !== plot)) { ok = false; break; }
        }
        if (!ok) continue;
        if (def.edge && !ignoreEdge && !this.openSides(x, y, w, h).length) continue;
        const sides = sideCells(x, y, w, h, facing);
        let front = null, link = null;
        if (sides.includes(plot.front)) front = plot.front;
        else front = sides.find(k => this.path.has(k) || (this.routeOwner.get(k)?.plot === plot)) ?? null;
        if (front === null) {
          // Link: one new path cell in front, next to the plot's front or an existing path.
          for (const k of sides) {
            if (!this.land.has(k) || this.occ.has(k) || this.built.has(k) || cellSet.has(k)) continue;
            const keeper = this.reserved.get(k);
            if (keeper && keeper !== plot) continue;
            const kx = keyX(k), ky = keyY(k);
            if (STEP.some(([dx, dy]) => { const n = key(kx + dx, ky + dy); return n === plot.front || this.path.has(n); })) {
              front = k; link = k; break;
            }
          }
        }
        if (front === null) continue;
        const score = (coreCount - covered) * 2 + (w * h - covered) * 0.3 + FACING_COST[facing]
          + (front === plot.front ? 0 : 1.5) + (link !== null ? 1.5 : 0);
        options.push({ score, plot, x, y, w, h, facing, front, link, cells });
      }
    }
    options.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x || a.facing - b.facing);
    let dist = null;
    for (const option of options) {
      if (!this.accessOK(def.blocks ? new Set(option.cells) : null, option.front)) continue;
      // Spreading past the kept spot must not cut any lawn off from the paths.
      const beyond = option.cells.filter(k => this.cores.get(k) !== plot);
      if (beyond.length) {
        dist ??= this.distanceField();
        if (!this.keepsReach(dist, new Set(beyond), null)) continue;
      }
      return option;
    }
    return null;
  }

  // Can helpers still walk from the pile to every work spot, seat, building front, and the given cell?
  // Cells helpers can walk to from the pile (blocked: cells treated as blocked too).
  reachable(blocked) {
    const pile = this.things.find(t => t.kind === 'pile');
    const seen = new Set();
    if (!pile) return seen;
    let queue = [];
    for (const [dx, dy] of STEP) {
      const n = key(pile.x + dx, pile.y + dy);
      if (this.walkable(n, blocked)) { seen.add(n); queue.push(n); }
    }
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        const x = keyX(k), y = keyY(k);
        for (const [dx, dy] of STEP) {
          const n = key(x + dx, y + dy);
          if (seen.has(n) || !this.walkable(n, blocked)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      queue = next;
    }
    return seen;
  }

  accessOK(blocked, extraFront) {
    if (!this.things.some(t => t.kind === 'pile')) return true;
    const seen = this.reachable(blocked);
    const touches = thing => rectCells(thing.x, thing.y, thing.w, thing.h).some(k => STEP.some(([dx, dy]) => seen.has(key(keyX(k) + dx, keyY(k) + dy))));
    for (const thing of this.things) {
      if (thing.building) { if (!seen.has(thing.front)) return false; continue; }
      if (thing.kind === 'seat' && !seen.has(key(thing.x, thing.y))) return false;
      if ((thing.work || thing.kind === 'fire') && !touches(thing)) return false;
    }
    return extraFront === undefined || seen.has(extraFront);
  }

  // ---------- decorations ----------

  // Can a planned path still get past this cell if something sits on it? The free cells around
  // it must stay joined to each other without it, so every free cell keeps a way to the paths.
  keepsRoutes(x, y) {
    return staysJoined(RING8.map(([dx, dy]) => {
      const k = key(x + dx, y + dy);
      return this.land.has(k) && !this.occ.has(k) && !this.cores.has(k) && !this.built.has(k);
    }));
  }

  // Blocking decorations stay spaced out and never cut a walking route.
  canBlock(x, y) {
    for (const [dx, dy] of STEP) {
      const thing = this.occ.get(key(x + dx, y + dy));
      if (thing && !thing.building && thing.kind !== 'flower') return false;
    }
    for (const [dx, dy] of RING8) {
      const thing = this.occ.get(key(x + dx, y + dy));
      if (thing && thing.blocks && NATURAL_DECOR.has(thing.kind)) return false;
    }
    // The walkable cells around it must stay joined to each other without it.
    return staysJoined(RING8.map(([dx, dy]) => this.walkable(key(x + dx, y + dy))));
  }

  // Decorates free lawn near whatever changed since the last pass. A cell's chance depends only
  // on its close neighbours, so cells further away would decide the same as before.
  decorate() {
    if (!this.dirty.length) return;
    let { minX, maxX, minY, maxY } = this.boxOf(this.dirty);
    this.dirty = [];
    minX = Math.max(minX - 2, this.box.minX); maxX = Math.min(maxX + 2, this.box.maxX);
    minY = Math.max(minY - 2, this.box.minY); maxY = Math.min(maxY + 2, this.box.maxY);
    const { chance } = this.decor;
    let dist = null, reach = null;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const k = key(x, y);
      if (!this.isFreeLawn(k)) continue;
      let nearBuilding = false, nearPath = false, coast = false;
      for (const [dx, dy] of RING8) if (this.built.has(key(x + dx, y + dy))) { nearBuilding = true; break; }
      for (const [dx, dy] of STEP) {
        const n = key(x + dx, y + dy);
        if (this.path.has(n)) nearPath = true;
        if (!this.land.has(n)) coast = true;
      }
      const place = nearBuilding ? 'building' : nearPath ? 'path' : coast ? 'coast' : 'open';
      const odds = Math.max(chance.open, nearBuilding ? chance.building : 0, nearPath ? chance.path : 0, coast ? chance.coast : 0);
      if (roll(this.seed, FOR_DECOR, x, y) >= odds) continue;
      if (!this.keepsRoutes(x, y)) continue;
      // Coast that planned paths can get to stays open, so the island always has room to grow.
      if (coast) {
        dist ??= this.distanceField();
        if (dist.has(k)) continue;
      }
      let kind = pickWeighted(this.decor[place], roll(this.seed, FOR_DECOR_KIND, x, y));
      if (kindOf(kind).blocks && !this.canBlock(x, y)) {
        if (!this.decor[place].some(([k2]) => k2 === 'flower')) continue;
        kind = 'flower';
      }
      // Work spots (rocks) only go where helpers can walk up to them.
      if (kindOf(kind).work) {
        reach ??= this.reachable(null);
        if (!STEP.some(([dx, dy]) => { const n = key(x + dx, y + dy); return reach.has(n) && this.walkable(n); })) continue;
      }
      this.addThing(kind, x, y, 1, 1, this.naturalFacing(x, y));
    }
  }

  result() {
    return {
      id: this.id,
      kind: this.kind,
      land: this.land,
      path: this.path,
      things: this.things,
      plots: this.plots,
      box: this.box,
      reach: this.reachable(null),
    };
  }
}

// open: the eight cells around a cell (RING8 order), true where something can pass. True when the
// open side cells (N, E, S, W) all link up through open cells of the ring, so filling the middle
// cell can't cut anything off.
function staysJoined(open) {
  if (open.every(Boolean)) return true;
  const start = open.indexOf(false);
  let run = 0;
  const runOf = new Array(8).fill(-1);
  for (let i = 1; i <= 8; i++) {
    const j = (start + i) % 8;
    if (open[j]) runOf[j] = run;
    else run++;
  }
  return new Set([0, 2, 4, 6].filter(i => open[i]).map(i => runOf[i])).size <= 1;
}

// Adds land (never removes it) until there are no holes, no one-cell inlets or spits, and no
// cells joined only at a corner. Returns the cells added.
export function smoothLand(land, box, near, keepSky = () => false) {
  const added = [];
  const has = (x, y) => land.has(key(x, y));
  const add = (x, y) => {
    const k = key(x, y);
    if (land.has(k) || keepSky(x, y)) return false;
    land.add(k);
    added.push(k);
    if (x - 2 < win.minX) win.minX = x - 2;
    if (x + 2 > win.maxX) win.maxX = x + 2;
    if (y - 2 < win.minY) win.minY = y - 2;
    if (y + 2 > win.maxY) win.maxY = y + 2;
    return true;
  };
  // Only look near the cells that changed; grow the window as cells are added.
  const win = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const k of near) {
    const x = keyX(k), y = keyY(k);
    if (x - 2 < win.minX) win.minX = x - 2;
    if (x + 2 > win.maxX) win.maxX = x + 2;
    if (y - 2 < win.minY) win.minY = y - 2;
    if (y + 2 > win.maxY) win.maxY = y + 2;
  }
  if (!Number.isFinite(win.minX)) return added;
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (let y = win.minY; y <= win.maxY; y++) for (let x = win.minX; x <= win.maxX; x++) {
      if (has(x, y)) {
        // Spits: a land cell with sky on two opposite sides gets thickened.
        const n = has(x, y - 1), s = has(x, y + 1), e = has(x + 1, y), w = has(x - 1, y);
        if (!n && !s) {
          const up = [has(x - 1, y - 1), has(x + 1, y - 1), has(x, y - 2)].filter(Boolean).length;
          const down = [has(x - 1, y + 1), has(x + 1, y + 1), has(x, y + 2)].filter(Boolean).length;
          const [first, second] = down > up ? [y + 1, y - 1] : [y - 1, y + 1];
          changed = add(x, first) || add(x, second) || changed;
        }
        if (!e && !w) {
          const left = [has(x - 1, y - 1), has(x - 1, y + 1), has(x - 2, y)].filter(Boolean).length;
          const right = [has(x + 1, y - 1), has(x + 1, y + 1), has(x + 2, y)].filter(Boolean).length;
          const [first, second] = right > left ? [x + 1, x - 1] : [x - 1, x + 1];
          changed = add(first, y) || add(second, y) || changed;
        }
        // Corner-only joins.
        for (const [dx, dy] of [[1, 1], [1, -1]]) {
          if (has(x + dx, y + dy) && !has(x + dx, y) && !has(x, y + dy)) {
            const countA = STEP.filter(([ax, ay]) => has(x + dx + ax, y + ay)).length;
            const countB = STEP.filter(([ax, ay]) => has(x + ax, y + dy + ay)).length;
            changed = (countB > countA ? add(x, y + dy) || add(x + dx, y) : add(x + dx, y) || add(x, y + dy)) || changed;
          }
        }
        continue;
      }
      const n = has(x, y - 1), s = has(x, y + 1), e = has(x + 1, y), w = has(x - 1, y);
      if (n + s + e + w >= 3 || (n && s) || (e && w)) changed = add(x, y) || changed;
    }
    // Holes: sky that can't reach the outside becomes land. Checked over the whole island.
    const minX = Math.min(box.minX, win.minX) - 1, maxX = Math.max(box.maxX, win.maxX) + 1;
    const minY = Math.min(box.minY, win.minY) - 1, maxY = Math.max(box.maxY, win.maxY) + 1;
    const outside = new Set([key(minX, minY)]);
    const queue = [key(minX, minY)];
    while (queue.length) {
      const k = queue.pop();
      const x = keyX(k), y = keyY(k);
      for (const [dx, dy] of STEP) {
        const nx = x + dx, ny = y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const n = key(nx, ny);
        if (outside.has(n) || land.has(n)) continue;
        outside.add(n);
        queue.push(n);
      }
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const k = key(x, y);
      if (!land.has(k) && !outside.has(k)) changed = add(x, y) || changed;
    }
  }
  return added;
}

// Replays one island's growth and returns its local layout.
export function layoutIsland(island) {
  const builder = new IslandBuilder(island);
  builder.start();
  for (const building of island.buildings ?? []) {
    builder.growTo(Number(building.landWhenBuilt) || 0);
    builder.build(building);
  }
  builder.growTo(Number(island.land) || 0);
  return builder.result();
}
