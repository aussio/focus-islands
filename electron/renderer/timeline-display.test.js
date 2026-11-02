import test from 'node:test';
import assert from 'node:assert/strict';
import { displayTimeline } from './timeline-display.js';
const at = minutes => new Date(Date.UTC(2026, 10, 2, 9, minutes)).toISOString();
const sequence = (minutes, flags = {}) => [
  { kind: 'focus', start: at(0), end: at(20) },
  { kind: 'break', start: at(20), end: at(20 + minutes), inferred: true, observedSeconds: minutes * 60, ...flags },
  { kind: 'focus', start: at(20 + minutes), end: at(60), active: true },
];
test('short completed time away is visually continuous focus without mutating the input', () => {
  const input = sequence(3), original = structuredClone(input);
  const result = displayTimeline(input, 10);
  assert.equal(result.length, 1);
  assert.equal(result[0].end, at(60));
  assert.equal(result[0].active, true);
  assert.deepEqual(input, original);
});
test('keep qualifying, confirmed, and still-running breaks visible', () => {
  for (const input of [sequence(7.5), sequence(2, { confirmed: true }), sequence(2, { inProgress: true }), sequence(2, { active: true })]) {
    assert.equal(displayTimeline(input, 10).length, 3);
  }
});
test('respect configured break length and never bridge untracked time or meetings', () => {
  assert.equal(displayTimeline(sequence(4), 5).length, 3);
  assert.equal(displayTimeline(sequence(4), 10).length, 1);
  const gap = sequence(2); gap[2].start = at(25);
  assert.equal(displayTimeline(gap).length, 3);
  const meeting = sequence(2); meeting[2].kind = 'meeting';
  assert.equal(displayTimeline(meeting).length, 3);
});

test('preserve scheduled breaks and merge overlapping live focus after a short interruption', () => {
  const planned = sequence(2); delete planned[1].inferred; delete planned[1].observedSeconds;
  assert.equal(displayTimeline(planned).length, 3);
  const live = sequence(2); live.push({ kind: 'focus', start: at(22), end: at(80), active: true });
  const result = displayTimeline(live);
  assert.equal(result.length, 1);
  assert.equal(result[0].end, at(80));
});
