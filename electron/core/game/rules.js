'use strict';
// The game's numbers, lists, and small pure helpers. Ported from the pacing prototype's SkyRules
// (game/prototypes/pacing-prototype.html on the prototype branch). Changing a number here only
// changes grants and check-ins that haven't been saved yet: saved records keep their own numbers.

const RESOURCES = ['wood', 'stone', 'planks', 'soil', 'saplings', 'starlight'];
const MATERIALS = ['wood', 'stone', 'planks'];
const GROWTH = ['soil', 'saplings'];
const KIND_NAMES = { making: 'making things', growing: 'growing things', decor: 'pretty things', homes: 'homes', wonder: 'Starlight wonder' };

const JOBS = {
  wood: { name: 'Woodcutter', doing: 'gathering fallen branches by the old tree' },
  stone: { name: 'Stone gatherer', doing: 'stacking smooth stones from the big rock' },
  planks: { name: 'Sawyer', doing: 'sawing planks at the mill' },
  soil: { name: 'Gardener', doing: 'turning soil in the garden plot' },
  saplings: { name: 'Water carrier', doing: 'filling buckets at the rain catcher' },
};
const STARTING_JOBS = ['wood', 'stone'];
const HELPER_NAMES = ['Pip', 'Wren', 'Moss', 'Tilly', 'Bram', 'Clover', 'Fennel', 'Juniper', 'Otto', 'Sorrel', 'Hazel',
  'Basil', 'Rowan', 'Poppy', 'Nettle', 'Quill', 'Linden', 'Marigold', 'Sage', 'Thistle'];
const FIRST_HELPER_WAY = 'was already here, napping under the old tree';
const LOST_HELPER_WAY = 'had lost their way and found the island';
const ARRIVAL_WAYS = ['floated in on a dandelion seed', 'climbed up a hanging vine', 'hopped off a passing cloud',
  'drifted in under a paper kite', 'rode in on a friendly goose'];

