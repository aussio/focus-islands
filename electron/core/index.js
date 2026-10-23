const { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { backup: sqliteBackup } = require('node:sqlite');
const { openStore, uuid } = require('./store');
const { Timer } = require('./timer');
const { suggest, editBlock, project, forecast, sameDay, ms, iso } = require('./planning');
const { todayGuidance } = require('./guidance');

const policy = Object.freeze({ version: 1, focusCreditsPerMinute: 1, maximumFocusMinutesPerSession: 25,
  minimumBreakMinutesForBonus: 3, breakBonus: 10, itemCosts: { plant: 35, cushion: 50, lamp: 75 } });
const shopItems = Object.freeze([
  { id: 'plant', name: 'Window plant', cost: 35 },
  { id: 'cushion', name: 'Soft cushion', cost: 50 },
  { id: 'lamp', name: 'Reading lamp', cost: 75 },
]);
const eventKinds = new Set(['focusStarted', 'focusEnded', 'breakStarted', 'breakEnded', 'breakDue', 'breakSkipped', 'reflection', 'itemPurchased', 'itemUnlocked']);
const historyTitles = { focusStarted: 'Focus started', focusEnded: 'Focus finished', breakStarted: 'Break started', breakEnded: 'Break finished', breakDue: 'Break was due', breakSkipped: 'Break skipped', reflection: 'Reflection saved', itemPurchased: 'Room item unlocked', itemUnlocked: 'Room item unlocked' };
const dayBounds = now => {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString(),
    end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17).toISOString() };
};
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function dateForDayKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a local calendar date.');
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (dayKey(date) !== key) throw new Error('Choose a valid local calendar date.');
  return date;
}
const countDown = seconds => `${String(Math.floor(Math.ceil(Math.max(0, seconds)) / 60)).padStart(2, '0')}:${String(Math.ceil(Math.max(0, seconds)) % 60).padStart(2, '0')}`;

