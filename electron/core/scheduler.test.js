const test = require('node:test');
const assert = require('node:assert/strict');
const { schedule, focusTarget, actionsAt } = require('./scheduler');
const at = (hour, minute = 0, second = 0) => new Date(2026, 10, 9, hour, minute, second).toISOString();
const spans = blocks => blocks.map(({ kind, start, end }) => ({ kind, start, end }));
const makePlan = extra => ({ day: at(0), start: at(9), end: at(14), focusMinutes: 70, breakMinutes: 10,
  meetings: [{ title: 'Planning', start: at(11, 30), end: at(12) }], ...extra });

test('saved plan and an unstarted live day use the same schedule', () => {
  for (const [focusMinutes, breakMinutes] of [[25, 5], [60, 10], [70, 10]]) {
    const plan = makePlan({ focusMinutes, breakMinutes });
    const original = structuredClone(plan);
    assert.deepEqual(spans(schedule(plan, { now: plan.start })), spans(schedule(plan)));
    assert.deepEqual(plan, original);
  }
});

test('timer targets, live forecast, and suggested actions agree at the meeting boundary', () => {
  const plan = makePlan();
  const start = at(10, 52, 47);
  const targetSeconds = focusTarget({ plan, start, targetSeconds: 4200 });
  assert.equal(targetSeconds, 4033);
  const blocks = schedule(plan, { now: start, timer: { phase: 'focus', startedAt: start, targetSeconds, elapsedSeconds: 0 } });
  const rest = blocks.find(block => block.start === at(12));
  assert.deepEqual(spans([rest]), [{ kind: 'break', start: at(12), end: at(12, 10) }]);
  assert.deepEqual(actionsAt(plan, blocks, at(12)).rest, { type: 'rest', until: at(12, 10) });
  assert.equal(actionsAt(plan, blocks, at(11, 59)).rest, null);
});

test('saved plans and live continuations reject short gaps on either side of meetings', () => {
  const plan = makePlan({ meetings: [
    { title: 'First', start: at(9, 5), end: at(10) },
    { title: 'Second', start: at(10, 5), end: at(10, 30) },
  ] });
  const actual = [{ kind: 'focus', start: at(9), end: at(9, 2), observedSeconds: 120 }];
  for (const blocks of [schedule(plan), schedule(plan, { now: at(9, 2), actual })]) {
    const future = blocks.filter(block => !block.actual);
    assert.ok(future.filter(block => block.kind === 'focus').every(block => Date.parse(block.end) - Date.parse(block.start) >= 35 * 60000));
    assert.equal(future.find(block => block.start === at(10)).kind, 'break');
    assert.equal(actionsAt(plan, blocks, at(10)).focus, null);
  }
  assert.deepEqual(spans(schedule(plan, { now: at(9, 2), actual }).filter(block => block.actual)), spans(actual));
});

test('a full break waits through meetings using the same constraints as immediate actions', () => {
  const plan = makePlan({ meetings: [
    { title: 'First', start: at(10), end: at(10, 30) },
    { title: 'Second', start: at(10, 35), end: at(11) },
  ] });
  const blocks = schedule(plan, { now: at(9, 55), timer: {
    phase: 'focus', startedAt: at(9), targetSeconds: 3300, elapsedSeconds: 3300, isDue: true,
  } });
  assert.deepEqual(spans(blocks.filter(block => block.forecast && block.kind === 'break').slice(0, 1)),
    [{ kind: 'break', start: at(11), end: at(11, 10) }]);
  assert.equal(actionsAt(plan, blocks, at(9, 55)).rest, null);
  assert.equal(actionsAt(plan, blocks, at(10, 30)).rest, null);
  assert.deepEqual(actionsAt(plan, blocks, at(11)).rest, { type: 'rest', until: at(11, 10) });
});

test('explicit edits remain intent while generated short focus recommendations are rejected', () => {
  const plan = makePlan({ start: at(9), end: at(10), meetings: [], customBlocks: [
    { kind: 'focus', start: at(9), end: at(9, 5) },
    { kind: 'break', start: at(9, 5), end: at(10) },
  ] });
  assert.deepEqual(schedule(plan), plan.customBlocks);
  assert.deepEqual(actionsAt(plan, schedule(plan), at(9)).focus, { type: 'focus', until: at(9, 5) });
  assert.equal(actionsAt({ ...plan, customBlocks: null }, plan.customBlocks, at(9)).focus, null);
});

test('the service owns open-break and ended-day forecast suppression', () => {
  const plan = makePlan();
  const actual = [{ kind: 'break', start: at(9), end: at(9, 20), inProgress: true, observedSeconds: 1200 }];
  for (const inferred of [false, true]) {
    const blocks = schedule(plan, { now: at(9, 20), actual: [{ ...actual[0], inferred }], timer: {
      phase: inferred ? 'focus' : 'break', startedAt: at(9), targetSeconds: 600, elapsedSeconds: 1200, isDue: true, isSleeping: inferred,
    } });
    assert.equal(blocks.some(block => block.forecast && block.kind !== 'meeting'), false);
    assert.equal(blocks.filter(block => block.kind === 'break').length, 1);
  }
  const ended = schedule(plan, { now: at(9, 20), actual, ended: true });
  assert.deepEqual(spans(ended), spans(actual));
});
