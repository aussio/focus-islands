const { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { backup: sqliteBackup } = require('node:sqlite');
const { openStore, uuid } = require('./store');
const { Timer } = require('./timer');
const { suggest, editBlock, project, forecast, sameDay, ms, iso, qualifyingRestSeconds, idleStartAfterMeetings } = require('./planning');
const { todayGuidance, dayEndGuidance } = require('./guidance');
const game = require('./game');

// Older databases may also hold acorn records (rewardGranted, rewardDebited, itemPurchased).
// They stay in the ledger untouched, but nothing reads or shows them any more.
const eventKinds = new Set(['focusStarted', 'focusEnded', 'breakStarted', 'breakEnded', 'breakDue', 'breakSkipped', 'dayEnded', 'dayReopened', 'reflection']);
const viewPages = new Set(['today', 'plan', 'history', 'settings']);
const historyTitles = { focusStarted: 'Focus started', focusEnded: 'Focus finished', breakStarted: 'Break started', breakEnded: 'Break finished', breakDue: 'Break was due', breakSkipped: 'Break skipped', dayEnded: 'Day ended', dayReopened: 'Day reopened', reflection: 'Reflection saved' };
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):(00|15|30|45)$/.test(value);
const validStartTime = value => validTime(value) && value >= '07:00' && value <= '20:45';
const validEndTime = value => validTime(value) && value >= '07:15' && value <= '21:00';
const localTime = value => { const date = new Date(value); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
const dayBounds = (now, startTime = '09:00', endTime = '17:00') => {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bound = time => { const [hour, minute] = time.split(':').map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString(); };
  return { start: bound(startTime), end: bound(endTime) };
};
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function dateForDayKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a local calendar date.');
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (dayKey(date) !== key) throw new Error('Choose a valid local calendar date.');
  return date;
}
// The start time ('09:00' unless another valid time is given) on the calendar day after `date`.
const morningAfter = (date, startTime) => {
  const [hour, minute] = (validTime(startTime) ? startTime : '09:00').split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, hour, minute);
};
const countDown = seconds => {
  const value = Number(seconds) || 0;
  const whole = Math.ceil(Math.abs(value));
  return `${value < 0 ? '-' : ''}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

// demo: the game demo (scripts/run-game-demo.sh), a development app with its own instance. Its clock starts on
// a morning, it picks up where it stopped after a restart, and the demo steps below fast-forward the real app.
function createCore({ dbPath, statusPath, profile = 'personal', development = false, demo = false }) {
  if (!dbPath) throw new Error('dbPath is required.');
  if (development && profile !== 'testing') throw new Error('Development must use Testing.');
  if (demo && !development) throw new Error('The game demo must run as a development app.');
  let store = openStore(dbPath);
  let timer, currentPlan = null, plannedBlocks = [], latestPlanEventID = null, page = 'today', message = '', clockOffset = 0, wallOffset = 0;
  let lastCheckpoint = 0, lastTick = null, awayStartedAt = null, suspended = new Set();
  let breakAwayStartedAt = null, breakElapsedAtAway = 0, returnCandidateAt = null, returnActivityStartedAt = null, returnDismissed = false;
  const RETURN_ACTIVITY_SECONDS = 60;
  const observationStartedAt = now().wall;
  let focusLength = 60, breakLength = 10, defaultFocusLength = 60, defaultBreakLength = 10;
  let defaultStartTime = '09:00', defaultEndTime = '17:00';
  let notificationsEnabled = true, savedReflection = '';
  let dayEndedAt = null, dayEndSnoozedUntil = null;
  // The demo keeps the normal delay; its window treats you as present anyway (see electron/main.js).
  const defaultActivityDelay = development && !demo ? 5 : 120;
  let activityDelaySeconds = defaultActivityDelay;
  let reminderSequence = 0, breakCompleteSequence = 0;
  let forecastCacheKey = '', forecastCache = [];
  let committedCacheKey = '', committedCache = null;
  // The sky-island game. gameSyncKey is "today:last saved seq" when the game was last brought up to date.
  let gameStarted = false, gameSyncKey = '', gameFailedKey = '';
  const planIndex = new Map(), planSummaries = new Map();
  let planIndexedThrough = 0;
  const supportPath = dbPath.includes('/profiles/testing/') ? dbPath.split('/profiles/testing/')[0] : dirname(dbPath);
  const preferencesPath = join(supportPath, `preferences-${profile}.json`);
  function now() {
    return { wall: new Date(Date.now() + clockOffset + wallOffset), monotonicSeconds: performance.now() / 1000 + clockOffset / 1000 };
  }
  function writeLease(phase = timer.state.phase) {
    if (!statusPath) return;
    try {
      const current = new Date();
      const value = { phase, updatedAt: current.toISOString(), expiresAt: new Date(current.getTime() + 90000).toISOString() };
      mkdirSync(dirname(statusPath), { recursive: true });
      const temporary = `${statusPath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(value));
      renameSync(temporary, statusPath);
    } catch (error) { console.error('Could not publish phase lease:', error); }
  }
  function allEvents() { return store.allEvents(); }
  function append(kind, payload, options) { return store.append(kind, payload, options); }
  function planForDay(events, key) {
    const planEvents = events.filter(event => ['dayPlan', 'dayPlanRevision', 'dayPlanRevised'].includes(event.kind)
      && event.payload && (event.payload.dayKey === key || (!event.payload.dayKey && sameDay(event.payload.day, dateForDayKey(key)))));
    const baseline = planEvents[0];
    const latest = planEvents.at(-1);
    return { baseline: baseline && { ...baseline.payload, dayKey: key,
      provenance: baseline.payload.provenance || 'legacy-first-save' },
      current: latest && { ...latest.payload, dayKey: key },
      latestEventID: latest?.id, revisionCount: Math.max(0, planEvents.length - 1) };
  }
  function sessionPayload(source = timer) { return { sessionID: source.state.sessionID, targetSeconds: source.state.targetSeconds, elapsedSeconds: source.state.elapsedSeconds }; }
  function load(onStartup = false) {
    const events = allEvents(), instant = now();
    const key = dayKey(instant.wall);
    // The day is ended when its last dayEnded or dayReopened record is a dayEnded.
    const dayClosing = events.findLast(event => ['dayEnded', 'dayReopened'].includes(event.kind) && event.payload?.dayKey === key);
    dayEndedAt = dayClosing?.kind === 'dayEnded' ? dayClosing.occurredAt : null;
    dayEndSnoozedUntil = events.findLast(event => event.kind === 'dayEndSnoozed' && event.payload?.dayKey === key)?.payload.until || null;
    timer = Timer.recover(events, instant);
    const openAway = events.reduce((open, event) => event.kind === 'awayStarted' ? event : event.kind === 'awayEnded' ? null : open, null);
    awayStartedAt = openAway && timer.state.phase === 'focus' && sameDay(openAway.occurredAt, instant.wall)
      ? new Date(openAway.occurredAt) : null;
    breakAwayStartedAt = openAway && timer.state.phase === 'break' && sameDay(openAway.occurredAt, instant.wall)
      ? new Date(openAway.occurredAt) : null;
    breakElapsedAtAway = breakAwayStartedAt ? Math.max(0, Number(openAway.payload?.breakElapsedSeconds) || 0) : 0;
    returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false; suspended.clear();
    if (onStartup && timer.state.phase !== 'idle' && !sameDay(timer.state.startedAt, instant.wall)) {
      const { phase, sessionID, targetSeconds, elapsedSeconds, unknownGapStartedAt } = timer.state;
      const observedAt = new Date(unknownGapStartedAt || instant.wall);
      const payload = { sessionID, targetSeconds, elapsedSeconds, interrupted: true };
      append(phase === 'focus' ? 'focusEnded' : 'breakEnded', payload,
        { occurredAt: observedAt, source: 'system' });
      timer = new Timer();
      message = 'Your previous day ended. Only recorded session time was kept.';
    } else if (onStartup && timer.state.phase !== 'idle') {
      const { phase, sessionID, targetSeconds, elapsedSeconds, unknownGapStartedAt } = timer.state;
      const payload = { sessionID, targetSeconds, elapsedSeconds };
      const lastSessionEvent = events.filter(event => event.payload?.sessionID === sessionID).at(-1);
      store.transaction(() => {
        if (phase === 'focus' && lastSessionEvent?.kind !== 'focusPaused') {
          append('focusPaused', payload, { occurredAt: new Date(unknownGapStartedAt || timer.state.startedAt), source: 'system' });
        }
        if (!(phase === 'focus' && awayStartedAt)) append(phase === 'focus' ? 'focusResumed' : 'breakProgress', payload,
          { occurredAt: instant.wall, source: 'system' });
      });
      timer.state.unknownGapStartedAt = null;
      if (phase === 'focus' && awayStartedAt) {
        timer.state.isSleeping = true;
        suspended.add('idle');
        message = 'Your time away continued across restart and is counting as a break.';
      } else message = `Your ${phase} session resumed after restart. Time while the app was closed was paused.`;
    }
    lastTick = instant;
    lastCheckpoint = instant.wall.getTime();
    currentPlan = null; plannedBlocks = []; latestPlanEventID = null;
    let prefs = store.getSettings();
    if (!prefs) {
      let legacy = {};
      try { if (existsSync(preferencesPath)) legacy = JSON.parse(readFileSync(preferencesPath, 'utf8')); } catch { /* Use local defaults. */ }
      const legacyFocus = Number(legacy.focusMinutes), legacyBreak = Number(legacy.breakMinutes);
      prefs = store.saveSettings({ focusMinutes: Number.isInteger(legacyFocus) && legacyFocus >= 5 && legacyFocus <= 120 ? legacyFocus : 60,
        breakMinutes: Number.isInteger(legacyBreak) && legacyBreak >= 5 && legacyBreak <= 60 ? legacyBreak : 10,
        startTime: validTime(legacy.startTime) ? legacy.startTime : '09:00',
        endTime: validTime(legacy.endTime) ? legacy.endTime : '17:00',
        notificationsEnabled: legacy.notificationsEnabled ?? true,
        activityDelaySeconds: defaultActivityDelay });
    }
    defaultFocusLength = prefs.focusMinutes; defaultBreakLength = prefs.breakMinutes;
    defaultStartTime = validStartTime(prefs.startTime) ? prefs.startTime : '09:00';
    defaultEndTime = validEndTime(prefs.endTime) ? prefs.endTime : '17:00';
    if (defaultEndTime <= defaultStartTime) { defaultStartTime = '09:00'; defaultEndTime = '17:00'; }
    const bounds = dayBounds(instant.wall, defaultStartTime, defaultEndTime);
    focusLength = defaultFocusLength; breakLength = defaultBreakLength;
    notificationsEnabled = prefs.notificationsEnabled;
    activityDelaySeconds = prefs.activityDelaySeconds ?? defaultActivityDelay;
    const todayPlan = planForDay(events, dayKey(instant.wall));
    currentPlan = todayPlan.current; latestPlanEventID = todayPlan.latestEventID;
    if (currentPlan) { focusLength = currentPlan.focusMinutes; breakLength = currentPlan.breakMinutes; plannedBlocks = suggest(currentPlan); }
    else currentPlan = null;
    const yesterday = new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate() - 1);
    const saved = events.filter(event => event.kind === 'reflection' && event.payload && sameDay(event.payload.day, yesterday)).at(-1);
    savedReflection = saved?.payload.note || '';
    writeLease();
    return bounds;
  }
  // The demo's clock. A fresh demo starts on the next morning at the usual start time: day 1. A saved demo picks
  // up where it stopped: the time in demo-clock.json (saved after each step and at quit), and never before its
  // newest record. The clock file sits next to the demo's database and is ignored once that database is empty.
  const demoLog = [], demoClockPath = demo ? join(dirname(dbPath), 'demo-clock.json') : null;
  function saveDemoClock() {
    try { writeFileSync(demoClockPath, JSON.stringify({ at: now().wall.toISOString() })); }
    catch (error) { console.error('Could not save the demo clock:', error); }
  }
  if (demo) {
    const events = allEvents(), real = Date.now();
    let stoppedAt = 0;
    try { stoppedAt = Date.parse(JSON.parse(readFileSync(demoClockPath, 'utf8')).at) || 0; } catch { /* No saved clock yet. */ }
    clockOffset = events.length
      ? Math.max(0, events.reduce((latest, event) => Math.max(latest, Date.parse(event.occurredAt)), stoppedAt) - real)
      : morningAfter(new Date(real), store.getSettings()?.startTime) - real;
    addDemoLog(events.length ? 'Demo reopened where it stopped' : 'New demo: nothing earned yet');
  }
  let bounds = load(true);
  syncGame();
  function syncDay() {
    if (sameDay(bounds.start, now().wall)) return;
    bounds = load();
  }
  function tick(idleSeconds = 0) {
    const instant = now(); syncDay();
    if (dayEndedAt) { lastTick = instant; writeLease('idle'); return; }
    if (inMeeting()) { returnCandidateAt = null; returnActivityStartedAt = null; }
    if (!development && Number.isFinite(idleSeconds)) {
      if (idleSeconds >= activityDelaySeconds) {
        // Only idle time after a meeting ends can start time away, and it must reach the usual threshold.
        const idleStart = Math.max(observationStartedAt.getTime(), instant.wall.getTime() - idleSeconds * 1000);
        const awayStart = idleStartAfterMeetings(currentPlan?.meetings, idleStart);
        const awaySeconds = (instant.wall.getTime() - awayStart) / 1000;
        if (awaySeconds >= activityDelaySeconds) beginAway('idle', new Date(awayStart), awaySeconds);
      } else if (idleSeconds < Math.min(3, activityDelaySeconds)) {
        if (!suspended.has('locked') && !suspended.has('sleep') && awayStartedAt && timer.state.phase === 'idle') finishAway('input resumed');
        else if (!suspended.has('locked') && !suspended.has('sleep') && (awayStartedAt || breakAwayStartedAt)) beginReturn();
        else if (!awayStartedAt && suspended.has('idle')) resume('idle');
      }
    }
    if (returnCandidateAt) {
      if (Number.isFinite(idleSeconds) && idleSeconds >= Math.min(15, activityDelaySeconds)) returnActivityStartedAt = null;
      else if (returnActivityStartedAt && (instant.wall - returnActivityStartedAt) / 1000 >= RETURN_ACTIVITY_SECONDS) finishReturn('activity continued');
    }
    const proposed = timer.clone(), events = [];
    let gapPaused = false, reminderChange = 0, breakCompleteChange = 0, checkpoint = lastCheckpoint;
    if (lastTick && proposed.state.phase !== 'idle' && suspended.size === 0 && !proposed.state.isSleeping) {
      const monotonicGap = instant.monotonicSeconds - lastTick.monotonicSeconds;
      const wallGap = (instant.wall - lastTick.wall) / 1000;
      if (monotonicGap > 10 || Math.abs(wallGap - monotonicGap) > 10) {
        const state = { ...proposed.state };
        proposed.restorePausedSession({ phase: state.phase, sessionID: state.sessionID, startedAt: state.startedAt,
          targetSeconds: state.targetSeconds, observedElapsedSeconds: state.elapsedSeconds, lastObservedAt: lastTick.wall.toISOString() }, instant);
        events.push([state.phase === 'focus' ? 'focusPaused' : 'breakProgress', sessionPayload(proposed), { occurredAt: lastTick.wall, source: 'system' }]);
        gapPaused = true;
      }
    }
    for (const signal of proposed.advance(instant)) {
      if (signal === 'breakDue') {
        events.push(['breakDue', sessionPayload(proposed), { occurredAt: instant.wall, source: 'system' }]);
        reminderChange++;
      } else if (signal === 'overdueNudge') reminderChange++;
      else if (signal === 'breakComplete') breakCompleteChange++;
    }
    if (proposed.state.phase !== 'idle' && !proposed.state.isSleeping && instant.wall.getTime() - lastCheckpoint >= 30000) {
      events.push([proposed.state.phase === 'focus' ? 'focusResumed' : 'breakProgress', sessionPayload(proposed), { occurredAt: instant.wall, source: 'system' }]);
      checkpoint = instant.wall.getTime();
    }
    if (events.length) store.transaction(() => { for (const event of events) append(...event); });
    timer = proposed; lastTick = instant; lastCheckpoint = checkpoint;
    reminderSequence += reminderChange; breakCompleteSequence += breakCompleteChange;
    if (gapPaused) message = 'An unobserved gap was paused, so it did not count as focus time.';
    writeLease();
  }
  // reason notes why a focus session began: 'manual', 'suggestion', or 'snooze'.
  // Focus that starts by itself after a break is written by finishBreak and finishAway as 'afterBreak'.
  function canBackdateStart(wall = now().wall) {
    return timer.state.phase === 'idle' && !dayEndedAt && !allEvents().some(event =>
      ['focusStarted', 'breakStarted'].includes(event.kind) && dayKey(new Date(event.occurredAt)) === dayKey(wall));
  }
  // Choose the durable session target from the time available, before recording it.
  function focusTarget(target, wall, plan = currentPlan) {
    if (!plan || !sameDay(plan.day, wall)) return target;
    const finish = dayEndSnoozedUntil && ms(dayEndSnoozedUntil) > ms(plan.end)
      ? ms(dayEndSnoozedUntil) : ms(plan.end);
    if (finish <= wall) return target; // After-day guidance owns explicit work beyond the plan.
    return Math.max(1, Math.min(target, (finish - wall) / 1000));
  }
  function start(phase, target, planDraft, reason = 'manual', reportedStart) {
    if (dayEndedAt) return;
    if (timer.state.phase !== 'idle' && !(phase === 'break' && timer.state.phase === 'focus')) return;
    const instant = now(), proposed = timer.clone();
    let startedAt = instant.wall;
    if (reportedStart !== undefined) {
      startedAt = new Date(reportedStart);
      if (phase !== 'focus' || !canBackdateStart(instant.wall) || !Number.isFinite(startedAt.getTime())
        || dayKey(startedAt) !== dayKey(instant.wall) || startedAt > instant.wall) {
        throw new Error('Choose a start time earlier today, before your first session.');
      }
    }
    let finishedFocus = null;
    if (proposed.state.phase === 'focus') {
      const { sessionID, targetSeconds } = proposed.state;
      finishedFocus = { sessionID, targetSeconds, elapsedSeconds: proposed.end(instant) };
    }
    const prepared = currentPlan ? null : preparePlan(planDraft || {}, planDraft ? 'explicit' : 'generated-default', instant);
    if (!currentPlan && !prepared) return;
    if (phase === 'focus') target = focusTarget(target, startedAt, currentPlan || prepared.plan);
    const id = proposed.start(phase, target, { wall: startedAt, monotonicSeconds: instant.monotonicSeconds - (instant.wall - startedAt) / 1000 });
    const signals = proposed.advance(instant);
    let planEvent;
    store.transaction(() => {
      if (prepared) planEvent = append(prepared.existing.latestEventID ? 'dayPlanRevised' : 'dayPlan', prepared.plan, { occurredAt: instant.wall });
      if (awayStartedAt) append('awayEnded', { reason: 'break started' }, { occurredAt: instant.wall, source: 'inferred' });
      if (finishedFocus) append('focusEnded', finishedFocus, { occurredAt: instant.wall });
      if (phase === 'focus') append('focusStarted', { sessionID: id, targetSeconds: proposed.state.targetSeconds, reason, ...(reportedStart !== undefined ? { reportedStart: true } : {}) }, { occurredAt: startedAt });
      else append('breakStarted', { sessionID: id, targetSeconds: proposed.state.targetSeconds,
        ...(finishedFocus ? { followsSessionID: finishedFocus.sessionID } : {}) }, { occurredAt: instant.wall });
      if (reportedStart !== undefined) append('focusResumed', sessionPayload(proposed), { occurredAt: instant.wall });
      if (signals.includes('breakDue')) append('breakDue', sessionPayload(proposed), { occurredAt: instant.wall, source: 'system' });
    });
    if (prepared) installPlan(prepared, planEvent.id);
    if (signals.includes('breakDue')) reminderSequence++;
    timer = proposed; suspended.clear();
    awayStartedAt = null; breakAwayStartedAt = null; breakElapsedAtAway = 0; returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false;
    lastTick = instant; lastCheckpoint = instant.wall.getTime(); writeLease();
  }
  function endFocus() {
    if (timer.state.phase !== 'focus') return;
    const instant = now(), proposed = timer.clone(), { sessionID, targetSeconds } = proposed.state;
    const elapsedSeconds = proposed.end(instant);
    store.transaction(() => {
      if (awayStartedAt) append('awayEnded', { reason: 'focus ended' }, { occurredAt: instant.wall, source: 'inferred' });
      append('focusEnded', { sessionID, targetSeconds, elapsedSeconds }, { occurredAt: instant.wall });
    });
    timer = proposed; awayStartedAt = null; returnCandidateAt = null; returnActivityStartedAt = null;
    suspended.clear(); writeLease();
  }
  function finishBreak(startNextFocus = true, confirm = true, returnedAt = null) {
    if (timer.state.phase !== 'break') return;
    const instant = now(), proposed = timer.clone(), { sessionID, targetSeconds } = proposed.state;
    const activeSeconds = returnedAt ? Math.max(0, (instant.wall - returnedAt) / 1000) : 0;
    const endInstant = returnedAt ? { wall: returnedAt, monotonicSeconds: instant.monotonicSeconds - activeSeconds } : instant;
    if (returnedAt) proposed.state.elapsedSeconds = Math.max(0, proposed.state.elapsedSeconds - activeSeconds);
    const elapsedSeconds = Math.max(proposed.end(endInstant), breakAwayStartedAt
      ? breakElapsedAtAway + Math.max(0, (endInstant.wall - breakAwayStartedAt) / 1000) : 0);
    const payload = { sessionID, targetSeconds, elapsedSeconds };
    const focusID = startNextFocus ? proposed.start('focus', focusTarget(focusLength * 60, endInstant.wall), endInstant) : null;
    if (focusID && returnedAt) proposed.advance(instant);
    store.transaction(() => {
      if (breakAwayStartedAt) append('awayEnded', { reason: 'break ended' }, { occurredAt: endInstant.wall, source: 'inferred' });
      if (confirm) append('breakConfirmed', payload, { occurredAt: endInstant.wall });
      append('breakEnded', payload, { occurredAt: endInstant.wall });
      if (focusID) append('focusStarted', { sessionID: focusID, targetSeconds: proposed.state.targetSeconds, reason: 'afterBreak' }, { occurredAt: endInstant.wall });
    });
    timer = proposed; suspended.clear();
    breakAwayStartedAt = null; breakElapsedAtAway = 0; returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false;
    lastTick = instant; lastCheckpoint = instant.wall.getTime(); writeLease();
  }
  function endDay() {
    if (dayEndedAt) return;
    const instant = now(), proposed = timer.clone();
    const { phase, sessionID, targetSeconds } = proposed.state;
    const elapsedSeconds = Math.max(proposed.end(instant), phase === 'break' && breakAwayStartedAt
      ? breakElapsedAtAway + Math.max(0, (instant.wall - breakAwayStartedAt) / 1000) : 0);
    const payload = { sessionID, targetSeconds, elapsedSeconds };
    store.transaction(() => {
      if (awayStartedAt || breakAwayStartedAt) append('awayEnded', { reason: 'day ended' }, { occurredAt: instant.wall, source: 'inferred' });
      if (phase !== 'idle') {
        if (phase === 'break') append('breakConfirmed', payload, { occurredAt: instant.wall });
        append(phase === 'focus' ? 'focusEnded' : 'breakEnded', payload, { occurredAt: instant.wall });
      }
      append('dayEnded', { dayKey: dayKey(instant.wall) }, { occurredAt: instant.wall });
    });
    timer = proposed; dayEndedAt = instant.wall.toISOString(); suspended.clear();
    awayStartedAt = null; breakAwayStartedAt = null; breakElapsedAtAway = 0;
    returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false;
    lastTick = instant; lastCheckpoint = instant.wall.getTime();
    page = 'today'; message = ''; writeLease('idle');
  }
  // "I'm working" on the day-end card. It reopens an ended day, and after the planned finish it moves
  // the day-end reminder `minutes` later with the same record as snoozing it. Then it starts work the way
  // the matching button does: a confirmed return ends time away, a running break finishes, and an idle
  // timer starts focus. Focus that is already running only gets the later reminder. All records of one
  // press are saved in one transaction. If it fails, nothing in memory changes.
  function keepWorking(value) {
    const instant = now(), key = dayKey(instant.wall), reopen = Boolean(dayEndedAt);
    const pastFinish = instant.wall >= new Date(currentPlan?.end || bounds.end);
    if (!reopen && (!currentPlan || !pastFinish)) return;
    let minutes = null, until = null;
    if (pastFinish) {
      minutes = Number(value?.minutes ?? value ?? 5);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60 || minutes % 5 !== 0) throw new Error('Choose 5 to 60 minutes in five-minute steps.');
      until = new Date(instant.wall.getTime() + minutes * 60000).toISOString();
    }
    const saved = { timer, dayEndedAt, dayEndSnoozedUntil, currentPlan, plannedBlocks, latestPlanEventID, bounds, focusLength, breakLength,
      awayStartedAt, breakAwayStartedAt, breakElapsedAtAway, returnCandidateAt, returnActivityStartedAt, returnDismissed,
      suspended: new Set(suspended), lastTick, lastCheckpoint, reminderSequence, message };
    try {
      store.transaction(() => {
        if (reopen) append('dayReopened', { dayKey: key }, { occurredAt: instant.wall });
        if (until) append('dayEndSnoozed', { dayKey: key, minutes, until }, { occurredAt: instant.wall });
        // Set before work starts, so start() runs and focusTarget ends the new session at the new reminder.
        dayEndedAt = null; if (until) dayEndSnoozedUntil = until; message = '';
        if (awayStartedAt || breakAwayStartedAt) { returnDismissed = false; beginReturn(true); finishReturn('confirmed return'); }
        if (timer.state.phase === 'break') finishBreak();
        if (timer.state.phase === 'idle') start('focus', focusLength * 60, undefined, 'manual');
      });
    } catch (error) {
      ({ timer, dayEndedAt, dayEndSnoozedUntil, currentPlan, plannedBlocks, latestPlanEventID, bounds, focusLength, breakLength,
        awayStartedAt, breakAwayStartedAt, breakElapsedAtAway, returnCandidateAt, returnActivityStartedAt, returnDismissed,
        suspended, lastTick, lastCheckpoint, reminderSequence, message } = saved);
      writeLease(dayEndedAt ? 'idle' : timer.state.phase);
      throw error;
    }
    page = 'today'; writeLease();
  }
  function preparePlan(value, provenance, instant) {
    const key = value.dayKey || dayKey(instant.wall);
    const day = dateForDayKey(key), existing = planForDay(allEvents(), key);
    const base = existing.current, targetBounds = dayBounds(day, defaultStartTime, defaultEndTime);
    const start = iso(value.start || value.dayStart || base?.start || targetBounds.start);
    const end = iso(value.end || value.dayEnd || base?.end || targetBounds.end);
    if (((!base || start !== base.start) && !validStartTime(localTime(start))) ||
      ((!base || end !== base.end) && !validEndTime(localTime(end)))) {
      message = 'Choose a start from 7:00 AM and a finish by 9:00 PM in 15-minute steps.';
      return false;
    }
    if (ms(end) - ms(start) < 900000) { message = 'Finish must be at least 15 minutes after start.'; return false; }
    if (dayKey(new Date(start)) !== key || dayKey(new Date(end)) !== key) { message = 'Plan bounds must stay on the selected day.'; return false; }
    const meetings = (value.meetings || base?.meetings || []).map(item => ({ id: item.id || uuid(), title: item.title,
      start: iso(item.start), end: iso(item.end || ms(item.start) + Number(item.duration || 30) * 60000) }));
    if (meetings.some(item => !item.title?.trim() || ms(item.end) - ms(item.start) < 900000 || ms(item.start) < ms(start) || ms(item.end) > ms(end))) {
      message = 'Meetings must last at least 15 minutes and fit inside the plan.';
      return false;
    }
    const focusMinutes = Number(value.focusMinutes ?? value.focusLength ?? base?.focusMinutes ?? defaultFocusLength);
    const breakMinutes = Number(value.breakMinutes ?? value.breakLength ?? base?.breakMinutes ?? defaultBreakLength);
    if (!Number.isInteger(focusMinutes) || focusMinutes < 5 || focusMinutes > 120 ||
      !Number.isInteger(breakMinutes) || breakMinutes < 5 || breakMinutes > 60) {
      message = 'Choose focus and break lengths within the shown ranges.';
      return false;
    }
    const plan = { day: day.toISOString(), dayKey: key, start, end, meetings,
      focusMinutes, breakMinutes,
      revisesEventID: existing.latestEventID || null,
      customBlocks: Object.hasOwn(value, 'customBlocks') ? value.customBlocks : base?.customBlocks ?? null };
    if (!existing.baseline) plan.provenance = provenance;
    const blocks = key === dayKey(instant.wall) ? suggest(plan) : null;
    return { key, plan, existing, blocks, start, end };
  }
  function installPlan(prepared, eventID) {
    const { key, plan, blocks, start, end } = prepared;
    if (key === dayKey(now().wall)) {
      latestPlanEventID = eventID; currentPlan = plan; plannedBlocks = blocks; bounds = { start, end };
      focusLength = plan.focusMinutes; breakLength = plan.breakMinutes;
    }
  }
  function savePlan(value = {}, provenance = 'explicit') {
    const instant = now(), prepared = preparePlan(value, provenance, instant);
    if (!prepared) return false;
    const event = append(prepared.existing.latestEventID ? 'dayPlanRevised' : 'dayPlan', prepared.plan, { occurredAt: instant.wall });
    installPlan(prepared, event.id);
    message = prepared.key === dayKey(instant.wall) ? "Today's plan saved." : 'Plan saved.';
    return true;
  }
  function suspend(reason, idleSeconds = 0) {
    if (timer.state.phase === 'idle' || suspended.has(reason)) return;
    const wasRunning = suspended.size === 0;
    if (wasRunning) {
      const instant = now(), proposed = timer.clone();
      proposed.pauseForSleep(instant); proposed.discountIdleFocus(idleSeconds);
      append(proposed.state.phase === 'focus' ? 'focusPaused' : 'breakProgress', sessionPayload(proposed), { occurredAt: instant.wall, source: 'system' });
      timer = proposed;
    }
    suspended.add(reason);
  }
  function resume(reason) {
    if (!suspended.has(reason)) return;
    if (suspended.size > 1 || timer.state.phase === 'idle') { suspended.delete(reason); return; }
    const instant = now(), proposed = timer.clone();
    const signals = proposed.resumeFromSleep(instant);
    append(proposed.state.phase === 'focus' ? 'focusResumed' : 'breakProgress', sessionPayload(proposed), { occurredAt: instant.wall, source: 'system' });
    timer = proposed; suspended.delete(reason); lastTick = instant;
    breakCompleteSequence += signals.filter(signal => signal === 'breakComplete').length;
  }
  function beginAway(reason, startedAt = now().wall, idleSeconds = 0) {
    if (dayEndedAt) return;
    startedAt = new Date(Math.max(startedAt.getTime(), dateForDayKey(dayKey(now().wall)).getTime()));
    if (timer.state.phase !== 'idle') startedAt = new Date(Math.max(startedAt.getTime(), ms(timer.state.startedAt)));
    if (timer.state.phase === 'break') {
      if (!breakAwayStartedAt) {
        breakElapsedAtAway = Math.max(0, timer.state.elapsedSeconds - idleSeconds);
        append('awayStarted', { reason, breakElapsedSeconds: breakElapsedAtAway }, { occurredAt: startedAt, source: 'inferred' });
        breakAwayStartedAt = startedAt;
      }
    } else if (!awayStartedAt) {
      append('awayStarted', { reason }, { occurredAt: startedAt, source: 'inferred' });
      awayStartedAt = startedAt;
      if (timer.state.phase === 'focus') suspend('idle', idleSeconds);
    }
    returnCandidateAt = null; returnActivityStartedAt = null;
    returnDismissed = false;
  }
  function inMeeting() {
    const time = now().wall.getTime();
    return (currentPlan?.meetings || []).some(meeting => ms(meeting.start) <= time && time < ms(meeting.end));
  }
  function beginReturn(manual = false) {
    if (returnDismissed || (!manual && inMeeting())) return;
    if (!returnCandidateAt) returnCandidateAt = now().wall;
    if (!returnActivityStartedAt) returnActivityStartedAt = now().wall;
  }
  function finishReturn(reason) {
    if (!returnCandidateAt) return;
    const returnedAt = returnActivityStartedAt || (reason === 'confirmed return' ? now().wall : returnCandidateAt);
    if (awayStartedAt) finishAway(reason);
    else if (timer.state.phase === 'break') {
      const awaySeconds = breakAwayStartedAt ? (returnedAt - breakAwayStartedAt) / 1000 : 0;
      finishBreak(true, reason === 'confirmed return' || awaySeconds >= 180, returnedAt);
      message = awaySeconds >= 180 ? 'Your break ended when you returned to focus.' : 'Break ended without enough away time to count as a real break.';
    }
    returnCandidateAt = null; returnActivityStartedAt = null;
    returnDismissed = false;
  }
  function finishAway(reason) {
    if (!awayStartedAt) return;
    const instant = now();
    const returnedAt = returnActivityStartedAt || instant.wall;
    const activeSeconds = Math.max(0, (instant.wall - returnedAt) / 1000);
    const returnInstant = { wall: returnedAt, monotonicSeconds: instant.monotonicSeconds - activeSeconds };
    const awaySeconds = Math.max(0, (returnedAt - awayStartedAt) / 1000);
    const completedRest = awaySeconds >= qualifyingRestSeconds(breakLength);
    if (completedRest && timer.state.phase === 'focus' && suspended.size === 1 && suspended.has('idle')) {
      const proposed = timer.clone();
      const { sessionID, targetSeconds, elapsedSeconds } = proposed.state;
      proposed.end(returnInstant);
      const nextID = proposed.start('focus', focusTarget(focusLength * 60, returnInstant.wall), returnInstant);
      proposed.advance(instant);
      store.transaction(() => {
        append('awayEnded', { reason, countedAsBreak: true, restSeconds: awaySeconds, targetSeconds: breakLength * 60,
          followsSessionID: sessionID }, { occurredAt: returnedAt, source: 'inferred' });
        append('focusEnded', { sessionID, targetSeconds, elapsedSeconds }, { occurredAt: awayStartedAt, source: 'system' });
        append('focusStarted', { sessionID: nextID, targetSeconds: proposed.state.targetSeconds, reason: 'afterBreak' }, { occurredAt: returnedAt, source: 'system' });
      });
      timer = proposed;
      suspended.clear();
      lastTick = instant;
      lastCheckpoint = instant.wall.getTime();
      writeLease();
      message = 'Your time away counted as a break. Focus restarted.';
    } else {
      append('awayEnded', { reason }, { occurredAt: returnedAt, source: 'inferred' });
      if (suspended.has('idle')) {
        const proposed = timer.clone();
        proposed.resumeFromSleep(returnInstant);
        const resumedPayload = sessionPayload(proposed);
        proposed.advance(instant);
        append('focusResumed', resumedPayload, { occurredAt: returnedAt, source: 'system' });
        timer = proposed; suspended.delete('idle'); lastTick = instant;
      }
    }
    awayStartedAt = null;
    lastCheckpoint = instant.wall.getTime();
  }
  // The user says idle time during focus was work (for example, watching a video), not a break.
  // Ends the away interval without counting it as rest and gives its time back to the same focus session.
  function notABreak() {
    if (!awayStartedAt || timer.state.phase !== 'focus' || suspended.size !== 1 || !suspended.has('idle')) return;
    const instant = now(), proposed = timer.clone();
    const awaySeconds = Math.max(0, (instant.wall - awayStartedAt) / 1000);
    const segmentStartedAt = proposed.state.observedSegmentStartedAt;
    proposed.resumeFromSleep(instant);
    proposed.creditFocus(awaySeconds);
    // The idle pause never happened, so the running stretch of focus keeps its original start.
    proposed.state.observedSegmentStartedAt = segmentStartedAt;
    store.transaction(() => {
      append('awayEnded', { reason: 'not a break', notBreak: true }, { occurredAt: instant.wall, source: 'user' });
      append('focusResumed', sessionPayload(proposed), { occurredAt: instant.wall, source: 'user' });
    });
    timer = proposed; suspended.clear(); lastTick = instant;
    awayStartedAt = null; returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false;
    lastCheckpoint = instant.wall.getTime();
    writeLease();
    message = 'Not counted as a break. That time stayed in your focus session.';
  }
  // ---- The sky-island game. The rules in ./game are pure: the core gives them its clock (including
  // development offsets), local days, and saved plans, and writes the records they return.

  // Keeps the latest saved plan event for each local day. Events are append-only, so only rows newer
  // than the last one indexed are looked at. Never call this with rows from an open transaction.
  function indexPlans(events) {
    let i = events.length;
    while (i > 0 && events[i - 1].sequence > planIndexedThrough) i--;
    for (; i < events.length; i++) {
      const event = events[i];
      if (!['dayPlan', 'dayPlanRevision', 'dayPlanRevised'].includes(event.kind) || !event.payload) continue;
      const day = event.payload.dayKey || (Number.isNaN(Date.parse(event.payload.day)) ? null : dayKey(new Date(event.payload.day)));
      if (day) planIndex.set(day, event);
    }
    if (events.length) planIndexedThrough = Math.max(planIndexedThrough, events[events.length - 1].sequence);
  }
  // { focusSessions, focusMinutes, breakMinutes } for a day's current plan; focusSessions counts the
  // planned focus blocks, worked out the same way as Today's planned timeline.
  function planSummary(key) {
    const event = planIndex.get(key);
    if (!event) return null;
    if (!planSummaries.has(event.id)) {
      const plan = { ...event.payload, dayKey: key };
      // Today's latest plan already has its blocks worked out (suggest takes about 20 ms).
      const blocks = event.id === latestPlanEventID && key === dayKey(now().wall) && Array.isArray(plannedBlocks) ? plannedBlocks : suggest(plan);
      planSummaries.set(event.id, { focusSessions: blocks.filter(block => block.kind === 'focus').length,
        focusMinutes: Number(plan.focusMinutes) || 0, breakMinutes: Number(plan.breakMinutes) || 0 });
    }
    return planSummaries.get(event.id);
  }
  // withDefaults: for the page only, a day without a saved plan uses today's default lengths, so
  // "next up" talks about the user's usual session. Grants use saved plans only.
  function gameContext(instant, withDefaults = false) {
    const todayKey = dayKey(instant.wall);
    return { now: instant.wall.toISOString(), todayKey, dayKeyOf: value => dayKey(new Date(value)),
      planFor: key => planSummary(key) || (withDefaults && key === todayKey
        ? { focusSessions: 0, focusMinutes: defaultFocusLength, breakMinutes: defaultBreakLength } : null) };
  }
  function writeGameRecords(records, source = 'system') {
    store.transaction(() => {
      for (const record of records) {
        if (store.hasUniqueKey(record.uniqueKey)) continue;
        append(record.kind, record.payload, { occurredAt: record.occurredAt, source, uniqueKey: record.uniqueKey });
      }
    });
  }
  // Starts the game once per database, then writes every grant that is due, together in one transaction.
  // Runs after every action and tick (and so after the day changes) and at startup. It does nothing when
  // neither the saved history nor the day changed. A failure is logged once and tried again after the
  // next change; the timer keeps working.
  function syncGame() {
    const instant = now(), key = `${dayKey(instant.wall)}:${store.lastSequence()}`;
    if (key === gameSyncKey || key === gameFailedKey) return;
    try {
      if (!gameStarted && !store.hasUniqueKey('game:started')) writeGameRecords([game.startRecord(gameContext(instant))]);
      gameStarted = true;
      const events = allEvents();
      indexPlans(events);
      const due = game.dueGrants(events, gameContext(instant));
      if (due.length) writeGameRecords(due);
      gameSyncKey = `${dayKey(instant.wall)}:${store.lastSequence()}`;
      gameFailedKey = '';
    } catch (error) {
      if (gameFailedKey !== key) console.error('Could not save island records; trying again after the next change:', error);
      gameFailedKey = key;
    }
  }
  // One tap on the check-in card: { token, pick }. pick is a job or blueprint id from the card, or null
  // to collect without choosing. Returns true when a check-in was saved. A card the rules refuse shows
  // their message instead; a second tap on a card that was already saved changes nothing.
  function checkIn(value) {
    const input = value && typeof value === 'object' ? value : {};
    const token = typeof input.token === 'string' ? input.token : null, pick = input.pick ?? null;
    syncGame();
    const events = allEvents();
    if (token && events.findLast(event => event.kind === 'gameCheckedIn')?.payload?.token === token) return false;
    indexPlans(events);
    let record;
    try { record = game.checkInRecord(events, gameContext(now()), { token, pick }); }
    catch (error) {
      if (error?.constructor === Error) message = error.message;
      else { console.error('Island check-in failed:', error); message = 'The island could not save that. Please try again.'; }
      return false;
    }
    if (store.hasUniqueKey(record.uniqueKey)) return false;
    writeGameRecords([record], 'user');
    message = '';
    return true;
  }

  // Development scenarios for the island tour. They press the same paths as the buttons, move the
  // Testing clock like the advance action, and bring the game up to date after every step as the app does.
  function devAdvance(minutes) { clockOffset += minutes * 60000; lastTick = now(); tick(); }
  function scenarioStep(work) { work(); syncGame(); }
  function scenarioNextMorning() {
    if (timer.state.phase !== 'idle') scenarioStep(endDay);
    const wall = now().wall, morning = new Date(wall.getFullYear(), wall.getMonth(), wall.getDate() + 1, 9, 0, 0, 0);
    scenarioStep(() => devAdvance((morning - wall) / 60000));
  }
  // Taps a waiting check-in card, choosing its first option. Collects without choosing if the rules refuse it.
  function scenarioCheckIn() {
    const events = allEvents();
    indexPlans(events);
    const card = game.gameState(events, gameContext(now()))?.checkIn;
    if (!card) return 0;
    const option = card.choice?.options?.[0];
    const pick = option ? option.job ?? option.blueprint ?? null : null;
    return checkIn({ token: card.token, pick }) || (pick !== null && checkIn({ token: card.token, pick: null })) ? 1 : 0;
  }
  // A steady day: start Today's suggested focus at 9 AM, follow the plan's focus blocks with real breaks,
  // tap each check-in after a break, end the day, and tap the end-of-day check-in.
  function scenarioDay(tapCheckIns = true) {
    let taps = 0;
    scenarioStep(() => start('focus', focusLength * 60, undefined, 'suggestion'));
    const sessions = Math.max(1, plannedBlocks.filter(block => block.kind === 'focus').length);
    for (let session = 1; session <= sessions; session++) {
      scenarioStep(() => devAdvance(focusLength));
      if (session === sessions) break;
      scenarioStep(() => start('break', breakLength * 60));
      scenarioStep(() => devAdvance(breakLength));
      scenarioStep(() => finishBreak());
      if (tapCheckIns) taps += scenarioCheckIn();
    }
    scenarioStep(endDay);
    if (tapCheckIns) taps += scenarioCheckIn();
    return taps;
  }
  function gameScenario(name) {
    if (name === 'game-first-break') {
      if (allEvents().some(event => event.kind === 'gameGranted' || event.kind === 'gameCheckedIn')) {
        throw new Error('This scenario needs a fresh island. Start the app with scripts/run-dev.sh --reset first.');
      }
      scenarioNextMorning();
      scenarioStep(() => start('focus', focusLength * 60, undefined, 'suggestion'));
      scenarioStep(() => devAdvance(focusLength));
      scenarioStep(() => start('break', breakLength * 60));
      scenarioStep(() => devAdvance(breakLength));
      scenarioStep(() => finishBreak());
      message = 'One focus session and one real break are done. The first check-in is waiting.';
    } else {
      const days = name === 'game-week' ? 7 : 30;
      let taps = 0;
      for (let day = 0; day < days; day++) { scenarioNextMorning(); taps += scenarioDay(); }
      scenarioNextMorning();
      message = `${days} steady days played, with ${taps} check-ins.`;
    }
    page = 'today';
  }

  // ---- The game demo's steps (demo app only). Each step presses the same actions as Today's buttons and the
  // development clock, one after another, and brings the game up to date after each one, as the app does. So
  // every step saves exactly the records the real flow would. A check-in card that is waiting stays put, as in
  // the real app: whatever comes next is added to it. Times are in minutes.
  const DEMO_MINUTES = { break: 15, shortWork: 20, shortBreak: 4, away: 15 };
  function demoCard() { return committedView(now()).gameView?.checkIn || null; }
  function demoDay(events, wall) {
    const started = events.find(event => event.kind === 'gameStarted');
    const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return Math.round((midnight(wall) - midnight(started ? new Date(started.occurredAt) : wall)) / 86400000) + 1;
  }
  // How the break that just ended went, from its saved record, judged like the timer and the game judge it.
  function demoBreakNote(since) {
    const ended = allEvents().findLast(event => event.sequence > since && event.kind === 'breakEnded');
    if (!ended) return 'no break was recorded';
    const minutes = Math.round((Number(ended.payload?.elapsedSeconds) || 0) / 60);
    const needed = qualifyingRestSeconds(breakLength) / 60;
    return `${minutes >= needed ? 'a real break' : `too short to count as a real break (needs ${needed} min)`}; focus started again`;
  }
  function demoCardNote(tokenBefore) {
    const card = demoCard();
    if (!card) return '';
    const what = card.choice?.kind === 'job' ? 'pick a job' : card.choice?.kind === 'build' ? 'pick something to build' : 'collect';
    if (!tokenBefore) return ` · new card: ${what}`;
    return card.token === tokenBefore ? ` · card still waiting: ${what}` : ` · the waiting card grew: ${what}`;
  }
  function demoStep(step) {
    if (!demo) throw new Error('Demo steps need the game demo: scripts/run-dev.sh --demo.');
    const run = (name, value) => scenarioStep(() => perform(name, value));
    const since = store.lastSequence(), tokenBefore = demoCard()?.token || null;
    // Time inside today: refused once the day is done or if it would cross midnight (the app keeps sessions
    // inside one day). Time away that is somehow still open is closed first, as I'm back would.
    const inDay = minutes => {
      if (dayEndedAt) throw new Error('The day is done. Press Next morning.');
      const wall = now().wall;
      if (dayKey(new Date(wall.getTime() + minutes * 60000)) !== dayKey(wall)) {
        throw new Error('That would run past midnight, which the app does not handle. Press End the day, then Next morning.');
      }
      if (awayStartedAt || breakAwayStartedAt) run('confirm-return');
    };
    // Finish break starts focus by itself; otherwise Start focus.
    const ensureFocus = () => {
      if (timer.state.phase === 'break') run('finish-break');
      else if (timer.state.phase === 'idle') run('start-focus');
    };
    const focusNow = () => ({ worked: Math.floor(timer.state.elapsedSeconds / 60), target: Math.round(timer.state.targetSeconds / 60) });
    message = '';
    let text;
    switch (step) {
      case 'work': {
        const minutes = focusLength;
        inDay(minutes);
        ensureFocus();
        run('advance', minutes);
        const { worked, target } = focusNow();
        text = `Worked ${minutes} min → ${timer.state.isDue ? 'break due' : 'focus running'}${worked === target ? '' : ` (focus ${worked} min, target ${target})`}`;
        break;
      }
      case 'break':
        inDay(DEMO_MINUTES.break);
        if (timer.state.phase !== 'break') run('start-break');
        run('advance', DEMO_MINUTES.break);
        run('finish-break');
        text = `Break ${DEMO_MINUTES.break} min → ${demoBreakNote(since)}`;
        break;
      case 'work-interrupted': {
        inDay(DEMO_MINUTES.shortWork);
        ensureFocus();
        run('advance', DEMO_MINUTES.shortWork);
        const { worked, target } = focusNow();
        run('start-break');
        text = `Worked ${DEMO_MINUTES.shortWork} min, then took a break${worked < target ? ' early' : ''} (focus ${worked} of ${target} min) → on a break now`;
        break;
      }
      case 'break-interrupted':
        inDay(DEMO_MINUTES.shortBreak);
        if (timer.state.phase !== 'break') run('start-break');
        run('advance', DEMO_MINUTES.shortBreak);
        run('finish-break');
        text = `Came back from the break after ${DEMO_MINUTES.shortBreak} min → ${demoBreakNote(since)}`;
        break;
      case 'away': {
        inDay(DEMO_MINUTES.away);
        const during = timer.state.phase;
        run('away');
        run('advance', DEMO_MINUTES.away);
        run('confirm-return');
        const counted = allEvents().findLast(event => event.sequence > since && event.kind === 'awayEnded')?.payload?.countedAsBreak;
        text = `Stepped away ${DEMO_MINUTES.away} min, then I'm back → ${during === 'focus'
          ? counted ? 'counted as a break; focus started again' : 'too short to count as a break; focus went on'
          : during === 'break' ? demoBreakNote(since) : 'nothing was running, so it is not a break'}`;
        break;
      }
      case 'end-day':
        if (dayEndedAt) throw new Error('The day is already done. Press Next morning.');
        run('end-day');
        text = 'Ended the day';
        break;
      case 'next-morning': {
        const running = !dayEndedAt && timer.state.phase !== 'idle';
        if (running) run('end-day');
        const wall = now().wall;
        const planned = planForDay(allEvents(), dayKey(morningAfter(wall))).current?.start;
        const morning = planned ? new Date(planned) : morningAfter(wall, defaultStartTime);
        run('advance', (morning - wall) / 60000);
        text = `${running ? 'Ended the day (a session was running), then moved' : 'Moved'} to the next morning`;
        break;
      }
      case 'week': case 'month': {
        // The game-week and game-month scenarios' steady days. They start today when nothing has happened yet
        // this morning (as after Next morning or a fresh start), otherwise tomorrow, and end on the next morning.
        const days = step === 'week' ? 7 : 30, wall = now().wall, key = dayKey(wall);
        const freshToday = !dayEndedAt && timer.state.phase === 'idle' && wall.getHours() < 12 && !allEvents()
          .some(event => ['focusStarted', 'breakStarted'].includes(event.kind) && dayKey(new Date(event.occurredAt)) === key);
        let taps = 0;
        for (let day = 0; day < days; day++) {
          if (day || !freshToday) scenarioNextMorning();
          taps += scenarioDay();
        }
        scenarioNextMorning();
        text = `Played ${days} steady days from ${freshToday ? 'today' : 'tomorrow'}, picking the first choice on each of ${taps} cards`;
        break;
      }
      default: throw new Error(`Unknown demo step: ${step}`);
    }
    addDemoLog(text + demoCardNote(tokenBefore));
    saveDemoClock();
    page = 'today';
  }
  function addDemoLog(text) {
    const wall = now().wall;
    demoLog.push({ at: wall.toISOString(), day: demoDay(allEvents(), wall), text });
    if (demoLog.length > 12) demoLog.splice(0, demoLog.length - 12);
  }

  function committedView(instant) {
    const todayKey = dayKey(instant.wall);
    const key = `${todayKey}:${store.lastSequence()}:${bounds.start}:${bounds.end}:${defaultFocusLength}:${defaultBreakLength}`;
    if (key === committedCacheKey) return committedCache;
    const events = allEvents();
    const today = project(events, instant.wall, false);
    const yesterday = project(events, new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate() - 1), false);
    const tomorrowKey = dayKey(new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate() + 1));
    const todayPlanState = planForDay(events, todayKey), tomorrowPlanState = planForDay(events, tomorrowKey);
    const defaultDayPath = todayPlanState.current ? null : { start: bounds.start, end: bounds.end,
      timeline: suggest({ ...bounds, focusMinutes: defaultFocusLength, breakMinutes: defaultBreakLength, meetings: [] }) };
    const tomorrowBlocks = tomorrowPlanState.current ? suggest(tomorrowPlanState.current) : [];
    const actual = today.actual.sort((a, b) => ms(a.start) - ms(b.start));
    const history = events.filter(item => sameDay(item.occurredAt, instant.wall) && eventKinds.has(item.kind)).reverse().map(item => ({
      id: item.id,
      title: item.payload?.interrupted ? (item.kind === 'focusEnded' ? 'Focus stopped when app closed' : 'Break stopped when app closed') : historyTitles[item.kind],
      date: item.occurredAt, kind: item.kind,
    }));
    let gameView = null;
    try { indexPlans(events); gameView = game.gameState(events, gameContext(instant, true)); }
    catch (error) { console.error('Could not work out the island state:', error); }
    committedCacheKey = key;
    committedCache = { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState, defaultDayPath,
      tomorrowBlocks, actual, history, gameView };
    return committedCache;
  }
  // History's recent days: the RECENT_DAYS days before today, newest first, each { dayKey, focusMinutes,
  // breakMinutes, game } (game: the island summary from game/days.js, or null). Worked out only while History
  // is open. A finished day's minutes don't change, so they are kept until the day changes; the island part
  // is cheap and is redone after each saved change.
  const RECENT_DAYS = 7;
  let recentMinutesKey = '', recentMinutes = [], recentDaysKey = '', recentDaysCache = null;
  function recentDays(instant) {
    const view = committedView(instant);
    if (recentDaysKey === committedCacheKey) return recentDaysCache;
    const wall = instant.wall;
    const days = Array.from({ length: RECENT_DAYS }, (_, index) => new Date(wall.getFullYear(), wall.getMonth(), wall.getDate() - 1 - index));
    const keys = days.map(dayKey);
    if (recentMinutesKey !== view.todayKey) {
      recentMinutes = days.map(day => {
        const { focusSeconds, breakSeconds } = project(view.events, day, false);
        return { focusMinutes: Math.floor(focusSeconds / 60), breakMinutes: Math.floor(breakSeconds / 60) };
      });
      recentMinutesKey = view.todayKey;
    }
    // Past days show the plan match saved in their day grants, so they skip plan lookups (each can take 20 ms).
    const { planFor: _plans, ...context } = gameContext(instant);
    let summaries = null;
    try { summaries = game.daySummaries(view.events, context, keys); }
    catch (error) { console.error('Could not work out the island days:', error); }
    recentDaysCache = keys.map((key, index) => ({ dayKey: key, ...recentMinutes[index], game: summaries?.[index] || null }));
    recentDaysKey = committedCacheKey;
    return recentDaysCache;
  }
  function status() {
    syncDay();
    const instant = now();
    const { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState, defaultDayPath,
      tomorrowBlocks, actual, history, gameView } = committedView(instant);
    const plan = currentPlan, blocks = plannedBlocks;
    const liveAwayEnd = returnActivityStartedAt || instant.wall;
    const liveAwaySeconds = awayStartedAt ? Math.max(0, (liveAwayEnd - awayStartedAt) / 1000) : 0;
    const liveAway = liveAwaySeconds ? { kind: timer.state.phase === 'focus' ? 'break' : 'away',
      start: awayStartedAt.toISOString(), end: liveAwayEnd.toISOString(),
      observedSeconds: liveAwaySeconds, inferred: timer.state.phase === 'focus', inProgress: true } : null;
    const liveBreakStart = timer.state.phase === 'break'
      ? breakAwayStartedAt ? timer.state.startedAt : timer.state.observedSegmentStartedAt || timer.state.startedAt : null;
    const liveBreakEnd = returnActivityStartedAt || instant.wall;
    const liveBreakWallSeconds = liveBreakStart ? Math.max(0, (liveBreakEnd - new Date(liveBreakStart)) / 1000) : 0;
    const liveBreakSeconds = timer.state.phase === 'break' ? Math.min(liveBreakWallSeconds, Math.max(0,
      timer.state.elapsedSeconds - (returnActivityStartedAt ? (instant.wall - returnActivityStartedAt) / 1000 : 0),
      breakAwayStartedAt ? breakElapsedAtAway + (liveBreakEnd - breakAwayStartedAt) / 1000 : 0)) : 0;
    const liveBreak = liveBreakSeconds > 0 ? { kind: 'break', start: liveBreakStart,
      end: liveBreakEnd.toISOString(), observedSeconds: liveBreakSeconds, inProgress: true } : null;
    const actualWithLiveAway = liveAway || liveBreak ? [...actual, ...[liveAway, liveBreak].filter(Boolean)].sort((a, b) => ms(a.start) - ms(b.start)) : actual;
    const forecastKey = `${committedCacheKey}:${latestPlanEventID}:${timer.state.phase}:${timer.state.sessionID}:${timer.state.isSleeping}:${timer.state.isDue}:${timer.state.observedSegmentStartedAt}:${awayStartedAt?.getTime() || 0}:${returnCandidateAt?.getTime() || 0}:${returnActivityStartedAt?.getTime() || 0}:${Math.floor(instant.wall.getTime() / 60000)}`;
    if (forecastKey !== forecastCacheKey) {
      const forecastTimer = liveBreak ? { ...timer.state, isSleeping: false, observedSegmentStartedAt: liveBreakStart } : timer.state;
      forecastCache = forecast(plan, actualWithLiveAway, forecastTimer, instant.wall, events);
      if (liveBreak) forecastCache = forecastCache.flatMap(block => {
        if (!block.active || block.kind !== 'break' || ms(block.start) >= ms(liveBreak.end)) return [block];
        return ms(block.end) > ms(liveBreak.end) ? [{ ...block, start: liveBreak.end }] : [];
      });
      if (dayEndedAt) forecastCache = forecastCache.filter(block => block.actual);
      if (liveAway?.inferred || (liveBreak && timer.state.isDue)) {
        forecastCache = forecastCache.filter(block => !block.forecast || block.kind === 'meeting');
      }
      forecastCacheKey = forecastKey;
    }
    const endGuide = dayEndGuidance(plan, instant.wall, dayEndedAt, dayEndSnoozedUntil, timer.state.phase === 'focus' && !liveAway?.inferred);
    const guide = endGuide || (liveAway?.inferred
      ? { situation: 'runningBreak', title: returnCandidateAt ? 'Welcome back' : 'Break detected',
        detail: returnCandidateAt ? 'Your break appears to be ending. Confirm when you are ready to focus.' : 'Time away from your Mac is counting as a break.' }
      : todayGuidance(plan, forecastCache, actualWithLiveAway, instant.wall, timer.state));
    const currentMinutes = Math.floor(today.focusSeconds / 60);
    const breakMinutes = Math.floor((today.breakSeconds + (liveAway?.inferred ? liveAwaySeconds : 0) + liveBreakSeconds) / 60);
    const dayStart = new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate()).getTime();
    const liveStart = timer.state.phase === 'focus' && !timer.state.isSleeping
      ? Math.max(dayStart, ms(timer.state.observedSegmentStartedAt || timer.state.startedAt)) : 0;
    const liveFocus = liveStart && instant.wall.getTime() > liveStart
      ? { kind: 'focus', start: iso(liveStart), end: instant.wall.toISOString(),
        observedSeconds: (instant.wall.getTime() - liveStart) / 1000, inProgress: true } : null;
    const actualTimeline = liveFocus ? [...actualWithLiveAway, liveFocus] : actualWithLiveAway;
    // The forecast stops at the planned finish. Time recorded after it, such as work after "I'm working",
    // is added from the actual record so the day path can show it.
    const planEnd = plan ? ms(plan.end) : Infinity;
    const afterPlan = actualTimeline.filter(item => ms(item.end) > planEnd)
      .map(item => ({ ...item, start: iso(Math.max(planEnd, ms(item.start))), actual: true }));
    const workSpans = [
      ...actual.filter(item => item.kind === 'focus').map(item => [ms(item.start), ms(item.end)]),
      ...(plan?.meetings || []).map(item => [ms(item.start), ms(item.end)]),
      ...(timer.state.phase === 'focus' && !timer.state.isSleeping
        ? [[ms(timer.state.observedSegmentStartedAt || timer.state.startedAt), instant.wall.getTime()]] : []),
    ].map(([from, until]) => [Math.max(dayStart, from), Math.min(dayEndedAt ? ms(dayEndedAt) : instant.wall.getTime(), until)])
      .filter(([from, until]) => until > from).sort((a, b) => a[0] - b[0]);
    let workingMs = 0, coveredUntil = dayStart;
    for (const [from, until] of workSpans) {
      workingMs += Math.max(0, until - Math.max(from, coveredUntil));
      coveredUntil = Math.max(coveredUntil, until);
    }
    const display = guide.situation === 'wrappingUp' ? countDown((ms(dayEndSnoozedUntil) - instant.wall) / 1000) : liveAway?.inferred ? countDown(liveAwaySeconds) : guide.situation === 'working'
      ? countDown((ms(guide.action.until) - instant.wall) / 1000)
      : timer.state.phase === 'idle' ? `${String(focusLength).padStart(2, '0')}:00` : countDown(timer.remainingSeconds);
    return { page, profile, canBackdateStart: canBackdateStart(instant.wall), dayEndedAt, dayEndSnoozedUntil, dayEnding: Boolean(endGuide),
      dayFinishPassed: instant.wall >= new Date(plan?.end || bounds.end),
      todayReflection: events.findLast(event => event.kind === 'reflection' && event.payload && sameDay(event.payload.day, instant.wall))?.payload.note || '',
      phase: timer.state.phase, timer: { ...timer.state, remainingSeconds: timer.remainingSeconds }, countdown: display,
      currentWallTime: instant.wall.getTime() / 1000, currentWallTimeISO: instant.wall.toISOString(),
      todaySituation: guide.situation, todayTitle: guide.title, todayProposedSeconds: guide.action?.until ? Math.max(0, (ms(guide.action.until) - instant.wall) / 1000) : 0,
      timerTargetSeconds: timer.state.targetSeconds, breakDue: timer.state.phase === 'focus' && timer.state.isDue && !liveAway?.inferred && !endGuide,
      inferredBreakActive: Boolean(liveAway?.inferred), suspended: timer.state.isSleeping,
      reminderSequence, breakCompleteSequence,
      returnPrompt: returnCandidateAt && !endGuide && !inMeeting() ? { since: returnCandidateAt.toISOString(),
        activeSeconds: returnActivityStartedAt ? Math.max(0, (instant.wall - returnActivityStartedAt) / 1000) : 0,
        autoEndAfterSeconds: RETURN_ACTIVITY_SECONDS,
        kind: awayStartedAt ? 'inferred' : 'started' } : null,
      focusMinutesToday: currentMinutes, workingMinutesToday: Math.floor(workingMs / 60000), breakMinutesToday: breakMinutes, focusLength, breakLength,
      defaultFocusLength, defaultBreakLength, defaultStartTime, defaultEndTime,
      dayStart: plan?.start || bounds.start, dayEnd: plan?.end || bounds.end,
      todayKey, tomorrowKey, dayPlans: { [todayKey]: todayPlanState,
        [tomorrowKey]: { ...tomorrowPlanState, suggestedTimeline: tomorrowBlocks } },
      savedReflection, statusMessage: message,
      plan, defaultDayPath, plannedTimeline: blocks, forecastTimeline: afterPlan.length ? [...forecastCache, ...afterPlan] : forecastCache, forecastRevision: forecastCacheKey,
      actualTimeline,
      yesterdayTimeline: yesterday.actual, yesterdayFocusMinutes: Math.floor(yesterday.focusSeconds / 60),
      yesterdayBreakMinutes: Math.floor(yesterday.breakSeconds / 60), guidance: guide, history,
      recentDays: page === 'history' ? recentDays(instant) : null,
      events, notificationsEnabled, activityDelaySeconds, game: gameView,
      todayGuidance: guide, canSwitchProfiles: !development, developmentMode: development,
      demo: demo ? { day: demoDay(events, instant.wall), log: demoLog.slice(-6) } : null };
  }
  // Runs one command, then writes any game records it made due (also after a failed command, since
  // some commands save in steps), then returns the status. A tick returns nothing.
  function action(name, value) {
    if (!development && ['advance', 'wall-jump', 'away', 'return', 'sleep-wake', 'scenario', 'dev-scenario',
      'dev-advance', 'dev-away', 'dev-return', 'dev-sleep-wake', 'day-time', 'demo', 'dev-demo'].includes(name)) {
      throw new Error('Development action unavailable.');
    }
    let showStatus;
    try { showStatus = perform(name, value); }
    finally { syncGame(); }
    return showStatus ? status() : undefined;
  }
  // Returns true when the caller should get a fresh status.
  function perform(name, value) {
    syncDay();
    if (dayEndedAt && ['away', 'return', 'sleep-wake', 'sleep', 'wake', 'lock', 'unlock', 'dev-away', 'dev-return', 'dev-sleep-wake', 'confirm-return'].includes(name)) return true;
    switch (name) {
      case 'tick': tick(Number(value) || 0); return false;
      case 'navigate': page = viewPages.has(String(value)) ? String(value) : 'today'; break;
      case 'start-focus': start('focus', Number(value?.targetSeconds || value?.planDraft?.focusMinutes * 60 || focusLength * 60), value?.planDraft, 'manual', value?.startedAt); break;
      case 'end-day': endDay(); break;
      case 'keep-working': keepWorking(value); break;
      case 'snooze-end-day': {
        if (dayEndedAt || !currentPlan || now().wall < new Date(currentPlan.end)) break;
        const minutes = Number(value?.minutes ?? value ?? 5);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60 || minutes % 5 !== 0) throw new Error('Snooze for 5 to 60 minutes in five-minute steps.');
        const instant = now(), until = new Date(instant.wall.getTime() + minutes * 60000).toISOString();
        append('dayEndSnoozed', { dayKey: dayKey(instant.wall), minutes, until }, { occurredAt: instant.wall });
        dayEndSnoozedUntil = until; message = ''; break;
      }
      case 'end-focus': endFocus(); break;
      case 'start-break': start('break', Number(value?.targetSeconds || breakLength * 60)); break;
      case 'start-long-break': start('break', 30 * 60); break;
      case 'finish-break': finishBreak(); break;
      case 'confirm-return': if (!returnCandidateAt && (awayStartedAt || breakAwayStartedAt)) { returnDismissed = false; beginReturn(true); } finishReturn('confirmed return'); break;
      case 'not-a-break': notABreak(); break;
      case 'keep-break': returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = true; break;
      case 'snooze': case 'snooze-break': {
        const instant = now();
        const minutes = Number(value?.minutes ?? value ?? 5);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60 || minutes % 5 !== 0) throw new Error('Snooze for 5 to 60 minutes in five-minute steps.');
        if (timer.state.phase === 'focus' && timer.state.isDue) {
          const proposed = timer.clone();
          proposed.snooze(focusTarget(minutes * 60, instant.wall) / 60, instant);
          store.transaction(() => {
            append('breakSnoozed', { ...sessionPayload(proposed), minutes }, { occurredAt: instant.wall });
            append('focusResumed', sessionPayload(proposed), { occurredAt: instant.wall });
          });
          timer = proposed;
          message = `Break moved ${minutes} minutes later.`;
        } else if (timer.state.phase === 'idle' && status().guidance.situation === 'rest') {
          start('focus', minutes * 60, undefined, 'snooze');
          message = `Focus started for ${minutes} minutes. Then take a break.`;
        }
        break;
      }
      case 'skip-break': {
        if (timer.state.phase !== 'focus' || !timer.state.isDue) break;
        const instant = now(), proposed = timer.clone();
        proposed.snooze(focusTarget(focusLength * 60, instant.wall) / 60, instant);
        store.transaction(() => {
          append('breakSkipped', { ...sessionPayload(proposed), minutes: focusLength }, { occurredAt: instant.wall });
          append('focusResumed', sessionPayload(proposed), { occurredAt: instant.wall });
        });
        timer = proposed;
        message = `Break skipped. Focus continues for ${focusLength} minutes.`;
        break;
      }
      case 'today-suggestion': {
        const proposed = status().guidance.action;
        if (proposed?.type === 'focus') start('focus', Math.max(1, (ms(proposed.until) - now().wall) / 1000), undefined, 'suggestion');
        else if (proposed?.type === 'rest') start('break', breakLength * 60);
        else if (proposed?.type === 'endDay') endDay();
        else if (proposed?.type === 'editPlan') page = 'plan';
        break;
      }
      case 'today-break': start('break', breakLength * 60); break;
      case 'save-plan': savePlan(value); break;
      case 'game-check-in':
        if (checkIn(value) && demo) {
          const { number, built, job } = allEvents().findLast(event => event.kind === 'gameCheckedIn').payload;
          addDemoLog(`Card ${number}: ${built ? `built ${built.name}` : job ? `chose a job: ${game.JOBS[job.job]?.name || job.job}` : 'collected'}`);
        }
        break;
      case 'flush-plan': break;
      case 'upsert-meeting': case 'meeting-window': case 'revise-meeting': {
        const meeting = typeof value === 'object' ? value : {};
        const name = String(meeting.title || 'Meeting').trim();
        const startAt = iso(meeting.start || meeting.startAt || new Date());
        const endAt = iso(meeting.end || (ms(startAt) + Number(meeting.duration || 30) * 60000));
        const key = meeting.dayKey || dayKey(now().wall);
        const source = planForDay(allEvents(), key).current || { ...dayBounds(dateForDayKey(key), defaultStartTime, defaultEndTime), meetings: [] };
        if (!name || ms(endAt) - ms(startAt) < 900000 || ms(startAt) < ms(source.start) || ms(endAt) > ms(source.end)) { message = 'Choose a meeting of at least 15 minutes within your day bounds.'; break; }
        const meetings = [...source.meetings]; const index = meetings.findIndex(item => item.id === meeting.id);
        const item = { id: meeting.id || uuid(), title: name, start: startAt, end: endAt };
        if (index < 0) meetings.push(item); else meetings[index] = item;
        savePlan({ ...source, dayKey: key, meetings, customBlocks: null }); break;
      }
      case 'remove-meeting': {
        const key = value?.dayKey || dayKey(now().wall), source = planForDay(allEvents(), key).current;
        if (source) savePlan({ ...source, dayKey: key, meetings: source.meetings.filter(item => item.id !== (value?.id || value)), customBlocks: null });
        break;
      }
      case 'edit-block': case 'edit-block-start': case 'edit-block-duration': {
        if (!currentPlan) break;
        const input = value || {}, blocks = plannedBlocks, index = Number(input.index);
        let updated = null;
        if (name === 'edit-block' && ['focus', 'break'].includes(input.kind) && blocks[index]?.kind !== 'meeting') { updated = blocks.map(item => ({ ...item })); updated[index].kind = input.kind; }
        else updated = editBlock(blocks, index, name === 'edit-block-duration' ? { durationMinutes: input.minutes ?? input.durationMinutes } : { start: input.start });
        if (updated) savePlan({ ...currentPlan, customBlocks: updated }); else message = 'That timing would move a meeting or cross a day boundary.';
        break;
      }
      case 'rhythm': savePlan({ ...(currentPlan || {}), focusMinutes: Number(value?.focusMinutes ?? value?.focus ?? focusLength), breakMinutes: Number(value?.breakMinutes ?? value?.break ?? breakLength), customBlocks: null }); break;
      case 'day-time': savePlan({ ...(currentPlan || {}), start: value?.start || bounds.start, end: value?.end || bounds.end, customBlocks: null }); break;
      case 'save-reflection': {
        const note = String(typeof value === 'string' ? value : value?.note || '').trim(); if (!note) break;
        const yesterday = new Date(now().wall); yesterday.setDate(yesterday.getDate() - 1);
        const day = value?.dayKey ? dateForDayKey(value.dayKey) : yesterday;
        const existing = allEvents().findLast(event => event.kind === 'reflection' && event.payload && sameDay(event.payload.day, day));
        if (note !== existing?.payload.note) append('reflection', { day: day.toISOString(), note });
        if (sameDay(day, yesterday)) savedReflection = note;
        message = 'Reflection saved.'; break;
      }
      case 'save-preferences': {
        const nextFocus = Number(value?.focusMinutes ?? value?.focusLength ?? defaultFocusLength);
        const nextBreak = Number(value?.breakMinutes ?? value?.breakLength ?? defaultBreakLength);
        const nextStart = value?.startTime ?? defaultStartTime;
        const nextEnd = value?.endTime ?? defaultEndTime;
        const nextActivityDelay = Number(value?.activityDelaySeconds ?? activityDelaySeconds);
        if (!Number.isInteger(nextFocus) || nextFocus < 5 || nextFocus > 120 ||
          !Number.isInteger(nextBreak) || nextBreak < 5 || nextBreak > 60) throw new Error('Choose valid default focus and break lengths.');
        if (!validStartTime(nextStart) || !validEndTime(nextEnd) || nextEnd <= nextStart) throw new Error('Choose default start from 7:00 AM and finish by 9:00 PM in 15-minute steps.');
        if (!Number.isInteger(nextActivityDelay) || nextActivityDelay < 1 || nextActivityDelay > 3600) throw new Error('Choose an activity delay from 1 to 3600 seconds.');
        const saved = store.saveSettings({ focusMinutes: nextFocus,
          breakMinutes: nextBreak,
          startTime: nextStart, endTime: nextEnd,
          notificationsEnabled: value?.notificationsEnabled ?? notificationsEnabled,
          activityDelaySeconds: nextActivityDelay });
        defaultFocusLength = saved.focusMinutes; defaultBreakLength = saved.breakMinutes;
        defaultStartTime = saved.startTime; defaultEndTime = saved.endTime;
        if (!currentPlan) { focusLength = defaultFocusLength; breakLength = defaultBreakLength; }
        if (!currentPlan) bounds = dayBounds(now().wall, defaultStartTime, defaultEndTime);
        notificationsEnabled = saved.notificationsEnabled;
        activityDelaySeconds = saved.activityDelaySeconds;
        message = 'Preferences saved.'; break;
      }
      case 'switch-profile': throw new Error('Profile switching requires a new database path from the main process.');
      case 'advance': devAdvance(Number(value?.minutes ?? value ?? 0)); break;
      case 'wall-jump': wallOffset += Number(value?.minutes ?? value ?? 0) * 60000; tick(); break;
      case 'away': beginAway('development'); break;
      case 'return': beginReturn(); break;
      case 'sleep-wake': beginAway('sleep'); suspend('sleep'); append('sleepStarted', sessionPayload(), { source: 'system' }); clockOffset += 20 * 60000; resume('sleep'); append('sleepEnded', sessionPayload(), { source: 'system' }); beginReturn(); break;
      case 'sleep': {
        const idleSeconds = Math.max(0, Number(value) || 0);
        beginAway('sleep', new Date(now().wall.getTime() - idleSeconds * 1000), idleSeconds);
        suspend('sleep'); if (timer.state.phase !== 'idle') append('sleepStarted', sessionPayload(), { source: 'system' }); break;
      }
      case 'wake': resume('sleep'); if (timer.state.phase !== 'idle') append('sleepEnded', sessionPayload(), { source: 'system' }); break;
      case 'publish-idle': writeLease('idle'); break;
      case 'lock': {
        const idleSeconds = Math.max(0, Number(value) || 0);
        beginAway('lock', new Date(now().wall.getTime() - idleSeconds * 1000), idleSeconds);
        suspend('locked'); break;
      }
      case 'unlock': resume('locked'); break;
      case 'scenario': case 'dev-scenario': {
        if (['game-first-break', 'game-week', 'game-month'].includes(value)) gameScenario(value);
        if (value === 'morning') { page = 'plan'; perform('upsert-meeting', { title: 'Team check-in', start: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(), duration: 30 }); }
        if (value === 'break-due' || value === 'breakDue') { if (timer.state.phase === 'break') finishBreak(false); if (timer.state.phase === 'focus') endFocus(); start('focus', focusLength * 60); perform('advance', focusLength); page = 'today'; }
        if (value === 'completed-day' || value === 'completedDay') { if (timer.state.phase === 'focus') endFocus(); if (timer.state.phase === 'break') finishBreak(false); start('focus', focusLength * 60); perform('advance', focusLength); start('break', breakLength * 60); perform('advance', breakLength); finishBreak(false); page = 'history'; }
        break;
      }
      case 'demo': case 'dev-demo': demoStep(String(value?.step ?? value ?? '')); break;
      case 'dev-advance': return perform('advance', value);
      case 'dev-away': return perform('away');
      case 'dev-return': return perform('return');
      case 'dev-sleep-wake': return perform('sleep-wake');
      default: throw new Error(`Unknown action: ${name}`);
    }
    return true;
  }
  function exportJSON(path) {
    const items = allEvents().map(event => ({ sequence: event.sequence, id: event.id, kind: event.kind,
      schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, recordedAt: event.recordedAt,
      timeZoneID: event.timeZoneID, source: event.source, payload: event.payload, uniqueKey: event.uniqueKey }));
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 2, settings: store.getSettings(), events: items }, null, 2));
    renameSync(temporary, path);
    return path;
  }
  async function backup(path) {
    mkdirSync(dirname(path), { recursive: true });
    await sqliteBackup(store.db, path);
    return path;
  }
  function close() {
    if (timer.state.phase !== 'idle' && !timer.state.isSleeping) {
      const instant = now(), proposed = timer.clone();
      const gap = lastTick ? instant.monotonicSeconds - lastTick.monotonicSeconds : Infinity;
      const wallGap = lastTick ? (instant.wall - lastTick.wall) / 1000 : Infinity;
      const observed = suspended.size === 0 && gap >= 0 && gap <= 10 && Math.abs(wallGap - gap) <= 10;
      if (observed) proposed.advance(instant);
      if (observed || suspended.size === 0) {
        append(timer.state.phase === 'focus' ? 'focusPaused' : 'breakProgress', sessionPayload(proposed),
          { occurredAt: observed ? instant.wall : lastTick?.wall || instant.wall, source: 'system' });
      }
    }
    writeLease('idle');
    if (demo) saveDemoClock();
    store.close();
  }
  return { status, action, exportJSON, backup, close };
}

module.exports = { createCore };
