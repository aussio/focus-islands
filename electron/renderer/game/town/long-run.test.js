// The layout on the real rules for 180 made-up days (game/BUILD_PLAN.md, "What gets tested":
// long-run.test.js). Every day for the steady planner, every 7th day and day 180 for everyone else.
// For each snapshot: an empty checkTown. For each pair of neighbouring snapshots: an empty compareTowns.
// And the layout should never need to borrow land.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildTown, checkTown, compareTowns } from './index.js';

const require = createRequire(import.meta.url);
const sim = require('../../../core/game/simulate.js');
const { PEOPLE } = require('../../../core/game/made-up-days.js');

const DAYS = 180;
const daysFor = person => (person === 'steady'
  ? Array.from({ length: DAYS }, (_, i) => i + 1)
  : [...Array.from({ length: Math.floor(DAYS / 7) }, (_, i) => 7 * (i + 1)), DAYS]);

// Every person's snapshots, built once: [{ person, day, world }].
const runs = (PEOPLE ?? []).map(person => {
  const days = daysFor(person.id);
  const { states } = sim.run(person.id, DAYS, { snapshots: days });
  return { person: person.id, snapshots: days.map(day => ({ day, world: buildTown(states[day]) })) };
});

test('every snapshot passes checkTown, and neighbouring snapshots keep every promise', () => {
  assert.ok(runs.length >= 5, 'the made-up people');
  for (const { person, snapshots } of runs) {
    snapshots.forEach(({ day, world }, i) => {
      assert.deepEqual(checkTown(world), [], `${person}, day ${day}`);
      if (i) assert.deepEqual(compareTowns(snapshots[i - 1].world, world), [], `${person}, day ${snapshots[i - 1].day} to ${day}`);
    });
  }
});

// Borrowed land means the rules let a building in that the layout couldn't fit. The layout and the
// rules' room sum are tuned together (BUILD_PLAN.md, "To retune together").
test('the layout never borrows land', () => {
  const borrowed = runs.flatMap(({ person, snapshots }) => snapshots.at(-1).world.islands.filter(i => i.borrowed).map(i => `${person} ${i.id} ${i.borrowed}`));
  assert.deepEqual(borrowed, []);
});
