import { timelineTrack, timelinePercent, connectTimelineInteractions } from './timeline-track.js';
import { dayPath } from './day-path.js';
import { amountList, amounts, checkInCard, checkInNote, createHud, resourceIcon } from './game-hud.js';
import { appStore } from './state.js';

connectTimelineInteractions();

const pages = [
  ['today', '◉', 'Today'], ['plan', '▦', 'Plan'], ['history', '◷', 'History']
];
const state = () => appStore.getState();
const draftFields = new Set(['settings-focus', 'settings-break', 'settings-start', 'settings-end', 'settings-activity-delay', 'notifications', 'reflection-input', 'today-reflection-input', 'meeting-name', 'actual-start-time']);
const planFields = new Set(['day-start', 'day-end', 'focus-length', 'break-length']);
const planDraftTimers = new Map();
let planSaveInFlight = false;
let settingsSavePending = false;
let settingsSaveFeedback = null;
let timeDrag = null;
// What Today last drew. A full render happens only when the page shell changes;
// the countdown, Up next, day path, and presence badge update in place.
let todayShell = null, todayUpNextMarkup = null, todayPathKey = null;
let fullRenderCount = 0, dayPathDrawCount = 0;
// One island slot lives for the whole window. Each Today render moves it into the new page,
// so a canvas mounted inside it survives re-renders and is never rebuilt.
const islandSlot = document.createElement('div');
islandSlot.className = 'today-island';
islandSlot.id = 'today-island';
islandSlot.setAttribute('aria-hidden', 'true');
// The sky island scene (game.js) mounts inside the slot once. If it is missing or fails, the slot keeps its CSS sky.
try { window.focusIslandsGame?.mount(islandSlot); } catch (error) { console.error('Sky island could not mount:', error); }
let islandShownKey = null;
// The check-in card (or, after a tap, one short note) sits over the island. It lives for the whole window too,
// and is redrawn only when its card token (or the last check-in) changes, so it stays put through the
// once-a-second status. Unlike the island, it is read by screen readers.
const checkInSlot = document.createElement('div');
checkInSlot.className = 'today-check-in';
checkInSlot.id = 'today-check-in';
let checkInKey = null;
// The resource bar over the top of the island (game-hud.js). Like the card, it lives for the whole window,
// is read by screen readers, and redraws only when its numbers change.
const hud = createHud();
// The bar and the card share one layer over the island, the bar at the top and the card at the bottom, so they
// never cover each other. If together they need more room than the island has, the stage grows instead.
const islandOverlay = document.createElement('div');
islandOverlay.className = 'today-island-overlay';
islandOverlay.append(hud.slot, checkInSlot);
// The game demo's panel (the demo app only; status.demo is null everywhere else). It sits under the island, lives
// for the whole window like the slots above, and each of its three parts is redrawn only when its markup changes.
const demoSlot = document.createElement('section');
demoSlot.className = 'demo-panel';
demoSlot.id = 'demo-panel';
demoSlot.setAttribute('aria-label', 'Game demo');
demoSlot.innerHTML = '<div class="demo-status" id="demo-status" role="status"></div><div class="demo-body"><div class="demo-controls" id="demo-controls"></div><div class="demo-log-box"><h3>Last steps</h3><ol class="demo-log" id="demo-log"></ol></div></div>';
const demoParts = ['status', 'controls', 'log'].map(name => [name, demoSlot.querySelector(`.demo-${name}`)]);
const demoShown = {};
let demoBusy = null, demoConfirmUntil = 0, demoError = '';
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
    'publicationEpoch', 'publicationNumber', 'returnPrompt', 'guidance', 'todayGuidance', 'todaySituation', 'todayTitle']);
  const stable = snapshot => JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([key]) => !changing.has(key))));
  const editing = state().dirtyInputs.size > 0 || document.activeElement?.matches('input, textarea, select, [contenteditable]');
  if (before.page !== status.page || before.profile !== status.profile || before.todayKey !== status.todayKey || !editing) state().deferRender(false);
  else if (editing) state().deferRender(true);
  if (before.returnPrompt?.since !== status.returnPrompt?.since && !state().renderDeferred) render();
  else if (state().renderDeferred) updateTodayLive(status);
  else if (showingToday()) {
    if (today() !== todayShell) render();
    else updateTodayLive(status);
  } else if (state().page === 'history') {
    // History's times are rounded to the minute, so it redraws only when what it shows changes.
    if (history() !== historyShell) render();
  } else if (stable(before) !== stable(status)) render();
  else updateTodayLive(status);
  updatePresenceDisplay();
  updateDayPathTime(status);
}
function showingToday() {
  return !{ plan, history, settings }[state().page];
}
// The day path redraws only when this minute-rounded view of it changes: at most once a minute, or when
// its blocks change. The marker, time label, and the two minute totals update in place every second.
// Block times are rounded too, because each forecast recalculation can shift them by a millisecond.
const toMinute = value => { const time = date(value).getTime(); return Number.isFinite(time) ? new Date(Math.round(time / 60000) * 60000).toISOString() : value; };
const minuteBlocks = blocks => blocks?.map(block => ({ ...block, start: toMinute(block.start), end: toMinute(block.end) }));
function dayPathDrawing(status) {
  const minute = Math.floor(Number(status.currentWallTime) / 60) * 60;
  return dayPath({ ...status, workingMinutesToday: 0, breakMinutesToday: 0,
    ...(Number.isFinite(minute) ? { currentWallTime: minute, currentWallTimeISO: new Date(minute * 1000).toISOString() } : {}),
    forecastTimeline: minuteBlocks(status.forecastTimeline), plannedTimeline: minuteBlocks(status.plannedTimeline),
    defaultDayPath: status.defaultDayPath && { ...status.defaultDayPath, timeline: minuteBlocks(status.defaultDayPath.timeline) } });
}
function updateTodayLive(status) {
  const timer = document.getElementById('timer-countdown');
  if (timer) timer.textContent = shownCountdown(status);
  const upNextSlot = document.querySelector('[data-up-next-slot]');
  if (upNextSlot) {
    const markup = todayUpNext(status);
    if (markup !== todayUpNextMarkup) { upNextSlot.innerHTML = markup; todayUpNextMarkup = markup; }
  }
  const pathSlot = document.querySelector('[data-day-path-slot]');
  const scrubbing = timeDrag || pathSlot?.querySelector('#dev-time-slider')?.dataset.scrubbing === 'true';
  if (pathSlot && !scrubbing) {
    const key = dayPathDrawing(status);
    if (key !== todayPathKey) {
      pathSlot.innerHTML = dayPath(status);
      todayPathKey = key;
      dayPathDrawCount++;
      showRenderCounts();
    }
    const [working, resting] = pathSlot.querySelectorAll('.path-totals b');
    if (working) working.textContent = String(status.workingMinutesToday || 0);
    if (resting) resting.textContent = String(status.breakMinutesToday || 0);
  }
  updateGameHud(status);
  updateDemoPanel(status);
}
// ---- Game demo. Each button runs one demo step in the main process: the same actions as Today's buttons and the
// development clock, one after another (see demoStep in electron/core/index.js). Everything else is the real app.
const demoGroups = [
  ['In the day', [
    ['work', s => `Work ${s.focusLength || 60} min`, s => `Start focus (or finish the running break, which starts focus), then move the clock ${s.focusLength || 60} minutes, so a break is due.`],
    ['break', () => 'Break 15 min', () => 'Take a break (this ends focus), move the clock 15 minutes, then Finish break. Focus starts again by itself.'],
    ['work-interrupted', () => 'Interrupted work', () => 'Work 20 minutes, then take a break early, before the focus target. The break keeps running.'],
    ['break-interrupted', () => 'Interrupted break', () => 'Take a break, move the clock 4 minutes, then Finish break early. That is too short to count as a real break.'],
    ['away', () => 'Step away 15 min', () => "Leave the computer for 15 minutes, then press I'm back. During focus, the time away counts as a break."],
  ]],
  ['Days', [
    ['end-day', () => 'End the day', () => "End the day now, as Today's End day button does. The end-of-day card follows."],
    ['next-morning', () => 'Next morning', () => "Move the clock to tomorrow's start time. A session that is still running ends with the day first."],
  ]],
  ['Jumps', [
    ['week', () => 'Play a week', () => 'Play 7 steady days: follow the plan, take real breaks, end each day, and pick the first choice on every card. Starts today if nothing has happened yet this morning, otherwise tomorrow.'],
    ['month', () => 'Play a month', () => 'Play 30 steady days the same way. This takes a few seconds.'],
    ['start-over', () => 'Start over', () => "Delete this demo's history and begin again on day 1 at the start time, with nothing earned."],
  ]],
];
const demoInDay = new Set(['work', 'break', 'work-interrupted', 'break-interrupted', 'away', 'end-day']);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
function demoStatusLine(s) {
  const game = s.game || {}, minutes = seconds => Math.floor((Number(seconds) || 0) / 60);
  const elapsed = minutes(s.timer?.elapsedSeconds), target = minutes(s.timerTargetSeconds);
  const phase = s.dayEndedAt ? 'Day done' : s.inferredBreakActive ? 'Away, counting as a break'
    : s.phase === 'focus' ? `Focus ${elapsed} of ${target} min${s.breakDue ? ' · break due' : ''}`
      : s.phase === 'break' ? `Break ${elapsed} of ${target} min` : 'No session running';
  const onHand = amountList(game.onHand), waiting = amountList(game.waiting);
  const buildings = (game.islands || []).reduce((sum, island) => sum + (island.buildings?.length || 0), 0);
  const town = [plural((game.islands || []).length, 'island'), plural(buildings, 'building'), plural((game.helpers || []).length, 'helper'),
    plural(game.checkIns || 0, 'check-in'), plural(game.activeDays || 0, 'active day')];
  return `<div class="demo-line"><span class="demo-tag">Game demo</span><b>Day ${html(s.demo.day)}</b><span>${html(clock(s.currentWallTimeISO))}</span><span class="demo-phase">${html(phase)}</span></div>
    <div class="demo-line"><span>On hand: <b>${html(onHand.join(' · ') || 'nothing yet')}</b></span>${waiting.length ? `<span>Waiting to collect: <b>${html(waiting.join(' · '))}</b></span>` : ''}</div>
    <div class="demo-line"><span>${html(town.join(' · '))}</span></div>`;
}
function demoControls(s) {
  const confirming = Date.now() < demoConfirmUntil;
  const groups = demoGroups.map(([title, steps]) => `<div class="demo-group" role="group" aria-label="${html(title)}"><span class="demo-group-title">${html(title)}</span>${steps.map(([step, label, hint]) => {
    const off = Boolean(demoBusy) || (demoInDay.has(step) && Boolean(s.dayEndedAt));
    const warn = step === 'start-over' && confirming;
    return `<button class="button${step === demoBusy ? ' is-busy' : ''}${warn ? ' is-warning' : ''}" type="button" data-demo-step="${step}" title="${html(hint(s))}"${off ? ' disabled' : ''}>${html(warn ? 'Click again to wipe' : label(s))}</button>`;
  }).join('')}</div>`).join('');
  const note = demoError || (demoBusy ? (demoBusy === 'week' ? 'Playing 7 days…' : demoBusy === 'month' ? 'Playing 30 days…' : 'Fast-forwarding…')
    : confirming ? 'Click Start over again within 5 seconds to delete this demo and begin again.'
      : s.dayEndedAt ? `The day is done. ${s.game?.checkIn ? 'Pick on the card when you like, then press' : 'Press'} Next morning.`
        : s.game?.checkIn ? 'A card is waiting on the island. Pick on it when you like. If you keep going first, it stays and gathers what you earn next, as in the real app.' : '');
  return `${groups}${note ? `<p class="demo-note${demoError ? ' error' : ''}" id="demo-note">${html(note)}</p>` : ''}`;
}
function demoLogItems(s) {
  return (s.demo.log || []).slice(-4).reverse().map(entry => `<li><time>${entry.day ? `Day ${html(entry.day)} · ` : ''}${html(clock(entry.at))}</time><span>${html(entry.text)}</span></li>`).join('');
}
function updateDemoPanel(status) {
  if (!status.demo) return;
  const parts = { status: demoStatusLine(status), controls: demoControls(status), log: demoLogItems(status) };
  for (const [name, node] of demoParts) {
    if (demoShown[name] === parts[name]) continue;
    demoShown[name] = parts[name];
    node.innerHTML = parts[name];
  }
}
async function runDemoStep(step) {
  if (demoBusy) return;
  demoError = '';
  // Start over asks for a second click, so one stray click can't wipe the demo.
  if (step === 'start-over' && Date.now() >= demoConfirmUntil) {
    demoConfirmUntil = Date.now() + 5000;
    updateDemoPanel(state().status);
    setTimeout(() => updateDemoPanel(state().status), 5100);
    return;
  }
  demoConfirmUntil = 0;
  demoBusy = step;
  updateDemoPanel(state().status);
  try { await state().command('dev-demo', step); }
  catch (error) {
    demoError = (error.message || String(error)).replace(/^Error invoking remote method 'focus-islands:action': Error: /, '');
    state().setUI({ error: null });
  } finally {
    demoBusy = null;
    updateDemoPanel(state().status);
  }
}
// ---- Sky island check-in. The bar and the card are drawn by game-hud.js; this keeps them in step with the status.
function updateCheckIn(status) {
  const game = status.game, card = game?.checkIn;
  const key = card?.token ? `card:${card.token}` : game?.lastCheckIn ? `note:${status.profile}:${game.lastCheckIn.number}` : '';
  if (key === checkInKey) return;
  checkInKey = key;
  let markup = '';
  try { markup = card?.token ? checkInCard(status) : checkInNote(game); }
  catch (error) { console.error('Could not show the island check-in:', error); }
  checkInSlot.innerHTML = markup;
  checkInSlot.dataset.state = !markup ? 'empty' : card?.token ? 'card' : 'note';
}
function updateGameHud(status) {
  try { hud.update(status); } catch (error) { console.error('Could not show the island resources:', error); }
  updateCheckIn(status);
}
async function tapCheckIn(button) {
  const cardNode = button.closest('.check-in-card');
  if (!cardNode || cardNode.getAttribute('aria-busy') === 'true') return;
  const buttons = [...cardNode.querySelectorAll('button')];
  cardNode.setAttribute('aria-busy', 'true');
  button.classList.add('is-picked');
  buttons.forEach(node => { node.disabled = true; });
  try {
    await dispatch('game-check-in', { token: cardNode.dataset.token, pick: button.dataset.checkInPick || null });
  } finally {
    // The same card is still showing when the tap was refused; let it be tapped again.
    if (checkInSlot.contains(cardNode)) {
      cardNode.removeAttribute('aria-busy');
      button.classList.remove('is-picked');
      buttons.forEach(node => { node.disabled = false; });
    }
  }
}
// Development only: hidden counters that checks can read with dev-control.sh ui-read.
function showRenderCounts() {
  if (!state().status.developmentMode) return;
  for (const [id, count] of [['dev-render-count', fullRenderCount], ['dev-day-path-draw-count', dayPathDrawCount]]) {
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('output');
      node.id = id;
      node.hidden = true;
      document.body.append(node);
    }
    node.textContent = String(count);
  }
}
function updateDayPathTime(status, previewSeconds) {
  const track = document.querySelector('.path-track');
  if (!track) return;
  const slider = document.getElementById('dev-time-slider');
  if (slider?.dataset.scrubbing === 'true' && previewSeconds === undefined) return;
  const start = Number(track.dataset.start), end = Number(track.dataset.end);
  // The track can run past the planned finish to show later work; the label still names the finish.
  const finish = Math.min(end, Date.parse(status.plan?.end) || end);
  const current = Number(status.currentWallTime) * 1000;
  const shown = previewSeconds === undefined ? current : previewSeconds * 1000;
  const percent = Math.max(0, Math.min(100, (shown - start) / Math.max(1, end - start) * 100));
  track.querySelector('.path-progress').style.width = `${percent}%`;
  track.querySelector('.path-marker').style.left = `${percent}%`;
  track.setAttribute('aria-label', `Day progress: ${Math.round(percent)} percent. ${shown < start ? 'Before start' : shown >= finish ? 'Plan ended' : 'Current time'}.`);
  const label = shown < start ? 'Before start' : shown >= finish ? 'Plan ended' : previewSeconds === undefined ? 'Current time' : 'Simulated time';
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
  const mood = islandMood(status);
  if (islandSlot.dataset.mood !== mood) islandSlot.dataset.mood = mood;
  showIsland(status, mood);
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
// The island's mood: done after End day, break during a break, away during time away or inactivity, otherwise focus.
function islandMood(status) {
  if (status.dayEndedAt) return 'done';
  if (status.phase === 'break' || status.phase === 'rest') return 'break';
  if (status.inferredBreakActive || status.activity?.state === 'inactive') return 'away';
  return 'focus';
}
// Hands the island its game and mood only when the game's saved order, the database, or the mood changes. A new
// publication epoch means another database (a profile switch, or the game demo's Start over), where the same
// saved order can mean a different town.
function showIsland(status, mood) {
  const game = status.game ?? null, database = `${status.profile}:${status.publicationEpoch ?? 0}`;
  const key = `${database}|${game?.change ?? 'none'}|${mood}`;
  if (key === islandShownKey) return;
  islandShownKey = key;
  try { window.focusIslandsGame?.show({ game, mood, profile: database }); } catch (error) { console.error('Sky island could not update:', error); }
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
// The minutes slider and the buttons that use its value. Each button is [label, action], and its id is the action.
// Two or more buttons go on a second row under the slider, so the control fits in the session card.
function snoozeControl(buttons, prefix = 'Snooze', ariaLabel = 'Snooze minutes') {
  const markup = buttons.map(([label, action]) => actionButton(label, action, undefined, false, action)).join('');
  return `<div class="snooze-control${buttons.length > 1 ? ' is-stacked' : ''}"><label for="snooze-minutes">${prefix} <output id="snooze-value">${state().snoozeMinutes || 5}m</output></label><input type="range" id="snooze-minutes" min="5" max="60" step="5" value="${state().snoozeMinutes || 5}" aria-label="${ariaLabel}">${buttons.length > 1 ? `<span class="snooze-buttons">${markup}</span>` : markup}</div>`;
}
// The day-end buttons. "I'm working" shares the slider when the planned finish has passed, and works alone before it.
function dayEndControl(buttons) {
  const s = state().status;
  if (!s.dayFinishPassed) return buttons.map(([label, action]) => actionButton(label, action, undefined, false, action)).join(' ');
  return snoozeControl(buttons, 'For', 'Minutes until the day-end reminder');
}
function todayReflection() {
  const saved = state().status.todayReflection || '';
  const editing = state().todayReflectionDraft !== null || !saved;
  return card(`<div class="card-head">${section('How did today feel?')}${saved && !editing ? actionButton('Edit reflection', 'edit-today-reflection', undefined, false, 'edit-today-reflection') : ''}</div>${editing ? `<p class="muted">Reflection is optional.</p><input class="text-input" id="today-reflection-input" data-day-key="${html(state().status.todayKey)}" aria-label="Today’s reflection" placeholder="Write a reflection…" value="${html(state().todayReflectionDraft ?? saved)}"><div class="actions" style="justify-content:flex-end;margin-top:9px">${saved ? actionButton('Cancel', 'cancel-today-reflection', undefined, false, 'cancel-today-reflection') : ''}${actionButton('Save reflection', 'save-today-reflection', undefined, false, 'save-today-reflection')}</div>` : `<div class="reflection-saved"><span class="green">●</span><div><b>Saved</b><p class="muted">${html(saved)}</p></div></div>`}`);
}
function earlierStart() {
  const s = state().status;
  if (!s.canBackdateStart) return '';
  return `<details class="earlier-start"><summary>I started earlier</summary><label class="field"><span>Actual start time today</span><input type="time" id="actual-start-time" required aria-label="Actual start time today"></label>${actionButton('Start from this time', 'start-earlier', undefined, false, 'start-earlier')}</details>`;
}
function todayActions(g) {
  const s = state().status;
  const working = ["I'm working", 'keep-working'];
  if (g.situation === 'dayEnded') return `<button class="button" data-page="plan" data-plan-tomorrow id="plan-tomorrow">Plan tomorrow</button> ${dayEndControl([working])}`;
  if (g.situation === 'afterDay' || g.situation === 'wrappingUp') {
    const focusing = s.phase === 'focus' && !s.inferredBreakActive;
    return `${actionButton('End day', 'end-day', undefined, true, 'end-day')} ${dayEndControl([['Snooze ending day', 'snooze-end-day'], ...(g.situation === 'wrappingUp' && focusing ? [] : [working])])}`;
  }
  if (s.inferredBreakActive) return actionButton("I'm back · start focus", 'confirm-return', undefined, true, 'end-inferred-break');
  const snooze = snoozeControl([[s.phase === 'idle' ? 'Snooze & focus' : 'Snooze', 'snooze-break']]);
  const longBreak = actionButton('Take long break · 30m', 'start-long-break', undefined, false, 'start-long-break');
  if (g.situation === 'working') return `${actionButton('Take a break', 'start-break', undefined, true, 'start-break')} ${longBreak}`;
  if (s.phase === 'focus') return `${actionButton('Take a break', 'start-break', undefined, true, 'start-break')} ${longBreak} ${s.breakDue ? `${snooze} ${actionButton('Skip', 'skip-break', undefined, false, 'skip-break')}` : ''}`;
  if (s.phase === 'rest' || s.phase === 'break') return actionButton('Finish break', 'finish-break', undefined, true, 'finish-break');
  if (g.situation === 'noPlan') return `${actionButton('Start focus', 'start-focus', undefined, true, 'start-focus')} <button class="button" data-page="plan" id="today-edit-plan">Create a plan</button>`;
  if (g.action?.type === 'editPlan' || g.action === 'editPlan' || g.action === 'edit-plan') return `<button class="button primary" data-page="plan" id="today-edit-plan">Edit plan</button>`;
  if (g.situation === 'rest' || g.action?.type === 'rest' || g.action === 'rest' || g.action === 'break') return `${actionButton('Start break', 'start-break', undefined, true, 'start-break')} ${longBreak} ${snooze}`;
  return actionButton('Start focus', g.action ? 'today-suggestion' : 'start-focus', undefined, true, 'start-focus');
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
// Today's page shell. Live parts are empty placeholders here and are filled in place:
// the countdown, Up next, the day path, the presence badge, the resting look, and the island slot.
function today() {
  const s = state().status, g = guidance();
  const timerVisible = !['afterDay', 'dayEnded'].includes(g.situation) && (s.phase !== 'idle' || g.situation === 'working' || g.situation === 'wrappingUp');
  return `<div class="today-page">
    <section class="today-stage" aria-label="Current session"><div class="today-stage-copy">${!s.dayEndedAt && !['afterDay', 'wrappingUp'].includes(g.situation) ? `<details class="day-options"><summary aria-label="Day options" title="Day options">⋯</summary><div class="day-options-menu">${actionButton('End day early', 'end-day', undefined, false, 'end-day-early')}</div></details>` : ''}<h2 id="today-guidance">${html(g.title)}</h2>${timerVisible ? `<div class="timer"><span id="timer-countdown"></span>${focusPastTarget(s) ? '<small>past focus target</small>' : ''}</div>` : ''}${g.detail ? `<p class="today-detail">${html(g.detail)}</p>` : ''}<div class="today-actions">${todayActions(g)}${earlierStart()}</div>${activityMeter()}</div><div data-island-slot></div><div data-island-overlay></div></section>
    ${s.demo ? '<div data-demo-slot></div>' : ''}<div class="today-live-slot" data-up-next-slot></div>${s.dayEndedAt ? todayReflection() : ''}<div class="today-live-slot" data-day-path-slot></div>${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}</div>`;
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
// Yesterday's recorded time on the shared timeline, from its first hour to the end of its last.
function yesterdayTrack(s) {
  const blocks = s.yesterdayTimeline || [], hour = 3600000;
  const times = blocks.flatMap(block => [date(block.start).getTime(), date(block.end).getTime()]).filter(Number.isFinite);
  const start = times.length ? Math.floor(Math.min(...times) / hour) * hour : 0;
  const end = times.length ? Math.max(start + hour, Math.ceil(Math.max(...times) / hour) * hour) : hour;
  return timelineTrack({ blocks, start, end, now: end, compact: true, marker: false, breakMinutes: s.defaultBreakLength,
    emptyText: 'Nothing recorded yesterday', label: 'Yesterday timeline' });
}
function plan() {
  const s = state().status, view = selectedPlan();
  // Yesterday shows only until you save a reflection for it (here, or on Today's "How did today feel?").
  const reflectionCard = state().planDay === 'today' && !s.savedReflection ? card(`${section('Yesterday')}${yesterdayTrack(s)}<p class="muted">What felt good? What would make breaks easier today?</p><input class="text-input" id="reflection-input" placeholder="Add a reflection…" value="${html(state().reflectionDraft ?? '')}"><div class="actions" style="justify-content:flex-end;margin-top:9px">${actionButton('Save reflection', 'save-reflection', undefined, false, 'save-reflection')}</div>`) : '';
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
// ---- History ("Your rhythm"): today at a glance, what happened on the island, planned and actual bars, recent
// days, and today's timer log. Every number comes from the main process (status, status.game.todaySummary and
// status.recentDays). Times are rounded to the minute, so the markup, and so the page, changes at most once a minute.
let historyShell = null, historyLogOpen = false;
const minutesText = value => { const m = Math.max(0, Math.round(Number(value) || 0)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const withArticle = name => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
const planFitWords = { on: 'On plan', near: 'Near plan', off: 'Own pace' };
const planFitNotes = { on: 'close to what you planned', near: 'a little off the plan', off: 'you went your own way' };
// "[icon] 40" chips, in the resource bar's order, with words for screen readers. With `columns` (resource keys),
// each key gets a fixed slot, left empty when there is none, so rows of chips line up.
function resourceChips(values, emptyText = '', columns = null) {
  const shown = amounts(values);
  if (!shown.length) return emptyText ? `<span class="history-none">${html(emptyText)}</span>` : '';
  const words = amountList(values), own = new Map(shown.map(([key, amount], index) => [key, [amount, words[index]]]));
  const chip = key => { const [amount, word] = own.get(key); return `<span class="history-chip" data-resource="${html(key)}" title="${html(word)}">${resourceIcon(key)}<b>${amount}</b></span>`; };
  const slots = columns ? columns.map(key => own.has(key) ? chip(key) : '<span></span>') : shown.map(([key]) => chip(key));
  return `<span class="history-chips${columns ? ' is-columns' : ''}" role="img" aria-label="${html(words.join(', '))}"${columns ? ` style="grid-template-columns:repeat(${columns.length},var(--chip-slot))"` : ''}>${slots.join('')}</span>`;
}
function historyGlance(s) {
  const summary = s.game?.todaySummary || null;
  const plannedFocus = (s.plannedTimeline || []).filter(block => itemKind(block) === 'focus');
  const plannedMinutes = plannedFocus.reduce((total, block) => total + mins(block.start, block.end), 0);
  const tile = (label, value, note, extra = '') => `<div class="history-stat"${extra}><span>${html(label)}</span><b>${html(value)}</b><small>${html(note)}</small></div>`;
  const realBreaks = summary?.realBreaks ?? null;
  const plannedSessions = summary?.plannedSessions ?? (plannedFocus.length || null);
  let plan;
  if (summary?.planFit) plan = tile('Plan', planFitWords[summary.planFit], planFitNotes[summary.planFit]);
  else if (plannedSessions && summary?.focusSessions) plan = tile('Plan', `${summary.onPlanSessions} of ${plannedSessions}`, 'sessions on plan so far', ' title="A session is on plan when it lasts close to its planned length."');
  else if (plannedSessions) plan = tile('Plan', `${plannedSessions} sessions`, 'planned for today');
  else plan = tile('Plan', 'No plan yet', 'made at your first focus');
  const earned = s.game ? `<div class="history-earned"><span>Island earned today</span>${resourceChips(summary?.earned, 'Nothing yet. Focus makes materials, and breaks grow things.')}</div>` : '';
  return card(`${section('Today at a glance')}<div class="history-stats">${tile('Focus', minutesText(s.focusMinutesToday), plannedMinutes ? `of ${minutesText(plannedMinutes)} planned` : 'so far today')}${tile('Breaks', minutesText(s.breakMinutesToday), realBreaks === null ? 'of real breaks' : `${realBreaks} real break${realBreaks === 1 ? '' : 's'}`)}${plan}</div>${earned}`);
}
// One line for each thing today's check-ins did, with a small tag for its kind.
function historyIsland(s) {
  const game = s.game;
  if (!game) return '';
  const many = (game.islands || []).length > 1;
  const line = (tag, text, detail = '') => `<li><span class="history-tag" data-tag="${html(tag.toLowerCase())}">${html(tag)}</span><span>${html(text)}${detail ? ` <em>${html(detail)}</em>` : ''}</span></li>`;
  const lines = (game.todaySummary?.happenings || []).map(item => {
    if (item.kind === 'built') return line('Built', item.name, item.between ? `between ${item.between.join(' and ')}` : many && item.island ? `on ${item.island}` : '');
    if (item.kind === 'job') return line('Helper', `${item.helper} became ${withArticle(item.job)}`);
    if (item.kind === 'arrived') return line('Helper', `${item.helper} moved in`);
    if (item.kind === 'island') return line('Island', `${item.name} drifted in`, item.label ? `a ${item.label} island` : '');
    if (item.kind === 'surprise') return line('Surprise', item.text);
    if (item.kind === 'grew') return line('Land', `${item.island} grew${item.amount < 10 ? ' a little' : ''}`);
    return '';
  }).filter(Boolean);
  const most = 8;
  const list = lines.length ? `<ul class="history-happenings">${lines.slice(0, most).join('')}</ul>${lines.length > most ? `<p class="small-note">And ${lines.length - most} more.</p>` : ''}`
    : empty('Nothing new yet. New things arrive when you check in after a break.');
  const waiting = game.checkIn ? '<p class="history-waiting">A check-in is waiting on Today. <button class="button link" data-page="today">Open Today →</button></p>' : '';
  return card(`${section('On the island today')}${list}${waiting}`);
}
// The day's plan and what actually happened, as two thin bars on the same hours.
function historyBars(s) {
  const minute = value => Math.round(date(value).getTime() / 60000) * 60000;
  const now = Math.floor(date(s.currentWallTimeISO || s.currentWallTime || Date.now()).getTime() / 60000) * 60000;
  const savedPlan = s.plannedTimeline || [];
  const usual = !savedPlan.length && !s.plan ? s.defaultDayPath?.timeline || [] : [];
  const planned = savedPlan.length ? savedPlan : usual, actual = s.actualTimeline || [];
  let start = minute(s.dayStart || now), end = minute(s.dayEnd || now);
  for (const block of [...planned, ...actual]) { start = Math.min(start, minute(block.start)); end = Math.max(end, minute(block.end)); }
  const hour = 3600000, first = new Date(start); first.setMinutes(0, 0, 0);
  start = first.getTime(); end = Math.max(start + hour, Math.ceil((end - start) / hour) * hour + start);
  const percent = value => timelinePercent(value, start, end).toFixed(2);
  const names = { focus: 'Focus', break: 'Break', meeting: 'Meeting', away: 'Away' };
  const row = (label, blocks, emptyText, muted = false) => `<div class="history-bar-row"><span class="history-bar-label">${html(label)}</span>${timelineTrack({
    blocks, start, end, now, compact: true, breakMinutes: s.plan?.breakMinutes || s.defaultBreakLength,
    marker: !s.dayEndedAt && now > start && now < end, emptyText, muted, label: `${label} timeline`,
  })}</div>`;
  const hours = (end - start) / hour, step = hours > 10 ? 2 : 1, ticks = [];
  for (let at = start; at <= end; at += step * hour) {
    const time = new Date(at);
    ticks.push(`<span style="left:${percent(at)}%">${html(time.toLocaleTimeString([], { hour: 'numeric' }))}</span>`);
  }
  const legend = ['focus', 'break', 'meeting', 'away'].map(kind => `<span><i class="history-key ${kind}"></i>${names[kind]}</span>`).join('');
  return card(`<div class="card-head">${section('Planned and actual')}<div class="history-legend">${legend}</div></div>${row('Planned', planned, 'No plan saved today', Boolean(usual.length))}${row('Actual', actual, 'Nothing recorded yet')}<div class="history-bar-row"><span class="history-bar-label"></span><div class="history-ticks">${ticks.join('')}</div></div>${usual.length ? '<p class="small-note">No plan is saved yet, so Planned shows your usual day.</p>' : ''}`);
}
// The seven days before today, one row each. Worked out by the main process only while History is open, so it
// is missing for a moment after you open the page.
function historyRecent(s) {
  const days = s.recentDays;
  const label = key => { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  let body;
  if (!days) body = '<p class="empty">Looking back over the week…</p>';
  else if (!days.some(day => day.focusMinutes || day.breakMinutes || day.game?.checkIns)) body = empty('Your past week will show here.');
  else {
    const head = '<div class="history-day is-head" aria-hidden="true"><span>Day</span><span>Focus</span><span>Breaks</span><span>Plan</span><span>Island earned</span><span>Built</span></div>';
    // The resources earned on any of these days, so each one keeps its own column.
    const total = {};
    for (const day of days) for (const [key, amount] of Object.entries(day.game?.earned || {})) total[key] = (total[key] || 0) + amount;
    const columns = amounts(total).map(([key]) => key);
    body = head + days.map(day => {
      const game = day.game, quiet = !day.focusMinutes && !day.breakMinutes && !game?.checkIns;
      if (quiet) return `<div class="history-day is-quiet"><span>${html(label(day.dayKey))}</span><span class="history-quiet-note">No sessions</span></div>`;
      const fit = game?.planFit;
      const plan = fit ? `<span class="history-fit" data-fit="${fit}" title="${html(planFitNotes[fit])}">${planFitWords[fit]}</span>` : '<span class="history-none" title="No plan that day">—</span>';
      const counts = new Map();
      for (const item of game?.happenings || []) if (item.kind === 'built') counts.set(item.name, (counts.get(item.name) || 0) + 1);
      const built = [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(', ');
      return `<div class="history-day"><span>${html(label(day.dayKey))}</span><span>${html(minutesText(day.focusMinutes))}</span><span>${html(minutesText(day.breakMinutes))}</span>${plan}<span>${resourceChips(game?.earned, '—', columns)}</span><span class="history-built" title="${html(built)}">${built ? html(built) : '<span class="history-none">—</span>'}</span></div>`;
    }).join('');
  }
  return card(`${section('Recent days')}<div class="history-days">${body}</div>`);
}
function history() {
  const s = state().status, entries = [...(s.history || [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const log = `<details class="history-log" ${historyLogOpen ? 'open' : ''}><summary>Today’s timer log · ${entries.length ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : 'nothing yet'}</summary>${entries.length ? `<p class="history-log-order">Latest first</p><ol tabindex="0" aria-label="Today’s timer events, latest first">${entries.map(entry => `<li><time datetime="${html(entry.date)}">${clock(entry.date)}</time><span>${html(entry.title)}</span></li>`).join('')}</ol>` : empty('Your first focus session will appear here.')}</details>`;
  return `<div class="history-page">${header('Your rhythm', `${shortDate(s.currentWallTimeISO || Date.now())}. Your focus, breaks, and what the island made.`)}<div class="history-top">${historyGlance(s)}${historyIsland(s)}</div>${historyBars(s)}${historyRecent(s)}${log}</div>`;
}
function debugSettings() {
  return card(`${section('Debug')}<label class="check-field"><input type="checkbox" id="show-activity-meter" ${showActivityMeter() ? 'checked' : ''}> Show activity countdown</label><p class="small-note">Show the activity countdown on Today. This only changes the display.</p>`);
}
function settings() {
  const s = state().status;
  return `${header('Settings', 'Default schedule and break settings.')}${card(`${section('Preferences')}<div class="inline-fields"><label class="field"><span>Start</span><select id="settings-start">${startChoices(s.defaultStartTime || '09:00')}</select></label><label class="field"><span>Finish</span><select id="settings-end">${finishChoices(s.defaultEndTime || '17:00')}</select></label><label class="field"><span>Focus · min</span><input type="number" id="settings-focus" min="5" max="120" step="5" value="${s.defaultFocusLength || 60}"></label><label class="field"><span>Break · min</span><input type="number" id="settings-break" min="5" max="60" step="5" value="${s.defaultBreakLength || 10}"></label></div><p class="small-note">Used for new days. Your saved plans keep their times.</p><div class="inline-fields"><label class="field"><span>Activity delay · sec</span><input type="number" id="settings-activity-delay" min="1" max="3600" step="1" value="${s.activityDelaySeconds ?? 120}"></label></div><p class="small-note">Today shows Away from computer after this much idle time.</p><label class="check-field"><input type="checkbox" id="notifications" ${s.notificationsEnabled !== false ? 'checked' : ''}> Visual reminders</label><p class="small-note">Confetti when a break is due, then a clock every five minutes until you respond.</p><div class="settings-save-row">${actionButton('Save settings', 'save-preferences', undefined, true, 'save-settings')}<span id="settings-save-feedback" class="settings-save-feedback ${settingsSaveFeedback?.error ? 'error' : ''}" role="status" aria-live="polite">${html(settingsSaveFeedback?.message || '')}</span></div>`)}${debugSettings()}${card(`${section('Data profile')}<label class="field"><span>Profile</span><select id="data-profile" ${s.canSwitchProfiles === false ? 'disabled' : ''}><option value="personal" ${s.profile === 'personal' ? 'selected' : ''}>Personal</option><option value="testing" ${s.profile === 'testing' ? 'selected' : ''}>Testing</option></select></label><p class="small-note">${s.canSwitchProfiles === false ? 'Development runs are locked to the isolated Testing profile.' : 'Each profile has its own history. Testing never writes to Personal.'}</p>`)}${card(`${section('Your data')}<p class="muted">Your timeline stays in a local SQLite database on this Mac.</p><div class="actions">${actionButton('Export JSON', 'export-json')}${actionButton('Back up database', 'backup-database')}</div>`)}${s.developmentMode ? card(`${section('Development scenarios')}<p class="muted">Exercise the full loop without waiting for real time.</p><div class="actions">${actionButton('Morning setup', 'dev-scenario', 'morning')}${actionButton('Break due', 'dev-scenario', 'breakDue')}${actionButton('Completed day', 'dev-scenario', 'completedDay')}${actionButton('Advance 5 min', 'dev-advance', 5)}${actionButton('Simulate away', 'dev-away')}${actionButton('Simulate return', 'dev-return')}${actionButton('Sleep / wake', 'dev-sleep-wake')}</div>`) : ''}${s.statusMessage ? `<p class="status-message">${html(s.statusMessage)}</p>` : ''}`;
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
  document.getElementById('dialog-root').innerHTML = `<div class="modal-backdrop return-backdrop"><section class="modal return-modal" role="dialog" aria-modal="true" aria-labelledby="return-title" aria-describedby="return-detail"><div class="eyebrow">ACTIVITY DETECTED</div><h2 id="return-title">Are you back from break?</h2><p id="return-detail">${kind} Your Mac is active again. Confirm your return, or keep your break going.</p><div class="return-actions">${actionButton("I'm back · start focus", 'confirm-return', undefined, true, 'confirm-return')}${actionButton("I'm still on break", 'keep-break', undefined, false, 'keep-break')}</div><p class="return-note">After 1 minute of continued activity, focus will start automatically.</p>${prompt.kind === 'inferred' ? '<button class="return-not-break" data-action="not-a-break" id="not-a-break" title="Keep this time as focus. It will not count as a break.">I was working, not on a break</button>' : ''}</section></div>`;
}
function render() {
  state().deferRender(false);
  state().clearDirty();
  navigation();
  const view = { today, plan, history, settings }[state().page] || today;
  const content = document.getElementById('content');
  const scroll = content.scrollTop;
  const markup = view();
  content.classList.toggle('content-today', view === today);
  content.innerHTML = `<div class="page">${markup}</div>`;
  todayShell = view === today ? markup : null;
  historyShell = view === history ? markup : null;
  todayUpNextMarkup = null; todayPathKey = null;
  if (view === today) {
    updateTodayLive(state().status);
    content.querySelector('[data-island-slot]')?.replaceWith(islandSlot);
    content.querySelector('[data-island-overlay]')?.replaceWith(islandOverlay);
    content.querySelector('[data-demo-slot]')?.replaceWith(demoSlot);
  }
  content.scrollTop = scroll;
  updatePresenceDisplay();
  if (state().status.returnPrompt) returnDialog();
  else if (state().meetingEditor) meetingDialog();
  else document.getElementById('dialog-root').innerHTML = '';
  fullRenderCount++;
  showRenderCounts();
}
// History's timer log stays open or closed across redraws. Toggle events don't bubble, so listen as they pass down.
document.addEventListener('toggle', event => { if (event.target.matches?.('.history-log')) historyLogOpen = event.target.open; }, true);
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
    const message = (error.message || String(error)).replace(/^Error invoking remote method 'focus-islands:action': Error: /, '');
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
  const profileMenu = document.querySelector('.profile-menu[open]');
  if (profileMenu && !event.target.closest('.profile-menu')) profileMenu.open = false;
  const planDay = event.target.closest('[data-plan-day]');
  if (planDay) { flushPlanDraft(); state().selectPlanDay(planDay.dataset.planDay); render(); return; }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { if (pageButton.hasAttribute('data-plan-tomorrow')) state().selectPlanDay('tomorrow'); if (profileMenu) profileMenu.open = false; flushPlanDraft(); state().setPage(pageButton.dataset.page); dispatch('navigate', state().page); render(); return; }
  if (event.target.closest('#open-meetings')) { state().setUI({ meetingEditor: true }); meetingDialog(); return; }
  if (event.target.closest('#close-meetings') || (event.target.id === 'modal-backdrop' && !state().status.returnPrompt)) { closeMeetings(); return; }
  if (event.target.closest('#delete-meeting')) { if (state().selectedMeeting) removeMeeting(state().selectedMeeting); state().setUI({ selectedMeeting: null, meetingDraft: '' }); meetingDialog(); return; }
  const checkInButton = event.target.closest('#today-check-in [data-check-in-pick]');
  if (checkInButton) { tapCheckIn(checkInButton); return; }
  const demoButton = event.target.closest('#demo-panel [data-demo-step]');
  if (demoButton) { if (!demoButton.disabled) runDemoStep(demoButton.dataset.demoStep); return; }
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
  if (name === 'save-reflection') { const value = document.getElementById('reflection-input')?.value.trim(); if (value) { state().setUI({ reflectionDraft: null }); state().clearDirty('reflection-input'); state().deferRender(false); dispatch(name, value); } return; }
  if (name === 'save-preferences') { savePreferences(); return; }
  if (name === 'dev-timer-end') {
    const remaining = state().status.timer?.remainingSeconds;
    if (state().status.developmentMode && state().status.phase !== 'idle' && remaining > 0) dispatch('dev-advance', { minutes: (remaining + 1) / 60 });
    return;
  }
  if (name === 'snooze-break' || name === 'snooze-end-day' || name === 'keep-working') { dispatch(name, { minutes: state().snoozeMinutes }); return; }
  if (name === 'start-earlier') {
    const input = document.getElementById('actual-start-time');
    if (!input.reportValidity()) return;
    const s = state().status, started = new Date(s.currentWallTimeISO);
    const [hours, minutes] = input.value.split(':').map(Number);
    started.setHours(hours, minutes, 0, 0);
    input.setCustomValidity(started > new Date(s.currentWallTimeISO) ? 'Choose a time earlier today.' : '');
    if (!input.reportValidity()) { input.setCustomValidity(''); return; }
    dispatch('start-focus', { startedAt: started.toISOString(),
      ...(!s.dayPlans?.[s.todayKey]?.baseline ? { planDraft: state().planDrafts[s.todayKey] } : {}) }).then(result => {
      // Keep the entered time through blur and snapshot updates until the start succeeds.
      if (result?.phase === 'focus') { state().clearDirty('actual-start-time'); state().deferRender(false); render(); }
    });
    return;
  }
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
window.focusIslands.onStatus(snapshot => state().receive(snapshot));
state().refresh();
