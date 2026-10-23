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
  if (blocks.some((block, i) => ms(block.end) <= ms(block.start) || (i && ms(blocks[i - 1].end) !== ms(block.start)))) return false;
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
  const initial = { work: 0, last: 'free', focused: false };
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
        put(i + 1, { work: state.work, last: 'free', focused: false }, path.cost + 3 * duration + (state.last === 'free' && i !== 0 ? 0 : 12), i, priorKey,
          { kind: 'free', start: iso(grid[i]), end: iso(grid[i + 1]) });
      }
      if (!state.focused) for (let endIndex = i + 1; endIndex < grid.length && endIndex <= limit; endIndex++) {
        const duration = (grid[endIndex] - grid[i]) / 60000;
        if (duration > maximum) break;
        if (duration < minimum) continue;
        const deviation = goal - duration, overload = Math.max(0, state.work + duration - goal - 15);
        const cost = 8 + .03 * deviation ** 2 + .015 * overload ** 2 + (duration % 5 === 0 ? 0 : 1.5) + (state.last === 'free' && i > 0 ? 15 : 0);
        put(endIndex, { work: Math.min(workCap, state.work + Math.trunc(duration)), last: 'focus', focused: true }, path.cost + cost, i, priorKey,
          { kind: 'focus', start: iso(grid[i]), end: iso(grid[endIndex]) });
      }
      if (state.work > 0 && state.last !== 'break') {
        const end = grid[i] + rest * 60000, endIndex = positions.get(end);
        if (endIndex != null && endIndex <= limit && endIndex < grid.length - 1) {
          const deviation = state.work - goal;
          put(endIndex, { work: 0, last: 'break', focused: false }, path.cost + 6 + (deviation < 0 ? .002 : .025) * deviation ** 2 + (state.last === 'free' ? 20 : 0), i, priorKey,
            { kind: 'break', start: iso(grid[i]), end: iso(end) });
        }
      }
    }
  }
  const endings = [...paths.at(-1)].filter(([, path]) => path.state.work > 0).sort((a, b) => a[1].cost - b[1].cost);
  if (!endings.length) return [{ kind: 'free', start: plan.start, end: plan.end }];
  let [id, path] = endings[0], at = grid.length - 1;
  const blocks = [];
  while (path.block) {
    const block = path.block;
    if (block.kind === 'free' && blocks.at(-1)?.kind === 'free' && ms(blocks.at(-1).start) === ms(block.end)) blocks.at(-1).start = block.start;
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
      block.start = iso(start); result.splice(index, 0, { kind: 'free', start: iso(old), end: iso(start) });
    }
  } else if (change.durationMinutes != null) {
    const minutes = Number(change.durationMinutes), old = ms(block.end), end = ms(block.start) + minutes * 60000;
    if (minutes < 1 || end === old || end > ms(result.at(-1).end)) return null;
    if (index + 1 < result.length && result[index + 1].kind !== 'meeting') {
      if (end > ms(result[index + 1].end) - 60000) return null;
      block.end = iso(end); result[index + 1].start = iso(end);
    } else {
      if (end >= old) return null;
      block.end = iso(end); result.splice(index + 1, 0, { kind: 'free', start: iso(end), end: iso(old) });
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
  const pairs = { breakEnded: ['breakStarted', 'break'], awayEnded: ['awayStarted', 'free'] };
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
    const observedSeconds = pair[1] === 'free' ? wallSeconds : Math.min(wallSeconds, Math.max(0, event.payload?.elapsedSeconds || 0));
    const isConfirmed = pair[1] === 'break' && confirmed.has(startEvent.payload?.sessionID);
    actual.push({ kind: pair[1], start: iso(start), end: iso(end), confirmed: isConfirmed, observedSeconds });
    if (pair[1] === 'free') awaySeconds += wallSeconds;
  }
  return { plan, suggestions: includeSuggestions && plan ? suggest(plan) : [], actual,
    focusSeconds: actual.filter(item => item.kind === 'focus').reduce((total, item) => total + item.observedSeconds, 0),
    breakSeconds: actual.filter(item => item.kind === 'break' && item.confirmed).reduce((total, item) => total + item.observedSeconds, 0), awaySeconds };
}

function forecast(plan, actual, timer, now) {
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
  const lastActual = actual.filter(item => ms(item.end) <= present).at(-1);
  if (((timer.phase === 'focus' && !timer.isSleeping) || (timer.phase === 'idle' && lastActual?.kind === 'focus')) && next < end) {
    const nextMeeting = (plan.meetings || []).map(item => ms(item.start)).filter(time => time >= next).sort((a, b) => a - b)[0] ?? end;
    const breakEnd = Math.min(end, nextMeeting, next + Math.max(1, plan.breakMinutes) * 60000);
    if (breakEnd > next) blocks.push({ kind: 'break', start: iso(next), end: iso(breakEnd), forecast: true });
    next = breakEnd;
  }
  if (next < end) blocks.push(...suggest({ ...plan, start: iso(next), customBlocks: null }).map(item => ({ ...item, forecast: true })));
  return blocks.sort((a, b) => ms(a.start) - ms(b.start));
}

module.exports = { suggest, editBlock, project, forecast, fixedMeetings, validBlocks, sameDay, ms, iso };
