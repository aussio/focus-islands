'use strict';
// The game state is the saved check-ins added up, plus the next check-in worked out from grants
// since the last one. Each step of a check-in is decided once (in `prepare` and `pick`), written
// into the check-in record, and then applied by the same `apply*` functions that replay saved
// records. So a saved check-in always replays exactly as it was shown, whatever the rules say now.

const R = require('./rules');
const { roll, pickOne, pickWeighted, fingerprint } = require('./dice');
const { latestTrigger } = require('./history');
const sky = require('./sky');
const version1 = require('./version1');

const round2 = x => Math.round(x * 100) / 100;
const EPSILON = 1e-6;
function empty() { return { wood: 0, stone: 0, planks: 0, soil: 0, saplings: 0, starlight: 0 }; }
function addInto(target, amounts, sign = 1) {
  for (const r of Object.keys(amounts || {})) if (typeof amounts[r] === 'number') target[r] = (target[r] || 0) + sign * amounts[r];
  return target;
}
function rounded(amounts) {
  const out = empty();
  for (const r of R.RESOURCES) out[r] = round2(amounts[r] || 0);
  return out;
}
const article = name => (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// ---------------------------------------------------------------------------------------------
// The starting state and replaying saved check-ins.

// An island as the rules keep it. fields: { id, name, kind, size, land, ring, angle, lift, appetite }.
// used: ground taken by start things, buildings and bridge ends (see R.roomOf). blocks and storeys: house blocks
// on the ground and block storeys. pads: buildings that aren't homes.
function makeIsland(fields, rules) {
  const island = { ...fields, golden: false, buildings: [], counts: {}, used: 0, blocks: 0, storeys: 0, pads: 0 };
  island.used = R.startGroundOf(island, rules);
  return island;
}

function initialState(started, rules) {
  const p = version1.startPayload(started.payload || {});
  return {
    startedID: started.id,
    covered: started.sequence ?? 0,
    onHand: { ...empty(), soil: p.startingSoil ?? rules.startingSoil, saplings: p.startingSaplings ?? rules.startingSaplings },
    landProgress: 0,
    islands: [makeIsland({ id: 'home', name: R.ISLAND_KINDS.home.names[0], kind: 'home', size: 'medium',
      land: p.startingLand ?? rules.startingLand, ...sky.placeOf(0), lift: 0, appetite: rules.homeAppetite }, rules)],
    links: [],
    helpers: [{ id: 'h1', name: R.HELPER_NAMES[0], job: null, island: 'home', how: R.FIRST_HELPER_WAY }],
    queue: [],
    helpersMade: 1, helpersScheduled: 0, lostHelpers: 0,
    counts: {}, storeys: 0, buildingsMade: 0, wonders: [], firsts: {},
    checkIns: 0, lastSurpriseDay: null, activeDaysAtLastSurprise: 0,
    last: null,
  };
}

function islandById(state, id) { return state.islands.find(island => island.id === id); }

function applyCollect(state, p) {
  addInto(state.onHand, p.collected);
  state.landProgress = p.landProgress;
  for (const grown of p.newLand || []) islandById(state, grown.island).land += grown.amount;
}
function applySurprise(state, p, rules) {
  const s = p.surprise;
  if (!s) return;
  addInto(state.onHand, s.gifts);
  if (s.golden) islandById(state, s.island).golden = true;
  if (s.link) addLink(state, s.link, p.number, rules);
  if (s.upgrade) {
    const link = state.links.find(l => l.id === s.upgrade.link);
    if (link) link.type = s.upgrade.type; // only the type changes, so the bridge's feet never move
  }
  state.lastSurpriseDay = p.dayKey;
  state.activeDaysAtLastSurprise = p.activeDays;
}
function applyIslands(state, p, rules) {
  for (const island of p.islands || []) {
    const { id, name, kind, size, land, ring, angle, lift, appetite } = island;
    state.islands.push(makeIsland({ id, name, kind, size, land, ring, angle, lift, appetite }, rules));
  }
}
// link: { id, from, to, type, land: { [from]: n, [to]: m } }, made at check-in `number`. Each end takes
// groundPerBridgeEnd of its island's room, for the lane from its foot to the island's other lanes.
function addLink(state, link, number, rules) {
  state.links.push({ id: link.id, from: link.from, to: link.to, type: link.type, checkIn: number, land: { ...link.land } });
  for (const id of [link.from, link.to]) {
    const island = islandById(state, id);
    if (island) island.used += rules.groundPerBridgeEnd || 0;
  }
}
function applyHelpers(state, p) {
  for (const helper of p.helpersQueued || []) {
    state.queue.push({ id: helper.id, name: helper.name, how: helper.how });
    state.helpersMade += 1;
    if (helper.via === 'lost') state.lostHelpers += 1; else state.helpersScheduled += 1;
  }
  for (const helper of p.helpersArrived || []) {
    state.queue = state.queue.filter(waiting => waiting.id !== helper.id);
    state.helpers.push({ id: helper.id, name: helper.name, job: null, island: helper.island, how: helper.how });
  }
}
function applyJob(state, job) {
  if (!job) return;
  const helper = state.helpers.find(h => h.id === job.helper);
  helper.job = job.job;
  helper.island = job.island;
}
function applyBuild(state, built, number, rules, blueprints) {
  if (!built) return;
  addInto(state.onHand, built.price, -1);
  state.counts[built.blueprint] = (state.counts[built.blueprint] || 0) + 1;
  state.buildingsMade += 1;
  const bp = blueprints.find(b => b.id === built.blueprint) || {};
  if (bp.kind === 'homes') state.storeys += bp.storeys || 0;
  if (built.island) {
    const island = islandById(state, built.island);
    island.buildings.push({ id: built.id, blueprint: built.blueprint, name: built.name, landWhenBuilt: built.landWhenBuilt, checkIn: number });
    island.counts[built.blueprint] = (island.counts[built.blueprint] || 0) + 1;
    island.used += bp.ground || 0;
    if (bp.kind === 'homes') { island.blocks += bp.blocks || 0; island.storeys += bp.storeys || 0; } else island.pads += 1;
  }
  if (built.link) addLink(state, { ...built.link, id: built.id }, number, rules);
  if (built.kind === 'wonder') state.wonders.push(built.blueprint);
}
function applyRecord(state, p, sequence, rules, blueprints) {
  applyCollect(state, p);
  applySurprise(state, p, rules);
  applyIslands(state, p, rules);
  applyHelpers(state, p);
  applyJob(state, p.job);
  applyBuild(state, p.built, p.number, rules, blueprints);
  for (const key of p.firsts || []) state.firsts[key] = p.number;
  state.checkIns = p.number;
  state.covered = p.covered ?? sequence;
  state.last = p;
}

function fold(facts, rules, blueprints = R.DEFAULT_BLUEPRINTS) {
  const state = initialState({ ...facts.started, sequence: facts.startedSequence }, rules);
  for (const record of facts.checkIns) {
    applyRecord(state, version1.checkInPayload(record.payload, { blueprints, rules, state }), record.sequence, rules, blueprints);
  }
  return state;
}

function cloneState(state) {
  const { last, ...rest } = state;
  return { ...structuredClone(rest), last };
}

// ---------------------------------------------------------------------------------------------
// Small rule helpers (ported from the prototype).

function count(state, id) { return state.counts[id] || 0; }
function beds(state, rules) { return rules.startingBeds + rules.bedsPerBlock * state.storeys; }
function roomOn(island, rules, land = island.land) { return R.roomOf(land, island.used, rules); }
function openJobs(state, blueprints) {
  const jobs = R.STARTING_JOBS.slice();
  for (const bp of blueprints) if (bp.opensJob && count(state, bp.id) > 0 && !jobs.includes(bp.opensJob)) jobs.push(bp.opensJob);
  return jobs;
}
function boost(state, rules, resource) {
  return 1 + rules.helperBoost * state.helpers.filter(h => h.job === resource).length;
}
function nextWonder(state, blueprints) {
  return blueprints.filter(bp => bp.kind === 'wonder' && !count(state, bp.id)).sort((a, b) => a.order - b.order)[0] || null;
}
// Is this blueprint worth offering at all right now? (Never offer a pointless choice.)
function available(bp, state, rules, blueprints) {
  if (bp.kind === 'wonder') return nextWonder(state, blueprints) === bp;
  if (bp.tier === 2 && !count(state, 'sawmill')) return false;
  if (bp.tier === 3 && (!count(state, 'workshop') || state.islands.length < 3)) return false;
  if (!bp.again && !bp.onlyOn && count(state, bp.id)) return false;
  if (bp.onlyOn && !state.islands.some(i => i.kind === bp.onlyOn && !i.counts[bp.id])) return false;
  if (bp.linkType && !openPairs(state).length) return false;
  return true; // homes are offered whenever they fit, not only when a helper needs a bed
}
// Homes on one island: a new house once the houses there have at least one room each (the first is
// always allowed), a room on an island with a house, and a floor while floors are fewer than blocks (so
// houses average under 2 storeys). Blocks cover at most homesShareOfIsland of the island's land.
function homesFit(bp, island, rules, land) {
  if (island.blocks + (bp.blocks || 0) > rules.homesShareOfIsland * land + EPSILON) return false;
  const houses = island.counts.house || 0;
  if (bp.id === 'house') return (island.counts.room || 0) >= houses;
  if (bp.id === 'floor') return houses > 0 && (island.counts.floor || 0) < island.blocks;
  return houses > 0;
}
// Where it would go: an island index, -1 for things that need no spot, or null if there is no room.
// Of the islands with enough room for the blueprint's ground, it picks the one with the fewest buildings
// for its land (buildings ÷ land, homes included), so every island fills up alike and a young island gets
// the next things until it runs out of room. Ties go to the most room, then the earlier island.
// (Room ÷ land would count the coast, which takes most of a small young island, so new islands would
// look full while still nearly empty.) landOf(island) can stand in for each island's land, to look ahead.
function placeFor(bp, state, rules, landOf = null) {
  if (bp.noSpot) return -1;
  let best = null, bestCrowd = Infinity, bestRoom = -Infinity;
  state.islands.forEach((island, i) => {
    const land = landOf ? landOf(island) : island.land;
    const room = roomOn(island, rules, land);
    if (room + EPSILON < (bp.ground || 0)) return;
    if (bp.onlyOn && (island.kind !== bp.onlyOn || island.counts[bp.id])) return;
    if (bp.kind === 'homes' && !homesFit(bp, island, rules, land)) return;
    // A repeatable item may fill at most a set share of an island's pad buildings (never less than its small base cap).
    if (bp.perIsland && (island.counts[bp.id] || 0) >= Math.max(bp.perIsland, Math.floor(island.pads * rules.maxShareOfIsland))) return;
    const crowd = island.buildings.length / Math.max(1, land);
    const better = best === null || crowd < bestCrowd - EPSILON || (crowd < bestCrowd + EPSILON && room > bestRoom + EPSILON);
    if (better) { best = i; bestCrowd = crowd; bestRoom = room; }
  });
  return best;
}
// Hands out land points one at a time. Each point goes to one island by a roll keyed by `key` and the
// point's number (first, first + 1, ...), weighted by appetite / (1 + landAgeStep * order), where order
// is 0 for home, 1 for the first new island, and so on. So home grows most and the newest least. An
// island can't take a point when it is full, or when it would pass homeLead of home's land, so home
// stays the largest; the roll is made only among islands that can take it. land: Map of island id to
// land, changed in place. Returns how many points were handed out: fewer than asked when none can.
function shareLand(islands, land, points, rules, key, first = 0) {
  const home = islands[0];
  const weight = new Map(islands.map((island, order) => [island.id, island.appetite / (1 + rules.landAgeStep * order)]));
  let given = 0;
  for (; given < points; given++) {
    const lead = rules.homeLead * land.get(home.id);
    const open = islands.filter(island => land.get(island.id) + 1 <= R.maxLandOf(island, rules) + EPSILON &&
      (island === home || land.get(island.id) + 1 <= lead + EPSILON));
    const target = pickWeighted(`${key}:land:${first + given}`, open, island => weight.get(island.id));
    if (!target) break;
    land.set(target.id, land.get(target.id) + 1);
  }
  return given;
}
// About how many more land points, shared out as at a check-in, before this blueprint fits somewhere.
// Null if land alone won't make it fit. The rolls are a guess at the next check-ins', for the teaser.
function landPointsNeeded(bp, state, rules) {
  if (placeFor(bp, state, rules, island => R.maxLandOf(island, rules)) === null) return null;
  const land = new Map(state.islands.map(island => [island.id, island.land]));
  const landOf = island => land.get(island.id);
  const key = `${state.startedID}:ahead:${state.checkIns}`;
  for (let points = 1; points <= 1000; points++) {
    if (!shareLand(state.islands, land, 1, rules, key, points - 1)) return null;
    if (placeFor(bp, state, rules, landOf) !== null) return points;
  }
  return null;
}

// Bridges join sky-table neighbours (see sky.js). An open pair is a neighbour pair with no link yet.
function openPairs(state) {
  return sky.neighbourPairs(state.islands).filter(pair => !sky.linked(pair.from, pair.to, state.links));
}
// Where the next rope bridge goes, or null when every neighbour pair has a link:
// 1. the earliest island that isn't joined to home yet but has a joined neighbour, linked to one of its
//    joined neighbours by a roll: inward weight 2, any other neighbour 1. So islands don't all hang off home;
// 2. otherwise the first open pair in table order. This closes a loop.
function ropeTarget(state, key) {
  const joined = sky.joinedSet(state.islands, state.links);
  for (const island of state.islands) {
    if (joined.has(island.id)) continue;
    const near = sky.neighboursOf(island.id, state.islands).filter(n => joined.has(n.id));
    if (!near.length) continue;
    const chosen = pickWeighted(`${key}:rope`, near, n => (n.way === 'inward' ? 2 : 1));
    return { from: chosen.id, to: island.id };
  }
  const pair = openPairs(state)[0];
  return pair ? { from: pair.from, to: pair.to } : null;
}
function canAfford(price, state) {
  return Object.keys(price).every(r => (state.onHand[r] || 0) + EPSILON >= price[r]);
}

// Job options, most useful first: the resource most short for the nearest thing you can't yet afford.
function rankJobs(state, rules, blueprints) {
  const jobs = openJobs(state, blueprints), need = {};
  for (const j of jobs) need[j] = 0;
  let nearest = null, nearestGap = Infinity;
  for (const bp of blueprints) {
    if (bp.kind === 'wonder' || !available(bp, state, rules, blueprints)) continue;
    const price = R.priceOf(bp, state, rules);
    if (canAfford(price, state)) continue;
    let gap = 0;
    const parts = {};
    for (const r of Object.keys(price)) { parts[r] = Math.max(0, price[r] - (state.onHand[r] || 0)) / price[r]; gap += parts[r]; }
    if (gap < nearestGap) { nearestGap = gap; nearest = parts; }
  }
  if (nearest) for (const j of jobs) need[j] = nearest[j] || 0;
  const on = j => state.helpers.filter(h => h.job === j).length;
  return jobs.slice().sort((a, b) => (need[b] - need[a]) || (on(a) - on(b)));
}

// An offer of 2 or 3 blueprints, one per kind. A wonder may be offered on its own. Each kind shows
// the affordable blueprint with the lowest number owned ÷ its weight (1 unless it has one), then by roll.
function makeOffer(state, rules, blueprints, key) {
  const byKind = {};
  const owned = option => count(state, option.bp.id) / (option.bp.weight || 1);
  for (const bp of blueprints) {
    if (!available(bp, state, rules, blueprints)) continue;
    const price = R.priceOf(bp, state, rules);
    if (!canAfford(price, state)) continue;
    const where = placeFor(bp, state, rules);
    if (where === null) continue;
    const option = { bp, price, island: where >= 0 ? state.islands[where].id : null, order: roll(`${key}:offer:${bp.id}`) };
    if (bp.linkType) option.link = ropeTarget(state, key);
    const current = byKind[bp.kind];
    const better = !current || owned(option) < owned(current) || (owned(option) === owned(current) && option.order < current.order);
    if (better) byKind[bp.kind] = option;
  }
  const kinds = Object.keys(byKind).filter(k => k !== 'wonder')
    .map(k => ({ k, r: roll(`${key}:kind:${k}`) })).sort((a, b) => a.r - b.r).map(x => x.k);
  if (byKind.wonder) kinds.unshift('wonder');
  const offer = kinds.slice(0, Math.max(2, rules.blueprintsOffered)).map(k => byKind[k]);
  if (offer.length < 2 && !(offer.length === 1 && offer[0].bp.kind === 'wonder')) return null;
  return offer;
}

// A helper's island: where the building for their job stands, or for wood and stone, the island
// with the fewest working helpers, so helpers spread out as islands arrive.
function islandForJob(state, job, blueprints) {
  const opener = blueprints.find(bp => bp.opensJob === job);
  const site = opener && state.islands.find(island => island.counts[opener.id]);
  if (site) return site.id;
  let best = state.islands[0], fewest = Infinity;
  for (const island of state.islands) {
    const working = state.helpers.filter(h => h.job && h.island === island.id).length;
    if (working < fewest) { best = island; fewest = working; }
  }
  return best.id;
}

// ---------------------------------------------------------------------------------------------
// "Next up": a gentle line for check-ins with no choice, so an empty check-in still feels like progress.

function teaser(state, rules, blueprints, typical) {
  const focusMinutes = Math.min(typical.focusMinutes, rules.focusMinutesCountedPerSession);
  const breakRest = R.restValue(typical.breakMinutes, rules);
  const perBreak = { soil: breakRest * rules.soilPerRestMinute * boost(state, rules, 'soil'),
    saplings: breakRest * rules.saplingsPerRestMinute * boost(state, rules, 'saplings') };
  const perSession = { wood: focusMinutes * rules.woodPerFocusMinute * boost(state, rules, 'wood'),
    stone: focusMinutes * rules.stonePerFocusMinute * boost(state, rules, 'stone'),
    planks: count(state, 'sawmill') ? focusMinutes * rules.planksPerFocusMinute * boost(state, rules, 'planks') : 0 };
  // If one kind is already affordable, the next choice needs something of another kind.
  let ready = null;
  for (const bp of blueprints) {
    if (bp.kind !== 'wonder' && !ready && available(bp, state, rules, blueprints) &&
      canAfford(R.priceOf(bp, state, rules), state) && placeFor(bp, state, rules) !== null) ready = bp;
  }
  let best = null;
  for (const bp of blueprints) {
    if (bp.kind === 'wonder' || !available(bp, state, rules, blueprints)) continue;
    if (ready && bp.kind === ready.kind) continue;
    const price = R.priceOf(bp, state, rules);
    let breaks = 0, sessions = 0, impossible = false;
    for (const r of Object.keys(price)) {
      const short = price[r] - (state.onHand[r] || 0);
      if (short <= EPSILON) continue;
      if (perBreak[r]) breaks = Math.max(breaks, Math.ceil(short / perBreak[r]));
      else if (perSession[r]) sessions = Math.max(sessions, Math.ceil(short / perSession[r]));
      else impossible = true;
    }
    if (placeFor(bp, state, rules) === null) {
      // It needs more land first: count the land points still missing, in rest minutes.
      const points = landPointsNeeded(bp, state, rules);
      if (points === null) continue;
      breaks = Math.max(breaks, Math.ceil((points * rules.restMinutesPerLand - state.landProgress) / Math.max(1, breakRest)));
    }
    if (impossible || (!breaks && !sessions)) continue;
    if (!best || breaks + sessions < best.breaks + best.sessions) best = { bp, breaks, sessions };
  }
  const lines = [];
  if (best) {
    const parts = [];
    if (best.breaks) parts.push(plural(best.breaks, 'more break'));
    if (best.sessions) parts.push(plural(best.sessions, 'more focus session'));
    lines.push(ready ? `Next choice: ${ready.name} or ${best.bp.name}, about ${parts.join(' and ')} away.`
      : `Next up: ${best.bp.name}, about ${parts.join(' and ')} away.`);
  }
  const wonder = nextWonder(state, blueprints);
  if (wonder && state.onHand.starlight >= 1) {
    lines.push(`${wonder.name}: ${Math.floor(state.onHand.starlight + EPSILON)} of ${R.priceOf(wonder, state, rules).starlight} Starlight.`);
  }
  return lines.length ? lines.join(' ') : null;
}

// ---------------------------------------------------------------------------------------------
// The waiting check-in.

function countActiveDays(facts) {
  const days = new Map();
  for (const { payload } of facts.grants) {
    if (!payload || !payload.dayKey) continue;
    let bits = days.get(payload.dayKey) || 0;
    if (payload.source === 'focus' && Object.values(payload.amounts || {}).some(n => n > 0)) bits |= 1;
    if (payload.source === 'rest' && payload.restMinutes > 0) bits |= 2;
    days.set(payload.dayKey, bits);
  }
  let active = 0;
  for (const bits of days.values()) if (bits === 3) active += 1;
  return active;
}

// Everything granted after `covered`, leaving out focus grants for the sessions in `skip`.
function waitingSince(facts, covered, skip = null) {
  const collected = empty();
  let restMinutes = 0, restSince = false;
  for (let i = facts.grants.length - 1; i >= 0 && facts.grants[i].sequence > covered; i--) {
    const p = facts.grants[i].payload;
    if (skip && p.source === 'focus' && skip.has(p.sourceID)) continue;
    addInto(collected, p.amounts);
    restMinutes += p.restMinutes || 0;
    if (p.source === 'rest' && p.restMinutes > 0) restSince = true;
  }
  return { collected: rounded(collected), restMinutes: round2(restMinutes), restSince };
}

function makeHelper(state, queued, how, via) {
  const index = state.helpersMade + queued.length, names = R.HELPER_NAMES;
  const name = names[index % names.length] + (index >= names.length ? ' ' + (Math.floor(index / names.length) + 1) : '');
  const id = `h${index + 1}`;
  return { id, name, how: how || pickOne(`${state.startedID}:helper:${id}:way`, R.ARRIVAL_WAYS), via };
}

function firstTime(state, draft, key, text) {
  if (state.firsts[key] || draft.firsts.includes(key)) return;
  draft.firsts.push(key);
  draft.moments.push(text);
}

// A fancy bridge from a surprise, or null when none fits: a new link between an open pair, or else a
// rope bridge that changes type. Fancy bridges stay fewer than the islands other than home.
// Returns { link: { id, from, to, type, land } } or { upgrade: { link, type } }, plus its text.
function fancyBridge(work, draft, rules, key) {
  const fancy = work.links.filter(l => l.type !== 'rope').length;
  if (fancy >= work.islands.length - 1) return null;
  const name = id => islandById(work, id).name;
  // The type by roll. A water slide needs the two islands' lifts far enough apart to run downhill.
  const typeFor = (a, b) => {
    const drop = Math.abs(islandById(work, a).lift - islandById(work, b).lift);
    const types = Object.keys(R.BRIDGE_TYPES).filter(t => t !== 'slide' || drop + EPSILON >= rules.slideLiftGap);
    return pickWeighted(`${key}:bridge-type`, types, t => R.BRIDGE_TYPES[t].weight);
  };
  const downhill = (a, b) => (islandById(work, a).lift >= islandById(work, b).lift ? [a, b] : [b, a]);
  const open = openPairs(work);
  if (open.length) {
    const pair = pickOne(`${key}:bridge-pair`, open);
    const type = typeFor(pair.from, pair.to);
    const link = { id: `gift-${draft.number}`, from: pair.from, to: pair.to, type,
      land: { [pair.from]: islandById(work, pair.from).land, [pair.to]: islandById(work, pair.to).land } };
    const [high, low] = downhill(pair.from, pair.to);
    const between = `between ${name(pair.from)} and ${name(pair.to)}`;
    const text = {
      arch: `Overnight, a stone arch grew ${between}.`,
      slide: `A water slide now runs from ${name(high)} down to ${name(low)}.`,
      cloudsteps: `Cloud steps drifted together ${between}.`,
      flowerarch: `A flower arch bloomed ${between}.`,
      rainbow: `A rainbow came to rest ${between}, solid enough to walk on.`,
    }[type];
    return { link, text };
  }
  const ropes = work.links.filter(l => l.type === 'rope');
  if (!ropes.length) return null;
  const rope = pickOne(`${key}:bridge-rope`, ropes);
  const type = typeFor(rope.from, rope.to), look = R.BRIDGE_TYPES[type];
  return { upgrade: { link: rope.id, type },
    text: `The rope bridge to ${name(rope.to)} turned into ${look.plural ? look.name : article(look.name)}.` };
}

// Small passive surprises. Gifts are about one break's worth, so they feel nice without changing the pace.
function makeSurprise(work, draft, rules, key) {
  const seeds = R.SURPRISES[0];
  let pick = pickWeighted(`${key}:surprise-kind`, R.SURPRISES, s => s.weight);
  if (pick.id === 'lost' && (work.lostHelpers >= rules.maxLostHelpers || draft.activeDays < rules.lostHelpersAfterActiveDays)) pick = seeds;
  const island = pickOne(`${key}:surprise-island`, work.islands);
  if (pick.id === 'golden' && island.golden) pick = seeds; // at most one golden sapling per island
  const bridge = pick.id === 'bridge' ? fancyBridge(work, draft, rules, key) : null;
  if (pick.id === 'bridge' && !bridge) pick = seeds;
  const breakRest = R.restValue(10, rules), gifts = {};
  const surprise = { id: pick.id, text: '', gifts, island: island.id };
  if (bridge) {
    if (bridge.link) surprise.link = bridge.link; else surprise.upgrade = bridge.upgrade;
    surprise.text = bridge.text;
  } else if (pick.id === 'seeds') {
    gifts.saplings = round2(2 * breakRest * rules.saplingsPerRestMinute); gifts.soil = round2(breakRest * rules.soilPerRestMinute);
    surprise.text = 'A passing traveler rested here and left a pouch of seeds.';
  } else if (pick.id === 'soil') {
    gifts.soil = round2(2 * breakRest * rules.soilPerRestMinute);
    surprise.text = 'A warm breeze carried in rich soil from somewhere far below.';
  } else if (pick.id === 'stones') {
    gifts.stone = round2(60 * rules.stonePerFocusMinute);
    surprise.text = 'A magpie dropped a little pile of shiny stones by the big rock.';
  } else if (pick.id === 'fireflies') {
    surprise.text = `Fireflies gathered over ${island.name} for the evening.`;
  } else if (pick.id === 'golden') {
    gifts.saplings = round2(3 * breakRest * rules.saplingsPerRestMinute);
    surprise.golden = true;
    surprise.text = `A rare golden sapling sprouted on ${island.name}. It will stay there for good.`;
  } else {
    const helper = makeHelper(work, draft.helpersQueued, R.LOST_HELPER_WAY, 'lost');
    draft.helpersQueued.push(helper);
    surprise.helper = helper.id;
    surprise.text = `A lost helper named ${helper.name} found the island.`;
  }
  return surprise;
}

// Works out the check-in waiting now, or null. Returns the draft record (before any pick) and the
// state as it will be once collected.
//
// A check-in is ready once you're back from a break or a day has ended, and only if that brought
// something to collect or decide. Focus sessions that ended after that moment are collected too, but
// they can't make a card appear on their own, so a card never pops up at the moment focus ends.
function prepare(state, facts, env) {
  const trigger = latestTrigger(facts, state.covered);
  if (!trigger) return null;
  const late = new Set();
  for (let i = facts.focus.length - 1; i >= 0 && facts.focus[i].sequence > trigger.sequence; i--) {
    if (facts.focus[i].sessionID !== trigger.follows) late.add(facts.focus[i].sessionID);
  }
  const armed = draftCheckIn(state, facts, env, trigger, late.size ? late : null);
  if (!armed || !late.size) return armed;
  return draftCheckIn(state, facts, env, trigger, null);
}

function draftCheckIn(state, facts, env, trigger, skip) {
  const { rules, blueprints, dayKeyOf } = env;
  const number = state.checkIns + 1, key = `${state.startedID}:checkin:${number}`;
  const since = waitingSince(facts, state.covered, skip);
  const draft = {
    rulesVersion: rules.rulesVersion, number, token: null, covered: null,
    dayKey: trigger.dayKey || dayKeyOf(trigger.at), activeDays: countActiveDays(facts),
    collected: since.collected, restMinutes: since.restMinutes, landProgress: 0, newLand: [],
    surprise: null, islands: [], helpersQueued: [], helpersArrived: [],
    arrivals: [], moments: [], firsts: [], choice: null, picked: null, job: null, built: null,
  };
  const work = cloneState(state);

  // Collect, and turn rest minutes into new land points, shared between islands by appetite and age.
  // When no island can take a point, the rest minutes wait in landProgress.
  const progress = work.landProgress + draft.restMinutes;
  const land = new Map(work.islands.map(island => [island.id, island.land]));
  const given = shareLand(work.islands, land, Math.floor((progress + EPSILON) / rules.restMinutesPerLand), rules, key);
  draft.landProgress = round2(Math.max(0, progress - given * rules.restMinutesPerLand));
  draft.newLand = work.islands.filter(island => land.get(island.id) > island.land)
    .map(island => ({ island: island.id, amount: land.get(island.id) - island.land }));
  applyCollect(work, draft);

  // At most one surprise a day. After a quiet stretch of active days, the next one gets gently more likely.
  const quiet = draft.activeDays - work.activeDaysAtLastSurprise;
  const catchUp = quiet >= rules.surpriseCatchUpAfterActiveDays
    ? 1 + rules.surpriseCatchUpStep * (quiet - rules.surpriseCatchUpAfterActiveDays + 1) : 1;
  const chance = (since.restSince ? rules.surpriseChanceAfterBreak : rules.surpriseChance) * catchUp;
  if (roll(`${key}:surprise`) < chance && work.lastSurpriseDay !== draft.dayKey) {
    draft.surprise = makeSurprise(work, draft, rules, key);
    applySurprise(work, draft, rules);
  }

  // New islands arrive by active days.
  while (R.islandDueAt(rules, work.islands.length - 1 + draft.islands.length) <= draft.activeDays) {
    const index = work.islands.length + draft.islands.length; // 1 for the first new island
    const taken = [...work.islands, ...draft.islands].map(island => island.kind);
    const unused = R.NEW_ISLAND_KINDS.filter(k => !taken.includes(k));
    const kind = pickOne(`${state.startedID}:island:${index}:kind`, unused.length ? unused : R.NEW_ISLAND_KINDS);
    const size = pickWeighted(`${state.startedID}:island:${index}:size`, Object.keys(R.ISLAND_SIZES), k => R.ISLAND_SIZES[k].chance);
    const same = taken.filter(k => k === kind).length, names = R.ISLAND_KINDS[kind].names;
    const name = names[same] || names[0] + ' ' + (same + 1);
    // Its place in the sky table, lift and appetite are worked out now and saved, so they never change.
    draft.islands.push({ id: `isle-${index}`, name, kind, size, land: rules.startLand[size], ...sky.arrivalOf(state.startedID, index, rules) });
    const special = blueprints.find(bp => bp.onlyOn === kind);
    draft.arrivals.push(`${article(size)} ${R.ISLAND_KINDS[kind].label} island drifted in: ${name}.` +
      (special ? ` Only here can you build ${article(special.name)}.` : ''));
    firstTime(work, draft, 'island', 'Your first new island! A bridge of mist hangs between it and home until you build a real one.');
  }
  applyIslands(work, draft, rules);

  // Helpers arrive by active days, and move in when there's a free bed.
  if (R.helperDueAt(rules, work.helpersScheduled) <= draft.activeDays) {
    draft.helpersQueued.push(makeHelper(work, draft.helpersQueued, null, 'schedule'));
  }
  const queue = [...work.queue, ...draft.helpersQueued];
  if (queue.length && beds(work, rules) > work.helpers.length) {
    const newcomer = queue[0];
    draft.helpersArrived.push({ id: newcomer.id, name: newcomer.name, how: newcomer.how, island: 'home' });
    draft.arrivals.push(`${newcomer.name} ${newcomer.how}.`);
    firstTime(work, draft, 'newHelper', `${newcomer.name} is the first new helper to find the island.`);
  }
  for (const helper of draft.helpersQueued) {
    if (draft.helpersArrived.some(h => h.id === helper.id)) continue;
    draft.arrivals.push(`${helper.name} would like to move in, but every bed is taken. A new house or room would give them a home.`);
  }
  applyHelpers(work, draft);

  // At most one choice. A helper without a job comes first.
  const idle = work.helpers.find(h => !h.job);
  if (idle) {
    draft.choice = { kind: 'job', helper: idle.id, options: rankJobs(work, rules, blueprints).slice(0, 3) };
  } else {
    const offer = makeOffer(work, rules, blueprints, key);
    if (offer) {
      draft.choice = { kind: 'build', options: offer.map(o => ({ blueprint: o.bp.id, island: o.island, price: o.price,
        ...(o.link ? { link: o.link } : {}) })) };
    }
  }

  const something = R.RESOURCES.some(r => draft.collected[r] >= 0.01) || draft.newLand.length || draft.islands.length ||
    draft.helpersQueued.length || draft.helpersArrived.length || draft.surprise || draft.choice;
  if (!something) return null;
  draft.token = fingerprint(JSON.stringify([number, draft.collected, draft.newLand, draft.surprise && [draft.surprise.id, draft.surprise.island],
    draft.islands.map(i => i.id), draft.helpersQueued.map(h => h.id), draft.helpersArrived.map(h => h.id), draft.choice]));
  return { draft, work };
}

// Applies the player's pick to a prepared check-in. Throws a plain-language Error if it doesn't fit.
function pick(prepared, choiceID, env) {
  const { rules, blueprints } = env;
  const { draft, work } = prepared;
  if (choiceID === null || choiceID === undefined) return prepared;
  const choice = draft.choice;
  if (!choice) throw new Error('There is nothing to choose on this check-in. You can just collect.');
  if (choice.kind === 'job') {
    if (!choice.options.includes(choiceID)) throw new Error("That job isn't one of the choices on this card.");
    const helper = work.helpers.find(h => h.id === choice.helper);
    draft.job = { helper: helper.id, job: choiceID, island: islandForJob(work, choiceID, blueprints) };
    firstTime(work, draft, 'job', `${helper.name} picked up a first job. The island is waking up.`);
    draft.moments.push(`${helper.name} is now ${R.JOBS[choiceID].doing}.`);
    applyJob(work, draft.job);
  } else {
    const option = choice.options.find(o => o.blueprint === choiceID);
    if (!option) throw new Error("That building isn't one of the choices on this card.");
    const bp = blueprints.find(b => b.id === choiceID);
    const island = option.island ? islandById(work, option.island) : null;
    // A bridge joins the two islands its option named, with each one's land now, so the layout can
    // place its feet at the right point in the replay.
    let link = null;
    if (bp.linkType) {
      const { from, to } = option.link;
      link = { from, to, type: bp.linkType, land: { [from]: islandById(work, from).land, [to]: islandById(work, to).land } };
    }
    draft.built = { id: `b${work.buildingsMade + 1}`, blueprint: bp.id, name: bp.name, kind: bp.kind,
      island: island ? island.id : null, price: option.price, landWhenBuilt: island ? island.land : null, link };
    firstTime(work, draft, 'building', `The first building on the island: ${article(bp.name)}.`);
    if (bp.id === 'sawmill') firstTime(work, draft, 'sawmill', 'The Sawmill blade turns for the first time. Focus makes planks from now on.');
    if (bp.kind === 'wonder') {
      firstTime(work, draft, 'wonder', 'Your first Starlight wonder!');
      draft.moments.push(bp.moment);
    }
    if (bp.onlyOn) draft.moments.push(`The ${bp.name} is the first of its kind on ${island.name}.`);
    applyBuild(work, draft.built, draft.number, rules, blueprints);
  }
  draft.picked = choiceID;
  for (const key of draft.firsts) work.firsts[key] = draft.number;
  return prepared;
}

// ---------------------------------------------------------------------------------------------
// What the page sees.

// A build option's line. A bridge names both islands it joins.
function optionDoes(option, bp, state) {
  if (!option.link) return bp.does;
  const name = id => (islandById(state, id) || { name: id }).name;
  return `A rope bridge from ${name(option.link.from)} to ${name(option.link.to)}.`;
}
function viewChoice(choice, state, blueprints) {
  if (!choice) return null;
  if (choice.kind === 'job') {
    const helper = state.helpers.find(h => h.id === choice.helper);
    return { kind: 'job', helper: choice.helper, helperName: helper ? helper.name : '',
      options: choice.options.map(job => ({ job, name: R.JOBS[job].name, doing: R.JOBS[job].doing })) };
  }
  return { kind: 'build', options: choice.options.map(o => {
    const bp = blueprints.find(b => b.id === o.blueprint);
    return { blueprint: o.blueprint, name: bp.name, kind: bp.kind, does: optionDoes(o, bp, state), price: { ...o.price }, island: o.island };
  }) };
}

function viewState(state, facts, prepared, env) {
  const { rules, blueprints, typical } = env;
  const since = prepared ? null : waitingSince(facts, state.covered);
  const waiting = prepared ? { ...prepared.draft.collected } : since.collected;
  // "Next up" looks ahead as if the waiting rewards were already collected.
  let ahead = prepared ? prepared.work : null;
  if (!ahead) {
    ahead = cloneState(state);
    addInto(ahead.onHand, waiting);
    ahead.landProgress += since.restMinutes;
  }
  let checkIn = null;
  if (prepared) {
    const { draft, work } = prepared;
    checkIn = { number: draft.number, token: draft.token, collected: { ...draft.collected },
      newLand: draft.newLand.map(n => ({ ...n })), arrivals: draft.arrivals.slice(), moments: draft.moments.slice(),
      surprise: draft.surprise ? draft.surprise.text : null,
      nextUp: draft.choice ? null : teaser(work, rules, blueprints, typical),
      choice: viewChoice(draft.choice, work, blueprints) };
  }
  const last = state.last;
  return {
    rulesVersion: rules.rulesVersion,
    change: facts.newestGameSequence,
    onHand: rounded(state.onHand),
    waiting: rounded(waiting),
    islands: state.islands.map(island => ({ id: island.id, name: island.name, kind: island.kind, size: island.size,
      land: island.land, golden: island.golden, ring: island.ring, angle: island.angle, lift: island.lift,
      buildings: island.buildings.map(b => ({ ...b })) })),
    links: state.links.map(link => ({ ...link, land: { ...link.land } })),
    helpers: state.helpers.map(h => ({ id: h.id, name: h.name, job: h.job, island: h.island })),
    wonders: state.wonders.slice(),
    checkIn,
    nextUp: teaser(ahead, rules, blueprints, typical),
    activeDays: countActiveDays(facts),
    checkIns: state.checkIns,
    lastCheckIn: last ? { number: last.number, moments: (last.moments || []).slice(),
      built: last.built ? { id: last.built.id, blueprint: last.built.blueprint, name: last.built.name, island: last.built.island } : null,
      job: last.job ? { helper: last.job.helper, job: last.job.job } : null } : null,
  };
}

module.exports = {
  empty, round2, initialState, fold, applyRecord, prepare, pick, viewState, teaser, countActiveDays,
  count, beds, boost, available, placeFor, canAfford, rankJobs, makeOffer, nextWonder, openJobs,
  roomOn, homesFit, shareLand, landPointsNeeded, openPairs, ropeTarget, fancyBridge,
};
