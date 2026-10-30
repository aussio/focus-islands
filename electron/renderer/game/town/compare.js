// Checks the promises between two worlds, a state and a later one (game/BUILD_PLAN.md, "Promises").
// Plain code: no DOM.
//
//   compareTowns(before, after) => [problems]   plain sentences; empty when nothing moved that shouldn't
//
// - each island keeps its grid, and its old land is the start of its new land, in the same order;
// - old lanes stay lanes, and kept sky only grows;
// - every house keeps its blocks, colour and door, and floors never go down;
// - every built thing (start things, buildings, the golden tree) keeps its kind, points, at, yaw and scale;
// - an island moves only outward along its own angle, and its lift never changes;
// - a bridge's ends keep their island and out, matched by island so a slide may list either end first;
//   a foot only moves out along its pier (through lanes, each farther out along out), and the deck's
//   bend (foot + out × clear) never moves in; only the type may change;
// - decoration (flowers, bushes...) changes only where its point, or a point that shares a cell with it,
//   changed: new land, a new lane, entrance, block or built thing, or a change of coast. (The plan says it may
//   appear "only on or next to new land", but its chances depend on lanes and buildings beside it too.)
// Islands, houses, built things and bridges never go away. The view may change.
import { ringOf } from './nature.js';

const EPS = 1e-6;
const ROUNDING = 2e-4; // clear is rounded to 4 decimals
const isDecor = thing => thing.id.includes(':decor-');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function compareTowns(before, after) {
  const problems = [];
  const say = text => problems.push(text);
  const afterIslands = new Map(after.islands.map(i => [i.id, i]));
  const afterThings = new Map(after.things.map(t => [t.id, t]));

  for (const old of before.islands) {
    const now = afterIslands.get(old.id);
    if (!now) { say(`${old.id} is gone`); continue; }
    compareIsland(old, now, say);
  }

  for (const thing of before.things) {
    if (isDecor(thing)) continue;
    const now = afterThings.get(thing.id);
    if (!now) { say(`${thing.id} is gone`); continue; }
    for (const field of ['kind', 'island', 'points', 'at', 'yaw', 'scale', 'pad', 'front', 'coast']) {
      if (!same(thing[field], now[field])) say(`${thing.id} changed its ${field}`);
    }
  }
  compareDecoration(before, after, say);

  const afterBridges = new Map(after.bridges.map(b => [b.id, b]));
  for (const bridge of before.bridges) {
    const now = afterBridges.get(bridge.id);
    if (!now) { say(`${bridge.id} is gone`); continue; }
    for (const end of [bridge.from, bridge.to]) {
      const match = [now.from, now.to].find(e => e.island === end.island);
      if (!match) { say(`${bridge.id} no longer reaches ${end.island}`); continue; }
      if (!same(match.out, end.out)) { say(`${bridge.id}'s way out on ${end.island} changed`); continue; }
      const island = afterIslands.get(end.island);
      if (!island) continue;
      const grid = island.grid, out = end.out;
      const ahead = (p, q) => (grid.points[q][0] - grid.points[p][0]) * out[0] + (grid.points[q][1] - grid.points[p][1]) * out[1];
      if (match.point !== end.point && !outAlongPier(island, end.point, match.point, out)) say(`${bridge.id}'s foot on ${end.island} moved`);
      // The bend (foot + out × clear) never moves in.
      if (ahead(end.point, match.point) + match.clear < end.clear - ROUNDING) say(`${bridge.id}'s deck bend on ${end.island} moved in`);
    }
  }
  return problems;
}

// A foot may only move out along its pier: the new foot is reached from the old one through lane
// points, each farther out along `out` than the one before.
function outAlongPier(island, from, to, out) {
  const { grid } = island;
  const lanes = new Set(island.lanes);
  if (!lanes.has(from) || !lanes.has(to)) return false;
  const along = p => grid.points[p][0] * out[0] + grid.points[p][1] * out[1];
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (p === to) return true;
    for (const n of grid.neighbours[p]) if (!seen.has(n) && lanes.has(n) && along(n) > along(p) + 1e-9 && along(n) <= along(to) + 1e-9) { seen.add(n); queue.push(n); }
  }
  return false;
}

