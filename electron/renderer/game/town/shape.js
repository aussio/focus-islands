// The world shape the town layout hands to the scene (version 2), and small helpers for it.
// The full description, and the promises between check-ins, are in game/BUILD_PLAN.md
// ("Shapes passed between the pieces"). Plain code: no DOM, no Three.js.
//
// {
//   islands: [{ id, kind, size,
//     grid,      // gridFor(id, size): shared and frozen; never copy or stringify it, compare grid.key
//     at,        // [x, z] where the grid's middle floats in the sky
//     lift,      // how high it floats, in world units; home 0
//     land,      // land points, in the order they filled
//     kept,      // sky points kept open for good (the bays in front of coast buildings)
//     lanes,     // lane points; lanes[0] is the plaza
//     houses,    // [{ id, look, door: { point, outside }, blocks: [{ point, floors }] }]
//     reach,     // the farthest land from the grid's middle
//     borrowed,     // land points the replay added beyond the state's land so something could fit (0 when all is well)
//     visitor }],   // only while a surprise's visitor is there (until the next check-in): its kind, e.g. 'raincloud'
//   things: [{ id, kind, island, points, at, yaw, scale, pad, front, coast }],
//   bridges: [{ id, type, from: { island, point, out, clear }, to: { island, point, out, clear } }],  // type: see BRIDGE_TYPES
//   helpers: [{ id, name, job, island }],
//   view: { island, points },
// }
//
// Details the plan leaves open:
// - Points are numbers in the island's own grid. Positions are in world units, rounded to 4 decimals.
// - A thing's `at` is in island units (around the grid's middle); its world spot is island.at + at.
// - yaw turns about the vertical like Three.js rotation.y. 0 faces south (+z, toward the camera), and a
//   model with yaw y faces [sin y, cos y].
// - thing.points: point [p]; pair [p, q]; cell: the cell's four points in grid order; cells: the first
//   cell's four points, then the other cell's two; ring: the middle point first, then the other eight.
// - coast: { yaw, width }: the way out to the sky, and the length of the side that faces it.
// - house.look numbers a colour pair in HOUSE_LOOKS (scene/style.js). door.point is one of the house's
//   blocks; door.outside is the lane point it opens onto.
// - Bridges join neighbours in the sky table, and an island can have several. Each end's point is its
//   foot, a lane point on the coast: the outer end of the bridge's pier, a straight lane out along `out`
//   (sky.js). As the island grows the pier grows, so the foot moves out along its own pier; it never
//   moves any other way. out: the end's fixed way out to the sky, a unit direction [dx, dz] from the sky
//   table only; it never changes. clear: how far the deck runs straight along out before it may bend. The
//   bend (foot + out × clear) only ever moves out, so clear shrinks as the foot moves out and grows as
//   land grows beside the deck. The deck's shape is described in sky.js. A water slide's from island
//   floats higher than its to island.
// - An empty world has view { island: null, points: [] }.
import { KINDS, FOOTS, BRIDGE_TYPES } from '../kinds.js';

export const HOUSE_LOOK_COUNT = 6; // colour pairs in HOUSE_LOOKS
export const MAX_FLOORS = 3;

export const emptyTown = () => ({ islands: [], things: [], bridges: [], helpers: [], view: { island: null, points: [] } });

// A text key for everything drawn on one island, without its grid and without where it floats, so the
// scene rebuilds an island only when this changes. An island that only drifts keeps its key, and so do
// both islands when a bridge is only upgraded (the bridge type is left out). A foot that moves out along
// its pier changes the key (with its new pier lane).
export function islandKey(world, island) {
  const it = typeof island === 'string' ? world.islands.find(i => i.id === island) : island;
  if (!it) return '';
  const { grid, at, lift, ...rest } = it;
  const things = world.things.filter(t => t.island === it.id);
  const feet = world.bridges.flatMap(b => [b.from, b.to].filter(end => end.island === it.id).map(end => [b.id, end.point]));
  return JSON.stringify([grid?.key ?? null, rest, things, feet]);
}

// A text key for the whole world, with each grid written as its key.
export function townKey(world) {
  return JSON.stringify(world ?? null, (name, value) => (name === 'grid' && value && typeof value === 'object' ? value.key : value));
}

