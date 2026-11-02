import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineTrack, timelinePercent, timelineDuration } from './timeline-track.js';
const at = minute => new Date(Date.UTC(2026, 10, 2, 9) + minute * 60000).toISOString();
const draw = (blocks, extra = {}) => timelineTrack({ blocks, start: at(0), end: at(60), now: at(30), breakMinutes: 10, ...extra });
test('both sizes share exact positions and tooltips, including sub-minute intervals', () => {
  const blocks = [{ kind: 'break', start: at(.25), end: at(.75), confirmed: true }];
  const today = draw(blocks), history = draw(blocks, { compact: true });
  const segment = markup => markup.match(/<span[^>]*class="timeline-segment[^>]*>/)[0].replace(/path-segment|history-seg/g, 'segment');
  assert.equal(segment(today), segment(history));
  assert.ok(Math.abs(Number(history.match(/width:([\d.]+)%/)[1]) - 100 / 120) < .00001);
});
test('clip segments and markers to the visible range, discard out-of-range segments, escape labels', () => {
  const markup = draw([{ kind: 'focus', start: at(-5), end: at(15), title: '<script>' }, { kind: 'break', start: at(65), end: at(70) }], { label: '<script>' });
  assert.ok(markup.includes('left:0%;width:25%'));
  assert.equal((markup.match(/class="timeline-segment/g) || []).length, 1);
  assert.ok(markup.includes('&lt;script&gt;'));
  assert.equal(timelinePercent(at(80), at(0), at(60)), 100);
});
test('short break smoothing is identical in both views and planned breaks stay visible', () => {
  const blocks = [
    { kind: 'focus', start: at(0), end: at(20) },
    { kind: 'break', start: at(20), end: at(22), inferred: true },
    { kind: 'focus', start: at(22), end: at(60), active: true },
  ];
  for (const compact of [false, true]) assert.equal((draw(blocks, { compact }).match(/class="timeline-segment/g) || []).length, 1);
  delete blocks[1].inferred;
  assert.equal((draw(blocks).match(/class="timeline-segment/g) || []).length, 3);
});
test('empty and interactive tracks remain accessible', () => {
  assert.ok(draw([], { compact: true, emptyText: 'Nothing yet' }).includes('Nothing yet'));
  const markup = draw([], { interactive: true, controls: '<input id="test-control">', marker: false });
  assert.ok(markup.includes('role="group"'));
  assert.ok(markup.includes('data-time-scrub="true"'));
  assert.ok(markup.includes('test-control'));
  assert.ok(!markup.includes('class="timeline-marker'));
});

test('duration is precise and running focus reports elapsed time rather than forecast length', () => {
  assert.equal(timelineDuration(30000), '30 sec');
  assert.equal(timelineDuration(150000), '2 min 30 sec');
  assert.equal(timelineDuration(5400000), '1 hr 30 min');
  const markup = draw([{ kind: 'focus', start: at(0), end: at(60), active: true }]);
  assert.ok(markup.includes('30 min so far'));
  assert.ok(!markup.includes('60 min'));
  assert.ok(!markup.includes('Focus'));
  assert.ok(markup.includes('tabindex="0"'));
});
