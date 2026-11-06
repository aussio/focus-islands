import { timelineTrack, timelinePercent } from './timeline-track.js';
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value) : new Date();
const clock = value => date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function dayPath(s, { showEdit = true } = {}) {
  const plan = s.plan || s.defaultDayPath;
  const blocks = s.plan ? s.forecastTimeline || s.plannedTimeline || [] : s.defaultDayPath?.timeline || [];
  const totals = `<div class="path-totals"><span><b>${html(s.workingMinutesToday || 0)}</b> min working</span><span><b>${html(s.breakMinutesToday || 0)}</b> min of real breaks</span></div>`;
  if (!plan) return `<section class="today-path today-path-empty"><div class="path-empty-body"><div><div class="eyebrow">Your day path</div><h2>No schedule available</h2></div></div>${totals}</section>`;
  // Time recorded after the planned finish stretches the path so it shows too.
  const start = date(plan.start).getTime(), planEnd = date(plan.end).getTime();
  const end = Math.max(planEnd, ...(s.plan ? blocks.map(block => date(block.end).getTime()).filter(Number.isFinite) : []));
  const now = date(s.currentWallTimeISO || s.currentWallTime || Date.now()).getTime();
  const percent = value => timelinePercent(value, start, end);
  const position = percent(now);
  const progress = Math.max(0, Math.min(100, position));
  const label = now < start ? 'Before start' : now >= planEnd ? 'Plan ended' : 'Current time';
  const canScrub = s.developmentMode && now < end;
  const sliderValue = Math.min(end, Math.max(start, start + Math.ceil((now - start) / 30000) * 30000));
  const slider = canScrub ? `<input id="dev-time-slider" class="path-time-slider" type="range" min="${start / 1000}" max="${end / 1000}" step="30" value="${sliderValue / 1000}" aria-label="Simulate current time in 30-second steps">` : '';
  const timerEnd = s.phase !== 'idle' && !s.timer?.isDue && !s.suspended
    ? `<button class="button" id="dev-timer-end" data-action="dev-timer-end">To ${s.phase === 'focus' ? 'focus' : 'break'} end</button>` : '';
  const devTools = s.developmentMode ? `<div class="path-time-tools"><span>${canScrub ? `Drag anywhere on the path forward in 30-second steps, up to ${clock(end)}.` : 'The day path has reached its end.'}</span>${timerEnd}</div>` : '';
  return `<section class="today-path" aria-label="Today’s day path"><div class="path-heading"><div><div class="eyebrow">Your day path${s.plan ? '' : ' · default schedule'}</div><h2>${html(clock(plan.start))} <span>to</span> ${html(clock(plan.end))}</h2></div>${showEdit ? '<button class="button link" data-page="plan">Edit plan →</button>' : ''}</div><div class="path-scale"><span>${html(clock(plan.start))}</span><span id="path-current-time">${html(label)} · ${html(clock(now))}</span><span>${html(clock(end))}</span></div>${timelineTrack({ blocks, start, end, now, breakMinutes: plan.breakMinutes || s.defaultBreakLength,
    progress: true, interactive: canScrub, controls: slider,
    label: `Day progress: ${Math.round(progress)} percent. ${label}.` })}${devTools}${totals}</section>`;
}
