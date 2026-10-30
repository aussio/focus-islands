'use strict';
// Made-up days for pacing tests and gallery states. Ported from the pacing prototype's MadeUpDays:
// the same person + day + seed always gives the same day. `eventsForDay` turns a made-up day into
// records shaped like the app's saved events.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SEED = 20261029;
const FIRST_DAY = Date.UTC(2026, 0, 5); // a Monday, so day 1 is a Monday like in the prototype

function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weekday(d) { return WEEKDAYS[(d - 1) % 7]; }
function weekend(d) { return (d - 1) % 7 >= 5; }
function focus(plannedMinutes, actualMinutes) { return { kind: 'focus', targetSeconds: plannedMinutes * 60, elapsedSeconds: Math.round(actualMinutes * 60) }; }
function rest(plannedMinutes, actualMinutes) { return { kind: 'break', targetSeconds: plannedMinutes * 60, elapsedSeconds: Math.round(actualMinutes * 60) }; }
function off(d, label) { return { day: d, weekday: weekday(d), label, plan: null, sessions: [] }; }

// Follows the plan closely: 60-minute focus, 10-minute breaks (the app's defaults), weekends off.
function steadyWorkday(d, r) {
  const planned = r() < 0.2 ? 5 : 6, done = r() < 0.15 ? planned - 1 : planned, sessions = [];
  for (let i = 0; i < done; i++) {
    sessions.push(focus(60, r() < 0.08 ? 35 + r() * 15 : 56 + r() * 8));
    if (i < done - 1) {
      const x = r();
      if (x < 0.88) sessions.push(rest(10, 9 + r() * 5));
      else if (x < 0.96) sessions.push(rest(10, 2 + r() * 2));
    }
  }
  return { day: d, weekday: weekday(d), label: 'Good workday', plan: { sessions: planned, focusMinutes: 60, breakMinutes: 10 }, sessions };
}
// Plans breaks, then mostly works through them. Sessions run long.
function skippingWorkday(d, r) {
  const sessions = [];
  for (let i = 0; i < 5; i++) {
    sessions.push(focus(60, 70 + r() * 40));
    if (i < 4) {
      const x = r();
      if (x < 0.15) sessions.push(rest(10, 8 + r() * 4));
      else if (x < 0.5) sessions.push(rest(10, 1 + r() * 2));
    }
  }
  return { day: d, weekday: weekday(d), label: 'Workday, skipped breaks', plan: { sessions: 6, focusMinutes: 60, breakMinutes: 10 }, sessions };
}
// Ten-hour days: a long lunch, one other real break, the rest skipped.
function longWorkday(d, r) {
  const done = r() < 0.5 ? 9 : 10, other = 1 + Math.floor(r() * 7), sessions = [];
  for (let i = 0; i < done; i++) {
    sessions.push(focus(60, 50 + r() * 25));
    if (i === done - 1) continue;
    if (i === 4) sessions.push(rest(10, 30 + r() * 15));
    else if (i === other) sessions.push(rest(10, 10 + r() * 3));
    else if (r() < 0.4) sessions.push(rest(10, 1 + r()));
  }
  return { day: d, weekday: weekday(d), label: 'Long workday', plan: { sessions: 6, focusMinutes: 60, breakMinutes: 10 }, sessions };
}
function longSaturday(d, r) {
  const sessions = [];
  for (let i = 0; i < 4; i++) sessions.push(focus(60, 50 + r() * 20));
  return { day: d, weekday: weekday(d), label: 'Unplanned Saturday work', plan: null, sessions };
}
// No fixed rhythm: random off days, plans of different sizes, sessions that run short or long.
function irregularDay(d, r) {
  if (r() < (weekend(d) ? 0.85 : 0.3)) return off(d, weekend(d) ? 'Weekend' : 'Day off');
  const planned = 3 + Math.floor(r() * 5), focusLength = [25, 45, 60][Math.floor(r() * 3)], breakLength = [5, 10, 15][Math.floor(r() * 3)];
  const done = Math.max(1, planned - 2 + Math.floor(r() * 4)), sessions = [];
  for (let i = 0; i < done; i++) {
    sessions.push(focus(focusLength, focusLength * (0.5 + r() * 0.9)));
    if (i < done - 1) {
      const x = r();
      if (x < 0.55) sessions.push(rest(breakLength, breakLength * (0.8 + r() * 0.8)));
      else if (x < 0.8) sessions.push(rest(breakLength, 1 + r()));
    }
  }
  return { day: d, weekday: weekday(d), label: 'Irregular day', plan: { sessions: planned, focusMinutes: focusLength, breakMinutes: breakLength }, sessions };
}