function createCore({ dbPath, statusPath, profile = 'personal', development = false }) {
  if (!dbPath) throw new Error('dbPath is required.');
  if (development && profile !== 'testing') throw new Error('Development must use Testing.');
  let store = openStore(dbPath);
  let timer, currentPlan = null, plannedBlocks = [], latestPlanEventID = null, page = 'today', message = '', clockOffset = 0, wallOffset = 0;
  let lastCheckpoint = 0, lastTick = null, awayStartedAt = null, suspended = new Set();
  let focusLength = 60, breakLength = 10, defaultFocusLength = 60, defaultBreakLength = 10;
  let notificationsEnabled = true, savedReflection = '';
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
  function load(closeInterruptedSession = false) {
    const events = allEvents(), instant = now();
    timer = Timer.recover(events, instant);
    if (closeInterruptedSession && timer.state.phase !== 'idle') {
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
      message = 'Your previous session ended when the app stopped. Only recorded time was kept.';
    }
    currentPlan = null; plannedBlocks = []; latestPlanEventID = null;
    const bounds = dayBounds(instant.wall);
    let prefs = store.getSettings();
    if (!prefs) {
      let legacy = {};
      try { if (existsSync(preferencesPath)) legacy = JSON.parse(readFileSync(preferencesPath, 'utf8')); } catch { /* Use local defaults. */ }
      const legacyFocus = Number(legacy.focusMinutes), legacyBreak = Number(legacy.breakMinutes);
      prefs = store.saveSettings({ focusMinutes: Number.isInteger(legacyFocus) && legacyFocus >= 5 && legacyFocus <= 120 ? legacyFocus : 60,
        breakMinutes: Number.isInteger(legacyBreak) && legacyBreak >= 5 && legacyBreak <= 60 ? legacyBreak : 10,
        notificationsEnabled: legacy.notificationsEnabled ?? true });
    }
    defaultFocusLength = prefs.focusMinutes; defaultBreakLength = prefs.breakMinutes;
    focusLength = defaultFocusLength; breakLength = defaultBreakLength;
    notificationsEnabled = prefs.notificationsEnabled;
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
    if (!development && Number.isFinite(idleSeconds)) {
      if (idleSeconds >= 120) {
        if (!awayStartedAt) {
          const startedAt = new Date(instant.wall.getTime() - idleSeconds * 1000);
          append('awayStarted', { reason: 'idle' }, { occurredAt: startedAt, source: 'inferred' });
          awayStartedAt = startedAt;
        }
        suspend('idle', idleSeconds);
      } else if (idleSeconds < 3 && suspended.has('idle')) {
        resume('idle');
        if (awayStartedAt && !suspended.has('locked')) {
          append('awayEnded', { reason: 'input resumed' }, { occurredAt: instant.wall, source: 'inferred' });
          awayStartedAt = null;
        }
      }
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
      if (finishedFocus) {
        append('focusEnded', finishedFocus, { occurredAt: instant.wall });
        grant('focus', finishedFocus.sessionID, finishedFocus.elapsedSeconds, finishedFocus.targetSeconds, instant);
      }
      append(phase === 'focus' ? 'focusStarted' : 'breakStarted',
        { sessionID: id, targetSeconds: proposed.state.targetSeconds }, { occurredAt: instant.wall });
    });
    if (prepared) installPlan(prepared, planEvent.id);
    timer = proposed; suspended.clear();
    lastTick = instant; lastCheckpoint = instant.wall.getTime(); writeLease();
  }
  function endFocus(skippedBreak = false) {
    if (timer.state.phase !== 'focus') return;
    const instant = now(), proposed = timer.clone(), { sessionID, targetSeconds } = proposed.state;
    const elapsedSeconds = proposed.end(instant);
    store.transaction(() => {
      if (skippedBreak) append('breakSkipped', { sessionID, targetSeconds, elapsedSeconds }, { occurredAt: instant.wall });
      append('focusEnded', { sessionID, targetSeconds, elapsedSeconds }, { occurredAt: instant.wall });
      grant('focus', sessionID, elapsedSeconds, targetSeconds, instant);
    });
    timer = proposed; writeLease();
  }
  function finishBreak() {
    if (timer.state.phase !== 'break') return;
    const instant = now(), proposed = timer.clone(), { sessionID, targetSeconds } = proposed.state;
    const elapsedSeconds = proposed.end(instant);
    const payload = { sessionID, targetSeconds, elapsedSeconds };
    store.transaction(() => {
      append('breakConfirmed', payload, { occurredAt: instant.wall });
      append('breakEnded', payload, { occurredAt: instant.wall });
      grant('break', sessionID, elapsedSeconds, targetSeconds, instant);
    });
    timer = proposed; writeLease();
  }
  function preparePlan(value, provenance, instant) {
    const key = value.dayKey || dayKey(instant.wall);
    const day = dateForDayKey(key), existing = planForDay(allEvents(), key);
    const base = existing.current, targetBounds = dayBounds(day);
    const start = iso(value.start || value.dayStart || base?.start || targetBounds.start);
    const end = iso(value.end || value.dayEnd || base?.end || targetBounds.end);
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
    const unlocked = [...new Set(events.filter(event => ['itemPurchased', 'itemUnlocked'].includes(event.kind)).map(event => event.payload?.itemID).filter(Boolean))].sort();
    const history = events.filter(item => sameDay(item.occurredAt, instant.wall) && eventKinds.has(item.kind)).reverse().map(item => ({
      id: item.id,
      title: item.payload?.interrupted ? (item.kind === 'focusEnded' ? 'Focus stopped when app closed' : 'Break stopped when app closed') : historyTitles[item.kind],
      date: item.occurredAt, kind: item.kind,
    }));
    committedCacheKey = key;
    committedCache = { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState,
      tomorrowBlocks, actual, balance, unlocked, history, rebalancePreview: rebalance(events) };
    return committedCache;
  }
  function status() {
    syncDay();
    const instant = now();
    const { events, today, yesterday, todayKey, tomorrowKey, todayPlanState, tomorrowPlanState,
      tomorrowBlocks, actual, balance, unlocked, history, rebalancePreview } = committedView(instant);
    const plan = currentPlan, blocks = plannedBlocks;
    const forecastKey = `${committedCacheKey}:${latestPlanEventID}:${timer.state.phase}:${timer.state.sessionID}:${timer.state.isSleeping}:${timer.state.observedSegmentStartedAt}:${Math.floor(instant.wall.getTime() / 60000)}`;
    if (forecastKey !== forecastCacheKey) {
      forecastCache = forecast(plan, actual, timer.state, instant.wall);
      forecastCacheKey = forecastKey;
    }
    const guide = todayGuidance(plan, forecastCache, actual, instant.wall, timer.state);
    const currentMinutes = Math.floor(today.focusSeconds / 60), breakMinutes = Math.floor(today.breakSeconds / 60);
    const display = timer.state.phase === 'idle' ? `${String(focusLength).padStart(2, '0')}:00` : countDown(timer.remainingSeconds);
    return { page, profile, phase: timer.state.phase, timer: { ...timer.state, remainingSeconds: timer.remainingSeconds }, countdown: display,
      currentWallTime: instant.wall.getTime() / 1000, currentWallTimeISO: instant.wall.toISOString(),
      todaySituation: guide.situation, todayTitle: guide.title, todayProposedSeconds: guide.action?.until ? Math.max(0, (ms(guide.action.until) - instant.wall) / 1000) : 0,
      timerTargetSeconds: timer.state.targetSeconds, breakDue: timer.state.phase === 'focus' && timer.state.isDue, suspended: timer.state.isSleeping,
      reminderSequence, breakCompleteSequence,
      balance, focusMinutesToday: currentMinutes, breakMinutesToday: breakMinutes, focusLength, breakLength,
      defaultFocusLength, defaultBreakLength,
      dayStart: plan?.start || bounds.start, dayEnd: plan?.end || bounds.end,
      todayKey, tomorrowKey, dayPlans: { [todayKey]: todayPlanState,
        [tomorrowKey]: { ...tomorrowPlanState, suggestedTimeline: tomorrowBlocks } },
      savedReflection, unlockedItems: unlocked, statusMessage: message,
      plan, plannedTimeline: blocks, forecastTimeline: forecastCache, forecastRevision: forecastCacheKey,
      actualTimeline: actual, yesterdayTimeline: yesterday.actual, yesterdayFocusMinutes: Math.floor(yesterday.focusSeconds / 60),
      yesterdayBreakMinutes: Math.floor(yesterday.breakSeconds / 60), guidance: guide, history,
      events, policy, shopItems, notificationsEnabled, previewFocusCredits, previewBreakBonus, rebalancePreview,
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
    switch (name) {
      case 'tick': tick(Number(value) || 0); return;
      case 'navigate': page = String(value); break;
      case 'start-focus': start('focus', Number(value?.targetSeconds || value?.planDraft?.focusMinutes * 60 || focusLength * 60), value?.planDraft); break;
      case 'end-focus': endFocus(); break;
      case 'start-break': start('break', Number(value?.targetSeconds || breakLength * 60)); break;
      case 'finish-break': finishBreak(); break;
      case 'snooze': case 'snooze-break': if (timer.state.phase === 'focus' && timer.state.isDue) { const instant = now(); append('breakSnoozed', sessionPayload(), { occurredAt: instant.wall }); timer.snooze(5, instant); message = 'Another reminder will arrive in five minutes.'; } break;
      case 'skip-break': endFocus(true); break;
      case 'today-suggestion': {
        const proposed = status().guidance.action;
        if (proposed?.type === 'focus') start('focus', Math.max(1, (ms(proposed.until) - now().wall) / 1000));
        else if (proposed?.type === 'rest') start('break', Math.max(1, (ms(proposed.until) - now().wall) / 1000));
        else if (proposed?.type === 'editPlan') page = 'plan';
        break;
      }
      case 'today-break': { const proposed = status().guidance.breakAction; if (proposed?.type === 'rest') start('break', Math.max(1, (ms(proposed.until) - now().wall) / 1000)); break; }
      case 'save-plan': savePlan(value); break;
      case 'flush-plan': break;
      case 'upsert-meeting': case 'meeting-window': case 'revise-meeting': {
        const meeting = typeof value === 'object' ? value : {};
        const name = String(meeting.title || 'Meeting').trim();
        const startAt = iso(meeting.start || meeting.startAt || new Date());
        const endAt = iso(meeting.end || (ms(startAt) + Number(meeting.duration || 30) * 60000));
        const key = meeting.dayKey || dayKey(now().wall);
        const source = planForDay(allEvents(), key).current || { ...dayBounds(dateForDayKey(key)), meetings: [] };
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
        if (note !== savedReflection) {
          const yesterday = new Date(now().wall); yesterday.setDate(yesterday.getDate() - 1);
          append('reflection', { day: yesterday.toISOString(), note });
        }
        savedReflection = note; message = 'Reflection saved.'; break;
      }
      case 'save-preferences': {
        const nextFocus = Number(value?.focusMinutes ?? value?.focusLength ?? defaultFocusLength);
        const nextBreak = Number(value?.breakMinutes ?? value?.breakLength ?? defaultBreakLength);
        if (!Number.isInteger(nextFocus) || nextFocus < 5 || nextFocus > 120 ||
          !Number.isInteger(nextBreak) || nextBreak < 5 || nextBreak > 60) throw new Error('Choose valid default focus and break lengths.');
        const saved = store.saveSettings({ focusMinutes: nextFocus,
          breakMinutes: nextBreak,
          notificationsEnabled: value?.notificationsEnabled ?? notificationsEnabled });
        defaultFocusLength = saved.focusMinutes; defaultBreakLength = saved.breakMinutes;
        if (!currentPlan) { focusLength = defaultFocusLength; breakLength = defaultBreakLength; }
        notificationsEnabled = saved.notificationsEnabled;
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
      case 'away': if (!awayStartedAt) { awayStartedAt = now().wall; append('awayStarted', { reason: 'development' }, { source: 'inferred' }); suspend('idle'); } break;
      case 'return': if (awayStartedAt) { awayStartedAt = null; append('awayEnded', { reason: 'development' }, { source: 'inferred' }); resume('idle'); } break;
      case 'sleep-wake': suspend('sleep'); append('sleepStarted', sessionPayload(), { source: 'system' }); clockOffset += 20 * 60000; resume('sleep'); append('sleepEnded', sessionPayload(), { source: 'system' }); break;
      case 'sleep': suspend('sleep'); if (timer.state.phase !== 'idle') append('sleepStarted', sessionPayload(), { source: 'system' }); break;
      case 'wake': resume('sleep'); if (timer.state.phase !== 'idle') append('sleepEnded', sessionPayload(), { source: 'system' }); break;
      case 'publish-idle': writeLease('idle'); break;
      case 'lock': suspend('locked'); break;
      case 'unlock': resume('locked'); break;
      case 'scenario': case 'dev-scenario': {
        if (value === 'morning') { page = 'plan'; action('upsert-meeting', { title: 'Team check-in', start: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(), duration: 30 }); }
        if (value === 'break-due' || value === 'breakDue') { if (timer.state.phase === 'break') finishBreak(); if (timer.state.phase === 'focus') endFocus(); start('focus', focusLength * 60); action('advance', focusLength); page = 'today'; }
        if (value === 'completed-day' || value === 'completedDay') { if (timer.state.phase === 'focus') endFocus(); if (timer.state.phase === 'break') finishBreak(); start('focus', focusLength * 60); action('advance', focusLength); start('break', breakLength * 60); action('advance', breakLength); finishBreak(); page = 'history'; }
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
  return { status, action, exportJSON, backup, close() { writeLease('idle'); store.close(); } };
}

module.exports = { createCore, policy };