// Problems with a world's shape, as plain sentences: missing fields, bad point numbers, things off
// their land, two things on one point, footprints that don't match kinds.js. Empty when all is well.
// This checks only what the scene relies on; the layout rules are checked by checkTown (check.js).
export function checkShape(world) {
  const problems = [];
  const say = text => problems.push(text);
  if (!world || typeof world !== 'object') return ['the world is missing'];
  for (const name of ['islands', 'things', 'bridges', 'helpers']) if (!Array.isArray(world[name])) say(`${name} is not a list`);
  if (problems.length) return problems;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const pair = v => Array.isArray(v) && v.length === 2 && v.every(finite);

  const islands = new Map();
  for (const island of world.islands) {
    if (typeof island?.id !== 'string' || !island.id) { say('an island has no id'); continue; }
    const where = `island ${island.id}`;
    if (islands.has(island.id)) say(`${where} is listed twice`);
    const grid = island.grid;
    if (!grid || typeof grid.key !== 'string' || !Array.isArray(grid.points) || !Array.isArray(grid.cells) || !Array.isArray(grid.neighbours)) { say(`${where} has no grid`); continue; }
    const valid = p => Number.isInteger(p) && p >= 0 && p < grid.points.length;
    // A list of point numbers, each once. Returns the set of good ones.
    const points = (list, name) => {
      const set = new Set();
      if (!Array.isArray(list)) { say(`${where} ${name} is not a list`); return set; }
      for (const p of list) {
        if (!valid(p)) say(`${where} ${name} has a bad point ${p}`);
        else if (set.has(p)) say(`${where} ${name} has point ${p} twice`);
        else set.add(p);
      }
      return set;
    };
    const land = points(island.land, 'land');
    const kept = points(island.kept, 'kept');
    const lanes = points(island.lanes, 'lanes');
    if (typeof island.kind !== 'string') say(`${where} has no kind`);
    if (typeof island.size !== 'string') say(`${where} has no size`);
    if (!pair(island.at)) say(`${where} has a bad at`);
    if (!finite(island.lift) || (island.id === 'home' && island.lift !== 0)) say(`${where} has a bad lift`);
    if (!finite(island.reach) || island.reach < 0) say(`${where} has a bad reach`);
    for (const p of kept) if (land.has(p)) say(`${where} keeps land point ${p} as sky`);
    // Who stands on each point: lanes, blocks and things never share one.
    const owner = new Map();
    const claim = (p, who) => {
      if (!land.has(p)) say(`${who} is off the land at point ${p}`);
      if (owner.has(p)) say(`${who} shares point ${p} with ${owner.get(p)}`);
      else owner.set(p, who);
    };
    for (const p of lanes) claim(p, `${where} lane`);
    if (!Array.isArray(island.houses)) say(`${where} houses is not a list`);
    for (const house of island.houses ?? []) {
      const who = `house ${house?.id}`;
      if (typeof house?.id !== 'string') say(`${where} has a house with no id`);
      if (!Number.isInteger(house?.look) || house.look < 0 || house.look >= HOUSE_LOOK_COUNT) say(`${who} has a bad look`);
      if (!Array.isArray(house?.blocks) || !house.blocks.length) { say(`${who} has no blocks`); continue; }
      const mine = new Set();
      for (const block of house.blocks) {
        if (!valid(block?.point)) { say(`${who} has a bad block`); continue; }
        if (!Number.isInteger(block.floors) || block.floors < 1 || block.floors > MAX_FLOORS) say(`${who} has ${block.floors} floors at point ${block.point}`);
        claim(block.point, who);
        mine.add(block.point);
      }
      const door = house.door;
      if (!door || !mine.has(door.point)) say(`${who} has no door on its blocks`);
      else if (!grid.neighbours[door.point].includes(door.outside)) say(`${who} door does not open onto a neighbour`);
      else if (!lanes.has(door.outside)) say(`${who} door does not open onto a lane`);
    }
    islands.set(island.id, { island, grid, valid, land, lanes, claim });
  }

  const ids = new Set();
  for (const thing of world.things) {
    const who = `thing ${thing?.id}`;
    if (typeof thing?.id !== 'string' || !thing.id) { say('a thing has no id'); continue; }
    if (ids.has(thing.id)) say(`${who} is listed twice`);
    ids.add(thing.id);
    const kind = KINDS[thing.kind];
    if (!kind) { say(`${who} has an unknown kind ${thing.kind}`); continue; }
    const home = islands.get(thing.island);
    if (!home) { say(`${who} is on an unknown island ${thing.island}`); continue; }
    if (!Array.isArray(thing.points) || !thing.points.every(home.valid)) { say(`${who} has bad points`); continue; }
    if (thing.points.length !== FOOTS[kind.foot]) say(`${who} covers ${thing.points.length} points, not a ${kind.foot}`);
    else if (!footFits(home.grid, kind.foot, thing.points)) say(`${who} points do not make a ${kind.foot}`);
    for (const p of thing.points) home.claim(p, who);
    if (!pair(thing.at)) say(`${who} has a bad at`);
    if (!finite(thing.yaw)) say(`${who} has a bad yaw`);
    if (!finite(thing.scale) || thing.scale <= 0) say(`${who} has a bad scale`);
    if (thing.pad !== Boolean(kind.pad)) say(`${who} pad does not match kinds.js`);
    if (thing.front !== null) {
      if (!home.lanes.has(thing.front)) say(`${who} front is not a lane`);
      else if (!thing.points.some(p => home.grid.neighbours[p].includes(thing.front))) say(`${who} front is not next to it`);
    }
    if (kind.edge ? !(thing.coast && finite(thing.coast.yaw) && finite(thing.coast.width) && thing.coast.width > 0) : thing.coast !== null) say(`${who} has a bad coast`);
  }

  for (const bridge of world.bridges) {
    const who = `bridge ${bridge?.id}`;
    if (!BRIDGE_TYPES.includes(bridge?.type)) say(`${who} has an unknown type ${bridge?.type}`);
    for (const end of [bridge?.from, bridge?.to]) {
      const home = islands.get(end?.island);
      if (!home || !home.valid(end.point)) say(`${who} has a bad end`);
      else if (!home.lanes.has(end.point)) say(`${who} foot is not a lane`);
      if (!pair(end?.out) || Math.abs(Math.hypot(...end.out) - 1) > 1e-3) say(`${who} has a bad way out`);
      if (!finite(end?.clear) || end.clear < 0) say(`${who} has a bad clear`);
    }
    if (bridge?.from?.island === bridge?.to?.island) say(`${who} joins an island to itself`);
    const high = islands.get(bridge?.from?.island)?.island.lift, low = islands.get(bridge?.to?.island)?.island.lift;
    if (bridge?.type === 'slide' && !(high > low)) say(`${who} is a water slide that does not run downhill`);
  }
  for (const helper of world.helpers) {
    if (typeof helper?.id !== 'string' || typeof helper.name !== 'string') say('a helper has no id or name');
    if (helper?.job !== null && typeof helper?.job !== 'string') say(`helper ${helper?.id} has a bad job`);
    if (!islands.has(helper?.island)) say(`helper ${helper?.id} is on an unknown island`);
  }
  const view = world.view;
  if (!view || !Array.isArray(view.points)) say('the view is missing');
  else if (view.island === null) { if (islands.size) say('the view has no island'); }
  else if (!islands.has(view.island)) say(`the view looks at an unknown island ${view.island}`);
  else if (!view.points.every(islands.get(view.island).valid)) say('the view has bad points');
  return problems;
}

// Do these points make the footprint? Order matters only for the ring (the middle first).
function footFits(grid, foot, points) {
  const set = new Set(points);
  if (set.size !== points.length) return false;
  const isCell = c => grid.cells[c].every(p => set.has(p));
  if (foot === 'point') return true;
  if (foot === 'pair') return grid.neighbours[points[0]].includes(points[1]);
  if (foot === 'cell') return grid.around[points[0]].some(isCell);
  if (foot === 'ring') return grid.around[points[0]].length === 4 && grid.around[points[0]].every(isCell);
  if (foot === 'cells') {
    const inside = [...new Set(points.flatMap(p => grid.around[p]))].filter(isCell);
    return inside.some(a => inside.some(b => a !== b && grid.cells[a].filter(p => grid.cells[b].includes(p)).length === 2));
  }
  return false;
}
