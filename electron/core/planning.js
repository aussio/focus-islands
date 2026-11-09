// Replay recorded facts without changing them. Scheduling belongs to scheduler.js.
const { ms, iso, sameDay } = require('./time');
const scheduler = require('./scheduler');

function project(events, day, includeSuggestions = true) {
  const date = new Date(day), dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  let plan = null, awaySeconds = 0;
  const confirmed = new Set();
  for (const event of events) {
    if (['dayPlan', 'dayPlanRevision', 'dayPlanRevised'].includes(event.kind) && event.payload && sameDay(event.payload.day, day)) plan = event.payload;
    if (event.kind === 'breakConfirmed') confirmed.add(event.payload?.sessionID);
  }
  const starts = new Map(), actual = [];
  let firstFocusAt = Infinity;
  const focusSessions = new Map();
  function focusSegment(from, until, seconds) {
    const start = Math.max(ms(from), dayStart);
    const end = Math.min(ms(until), ms(from) + Math.max(0, seconds) * 1000, dayEnd);
    if (end > start) actual.push({ kind: 'focus', start: iso(start), end: iso(end), observedSeconds: (end - start) / 1000 });
  }
  const pairs = { breakEnded: ['breakStarted', 'break'], awayEnded: ['awayStarted', 'away'] };
  const keptPauses = keptFocusPauses(events);
  for (const event of events) {
    if (keptPauses.has(event)) continue;
    if (event.kind === 'focusStarted' && event.payload?.sessionID) {
      if (ms(event.occurredAt) >= dayStart && ms(event.occurredAt) < dayEnd) firstFocusAt = Math.min(firstFocusAt, ms(event.occurredAt));
      focusSessions.set(event.payload.sessionID, { runningFrom: event.occurredAt, elapsedAtStart: 0, paused: false });
    }
    if (['focusPaused', 'focusResumed', 'focusEnded'].includes(event.kind) && event.payload?.sessionID) {
      const focus = focusSessions.get(event.payload.sessionID);
      if (focus) {
        const elapsed = Math.max(0, Number(event.payload.elapsedSeconds) || 0);
        if (event.kind === 'focusPaused' && !focus.paused) {
          focusSegment(focus.runningFrom, event.occurredAt, elapsed - focus.elapsedAtStart);
          focus.paused = true;
        } else if (event.kind === 'focusResumed' && focus.paused) {
          focus.runningFrom = event.occurredAt;
          focus.elapsedAtStart = elapsed;
          focus.paused = false;
        } else if (event.kind === 'focusEnded') {
          if (!focus.paused) focusSegment(focus.runningFrom, event.occurredAt, elapsed - focus.elapsedAtStart);
          focusSessions.delete(event.payload.sessionID);
        }
      }
    }
    if (event.kind === 'breakStarted') starts.set(event.kind, event);
    if (event.kind === 'awayStarted') starts.set(event.kind, { ...event, duringBreak: starts.has('breakStarted') });
    if (event.kind === 'sleepStarted') starts.set(event.kind, { ...event, duringBreak: starts.has('breakStarted') });
    if (event.kind === 'sleepEnded' && starts.has('sleepStarted')) {
      const sleep = starts.get('sleepStarted'); starts.delete('sleepStarted');
      const start = Math.max(ms(sleep.occurredAt), dayStart), end = Math.min(ms(event.occurredAt), dayEnd);
      const overlapsAway = starts.has('awayStarted') || actual.some(item =>
        (item.kind === 'away' || item.inferred) && ms(item.start) < end && ms(item.end) > start);
      if (!sleep.duringBreak && !overlapsAway && start >= firstFocusAt && end > start) {
        const observedSeconds = (end - start) / 1000;
        actual.push({ kind: 'break', start: iso(start), end: iso(end),
          confirmed: false, inferred: true, observedSeconds });
        awaySeconds += observedSeconds;
      }
    }
    const pair = pairs[event.kind];
    if (!pair || !starts.has(pair[0])) continue;
    const startEvent = starts.get(pair[0]); starts.delete(pair[0]);
    const start = Math.max(ms(startEvent.occurredAt), dayStart), end = Math.min(ms(event.occurredAt), dayEnd);
    if (end <= start) continue;
    const wallSeconds = (end - start) / 1000;
    // The user said this idle time was work: the focus session ran straight through it (see keptFocusPauses),
    // so it earns no break or away time.
    if (pair[1] === 'away' && event.payload?.notBreak) continue;
    const observedSeconds = pair[1] === 'away' ? wallSeconds : Math.min(wallSeconds, Math.max(0, event.payload?.elapsedSeconds || 0));
    const inferredBreak = pair[1] === 'away' && !startEvent.duringBreak &&
      ms(startEvent.occurredAt) >= firstFocusAt && ms(startEvent.occurredAt) < dayEnd;
    const isConfirmed = pair[1] === 'break' && confirmed.has(startEvent.payload?.sessionID);
    if (!startEvent.duringBreak || pair[1] !== 'away') actual.push({ kind: inferredBreak ? 'break' : pair[1], start: iso(start), end: iso(end),
      confirmed: isConfirmed, inferred: inferredBreak, observedSeconds });
    if (pair[1] === 'away') awaySeconds += wallSeconds;
  }
  const unclosedSleep = starts.get('sleepStarted');
  if (unclosedSleep && !unclosedSleep.duringBreak && !starts.has('awayStarted')) {
    const resumed = events.find(event => event.kind === 'focusResumed' &&
      event.payload?.sessionID === unclosedSleep.payload?.sessionID &&
      ms(event.occurredAt) > ms(unclosedSleep.occurredAt));
    const start = Math.max(ms(unclosedSleep.occurredAt), dayStart);
    const end = resumed ? Math.min(ms(resumed.occurredAt), dayEnd) : start;
    if (start >= firstFocusAt && end > start && !actual.some(item => item.inferred && ms(item.start) < end && ms(item.end) > start)) {
      const observedSeconds = (end - start) / 1000;
      actual.push({ kind: 'break', start: iso(start), end: iso(end),
        confirmed: false, inferred: true, observedSeconds });
      awaySeconds += observedSeconds;
    }
  }
  actual.sort((a, b) => ms(a.start) - ms(b.start));
  return { plan, suggestions: includeSuggestions && plan ? scheduler.schedule(plan) : [], actual,
    focusSeconds: actual.filter(item => item.kind === 'focus').reduce((total, item) => total + item.observedSeconds, 0),
    breakSeconds: actual.filter(item => item.kind === 'break' && (item.confirmed || item.inferred)).reduce((total, item) => total + item.observedSeconds, 0), awaySeconds };
}

