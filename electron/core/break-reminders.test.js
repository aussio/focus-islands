const test = require('node:test');
const assert = require('node:assert/strict');
const { createBreakReminder } = require('../break-reminders');

const at = minute => Date.parse('2026-10-27T15:00:00Z') / 1000 + minute * 60;
const focusDue = (minute = 0) => ({
  phase: 'focus', breakDue: true, todaySituation: 'runningFocus', timer: { sessionID: 'focus-1' },
  todayKey: '2026-10-27', currentWallTime: at(minute), currentWallTimeISO: new Date(at(minute) * 1000).toISOString(),
  reminderSequence: 1, notificationsEnabled: true, activity: { state: 'active' },
});
const plannedDue = (minute = 0) => ({
  ...focusDue(minute), phase: 'idle', breakDue: false, todaySituation: 'rest',
  todayGuidance: { action: { type: 'rest' } },
});

test('running focus sends one due reminder and repeats for timer nudges', () => {
  const reminder = createBreakReminder();
  const first = reminder.next(focusDue());
  assert.equal(first.kind, 'timer');
  assert.equal(reminder.next(focusDue(1)), null);
  assert.equal(reminder.next({ ...focusDue(2), reminderSequence: 2 }).kind, 'timer');
  assert.equal(reminder.next({ ...focusDue(3), reminderSequence: 2 }), null);
  assert.equal(reminder.next({ ...focusDue(3), todaySituation: 'working' }), null);
  assert.equal(reminder.isCurrent(first.key, { ...focusDue(3), todaySituation: 'working' }), false);
  assert.equal(reminder.next({ ...focusDue(4), reminderSequence: 2 }).kind, 'timer');
});

test('planned break prompts only when there is an actionable break suggestion', () => {
  const reminder = createBreakReminder();
  assert.equal(reminder.next({ ...plannedDue(), todayGuidance: { action: null } }), null);
  const first = reminder.next(plannedDue());
  assert.equal(first.kind, 'planned');
  assert.equal(reminder.next(plannedDue(4)), null);
  assert.equal(reminder.next(plannedDue(5)).kind, 'planned');
  assert.equal(reminder.next({ ...plannedDue(6), todaySituation: 'focus' }), null);
  const next = reminder.next(plannedDue(7));
  assert.equal(next.kind, 'planned');
  assert.notEqual(next.key, first.key);
  assert.equal(reminder.isCurrent(first.key, plannedDue(7)), false);
});

test('inactive, suspended, and disabled states defer a due reminder until usable', () => {
  const reminder = createBreakReminder();
  assert.equal(reminder.next({ ...focusDue(), activity: { state: 'inactive' } }), null);
  assert.equal(reminder.next({ ...focusDue(1), suspended: true }), null);
  assert.equal(reminder.next({ ...focusDue(2), notificationsEnabled: false }), null);
  assert.equal(reminder.next(focusDue(3)).kind, 'timer');
  assert.equal(reminder.next({ ...focusDue(4), inferredBreakActive: true }), null);
  assert.equal(reminder.next({ ...focusDue(5), inferredBreakActive: true }), null);
  assert.equal(reminder.next(focusDue(6)).kind, 'timer');
});

test('dismissed and old session actions cannot control a later break', () => {
  const reminder = createBreakReminder();
  const first = reminder.next(focusDue());
  assert.equal(reminder.isCurrent(first.key, focusDue()), true);
  assert.equal(reminder.next({ ...focusDue(1), phase: 'break', breakDue: false }), null);
  assert.equal(reminder.isCurrent(first.key, focusDue(2)), false);
  const second = reminder.next({ ...focusDue(3), timer: { sessionID: 'focus-2' } });
  assert.notEqual(second.key, first.key);
  assert.equal(reminder.isCurrent(first.key, { ...focusDue(3), timer: { sessionID: 'focus-2' } }), false);
});


test('end day replaces break reminders, invalidates old actions, and respects snooze and completion', () => {
  const reminder = createBreakReminder();
  const first = reminder.next(focusDue());
  const ending = minute => ({ ...focusDue(minute), todaySituation: 'afterDay', dayEnding: true });
  assert.equal(reminder.next(ending(1)).kind, 'endDay');
  assert.equal(reminder.isCurrent(first.key, ending(1)), false);
  assert.equal(reminder.next(ending(2)), null);
  assert.equal(reminder.next(ending(6)).kind, 'endDay');
  assert.equal(reminder.next({ ...ending(7), todaySituation: 'wrappingUp' }), null);
  assert.equal(reminder.next(ending(8)).kind, 'endDay');
  assert.equal(reminder.next({ ...ending(9), dayEndedAt: '2026-10-27T17:00:00Z' }), null);
});