const PEOPLE = [
  { id: 'steady', name: 'Steady planner',
    about: 'Plans six 60-minute focus sessions with 10-minute breaks, and mostly sticks to it. Weekends off.',
    day: (d, r) => (weekend(d) ? off(d, 'Weekend') : steadyWorkday(d, r)) },
  { id: 'skipper', name: 'Skips most breaks',
    about: 'Plans the same day as the steady planner, then works through most breaks. Focus sessions run 70 to 110 minutes. Weekends off.',
    day: (d, r) => (weekend(d) ? off(d, 'Weekend') : skippingWorkday(d, r)) },
  { id: 'long', name: 'Long days, few breaks',
    about: 'Plans a normal day but works about ten hours: a long lunch and one other real break. Often works unplanned on Saturdays.',
    day: (d, r) => {
      if ((d - 1) % 7 === 6) return off(d, 'Sunday');
      if ((d - 1) % 7 === 5) return r() < 0.5 ? longSaturday(d, r) : off(d, 'Saturday');
      return longWorkday(d, r);
    } },
  { id: 'irregular', name: 'Irregular, with off days',
    about: 'No fixed rhythm. About a third of weekdays off, plans of different sizes, sessions that end early or run over, breaks taken about half the time.',
    day: irregularDay },
  { id: 'vacation', name: 'Two-week vacation in month 2',
    about: 'Lives like the steady planner, but takes days 36 to 49 off (two full weeks).',
    day: (d, r) => (d >= 36 && d <= 49 ? off(d, 'Vacation') : weekend(d) ? off(d, 'Weekend') : steadyWorkday(d, r)) },
];

function make(personId, d, seed = SEED) {
  const person = PEOPLE.find(p => p.id === personId);
  if (!person) throw new Error(`Unknown made-up person: ${personId}`);
  return person.day(d, seeded(seed + ':' + personId + ':' + d));
}
function days(personId, count, seed = SEED) {
  const list = [];
  for (let d = 1; d <= count; d++) list.push(make(personId, d, seed));
  return list;
}

// ---------------------------------------------------------------------------------------------
// Turning made-up days into saved-event shapes. Days are UTC dates starting 2026-01-05, so
// `dayKeyOf` is simply the date part of the ISO time.

const dayKeyOf = iso => iso.slice(0, 10);
function dayKeyFor(d) { return new Date(FIRST_DAY + (d - 1) * 86400000).toISOString().slice(0, 10); }
function planFor(madeUpDay) {
  return madeUpDay.plan ? { focusSessions: madeUpDay.plan.sessions, focusMinutes: madeUpDay.plan.focusMinutes, breakMinutes: madeUpDay.plan.breakMinutes } : null;
}

// A tiny in-memory stand-in for the store: saved order, ids, and unique keys that refuse repeats.
function createHistory() {
  const events = [], keys = new Set();
  function append(kind, payload, occurredAt, uniqueKey = null, source = 'user') {
    if (uniqueKey && keys.has(uniqueKey)) throw new Error('An event with this unique key already exists.');
    if (uniqueKey) keys.add(uniqueKey);
    const sequence = events.length + 1;
    const event = { sequence, id: `EV-${String(sequence).padStart(6, '0')}`, kind, occurredAt, source,
      payload: JSON.parse(JSON.stringify(payload)), uniqueKey };
    events.push(event);
    return event;
  }
  const appendRecord = record => append(record.kind, record.payload, record.occurredAt, record.uniqueKey, 'system');
  return { events, append, appendRecord };
}

// The batches of events one made-up day produces, each as a list of [kind, payload, occurredAt].
// A batch is what the app saves in one go: a focus session, a break, or ending the day.
// fillers adds the app's 30-second progress checkpoints, which the game must skip quickly.
function batchesForDay(madeUpDay, { fillers = false } = {}) {
  const d = madeUpDay.day, base = FIRST_DAY + (d - 1) * 86400000 + 8 * 3600000;
  const batches = [];
  let clock = base, lastFocus = null, previous = null, n = 0;
  const at = () => new Date(clock).toISOString();
  for (const session of madeUpDay.sessions) {
    n += 1;
    const id = `d${d}-${session.kind === 'focus' ? 'f' : 'b'}${n}`;
    const batch = [];
    if (session.kind === 'focus') {
      batch.push(['focusStarted', { sessionID: id, targetSeconds: session.targetSeconds,
        reason: previous === 'break' ? 'afterBreak' : previous === null ? 'suggestion' : 'manual' }, at()]);
      if (fillers) for (let s = 30; s < session.elapsedSeconds; s += 30) batch.push(['focusResumed', { sessionID: id, targetSeconds: session.targetSeconds, elapsedSeconds: s }, new Date(clock + s * 1000).toISOString()]);
      clock += session.elapsedSeconds * 1000;
      batch.push(['focusEnded', { sessionID: id, targetSeconds: session.targetSeconds, elapsedSeconds: session.elapsedSeconds }, at()]);
      lastFocus = id;
    } else {
      batch.push(['breakStarted', { sessionID: id, targetSeconds: session.targetSeconds, followsSessionID: lastFocus }, at()]);
      if (fillers) for (let s = 30; s < session.elapsedSeconds; s += 30) batch.push(['breakProgress', { sessionID: id, targetSeconds: session.targetSeconds, elapsedSeconds: s }, new Date(clock + s * 1000).toISOString()]);
      clock += session.elapsedSeconds * 1000;
      const payload = { sessionID: id, targetSeconds: session.targetSeconds, elapsedSeconds: session.elapsedSeconds };
      batch.push(['breakConfirmed', payload, at()], ['breakEnded', payload, at()]);
    }
    previous = session.kind;
    clock += 60000;
    batches.push({ kind: session.kind, events: batch });
  }
  if (madeUpDay.sessions.length) batches.push({ kind: 'dayEnded', events: [['dayEnded', { dayKey: dayKeyFor(d) }, at()]] });
  return batches;
}

module.exports = { PEOPLE, SEED, make, days, weekday, seeded, dayKeyOf, dayKeyFor, planFor, createHistory, batchesForDay };
