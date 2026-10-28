const { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { backup: sqliteBackup } = require('node:sqlite');
const { openStore, uuid } = require('./store');
const { Timer } = require('./timer');
const { suggest, editBlock, project, forecast, sameDay, ms, iso, qualifyingRestSeconds } = require('./planning');
const { todayGuidance, dayEndGuidance } = require('./guidance');

const policy = Object.freeze({ version: 1, focusCreditsPerMinute: 1, maximumFocusMinutesPerSession: 25,
  minimumBreakMinutesForBonus: 3, breakBonus: 10, itemCosts: { plant: 35, cushion: 50, lamp: 75 } });
const shopItems = Object.freeze([
  { id: 'plant', name: 'Window plant', cost: 35 },
  { id: 'cushion', name: 'Soft cushion', cost: 50 },
  { id: 'lamp', name: 'Reading lamp', cost: 75 },
]);
const eventKinds = new Set(['focusStarted', 'focusEnded', 'breakStarted', 'breakEnded', 'breakDue', 'breakSkipped', 'dayEnded', 'reflection', 'itemPurchased', 'itemUnlocked']);
const viewPages = new Set(['today', 'plan', 'history', 'settings']);
const historyTitles = { focusStarted: 'Focus started', focusEnded: 'Focus finished', breakStarted: 'Break started', breakEnded: 'Break finished', breakDue: 'Break was due', breakSkipped: 'Break skipped', dayEnded: 'Day ended', reflection: 'Reflection saved', itemPurchased: 'Room item unlocked', itemUnlocked: 'Room item unlocked' };
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
const countDown = seconds => {
  const value = Number(seconds) || 0;
  const whole = Math.ceil(Math.abs(value));
  return `${value < 0 ? '-' : ''}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

function createCore({ dbPath, statusPath, profile = 'personal', development = false }) {
  if (!dbPath) throw new Error('dbPath is required.');
  if (development && profile !== 'testing') throw new Error('Development must use Testing.');
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
  let activityDelaySeconds = development ? 5 : 120;
  let previewFocusCredits = 1, previewBreakBonus = 10;
  let reminderSequence = 0, breakCompleteSequence = 0;
  let forecastCacheKey = '', forecastCache = [];
  let committedCacheKey = '', committedCache = null;
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
  function grant(reason, id, observedSeconds, targetSeconds, instant) {
    const amount = reason === 'focus' ? Math.floor(Math.max(0, Math.min(observedSeconds, targetSeconds, policy.maximumFocusMinutesPerSession * 60)) / 60) * policy.focusCreditsPerMinute
      : observedSeconds >= policy.minimumBreakMinutesForBonus * 60 ? policy.breakBonus : 0;
    if (amount > 0) append('rewardGranted', { amount, policyVersion: policy.version, sourceID: id, reason },
      { occurredAt: instant.wall, source: 'system', uniqueKey: `grant:${policy.version}:${reason}:${id}` });
  }
  function load(onStartup = false) {
    const events = allEvents(), instant = now();
    const key = dayKey(instant.wall);
    dayEndedAt = events.findLast(event => event.kind === 'dayEnded' && event.payload?.dayKey === key)?.occurredAt || null;
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
      store.transaction(() => {
        append(phase === 'focus' ? 'focusEnded' : 'breakEnded', payload,
          { occurredAt: observedAt, source: 'system' });
        if (phase === 'focus') grant('focus', sessionID, elapsedSeconds, targetSeconds,
          { wall: observedAt });
      });
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
        activityDelaySeconds: development ? 5 : 120 });
    }
    defaultFocusLength = prefs.focusMinutes; defaultBreakLength = prefs.breakMinutes;
    defaultStartTime = validStartTime(prefs.startTime) ? prefs.startTime : '09:00';
    defaultEndTime = validEndTime(prefs.endTime) ? prefs.endTime : '17:00';
    if (defaultEndTime <= defaultStartTime) { defaultStartTime = '09:00'; defaultEndTime = '17:00'; }
    const bounds = dayBounds(instant.wall, defaultStartTime, defaultEndTime);
    focusLength = defaultFocusLength; breakLength = defaultBreakLength;
    notificationsEnabled = prefs.notificationsEnabled;
    activityDelaySeconds = prefs.activityDelaySeconds ?? (development ? 5 : 120);
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
  let bounds = load(true);
  function syncDay() {
    if (sameDay(bounds.start, now().wall)) return;
    bounds = load();
  }
  function tick(idleSeconds = 0) {
    const instant = now(); syncDay();
    if (dayEndedAt) { lastTick = instant; writeLease('idle'); return; }
    if (!development && Number.isFinite(idleSeconds)) {
      if (idleSeconds >= activityDelaySeconds) {
        beginAway('idle', new Date(Math.max(observationStartedAt.getTime(), instant.wall.getTime() - idleSeconds * 1000)),
          Math.min(idleSeconds, (instant.wall - observationStartedAt) / 1000));
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
    if (gapPaused) message = 'An unobserved gap was paused, so it did not earn focus credit.';
    writeLease();
  }
  function start(phase, target, planDraft) {
    if (dayEndedAt) return;
    if (timer.state.phase !== 'idle' && !(phase === 'break' && timer.state.phase === 'focus')) return;
    const instant = now(), proposed = timer.clone();
    let finishedFocus = null;
    if (proposed.state.phase === 'focus') {
      const { sessionID, targetSeconds } = proposed.state;
      finishedFocus = { sessionID, targetSeconds, elapsedSeconds: proposed.end(instant) };
    }
    const id = proposed.start(phase, target, instant);
    const prepared = currentPlan ? null : preparePlan(planDraft || {}, planDraft ? 'explicit' : 'generated-default', instant);
    if (!currentPlan && !prepared) return;
    let planEvent;
    store.transaction(() => {
      if (prepared) planEvent = append(prepared.existing.latestEventID ? 'dayPlanRevised' : 'dayPlan', prepared.plan, { occurredAt: instant.wall });
      if (awayStartedAt) append('awayEnded', { reason: 'break started' }, { occurredAt: instant.wall, source: 'inferred' });
      if (finishedFocus) {
        append('focusEnded', finishedFocus, { occurredAt: instant.wall });
        grant('focus', finishedFocus.sessionID, finishedFocus.elapsedSeconds, finishedFocus.targetSeconds, instant);
      }
      append(phase === 'focus' ? 'focusStarted' : 'breakStarted',
        { sessionID: id, targetSeconds: proposed.state.targetSeconds }, { occurredAt: instant.wall });
    });
    if (prepared) installPlan(prepared, planEvent.id);
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
      grant('focus', sessionID, elapsedSeconds, targetSeconds, instant);
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
    const focusID = startNextFocus ? proposed.start('focus', focusLength * 60, endInstant) : null;
    if (focusID && returnedAt) proposed.advance(instant);
    store.transaction(() => {
      if (breakAwayStartedAt) append('awayEnded', { reason: 'break ended' }, { occurredAt: endInstant.wall, source: 'inferred' });
      if (confirm) append('breakConfirmed', payload, { occurredAt: endInstant.wall });
      append('breakEnded', payload, { occurredAt: endInstant.wall });
      if (confirm) grant('break', sessionID, elapsedSeconds, targetSeconds, endInstant);
      if (focusID) append('focusStarted', { sessionID: focusID, targetSeconds: proposed.state.targetSeconds }, { occurredAt: endInstant.wall });
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
        grant(phase, sessionID, elapsedSeconds, targetSeconds, instant);
      }
      append('dayEnded', { dayKey: dayKey(instant.wall) }, { occurredAt: instant.wall });
    });
    timer = proposed; dayEndedAt = instant.wall.toISOString(); suspended.clear();
    awayStartedAt = null; breakAwayStartedAt = null; breakElapsedAtAway = 0;
    returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = false;
    lastTick = instant; lastCheckpoint = instant.wall.getTime();
    page = 'today'; message = ''; writeLease('idle');
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
  function beginReturn() {
    if (returnDismissed) return;
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
      const nextID = proposed.start('focus', focusLength * 60, returnInstant);
      proposed.advance(instant);
      store.transaction(() => {
        append('awayEnded', { reason }, { occurredAt: returnedAt, source: 'inferred' });
        append('focusEnded', { sessionID, targetSeconds, elapsedSeconds }, { occurredAt: awayStartedAt, source: 'system' });
        grant('focus', sessionID, elapsedSeconds, targetSeconds, { wall: awayStartedAt });
        append('focusStarted', { sessionID: nextID, targetSeconds: proposed.state.targetSeconds }, { occurredAt: returnedAt, source: 'system' });
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
  function committedView(instant) {
    const todayKey = dayKey(instant.wall);
    const key = `${todayKey}:${store.lastSequence()}:${previewFocusCredits}:${previewBreakBonus}`;
    if (key === committedCacheKey) return committedCache;
    const events = allEvents();
    const today = project(events, instant.wall, false);
    const yesterday = project(events, new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate() - 1), false);
    const tomorrowKey = dayKey(new Date(instant.wall.getFullYear(), instant.wall.getMonth(), instant.wall.getDate() + 1));
    const todayPlanState = planForDay(events, todayKey), tomorrowPlanState = planForDay(events, tomorrowKey);
    const tomorrowBlocks = tomorrowPlanState.current ? suggest(tomorrowPlanState.current) : [];
    const actual = today.actual.sort((a, b) => ms(a.start) - ms(b.start));
    const balance = events.filter(event => ['rewardGranted', 'rewardDebited', 'rewardAdjusted'].includes(event.kind)).reduce((sum, event) => sum + (event.payload?.amount || 0), 0);
    const todayRewardEntries = events.filter(event => event.kind === 'rewardGranted'
      && sameDay(event.occurredAt, instant.wall) && Number(event.payload?.amount) > 0)
      .map(event => ({ id: event.id, amount: Number(event.payload.amount),
        activity: event.payload.reason === 'focus' ? 'Focus session'
          : event.payload.reason === 'break' ? 'Completed break' : 'Other activity',
        occurredAt: event.occurredAt })).reverse();
    const todayAcornsEarned = todayRewardEntries.reduce((sum, entry) => sum + entry.amount, 0);
    const unlocked = [...new Set(events.filter(event => ['itemPurchased', 'itemUnlocked'].includes(event.kind)).map(event => event.payload?.itemID).filter(Boolean))].sort();
    const history = events.filter(item => sameDay(item.occurredAt, instant.wall) && eventKinds.has(item.kind)).reverse().map(item => ({
      id: item.id,
      title: item.payload?.interrupted ? (item.kind === 'focusEnded' ? 'Focus stopped when app closed' : 'Break stopped when app closed') : historyTitles[item.kind],
      date: item.occurredAt, kind: item.kind,
    }));
    committedCacheKey = key;
    committedCache = { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState,
      tomorrowBlocks, actual, balance, todayAcornsEarned, todayRewardEntries,
      unlocked, history, rebalancePreview: rebalance(events) };
    return committedCache;
  }
  function status() {
    syncDay();
    const instant = now();
    const { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState,
      tomorrowBlocks, actual, balance, todayAcornsEarned, todayRewardEntries,
      unlocked, history, rebalancePreview } = committedView(instant);
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
    const endGuide = dayEndGuidance(plan, instant.wall, dayEndedAt, dayEndSnoozedUntil);
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
    return { page, profile, dayEndedAt, dayEndSnoozedUntil, dayEnding: Boolean(endGuide),
      todayReflection: events.findLast(event => event.kind === 'reflection' && event.payload && sameDay(event.payload.day, instant.wall))?.payload.note || '',
      phase: timer.state.phase, timer: { ...timer.state, remainingSeconds: timer.remainingSeconds }, countdown: display,
      currentWallTime: instant.wall.getTime() / 1000, currentWallTimeISO: instant.wall.toISOString(),
      todaySituation: guide.situation, todayTitle: guide.title, todayProposedSeconds: guide.action?.until ? Math.max(0, (ms(guide.action.until) - instant.wall) / 1000) : 0,
      timerTargetSeconds: timer.state.targetSeconds, breakDue: timer.state.phase === 'focus' && timer.state.isDue && !liveAway?.inferred && !endGuide,
      inferredBreakActive: Boolean(liveAway?.inferred), suspended: timer.state.isSleeping,
      reminderSequence, breakCompleteSequence,
      returnPrompt: returnCandidateAt && !endGuide ? { since: returnCandidateAt.toISOString(),
        activeSeconds: returnActivityStartedAt ? Math.max(0, (instant.wall - returnActivityStartedAt) / 1000) : 0,
        autoEndAfterSeconds: RETURN_ACTIVITY_SECONDS,
        kind: awayStartedAt ? 'inferred' : 'started' } : null,
      balance, todayAcornsEarned, todayRewardEntries,
      focusMinutesToday: currentMinutes, workingMinutesToday: Math.floor(workingMs / 60000), breakMinutesToday: breakMinutes, focusLength, breakLength,
      defaultFocusLength, defaultBreakLength, defaultStartTime, defaultEndTime,
      dayStart: plan?.start || bounds.start, dayEnd: plan?.end || bounds.end,
      todayKey, tomorrowKey, dayPlans: { [todayKey]: todayPlanState,
        [tomorrowKey]: { ...tomorrowPlanState, suggestedTimeline: tomorrowBlocks } },
      savedReflection, unlockedItems: unlocked, statusMessage: message,
      plan, plannedTimeline: blocks, forecastTimeline: forecastCache, forecastRevision: forecastCacheKey,
      actualTimeline: liveFocus ? [...actualWithLiveAway, liveFocus] : actualWithLiveAway,
      yesterdayTimeline: yesterday.actual, yesterdayFocusMinutes: Math.floor(yesterday.focusSeconds / 60),
      yesterdayBreakMinutes: Math.floor(yesterday.breakSeconds / 60), guidance: guide, history,
      events, policy, shopItems, notificationsEnabled, activityDelaySeconds, previewFocusCredits, previewBreakBonus, rebalancePreview,
      todayGuidance: guide, canSwitchProfiles: !development, developmentMode: development };
  }
  function rebalance(events) {
    const confirmed = new Set(events.filter(event => event.kind === 'breakConfirmed').map(event => event.payload?.sessionID));
    const focus = new Set(), breaks = new Set(); let credits = 0;
    for (const event of events) {
      const payload = event.payload;
      if (event.kind === 'focusEnded' && payload?.sessionID && !focus.has(payload.sessionID)) {
        focus.add(payload.sessionID); credits += Math.floor(Math.max(0, Math.min(payload.elapsedSeconds || 0, payload.targetSeconds, 1500)) / 60) * previewFocusCredits;
      } else if (event.kind === 'breakEnded' && payload?.sessionID && confirmed.has(payload.sessionID) && !breaks.has(payload.sessionID)) {
        breaks.add(payload.sessionID); credits += (payload.elapsedSeconds || 0) >= 180 ? previewBreakBonus : 0;
      }
    }
    const adjustments = events.filter(event => ['rewardDebited', 'rewardAdjusted'].includes(event.kind)).reduce((sum, event) => sum + (event.payload?.amount || 0), 0);
    const currentBalance = events.filter(event => ['rewardGranted', 'rewardDebited', 'rewardAdjusted'].includes(event.kind)).reduce((sum, event) => sum + (event.payload?.amount || 0), 0);
    return { currentBalance, projectedBalance: credits + adjustments, focusSessions: focus.size, confirmedBreaks: breaks.size };
  }
  function action(name, value) {
    if (!development && ['advance', 'wall-jump', 'away', 'return', 'sleep-wake', 'scenario', 'dev-scenario',
      'dev-advance', 'dev-away', 'dev-return', 'dev-sleep-wake', 'day-time'].includes(name)) {
      throw new Error('Development action unavailable.');
    }
    syncDay();
    if (dayEndedAt && ['away', 'return', 'sleep-wake', 'sleep', 'wake', 'lock', 'unlock', 'dev-away', 'dev-return', 'dev-sleep-wake', 'confirm-return'].includes(name)) return status();
    switch (name) {
      case 'tick': tick(Number(value) || 0); return;
      case 'navigate': page = viewPages.has(String(value)) ? String(value) : 'today'; break;
      case 'start-focus': start('focus', Number(value?.targetSeconds || value?.planDraft?.focusMinutes * 60 || focusLength * 60), value?.planDraft); break;
      case 'end-day': endDay(); break;
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
      case 'confirm-return': if (!returnCandidateAt && (awayStartedAt || breakAwayStartedAt)) { returnDismissed = false; beginReturn(); } finishReturn('confirmed return'); break;
      case 'keep-break': returnCandidateAt = null; returnActivityStartedAt = null; returnDismissed = true; break;
      case 'snooze': case 'snooze-break': {
        const instant = now();
        const minutes = Number(value?.minutes ?? value ?? 5);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60 || minutes % 5 !== 0) throw new Error('Snooze for 5 to 60 minutes in five-minute steps.');
        if (timer.state.phase === 'focus' && timer.state.isDue) {
          const proposed = timer.clone();
          proposed.snooze(minutes, instant);
          store.transaction(() => {
            append('breakSnoozed', { ...sessionPayload(proposed), minutes }, { occurredAt: instant.wall });
            append('focusResumed', sessionPayload(proposed), { occurredAt: instant.wall });
          });
          timer = proposed;
          message = `Break moved ${minutes} minutes later.`;
        } else if (timer.state.phase === 'idle' && status().guidance.situation === 'rest') {
          start('focus', minutes * 60);
          message = `Focus started for ${minutes} minutes. Then take a break.`;
        }
        break;
      }
      case 'skip-break': {
        if (timer.state.phase !== 'focus' || !timer.state.isDue) break;
        const instant = now(), proposed = timer.clone();
        proposed.snooze(focusLength, instant);
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
        if (proposed?.type === 'focus') start('focus', Math.max(1, (ms(proposed.until) - now().wall) / 1000));
        else if (proposed?.type === 'rest') start('break', breakLength * 60);
        else if (proposed?.type === 'endDay') endDay();
        else if (proposed?.type === 'editPlan') page = 'plan';
        break;
      }
      case 'today-break': start('break', breakLength * 60); break;
      case 'save-plan': savePlan(value); break;
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
      case 'purchase': {
        const itemID = typeof value === 'string' ? value : value?.id || value?.itemID;
        const cost = policy.itemCosts[itemID];
        if (cost && store.purchase(itemID, cost, now().wall)) message = `${itemID[0].toUpperCase() + itemID.slice(1)} unlocked.`;
        break;
      }
      case 'preview-rewards': previewFocusCredits = Number(value?.focusCreditsPerMinute ?? previewFocusCredits); previewBreakBonus = Number(value?.breakBonus ?? previewBreakBonus); break;
      case 'advance': clockOffset += Number(value?.minutes ?? value ?? 0) * 60000; lastTick = now(); tick(); break;
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
        if (value === 'morning') { page = 'plan'; action('upsert-meeting', { title: 'Team check-in', start: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(), duration: 30 }); }
        if (value === 'break-due' || value === 'breakDue') { if (timer.state.phase === 'break') finishBreak(false); if (timer.state.phase === 'focus') endFocus(); start('focus', focusLength * 60); action('advance', focusLength); page = 'today'; }
        if (value === 'completed-day' || value === 'completedDay') { if (timer.state.phase === 'focus') endFocus(); if (timer.state.phase === 'break') finishBreak(false); start('focus', focusLength * 60); action('advance', focusLength); start('break', breakLength * 60); action('advance', breakLength); finishBreak(false); page = 'history'; }
        break;
      }
      case 'dev-advance': return action('advance', value);
      case 'dev-away': return action('away');
      case 'dev-return': return action('return');
      case 'dev-sleep-wake': return action('sleep-wake');
      default: throw new Error(`Unknown action: ${name}`);
    }
    return status();
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
    store.close();
  }
  return { status, action, exportJSON, backup, close };
}

module.exports = { createCore, policy };
