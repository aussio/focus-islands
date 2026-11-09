// Pure forecast adapter for manually supplied development scenarios.
const { schedule } = require('../../electron/core/scheduler');

function clock(value, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Each scenario needs a date in YYYY-MM-DD format.');
  if (!/^\d{2}:\d{2}$/.test(value || '')) throw new Error(`Expected HH:mm, got ${value}`);
  const date = new Date(`${day}T${value}:00`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date or time: ${day} ${value}`);
  return date.toISOString();
}

function run(input) {
  if (!input || typeof input !== 'object') throw new Error('Scenario must be an object.');
  const onDay = value => clock(value, input.date);
  const source = input.plan || {};
  const plan = {
    day: onDay(source.start || '09:00'),
    start: onDay(source.start || '09:00'),
    end: onDay(source.end || '17:00'),
    focusMinutes: source.focusMinutes || 60,
    breakMinutes: source.breakMinutes || 10,
    meetings: (input.meetings || source.meetings || []).map(([start, end, title]) => ({ start: onDay(start), end: onDay(end), title })),
  };
  const actual = (input.history || []).map(([kind, start, end, confirmed]) => ({
    kind, start: onDay(start), end: onDay(end),
    confirmed: kind === 'break' ? Boolean(confirmed) : undefined,
    observedSeconds: (Date.parse(onDay(end)) - Date.parse(onDay(start))) / 1000,
  }));
  const timer = input.active ? {
    phase: input.active.phase, sessionID: 'active', startedAt: onDay(input.active.start),
    observedSegmentStartedAt: onDay(input.active.start), targetSeconds: input.active.targetMinutes * 60,
    elapsedSeconds: input.active.elapsedMinutes * 60, isDue: Boolean(input.active.isDue), isSleeping: false,
  } : { phase: 'idle' };
  const events = (input.decisions || []).map(([kind, at, minutes]) => ({
    kind, occurredAt: onDay(at), payload: {
      sessionID: kind === 'breakSnoozed' && input.active ? 'active' : 'completed',
      scope: kind === 'breakSnoozed' && !input.active ? 'forecast' : undefined, minutes,
    },
  }));
  return { plan, actual, blocks: schedule(plan, { actual, timer, now: onDay(input.now), events }) };
}

module.exports = { clock, run };