function compareIsland(old, now, say) {
  const id = old.id;
  if (old.grid !== now.grid && old.grid?.key !== now.grid?.key) say(`${id} has a different grid`);
  if (now.land.length < old.land.length || old.land.some((p, i) => now.land[i] !== p)) say(`${id}'s old land isn't the start of its new land`);
  const lanes = new Set(now.lanes);
  const lost = old.lanes.filter(p => !lanes.has(p));
  if (lost.length) say(`${id} lost lane point${lost.length === 1 ? '' : 's'} ${lost.slice(0, 5).join(', ')}`);
  if (now.lanes[0] !== old.lanes[0]) say(`${id}'s plaza moved`);
  const kept = new Set(now.kept);
  if (old.kept.some(p => !kept.has(p))) say(`${id}'s kept sky shrank`);
  if (now.lift !== old.lift) say(`${id}'s lift changed from ${old.lift} to ${now.lift}`);

  // Only outward along its own angle: the same direction from home, and no closer.
  const [ox, oz] = old.at, [nx, nz] = now.at;
  const was = Math.hypot(ox, oz), is = Math.hypot(nx, nz);
  if (is < was - EPS) say(`${id} moved closer to home`);
  else if (was > EPS && (Math.abs(ox * nz - oz * nx) > 1e-3 * Math.max(1, was * is) || ox * nx + oz * nz <= 0)) say(`${id} moved off its angle`);
  else if (was <= EPS && is > EPS) say(`${id} moved away from the middle`);

  const houses = new Map(now.houses.map(h => [h.id, h]));
  for (const house of old.houses) {
    const next = houses.get(house.id);
    if (!next) { say(`${house.id} is gone`); continue; }
    if (next.look !== house.look) say(`${house.id} changed colour`);
    if (!same(next.door, house.door)) say(`${house.id}'s door moved`);
    const blocks = new Map(next.blocks.map(b => [b.point, b]));
    for (const b of house.blocks) {
      const nb = blocks.get(b.point);
      if (!nb) say(`${house.id} lost its block at point ${b.point}`);
      else if (nb.floors < b.floors) say(`${house.id}'s block at point ${b.point} went down a floor`);
    }
  }
}

// A decoration may appear, vanish or change only where its point or a point sharing a cell with it
// changed between the two worlds.
function compareDecoration(before, after, say) {
  const afterIslands = new Map(after.islands.map(i => [i.id, i]));
  for (const old of before.islands) {
    const now = afterIslands.get(old.id);
    if (!now) continue;
    const changed = changedPoints(old, now, before.things, after.things);
    const decor = world => new Map(world.things.filter(t => t.island === old.id && isDecor(t)).map(t => [t.points[0], t]));
    const was = decor(before), is = decor(after);
    for (const p of new Set([...was.keys(), ...is.keys()])) {
      const a = was.get(p), b = is.get(p);
      if (a && b && same(a, b)) continue;
      if (changed.has(p) || ringOf(now.grid, p).some(q => changed.has(q))) continue;
      say(`${old.id}'s ${(a ?? b).kind} at point ${p} ${!a ? 'appeared' : !b ? 'vanished' : 'changed'} with nothing new beside it`);
    }
  }
}

// Points whose land, coast, lane, entrance (door outside or pad front), block or built thing differs
// between the two worlds.
function changedPoints(old, now, oldThings, newThings) {
  const { grid } = now;
  const describe = (island, things) => {
    const land = new Set(island.land), lanes = new Set(island.lanes);
    const blocks = new Set(island.houses.flatMap(h => h.blocks.map(b => b.point)));
    const built = new Map();
    const entrances = new Set(island.houses.map(h => h.door?.outside));
    for (const t of things) {
      if (t.island !== island.id || isDecor(t)) continue;
      for (const p of t.points) built.set(p, t.id);
      if (t.front !== null && t.front !== undefined) entrances.add(t.front);
    }
    return p => `${land.has(p) ? 'L' : '.'}${land.has(p) && grid.neighbours[p].some(n => !land.has(n)) ? 'c' : ''}${lanes.has(p) ? 'l' : ''}${entrances.has(p) ? 'e' : ''}${blocks.has(p) ? 'b' : ''}${built.get(p) ?? ''}`;
  };
  const a = describe(old, oldThings), b = describe(now, newThings);
  const changed = new Set();
  const look = new Set([...old.land, ...now.land].flatMap(p => [p, ...grid.neighbours[p]]));
  for (const p of look) if (a(p) !== b(p)) changed.add(p);
  return changed;
}