const ISLAND_KINDS = {
  home: { label: 'grassy', names: ['Home island'] },
  mossy: { label: 'mossy', names: ['Mossy Hollow', 'Fern Rest'], special: 'grotto' },
  rocky: { label: 'rocky', names: ['Flint Peak', 'Pebble Reach'], special: 'quarry' },
  meadow: { label: 'meadow', names: ['Clover Meadow', 'Buttercup Rise'], special: 'beehives' },
  crystal: { label: 'crystal', names: ['Glimmer Isle', 'Quartz Point'], special: 'forge' },
  misty: { label: 'misty', names: ['Misty Reach', 'Fog Hollow'], special: 'loom' },
};
const NEW_ISLAND_KINDS = ['mossy', 'rocky', 'meadow', 'crystal', 'misty'];
// chance: how often a new island rolls each size. Each size's starting land and most land are rules
// numbers (startLand, maxLand) so they can be tuned with the rest. Size no longer sets how fast an
// island grows: that is its appetite and age (see shareLand in play.js).
const ISLAND_SIZES = {
  small: { chance: 0.35 },
  medium: { chance: 0.4 },
  large: { chance: 0.25 },
};
const SURPRISES = [
  { id: 'seeds', weight: 4 }, { id: 'soil', weight: 3 }, { id: 'stones', weight: 3 },
  { id: 'fireflies', weight: 2 }, { id: 'golden', weight: 1 }, { id: 'lost', weight: 1 },
  { id: 'bridge', weight: 1 },
];
// Variations inside a surprise slot, picked by a second roll (`surprise-flavour`) once the slot is final.
// Each gives exactly its slot's gift, so totals and pacing stay as they were. `plain` keeps the slot's
// own words. visitor: drawn on the surprise's island until the next check-in. keepsake: a small thing
// that stays for good (see KEEPSAKES). {island} in a text is the island's name. Slots not listed here
// (golden, bridge) have no flavours.
const SURPRISE_FLAVOURS = deepFreeze({
  seeds: [
    { id: 'raincloud', weight: 25, visitor: 'raincloud', text: 'A small rain cloud stopped over {island}. The barrels are full and the ground is soft.' },
    { id: 'dew', weight: 9, text: 'Heavy dew settled overnight, and the helpers gathered every drop.' },
    { id: 'mist', weight: 6, text: 'A thick mist rolled over {island}. The barrels caught it as it lifted.' },
    { id: 'keepsake', weight: 6 },
    { id: 'plain', weight: 14 },
  ],
  soil: [
    { id: 'worms', weight: 5, text: 'The worms were busy overnight. The ground on {island} is dark and soft.' },
    { id: 'plain', weight: 7 },
  ],
  stones: [
    { id: 'tumbled', weight: 1, text: 'Loose stones tumbled from the cliff on {island} into a tidy pile.' },
    { id: 'plain', weight: 1 },
  ],
  fireflies: [
    { id: 'fireflies', weight: 4, visitor: 'fireflies' },
    { id: 'balloon', weight: 3, visitor: 'balloon', text: 'A hot-air balloon is drifting past {island}. Someone in the basket waved.' },
    { id: 'rainbow', weight: 3, visitor: 'rainbow', text: 'A short rain passed, and a rainbow stood over {island}.' },
  ],
  lost: [
    { id: 'tent', weight: 1, visitor: 'tent' },
  ],
});
// Keepsakes: small things a water surprise leaves on an island for good. They come from the water slot's
// `keepsake` flavour, and from the golden slot once its island already has its golden tree. Never the same
// kind twice on one island, and at most maxKeepsakesPerIsland. ground: building room it takes (saved in
// the record, like a building's); the others stand on the coast, whose share roomOf already holds back.
// Ids match electron/renderer/game/kinds.js.
const KEEPSAKES = deepFreeze([
  { id: 'fountain', weight: 3, ground: 1, text: 'A spring bubbled up near the square on {island}. The helpers built a little fountain around it.' },
  { id: 'well', weight: 2, text: 'Someone dug a little wishing well on {island}. A coin glints at the bottom.' },
  { id: 'bench', weight: 2, text: 'A traveler built a bench at the edge of {island} to watch the clouds, then left it for you.' },
  { id: 'cairn', weight: 1, text: 'Smooth stones were stacked into a little tower on {island} overnight.' },
  { id: 'telescope', weight: 1, text: 'A small brass telescope now points at the sky from the edge of {island}.' },
  { id: 'birdhouse', weight: 1, text: 'A birdhouse went up on {island}. Something small has moved in.' },
  { id: 'lamp', weight: 1, text: 'A little lamp now stands at the edge of {island}. It glows after dark.' },
]);
const KEEPSAKE_ENDING = 'Some water and soil were left beside it.';
// Bridge types. Rope is the one you build; the others come only as surprises (a new bridge, or a rope
// bridge that changes type). weight: how often a surprise rolls each one. Ids match BRIDGE_TYPES in
// electron/renderer/game/kinds.js. A water slide needs the two islands' lift at least slideLiftGap apart.
const BRIDGE_TYPES = Object.freeze({
  rope: { name: 'rope bridge', weight: 0 },
  arch: { name: 'stone arch', weight: 3 },
  slide: { name: 'water slide', weight: 3 },
  cloudsteps: { name: 'cloud steps', weight: 3, plural: true },
  flowerarch: { name: 'flower arch', weight: 3 },
  rainbow: { name: 'rainbow', weight: 1 },
});

