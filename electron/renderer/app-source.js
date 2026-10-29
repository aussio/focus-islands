import { dayPath } from './day-path.js';
import { gardenScene } from './garden-scene.js';
import { appStore } from './state.js';

const pages = [
  ['today', '◉', 'Today'], ['plan', '▦', 'Plan'], ['history', '◷', 'History']
];
const state = () => appStore.getState();
const draftFields = new Set(['settings-focus', 'settings-break', 'settings-start', 'settings-end', 'settings-activity-delay', 'notifications', 'reflection-input', 'today-reflection-input', 'meeting-name']);
const planFields = new Set(['day-start', 'day-end', 'focus-length', 'break-length']);
const planDraftTimers = new Map();
let planSaveInFlight = false;
let settingsSavePending = false;
let settingsSaveFeedback = null;
let timeDrag = null;
const activityMeterSetting = 'cozy-focus-show-activity-meter';
const showActivityMeter = () => localStorage.getItem(activityMeterSetting) === 'true';
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value) : new Date();
const mins = (start, end) => Math.max(0, Math.round((date(end) - date(start)) / 60000));
const clock = value => date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const shortDate = value => date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const timeInput = value => { const d = date(value); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const timeChoices = (selected, firstSlot, lastSlot) => {
  const values = Array.from({ length: lastSlot - firstSlot + 1 }, (_, index) => {
    const slot = firstSlot + index;
    return `${String(Math.floor(slot / 4)).padStart(2, '0')}:${String(slot % 4 * 15).padStart(2, '0')}`;
  });
  const savedOutsideRange = selected && !values.includes(selected);
  if (savedOutsideRange) values.push(selected);
  values.sort();
  return values.map(value => `<option value="${html(value)}" ${value === selected ? 'selected' : ''} ${savedOutsideRange && value === selected ? 'disabled' : ''}>${html(clock(withTime(new Date(), value)))}${savedOutsideRange && value === selected ? ' (saved)' : ''}</option>`).join('');
};
const startChoices = selected => timeChoices(selected, 28, 83);
const finishChoices = selected => timeChoices(selected, 29, 84);
const withTime = (base, value) => { const d = date(base); const [hour, minute] = value.split(':').map(Number); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const countdown = seconds => { if (typeof seconds === 'string' && /^-?\d+:\d{2}$/.test(seconds)) return seconds; const value = Number(seconds) || 0; const n = Math.ceil(Math.abs(value)); return `${value < 0 ? '-' : ''}${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const focusPastTarget = status => status.phase === 'focus' && status.breakDue && status.todaySituation !== 'working' && countdown(status.countdown ?? status.displaySeconds).startsWith('-');
const shownCountdown = status => { const value = countdown(status.countdown ?? status.displaySeconds); return focusPastTarget(status) ? value.slice(1) : value; };
const itemKind = item => String(item.kind ?? '').toLowerCase();
const actionButton = (label, action, value, primary = false, id = '') => `<button class="button ${primary ? 'primary' : ''}" data-action="${html(action)}" ${value === undefined ? '' : `data-value="${html(typeof value === 'string' ? value : JSON.stringify(value))}"`} ${id ? `id="${html(id)}"` : ''}>${html(label)}</button>`;
const card = inner => `<section class="card">${inner}</section>`;
const header = (title, subtitle) => `<header class="page-head"><h1>${html(title)}</h1><p>${html(subtitle)}</p></header>`;
const section = title => `<h2>${html(title)}</h2>`;
const empty = text => `<p class="empty">${html(text)}</p>`;

async function dispatch(name, value) {
  try {
    return await state().command(name, value);
  } catch (error) {
    const node = document.querySelector('.status-message') ?? document.createElement('p');
    node.className = 'status-message error';
    node.textContent = error.message || String(error);
    document.querySelector('.page')?.append(node);
  }
}
function acceptStatus(next, previous) {
  const status = next.status, before = previous.status;
  if (status === before) return;
  const changing = new Set(['countdown', 'displaySeconds', 'currentWallTime', 'currentWallTimeISO',
    'todayProposedSeconds', 'timer', 'events', 'appActive', 'activity', 'reminderSequence', 'breakCompleteSequence',
    'publicationEpoch', 'publicationNumber', 'returnPrompt']);
  if (state().page !== 'today') {
    for (const key of ['guidance', 'todayGuidance', 'todaySituation', 'todayTitle']) changing.add(key);
  }
  const stable = snapshot => JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([key]) => !changing.has(key))));
  const editing = state().dirtyInputs.size > 0 || document.activeElement?.matches('input, textarea, select, [contenteditable]');
  if (before.page !== status.page || before.profile !== status.profile || before.todayKey !== status.todayKey || !editing) state().deferRender(false);
  else if (editing) state().deferRender(true);
  if (before.returnPrompt?.since !== status.returnPrompt?.since && !state().renderDeferred) render();
  else if (stable(before) === stable(status) || state().renderDeferred) {
    const timer = document.getElementById('timer-countdown');
    if (timer) timer.textContent = shownCountdown(status);
  } else render();
  updatePresenceDisplay();
  updateDayPathTime(status);
}
function updateDayPathTime(status, previewSeconds) {
  const track = document.querySelector('.path-track');
  if (!track) return;
  const slider = document.getElementById('dev-time-slider');
  if (slider?.dataset.scrubbing === 'true' && previewSeconds === undefined) return;
  const start = Number(track.dataset.start), end = Number(track.dataset.end);
  const current = Number(status.currentWallTime) * 1000;
  const shown = previewSeconds === undefined ? current : previewSeconds * 1000;
  const percent = Math.max(0, Math.min(100, (shown - start) / Math.max(1, end - start) * 100));
  track.querySelector('.path-progress').style.width = `${percent}%`;
  track.querySelector('.path-marker').style.left = `${percent}%`;
  track.setAttribute('aria-label', `Day progress: ${Math.round(percent)} percent. ${shown < start ? 'Before start' : shown >= end ? 'Plan ended' : 'Current time'}.`);
  const label = shown < start ? 'Before start' : shown >= end ? 'Plan ended' : previewSeconds === undefined ? 'Current time' : 'Simulated time';
  const display = new Date(shown).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(status.developmentMode ? { second: '2-digit' } : {}) });
  document.getElementById('path-current-time').textContent = `${label} · ${display}`;
  if (slider && previewSeconds === undefined) {
    slider.value = String(Math.min(end, Math.max(start, start + Math.ceil((current - start) / 30000) * 30000)) / 1000);
  }
}
function commitTimeSlider(slider) {
  slider.dataset.scrubbing = 'false';
  const seconds = Number(slider.value) - Number(state().status.currentWallTime);
  if (state().status.developmentMode && seconds > 0) dispatch('dev-advance', { minutes: seconds / 60 });
  else updateDayPathTime(state().status);
}
function previewTimeDrag(clientX) {
  if (!timeDrag) return;
  const { track, slider } = timeDrag;
  const rect = track.getBoundingClientRect();
  const start = Number(slider.min), end = Number(slider.max);
  const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const selected = start + Math.round((end - start) * fraction / 30) * 30;
  const current = Math.min(end, start + Math.ceil((Number(state().status.currentWallTime) - start) / 30) * 30);
  slider.value = String(Math.min(end, Math.max(current, selected)));
  slider.dataset.scrubbing = 'true';
  updateDayPathTime(state().status, Number(slider.value));
}
function activityLabel(status) {
  if (status.dayEndedAt) return 'Day complete';
  if (status.activity?.state === 'inactive') return 'Away from computer';
  if (status.activity?.state !== 'active') return 'Activity unavailable';
  return 'Activity detected';
}
function activityMeter() {
  if (!showActivityMeter()) return '';
  return '<div class="activity-meter"><span class="activity-meter-label">Checking activity…</span><div class="activity-meter-track" role="progressbar" aria-label="Time until away" aria-valuemin="0"><span class="activity-meter-fill"></span></div></div>';
}
function updatePresenceDisplay() {
  const status = state().status;
  const activity = status.activity || {};
  const ended = Boolean(status.dayEndedAt);
  const away = ended || activity.state === 'inactive';
  const badge = document.getElementById('activity-status');
  if (badge) {
    badge.dataset.state = ended ? 'ended' : activity.state || 'unknown';
    badge.querySelector('.activity-status-text').textContent = activityLabel(status);
  }
  const resting = away || status.inferredBreakActive || status.phase === 'rest' || status.phase === 'break';
  document.querySelector('.today-stage')?.classList.toggle('is-resting', resting);
  const garden = document.querySelector('.today-garden');
  if (garden) {
    garden.querySelector('.garden-state').textContent = ended ? 'DAY COMPLETE' : resting ? 'REST' : 'FOCUS';
    const note = !ended && !resting && status.breakMinutesToday > 0 ? 'A little rest made room for a new bloom.' : '';
    garden.querySelector('.garden-note').textContent = note;
    garden.querySelector('.garden-note').hidden = !note;
    garden.setAttribute('aria-label', ended ? 'Pixel garden resting after the day ended' : resting ? 'Pixel garden resting beneath a dim sky' : 'Pixel garden with a cottage, acorn tree, flowers, path, and fox');
  }
  const threshold = activity.inactiveAfterSeconds || 5;
  const elapsed = activity.idleSeconds;
  const progress = elapsed === null || elapsed === undefined ? (away ? 1 : 0) : Math.min(1, Math.max(0, elapsed / threshold));
  const label = ended ? 'Day ended · activity ignored' : activity.state === 'unknown' ? 'Activity unavailable'
    : away ? (elapsed === null || elapsed === undefined ? 'Away' : `Away · ${elapsed}s idle`)
      : `Away in ${Math.max(0, threshold - (elapsed || 0))}s`;
  document.querySelectorAll('.activity-meter').forEach(node => {
    node.querySelector('.activity-meter-label').textContent = label;
    node.querySelector('.activity-meter-fill').style.width = `${progress * 100}%`;
    const track = node.querySelector('.activity-meter-track');
    track.setAttribute('aria-valuemax', String(threshold));
    track.setAttribute('aria-valuenow', String(Math.min(threshold, elapsed || 0)));
  });
}
function navigation() {
  const s = state().status;
  const profileKey = s.profile || 'personal';
  const profile = html(profileKey.replace(/^./, c => c.toUpperCase()));
  const badge = document.getElementById('profile-badge');
  if (badge.dataset.profile !== profileKey) {
    badge.innerHTML = `<details class="profile-menu"><summary aria-label="${profile} profile menu" title="${profile} profile"><span class="profile-mark" aria-hidden="true">◉</span><span class="profile-name">${profile} profile</span><span class="profile-chevron" aria-hidden="true">⌄</span></summary><div class="profile-dropdown"><button data-page="settings" id="profile-settings">⚙ Settings</button></div></details>`;
    badge.dataset.profile = profileKey;
  }
  const settingsButton = document.getElementById('profile-settings');
  if (state().page === 'settings') settingsButton.setAttribute('aria-current', 'page');
  else settingsButton.removeAttribute('aria-current');
  document.getElementById('navigation').innerHTML = pages.map(([key, icon, name]) => `<button class="nav-button ${state().page === key ? 'active' : ''}" data-page="${key}" id="nav-${key}" aria-label="${name}" title="${name}" ${state().page === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${name}</span></button>`).join('');
}
function guidance() {
  const s = state().status;
  if (s.todayGuidance || s.guidance) return s.todayGuidance || s.guidance;
  if (s.phase === 'focus') return { title: s.breakDue ? 'Time for a break' : 'Focus in progress', detail: s.breakDue ? 'Start your break, snooze, or skip.' : '' };
  if (s.phase === 'rest' || s.phase === 'break') return { title: 'Break in progress', detail: 'Step away from the computer for your break.' };
  return { title: 'Start your day', detail: 'Start a focus session or create a plan for today.', action: 'focus' };
}
function snoozeControl(action, label) {
  return `<div class="snooze-control"><label for="snooze-minutes">Snooze <output id="snooze-value">${state().snoozeMinutes || 5}m</output></label><input type="range" id="snooze-minutes" min="5" max="60" step="5" value="${state().snoozeMinutes || 5}" aria-label="Snooze minutes">${actionButton(label, action, undefined, false, action)}</div>`;
}
function todayReflection() {
  const saved = state().status.todayReflection || '';
  const editing = state().todayReflectionDraft !== null || !saved;
  return card(`<div class="card-head">${section('How did today feel?')}${saved && !editing ? actionButton('Edit reflection', 'edit-today-reflection', undefined, false, 'edit-today-reflection') : ''}</div>${editing ? `<p class="muted">Reflection is optional.</p><input class="text-input" id="today-reflection-input" data-day-key="${html(state().status.todayKey)}" aria-label="Today’s reflection" placeholder="Write a reflection…" value="${html(state().todayReflectionDraft ?? saved)}"><div class="actions" style="justify-content:flex-end;margin-top:9px">${saved ? actionButton('Cancel', 'cancel-today-reflection', undefined, false, 'cancel-today-reflection') : ''}${actionButton('Save reflection', 'save-today-reflection', undefined, false, 'save-today-reflection')}</div>` : `<div class="reflection-saved"><span class="green">●</span><div><b>Saved</b><p class="muted">${html(saved)}</p></div></div>`}`);
}
function todayActions(g) {
  const s = state().status;
  if (g.situation === 'dayEnded') return '<button class="button" data-page="plan" data-plan-tomorrow id="plan-tomorrow">Plan tomorrow</button>';
  if (g.situation === 'afterDay' || g.situation === 'wrappingUp') return `${actionButton('End day', 'end-day', undefined, true, 'end-day')} ${snoozeControl('snooze-end-day', 'Snooze ending day')}`;
  if (s.inferredBreakActive) return actionButton("I'm back · start focus", 'confirm-return', undefined, true, 'end-inferred-break');
  const snooze = snoozeControl('snooze-break', s.phase === 'idle' ? 'Snooze & focus' : 'Snooze');
  const longBreak = actionButton('Take long break · 30m', 'start-long-break', undefined, false, 'start-long-break');
  if (g.situation === 'working') return `${actionButton('Take a break', 'start-break', undefined, true, 'start-break')} ${longBreak}`;
  if (s.phase === 'focus') return `${actionButton('Take a break', 'start-break', undefined, true, 'start-break')} ${longBreak} ${s.breakDue ? `${snooze} ${actionButton('Skip', 'skip-break', undefined, false, 'skip-break')}` : ''}`;
  if (s.phase === 'rest' || s.phase === 'break') return actionButton('Finish break', 'finish-break', undefined, true, 'finish-break');
  if (g.situation === 'noPlan') return `${actionButton('Start focus', 'start-focus', undefined, true, 'start-focus')} <button class="button" data-page="plan" id="today-edit-plan">Create a plan</button>`;
  if (g.action?.type === 'editPlan' || g.action === 'editPlan' || g.action === 'edit-plan') return `<button class="button primary" data-page="plan" id="today-edit-plan">Edit plan</button>`;
  if (g.situation === 'rest' || g.action?.type === 'rest' || g.action === 'rest' || g.action === 'break') return `${actionButton('Start break', 'start-break', undefined, true, 'start-break')} ${longBreak} ${snooze}`;
  return actionButton('Start focus', g.action ? 'today-suggestion' : 'start-focus', undefined, true, 'start-focus');
}
function timelineRows(items, actual = false) {
  return items.map(item => `<div class="timeline-row"><time>${clock(item.start)}</time><span class="title">${html(actual ? item.kind === 'away' ? 'Away' : item.kind === 'break' ? item.inferred ? 'Inferred break' : item.inProgress ? 'Break · in progress' : item.confirmed ? 'Confirmed break' : 'Break' : item.inProgress ? 'Focus · in progress' : 'Focus' : item.title || item.kind)}</span><span class="length">${mins(item.start, item.end)}m</span></div>`).join('');
}
function todayAcorns(status, open) {
  const entries = status.todayRewardEntries || [];
  return `<details class="today-acorns" id="today-acorns" ${open ? 'open' : ''}><summary aria-label="${html(status.balance ?? 0)} acorns available, ${html(status.todayAcornsEarned ?? 0)} earned today. Show acorn activity"><span class="acorn-star" aria-hidden="true">✦</span><span class="acorn-balance">${html(status.balance ?? 0)} <small>acorns</small></span><span class="acorn-today">+${html(status.todayAcornsEarned ?? 0)} today</span><span class="acorn-chevron" aria-hidden="true">⌄</span></summary><div class="acorn-dropdown"><h2>Acorns earned today</h2>${entries.length ? `<div class="acorn-entries">${entries.map(entry => `<div class="acorn-entry"><span>${html(entry.activity)}<small>${html(clock(entry.occurredAt))}</small></span><b>+${html(entry.amount)}</b></div>`).join('')}</div>` : '<p class="acorn-empty">No acorns earned yet today.</p>'}<div class="acorn-total"><span>Earned today</span><b>+${html(status.todayAcornsEarned ?? 0)}</b></div><div class="acorn-total available"><span>Available balance</span><b>${html(status.balance ?? 0)}</b></div></div></details>`;
}
function todayUpNext(status) {
  if (!status.plan || status.dayEndedAt) return '';
  const now = date(status.currentWallTimeISO || status.currentWallTime || Date.now()).getTime();
  const blocks = status.forecastTimeline || status.plannedTimeline || [];
  const next = blocks.find(item => !item.actual && date(item.start).getTime() > now && date(item.end).getTime() > now);
  if (!next) return '';
  const kind = itemKind(next);
  const title = next.title || ({ focus: 'Focus', break: 'Break', meeting: 'Meeting' }[kind] || 'Time');
  const duration = mins(next.start, next.end);
  return `<section class="today-up-next" aria-label="Up next on your live day path"><span class="up-next-icon" aria-hidden="true">▦</span><div class="up-next-copy"><strong>Up next: ${html(title)}</strong><p>${html(duration)} min</p></div><span class="up-next-time">${html(clock(next.start))}</span></section>`;
}
function today(acornsOpen = false) {
  const s = state().status, g = guidance();
  const resting = Boolean(s.dayEndedAt || s.inferredBreakActive || s.phase === 'rest' || s.phase === 'break' || s.activity?.state === 'inactive');
  const timerVisible = !['afterDay', 'dayEnded'].includes(g.situation) && (s.phase !== 'idle' || g.situation === 'working' || g.situation === 'wrappingUp');
  return `<div class="today-page">
    <header class="today-head"><div class="eyebrow">${html(shortDate(s.currentWallTimeISO || s.currentWallTime || Date.now()))}</div><div class="today-head-actions"><span class="activity-status" id="activity-status" role="status" aria-live="polite"><span class="activity-status-dot" aria-hidden="true"></span><span class="activity-status-text">${html(activityLabel(s))}</span></span>${todayAcorns(s, acornsOpen)}</div></header>
    <section class="today-stage ${resting ? 'is-resting' : ''} ${s.breakMinutesToday > 0 ? 'has-breaks' : ''}" aria-label="Current session"><div class="today-stage-copy"><h2 id="today-guidance">${html(g.title)}</h2>${timerVisible ? `<div class="timer"><span id="timer-countdown">${shownCountdown(s)}</span>${focusPastTarget(s) ? '<small>past focus target</small>' : ''}</div>` : ''}${g.detail ? `<p class="today-detail">${html(g.detail)}</p>` : ''}<div class="today-actions">${todayActions(g)}</div>${activityMeter()}</div>${gardenScene({ resting, hasBreaks: s.breakMinutesToday > 0, ended: Boolean(s.dayEndedAt) })}</section>
    ${todayUpNext(s)}${s.dayEndedAt ? todayReflection() : ''}${dayPath(s)}${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}</div>`;
}
function calendar(items, dayStart, dayEnd, meetingMode = false) {
  const start = date(dayStart || items[0]?.start), end = date(dayEnd || new Date(start.getTime() + 8 * 3600000));
  const duration = Math.max(15, Math.round((end - start) / 60000));
  const height = duration * 1.2;
  const firstHour = new Date(start);
  firstHour.setMinutes(0, 0, 0);
  if (firstHour < start) firstHour.setHours(firstHour.getHours() + 1);
  const lines = [];
  for (const hour = firstHour; hour <= end; hour.setHours(hour.getHours() + 1)) {
    lines.push(`<div class="hour-line" style="top:${(hour - start) / 60000 * 1.2}px"><span>${clock(hour)}</span></div>`);
  }
  const blocks = items.map(item => {
    const top = Math.max(0, Math.round((date(item.start) - start) / 60000));
    const length = Number(item.minutes ?? item.duration ?? mins(item.start, item.end));
    const clipped = Math.min(length, duration - top);
    if (clipped <= 0 || top >= duration) return '';
    const kind = itemKind(item);
    const selected = meetingMode && state().selectedMeeting === item.id;
    return `<div class="calendar-block ${html(kind)} ${selected ? 'selected' : ''}" style="top:${top * 1.2}px;height:${clipped * 1.2}px" ${meetingMode ? `data-meeting-id="${html(item.id)}"` : ''} title="${html(item.title || item.kind)} at ${clock(item.start)}"><span>${html(item.title || item.kind)}</span><span>${clipped}m</span></div>`;
  }).join('');
  return `<div class="calendar ${meetingMode ? 'meeting-calendar' : ''}" ${meetingMode ? 'id="meeting-calendar"' : 'id="suggested-day-calendar"'}><div class="calendar-inner" style="height:${height + 4}px" data-day-start="${html(start.toISOString())}" data-day-minutes="${duration}">${lines.join('')}${blocks}</div></div>`;
}
function selectedPlan() {
  const s = state().status;
  const key = state().planDay === 'tomorrow' ? s.tomorrowKey : s.todayKey;
  const record = s.dayPlans?.[key] || {};
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const [startHour, startMinute] = (s.defaultStartTime || '09:00').split(':').map(Number);
  const [endHour, endMinute] = (s.defaultEndTime || '17:00').split(':').map(Number);
  const defaults = { dayKey: key, start: new Date(year, month - 1, day, startHour, startMinute).toISOString(),
    end: new Date(year, month - 1, day, endHour, endMinute).toISOString(), meetings: [],
    focusMinutes: s.defaultFocusLength || 60, breakMinutes: s.defaultBreakLength || 10 };
  const plan = state().planDrafts[key] || record.current || defaults;
  const ended = state().planDay === 'today' && record.current &&
    new Date(s.currentWallTimeISO || Date.now()) >= new Date(record.current.end);
  const timeline = state().planDay === 'tomorrow' ? record.suggestedTimeline || [] :
    !record.current ? s.defaultDayPath?.timeline || [] : ended ? s.plannedTimeline || [] : s.forecastTimeline || [];
  return { key, date, record, plan, timeline, ended, bounds: state().planBounds[key] || {} };
}
function plan() {
  const s = state().status, view = selectedPlan();
  const yesterday = (s.yesterdayTimeline || []).filter(x => x.kind === 'focus' || (x.kind === 'break' && x.confirmed));
  const saved = s.savedReflection ?? null;
  const editing = state().reflectionDraft !== null || !saved;
  const reflection = editing ? `<p class="muted">What felt good? What would make breaks easier today?</p><input class="text-input" id="reflection-input" placeholder="Add a reflection…" value="${html(state().reflectionDraft ?? saved ?? '')}"><div class="actions" style="justify-content:flex-end;margin-top:9px">${saved ? actionButton('Cancel', 'cancel-reflection-edit', undefined, false, 'cancel-reflection-edit') : ''}${actionButton('Save reflection', 'save-reflection', undefined, false, 'save-reflection')}</div>` : `<div class="reflection-saved"><span class="green">●</span><div><b>Saved</b><p class="muted">${html(saved)}</p></div></div>`;
  const reflectionCard = state().planDay === 'today' ? card(`<div class="card-head">${section('Yesterday')}${saved && !editing ? actionButton('Edit reflection', 'edit-reflection', undefined, false, 'edit-reflection') : ''}</div><div class="inline-metrics"><span>Focus · ${s.yesterdayFocusMinutes || 0} min</span><span>Confirmed breaks · ${s.yesterdayBreakMinutes || 0} min</span></div>${yesterday.map(x => `<div class="line-row"><span>${x.kind === 'focus' ? 'Focus' : 'Break'}</span><span class="spacer"></span><time>${clock(x.start)} · ${Math.round((x.observedSeconds || mins(x.start, x.end) * 60) / 60)} min</time></div>`).join('')}${reflection}`) : '';
  const meetings = (view.plan.meetings || []).map(m => `<div class="line-row"><span>${html(m.title)}</span><span class="spacer"></span><time>${clock(m.start)}–${clock(m.end)}</time></div>`).join('') || empty('No meetings planned yet.');
  const dayButtons = `<div class="actions"><button class="button ${state().planDay === 'today' ? 'primary' : ''}" data-plan-day="today">Today</button><button class="button ${state().planDay === 'tomorrow' ? 'primary' : ''}" data-plan-day="tomorrow">Tomorrow</button></div>`;
  const planSaving = state().pendingPlanKey === view.key;
  const planFeedback = `<p class="calculation-status ${state().error ? 'error' : ''}" id="plan-save-status" role="status">${planSaving ? '<span class="spinner" aria-hidden="true"></span>Saving…' : state().error ? html(state().error) : view.record.baseline ? 'Saved' : ''}</p>`;
  const startValue = view.bounds.start || timeInput(view.plan.start);
  const endValue = view.bounds.end || timeInput(view.plan.end);
  const bounds = card(`${section('Plan settings')}<div class="inline-fields"><label class="field"><span>Start</span><select id="day-start">${startChoices(startValue)}</select></label><label class="field"><span>Finish</span><select id="day-end">${finishChoices(endValue)}</select></label><label class="field"><span>Focus · min</span><input type="number" id="focus-length" min="5" max="120" step="5" value="${view.plan.focusMinutes}"></label><label class="field"><span>Break · min</span><input type="number" id="break-length" min="5" max="60" step="5" value="${view.plan.breakMinutes}"></label></div>${planFeedback}`);
  const meetingCard = `<button class="card meeting-link" id="open-meetings" style="display:block;width:100%;text-align:left;border-color:rgba(64,74,59,.07);color:inherit;cursor:pointer">${section('Meetings')}${meetings}<span class="green" style="font-size:11px">Open day calendar ↗</span></button>`;
  const hasDraft = Boolean(state().planDrafts[view.key]);
  const timelineTitle = state().planDay === 'tomorrow' || !view.record.current ? 'Suggested timeline' : view.ended ? 'Saved plan' : 'Live forecast';
  const timelineNote = hasDraft && view.record.current ? '<p class="small-note">Updating this forecast from your latest changes…</p>' : '';
  const timeline = card(`${section(timelineTitle)}${timelineNote}${view.timeline.length ? calendar(view.timeline, view.record.current?.start || view.plan.start, view.record.current?.end || view.plan.end) : empty(view.record.current ? 'No time remains in this plan.' : 'Enter your start and finish to see suggested focus and break times.')}`);
  return `${header('Shape your day', `Plan for ${shortDate(view.date)}.`)}${dayButtons}${reflectionCard}${bounds}${meetingCard}${timeline}`;
}
function history() {
  const s = state().status, plan = s.plannedTimeline || [], actual = s.actualTimeline || [], entries = s.history || [];
  return `${header('Your rhythm', 'Today’s focus sessions and breaks.')}${card(`${section('Planned and actual timeline')}<div class="split"><div><h3>PLANNED</h3>${plan.length ? timelineRows(plan) : empty('No plan saved today.')}</div><div><h3>ACTUAL</h3>${actual.length ? timelineRows(actual, true) : empty('No sessions recorded today.')}</div></div>`)}${card(`${section('Today’s events')}${entries.length ? entries.map(entry => `<div class="line-row"><span class="green">●</span><span>${html(entry.title)}</span><span class="spacer"></span><time>${clock(entry.date)}</time></div>`).join('') : empty('Your first focus session will appear here.')}`)}${card(`${section('Today’s totals')}<div class="metric"><span>Focus time recorded</span><b>${s.focusMinutesToday || 0} min</b></div><div class="metric"><span>Break time detected</span><b>${s.breakMinutesToday || 0} min</b></div><div class="metric"><span>Acorns available</span><b>${s.balance ?? 0}</b></div>`)}`;
}
function debugSettings() {
  return card(`${section('Debug')}<label class="check-field"><input type="checkbox" id="show-activity-meter" ${showActivityMeter() ? 'checked' : ''}> Show activity countdown</label><p class="small-note">Show the activity countdown on Today. This only changes the display.</p>`);
}
function settings() {
  const s = state().status, preview = s.rebalancePreview;
  return `${header('Settings', 'Default schedule and break settings.')}${card(`${section('Preferences')}<div class="inline-fields"><label class="field"><span>Start</span><select id="settings-start">${startChoices(s.defaultStartTime || '09:00')}</select></label><label class="field"><span>Finish</span><select id="settings-end">${finishChoices(s.defaultEndTime || '17:00')}</select></label><label class="field"><span>Focus · min</span><input type="number" id="settings-focus" min="5" max="120" step="5" value="${s.defaultFocusLength || 60}"></label><label class="field"><span>Break · min</span><input type="number" id="settings-break" min="5" max="60" step="5" value="${s.defaultBreakLength || 10}"></label></div><p class="small-note">Used for new days. Your saved plans keep their times.</p><div class="inline-fields"><label class="field"><span>Activity delay · sec</span><input type="number" id="settings-activity-delay" min="1" max="3600" step="1" value="${s.activityDelaySeconds ?? 120}"></label></div><p class="small-note">Today shows Away from computer after this much idle time.</p><label class="check-field"><input type="checkbox" id="notifications" ${s.notificationsEnabled !== false ? 'checked' : ''}> Visual reminders</label><p class="small-note">Confetti when a break is due, then a clock every five minutes until you respond.</p><div class="settings-save-row">${actionButton('Save settings', 'save-preferences', undefined, true, 'save-settings')}<span id="settings-save-feedback" class="settings-save-feedback ${settingsSaveFeedback?.error ? 'error' : ''}" role="status" aria-live="polite">${html(settingsSaveFeedback?.message || '')}</span></div>`)}${debugSettings()}${card(`${section('Reward preview')}<p class="muted">Try different reward values against your saved sessions. This preview does not change your balance or history.</p><div class="inline-fields"><label class="field"><span>Focus credit · per minute</span><input type="number" id="preview-focus" min="0" max="5" step="1" value="${state().rewardDraft?.focusCreditsPerMinute ?? s.previewFocusCredits ?? 1}"></label><label class="field"><span>Break bonus · acorns</span><input type="number" id="preview-break" min="0" max="50" step="5" value="${state().rewardDraft?.breakBonus ?? s.previewBreakBonus ?? 10}"></label></div>${preview ? `<p>${preview.focusSessions} focus sessions · ${preview.confirmedBreaks} confirmed breaks</p><b>Current ${preview.currentBalance} → Preview ${preview.projectedBalance} acorns</b>` : ''}`)}${card(`${section('Data profile')}<label class="field"><span>Profile</span><select id="data-profile" ${s.canSwitchProfiles === false ? 'disabled' : ''}><option value="personal" ${s.profile === 'personal' ? 'selected' : ''}>Personal</option><option value="testing" ${s.profile === 'testing' ? 'selected' : ''}>Testing</option></select></label><p class="small-note">${s.canSwitchProfiles === false ? 'Development runs are locked to the isolated Testing profile.' : 'Each profile has its own history and rewards. Testing never writes to Personal.'}</p>`)}${card(`${section('Your data')}<p class="muted">Your timeline stays in a local SQLite database on this Mac.</p><div class="actions">${actionButton('Export JSON', 'export-json')}${actionButton('Back up database', 'backup-database')}</div>`)}${s.developmentMode ? card(`${section('Development scenarios')}<p class="muted">Exercise the full loop without waiting for real time.</p><div class="actions">${actionButton('Morning setup', 'dev-scenario', 'morning')}${actionButton('Break due', 'dev-scenario', 'breakDue')}${actionButton('Completed day', 'dev-scenario', 'completedDay')}${actionButton('Advance 5 min', 'dev-advance', 5)}${actionButton('Simulate away', 'dev-away')}${actionButton('Simulate return', 'dev-return')}${actionButton('Sleep / wake', 'dev-sleep-wake')}</div>`) : ''}${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}`;
}
function meetingDialog() {
  const view = selectedPlan(), meetings = view.plan.meetings || [], meeting = meetings.find(x => x.id === state().selectedMeeting);
  const selected = meeting ? `<input class="text-input" id="meeting-name" aria-label="Meeting name" value="${html(state().meetingDraft || meeting.title)}"><span class="muted">${clock(meeting.start)}–${clock(meeting.end || date(meeting.start).getTime() + meeting.duration * 60000)}</span><button class="button" id="delete-meeting">Delete</button>` : '<span class="muted">Select a meeting to rename it. Right-click a block to delete it.</span>';
  document.getElementById('dialog-root').innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Meetings"><div class="modal-top"><div><h2>Meetings</h2><p>Drag empty space to add. Drag a block to move it. Drag its edges to resize. Snaps to 15 minutes.</p></div><button class="button" id="close-meetings" aria-label="Close calendar">×</button></div><div class="selection">${selected}</div>${calendar(meetings.map(m => ({ ...m, kind: 'Meeting' })), view.plan.start, view.plan.end, true)}</section></div>`;
}
function returnDialog() {
  const prompt = state().status.returnPrompt;
  if (!prompt) return;
  const kind = prompt.kind === 'inferred' ? 'Your time away is counting as a break.' : 'Your break is still running.';
  document.getElementById('dialog-root').innerHTML = `<div class="modal-backdrop return-backdrop"><section class="modal return-modal" role="dialog" aria-modal="true" aria-labelledby="return-title" aria-describedby="return-detail"><div class="eyebrow">ACTIVITY DETECTED</div><h2 id="return-title">Are you back from break?</h2><p id="return-detail">${kind} Your Mac is active again. Confirm your return, or keep your break going.</p><div class="return-actions">${actionButton("I'm back · start focus", 'confirm-return', undefined, true, 'confirm-return')}${actionButton("I'm still on break", 'keep-break', undefined, false, 'keep-break')}</div><p class="return-note">After 1 minute of continued activity, focus will start automatically.</p></section></div>`;
}
function render() {
  state().deferRender(false);
  state().clearDirty();
  navigation();
  const view = { today, plan, history, settings }[state().page] || today;
  const content = document.getElementById('content');
  const scroll = content.scrollTop;
  const acornsOpen = content.querySelector('#today-acorns')?.open || false;
  content.innerHTML = `<div class="page">${state().page === 'today' ? today(acornsOpen) : view()}</div>`;
  content.scrollTop = scroll;
  updatePresenceDisplay();
  if (state().status.returnPrompt) returnDialog();
  else if (state().meetingEditor) meetingDialog();
  else document.getElementById('dialog-root').innerHTML = '';
}
document.addEventListener('focusout', event => {
  if (planFields.has(event.target.id)) flushPlanDraft();
  if (event.target.id && !draftFields.has(event.target.id)) state().clearDirty(event.target.id);
  setTimeout(() => {
    if (state().renderDeferred && state().dirtyInputs.size === 0 && !document.activeElement?.matches('input, textarea, select, [contenteditable]')) render();
  }, 0);
});
function setPlanDraft(patch) {
  const view = selectedPlan();
  const draft = { ...view.plan, ...patch, dayKey: view.key };
  state().savePlanDraft(view.key, draft);
  return draft;
}
function samePlan(a, b) {
  return a && b && ['start', 'end', 'focusMinutes', 'breakMinutes', 'meetings', 'customBlocks']
    .every(key => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null));
}
function savePlanFromFields() {
  const view = selectedPlan();
  const startField = document.getElementById('day-start');
  const endField = document.getElementById('day-end');
  const focusField = document.getElementById('focus-length');
  const breakField = document.getElementById('break-length');
  if (!startField || !endField) return null;
  const bounds = { start: startField.value, end: endField.value };
  state().savePlanBounds(view.key, bounds);
  const focusMinutes = Number(focusField.value), breakMinutes = Number(breakField.value);
  if (!focusField.value || !breakField.value ||
    !focusField.checkValidity() || !breakField.checkValidity() ||
    !Number.isInteger(focusMinutes) || !Number.isInteger(breakMinutes)) {
    planFeedback('Enter valid focus and break lengths.', true);
    return null;
  }
  if (!startField.value || !endField.value) {
    setPlanDraft({ focusMinutes, breakMinutes });
    return null;
  }
  const dayStart = withTime(view.plan.start, startField.value);
  const dayEnd = withTime(view.plan.end, endField.value);
  if (date(dayEnd) - date(dayStart) < 15 * 60000) {
    planFeedback('Finish must be at least 15 minutes after start.', true);
    return null;
  }
  return setPlanDraft({ start: dayStart, end: dayEnd,
    focusMinutes, breakMinutes });
}
function flushPlanDraft() {
  const key = selectedPlan().key;
  clearTimeout(planDraftTimers.get(key));
  planDraftTimers.delete(key);
  if (state().page === 'plan' && !state().meetingEditor) {
    const draft = savePlanFromFields();
    if (draft) queuePlanSave();
  }
}
function queuePlanSave(key = selectedPlan().key) {
  clearTimeout(planDraftTimers.get(key));
  planDraftTimers.set(key, setTimeout(() => {
    planDraftTimers.delete(key);
    commitPlan(key);
  }, 550));
}
function planFeedback(message, error = false) {
  const node = document.getElementById('plan-save-status');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', error);
}
async function commitPlan(key) {
  if (planSaveInFlight) return;
  const record = state().status.dayPlans?.[key] || {};
  const draft = state().planDrafts[key];
  const bounds = state().planBounds[key] || {};
  if (!draft || (!record.baseline && (!bounds.start || !bounds.end))) return;
  if (samePlan(draft, record.current)) { state().clearPlanDraft(key); return; }
  const before = record.latestEventID;
  planSaveInFlight = true;
  state().setUI({ pendingPlanKey: key, error: null });
  planFeedback('Saving…');
  try {
    const result = await dispatch('save-plan', draft);
    if (result?.dayPlans?.[key]?.latestEventID && result.dayPlans[key].latestEventID !== before) {
      if (state().planDrafts[key] === draft) state().clearPlanDraft(key);
      planFeedback('Saved');
    } else if (result) {
      const error = result.statusMessage || 'This plan could not be saved.';
      state().setUI({ error });
      planFeedback(error, true);
    }
  } finally {
    planSaveInFlight = false;
    state().setUI({ pendingPlanKey: null });
    for (const [pendingKey, pendingDraft] of Object.entries(state().planDrafts)) {
      if (pendingKey !== key || pendingDraft !== draft) queuePlanSave(pendingKey);
    }
    if (!document.activeElement?.matches('input, textarea, select, [contenteditable]')) render();
  }
}
function showSettingsSaveFeedback(message, error = false) {
  settingsSaveFeedback = message ? { message, error } : null;
  const node = document.getElementById('settings-save-feedback');
  if (node) {
    node.textContent = message;
    node.classList.toggle('error', error);
  }
}
async function savePreferences() {
  if (settingsSavePending) return;
  const value = { focusLength: Number(document.getElementById('settings-focus').value), breakLength: Number(document.getElementById('settings-break').value),
    startTime: document.getElementById('settings-start').value, endTime: document.getElementById('settings-end').value,
    notificationsEnabled: document.getElementById('notifications').checked,
    activityDelaySeconds: Number(document.getElementById('settings-activity-delay').value) };
  settingsSavePending = true;
  const button = document.getElementById('save-settings');
  if (button) button.disabled = true;
  showSettingsSaveFeedback('Saving…');
  try {
    await state().command('save-preferences', value);
    state().clearDirty();
    state().deferRender(false);
    showSettingsSaveFeedback('Saved');
    if (state().page === 'settings') render();
  } catch (error) {
    const message = (error.message || String(error)).replace(/^Error invoking remote method 'cozy:action': Error: /, '');
    showSettingsSaveFeedback(message, true);
  } finally {
    settingsSavePending = false;
    const currentButton = document.getElementById('save-settings');
    if (currentButton) currentButton.disabled = false;
  }
}
function saveMeetingName() {
  const meeting = (selectedPlan().plan.meetings || []).find(x => x.id === state().selectedMeeting);
  const title = document.getElementById('meeting-name')?.value.trim();
  if (meeting && title && title !== meeting.title) upsertMeeting({ ...meeting, title });
}
function upsertMeeting(meeting) {
  const view = selectedPlan();
  const meetings = [...(view.plan.meetings || [])], index = meetings.findIndex(item => item.id === meeting.id);
  const item = { ...meeting, id: meeting.id || `draft-${Date.now()}` };
  if (index < 0) meetings.push(item); else meetings[index] = item;
  setPlanDraft({ meetings, customBlocks: null });
  queuePlanSave();
  render();
}
function removeMeeting(id) {
  const view = selectedPlan();
  setPlanDraft({ meetings: (view.plan.meetings || []).filter(item => item.id !== id), customBlocks: null });
  queuePlanSave();
  render();
}
function selectMeeting(id) {
  saveMeetingName();
  state().setUI({ selectedMeeting: id, meetingDraft: (selectedPlan().plan.meetings || []).find(x => x.id === id)?.title || '' });
  meetingDialog();
}
function closeMeetings() {
  saveMeetingName();
  state().setUI({ meetingEditor: false, selectedMeeting: null });
  render();
}
function meetingGeometry(event) {
  const inner = document.querySelector('#meeting-calendar .calendar-inner');
  if (!inner) return null;
  const rect = inner.getBoundingClientRect();
  const minutes = Number(inner.dataset.dayMinutes);
  const slotCount = Math.max(1, Math.floor(minutes / 15));
  const slot = Math.max(0, Math.min(slotCount, Math.floor((event.clientY - rect.top) / 18)));
  return { inner, rect, slot, slotCount, start: date(inner.dataset.dayStart) };
}
function meetingSlots(drag, event) {
  const geo = meetingGeometry(event);
  if (!geo) return null;
  const targetSlot = Math.max(0, Math.min(geo.slotCount, Math.round((event.clientY - geo.rect.top) / 18)));
  let first, last;
  if (drag.meeting) {
    const originalStart = Math.round((date(drag.meeting.start) - geo.start) / 900000);
    const length = Math.max(1, Math.round((drag.meeting.duration ?? mins(drag.meeting.start, drag.meeting.end)) / 15));
    const delta = Math.round((event.clientY - drag.y) / 18);
    if (drag.mode === 'resize-top') { first = Math.max(0, Math.min(originalStart + delta, originalStart + length - 1)); last = originalStart + length; }
    else if (drag.mode === 'resize-bottom') { first = originalStart; last = Math.max(first + 1, Math.min(geo.slotCount, originalStart + length + delta)); }
    else { first = Math.max(0, Math.min(geo.slotCount - length, originalStart + delta)); last = first + length; }
  } else {
    first = Math.min(drag.slot, targetSlot);
    last = Math.max(drag.slot + 1, targetSlot);
    first = Math.max(0, Math.min(first, geo.slotCount - 1));
    last = Math.max(first + 1, Math.min(last, geo.slotCount));
  }
  return { geo, first, last };
}
function previewMeeting(event) {
  const drag = state().drag;
  if (!drag) return;
  const slots = meetingSlots(drag, event);
  if (!slots) return;
  const preview = slots.geo.inner.querySelector('.meeting-drag-preview');
  if (!preview) return;
  preview.style.top = `${slots.first * 18}px`;
  preview.style.height = `${(slots.last - slots.first) * 18}px`;
  preview.innerHTML = `<span>${html(drag.meeting?.title || 'New meeting')}</span><span>${(slots.last - slots.first) * 15}m</span>`;
}
function meetingDrop(event) {
  const drag = state().drag;
  state().setUI({ drag: null });
  if (!drag) return;
  const slots = meetingSlots(drag, event);
  if (!slots) return;
  const { geo, first, last } = slots;
  if (drag.meeting && first === Math.round((date(drag.meeting.start) - geo.start) / 900000) &&
    last === Math.round((date(drag.meeting.end) - geo.start) / 900000)) { selectMeeting(drag.meeting.id); return; }
  const start = new Date(geo.start.getTime() + first * 900000).toISOString();
  const end = new Date(geo.start.getTime() + last * 900000).toISOString();
  upsertMeeting({ id: drag.meeting?.id, title: drag.meeting?.title || 'Meeting', start, end });
}
document.addEventListener('click', event => {
  if (event.target.closest('#sidebar-toggle')) {
    const collapsed = document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
    const toggle = document.getElementById('sidebar-toggle');
    document.getElementById('sidebar').inert = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.querySelector('span').textContent = collapsed ? '›' : '‹';
    return;
  }
  const acornDetails = document.querySelector('#today-acorns[open]');
  if (acornDetails && !event.target.closest('#today-acorns')) acornDetails.open = false;
  const profileMenu = document.querySelector('.profile-menu[open]');
  if (profileMenu && !event.target.closest('.profile-menu')) profileMenu.open = false;
  const planDay = event.target.closest('[data-plan-day]');
  if (planDay) { flushPlanDraft(); state().selectPlanDay(planDay.dataset.planDay); render(); return; }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { if (pageButton.hasAttribute('data-plan-tomorrow')) state().selectPlanDay('tomorrow'); if (profileMenu) profileMenu.open = false; flushPlanDraft(); state().setPage(pageButton.dataset.page); dispatch('navigate', state().page); render(); return; }
  if (event.target.closest('#open-meetings')) { state().setUI({ meetingEditor: true }); meetingDialog(); return; }
  if (event.target.closest('#close-meetings') || (event.target.id === 'modal-backdrop' && !state().status.returnPrompt)) { closeMeetings(); return; }
  if (event.target.closest('#delete-meeting')) { if (state().selectedMeeting) removeMeeting(state().selectedMeeting); state().setUI({ selectedMeeting: null, meetingDraft: '' }); meetingDialog(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const name = button.dataset.action;
  if (name === 'edit-today-reflection' || name === 'cancel-today-reflection') {
    state().setUI({ todayReflectionDraft: name === 'edit-today-reflection' ? state().status.todayReflection || '' : null });
    state().clearDirty('today-reflection-input'); state().deferRender(false); render(); return;
  }
  if (name === 'save-today-reflection') {
    const input = document.getElementById('today-reflection-input');
    const note = input?.value.trim();
    if (note) dispatch('save-reflection', { note, dayKey: input.dataset.dayKey }).then(result => {
      if (result) { state().setUI({ todayReflectionDraft: null }); state().clearDirty('today-reflection-input'); state().deferRender(false); render(); }
    });
    return;
  }
  if (name === 'edit-reflection') { state().setUI({ reflectionDraft: state().status.savedReflection ?? '' }); render(); document.getElementById('reflection-input')?.focus(); return; }
  if (name === 'cancel-reflection-edit') { state().setUI({ reflectionDraft: null }); render(); return; }
  if (name === 'save-reflection') { const value = document.getElementById('reflection-input')?.value.trim(); if (value) { state().setUI({ reflectionDraft: null }); state().clearDirty('reflection-input'); state().deferRender(false); dispatch(name, value); } return; }
  if (name === 'save-preferences') { savePreferences(); return; }
  if (name === 'dev-timer-end') {
    const remaining = state().status.timer?.remainingSeconds;
    if (state().status.developmentMode && state().status.phase !== 'idle' && remaining > 0) dispatch('dev-advance', { minutes: (remaining + 1) / 60 });
    return;
  }
  if (name === 'snooze-break' || name === 'snooze-end-day') { dispatch(name, { minutes: state().snoozeMinutes }); return; }
  if (name === 'start-focus' && !state().status.dayPlans?.[state().status.todayKey]?.baseline) {
    dispatch(name, { planDraft: state().planDrafts[state().status.todayKey] }); return;
  }
  let value = button.dataset.value;
  if (value !== undefined) { try { value = JSON.parse(value); } catch {} }
  dispatch(name, value);
});
document.addEventListener('change', event => {
  if (draftFields.has(event.target.id) && settingsSaveFeedback && !settingsSavePending) showSettingsSaveFeedback('');
  if (event.target.id === 'dev-time-slider') {
    commitTimeSlider(event.target);
    return;
  }
  if (event.target.id === 'show-activity-meter') localStorage.setItem(activityMeterSetting, String(event.target.checked));
  if (planFields.has(event.target.id)) { const draft = savePlanFromFields(); if (draft) queuePlanSave(); }
  if (event.target.id === 'data-profile') dispatch('switch-profile', event.target.value);
  if (['preview-focus', 'preview-break'].includes(event.target.id)) {
    state().setUI({ rewardDraft: { focusCreditsPerMinute: Number(document.getElementById('preview-focus').value), breakBonus: Number(document.getElementById('preview-break').value) } });
    dispatch('preview-rewards', state().rewardDraft);
  }
  if (event.target.id === 'meeting-name') saveMeetingName();
});
document.addEventListener('input', event => {
  if (draftFields.has(event.target.id) && settingsSaveFeedback && !settingsSavePending) showSettingsSaveFeedback('');
  if (event.target.id === 'dev-time-slider') {
    const slider = event.target;
    const current = Number(state().status.currentWallTime);
    if (Number(slider.value) < current) {
      const start = Number(slider.min);
      slider.value = String(Math.min(Number(slider.max), start + Math.ceil((current - start) / 30) * 30));
    }
    slider.dataset.scrubbing = 'true';
    updateDayPathTime(state().status, Number(slider.value));
    return;
  }
  if (event.target.id === 'snooze-minutes') {
    state().setUI({ snoozeMinutes: Number(event.target.value) });
    document.getElementById('snooze-value').textContent = `${event.target.value}m`;
    return;
  }
  if (event.target.id) state().markDirty(event.target.id);
  if (planFields.has(event.target.id)) { const draft = savePlanFromFields(); if (draft) queuePlanSave(); }
  if (event.target.id === 'today-reflection-input') state().setUI({ todayReflectionDraft: event.target.value });
  if (event.target.id === 'reflection-input') state().setUI({ reflectionDraft: event.target.value });
  if (event.target.id === 'meeting-name') state().setUI({ meetingDraft: event.target.value });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state().meetingEditor) closeMeetings();
  if (event.key === 'Escape') document.querySelector('#today-acorns[open]')?.removeAttribute('open');
  if (event.key === 'Escape') document.querySelector('.profile-menu[open]')?.removeAttribute('open');
  if (event.key === 'Enter' && event.target.id === 'today-reflection-input') { event.preventDefault(); document.getElementById('save-today-reflection')?.click(); }
  if (event.key === 'Enter' && event.target.id === 'reflection-input') { event.preventDefault(); document.getElementById('save-reflection')?.click(); }
});
document.addEventListener('contextmenu', event => {
  const block = event.target.closest('[data-meeting-id]');
  if (!block) return;
  event.preventDefault();
  selectMeeting(block.dataset.meetingId);
  if (confirm('Delete this meeting?')) { removeMeeting(block.dataset.meetingId); state().setUI({ selectedMeeting: null }); }
});
document.addEventListener('pointerdown', event => {
  const timeTrack = event.target.closest('.path-track[data-time-scrub]');
  if (timeTrack && event.button === 0) {
    timeDrag = { track: timeTrack, slider: timeTrack.querySelector('#dev-time-slider') };
    event.preventDefault();
    previewTimeDrag(event.clientX);
    try { timeTrack.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers cannot be captured. */ }
    return;
  }
  if (!state().meetingEditor || !event.target.closest('#meeting-calendar .calendar-inner')) return;
  if (event.button !== 0) return;
  const geo = meetingGeometry(event);
  const block = event.target.closest('[data-meeting-id]');
  const meeting = block && (selectedPlan().plan.meetings || []).find(x => x.id === block.dataset.meetingId);
  let mode = 'move';
  if (block) {
    const bounds = block.getBoundingClientRect();
    if (event.clientY - bounds.top <= 11) mode = 'resize-top';
    else if (bounds.bottom - event.clientY <= 11) mode = 'resize-bottom';
  }
  state().setUI({ drag: { y: event.clientY, slot: geo.slot, meeting, mode } });
  const preview = document.createElement('div');
  preview.className = 'meeting-drag-preview';
  geo.inner.append(preview);
  previewMeeting(event);
});
document.addEventListener('pointermove', event => {
  if (timeDrag) previewTimeDrag(event.clientX);
  if (state().drag) previewMeeting(event);
});
document.addEventListener('pointerup', event => {
  if (timeDrag) {
    previewTimeDrag(event.clientX);
    const { slider } = timeDrag;
    timeDrag = null;
    commitTimeSlider(slider);
  }
  if (state().drag) meetingDrop(event);
});
document.addEventListener('pointercancel', () => {
  if (!timeDrag) return;
  timeDrag.slider.dataset.scrubbing = 'false';
  timeDrag = null;
  updateDayPathTime(state().status);
});
appStore.subscribe(acceptStatus);
window.cozy.onStatus(snapshot => state().receive(snapshot));
state().refresh();