// Idle time inside a scheduled meeting is meeting time, not time away. Moves an idle start past any
// meeting (or run of back-to-back meetings) that covers it.
function idleStartAfterMeetings(meetings, idleStart) {
  let start = ms(idleStart), moved = true;
  while (moved) {
    moved = false;
    for (const meeting of meetings || []) {
      if (ms(meeting.start) <= start && start < ms(meeting.end)) { start = ms(meeting.end); moved = true; }
    }
  }
  return start;
}

// When the user says idle time during focus was work, the idle pause never happened: replay skips that
// focusPaused fact and the focusResumed that follows the user's answer, so the session stays one span.
function keptFocusPauses(events) {
  const skipped = new Set();
  let away = false, pause = null, resumeSession = null;
  for (const event of events) {
    if (event.kind === 'awayStarted') { away = true; pause = null; }
    else if (event.kind === 'focusPaused' && away && !pause) pause = event;
    else if (event.kind === 'awayEnded') {
      if (event.payload?.notBreak && pause) { skipped.add(pause); resumeSession = pause.payload?.sessionID; }
      away = false; pause = null;
    } else if (event.kind === 'focusResumed' && resumeSession && event.payload?.sessionID === resumeSession) {
      skipped.add(event); resumeSession = null;
    }
  }
  return skipped;
}

module.exports = { project, idleStartAfterMeetings };