const DEFAULT_RULES = Object.freeze({
  rulesVersion: 2,
  woodPerFocusMinute: 0.35,
  stonePerFocusMinute: 0.25,
  planksPerFocusMinute: 0.15,          // only once a Sawmill exists
  focusMinutesCountedPerSession: 90,
  soilPerRestMinute: 3,
  saplingsPerRestMinute: 2,
  restFullMinutes: 10,                 // first 10 minutes of a real break count fully
  restHalfUntilMinutes: 20,            // minutes 10 to 20 count at half value, nothing after
  restHalfValue: 0.5,
  realBreakMinimumMinutes: 3,          // matches electron/core/planning.js qualifyingRestSeconds
  realBreakShareOfPlan: 0.75,          // of the day plan's usual break, not the break's own timer
  breakMinutesWithoutPlan: 10,         // usual break when a day has no plan, matches qualifyingRestSeconds
  // Land is counted in points of the island's town grid. One old building spot is about 7 points.
  restMinutesPerLand: 5,               // rest minutes for one more land point
  startingLand: 40,                    // home's land at the start
  startLand: Object.freeze({ small: 30, medium: 40, large: 55 }), // a new island's land when it drifts in
  maxLand: Object.freeze({ small: 320, medium: 450, large: 600, home: 600 }), // most land each island's grid holds
  // Room for buildings: land - coastPerRootLand * sqrt(land) - laneShareOfLand * land - used, where used is
  // the start things (startGround), every building's ground, and groundPerBridgeEnd for each bridge end on
  // the island. The coast takes no houses or pads.
  coastPerRootLand: 4,
  laneShareOfLand: 0.12,
  startGround: Object.freeze({ home: 4, island: 2 }),
  // A bridge's foot needs a lane to the island's other lanes: about 5 points when it's laid, the foot
  // itself on the coast. Bridges are never refused for room, so room may dip below 0 until land catches up.
  groundPerBridgeEnd: 4,
  // Who gets each new land point: a roll weighted by appetite / (1 + landAgeStep * order), where order
  // is 0 for home, 1 for the first new island, and so on. No island may pass homeLead of home's land.
  landAgeStep: 0.3,
  homeAppetite: 1.3,
  homeLead: 0.85,
  appetiteRange: Object.freeze([0.7, 1.3]), // a new island's appetite, rolled when it arrives
  liftRange: Object.freeze([-0.5, 0.5]),    // how high a new island floats, rolled in liftStep steps; home is 0
  liftStep: 0.05,
  slideLiftGap: 0.25,                       // a water slide needs the islands' lifts at least this far apart
  startingSoil: 40,
  startingSaplings: 25,
  starlightPerOnPlanSession: 1,        // only if a real break follows (or it is the day's last session)
  onPlanTolerance: 0.15,
  starlightPerOnPlanDay: 4,
  onPlanDayThreshold: 0.85,
  starlightPerNearPlanDay: 1,
  nearPlanDayThreshold: 0.6,
  helperBoost: 0.08,
  firstHelperGapDays: 2,               // in active days
  helperGapGrowth: 1.3,
  bedsPerBlock: 1,                     // one bed for each block storey of a house
  startingBeds: 3,                     // the first 3 helpers sleep in the old tree's hollow
  homesShareOfIsland: 0.3,             // house blocks cover at most this share of an island's land
  islandGapsDays: Object.freeze([7, 14, 30, 45]), // in active days
  laterIslandGapDays: 60,
  priceScale: 1,
  repeatPriceStep: 0.4,                // each copy you own adds this share of the first price
  fastRepeatPriceStep: 1,              // the same, for cheap decor (a blueprint's own `step` comes first)
  blueprintsOffered: 3,
  maxShareOfIsland: 0.25,              // of an island's pad buildings (homes don't count)
  surpriseChance: 0.05,
  surpriseChanceAfterBreak: 0.12,
  surpriseCatchUpAfterActiveDays: 4,
  surpriseCatchUpStep: 1,
  maxLostHelpers: 3,
  lostHelpersAfterActiveDays: 10,
  maxKeepsakesPerIsland: 3,
});

