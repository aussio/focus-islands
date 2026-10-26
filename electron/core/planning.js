const ms = value => +new Date(value);
const iso = value => new Date(value).toISOString();
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function fixedMeetings(plan) {
  const start = ms(plan.start), end = ms(plan.end);
  let cursor = start;
  const result = [];
  for (const meeting of [...(plan.meetings || [])].filter(item => ms(item.end) > ms(item.start) && ms(item.end) > start && ms(item.start) < end).sort((a, b) => ms(a.start) - ms(b.start))) {
    const from = Math.max(start, ms(meeting.start), cursor), to = Math.min(end, ms(meeting.end));
    if (to > from) { result.push({ kind: 'meeting', start: iso(from), end: iso(to), title: meeting.title }); cursor = to; }
  }
  return result;
}

function sameMeetings(a, b) {
  return JSON.stringify(a.map(({ kind, start, end, title }) => [kind, ms(start), ms(end), title])) ===
    JSON.stringify(b.map(({ kind, start, end, title }) => [kind, ms(start), ms(end), title]));
}

function validBlocks(blocks, plan) {
  if (!Array.isArray(blocks) || !blocks.length || ms(blocks[0].start) !== ms(plan.start) || ms(blocks.at(-1).end) !== ms(plan.end)) return false;
  if (blocks.some((block, i) => !['focus', 'break', 'meeting'].includes(block.kind) || ms(block.end) <= ms(block.start) || (i && ms(blocks[i - 1].end) !== ms(block.start)))) return false;
  return sameMeetings(blocks.filter(block => block.kind === 'meeting'), fixedMeetings(plan));
}

function suggest(plan, minimumFocusMinutes = 10) {
  if (!plan || ms(plan.end) <= ms(plan.start)) return [];
  if (validBlocks(plan.customBlocks, plan)) return plan.customBlocks;
  const goal = Math.max(1, plan.focusMinutes || 25);
  const maximum = goal + Math.min(5, Math.trunc(goal * .1));
  const minimum = Math.min(maximum, Math.max(minimumFocusMinutes, Math.trunc(goal / 2)));
  const rest = Math.max(1, plan.breakMinutes || 5);
  const meetings = fixedMeetings(plan);
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const step = gcd(5, gcd(goal, rest)) * 60000;
  const times = new Set([ms(plan.start), ms(plan.end)]);
  for (const anchor of [plan.start, ...meetings.map(meeting => meeting.end)]) {
    for (let tick = ms(anchor) + step; tick < ms(plan.end); tick += step) times.add(tick);
  }
  for (const meeting of meetings) { times.add(ms(meeting.start)); times.add(ms(meeting.end)); }
  const grid = [...times].sort((a, b) => a - b);
  const positions = new Map(grid.map((time, index) => [time, index]));
  const starts = new Map(meetings.map(meeting => [positions.get(ms(meeting.start)), meeting]));
  const nextMeeting = Array(grid.length);
  let next = grid.length - 1;
  for (let i = grid.length - 1; i >= 0; i--) { if (starts.has(i)) next = i; nextMeeting[i] = next; }
  const paths = grid.map(() => new Map());
  const initial = { work: 0, last: 'start', focused: false };
  const key = state => `${state.work}|${state.last}|${state.focused}`;
  paths[0].set(key(initial), { cost: 0, state: initial });
  const workCap = Math.max(2 * goal, 180);
  function put(time, state, cost, previousTime, previousKey, block) {
    const id = key(state), existing = paths[time].get(id);
    if (!existing || cost < existing.cost) paths[time].set(id, { cost, state, previousTime, previousKey, block });
  }
  for (let i = 0; i < grid.length - 1; i++) {
    const ordered = [...paths[i]].sort((a, b) => a[1].state.work - b[1].state.work || a[1].state.last.localeCompare(b[1].state.last) || Number(a[1].state.focused) - Number(b[1].state.focused));
    for (const [priorKey, path] of ordered) {
      const state = path.state;
      if (starts.has(i)) {
        const meeting = starts.get(i), endIndex = positions.get(ms(meeting.end));
        put(endIndex, { work: Math.min(workCap, state.work + Math.trunc((ms(meeting.end) - ms(meeting.start)) / 60000)), last: 'meeting', focused: false }, path.cost, i, priorKey, meeting);
        continue;
      }
      const limit = nextMeeting[i] === i ? grid.length - 1 : nextMeeting[i];
      if (i + 1 <= limit) {
        const duration = (grid[i + 1] - grid[i]) / 60000;
        put(i + 1, { work: state.work, last: 'break', focused: false }, path.cost + 3 * duration + (state.last === 'break' ? 0 : 12), i, priorKey,
          { kind: 'break', start: iso(grid[i]), end: iso(grid[i + 1]) });
      }
      if (!state.focused) for (let endIndex = i + 1; endIndex < grid.length && endIndex <= limit; endIndex++) {
        const duration = (grid[endIndex] - grid[i]) / 60000;
        if (duration > maximum) break;
        if (duration < minimum) continue;
        const deviation = goal - duration, overload = Math.max(0, state.work + duration - goal - 15);
        const cost = 8 + .03 * deviation ** 2 + .015 * overload ** 2 + (duration % 5 === 0 ? 0 : 1.5);
        put(endIndex, { work: Math.min(workCap, state.work + Math.trunc(duration)), last: 'focus', focused: true }, path.cost + cost, i, priorKey,
          { kind: 'focus', start: iso(grid[i]), end: iso(grid[endIndex]) });
      }
      if (state.work >= Math.max(1, Math.round(goal * .75)) && state.last !== 'break') {
        const end = grid[i] + rest * 60000, endIndex = positions.get(end);
        if (endIndex != null && endIndex <= limit && endIndex < grid.length - 1) {
          const deviation = state.work - goal;
          put(endIndex, { work: 0, last: 'break', focused: false }, path.cost + 6 + (deviation < 0 ? .002 : .025) * deviation ** 2, i, priorKey,
            { kind: 'break', start: iso(grid[i]), end: iso(end) });
        }
      }
    }
  }
  const endings = [...paths.at(-1)].filter(([, path]) => path.state.work > 0).sort((a, b) => a[1].cost - b[1].cost);
  if (!endings.length) {
    const fallback = [], meetings = fixedMeetings(plan);
    let cursor = ms(plan.start);
    for (const meeting of meetings) {
      if (ms(meeting.start) > cursor) fallback.push({ kind: 'break', start: iso(cursor), end: meeting.start });
      fallback.push(meeting); cursor = ms(meeting.end);
    }
    if (cursor < ms(plan.end)) fallback.push({ kind: 'break', start: iso(cursor), end: plan.end });
    return fallback;
  }
  let [id, path] = endings[0], at = grid.length - 1;
  const blocks = [];
  while (path.block) {
    const block = path.block;
    if (block.kind === 'break' && blocks.at(-1)?.kind === 'break' && ms(blocks.at(-1).start) === ms(block.end)) blocks.at(-1).start = block.start;
    else blocks.push({ ...block });
    at = path.previousTime; id = path.previousKey; path = paths[at].get(id);
  }
  return blocks.reverse();
}

