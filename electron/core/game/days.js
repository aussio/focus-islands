'use strict';
// What happened on each day, for the History page: what the day's focus and breaks earned, how its
// sessions went against the plan, and what its check-ins brought to the island. It only adds up saved
// grants and check-ins, so it never changes the game, and the same events always give the same days.

const R = require('./rules');
const version1 = require('./version1');
const { focusCouldEarn } = require('./grants');

const round2 = x => Math.round(x * 100) / 100;
function zero() { return Object.fromEntries(R.RESOURCES.map(r => [r, 0])); }
function addInto(target, amounts) {
  for (const r of R.RESOURCES) if (amounts && typeof amounts[r] === 'number') target[r] += amounts[r];
}

// How a finished day's plan match compares with the Starlight lines: 'on', 'near', or 'off'.
function planFitOf(match, rules) {
  if (typeof match !== 'number') return null;
  return match >= rules.onPlanDayThreshold ? 'on' : match >= rules.nearPlanDayThreshold ? 'near' : 'off';
}

// One summary for each of `dayKeys` ('YYYY-MM-DD'), in the same order:
// - earned: what the day's focus, breaks and plan earned, plus that day's surprise gifts. Counted when
//   earned, so a card still waiting is included; spending isn't taken off.
// - focusSessions, onPlanSessions: finished focus sessions that day, and those close to their planned
//   length (the kind that can earn Starlight). realBreaks: breaks long enough to grow things.
// - plannedSessions: focus sessions in the day's saved plan, or null without one.
// - planMatch (0 to 1) and planFit: how closely the whole day matched its plan, saved once the day ended.
//   Null before then, and for a day without a plan.
// - checkIns, and happenings: what the day's check-ins did, in order, with names filled in:
//   { kind: 'built', name, island, between } · { kind: 'job', helper, job } · { kind: 'arrived', helper }
//   · { kind: 'island', name, label } · { kind: 'surprise', text } · { kind: 'grew', island, amount }
//   (one 'grew' for each island that got new land that day, at the end).
//
// state: the game state from fold() (for names). facts: from scan().
// env: { rules, blueprints, dayKeyOf, planFor(dayKey) => { focusSessions, ... } | null }.
function summarizeDays(state, facts, dayKeys, env) {
  const { rules, blueprints, dayKeyOf } = env;
  const days = new Map();
  for (const dayKey of dayKeys) {
    const plan = env.planFor ? env.planFor(dayKey) : null;
    days.set(dayKey, { dayKey, earned: zero(), focusSessions: 0, onPlanSessions: 0, realBreaks: 0,
      plannedSessions: plan && plan.focusSessions > 0 ? plan.focusSessions : null,
      planMatch: null, planFit: null, checkIns: 0, happenings: [], grew: new Map() });
  }
  // A focus session belongs to the day saved in its grant, like the grants themselves.
  for (const f of facts.focus) {
    const day = days.get((facts.grantDays && facts.grantDays.get(`focus:${f.sessionID}`)) || dayKeyOf(f.at));
    if (!day) continue;
    day.focusSessions += 1;
    if (focusCouldEarn(f, rules)) day.onPlanSessions += 1;
  }
  for (const { payload } of facts.grants) {
    const day = days.get(payload.dayKey);
    if (!day) continue;
    addInto(day.earned, payload.amounts);
    if (payload.source === 'rest' && payload.restMinutes > 0) day.realBreaks += 1;
    if (payload.source === 'day' && typeof payload.planMatch === 'number') {
      day.planMatch = payload.planMatch;
      day.planFit = planFitOf(payload.planMatch, rules);
    }
  }
  const islandName = id => (state.islands.find(island => island.id === id) || {}).name || null;
  const helperName = id => (state.helpers.find(helper => helper.id === id) || {}).name || null;
  for (const record of facts.checkIns) {
    const day = days.get(record.payload.dayKey);
    if (!day) continue;
    // Older records read the version-2 way. Only names and amounts are used here, so the final state will do.
    const p = version1.checkInPayload(record.payload, { blueprints, rules, state });
    day.checkIns += 1;
    if (p.surprise) addInto(day.earned, p.surprise.gifts);
    for (const island of p.islands || []) {
      day.happenings.push({ kind: 'island', name: island.name, label: (R.ISLAND_KINDS[island.kind] || {}).label || null });
    }
    for (const helper of p.helpersArrived || []) day.happenings.push({ kind: 'arrived', helper: helper.name });
    if (p.surprise && p.surprise.text) day.happenings.push({ kind: 'surprise', text: p.surprise.text });
    if (p.job) day.happenings.push({ kind: 'job', helper: helperName(p.job.helper), job: (R.JOBS[p.job.job] || {}).name || p.job.job });
    if (p.built) {
      const link = p.built.link;
      day.happenings.push({ kind: 'built', name: p.built.name, island: p.built.island ? islandName(p.built.island) : null,
        between: link ? [islandName(link.from), islandName(link.to)] : null });
    }
    for (const grown of p.newLand || []) day.grew.set(grown.island, (day.grew.get(grown.island) || 0) + grown.amount);
  }
  return dayKeys.map(dayKey => {
    const { grew, earned, ...day } = days.get(dayKey);
    for (const island of state.islands) {
      const amount = grew.get(island.id);
      if (amount > 0) day.happenings.push({ kind: 'grew', island: island.name, amount: round2(amount) });
    }
    return { ...day, earned: Object.fromEntries(R.RESOURCES.map(r => [r, round2(earned[r])])) };
  });
}

module.exports = { summarizeDays, planFitOf };
