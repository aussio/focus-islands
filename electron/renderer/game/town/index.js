// The town layout: turns the game state into a world (see shape.js and game/BUILD_PLAN.md, "Layout").
// Plain code: no DOM, no Three.js.
//
//   buildTown(game) => world   the same state always gives a deep-equal world, with the same grids
//   forgetTowns()              drops the caches (for tests)
//
// Each island is replayed on its own (island.js): its keepsakes, buildings and bridge feet in check-in
// order, each at the land it had then. A bridge's foot is the outer end of its pier, so it moves out as land grows. Then the islands are placed in the sky (sky.js), the bridges get their ends,
// decoration is added (nature.js), and the view picks the busiest island (view.js). A surprise's visitor
// (game.visitor, until the next check-in) is copied onto its island as `visitor`, its kind.
//
// Not used on Today until stage 2; the square layout in layout/ still draws Today.
import { emptyTown } from './shape.js';
import { replayIsland, footOf } from './island.js';
import { decorate } from './nature.js';
import { placeIslands, wayOut, clearOf, ANGLES } from './sky.js';
import { viewOf } from './view.js';

export { checkTown } from './check.js';
export { compareTowns } from './compare.js';

// The last world built, so asking again with the same state is cheap. Callers get a fresh copy that
// shares only the frozen grids.
let last = { input: null, world: null };

export function buildTown(game) {
  const input = inputOf(game);
  if (input !== last.input) last = { input, world: layoutTown(game) };
  return copyWorld(last.world);
}

// Drops every cached world and replay, so the next build starts from nothing (for tests).
export function forgetTowns() {
  last = { input: null, world: null };
  replays.clear();
}

// Only what the layout reads: grants change game.change but give the same world.
function inputOf(game) {
  return JSON.stringify([
    (game?.islands ?? []).map(({ id, kind, size, land, golden, ring, angle, lift, buildings, keepsakes }) => [id, kind, size, land, golden, ring, angle, lift,
      (buildings ?? []).map(b => [b.id, b.blueprint, b.landWhenBuilt, b.checkIn]), (keepsakes ?? []).map(k => [k?.id, k?.kind, k?.land, k?.checkIn])]),
    game?.links ?? [],
    game?.helpers ?? [],
    game?.visitor ?? null,
  ]);
}

// Replayed islands, by everything that goes into the replay, so an island nothing touched isn't
// replayed again (the long-run check and the gallery build many states in a row).
const replays = new Map();
const REPLAYS_KEPT = 64;
function replayed(spec, events) {
  const key = JSON.stringify([spec, events]);
  let entry = replays.get(key);
  if (entry) { replays.delete(key); replays.set(key, entry); return entry; }
  const isle = replayIsland(spec, events);
  entry = { isle, decor: decorate(isle) };
  replays.set(key, entry);
  if (replays.size > REPLAYS_KEPT) replays.delete(replays.keys().next().value);
  return entry;
}