function editBlock(blocks, index, change) {
  if (!blocks[index] || blocks[index].kind === 'meeting') return null;
  const result = blocks.map(block => ({ ...block })), block = result[index];
  if (change.start != null) {
    const start = ms(change.start), old = ms(block.start);
    if (start === old || start < ms(result[0].start) || start > ms(block.end) - 60000) return null;
    if (index > 0 && result[index - 1].kind !== 'meeting') {
      if (start < ms(result[index - 1].start) + 60000) return null;
      result[index - 1].end = iso(start); block.start = iso(start);
    } else {
      if (start <= old) return null;
      block.start = iso(start); result.splice(index, 0, { kind: 'break', start: iso(old), end: iso(start) });
    }
  } else if (change.durationMinutes != null) {
    const minutes = Number(change.durationMinutes), old = ms(block.end), end = ms(block.start) + minutes * 60000;
    if (minutes < 1 || end === old || end > ms(result.at(-1).end)) return null;
    if (index + 1 < result.length && result[index + 1].kind !== 'meeting') {
      if (end > ms(result[index + 1].end) - 60000) return null;
      block.end = iso(end); result[index + 1].start = iso(end);
    } else {
      if (end >= old) return null;
      block.end = iso(end); result.splice(index + 1, 0, { kind: 'break', start: iso(end), end: iso(old) });
    }
  } else return null;
  return result.every((item, i) => ms(item.end) > ms(item.start) && (!i || ms(result[i - 1].end) === ms(item.start))) ? result : null;
}

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
  const focusSessions = new Map();
  function focusSegment(from, until, seconds) {
    const start = Math.max(ms(from), dayStart);
    const end = Math.min(ms(until), ms(from) + Math.max(0, seconds) * 1000, dayEnd);
    if (end > start) actual.push({ kind: 'focus', start: iso(start), end: iso(end), observedSeconds: (end - start) / 1000 });
  }
  const pairs = { breakEnded: ['breakStarted', 'break'], awayEnded: ['awayStarted', 'away'] };
  for (const event of events) {
    if (event.kind === 'focusStarted' && event.payload?.sessionID) {
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
    if (['breakStarted', 'awayStarted'].includes(event.kind)) starts.set(event.kind, event);
    const pair = pairs[event.kind];
    if (!pair || !starts.has(pair[0])) continue;
    const startEvent = starts.get(pair[0]); starts.delete(pair[0]);
    const start = Math.max(ms(startEvent.occurredAt), dayStart), end = Math.min(ms(event.occurredAt), dayEnd);
    if (end <= start) continue;
    const wallSeconds = (end - start) / 1000;
    const observedSeconds = pair[1] === 'away' ? wallSeconds : Math.min(wallSeconds, Math.max(0, event.payload?.elapsedSeconds || 0));
    const isConfirmed = pair[1] === 'break' && confirmed.has(startEvent.payload?.sessionID);
    actual.push({ kind: pair[1], start: iso(start), end: iso(end), confirmed: isConfirmed, observedSeconds });
    if (pair[1] === 'away') awaySeconds += wallSeconds;
  }
  return { plan, suggestions: includeSuggestions && plan ? suggest(plan) : [], actual,
    focusSeconds: actual.filter(item => item.kind === 'focus').reduce((total, item) => total + item.observedSeconds, 0),
    breakSeconds: actual.filter(item => item.kind === 'break' && item.confirmed).reduce((total, item) => total + item.observedSeconds, 0), awaySeconds };
}

