const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityDetector, INACTIVE_AFTER_SECONDS } = require('../activity');

test('presence follows system input idle time without storing input details', () => {
  const detector = createActivityDetector();
  assert.equal(INACTIVE_AFTER_SECONDS, 5);
  assert.equal(detector.status().state, 'unknown');
  assert.equal(detector.observe(0).state, 'active');
  assert.equal(detector.observe(INACTIVE_AFTER_SECONDS - 1).state, 'active');
  assert.equal(detector.observe(INACTIVE_AFTER_SECONDS).state, 'inactive');
  assert.equal(detector.observe(1).state, 'active');
  assert.deepEqual(Object.keys(detector.status()), ['state', 'idleSeconds', 'inactiveAfterSeconds']);
});

test('lock and sleep override input idle time until availability returns', () => {
  const detector = createActivityDetector();
  detector.observe(0);
  assert.equal(detector.setUnavailable(true).state, 'inactive');
  assert.equal(detector.observe(0).state, 'inactive');
  assert.equal(detector.setUnavailable(false).state, 'unknown');
  assert.equal(detector.observe(0).state, 'active');
  assert.equal(detector.observe(NaN).state, 'unknown');
});