// kind: making / growing / decor / homes / wonder. perIsland caps repeatable items on each island.
// tier 2 needs a Sawmill; tier 3 needs a Workshop and 3 islands. Ids match electron/renderer/game/kinds.js.
// ground: land points it takes from an island's room, from its footprint in kinds.js (point 1, pair 2,
// cell 5, cells 7, ring 11); a bridge takes none of its own, but each end takes groundPerBridgeEnd on its
// island, rope or fancy alike (see play.js addLink). linkType: it builds a link between two sky-table
// neighbours instead of standing on an island (offered while some neighbour pair has no link).
// Homes are parts of block houses, never things on a pad. blocks: new blocks on the ground; storeys:
// new block storeys (one bed each); weight: how often the homes slot shows it (lowest owned / weight);
// step: its own repeat price step. The layout picks which house grows and where.
const DEFAULT_BLUEPRINTS = deepFreeze([
  { id: 'house', name: 'Little house', kind: 'homes', tier: 1, again: true, ground: 3, blocks: 2, storeys: 2, weight: 1, step: 0.25, cost: { wood: 40, stone: 20, soil: 20, saplings: 10 }, does: 'A new house of two rooms, with beds for 2 more helpers.' },
  { id: 'room', name: 'Extra room', kind: 'homes', tier: 1, again: true, ground: 1, blocks: 1, storeys: 1, weight: 3, step: 0.06, cost: { wood: 20, stone: 12, soil: 10, saplings: 5 }, does: 'One more room on a house, with a bed for 1 more helper.' },
  { id: 'floor', name: 'Upper floor', kind: 'homes', tier: 2, again: true, ground: 0, blocks: 0, storeys: 1, weight: 2, step: 0.06, cost: { stone: 14, planks: 18, soil: 8, saplings: 4 }, does: 'One more storey on a house, with a bed for 1 more helper.' },
  { id: 'flowers', name: 'Flower bed', kind: 'decor', tier: 1, again: true, perIsland: 2, fast: true, ground: 2, cost: { wood: 25, stone: 10, soil: 25, saplings: 15 }, does: 'Something pretty to look at.' },
  { id: 'garden', name: 'Garden plot', kind: 'growing', tier: 1, opensJob: 'soil', ground: 5, cost: { wood: 30, stone: 15, soil: 50, saplings: 25 }, does: 'A helper can work here as a Gardener, making soil.' },
  { id: 'nursery', name: 'Rain catcher', kind: 'growing', tier: 1, opensJob: 'saplings', ground: 5, cost: { wood: 40, stone: 20, soil: 60, saplings: 35 }, does: 'A helper can work here as a Water carrier, catching rainwater.' },
  { id: 'sawmill', name: 'Sawmill', kind: 'making', tier: 1, opensJob: 'planks', ground: 5, cost: { wood: 110, stone: 60, soil: 60, saplings: 30 }, does: 'Focus makes planks too, and new buildings open up.' },
  { id: 'workshop', name: 'Workshop', kind: 'making', tier: 2, ground: 5, cost: { stone: 80, planks: 60, soil: 80, saplings: 40 }, does: 'Opens bigger buildings once you have 3 islands.' },
  { id: 'windmill', name: 'Windmill', kind: 'making', tier: 2, again: true, perIsland: 2, ground: 5, cost: { stone: 100, planks: 90, soil: 60, saplings: 35 }, does: 'Turns slowly in the wind.' },
  { id: 'orchard', name: 'Orchard', kind: 'growing', tier: 2, again: true, perIsland: 2, ground: 5, cost: { wood: 90, planks: 40, soil: 110, saplings: 80 }, does: 'A little grove of fruit trees.' },
  { id: 'lanterns', name: 'Lantern path', kind: 'decor', tier: 2, again: true, perIsland: 2, fast: true, ground: 1, cost: { wood: 40, stone: 40, planks: 20, soil: 30, saplings: 20 }, does: 'Little lights along the paths.' },
  { id: 'bridge', name: 'Rope bridge', kind: 'decor', tier: 2, again: true, linkType: 'rope', noSpot: true, ground: 0, cost: { wood: 60, planks: 60, soil: 40, saplings: 40 }, does: 'A rope bridge to another island.' },
  { id: 'tower', name: 'Lookout tower', kind: 'making', tier: 3, again: true, perIsland: 1, ground: 5, cost: { wood: 100, stone: 300, planks: 180, soil: 70, saplings: 40 }, does: 'A tall tower that looks out over the sky.' },
  { id: 'pond', name: 'Lily pond', kind: 'growing', tier: 3, again: true, perIsland: 1, ground: 5, cost: { wood: 80, stone: 250, soil: 180, saplings: 100 }, does: 'A quiet pond, with roots and water hanging below.' },
  { id: 'greattree', name: 'Great tree', kind: 'growing', tier: 3, ground: 5, cost: { wood: 200, stone: 100, soil: 400, saplings: 300 }, does: 'A huge old tree.' },
  { id: 'grotto', name: 'Mushroom grotto', kind: 'growing', onlyOn: 'mossy', ground: 5, cost: { wood: 60, stone: 40, soil: 150, saplings: 100 }, does: 'Glowing mushrooms in a mossy cave. Only on mossy islands.' },
  { id: 'quarry', name: 'Stone quarry', kind: 'making', onlyOn: 'rocky', ground: 5, cost: { wood: 120, stone: 60, planks: 40, soil: 50, saplings: 30 }, does: 'Stone cut straight from the cliff. Only on rocky islands.' },
  { id: 'beehives', name: 'Beehive meadow', kind: 'growing', onlyOn: 'meadow', ground: 5, cost: { wood: 80, planks: 30, soil: 120, saplings: 100 }, does: 'Busy bees among the clover. Only on meadow islands.' },
  { id: 'forge', name: 'Crystal forge', kind: 'making', onlyOn: 'crystal', ground: 5, cost: { stone: 150, planks: 80, soil: 60, saplings: 40 }, does: 'A warm forge that glows in the crystal light. Only on crystal islands.' },
  { id: 'loom', name: 'Mist loom', kind: 'decor', onlyOn: 'misty', ground: 5, cost: { wood: 80, planks: 60, soil: 60, saplings: 60 }, does: 'Weaves soft cloth from the mist. Only on misty islands.' },
  { id: 'lighthouse', name: 'Lighthouse', kind: 'wonder', order: 1, ground: 5, cost: { stone: 100, starlight: 90 }, does: 'The first Starlight wonder: a light that sweeps the sky.', moment: 'The Lighthouse is lit. Its beam sweeps slowly across the sky.' },
  { id: 'airship', name: 'Airship dock', kind: 'wonder', order: 2, ground: 7, cost: { planks: 150, starlight: 170 }, does: 'A Starlight wonder: little airships drift between the islands.', moment: 'The Airship dock is finished. Little airships drift between the islands now.' },
  { id: 'observatory', name: 'Observatory', kind: 'wonder', order: 3, ground: 11, cost: { stone: 200, starlight: 180 }, does: 'A Starlight wonder: a dome that opens to the stars.', moment: 'The Observatory opens its roof to the stars.' },
  { id: 'skyfall', name: 'Sky waterfall', kind: 'wonder', order: 4, ground: 5, cost: { stone: 150, soil: 200, starlight: 190 }, does: 'A Starlight wonder: water pouring off the edge of the island.', moment: 'A Sky waterfall pours off the edge and turns to mist far below.' },
  { id: 'aurora', name: 'Aurora garden', kind: 'wonder', order: 5, ground: 11, cost: { soil: 250, saplings: 200, starlight: 200 }, does: 'A Starlight wonder: a garden that glows after dark.', moment: 'The Aurora garden glows green and violet after dark.' },
]);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function gapList(rules) {
  const gaps = Array.isArray(rules.islandGapsDays) ? rules.islandGapsDays : String(rules.islandGapsDays).split(/[\s,]+/);
  return gaps.map(Number).filter(n => n > 0);
}
// When the Nth new island (0 = first new one) arrives, in active days.
function islandDueAt(rules, index) {
  const gaps = gapList(rules);
  let at = 0;
  for (let i = 0; i <= index; i++) at += i < gaps.length ? gaps[i] : rules.laterIslandGapDays;
  return at;
}
// When the Nth scheduled helper (0 = second helper overall) arrives, in active days. Gaps grow, so arrivals slow down.
function helperDueAt(rules, index) {
  let at = 0;
  for (let i = 0; i <= index; i++) at += rules.firstHelperGapDays * Math.pow(rules.helperGapGrowth, i);
  return at;
}

