// Block houses (game/BUILD_PLAN.md, "Houses"). Plain code: no DOM, no Three.js.
//
//   newHouse(isle, id, blocks) => points | null   a new house of 1 or 2 blocks, with its door and lane
//   addRoom(isle, id) => points | null            one more block on the house that most needs it
//   addFloor(isle, id) => points | null           one more storey on the biggest house
//
// Blocks sit on free inland points that aren't next to a pad (or touch the coast and pads when nothing
// else fits) and never cut off a free point from the lanes or a point helpers can walk to. A house keeps
// its blocks, colour and door for good; floors only go up.
import { roll } from './grid.js';
import { joinLane } from './lanes.js';
import { HOUSE_LOOK_COUNT, MAX_FLOORS } from './shape.js';

const NO_WAY = 99;
const stepsOr = (steps, p) => (steps[p] < 0 ? NO_WAY : steps[p]);
// Inland and not next to a pad, unless nothing fits that way (isle.loose: see Isle.withRoom).
const roomy = (isle, p) => isle.isFree(p) && (isle.loose || (isle.isInland(p) && !isle.nextToPad(p)));
const blockPoints = house => house.blocks.map(b => b.point);

// A new house. The first block goes on a free inland point with at least 3 free inland neighbours.
// Score, lowest wins: 10 × the gap between its steps to the nearest house and 2, plus 2 × its steps to
// the nearest lane, plus 3 × crowding, plus 4 × a roll. The first house on an island aims for 3 steps
// from the plaza. The second block is the free inland neighbour that touches the house most.
export function newHouse(isle, id, size = 2) {
  const { grid } = isle;
  const onLand = p => isle.isLand(p);
  const others = isle.houses.flatMap(blockPoints);
  const fromHouse = isle.stepsFrom(others.length ? others : [isle.plaza], onLand);
  const want = others.length ? 2 : 3;
  const fromLane = isle.stepsFrom(isle.lanes, onLand);
  const options = isle.land.filter(p => roomy(isle, p) && grid.neighbours[p].filter(n => roomy(isle, n)).length >= 3);
  const score = p => 10 * Math.abs(stepsOr(fromHouse, p) - want) + 2 * stepsOr(fromLane, p) + 3 * isle.crowd([p]) + 4 * roll(id, 'site', p);
  const scored = options.map(p => ({ p, k: score(p) })).sort((a, b) => a.k - b.k || a.p - b.p);
  for (const { p: first } of scored) {
    const mine = [first];
    const set = new Set(mine);
    for (let k = 1; k < size; k++) {
      const next = [...new Set(mine.flatMap(b => grid.neighbours[b]))].filter(n => !set.has(n) && roomy(isle, n))
        .sort((a, b) => isle.touching(b, set) - isle.touching(a, set) || roll(id, 'block', k, a) - roll(id, 'block', k, b) || a - b)[0];
      if (next === undefined) break;
      mine.push(next);
      set.add(next);
    }
    if (mine.length < size || !isle.staysReachable(mine)) continue;
    const house = { id, look: Math.floor(roll('look', id) * HOUSE_LOOK_COUNT), door: null, blocks: [] };
    isle.houses.push(house);
    for (const p of mine) isle.addBlock(house, p);
    if (openDoor(isle, house)) return mine;
    // No door fits here: take the house away again and try the next spot.
    for (const p of mine) isle.blockOf[p] = -1;
    isle.houses.pop();
    isle.changed();
  }
  return null;
}

// The door goes on the block side facing the free point closest to the lanes. That point is the door's
// outside, and a lane joins it to the others.
function openDoor(isle, house) {
  const { grid } = isle;
  const fromLane = isle.stepsFrom(isle.lanes, p => isle.isFree(p));
  const mine = new Set(blockPoints(house));
  let best = null;
  for (const { point } of house.blocks) {
    for (const n of grid.neighbours[point]) {
      if (mine.has(n) || fromLane[n] < 0) continue;
      const k = fromLane[n] + roll(house.id, 'door', point, n) * 0.5;
      if (!best || k < best.k) best = { k, point, outside: n };
    }
  }
  if (!best || !joinLane(isle, best.outside)) return false;
  house.door = { point: best.point, outside: best.outside };
  isle.entrance[best.outside] = 1;
  isle.changed();
  return true;
}

// A room: one more block on the house with the fewest blocks that can still grow (ties: the oldest). The
// new block goes on a free inland point next to it that leaves every walkable point reachable. It
// prefers points that touch more of the house; once the house has 3 blocks, points that also touch
// another house, so the two join; then a roll. If no house can grow, the room starts a one-block house.
export function addRoom(isle, id) {
  const ranked = isle.houses.map((house, i) => ({ house, i })).sort((a, b) => a.house.blocks.length - b.house.blocks.length || a.i - b.i);
  for (const { house } of ranked) {
    const mine = new Set(blockPoints(house));
    const others = new Set(isle.houses.filter(h => h !== house).flatMap(blockPoints));
    const joins = house.blocks.length >= 3;
    const options = [...new Set([...mine].flatMap(b => isle.grid.neighbours[b]))].filter(p => !mine.has(p) && roomy(isle, p));
    options.sort((a, b) => isle.touching(b, mine) - isle.touching(a, mine)
      || (joins ? isle.touching(b, others) - isle.touching(a, others) : 0)
      || roll(id, 'room', a) - roll(id, 'room', b) || a - b);
    const pick = options.find(p => isle.staysReachable([p]));
    if (pick === undefined) continue;
    isle.addBlock(house, pick);
    return [pick];
  }
  return newHouse(isle, id, 1);
}

// A floor: the biggest house (ties: the oldest) with a block under 3 storeys. Its most central block
// (the most neighbours in the same house) that is under 3 goes up one. Ties: a roll.
export function addFloor(isle, id) {
  const house = isle.houses.map((h, i) => ({ h, i })).filter(({ h }) => h.blocks.some(b => b.floors < MAX_FLOORS))
    .sort((a, b) => b.h.blocks.length - a.h.blocks.length || a.i - b.i)[0]?.h;
  if (!house) return null;
  const mine = new Set(blockPoints(house));
  const block = house.blocks.filter(b => b.floors < MAX_FLOORS)
    .sort((a, b) => isle.touching(b.point, mine) - isle.touching(a.point, mine) || roll(id, 'floor', a.point) - roll(id, 'floor', b.point) || a.point - b.point)[0];
  block.floors += 1;
  isle.changed();
  return [block.point];
}
