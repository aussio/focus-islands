import { qualifyingRestSeconds } from '../core/rest.js';

// Chart-only smoothing. Never feed these spans into timers, totals, or saved facts.
export function displayTimeline(blocks, breakMinutes = 10) {
  const ordered = blocks.map(block => ({ ...block })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const threshold = qualifyingRestSeconds(breakMinutes);
  const touches = (a, b) => Math.abs(Date.parse(a.end) - Date.parse(b.start)) <= 1000;
  const result = [];
  for (let i = 0; i < ordered.length; i++) {
    const block = ordered[i], previous = result.at(-1), next = ordered[i + 1];
    const seconds = block.observedSeconds ?? (Date.parse(block.end) - Date.parse(block.start)) / 1000;
    const recorded = block.actual || block.inferred || Number.isFinite(block.observedSeconds);
    const shortBreak = recorded && block.kind === 'break' && !block.confirmed && !block.active && !block.inProgress && seconds < threshold;
    if (shortBreak && previous?.kind === 'focus' && next?.kind === 'focus' && touches(previous, block) && touches(block, next)) {
      previous.end = block.end;
      previous.smoothed = true;
      continue;
    }
    if (previous?.kind === 'focus' && block.kind === 'focus' && previous.smoothed && Date.parse(block.start) <= Date.parse(previous.end) + 1000) {
      previous.end = new Date(Math.max(Date.parse(previous.end), Date.parse(block.end))).toISOString();
      previous.active ||= block.active;
      previous.inProgress ||= block.inProgress;
      continue;
    }
    result.push(block);
  }
  return result;
}
