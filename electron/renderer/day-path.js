const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value) : new Date();
const clock = value => date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const itemKind = item => String(item.kind ?? '').toLowerCase();

export function dayPath(s, { showEdit = true } = {}) {
  const plan = s.plan;
  const blocks = s.forecastTimeline || s.plannedTimeline || [];
  if (!plan) return `<section class="today-path today-path-empty"><div><div class="eyebrow">Your day path</div><h2>A fresh path starts here.</h2><p>Your focus and breaks will appear as your day unfolds.</p></div><div class="empty-path-track" aria-hidden="true"><span>✦</span></div></section>`;
  const start = date(plan.start).getTime(), end = date(plan.end).getTime();
  const span = Math.max(1, end - start);
  const now = date(s.currentWallTimeISO || s.currentWallTime || Date.now()).getTime();
  const percent = time => Math.max(0, Math.min(100, (time - start) / span * 100));
  const position = percent(now);
  const progress = Math.max(0, Math.min(100, position));
  const label = now < start ? 'Before your day' : now >= end ? 'Day complete' : 'You are here';
  const segments = blocks.map(item => {
    const from = Math.max(start, date(item.start).getTime());
    const until = Math.min(end, date(item.end).getTime());
    if (until <= from) return '';
    const kind = itemKind(item);
    const name = item.title || (kind === 'focus' ? 'Focus' : kind === 'break' ? 'Break' : kind === 'meeting' ? 'Meeting' : 'Away');
    return `<span class="path-segment ${html(kind)} ${item.actual ? 'is-actual' : ''} ${item.active ? 'is-active' : ''}" style="left:${percent(from)}%;width:${percent(until) - percent(from)}%" title="${html(`${name} · ${clock(item.start)}–${clock(item.end)}`)}"></span>`;
  }).join('');
  const upcoming = blocks.find(item => date(item.end).getTime() > now && !item.actual);
  const upcomingKind = itemKind(upcoming || {});
  const upcomingName = upcoming?.title || ({ focus: 'Focus', break: 'Break', meeting: 'Meeting', away: 'Away' }[upcomingKind] || 'Time');
  const upcomingText = upcoming ? `${upcomingName} ${clock(upcoming.start)}–${clock(upcoming.end)}` : 'The rest of today is yours.';
  const upcomingLabel = upcoming && date(upcoming.start).getTime() <= now ? 'Now' : 'Coming up';
  return `<section class="today-path" aria-label="Today’s day path"><div class="path-heading"><div><div class="eyebrow">Your day path</div><h2>${html(clock(plan.start))} <span>to</span> ${html(clock(plan.end))}</h2></div>${showEdit ? '<button class="button link" data-page="plan">Edit plan →</button>' : ''}</div><div class="path-scale"><span>${html(clock(plan.start))}</span><span>${html(label)} · ${html(clock(now))}</span><span>${html(clock(plan.end))}</span></div><div class="path-track" role="img" aria-label="${html(`Day progress: ${Math.round(progress)} percent. ${label}.`)}"><span class="path-progress" title="Elapsed time without recorded activity is untracked" style="width:${progress}%"></span>${segments}<span class="path-marker" style="left:${position}%"></span></div><div class="path-footer"><div class="path-legend"><span><i class="legend-focus"></i>Focus</span><span><i class="legend-break"></i>Break</span><span><i class="legend-meeting"></i>Meeting</span><span><i class="legend-untracked"></i>Untracked</span></div><p><strong>${html(upcomingLabel)}</strong> ${html(upcomingText)}</p></div></section>`;
}
