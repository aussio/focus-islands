import { displayTimeline } from './timeline-display.js';

const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = value => new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value).getTime();
const clock = value => new Date(time(value)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function timelineDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  if (minutes < 60) return `${minutes} min${remainder ? ` ${remainder} sec` : ''}`;
  return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

// Click/tap also reveals the tooltip; native keyboard focus works without a pointer.
export function connectTimelineInteractions(root = document) {
  root.addEventListener('click', event => {
    const segment = event.target.closest?.('.timeline-segment');
    root.querySelectorAll('.timeline-segment.is-inspected').forEach(node => node.classList.remove('is-inspected'));
    if (segment) { segment.classList.add('is-inspected'); segment.focus({ preventScroll: true }); }
    else if (root.activeElement?.matches('.timeline-segment')) root.activeElement.blur();
  });
  root.addEventListener('pointerover', event => {
    const segment = event.target.closest?.('.timeline-segment');
    if (segment) root.querySelectorAll('.timeline-segment.is-inspected').forEach(node => {
      if (node !== segment) { node.classList.remove('is-inspected'); node.blur(); }
    });
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    root.querySelectorAll('.timeline-segment.is-inspected').forEach(node => node.classList.remove('is-inspected'));
    if (root.activeElement?.matches('.timeline-segment')) root.activeElement.blur();
  });
}
export function timelinePercent(value, start, end) {
  return Math.max(0, Math.min(100, (time(value) - time(start)) / Math.max(1, time(end) - time(start)) * 100));
}

// Shared drawing only. Callers choose their data/range and supply surrounding labels and controls.
export function timelineTrack({ blocks, start, end, now, breakMinutes, compact = false, marker = true,
  progress = false, interactive = false, controls = '', emptyText = '', muted = false, label = 'Timeline' }) {
  const percent = value => timelinePercent(value, start, end);
  const position = percent(now);
  const trackClass = compact ? 'history-track' : 'path-track';
  const segmentClass = compact ? 'history-seg' : 'path-segment';
  const segments = displayTimeline(blocks, breakMinutes).map(block => {
    const from = Math.max(time(start), time(block.start)), until = Math.min(time(end), time(block.end));
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return '';
    const kind = String(block.kind || 'away').toLowerCase();
    const recorded = block.actual || block.inferred || Number.isFinite(block.observedSeconds);
    const light = recorded && kind === 'break' && !block.confirmed && !block.inferred && !block.inProgress && !block.active;
    const running = block.active || block.inProgress;
    const lastedUntil = running ? Math.max(from, Math.min(until, time(now))) : until;
    const duration = timelineDuration(lastedUntil - from) + (running ? ' so far' : '');
    const range = `${clock(from)}–${clock(running ? lastedUntil : until)}`;
    const note = light ? 'Not counted as a real break' : block.smoothed ? 'Includes short interruptions' : '';
    const midpoint = (percent(from) + percent(until)) / 2;
    const edge = midpoint < 15 ? 'start' : midpoint > 85 ? 'end' : 'middle';
    return `<span tabindex="0" aria-label="${html(`${duration}, ${range}${note ? `, ${note}` : ''}`)}" data-tooltip-edge="${edge}" class="timeline-segment ${segmentClass} ${html(kind)}${block.actual ? ' is-actual' : ''}${block.active ? ' is-active' : ''}${light ? ' is-light' : ''}" style="left:${percent(from)}%;width:${percent(until) - percent(from)}%"><span class="timeline-tooltip" aria-hidden="true"><strong>${html(duration)}</strong><small>${html(range)}</small>${note ? `<small>${html(note)}</small>` : ''}</span></span>`;
  }).join('');
  const background = progress ? `<span class="path-progress" title="Elapsed time without recorded activity is untracked" style="width:${position}%"></span>` : '';
  const cursor = marker ? `<span class="timeline-marker ${compact ? 'history-now' : 'path-marker'}" style="left:${position}%" title="Now · ${html(clock(now))}"></span>` : '';
  return `<div class="timeline-track ${trackClass}${compact ? ' is-compact' : ''}${muted ? ' is-usual' : ''}" role="group" aria-label="${html(label)}" data-start="${time(start)}" data-end="${time(end)}"${interactive ? ' data-time-scrub="true"' : ''}>${background}${segments || (emptyText ? `<span class="history-track-empty">${html(emptyText)}</span>` : '')}${cursor}${controls}</div>`;
}
