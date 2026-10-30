'use strict';
// The sky table (decision 8). The rules can't see where islands float, so this small fixed table says
// where each island goes and which islands may be joined by a bridge. Each island in the game state
// carries its ring and angle, so the layout never needs its own copy. The layout's tests read it too.
//
// The table is never edited, only added to, like saved records: a rules change must never move an
// island or a bridge.

const { roll } = require('./dice');

// Angles in degrees, east 0 and south 90 (toward the camera). The south slot, which would hide home,
// comes last. Ring 2 uses the same angles as ring 1, so each ring-2 island sits straight out beyond
// the ring-1 island at its angle, and so on for later rings.
const ANGLES = Object.freeze([0, 180, 315, 135, 225, 45, 270, 90]);
const PER_RING = ANGLES.length;
const SIDE_ANGLE = 45; // islands in the same ring this far apart are neighbours; farther apart, never

// The n-th new island's place (n from 1). Home is n = 0: ring 0, with no angle.
function placeOf(n) {
  if (!(n > 0)) return { ring: 0, angle: null };
  return { ring: Math.ceil(n / PER_RING), angle: ANGLES[(n - 1) % PER_RING] };
}

// Everything about the n-th new island that is rolled or looked up once, when it arrives, and then
// saved with it so it never changes: its place in the table, how high it floats (lift, in liftStep
// steps), and how hungry it is for land (appetite).
function arrivalOf(startedID, n, rules) {
  const [liftLow, liftHigh] = rules.liftRange, [appetiteLow, appetiteHigh] = rules.appetiteRange;
  const liftSteps = Math.round((liftHigh - liftLow) / rules.liftStep);
  const liftRoll = Math.min(liftSteps, Math.floor(roll(`${startedID}:island:${n}:lift`) * (liftSteps + 1)));
  const lift = Math.round((liftLow + liftRoll * rules.liftStep) * 100) / 100;
  const appetite = Math.round((appetiteLow + (appetiteHigh - appetiteLow) * roll(`${startedID}:island:${n}:appetite`)) * 100) / 100;
  return { ...placeOf(n), lift: lift === 0 ? 0 : lift, appetite };
}

function degreesApart(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// An island's neighbours among the islands that have arrived, in table order:
//   1. inward: home for ring 1, otherwise the island at the same angle one ring in;
//   2. around: the islands in the same ring 45° either side, the earlier arrival first;
//   3. outward: the island at the same angle one ring out. For home, every ring-1 island, earliest first.
// islands: [{ id, ring, angle }] in arrival order (home first). Returns [{ id, way }], way being
// 'inward', 'around' or 'outward'.
function neighboursOf(id, islands) {
  const island = islands.find(i => i.id === id);
  if (!island) return [];
  if (island.ring === 0) return islands.filter(i => i.ring === 1).map(i => ({ id: i.id, way: 'outward' }));
  const found = [];
  const inward = islands.find(i => i.ring === island.ring - 1 && (island.ring === 1 || i.angle === island.angle));
  if (inward) found.push({ id: inward.id, way: 'inward' });
  for (const other of islands) {
    if (other.id !== island.id && other.ring === island.ring && degreesApart(other.angle, island.angle) === SIDE_ANGLE) {
      found.push({ id: other.id, way: 'around' });
    }
  }
  const outward = islands.find(i => i.ring === island.ring + 1 && i.angle === island.angle);
  if (outward) found.push({ id: outward.id, way: 'outward' });
  return found;
}

// Every pair of arrived neighbours, once, in table order: by the newer island's arrival, then its
// neighbour order. from is the older island of the two, to the newer.
function neighbourPairs(islands) {
  const pairs = [];
  islands.forEach((island, i) => {
    for (const n of neighboursOf(island.id, islands)) {
      if (islands.findIndex(o => o.id === n.id) < i) pairs.push({ from: n.id, to: island.id, way: n.way });
    }
  });
  return pairs;
}

// Is there a link (of any type) between these two islands, either way round?
function linked(a, b, links) {
  return links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

// The ids of the islands a chain of links reaches from home, home included.
function joinedSet(islands, links) {
  const joined = new Set(islands.length ? [islands[0].id] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of links) {
      if (joined.has(l.from) !== joined.has(l.to)) { joined.add(joined.has(l.from) ? l.to : l.from); grew = true; }
    }
  }
  return joined;
}

module.exports = { ANGLES, PER_RING, placeOf, arrivalOf, neighboursOf, neighbourPairs, linked, joinedSet, degreesApart };
