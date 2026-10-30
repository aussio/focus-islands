// Turns a town world (town/shape.js) into the model the town scene draws from. Plain code: no Three.js,
// so it runs in Node tests too. Stream E (scene glue) owns this.
//
//   parseTown(world) => model     isTownWorld(world) => true when the islands carry grids
//
// Coordinates. Each island is drawn in its own group, placed at [at[0], lift, at[1]]. Inside that group
// everything is in island units: grid.points as they are, with y = 0 at the top of the grass. So an
// island that only drifts just moves its group. "local" below means island units; "world" means the
// scene's own space (y up, +z south toward the camera, +x east).
//
// model = {
//   town: true, data: world,            // data: the world as given (never copied)
//   islands: [island], byId: Map(id -> island),
//   things: [thing], bridges: [bridge], helpers: [helper], view,
// }
// island = {
//   id, kind, size, index, key,         // key: drawKey below; it changes only when something drawn on the
//                                       // island changes (not when it drifts, and not when a bridge's type does)
//   grid,                               // the shared, frozen grid: never copy it
//   at: [x, z], lift, reach,            // where the grid's middle floats, and how high
//   order: [p, ...],                    // land points in the order they filled (the world's land list)
//   land: Set, lanes: Set, kept: Set,   // kept: sky points kept open for good
//   plaza,                              // the first lane point (-1 when there are no lanes)
//   coast: Set,                         // land points with at least one neighbour that is not land
//   floors: Map(p -> storeys), look: Map(p -> colour pair), house: Map(p -> house id),
//   houses: [{ id, look, door: { point, outside }, blocks: [{ point, floors }] }],
//   doors: [{ house, point, outside }], // point: the block with the door; outside: the lane point it opens onto
//   things: [thing], taken: Map(p -> thing),
//   feet: [{ bridge, type, end, point, out, clear }],   // end: 'from' or 'to'
//   visitor,                            // a surprise's visitor kind until the next check-in, or null (visitors.js)
//   point(p) => [x, z] local, world(p, y = 0) => [x, lift + y, z] world,
// }
// thing = { id, kind, island, points, at, yaw, scale, pad, front, coast,   // as in the world; at is local
//   local: [x, z], world: [x, y, z],    // its middle, local and world (y: the island's lift)
//   blocks, work, edge }                // from kinds.js: helpers walk around it, the job done there, coast building
// bridge = { id, type, from: end, to: end }
//   end = { island, point, at: [x, y, z], out: [dx, dz], clear }
//   at: the foot in world space, with y the island's lift. out: the end's fixed way out to the sky, a unit
//   direction [dx, dz] (the same in island and world space). clear: how far the deck runs straight along
//   out before it may bend.
// helper = { id, name, job, island, index, debugPose }    // island: its island's id
// view = { island, ids: [p, ...], points: [[x, y, z], ...] }   // ids: grid points; points: the same in world space
//
// Odd input never throws: islands without a grid, things on unknown islands, and bridges with a missing
// end are left out. Bridges without `out` get the direction from their island toward the other one;
// without `clear`, the distance from the foot to just past the island's land along that way.
import { KINDS } from '../../kinds.js';

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const list = v => (Array.isArray(v) ? v : []);

// A town world's islands carry grids; the scene draws anything else as an empty sky.
export const isTownWorld = world => list(world?.islands).some(island => island?.grid && Array.isArray(island.grid.points));

