'use strict';
// Reads older game records the version-2 way, so a database that tried them still opens. fold() runs
// every saved check-in through checkInPayload before replaying it; the records themselves never change.
//
// Version 1 (the square island) was only ever made on the game branch, for testing:
//   - land was counted in building spots: one spot is about 7 grid points, so amounts are × 7;
//   - the cottage is read as a house (its replacement, with beds for 2).
// Records from before the sky table (version 1, and the first version-2 records on the branch):
//   - islands missing ring, angle, lift or appetite get them from the same rules and rolls as new ones;
//   - a link with no type joined island k to island k + 1. It becomes a rope bridge from the new island's
//     first neighbour in the sky table (home, for the first eight islands) to that island, with each
//     island's land at that check-in.

const sky = require('./sky');

const POINTS_PER_SPOT = 7;
const V1_STARTING_SPOTS = 4;

const isVersion1 = payload => Number(payload && payload.rulesVersion) === 1;
const toPoints = spots => (typeof spots === 'number' ? spots * POINTS_PER_SPOT : spots);

function startPayload(payload) {
  if (!isVersion1(payload)) return payload;
  return { ...payload, startingLand: toPoints(payload.startingLand ?? V1_STARTING_SPOTS) };
}

// One saved check-in's payload, read the version-2 way. state: the game state replayed up to just
// before this check-in.
function checkInPayload(payload, { blueprints, rules, state }) {
  let p = payload;
  if (isVersion1(p)) p = spotsToPoints(p, blueprints);
  const missingPlace = (p.islands || []).some(island => island.ring === undefined || island.angle === undefined ||
    island.lift === undefined || island.appetite === undefined);
  if (missingPlace) {
    p = { ...p, islands: p.islands.map((island, i) => ({ ...sky.arrivalOf(state.startedID, state.islands.length + i, rules), ...island })) };
  }
  if (p.built && p.built.link && !p.built.link.type) p = { ...p, built: { ...p.built, link: oldLink(p, state) } };
  return p;
}

function spotsToPoints(payload, blueprints) {
  const p = { ...payload };
  if (Array.isArray(p.newLand)) p.newLand = p.newLand.map(grown => ({ ...grown, amount: toPoints(grown.amount) }));
  if (Array.isArray(p.islands)) p.islands = p.islands.map(island => ({ ...island, land: toPoints(island.land) }));
  if (p.built) {
    const built = { ...p.built, landWhenBuilt: p.built.landWhenBuilt == null ? p.built.landWhenBuilt : toPoints(p.built.landWhenBuilt) };
    if (built.blueprint === 'cottage') {
      const house = blueprints.find(bp => bp.id === 'house');
      Object.assign(built, { blueprint: 'house', kind: 'homes', name: house ? house.name : built.name });
    }
    p.built = built;
  }
  return p;
}

// The rope bridge an old chain link becomes. Land is each island's land once this check-in's new land
// and new islands are in, the moment a bridge built at this check-in would have seen.
function oldLink(p, state) {
  const islands = [...state.islands.map(({ id, ring, angle, land }) => ({ id, ring, angle, land })), ...(p.islands || [])];
  const landOf = new Map(islands.map(island => [island.id, island.land]));
  for (const grown of p.newLand || []) if (landOf.has(grown.island)) landOf.set(grown.island, landOf.get(grown.island) + grown.amount);
  const to = p.built.link.to;
  const first = sky.neighboursOf(to, islands)[0];
  const from = first ? first.id : p.built.link.from;
  return { from, to, type: 'rope', land: { [from]: landOf.get(from), [to]: landOf.get(to) } };
}

module.exports = { startPayload, checkInPayload, POINTS_PER_SPOT };
