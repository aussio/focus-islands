const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value) : new Date();
const clock = value => date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const itemKind = item => String(item.kind ?? '').toLowerCase();

export function dayPath(s, { showEdit = true } = {}) {
  const plan = s.plan || s.defaultDayPath;
  const blocks = s.plan ? s.forecastTimeline || s.plannedTimeline || [] : s.defaultDayPath?.timeline || [];
  const totals = `<div class="path-totals"><span><b>${html(s.workingMinutesToday || 0)}</b> min working</span><span><b>${html(s.breakMinutesToday || 0)}</b> min of real breaks</span></div>`;
  if (!plan) return `<section class="today-path today-path-empty"><div class="path-empty-body"><div><div class="eyebrow">Your day path</div><h2>No schedule available</h2></div></div>${totals}</section>`;
  const start = date(plan.start).getTime(), end = date(plan.end).getTime();
  const span = Math.max(1, end - start);
  const now = date(s.currentWallTimeISO || s.currentWallTime || Date.now()).getTime();
  const percent = time => Math.max(0, Math.min(100, (time - start) / span * 100));
  const position = percent(now);
  const progress = Math.max(0, Math.min(100, position));
  const label = now < start ? 'Before start' : now >= end ? 'Plan ended' : 'Current time';
  const segments = blocks.map(item => {
    const from = Math.max(start, date(item.start).getTime());
    const until = Math.min(end, date(item.end).getTime());
    if (until <= from) return '';
    const kind = itemKind(item);
    const name = item.title || (kind === 'focus' ? 'Focus' : kind === 'break' ? 'Break' : kind === 'meeting' ? 'Meeting' : 'Away');
    return `<span class="path-segment ${html(kind)} ${item.actual ? 'is-actual' : ''} ${item.active ? 'is-active' : ''}" style="left:${percent(from)}%;width:${percent(until) - percent(from)}%" title="${html(`${name} · ${clock(item.start)}–${clock(item.end)}`)}"></span>`;
  }).join('');
  const canScrub = s.developmentMode && now < end;
  const sliderValue = Math.min(end, Math.max(start, start + Math.ceil((now - start) / 30000) * 30000));
  const slider = canScrub ? `<input id="dev-time-slider" class="path-time-slider" type="range" min="${start / 1000}" max="${end / 1000}" step="30" value="${sliderValue / 1000}" aria-label="Simulate current time in 30-second steps">` : '';
  const timerEnd = s.phase !== 'idle' && !s.timer?.isDue && !s.suspended
    ? `<button class="button" id="dev-timer-end" data-action="dev-timer-end">To ${s.phase === 'focus' ? 'focus' : 'break'} end</button>` : '';
  const devTools = s.developmentMode ? `<div class="path-time-tools"><span>${canScrub ? `Drag anywhere on the path forward in 30-second steps, up to ${clock(end)}.` : 'The day path has reached its end.'}</span>${timerEnd}</div>` : '';
  return `<section class="today-path" aria-label="Today’s day path"><div class="path-heading"><div><div class="eyebrow">Your day path${s.plan ? '' : ' · default schedule'}</div><h2>${html(clock(plan.start))} <span>to</span> ${html(clock(plan.end))}</h2></div>${showEdit ? '<button class="button link" data-page="plan">Edit plan →</button>' : ''}</div><div class="path-scale"><span>${html(clock(plan.start))}</span><span id="path-current-time">${html(label)} · ${html(clock(now))}</span><span>${html(clock(plan.end))}</span></div><div class="path-track" role="${canScrub ? 'group' : 'img'}" aria-label="${html(`Day progress: ${Math.round(progress)} percent. ${label}.`)}" data-start="${start}" data-end="${end}" ${canScrub ? 'data-time-scrub="true"' : ''}><span class="path-progress" title="Elapsed time without recorded activity is untracked" style="width:${progress}%"></span>${segments}<span class="path-marker" style="left:${position}%"></span>${slider}</div>${devTools}${totals}</section>`;
}
