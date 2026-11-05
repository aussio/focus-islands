import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTown, checkTown, compareTowns, forgetTowns } from './index.js';

const base = JSON.parse(readFileSync(new URL('../../../../development-tools/game-gallery/states/town/steady-day-30.json', import.meta.url)));
function fixture() {
  const game = structuredClone(base), home = game.islands[0];
  home.land = Math.max(140, home.land);
  const number = Math.max(...home.buildings.map(b => b.checkIn || 0)) + 1;
  home.buildings.push({ id: 'farm-test', blueprint: 'farmyard', checkIn: number, landWhenBuilt: home.land });
  return game;
}

test('farm extension preserves the complete reserved parcel and all old buildings', () => {
  const game = fixture(), before = buildTown(game), home = game.islands[0];
  const farm = before.things.find(t => t.id === 'farm-test');
  assert.ok(farm);
  assert.equal(farm.points.length, 6);
  assert.equal(before.islands[0].borrowed, 0);
  home.buildings.push({ id: 'extension-test', blueprint: 'farmextension', parentBuildingId: farm.id, checkIn: home.buildings.at(-1).checkIn + 1, landWhenBuilt: home.land });
  const after = buildTown(game), extended = after.things.find(t => t.id === farm.id);
  assert.deepEqual(checkTown(after), []);
  assert.deepEqual(compareTowns(before, after), []);
  assert.equal(extended.extension, 'extension-test');
  assert.deepEqual({ ...extended, extension: undefined }, { ...farm, extension: undefined });
  assert.equal(after.things.length, before.things.length);
  assert.deepEqual(after.islands, before.islands);
  forgetTowns();
  assert.deepEqual(buildTown(game), after, 'fresh replay retains parent identity and footprint');
});

test('an extension cannot expand another kind or a missing parent', () => {
  const game = fixture(), home = game.islands[0], before = buildTown(game);
  home.buildings.push({ id: 'bad-extension', blueprint: 'farmextension', parentBuildingId: 'missing', checkIn: 999, landWhenBuilt: home.land });
  assert.deepEqual(buildTown(game).things, before.things);
});