// session: { kind: 'break', elapsedSeconds, targetSeconds }
function isRealBreak(session, rules) {
  return session.kind === 'break' &&
    session.elapsedSeconds >= Math.max(rules.realBreakMinimumMinutes * 60, rules.realBreakShareOfPlan * (session.targetSeconds || 0));
}
// Rest value of one real break: full for the first minutes, half for a while, then nothing.
function restValue(minutes, rules) {
  return Math.min(minutes, rules.restFullMinutes) +
    rules.restHalfValue * Math.max(0, Math.min(minutes, rules.restHalfUntilMinutes) - rules.restFullMinutes);
}
// session: { kind: 'focus', elapsedSeconds, targetSeconds }
function focusOnPlan(session, rules) {
  return session.kind === 'focus' && session.targetSeconds > 0 &&
    Math.abs(session.elapsedSeconds - session.targetSeconds) <= rules.onPlanTolerance * session.targetSeconds;
}
// How closely a whole day matched its plan, from 0 to 1. Null when there was no plan.
// day: { plan: { sessions, focusMinutes } | null, sessions: [{ kind, elapsedSeconds, targetSeconds }] }
function dayPlanMatch(day, rules) {
  if (!day.plan || !day.plan.sessions) return null;
  const plannedFocus = day.plan.sessions * day.plan.focusMinutes;
  let actualFocus = 0, realBreaks = 0;
  for (const s of day.sessions || []) {
    if (s.kind === 'focus') actualFocus += s.elapsedSeconds / 60;
    if (isRealBreak(s, rules)) realBreaks += 1;
  }
  const focusMatch = Math.max(0, 1 - Math.abs(actualFocus - plannedFocus) / plannedFocus);
  const breakMatch = Math.min(1, realBreaks / Math.max(1, day.plan.sessions - 1));
  return (focusMatch + breakMatch) / 2;
}
// Room an island has for buildings, in land points: its land less the coast (no houses or pads there),
// the lanes, and the ground already used (start things, buildings, bridge ends). The layout relies on this
// sum to never need extra land.
function roomOf(land, used, rules) {
  return land - rules.coastPerRootLand * Math.sqrt(land) - rules.laneShareOfLand * land - used;
}
// The most land an island's grid can hold.
function maxLandOf(island, rules) {
  const most = rules.maxLand && rules.maxLand[island.kind === 'home' ? 'home' : island.size];
  return typeof most === 'number' ? most : Infinity;
}
// Ground the start things take: the plaza, pile, campfire, tree and rock on home, less on a new island.
function startGroundOf(island, rules) {
  return island.kind === 'home' ? rules.startGround.home : rules.startGround.island;
}
// state needs { counts: { blueprintId: number owned } }.
function priceOf(bp, state, rules) {
  const step = bp.step ?? (bp.fast ? rules.fastRepeatPriceStep : rules.repeatPriceStep);
  const owned = (state.counts && state.counts[bp.id]) || 0;
  const factor = rules.priceScale * (bp.again ? 1 + step * owned : 1), price = {};
  for (const r of Object.keys(bp.cost)) if (bp.cost[r] > 0) price[r] = Math.round(bp.cost[r] * factor);
  return price;
}
// The name a saved building shows today: its blueprint's name now, so a renamed building reads the new way,
// or the name saved at build time when the blueprint is gone. The saved record is never changed.
function builtNameOf(built, blueprints) {
  const bp = (blueprints || []).find(b => b.id === built.blueprint);
  return (bp && bp.name) || built.name;
}

module.exports = {
  RESOURCES, MATERIALS, GROWTH, KIND_NAMES, JOBS, STARTING_JOBS, HELPER_NAMES, FIRST_HELPER_WAY, LOST_HELPER_WAY,
  ARRIVAL_WAYS, ISLAND_KINDS, NEW_ISLAND_KINDS, ISLAND_SIZES, SURPRISES, SURPRISE_FLAVOURS, KEEPSAKES, KEEPSAKE_ENDING,
  BRIDGE_TYPES, DEFAULT_RULES, DEFAULT_BLUEPRINTS,
  islandDueAt, helperDueAt, isRealBreak, restValue, focusOnPlan, dayPlanMatch, priceOf, builtNameOf, roomOf, maxLandOf,
  startGroundOf,
};
