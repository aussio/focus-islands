'use strict';
// Reads records saved by the version-1 rules as version 2, so a database that tried the square island
// still opens. Version 1 was only ever used on the game branch, for testing. It counted land in building
// spots (about 7 grid points each) and built cottages, which are block houses now. Records with
// any other rulesVersion pass through untouched. Rest minutes waiting in landProgress are minutes in
// both versions, so they need no change.

const POINTS_PER_SPOT = 7;
const V1_STARTING_SPOTS = 4;
const isVersion1 = payload => Number(payload && payload.rulesVersion) === 1;
const toPoints = spots => (typeof spots === 'number' ? spots * POINTS_PER_SPOT : spots);

// The gameStarted payload.
function startPayload(payload) {
  if (!isVersion1(payload)) return payload;
  return { ...payload, startingLand: toPoints(payload.startingLand ?? V1_STARTING_SPOTS) };
}

// A gameCheckedIn payload: land amounts × 7 and a cottage read as a house.
function checkInPayload(payload, blueprints) {
  if (!isVersion1(payload)) return payload;
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

module.exports = { startPayload, checkInPayload, POINTS_PER_SPOT };
