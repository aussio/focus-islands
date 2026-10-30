'use strict';
// The game state is the saved check-ins added up, plus the next check-in worked out from grants
// since the last one. Each step of a check-in is decided once (in `prepare` and `pick`), written
// into the check-in record, and then applied by the same `apply*` functions that replay saved
// records. So a saved check-in always replays exactly as it was shown, whatever the rules say now.

const R = require('./rules');
const { roll, pickOne, fingerprint } = require('./dice');
const { latestTrigger } = require('./history');

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

function initialState(started, rules) {
  const p = started.payload || {};
  const home = R.ISLAND_SIZES.medium;
  return {
    startedID: started.id,
    covered: started.sequence ?? 0,
    onHand: { ...empty(), soil: p.startingSoil ?? rules.startingSoil, saplings: p.startingSaplings ?? rules.startingSaplings },
    landProgress: 0,
    islands: [{ id: 'home', name: R.ISLAND_KINDS.home.names[0], kind: 'home', size: 'medium', land: p.startingLand ?? rules.startingSpots,
      weight: home.weight, golden: false, buildings: [], counts: {} }],
    links: [],
    helpers: [{ id: 'h1', name: R.HELPER_NAMES[0], job: null, island: 'home', how: R.FIRST_HELPER_WAY }],
    queue: [],
    helpersMade: 1, helpersScheduled: 0, lostHelpers: 0,
    counts: {}, buildingsMade: 0, wonders: [], firsts: {},
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
function applySurprise(state, p) {
  const s = p.surprise;
  if (!s) return;
  addInto(state.onHand, s.gifts);
  if (s.golden) islandById(state, s.island).golden = true;
  state.lastSurpriseDay = p.dayKey;
  state.activeDaysAtLastSurprise = p.activeDays;
}
function applyIslands(state, p) {
  for (const island of p.islands || []) {
    state.islands.push({ id: island.id, name: island.name, kind: island.kind, size: island.size, land: island.land,
      weight: R.ISLAND_SIZES[island.size].weight, golden: false, buildings: [], counts: {} });
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
function applyBuild(state, built, number) {
  if (!built) return;
  addInto(state.onHand, built.price, -1);
  state.counts[built.blueprint] = (state.counts[built.blueprint] || 0) + 1;
  state.buildingsMade += 1;
  if (built.island) {
    const island = islandById(state, built.island);
    island.buildings.push({ id: built.id, blueprint: built.blueprint, name: built.name, landWhenBuilt: built.landWhenBuilt, checkIn: number });
    island.counts[built.blueprint] = (island.counts[built.blueprint] || 0) + 1;
  }
  if (built.link) state.links.push({ id: built.id, from: built.link.from, to: built.link.to });
  if (built.kind === 'wonder') state.wonders.push(built.blueprint);
}
function applyRecord(state, p, sequence) {
  applyCollect(state, p);
  applySurprise(state, p);
  applyIslands(state, p);
  applyHelpers(state, p);
  applyJob(state, p.job);
  applyBuild(state, p.built, p.number);
  for (const key of p.firsts || []) state.firsts[key] = p.number;
  state.checkIns = p.number;
  state.covered = p.covered ?? sequence;
  state.last = p;
}

function fold(facts, rules) {
  const state = initialState({ ...facts.started, sequence: facts.startedSequence }, rules);
  for (const record of facts.checkIns) applyRecord(state, record.payload, record.sequence);
  return state;
}

function cloneState(state) {
  const { last, ...rest } = state;
  return { ...structuredClone(rest), last };
}

// ---------------------------------------------------------------------------------------------
// Small rule helpers (ported from the prototype).

function count(state, id) { return state.counts[id] || 0; }
function beds(state, rules) { return rules.startingBeds + rules.bedsPerCottage * count(state, 'cottage'); }
function free(island) { return island.land - island.buildings.length; }
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
  if (bp.perExtraIsland && count(state, bp.id) >= state.islands.length - 1) return false;
  if (bp.beds && beds(state, rules) - state.helpers.length >= rules.bedsPerCottage && !state.queue.length) return false;
  return true;
}
// Where it would go: an island index, -1 for things that need no spot, or null if there is no room.
function placeFor(bp, state, rules) {
  if (bp.noSpot) return -1;
  let best = null;
  state.islands.forEach((island, i) => {
    if (free(island) <= 0) return;
    if (bp.onlyOn && (island.kind !== bp.onlyOn || island.counts[bp.id])) return;
    // A repeatable item may fill at most a set share of an island (never less than its small base cap).
    if (bp.perIsland && (island.counts[bp.id] || 0) >= Math.max(bp.perIsland, Math.floor(island.buildings.length * rules.maxShareOfIsland))) return;
    if (best === null || free(island) >= free(state.islands[best])) best = i;
  });
  return best;
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

// An offer of 2 or 3 blueprints, one per kind. A wonder may be offered on its own.
function makeOffer(state, rules, blueprints, key) {
  const byKind = {};
  for (const bp of blueprints) {
    if (!available(bp, state, rules, blueprints)) continue;
    const price = R.priceOf(bp, state, rules);
    if (!canAfford(price, state)) continue;
    const where = placeFor(bp, state, rules);
    if (where === null) continue;
    const option = { bp, price, island: where >= 0 ? state.islands[where].id : null, order: roll(`${key}:offer:${bp.id}`) };
    const current = byKind[bp.kind];
    const better = !current || count(state, bp.id) < count(state, current.bp.id) ||
      (count(state, bp.id) === count(state, current.bp.id) && option.order < current.order);
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
      breaks = Math.max(breaks, Math.ceil((rules.restMinutesPerNewSpot - state.landProgress) / Math.max(1, breakRest)));
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

// Small passive surprises. Gifts are about one break's worth, so they feel nice without changing the pace.
function makeSurprise(work, draft, rules, key) {
  const total = R.SURPRISES.reduce((t, s) => t + s.weight, 0);
  let left = roll(`${key}:surprise-kind`) * total, pick = R.SURPRISES[0];
  for (const s of R.SURPRISES) { left -= s.weight; if (left < 0) { pick = s; break; } }
  if (pick.id === 'lost' && (work.lostHelpers >= rules.maxLostHelpers || draft.activeDays < rules.lostHelpersAfterActiveDays)) pick = R.SURPRISES[0];
  const island = pickOne(`${key}:surprise-island`, work.islands);
  if (pick.id === 'golden' && island.golden) pick = R.SURPRISES[0]; // at most one golden sapling per island
  const breakRest = R.restValue(10, rules), gifts = {};
  const surprise = { id: pick.id, text: '', gifts, island: island.id };
  if (pick.id === 'seeds') {
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

  // Collect, and turn rest minutes into new land on the island with the least room for its size.
  let progress = work.landProgress + draft.restMinutes;
  const land = new Map(work.islands.map(island => [island.id, island.land])), grown = new Map();
  while (progress >= rules.restMinutesPerNewSpot - EPSILON) {
    progress -= rules.restMinutesPerNewSpot;
    const target = work.islands.slice().sort((a, b) => land.get(a.id) / a.weight - land.get(b.id) / b.weight)[0];
    land.set(target.id, land.get(target.id) + 1);
    grown.set(target.id, (grown.get(target.id) || 0) + 1);
  }
  draft.landProgress = round2(Math.max(0, progress));
  draft.newLand = work.islands.filter(island => grown.has(island.id)).map(island => ({ island: island.id, amount: grown.get(island.id) }));
  applyCollect(work, draft);

  // At most one surprise a day. After a quiet stretch of active days, the next one gets gently more likely.
  const quiet = draft.activeDays - work.activeDaysAtLastSurprise;
  const catchUp = quiet >= rules.surpriseCatchUpAfterActiveDays
    ? 1 + rules.surpriseCatchUpStep * (quiet - rules.surpriseCatchUpAfterActiveDays + 1) : 1;
  const chance = (since.restSince ? rules.surpriseChanceAfterBreak : rules.surpriseChance) * catchUp;
  if (roll(`${key}:surprise`) < chance && work.lastSurpriseDay !== draft.dayKey) {
    draft.surprise = makeSurprise(work, draft, rules, key);
    applySurprise(work, draft);
  }

  // New islands arrive by active days.
  while (R.islandDueAt(rules, work.islands.length - 1 + draft.islands.length) <= draft.activeDays) {
    const index = work.islands.length + draft.islands.length; // 1 for the first new island
    const taken = [...work.islands, ...draft.islands].map(island => island.kind);
    const unused = R.NEW_ISLAND_KINDS.filter(k => !taken.includes(k));
    const kind = pickOne(`${state.startedID}:island:${index}:kind`, unused.length ? unused : R.NEW_ISLAND_KINDS);
    const sizeRoll = roll(`${state.startedID}:island:${index}:size`);
    const size = sizeRoll < 0.35 ? 'small' : sizeRoll < 0.75 ? 'medium' : 'large';
    const same = taken.filter(k => k === kind).length, names = R.ISLAND_KINDS[kind].names;
    const name = names[same] || names[0] + ' ' + (same + 1);
    draft.islands.push({ id: `isle-${index}`, name, kind, size, land: R.ISLAND_SIZES[size].startLand });
    const special = blueprints.find(bp => bp.onlyOn === kind);
    draft.arrivals.push(`${article(size)} ${R.ISLAND_KINDS[kind].label} island drifted in: ${name}.` +
      (special ? ` Only here can you build ${article(special.name)}.` : ''));
    firstTime(work, draft, 'island', 'Your first new island! A bridge of mist hangs between it and home until you build a real one.');
  }
  applyIslands(work, draft);

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
    draft.arrivals.push(`${helper.name} would like to move in, but every bed is taken. A Cottage would give them a home.`);
  }
  applyHelpers(work, draft);

  // At most one choice. A helper without a job comes first.
  const idle = work.helpers.find(h => !h.job);
  if (idle) {
    draft.choice = { kind: 'job', helper: idle.id, options: rankJobs(work, rules, blueprints).slice(0, 3) };
  } else {
    const offer = makeOffer(work, rules, blueprints, key);
    if (offer) draft.choice = { kind: 'build', options: offer.map(o => ({ blueprint: o.bp.id, island: o.island, price: o.price })) };
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
    let link = null;
    if (bp.noSpot) {
      const k = count(work, bp.id); // the k-th bridge joins the (k+1)-th new island to the one before it
      link = { from: work.islands[k].id, to: work.islands[k + 1].id };
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
    applyBuild(work, draft.built, draft.number);
  }
  draft.picked = choiceID;
  for (const key of draft.firsts) work.firsts[key] = draft.number;
  return prepared;
}

// ---------------------------------------------------------------------------------------------
// What the page sees.

function viewChoice(choice, state, blueprints) {
  if (!choice) return null;
  if (choice.kind === 'job') {
    const helper = state.helpers.find(h => h.id === choice.helper);
    return { kind: 'job', helper: choice.helper, helperName: helper ? helper.name : '',
      options: choice.options.map(job => ({ job, name: R.JOBS[job].name, doing: R.JOBS[job].doing })) };
  }
  return { kind: 'build', options: choice.options.map(o => {
    const bp = blueprints.find(b => b.id === o.blueprint);
    return { blueprint: o.blueprint, name: bp.name, kind: bp.kind, does: bp.does, price: { ...o.price }, island: o.island };
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
      land: island.land, golden: island.golden, buildings: island.buildings.map(b => ({ ...b })) })),
    links: state.links.map(link => ({ ...link })),
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
};