export function parseTown(world) {
  const data = world ?? {};
  const islands = [];
  const byId = new Map();

  for (const source of list(data.islands)) {
    const grid = source?.grid;
    if (!grid || !Array.isArray(grid.points) || typeof source.id !== 'string' || byId.has(source.id)) continue;
    const valid = p => Number.isInteger(p) && p >= 0 && p < grid.points.length;
    const at = Array.isArray(source.at) && source.at.every(finite) ? [source.at[0], source.at[1]] : [0, 0];
    const lift = finite(source.lift) ? source.lift : 0;
    const order = list(source.land).filter(valid);
    const land = new Set(order);
    const lanes = new Set(list(source.lanes).filter(valid));
    const kept = new Set(list(source.kept).filter(valid));
    const coast = new Set(order.filter(p => grid.neighbours[p].some(n => !land.has(n))));
    const floors = new Map(), look = new Map(), house = new Map();
    const houses = [], doors = [];
    for (const h of list(source.houses)) {
      const blocks = list(h?.blocks).filter(b => valid(b?.point)).map(b => ({ point: b.point, floors: Math.max(1, Math.min(3, Math.round(Number(b.floors) || 1))) }));
      if (!blocks.length) continue;
      const lookNumber = Number.isInteger(h.look) ? h.look : 0;
      for (const b of blocks) { floors.set(b.point, b.floors); look.set(b.point, lookNumber); house.set(b.point, h.id); }
      const door = h.door && valid(h.door.point) && valid(h.door.outside) ? { point: h.door.point, outside: h.door.outside } : null;
      houses.push({ id: h.id, look: lookNumber, door, blocks });
      if (door) doors.push({ house: h.id, ...door });
    }
    const island = {
      id: source.id, kind: typeof source.kind === 'string' ? source.kind : 'home', size: source.size, index: islands.length,
      key: drawKey(data, source),
      grid, at, lift, reach: finite(source.reach) ? source.reach : 0,
      order, land, lanes, kept, plaza: lanes.size ? [...lanes][0] : -1, coast,
      floors, look, house, houses, doors,
      things: [], taken: new Map(), feet: [],
      visitor: typeof source.visitor === 'string' ? source.visitor : null,
      point: p => grid.points[p],
      world: (p, y = 0) => [round4(at[0] + grid.points[p][0]), round4(lift + y), round4(at[1] + grid.points[p][1])],
    };
    islands.push(island);
    byId.set(island.id, island);
  }

  const things = [];
  const seen = new Set();
  for (const source of list(data.things)) {
    const island = byId.get(source?.island);
    if (!island || seen.has(source.id)) continue;
    const points = list(source.points).filter(p => Number.isInteger(p) && p >= 0 && p < island.grid.points.length);
    if (!points.length) continue;
    seen.add(source.id);
    const local = Array.isArray(source.at) && source.at.every(finite) ? [source.at[0], source.at[1]] : middle(points.map(island.point));
    const def = KINDS[source.kind] ?? {};
    const thing = {
      ...source, points, at: local,
      yaw: finite(source.yaw) ? source.yaw : 0, scale: finite(source.scale) && source.scale > 0 ? source.scale : 1,
      pad: Boolean(source.pad), front: Number.isInteger(source.front) ? source.front : null, coast: source.coast ?? null,
      local, world: [round4(island.at[0] + local[0]), island.lift, round4(island.at[1] + local[1])],
      blocks: def.blocks ?? true, work: def.work ?? null, edge: Boolean(def.edge),
    };
    things.push(thing);
    island.things.push(thing);
    for (const p of points) if (!island.taken.has(p)) island.taken.set(p, thing);
  }

  const bridges = [];
  for (const source of list(data.bridges)) {
    const a = byId.get(source?.from?.island), b = byId.get(source?.to?.island);
    if (!a || !b || a === b) continue;
    const from = bridgeEnd(a, source.from, b), to = bridgeEnd(b, source.to, a);
    if (!from || !to) continue;
    const bridge = { id: String(source.id ?? `bridge-${bridges.length}`), type: typeof source.type === 'string' ? source.type : 'rope', from, to };
    bridges.push(bridge);
    a.feet.push({ bridge: bridge.id, type: bridge.type, end: 'from', point: from.point, out: from.out, clear: from.clear });
    b.feet.push({ bridge: bridge.id, type: bridge.type, end: 'to', point: to.point, out: to.out, clear: to.clear });
  }

  const helpers = list(data.helpers).map((helper, index) => ({
    id: String(helper?.id ?? `helper-${index}`), name: helper?.name ?? '', job: helper?.job ?? null,
    island: byId.has(helper?.island) ? helper.island : (islands[0]?.id ?? null), index, debugPose: helper?.debugPose ?? null,
  }));

  const viewIsland = byId.get(data.view?.island) ?? null;
  const ids = viewIsland ? list(data.view.points).filter(p => Number.isInteger(p) && p >= 0 && p < viewIsland.grid.points.length) : [];
  const view = { island: viewIsland?.id ?? null, ids, points: viewIsland ? ids.map(p => viewIsland.world(p)) : [] };

  return { town: true, data, islands, byId, things, bridges, helpers, view };
}

// One bridge end in world space. Fills in `out` and `clear` when the world leaves them out. An `out` given
// as a number is read as degrees (east 0, south 90).
function bridgeEnd(island, end, other) {
  const { grid } = island;
  if (!Number.isInteger(end.point) || end.point < 0 || end.point >= grid.points.length) return null;
  let out = null;
  if (Array.isArray(end.out) && end.out.length === 2 && end.out.every(finite) && Math.hypot(...end.out) > 1e-9) out = end.out;
  else if (finite(end.out)) out = [Math.cos(end.out * Math.PI / 180), Math.sin(end.out * Math.PI / 180)];
  else out = [other.at[0] - island.at[0], other.at[1] - island.at[1]];
  const length = Math.hypot(out[0], out[1]);
  out = length > 1e-9 ? [round4(out[0] / length), round4(out[1] / length)] : [1, 0];
  const clear = finite(end.clear) && end.clear >= 0 ? end.clear : clearOf(island, end.point, out);
  return { island: island.id, point: end.point, at: island.world(end.point), out, clear };
}

// Without a `clear` from the layout: from the foot to a little past the island's land along the way out,
// counting land within one cell either side of the line.
function clearOf(island, foot, dir) {
  const [fx, fz] = island.grid.points[foot];
  let most = 0;
  for (const p of island.land) {
    const [x, z] = island.grid.points[p];
    const along = (x - fx) * dir[0] + (z - fz) * dir[1], aside = Math.abs((x - fx) * dir[1] - (z - fz) * dir[0]);
    if (aside < 0.9 && along > most) most = along;
  }
  return round4(most + 0.35);
}

// A text key for everything drawn on one island: like islandKey in town/shape.js (the island without
// its grid, where it floats or its lift, plus its things and bridge feet), but a foot is only its bridge,
// point and way out. A bridge's type and clear belong to the bridge's own group, so an upgrade or a longer
// straight run never rebuilds an island.
export function drawKey(world, source) {
  const { grid, at, lift, ...rest } = source;
  const things = list(world?.things).filter(t => t?.island === source.id);
  const feet = list(world?.bridges).flatMap(b => [b?.from, b?.to].filter(end => end?.island === source.id).map(end => [b.id, end.point, end.out ?? null]));
  try { return JSON.stringify([grid?.key ?? null, rest, things, feet]); } catch { return String(Math.random()); }
}

function middle(points) {
  if (!points.length) return [0, 0];
  return [round4(points.reduce((s, p) => s + p[0], 0) / points.length), round4(points.reduce((s, p) => s + p[1], 0) / points.length)];
}