function forecast(plan, actual, timer, now, events = []) {
  if (!plan) return [];
  const start = ms(plan.start), end = ms(plan.end), present = Math.max(start, Math.min(ms(now), end));
  const blocks = actual.filter(item => ms(item.end) > start && ms(item.start) < end).map(item => ({
    ...item, start: iso(Math.max(start, ms(item.start))), end: iso(Math.min(end, ms(item.end))), actual: true,
  }));
  let next = present;
  if (timer.phase !== 'idle' && !timer.isSleeping) {
    const activeStart = Math.max(start, ms(timer.observedSegmentStartedAt || timer.startedAt));
    const expectedEnd = Math.min(end, present + Math.max(0, timer.targetSeconds - timer.elapsedSeconds) * 1000);
    if (expectedEnd > activeStart) blocks.push({ kind: timer.phase, start: iso(activeStart), end: iso(expectedEnd), active: true });
    next = Math.max(next, expectedEnd);
  }
  const latestSnooze = events.filter(item => item.kind === 'breakSnoozed' && item.payload?.sessionID === timer.sessionID)
    .sort((a, b) => ms(b.occurredAt) - ms(a.occurredAt))[0];
  if (timer.phase === 'focus' && timer.isDue && !timer.isSleeping && latestSnooze) {
    const snoozedUntil = Math.min(end, ms(latestSnooze.occurredAt) + (latestSnooze.payload.minutes || 5) * 60000);
    if (snoozedUntil > next) {
      const active = blocks.find(item => item.active && item.kind === 'focus');
      if (active) active.end = iso(snoozedUntil);
      else blocks.push({ kind: 'focus', start: iso(present), end: iso(snoozedUntil), active: true });
      next = snoozedUntil;
    }
  }
  const completed = actual.filter(item => ms(item.end) <= present).sort((a, b) => ms(a.end) - ms(b.end));
  const lastRestEnd = Math.max(start, ...completed.filter(item => item.kind === 'break' && item.confirmed).map(item => ms(item.end)));
  const workSpans = [
    ...completed.filter(item => item.kind === 'focus').map(item => [Math.max(lastRestEnd, ms(item.start)), Math.min(present, ms(item.end))]),
    ...fixedMeetings(plan).map(item => [Math.max(lastRestEnd, ms(item.start)), Math.min(present, ms(item.end))]),
  ].filter(([from, until]) => until > from).sort((a, b) => a[0] - b[0]);
  let workedMinutes = 0, workEnd = 0;
  for (const [from, until] of workSpans) {
    workedMinutes += Math.max(0, until - Math.max(from, workEnd)) / 60000;
    workEnd = Math.max(workEnd, until);
  }
  const lastFocusEnd = Math.max(0, ...completed.filter(item => item.kind === 'focus').map(item => ms(item.end)));
  const recentWork = workEnd > 0 && present - workEnd <= Math.max(30, 2 * plan.breakMinutes) * 60000;
  const skipped = events.some(item => item.kind === 'breakSkipped' && ms(item.occurredAt) >= Math.max(lastFocusEnd, lastRestEnd) && ms(item.occurredAt) <= present);
  const activeFocus = timer.phase === 'focus' && !timer.isSleeping;
  const idleSnooze = timer.phase === 'idle' ? events.filter(item => item.kind === 'breakSnoozed' && item.payload?.scope === 'forecast' && ms(item.occurredAt) >= lastFocusEnd && ms(item.occurredAt) <= present)
    .sort((a, b) => ms(b.occurredAt) - ms(a.occurredAt))[0] : null;
  const snoozedUntil = idleSnooze ? ms(idleSnooze.occurredAt) + (idleSnooze.payload.minutes || 5) * 60000 : 0;
  const meetingWindows = [...(plan.meetings || [])].sort((a, b) => ms(a.start) - ms(b.start));
  function addDueBreak(earliest) {
    const duration = Math.max(1, plan.breakMinutes) * 60000;
    let from = earliest;
    for (const meeting of meetingWindows) {
      if (ms(meeting.end) <= from) continue;
      if (ms(meeting.start) >= from + duration) break;
      from = ms(meeting.end);
    }
    const until = Math.min(end, from + duration);
    if (until > from) {
      blocks.push({ kind: 'break', start: iso(from), end: iso(until), forecast: true });
      next = until;
    }
  }
  const nextMeetingStart = (plan.meetings || []).map(item => ms(item.start)).filter(time => time > next).sort((a, b) => a - b)[0] ?? end;
  if (snoozedUntil > next && next < end) {
    const focusEnd = Math.min(end, nextMeetingStart, snoozedUntil);
    if (focusEnd > next) blocks.push({ kind: 'focus', start: iso(next), end: iso(focusEnd), forecast: true, snoozed: true });
    next = focusEnd;
  }
  const needsRest = activeFocus || (timer.phase === 'idle' && (snoozedUntil > present || (recentWork && !skipped && workedMinutes >= plan.focusMinutes * .75)));
  if (needsRest && next < end) {
    addDueBreak(next);
  } else if (timer.phase === 'idle' && recentWork && workedMinutes > 0 && !skipped && next < end) {
    const nextMeeting = (plan.meetings || []).map(item => ms(item.start)).filter(time => time > next).sort((a, b) => a - b)[0] ?? end;
    const remaining = Math.max(1, Math.round(plan.focusMinutes - workedMinutes));
    const focusEnd = Math.min(end, nextMeeting, next + remaining * 60000);
    if (focusEnd - next >= 10 * 60000) {
      blocks.push({ kind: 'focus', start: iso(next), end: iso(focusEnd), forecast: true });
      next = focusEnd;
      addDueBreak(next);
    }
  }
  if (next < end) blocks.push(...suggest({ ...plan, start: iso(next), customBlocks: null }).map(item => ({ ...item, forecast: true })));
  // Meetings belong to the saved plan, not to the flexible schedule rebuilt from `next`.
  // That rebuild can begin inside or after a meeting when focus or a break runs late.
  const meetings = (plan.meetings || []).filter(item => ms(item.end) > start && ms(item.start) < end)
    .map(item => ({ kind: 'meeting', start: iso(Math.max(start, ms(item.start))),
      end: iso(Math.min(end, ms(item.end))), title: item.title, forecast: true }));
  const timelineBlocks = blocks.filter(item => item.kind !== 'meeting').flatMap(block => {
    if (block.actual) return [block];
    let pieces = [block];
    for (const meeting of meetings) {
      pieces = pieces.flatMap(piece => {
        const from = ms(piece.start), until = ms(piece.end);
        const meetingStart = ms(meeting.start), meetingEnd = ms(meeting.end);
        if (meetingEnd <= from || meetingStart >= until) return [piece];
        return [
          ...(meetingStart > from ? [{ ...piece, end: iso(meetingStart) }] : []),
          ...(meetingEnd < until ? [{ ...piece, start: iso(meetingEnd) }] : []),
        ];
      });
    }
    return pieces;
  });
  return [...timelineBlocks, ...meetings].sort((a, b) => ms(a.start) - ms(b.start)).reduce((timeline, block) => {
    const previous = timeline.at(-1);
    if (previous?.kind === 'break' && block.kind === 'break' && previous.forecast && block.forecast && ms(previous.end) === ms(block.start)) {
      previous.end = block.end;
    } else timeline.push(block);
    return timeline;
  }, []);
}

module.exports = { suggest, editBlock, project, forecast, fixedMeetings, validBlocks, sameDay, ms, iso };
