'use strict';
// Grants: what one finished focus session, one rest, or one whole day earned. Every source gets
// exactly one grant record, even when it earned nothing (a break too short to be real), so the
// decision is saved once and a later rules change can't reach back and grant it again.

const R = require('./rules');
const { round2, boost, count } = require('./play');

function memo(fn) {
  const seen = new Map();
  return key => {
    if (!seen.has(key)) seen.set(key, fn(key));
    return seen.get(key);
  };
}

function grantRecord(rules, now, source, sourceID, dayKey, amounts, restMinutes, extra) {
  return { kind: 'gameGranted', uniqueKey: `game:grant:${source}:${sourceID}`, occurredAt: now,
    payload: { rulesVersion: rules.rulesVersion, source, sourceID, dayKey, amounts, restMinutes, ...extra } };
}

// facts: from scan(). state: the game state from saved check-ins (helper jobs and the Sawmill
// count as they stand now, and the amounts are frozen in the grant).
function computeDueGrants(facts, state, ctx, env) {
  const { rules, dayKeyOf } = env;
  const planOf = memo(dayKey => (ctx.planFor ? ctx.planFor(dayKey) : null) || null);
  const dayOf = memo(dayKeyOf);
  // A source that already has a grant keeps the day saved in it. Only new sources use today's clock.
  const savedDay = (source, id, at) => (facts.grantDays && facts.grantDays.get(`${source}:${id}`)) || dayOf(at);
  // Only a session that could earn Starlight by itself (on plan, not a snooze) takes one of the day's
  // planned places. A focus that started by itself and was stopped at once takes none.
  const couldEarn = f => f.reason !== 'snooze'
    && R.focusOnPlan({ kind: 'focus', elapsedSeconds: f.elapsedSeconds, targetSeconds: f.plannedSeconds }, rules);
  const { focus, breaks } = facts;
  const focusByID = new Map(), focusByDay = new Map(), placesByDay = new Map();
  for (const f of focus) {
    f.dayKey = savedDay('focus', f.sessionID, f.at);
    const list = focusByDay.get(f.dayKey) || [];
    list.push(f);
    focusByDay.set(f.dayKey, list);
    focusByID.set(f.sessionID, f);
    if (couldEarn(f)) {
      f.place = placesByDay.get(f.dayKey) || 0; // for "only the planned number of sessions"
      placesByDay.set(f.dayKey, f.place + 1);
    } else f.place = null;
  }
  // The first break of any kind after each focus session, on the same day, decides its Starlight.
  // A real break earns it. A break too short to be real loses it. No break at all leaves it to the day grant.
  const firstBreak = new Map(), restsByDay = new Map();
  for (const b of breaks) {
    b.dayKey = savedDay('rest', b.key, b.at);
    const f = focusByID.get(b.follows);
    if (f && f.dayKey === b.dayKey && !firstBreak.has(f.sessionID)) firstBreak.set(f.sessionID, b.key);
    if (b.rest) {
      const list = restsByDay.get(b.dayKey) || [];
      list.push(b);
      restsByDay.set(b.dayKey, list);
    }
  }
  // A real break is judged against the day plan's usual break, like the timer does, so a long
  // break ended after 20 minutes still counts.
  const usualBreakSeconds = dayKey => {
    const plan = planOf(dayKey);
    return ((plan && Number(plan.breakMinutes)) || rules.breakMinutesWithoutPlan || 10) * 60;
  };
  const restSession = b => ({ kind: 'break', elapsedSeconds: b.elapsedSeconds, targetSeconds: usualBreakSeconds(b.dayKey) });
  const real = b => R.isRealBreak(restSession(b), rules);
  const earnsStarlight = f => {
    if (f.place === null) return false;
    const plan = planOf(f.dayKey);
    return Boolean(plan && plan.focusSessions > 0 && f.place < plan.focusSessions);
  };

  const out = [], keys = facts.keys;
  const add = record => { if (!keys.has(record.uniqueKey)) { keys.add(record.uniqueKey); out.push(record); } };
  const sources = [...focus.map(f => ({ sequence: f.sequence, f })), ...breaks.filter(b => b.rest).map(b => ({ sequence: b.sequence, b }))]
    .sort((x, y) => x.sequence - y.sequence);
  for (const { f, b } of sources) {
    if (f) {
      if (keys.has(`game:grant:focus:${f.sessionID}`)) continue;
      const minutes = Math.min(f.elapsedSeconds / 60, rules.focusMinutesCountedPerSession);
      const amounts = { wood: round2(minutes * rules.woodPerFocusMinute * boost(state, rules, 'wood')),
        stone: round2(minutes * rules.stonePerFocusMinute * boost(state, rules, 'stone')) };
      if (count(state, 'sawmill') > 0) amounts.planks = round2(minutes * rules.planksPerFocusMinute * boost(state, rules, 'planks'));
      add(grantRecord(rules, env.now, 'focus', f.sessionID, f.dayKey, amounts, 0));
    } else {
      if (keys.has(`game:grant:rest:${b.key}`)) continue;
      const amounts = {};
      let restMinutes = 0;
      if (real(b)) {
        const rest = R.restValue(b.elapsedSeconds / 60, rules);
        amounts.soil = round2(rest * rules.soilPerRestMinute * boost(state, rules, 'soil'));
        amounts.saplings = round2(rest * rules.saplingsPerRestMinute * boost(state, rules, 'saplings'));
        restMinutes = round2(rest);
        const f = focusByID.get(b.follows);
        if (f && firstBreak.get(f.sessionID) === b.key && earnsStarlight(f)) amounts.starlight = rules.starlightPerOnPlanSession;
      }
      add(grantRecord(rules, env.now, 'rest', b.key, b.dayKey, amounts, restMinutes));
    }
  }

  // Day grants: due once the day has ended (a dayEnded record, or today is a later day), only for days with game activity.
  const ended = new Set(facts.dayEnds.map(d => d.dayKey));
  const days = [...new Set([...focusByDay.keys(), ...restsByDay.keys()])].sort();
  for (const dayKey of days) {
    if (keys.has(`game:grant:day:${dayKey}`)) continue;
    if (!ended.has(dayKey) && !(ctx.todayKey && ctx.todayKey > dayKey)) continue;
    const dayFocus = focusByDay.get(dayKey) || [], dayRests = restsByDay.get(dayKey) || [];
    let starlight = 0;
    const lastFocus = dayFocus[dayFocus.length - 1];
    if (lastFocus && !firstBreak.has(lastFocus.sessionID) && earnsStarlight(lastFocus)) starlight += rules.starlightPerOnPlanSession;
    const plan = planOf(dayKey);
    const match = plan && plan.focusSessions > 0 ? R.dayPlanMatch({
      plan: { sessions: plan.focusSessions, focusMinutes: plan.focusMinutes },
      sessions: [...dayFocus.map(f => ({ kind: 'focus', elapsedSeconds: f.elapsedSeconds, targetSeconds: f.plannedSeconds })),
        ...dayRests.map(restSession)],
    }, rules) : null;
    if (match !== null && match >= rules.onPlanDayThreshold) starlight += rules.starlightPerOnPlanDay;
    else if (match !== null && match >= rules.nearPlanDayThreshold) starlight += rules.starlightPerNearPlanDay;
    add(grantRecord(rules, env.now, 'day', dayKey, dayKey, starlight ? { starlight } : {}, 0,
      { planMatch: match === null ? null : round2(match) }));
  }
  return out;
}

module.exports = { computeDueGrants };
