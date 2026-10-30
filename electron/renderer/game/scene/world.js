// Turns World data (from the layout) into a grid model the scene can draw and route helpers on.
// World: { islands: [{ id, kind, origin: [c, r], rows, heights }], things: [{ id, kind, island, c, r, w, h, facing }],
//          bridges: [{ id, from: [c, r], to: [c, r] }], helpers: [{ id, name, job, island }] }
// One shared square grid holds every island. Rows use '.' for sky, 'p' for path and any other letter for grass.
import { KINDS } from '../kinds.js';
import { CELL, LEVEL } from './style.js';

const key = (c, r) => `${c},${r}`;
const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);

export function parseWorld(data = {}) {
  const cells = new Map();
  const islands = [];
  const islandIndex = new Map();
  (Array.isArray(data.islands) ? data.islands : []).forEach(source => {
    const index = islands.length;
    const island = { id: source.id ?? `island-${index}`, kind: source.kind ?? 'home', index, cells: [] };
    const [oc, or] = Array.isArray(source.origin) ? source.origin.map(v => int(v)) : [0, 0];
    (Array.isArray(source.rows) ? source.rows : []).forEach((row, r) => [...String(row)].forEach((ch, c) => {
      if (ch === '.' || ch === ' ') return;
      const at = key(c + oc, r + or);
      if (cells.has(at)) return; // islands never overlap; the first one keeps the cell
      const height = Math.max(0, Math.min(4, int(String(source.heights?.[r] ?? '')[c], 0)));
      const cell = { c: c + oc, r: r + or, island: index, type: ch === 'p' ? 'path' : 'grass', height, thing: null };
      cells.set(at, cell);
      island.cells.push(cell);
    }));
    if (!island.cells.length) return;
    islandIndex.set(island.id, index);
    islands.push(island);
  });

  const things = [];
  for (const source of Array.isArray(data.things) ? data.things : []) {
    const def = KINDS[source.kind] ?? {};
    const facing = ((int(source.facing) % 4) + 4) % 4;
    const size = def.size ?? [1, 1];
    const w = Math.max(1, int(source.w, facing % 2 ? size[1] : size[0]));
    const h = Math.max(1, int(source.h, facing % 2 ? size[0] : size[1]));
    const c0 = int(source.c), r0 = int(source.r);
    const thing = {
      id: String(source.id ?? `${source.kind}-${things.length}`), kind: String(source.kind ?? 'thing'),
      c0, r0, w, h, facing,
      // Footprint in the model's own frame (before turning to face its way).
      fw: facing % 2 ? h : w, fd: facing % 2 ? w : h,
      c: c0 + (w - 1) / 2, r: r0 + (h - 1) / 2,
      blocks: def.blocks ?? true, work: def.work ?? null, edge: Boolean(def.edge), known: Boolean(KINDS[source.kind]),
      cells: [], island: -1, height: 0,
    };
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) {
      const cell = cells.get(key(c0 + a, r0 + b));
      if (!cell || cell.thing) continue;
      cell.thing = thing;
      thing.cells.push(cell);
    }
    if (!thing.cells.length) continue; // nothing to stand on
    thing.island = islandIndex.get(source.island) ?? thing.cells[0].island;
    thing.height = Math.min(...thing.cells.map(cell => cell.height));
    things.push(thing);
  }

  // Bridges: the empty cells between two coast cells on one row or column become walkable bridge cells.
  const bridges = [];
  for (const source of Array.isArray(data.bridges) ? data.bridges : []) {
    const from = (source.from ?? []).map(v => int(v)), to = (source.to ?? []).map(v => int(v));
    if (from.length !== 2 || to.length !== 2) continue;
    const dc = Math.sign(to[0] - from[0]), dr = Math.sign(to[1] - from[1]);
    if ((dc && dr) || (!dc && !dr)) continue;
    const span = [];
    let blocked = false;
    for (let c = from[0] + dc, r = from[1] + dr; c !== to[0] || r !== to[1]; c += dc, r += dr) {
      if (cells.has(key(c, r))) { blocked = true; break; }
      span.push({ c, r, island: -1, type: 'bridge', height: 0, thing: null });
    }
    if (blocked || !span.length) continue;
    for (const cell of span) cells.set(key(cell.c, cell.r), cell);
    bridges.push({ id: source.id ?? `bridge-${bridges.length}`, from, to, dir: [dc, dr], span });
  }

  // Centre the world on the origin.
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const cell of cells.values()) {
    minC = Math.min(minC, cell.c); maxC = Math.max(maxC, cell.c);
    minR = Math.min(minR, cell.r); maxR = Math.max(maxR, cell.r);
  }
  if (!cells.size) { minC = maxC = minR = maxR = 0; }
  const centre = [(minC + maxC) / 2, (minR + maxR) / 2];
  const model = {
    data, cells, things, islands, bridges, centre, level: LEVEL,
    bounds: { minC, maxC, minR, maxR },
    helpers: (Array.isArray(data.helpers) ? data.helpers : []).map((helper, index) => ({
      id: String(helper.id ?? `helper-${index}`), name: helper.name ?? '', job: helper.job ?? null,
      island: islandIndex.get(helper.island) ?? 0, debugPose: helper.debugPose ?? null,
    })),
    get: (c, r) => cells.get(key(c, r)),
    toWorld: (c, r) => [(c - centre[0]) * CELL, (r - centre[1]) * CELL],
    islandIndex: id => islandIndex.get(id),
  };
  model.walkable = cell => Boolean(cell) && cell.height === 0 && (!cell.thing || !cell.thing.blocks);
  for (const thing of things) [thing.x, thing.z] = model.toWorld(thing.c, thing.r);
  return model;
}

// A stable text form of the world, used to skip rebuilding when nothing changed.
export function worldKey(world) {
  try { return JSON.stringify(world ?? null); } catch { return String(Math.random()); }
}