function layoutTown(game) {
  const gameIslands = (game?.islands ?? []).filter(i => i && typeof i.id === 'string');
  if (!gameIslands.length) return emptyTown();
  // Ring, angle and lift come from the game state. Islands saved before they existed get them from the
  // sky table's order (the n-th new island: ring ⌈n ÷ 8⌉, angle ANGLES[(n − 1) mod 8]) and lift 0.
  let n = 0;
  const places = new Map(gameIslands.map(island => {
    if (island.id === 'home') return [island.id, { ring: 0, angle: null, lift: 0 }];
    n += 1;
    const ring = Number.isFinite(island.ring) ? island.ring : Math.ceil(n / 8);
    const angle = Number.isFinite(island.angle) ? island.angle : ANGLES[(n - 1) % 8];
    return [island.id, { ring, angle, lift: Number.isFinite(island.lift) ? island.lift : 0 }];
  }));

  // Links between islands that exist, each end with its fixed way out.
  const links = (game?.links ?? []).filter(l => l && l.from !== l.to && places.has(l.from) && places.has(l.to)).map(link => ({
    id: link.id, type: link.type ?? 'rope', from: link.from, to: link.to,
    checkIn: Number.isFinite(link.checkIn) ? link.checkIn : Infinity,
    land: link.land ?? {},
    out: { [link.from]: wayOut(places.get(link.from), places.get(link.to)), [link.to]: wayOut(places.get(link.to), places.get(link.from)) },
  }));

  // Replay each island: its keepsakes, buildings and bridge feet in check-in order. Within one check-in a
  // keepsake comes first (the surprise comes before the build), then buildings, then feet.
  const replays = gameIslands.map(island => {
    const land = Math.max(0, Math.floor(Number(island.land) || 0));
    const events = [];
    (island.keepsakes ?? []).forEach((k, i) => {
      if (!k || typeof k.id !== 'string' || typeof k.kind !== 'string') return;
      events.push({ checkIn: Number.isFinite(k.checkIn) ? k.checkIn : Infinity, rank: -1, i, land: Number.isFinite(k.land) ? Math.floor(k.land) : land, keepsake: { id: k.id, kind: k.kind } });
    });
    (island.buildings ?? []).forEach((b, i) => events.push({
      checkIn: Number.isFinite(b.checkIn) ? b.checkIn : Infinity, rank: 0, i,
      land: Number.isFinite(b.landWhenBuilt) ? Math.floor(b.landWhenBuilt) : land, building: { id: String(b.id), blueprint: b.blueprint },
    }));
    links.forEach((link, i) => {
      if (link.from !== island.id && link.to !== island.id) return;
      const then = link.land[island.id];
      events.push({ checkIn: link.checkIn, rank: 1, i, land: Number.isFinite(then) ? Math.floor(then) : land, foot: { link: link.id, out: link.out[island.id] } });
    });
    events.sort((a, b) => a.checkIn - b.checkIn || a.rank - b.rank || a.i - b.i);
    const spec = { id: island.id, kind: island.id === 'home' ? 'home' : island.kind, size: island.size, land, golden: Boolean(island.golden) };
    return replayed(spec, events.map(({ checkIn, land: at, building, keepsake, foot }) => ({ checkIn: Number.isFinite(checkIn) ? checkIn : null, land: at, ...(building ? { building } : keepsake ? { keepsake } : { foot }) })));
  });

  const isles = replays.map(r => r.isle);
  const spots = placeIslands(isles.map((isle, i) => ({ ...places.get(isle.id), grid: isle.grid, land: isle.land })));
  const islands = isles.map((isle, i) => ({
    id: isle.id, kind: isle.kind, size: isle.size, grid: isle.grid, at: spots[i].at, lift: places.get(isle.id).lift,
    land: [...isle.land], kept: [...isle.kept], lanes: [...isle.lanes],
    houses: isle.houses.map(h => ({ id: h.id, look: h.look, door: { ...h.door }, blocks: h.blocks.map(b => ({ ...b })) })),
    reach: reachOf(isle), borrowed: isle.borrowed,
    ...(visitorOf(game, isle.id) ? { visitor: visitorOf(game, isle.id) } : {}),
  }));
  const things = replays.flatMap(({ isle, decor }) => [...isle.things, ...decor].map(copyThing));

  // Bridges whose two feet were placed. A water slide lists its higher end as `from`.
  const byId = new Map(isles.map(isle => [isle.id, isle]));
  const bridges = [];
  for (const link of links) {
    const ends = [link.from, link.to].map(id => {
      const isle = byId.get(id), pier = isle.feet.get(link.id);
      if (!pier) return null;
      const point = footOf(pier);
      return { island: id, point, out: [...link.out[id]], clear: clearOf(isle.grid, isle.land, point, link.out[id], pier.base) };
    });
    if (!ends[0] || !ends[1]) continue;
    if (link.type === 'slide' && places.get(ends[1].island).lift > places.get(ends[0].island).lift) ends.reverse();
    bridges.push({ id: link.id, type: link.type, from: ends[0], to: ends[1] });
  }

  const helpers = (game?.helpers ?? []).filter(h => h && byId.has(h.island)).map(({ id, name, job, island }) => ({ id, name, job: job ?? null, island }));
  const view = viewOf(isles.map(isle => ({ id: isle.id, plaza: isle.plaza, newest: isle.newest })), things, helpers, new Map(isles.map(i => [i.id, i.grid])));
  return { islands, things, bridges, helpers, view };
}

// The visitor's kind on this island, or null.
const visitorOf = (game, id) => (game?.visitor && game.visitor.island === id && typeof game.visitor.kind === 'string' ? game.visitor.kind : null);

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const reachOf = isle => round4(Math.max(0, ...isle.land.map(p => Math.hypot(...isle.grid.points[p]))));
const copyThing = t => ({ id: t.id, kind: t.kind, island: t.island, points: [...t.points], at: [...t.at], yaw: t.yaw, scale: t.scale, pad: t.pad, front: t.front, coast: t.coast && { ...t.coast } });

function copyWorld(world) {
  return {
    islands: world.islands.map(i => ({
      ...i, at: [...i.at], land: [...i.land], kept: [...i.kept], lanes: [...i.lanes],
      houses: i.houses.map(h => ({ id: h.id, look: h.look, door: { ...h.door }, blocks: h.blocks.map(b => ({ ...b })) })),
    })),
    things: world.things.map(copyThing),
    bridges: world.bridges.map(b => ({ id: b.id, type: b.type, from: { ...b.from, out: [...b.from.out] }, to: { ...b.to, out: [...b.to.out] } })),
    helpers: world.helpers.map(h => ({ ...h })),
    view: { island: world.view.island, points: [...world.view.points] },
  };
}
