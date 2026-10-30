'use strict';
// For tests: replays one island from the game state and lists every place where a building didn't fit
// the room the island had when it was built, or broke a homes rule. Empty when all is well. The town
// layout relies on this room sum, so it must stay honest.

const R = require('./rules');
const EPSILON = 1e-6;

function roomProblems(island, rules = R.DEFAULT_RULES, blueprints = R.DEFAULT_BLUEPRINTS) {
  const problems = [], say = text => problems.push(`${island.id}: ${text}`);
  const byId = new Map(blueprints.map(bp => [bp.id, bp]));
  const n = { house: 0, room: 0, floor: 0 };
  let used = R.startGroundOf(island, rules), blocks = 0, lastLand = -Infinity;
  if (island.land > R.maxLandOf(island, rules)) say(`land ${island.land} is over the most it can hold`);
  for (const b of island.buildings) {
    const bp = byId.get(b.blueprint);
    if (!bp) { say(`${b.id} has an unknown blueprint ${b.blueprint}`); continue; }
    const land = b.landWhenBuilt;
    if (land < lastLand) say(`${b.id} was built on less land than the building before it`);
    lastLand = land;
    const room = R.roomOf(land, used, rules);
    if (room + EPSILON < (bp.ground || 0)) say(`${b.id} (${b.blueprint}) needs ${bp.ground} but the room was ${room.toFixed(2)}`);
    if (bp.kind === 'homes') {
      if (b.blueprint === 'house' && n.room < n.house) say(`${b.id} started a house before every house had a room`);
      if (b.blueprint !== 'house' && !n.house) say(`${b.id} (${b.blueprint}) has no house to join`);
      if (b.blueprint === 'floor' && n.floor >= blocks) say(`${b.id} made floors catch up with blocks`);
      if (blocks + (bp.blocks || 0) > rules.homesShareOfIsland * land + EPSILON) say(`${b.id} took blocks over the homes share`);
      blocks += bp.blocks || 0;
      n[b.blueprint] += 1;
    }
    used += bp.ground || 0;
  }
  const end = R.roomOf(island.land, used, rules);
  if (end < -EPSILON) say(`room ended below zero (${end.toFixed(2)})`);
  return problems;
}

// House blocks on the ground: 2 for each house and 1 for each room.
function blocksOn(island, blueprints = R.DEFAULT_BLUEPRINTS) {
  const byId = new Map(blueprints.map(bp => [bp.id, bp]));
  return island.buildings.reduce((sum, b) => sum + ((byId.get(b.blueprint) || {}).blocks || 0), 0);
}

module.exports = { roomProblems, blocksOn };
