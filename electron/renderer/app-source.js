import { dayPath } from './day-path.js';
import { appStore } from './state.js';

const pages = [
  ['today', '◉', 'Today'], ['plan', '▦', 'Plan'], ['history', '◷', 'History'],
  ['room', '⌂', 'Room'], ['settings', '⚙', 'Settings']
];
const state = () => appStore.getState();
const draftFields = new Set(['settings-focus', 'settings-break', 'notifications', 'reflection-input', 'meeting-name']);
const planFields = new Set(['day-start', 'day-end', 'focus-length', 'break-length']);
const planDraftTimers = new Map();
let planSaveInFlight = false;
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value) : new Date();
const mins = (start, end) => Math.max(0, Math.round((date(end) - date(start)) / 60000));
const clock = value => date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const shortDate = value => date(value).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const timeInput = value => { const d = date(value); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const withTime = (base, value) => { const d = date(base); const [hour, minute] = value.split(':').map(Number); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const countdown = seconds => { if (typeof seconds === 'string' && /^\d+:\d{2}$/.test(seconds)) return seconds; const n = Math.max(0, Math.ceil(Number(seconds) || 0)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
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
    'todayProposedSeconds', 'timer', 'events', 'appActive', 'reminderSequence', 'breakCompleteSequence',
    'publicationEpoch', 'publicationNumber']);
  if (state().page !== 'today') {
    for (const key of ['guidance', 'todayGuidance', 'todaySituation', 'todayTitle']) changing.add(key);
  }
  const stable = snapshot => JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([key]) => !changing.has(key))));
  const editing = state().dirtyInputs.size > 0 || document.activeElement?.matches('input, textarea, select, [contenteditable]');
  if (before.page !== status.page || before.profile !== status.profile || !editing) state().deferRender(false);
  else if (editing) state().deferRender(true);
  if (stable(before) === stable(status) || state().renderDeferred) {
    const timer = document.getElementById('timer-countdown');
    if (timer) timer.textContent = countdown(status.countdown ?? status.displaySeconds);
  } else render();
}
function navigation() {
  const s = state().status;
  document.getElementById('profile-badge').innerHTML = `◉ ${html((s.profile || 'personal').replace(/^./, c => c.toUpperCase()))} profile${s.canSwitchProfiles && s.profile === 'personal' && s.phase === 'idle' ? '<br><button data-action="switch-profile" data-value="testing" id="switch-to-testing">Use Testing</button>' : ''}`;
  document.getElementById('navigation').innerHTML = pages.map(([key, icon, name]) => `<button class="nav-button ${state().page === key ? 'active' : ''}" data-page="${key}" id="nav-${key}" ${state().page === key ? 'aria-current="page"' : ''}><span class="nav-icon">${icon}</span>${name}</button>`).join('');
}
function guidance() {
  const s = state().status;
  if (s.todayGuidance || s.guidance) return s.todayGuidance || s.guidance;
  if (s.phase === 'focus') return { title: s.breakDue ? 'A break is ready when you are.' : 'A little focus, one step at a time.', detail: 'Your companion is here with you.' };
  if (s.phase === 'rest' || s.phase === 'break') return { title: 'Take a real break.', detail: 'Step away and come back when you are ready.' };
  return { title: 'Ready when you are.', detail: 'A gentle focus session is a good place to start.', action: 'focus' };
}
function todayActions(g) {
  const s = state().status;
  const longerBreak = actionButton(`Longer break · ${Math.max(s.breakLength || 10, 20)}m`, 'start-long-break');
  if (s.phase === 'focus') return `${actionButton('Take a break', g.breakAction ? 'today-break' : 'start-break', undefined, true, 'start-break')} ${longerBreak} ${s.breakDue ? `${actionButton('Snooze 5m', 'snooze-break', undefined, false, 'snooze-break')} ${actionButton('Skip', 'skip-break', undefined, false, 'skip-break')}` : actionButton('End focus', 'end-focus', undefined, false, 'end-focus')}`;
  if (s.phase === 'rest' || s.phase === 'break') return actionButton('Finish break', 'finish-break', undefined, true, 'finish-break');
  if (g.situation === 'noPlan') return `${actionButton('Start focus', 'start-focus', undefined, true, 'start-focus')} <button class="button" data-page="plan" id="today-edit-plan">Shape a plan</button>`;
  if (g.action?.type === 'editPlan' || g.action === 'editPlan' || g.action === 'edit-plan') return `<button class="button primary" data-page="plan" id="today-edit-plan">Edit plan</button>`;
  if (g.action?.type === 'rest' || g.action === 'rest' || g.action === 'break') return `${actionButton('Start break', 'today-suggestion', undefined, true, 'start-break')} ${actionButton('Snooze 5m', 'snooze-break')} ${longerBreak}`;
  if (!g.action && ['meeting', 'meetingSoon'].includes(g.situation)) return '<button class="button" data-page="plan">View plan</button>';
  return `${actionButton('Start focus', g.action ? 'today-suggestion' : 'start-focus', undefined, true, 'start-focus')} ${longerBreak}`;
}
function timelineRows(items, actual = false) {
  return items.map(item => `<div class="timeline-row"><time>${clock(item.start)}</time><span class="title">${html(actual ? item.kind === 'away' ? 'Away' : item.kind === 'break' ? item.confirmed ? 'Confirmed break' : 'Break' : 'Focus' : item.title || item.kind)}</span><span class="length">${mins(item.start, item.end)}m</span></div>`).join('');
}
function today() {
  const s = state().status, g = guidance();
  const phase = s.phase === 'focus' ? 'Focusing' : s.phase === 'break' ? 'Taking a break' : 'Ready when you are';
  return `<div class="today-page"><header class="today-head"><div><div class="eyebrow">${html(shortDate(s.currentWallTimeISO || s.currentWallTime || Date.now()))}</div><h1>Your little corner of today</h1></div><div class="today-acorns" aria-label="${html(s.balance ?? 0)} acorns available"><span>✦</span> ${html(s.balance ?? 0)} <small>acorns</small></div></header><section class="today-stage"><div class="today-stage-copy"><div class="today-phase"><span class="phase-dot ${html(s.phase)}"></span>${html(phase)}</div><h2 id="today-guidance">${html(g.title)}</h2>${s.phase !== 'idle' ? `<div class="timer" id="timer-countdown">${countdown(s.countdown ?? s.displaySeconds)}</div>` : ''}<p class="today-detail">${html(g.detail || '')}</p><div class="today-actions">${todayActions(g)}</div></div><div class="today-companion"><div class="companion-sun"></div><img src="red-panda.png" alt="Your red panda companion"><span>${s.phase === 'break' ? 'A little rest together' : s.phase === 'focus' ? 'One step at a time' : 'Here with you'}</span></div></section>${dayPath(s)}<div class="today-footnote"><span><b>${html(s.focusMinutesToday || 0)}</b> min focused</span><span><b>${html(s.breakMinutesToday || 0)}</b> min of real breaks</span><button data-page="history">See your rhythm →</button></div>${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}</div>`;
}
function calendar(items, dayStart, dayEnd, meetingMode = false) {
  const start = date(dayStart || items[0]?.start), end = date(dayEnd || new Date(start.getTime() + 8 * 3600000));
  const duration = Math.max(15, Math.round((end - start) / 60000));
  const height = duration * 1.2;
  const lines = Array.from({ length: Math.ceil(duration / 60) + 1 }, (_, i) => `<div class="hour-line" style="top:${i * 72}px"><span>${clock(start.getTime() + i * 3600000)}</span></div>`).join('');
  const blocks = items.map(item => {
    const top = Math.max(0, Math.round((date(item.start) - start) / 60000));
    const length = Number(item.minutes ?? item.duration ?? mins(item.start, item.end));
    const clipped = Math.min(length, duration - top);
    if (clipped <= 0 || top >= duration) return '';
    const kind = itemKind(item);
    const selected = meetingMode && state().selectedMeeting === item.id;
    return `<div class="calendar-block ${html(kind)} ${selected ? 'selected' : ''}" style="top:${top * 1.2}px;height:${clipped * 1.2}px" ${meetingMode ? `data-meeting-id="${html(item.id)}"` : ''} title="${html(item.title || item.kind)} at ${clock(item.start)}"><span>${html(item.title || item.kind)}</span><span>${clipped}m</span></div>`;
  }).join('');
  return `<div class="calendar ${meetingMode ? 'meeting-calendar' : ''}" ${meetingMode ? 'id="meeting-calendar"' : 'id="suggested-day-calendar"'}><div class="calendar-inner" style="height:${height + 4}px" data-day-start="${html(start.toISOString())}" data-day-minutes="${duration}">${lines}${blocks}</div></div>`;
}
function selectedPlan() {
  const s = state().status;
  const key = state().planDay === 'tomorrow' ? s.tomorrowKey : s.todayKey;
  const record = s.dayPlans?.[key] || {};
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const defaults = { dayKey: key, start: new Date(year, month - 1, day, 9).toISOString(),
    end: new Date(year, month - 1, day, 17).toISOString(), meetings: [],
    focusMinutes: s.defaultFocusLength || 25, breakMinutes: s.defaultBreakLength || 5 };
  const plan = state().planDrafts[key] || record.current || defaults;
  const ended = state().planDay === 'today' && record.current &&
    new Date(s.currentWallTimeISO || Date.now()) >= new Date(record.current.end);
  const timeline = state().planDay === 'tomorrow' ? record.suggestedTimeline || [] :
    ended ? s.plannedTimeline || [] : s.forecastTimeline || [];
  return { key, date, record, plan, timeline, ended, bounds: state().planBounds[key] || {} };
}
function plan() {
  const s = state().status, view = selectedPlan();
  const yesterday = (s.yesterdayTimeline || []).filter(x => x.kind === 'focus' || (x.kind === 'break' && x.confirmed));
  const saved = s.savedReflection ?? null;
  const editing = state().reflectionDraft !== null || !saved;
  const reflection = editing ? `<p class="muted">What felt good? What would make breaks easier today?</p><input class="text-input" id="reflection-input" placeholder="A few words are enough…" value="${html(state().reflectionDraft ?? saved ?? '')}"><div class="actions" style="justify-content:flex-end;margin-top:9px">${saved ? actionButton('Cancel', 'cancel-reflection-edit', undefined, false, 'cancel-reflection-edit') : ''}${actionButton('Save reflection', 'save-reflection', undefined, false, 'save-reflection')}</div>` : `<div class="reflection-saved"><span class="green">●</span><div><b>Saved</b><p class="muted">${html(saved)}</p></div></div>`;
  const reflectionCard = state().planDay === 'today' ? card(`<div class="card-head">${section('Yesterday, briefly')}${saved && !editing ? actionButton('Edit reflection', 'edit-reflection', undefined, false, 'edit-reflection') : ''}</div><div class="inline-metrics"><span>Focus · ${s.yesterdayFocusMinutes || 0} min</span><span>Confirmed breaks · ${s.yesterdayBreakMinutes || 0} min</span></div>${yesterday.map(x => `<div class="line-row"><span>${x.kind === 'focus' ? 'Focus' : 'Break'}</span><span class="spacer"></span><time>${clock(x.start)} · ${Math.round((x.observedSeconds || mins(x.start, x.end) * 60) / 60)} min</time></div>`).join('')}${reflection}`) : '';
  const meetings = (view.plan.meetings || []).map(m => `<div class="line-row"><span>${html(m.title)}</span><span class="spacer"></span><time>${clock(m.start)}–${clock(m.end)}</time></div>`).join('') || empty('No meetings planned yet.');
  const dayButtons = `<div class="actions"><button class="button ${state().planDay === 'today' ? 'primary' : ''}" data-plan-day="today">Today</button><button class="button ${state().planDay === 'tomorrow' ? 'primary' : ''}" data-plan-day="tomorrow">Tomorrow</button></div>`;
  const planSaving = state().pendingPlanKey === view.key;
  const planFeedback = `<p class="calculation-status ${state().error ? 'error' : ''}" id="plan-save-status" role="status">${planSaving ? '<span class="spinner" aria-hidden="true"></span>Saving…' : state().error ? html(state().error) : view.record.baseline ? 'Saved' : ''}</p>`;
  const startValue = view.record.baseline ? timeInput(view.plan.start) : view.bounds.start || '';
  const endValue = view.record.baseline ? timeInput(view.plan.end) : view.bounds.end || '';
  const bounds = card(`${section('Your hours and rhythm')}<div class="inline-fields"><label class="field"><span>Start</span><input type="time" id="day-start" value="${html(startValue)}"></label><label class="field"><span>Finish</span><input type="time" id="day-end" value="${html(endValue)}"></label><label class="field"><span>Focus · min</span><input type="number" id="focus-length" min="5" max="120" step="5" value="${view.plan.focusMinutes}"></label><label class="field"><span>Break · min</span><input type="number" id="break-length" min="5" max="60" step="5" value="${view.plan.breakMinutes}"></label></div>${planFeedback}`);
  const meetingCard = `<button class="card meeting-link" id="open-meetings" style="display:block;width:100%;text-align:left;border-color:rgba(64,74,59,.07);color:inherit;cursor:pointer">${section('Meetings')}${meetings}<span class="green" style="font-size:11px">Open day calendar ↗</span></button>`;
  const hasDraft = Boolean(state().planDrafts[view.key]);
  const timelineTitle = state().planDay === 'tomorrow' ? 'Suggested timeline' : view.ended ? 'Saved plan' : 'Live forecast';
  const timelineNote = hasDraft && view.record.current ? '<p class="small-note">Updating this forecast from your latest changes…</p>' : '';
  const timeline = card(`${section(timelineTitle)}${timelineNote}${view.timeline.length ? calendar(view.timeline, view.record.current?.start || view.plan.start, view.record.current?.end || view.plan.end) : empty(view.record.current ? 'No time remains in this plan.' : 'Enter your start and finish to see suggested focus and break times.')}`);
  return `${header('Shape your day', `Plan for ${shortDate(view.date)}. A plan is a guide, not a rule.`)}${dayButtons}${reflectionCard}${bounds}${meetingCard}${timeline}`;
}
function history() {
  const s = state().status, plan = s.plannedTimeline || [], actual = s.actualTimeline || [], entries = s.history || [];
  return `${header('Your rhythm', 'Small steps, recorded honestly.')}${card(`${section('Planned and actual timeline')}<div class="split"><div><h3>PLANNED</h3>${plan.length ? timelineRows(plan) : empty('No plan saved today.')}</div><div><h3>ACTUAL</h3>${actual.length ? timelineRows(actual, true) : empty('No sessions recorded today.')}</div></div>`)}${card(`${section('Today’s actual moments')}${entries.length ? entries.map(entry => `<div class="line-row"><span class="green">●</span><span>${html(entry.title)}</span><span class="spacer"></span><time>${clock(entry.date)}</time></div>`).join('') : empty('Your first focus session will appear here.')}`)}${card(`${section('The whole day')}<div class="metric"><span>Focus time recorded</span><b>${s.focusMinutesToday || 0} min</b></div><div class="metric"><span>Break time confirmed</span><b>${s.breakMinutesToday || 0} min</b></div><div class="metric"><span>Acorns available</span><b>${s.balance ?? 0}</b></div>`)}`;
}
function room() {
  const s = state().status, balance = s.balance ?? 0, unlocked = s.unlockedItems || [];
  const has = id => unlocked.includes(id);
  const shop = (s.shopItems || []).map(item => `<div class="shop-row"><span class="icon">${item.id === 'plant' ? '❧' : item.id === 'lamp' ? '♧' : '◉'}</span><span class="name">${html(item.name)}</span>${has(item.id) ? '<span class="muted">Unlocked</span>' : `<button class="button" data-action="purchase" data-value="${html(item.id)}" id="purchase-${html(item.id)}" ${balance < item.cost ? 'disabled' : ''}>${item.cost} acorns</button>`}</div>`).join('');
  return `${header('Your little room', 'Show up, rest, and make it your own.')}${card(`<div class="room-card"><div class="room-stage">${has('cushion') ? '<span class="decoration cushion" aria-label="Soft cushion">●</span>' : ''}${has('plant') ? '<span class="decoration plant" aria-label="Window plant">❧</span>' : ''}<img src="red-panda.png" alt="Your red panda companion">${has('lamp') ? '<span class="decoration lamp" aria-label="Reading lamp">♧</span>' : ''}</div><h2>A cozy corner for your companion</h2><span class="muted">${balance} acorns to spend</span></div>`)}${card(`${section('Little comforts')}${shop}`)}`;
}
function settings() {
  const s = state().status, preview = s.rebalancePreview;
  return `${header('Make it yours', 'A few gentle defaults.')}${card(`${section('Focus & breaks')}<div class="inline-fields"><label class="field"><span>Default focus · minutes</span><input type="number" id="settings-focus" min="5" max="120" step="5" value="${s.defaultFocusLength || 25}"></label><label class="field"><span>Default break · minutes</span><input type="number" id="settings-break" min="5" max="60" step="5" value="${s.defaultBreakLength || 5}"></label></div><label class="check-field"><input type="checkbox" id="notifications" ${s.notificationsEnabled !== false ? 'checked' : ''}> Gentle notifications</label>${actionButton('Save preferences', 'save-preferences', undefined, true)}`)}${card(`${section('Reward preview')}<p class="muted">Try different reward values against your saved sessions. This preview does not change your balance or history.</p><div class="inline-fields"><label class="field"><span>Focus credit · per minute</span><input type="number" id="preview-focus" min="0" max="5" step="1" value="${state().rewardDraft?.focusCreditsPerMinute ?? s.previewFocusCredits ?? 1}"></label><label class="field"><span>Break bonus · acorns</span><input type="number" id="preview-break" min="0" max="50" step="5" value="${state().rewardDraft?.breakBonus ?? s.previewBreakBonus ?? 10}"></label></div>${preview ? `<p>${preview.focusSessions} focus sessions · ${preview.confirmedBreaks} confirmed breaks</p><b>Current ${preview.currentBalance} → Preview ${preview.projectedBalance} acorns</b>` : ''}`)}${card(`${section('Data profile')}<label class="field"><span>Profile</span><select id="data-profile" ${s.canSwitchProfiles === false ? 'disabled' : ''}><option value="personal" ${s.profile === 'personal' ? 'selected' : ''}>Personal</option><option value="testing" ${s.profile === 'testing' ? 'selected' : ''}>Testing</option></select></label><p class="small-note">${s.canSwitchProfiles === false ? 'Development runs are locked to the isolated Testing profile.' : 'Each profile has its own history and rewards. Testing never writes to Personal.'}</p>`)}${card(`${section('Your data')}<p class="muted">Your timeline stays in a local SQLite database on this Mac.</p><div class="actions">${actionButton('Export JSON', 'export-json')}${actionButton('Back up database', 'backup-database')}</div>`)}${s.developmentMode ? card(`${section('Development scenarios')}<p class="muted">Exercise the full loop without waiting for real time.</p><div class="actions">${actionButton('Morning setup', 'dev-scenario', 'morning')}${actionButton('Break due', 'dev-scenario', 'breakDue')}${actionButton('Completed day', 'dev-scenario', 'completedDay')}${actionButton('Advance 5 min', 'dev-advance', 5)}${actionButton('Simulate away', 'dev-away')}${actionButton('Simulate return', 'dev-return')}${actionButton('Sleep / wake', 'dev-sleep-wake')}</div>`) : ''}${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}`;
}
function meetingDialog() {
  const view = selectedPlan(), meetings = view.plan.meetings || [], meeting = meetings.find(x => x.id === state().selectedMeeting);
  const selected = meeting ? `<input class="text-input" id="meeting-name" aria-label="Meeting name" value="${html(state().meetingDraft || meeting.title)}"><span class="muted">${clock(meeting.start)}–${clock(meeting.end || date(meeting.start).getTime() + meeting.duration * 60000)}</span><button class="button" id="delete-meeting">Delete</button>` : '<span class="muted">Select a meeting to rename it. Right-click a block to delete it.</span>';
  document.getElementById('dialog-root').innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Meetings"><div class="modal-top"><div><h2>Meetings</h2><p>Drag empty space to add. Drag a block to move it. Drag its edges to resize. Snaps to 15 minutes.</p></div><button class="button" id="close-meetings" aria-label="Close calendar">×</button></div><div class="selection">${selected}</div>${calendar(meetings.map(m => ({ ...m, kind: 'Meeting' })), view.plan.start, view.plan.end, true)}</section></div>`;
}
function render() {
  state().deferRender(false);
  state().clearDirty();
  navigation();
  const view = { today, plan, history, room, settings }[state().page] || today;
  const content = document.getElementById('content');
  const scroll = content.scrollTop;
  content.innerHTML = `<div class="page">${view()}</div>`;
  content.scrollTop = scroll;
  if (state().meetingEditor) meetingDialog();
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
function savePreferences() {
  const value = { focusLength: Number(document.getElementById('settings-focus').value), breakLength: Number(document.getElementById('settings-break').value), notificationsEnabled: document.getElementById('notifications').checked };
  state().clearDirty();
  state().deferRender(false);
  dispatch('save-preferences', value);
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
function meetingDrop(event) {
  const drag = state().drag;
  state().setUI({ drag: null });
  if (!drag) return;
  const geo = meetingGeometry(event);
  if (!geo) return;
  const targetSlot = Math.max(0, Math.min(geo.slotCount, Math.round((event.clientY - geo.rect.top) / 18)));
  let first, last;
  if (drag.meeting) {
    const originalStart = Math.round((date(drag.meeting.start) - geo.start) / 900000);
    const length = Math.max(1, Math.round((drag.meeting.duration ?? mins(drag.meeting.start, drag.meeting.end)) / 15));
    const delta = Math.round((event.clientY - drag.y) / 18);
    if (drag.mode === 'resize-top') { first = Math.max(0, Math.min(originalStart + delta, originalStart + length - 1)); last = originalStart + length; }
    else if (drag.mode === 'resize-bottom') { first = originalStart; last = Math.max(first + 1, Math.min(geo.slotCount, originalStart + length + delta)); }
    else { first = Math.max(0, Math.min(geo.slotCount - length, originalStart + delta)); last = first + length; }
    if (first === originalStart && last === originalStart + length) { selectMeeting(drag.meeting.id); return; }
  } else {
    first = Math.min(drag.slot, targetSlot);
    last = Math.max(drag.slot + 1, targetSlot);
    first = Math.max(0, Math.min(first, geo.slotCount - 1));
    last = Math.max(first + 1, Math.min(last, geo.slotCount));
  }
  const start = new Date(geo.start.getTime() + first * 900000).toISOString();
  const end = new Date(geo.start.getTime() + last * 900000).toISOString();
  upsertMeeting({ id: drag.meeting?.id, title: drag.meeting?.title || 'Meeting', start, end });
}
document.addEventListener('click', event => {
  const planDay = event.target.closest('[data-plan-day]');
  if (planDay) { flushPlanDraft(); state().selectPlanDay(planDay.dataset.planDay); render(); return; }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { flushPlanDraft(); state().setPage(pageButton.dataset.page); dispatch('navigate', state().page); render(); return; }
  if (event.target.closest('#open-meetings')) { state().setUI({ meetingEditor: true }); meetingDialog(); return; }
  if (event.target.closest('#close-meetings') || event.target.id === 'modal-backdrop') { closeMeetings(); return; }
  if (event.target.closest('#delete-meeting')) { if (state().selectedMeeting) removeMeeting(state().selectedMeeting); state().setUI({ selectedMeeting: null, meetingDraft: '' }); meetingDialog(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const name = button.dataset.action;
  if (name === 'edit-reflection') { state().setUI({ reflectionDraft: state().status.savedReflection ?? '' }); render(); document.getElementById('reflection-input')?.focus(); return; }
  if (name === 'cancel-reflection-edit') { state().setUI({ reflectionDraft: null }); render(); return; }
  if (name === 'save-reflection') { const value = document.getElementById('reflection-input')?.value.trim(); if (value) { state().setUI({ reflectionDraft: null }); state().clearDirty('reflection-input'); state().deferRender(false); dispatch(name, value); } return; }
  if (name === 'save-preferences') { savePreferences(); return; }
  if (name === 'start-focus' && !state().status.dayPlans?.[state().status.todayKey]?.baseline) {
    dispatch(name, { planDraft: state().planDrafts[state().status.todayKey] }); return;
  }
  let value = button.dataset.value;
  if (value !== undefined) { try { value = JSON.parse(value); } catch {} }
  dispatch(name, value);
});
document.addEventListener('change', event => {
  if (planFields.has(event.target.id)) { const draft = savePlanFromFields(); if (draft) queuePlanSave(); }
  if (event.target.id === 'data-profile') dispatch('switch-profile', event.target.value);
  if (['preview-focus', 'preview-break'].includes(event.target.id)) {
    state().setUI({ rewardDraft: { focusCreditsPerMinute: Number(document.getElementById('preview-focus').value), breakBonus: Number(document.getElementById('preview-break').value) } });
    dispatch('preview-rewards', state().rewardDraft);
  }
  if (event.target.id === 'meeting-name') saveMeetingName();
});
document.addEventListener('input', event => {
  if (event.target.id) state().markDirty(event.target.id);
  if (planFields.has(event.target.id)) { const draft = savePlanFromFields(); if (draft) queuePlanSave(); }
  if (event.target.id === 'reflection-input') state().setUI({ reflectionDraft: event.target.value });
  if (event.target.id === 'meeting-name') state().setUI({ meetingDraft: event.target.value });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state().meetingEditor) closeMeetings();
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
});
document.addEventListener('pointerup', event => { if (state().drag) meetingDrop(event); });
appStore.subscribe(acceptStatus);
window.cozy.onStatus(snapshot => state().receive(snapshot));
state().refresh();
