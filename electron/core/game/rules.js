'use strict';
// The game's numbers, lists, and small pure helpers. Ported from the pacing prototype's SkyRules
// (game/prototypes/pacing-prototype.html on the prototype branch). Changing a number here only
// changes grants and check-ins that haven't been saved yet: saved records keep their own numbers.

const RESOURCES = ['wood', 'stone', 'planks', 'soil', 'saplings', 'starlight'];
const MATERIALS = ['wood', 'stone', 'planks'];
const GROWTH = ['soil', 'saplings'];
const KIND_NAMES = { making: 'making things', growing: 'growing things', decor: 'homes and decor', wonder: 'Starlight wonder' };

const JOBS = {
  wood: { name: 'Woodcutter', doing: 'gathering fallen branches by the old tree' },
  stone: { name: 'Stone gatherer', doing: 'stacking smooth stones from the big rock' },
  planks: { name: 'Sawyer', doing: 'sawing planks at the mill' },
  soil: { name: 'Gardener', doing: 'turning soil in the garden plot' },
  saplings: { name: 'Seed keeper', doing: 'sorting seeds in the nursery' },
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
const ISLAND_SIZES = {
  small: { startLand: 2, weight: 1 },
  medium: { startLand: 3, weight: 1.5 },
  large: { startLand: 5, weight: 2 },
};
const SURPRISES = [
  { id: 'seeds', weight: 4 }, { id: 'soil', weight: 3 }, { id: 'stones', weight: 3 },
  { id: 'fireflies', weight: 2 }, { id: 'golden', weight: 1 }, { id: 'lost', weight: 1 },
];

const DEFAULT_RULES = Object.freeze({
  rulesVersion: 1,
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
  restMinutesPerNewSpot: 35,
  startingSpots: 4,
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
  bedsPerCottage: 2,
  startingBeds: 3,                     // the first 3 helpers sleep in the old tree's hollow
  islandGapsDays: Object.freeze([7, 14, 30, 45]), // in active days
  laterIslandGapDays: 60,
  priceScale: 1,
  repeatPriceStep: 0.4,                // each copy you own adds this share of the first price
  fastRepeatPriceStep: 1,              // the same, for cheap decor
  blueprintsOffered: 3,
  maxShareOfIsland: 0.25,
  surpriseChance: 0.05,
  surpriseChanceAfterBreak: 0.12,
  surpriseCatchUpAfterActiveDays: 4,
  surpriseCatchUpStep: 1,
  maxLostHelpers: 3,
  lostHelpersAfterActiveDays: 10,
});

// kind: making / growing / decor / wonder. perIsland caps repeatable items on each island.
// tier 2 needs a Sawmill; tier 3 needs a Workshop and 3 islands. Ids match electron/renderer/game/kinds.js.
const DEFAULT_BLUEPRINTS = deepFreeze([
  { id: 'flowers', name: 'Flower bed', kind: 'decor', tier: 1, again: true, perIsland: 2, fast: true, cost: { wood: 25, stone: 10, soil: 25, saplings: 15 }, does: 'Something pretty to look at.' },
  { id: 'cottage', name: 'Cottage', kind: 'decor', tier: 1, again: true, perIsland: 3, beds: true, cost: { wood: 45, stone: 25, soil: 25, saplings: 10 }, does: 'A home for 2 more helpers.' },
  { id: 'garden', name: 'Garden plot', kind: 'growing', tier: 1, opensJob: 'soil', cost: { wood: 30, stone: 15, soil: 50, saplings: 25 }, does: 'A helper can work here as a Gardener, making soil.' },
  { id: 'nursery', name: 'Seed nursery', kind: 'growing', tier: 1, opensJob: 'saplings', cost: { wood: 40, stone: 20, soil: 60, saplings: 35 }, does: 'A helper can work here as a Seed keeper, growing saplings.' },
  { id: 'sawmill', name: 'Sawmill', kind: 'making', tier: 1, opensJob: 'planks', cost: { wood: 110, stone: 60, soil: 60, saplings: 30 }, does: 'Focus makes planks too, and new buildings open up.' },
  { id: 'workshop', name: 'Workshop', kind: 'making', tier: 2, cost: { stone: 80, planks: 60, soil: 80, saplings: 40 }, does: 'Opens bigger buildings once you have 3 islands.' },
  { id: 'windmill', name: 'Windmill', kind: 'making', tier: 2, again: true, perIsland: 2, cost: { stone: 100, planks: 90, soil: 60, saplings: 35 }, does: 'Turns slowly in the wind.' },
  { id: 'orchard', name: 'Orchard', kind: 'growing', tier: 2, again: true, perIsland: 2, cost: { wood: 90, planks: 40, soil: 110, saplings: 80 }, does: 'A little grove of fruit trees.' },
  { id: 'lanterns', name: 'Lantern path', kind: 'decor', tier: 2, again: true, perIsland: 2, fast: true, cost: { wood: 40, stone: 40, planks: 20, soil: 30, saplings: 20 }, does: 'Little lights along the paths.' },
  { id: 'bridge', name: 'Rope bridge', kind: 'decor', tier: 2, again: true, perExtraIsland: true, noSpot: true, cost: { wood: 60, planks: 60, soil: 40, saplings: 40 }, does: 'A rope bridge to another island.' },
  { id: 'tower', name: 'Lookout tower', kind: 'making', tier: 3, again: true, perIsland: 1, cost: { wood: 100, stone: 300, planks: 180, soil: 70, saplings: 40 }, does: 'A tall tower that looks out over the sky.' },
  { id: 'pond', name: 'Lily pond', kind: 'growing', tier: 3, again: true, perIsland: 1, cost: { wood: 80, stone: 250, soil: 180, saplings: 100 }, does: 'A quiet pond, with roots and water hanging below.' },
  { id: 'greattree', name: 'Great tree', kind: 'growing', tier: 3, cost: { wood: 200, stone: 100, soil: 400, saplings: 300 }, does: 'A huge old tree.' },
  { id: 'grotto', name: 'Mushroom grotto', kind: 'growing', onlyOn: 'mossy', cost: { wood: 60, stone: 40, soil: 150, saplings: 100 }, does: 'Glowing mushrooms in a mossy cave. Only on mossy islands.' },
  { id: 'quarry', name: 'Stone quarry', kind: 'making', onlyOn: 'rocky', cost: { wood: 120, stone: 60, planks: 40, soil: 50, saplings: 30 }, does: 'Stone cut straight from the cliff. Only on rocky islands.' },
  { id: 'beehives', name: 'Beehive meadow', kind: 'growing', onlyOn: 'meadow', cost: { wood: 80, planks: 30, soil: 120, saplings: 100 }, does: 'Busy bees among the clover. Only on meadow islands.' },
  { id: 'forge', name: 'Crystal forge', kind: 'making', onlyOn: 'crystal', cost: { stone: 150, planks: 80, soil: 60, saplings: 40 }, does: 'A warm forge that glows in the crystal light. Only on crystal islands.' },
  { id: 'loom', name: 'Mist loom', kind: 'decor', onlyOn: 'misty', cost: { wood: 80, planks: 60, soil: 60, saplings: 60 }, does: 'Weaves soft cloth from the mist. Only on misty islands.' },
  { id: 'lighthouse', name: 'Lighthouse', kind: 'wonder', order: 1, cost: { stone: 100, starlight: 90 }, does: 'The first Starlight wonder: a light that sweeps the sky.', moment: 'The Lighthouse is lit. Its beam sweeps slowly across the sky.' },
  { id: 'airship', name: 'Airship dock', kind: 'wonder', order: 2, cost: { planks: 150, starlight: 170 }, does: 'A Starlight wonder: little airships drift between the islands.', moment: 'The Airship dock is finished. Little airships drift between the islands now.' },
  { id: 'observatory', name: 'Observatory', kind: 'wonder', order: 3, cost: { stone: 200, starlight: 180 }, does: 'A Starlight wonder: a dome that opens to the stars.', moment: 'The Observatory opens its roof to the stars.' },
  { id: 'skyfall', name: 'Sky waterfall', kind: 'wonder', order: 4, cost: { stone: 150, soil: 200, starlight: 190 }, does: 'A Starlight wonder: water pouring off the edge of the island.', moment: 'A Sky waterfall pours off the edge and turns to mist far below.' },
  { id: 'aurora', name: 'Aurora garden', kind: 'wonder', order: 5, cost: { soil: 250, saplings: 200, starlight: 200 }, does: 'A Starlight wonder: a garden that glows after dark.', moment: 'The Aurora garden glows green and violet after dark.' },
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
// state needs { counts: { blueprintId: number owned } }.
function priceOf(bp, state, rules) {
  const step = bp.fast ? rules.fastRepeatPriceStep : rules.repeatPriceStep;
  const owned = (state.counts && state.counts[bp.id]) || 0;
  const factor = rules.priceScale * (bp.again ? 1 + step * owned : 1), price = {};
  for (const r of Object.keys(bp.cost)) if (bp.cost[r] > 0) price[r] = Math.round(bp.cost[r] * factor);
  return price;
}

module.exports = {
  RESOURCES, MATERIALS, GROWTH, KIND_NAMES, JOBS, STARTING_JOBS, HELPER_NAMES, FIRST_HELPER_WAY, LOST_HELPER_WAY,
  ARRIVAL_WAYS, ISLAND_KINDS, NEW_ISLAND_KINDS, ISLAND_SIZES, SURPRISES, DEFAULT_RULES, DEFAULT_BLUEPRINTS,
  islandDueAt, helperDueAt, isRealBreak, restValue, focusOnPlan, dayPlanMatch, priceOf,
};
