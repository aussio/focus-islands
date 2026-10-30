'use strict';
// Surprise flavours, visitors and keepsakes (rules.js SURPRISE_FLAVOURS and KEEPSAKES, play.js makeSurprise).
// The old dice must stay as they were: the same slots for the same keys, the same gifts, the same
// 180 days. The numbers below were saved before flavours existed.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./rules');
const play = require('./play');
const game = require('./index');
const sim = require('./simulate');
const { scan } = require('./history');
const { pickWeighted, fingerprint } = require('./dice');

const rules = R.DEFAULT_RULES;
const round2 = v => Math.round(v * 100) / 100;

// Saved before the change: the slot roll for 3000 keys, and steady's 180 days.
const SLOTS = { print: '1cwn0fhekf1qp', counts: { stones: 601, fireflies: 403, seeds: 789, soil: 604, lost: 216, bridge: 205, golden: 182 } };
const STEADY_180 = {
  checkIns: 697, surprises: 64,
  ids: { soil: 18, stones: 11, fireflies: 8, golden: 3, lost: 3, seeds: 19, bridge: 2 },
  gifts: { soil: 1650, stone: 165, saplings: 940 },
  collected: { wood: 17343.41, stone: 12648.3, planks: 8112.44, soil: 19210.24, saplings: 12276.81, starlight: 1014 },
  onHand: { wood: 168.41, stone: 519.3, planks: 40.44, soil: 1390.24, saplings: 447.81, starlight: 184 },
  buildings: 133, land: [522, 339, 218, 192, 86],
  list: '12qu9wy1b6qihq', // [day, number, slot, island, gifts] of every surprise
};

const STEADY = sim.run('steady', 180);

test('the slot roll gives the same slots for the same keys', () => {
  const slots = [];
  for (let i = 1; i <= 3000; i++) slots.push(pickWeighted(`person-${i % 7}:checkin:${i}:surprise-kind`, R.SURPRISES, s => s.weight).id);
  const counts = {};
  for (const s of slots) counts[s] = (counts[s] || 0) + 1;
  assert.deepEqual(counts, SLOTS.counts);
  assert.equal(fingerprint(slots.join(',')), SLOTS.print);
});

test("steady's 180 days collect, gift and build exactly what they did before flavours", () => {
  const { log, timeline } = STEADY;
  const surprises = log.filter(p => p.surprise);
  const sum = list => {
    const total = {};
    for (const amounts of list) for (const [k, v] of Object.entries(amounts || {})) total[k] = round2((total[k] || 0) + v);
    return total;
  };
  const ids = {};
  for (const p of surprises) ids[p.surprise.id] = (ids[p.surprise.id] || 0) + 1;
  const end = timeline.at(-1);
  assert.deepEqual({
    checkIns: log.length, surprises: surprises.length, ids,
    gifts: sum(surprises.map(p => p.surprise.gifts)), collected: sum(log.map(p => p.collected)),
    onHand: Object.fromEntries(Object.entries(end.onHand).map(([k, v]) => [k, round2(v)])), buildings: end.buildings, land: end.land,
    list: fingerprint(JSON.stringify(surprises.map(p => [p.day, p.number, p.surprise.id, p.surprise.island, p.surprise.gifts]))),
  }, STEADY_180);
  // And the new kinds do turn up.
  assert.ok(surprises.some(p => p.surprise.visitor), 'a visitor');
  assert.ok(surprises.some(p => p.surprise.keepsake), 'a keepsake');
});

const islandOf = (fields = {}) => ({ id: 'isle-1', name: 'Mossy Rise', golden: false, keepsakes: [], land: 200, used: 0, ...fields });
// A fresh surprise in slot `id`, dressed with check-in key `key`.
const dressed = (id, key, island = islandOf(), options = { number: 9 }) => play.dressSurprise(
  { id, text: 'old words', gifts: play.slotGifts(id, rules), island: island.id }, island, rules, key, options);

test('every flavour gives its slot\'s gift, in plain water words', () => {
  for (const [slot, flavours] of Object.entries(R.SURPRISE_FLAVOURS)) {
    const seen = new Set();
    for (let k = 0; k < 4000 && seen.size < flavours.length; k++) {
      const surprise = dressed(slot, `force:checkin:${k}`);
      seen.add(surprise.flavour);
      assert.deepEqual(surprise.gifts, play.slotGifts(slot, rules), `${slot} ${surprise.flavour}`);
      const flavour = flavours.find(f => f.id === surprise.flavour);
      assert.equal(surprise.visitor, flavour.visitor, `${slot} ${surprise.flavour}'s visitor`);
      if (flavour.text) assert.equal(surprise.text, flavour.text.replace('{island}', 'Mossy Rise'));
      else if (surprise.flavour !== 'keepsake') assert.equal(surprise.text, 'old words', `${slot} ${surprise.flavour} keeps the slot's words`);
      assert.doesNotMatch(surprise.text, /\{island\}/);
      if (surprise.text !== 'old words') assert.doesNotMatch(surprise.text, /seed|sapling/i);
    }
    assert.deepEqual([...seen].sort(), flavours.map(f => f.id).sort(), `${slot}: every flavour comes up`);
  }
  // The slots without flavours are left as they are.
  for (const slot of ['golden', 'bridge']) assert.equal(dressed(slot, 'force:checkin:1').flavour, undefined);
  // Every keepsake's card says what it is and ends the same way, in water words.
  for (const kind of R.KEEPSAKES) {
    assert.doesNotMatch(kind.text, /seed|sapling/i);
    assert.ok(kind.text.includes('{island}'), `${kind.id} names its island`);
  }
  assert.doesNotMatch(R.KEEPSAKE_ENDING, /seed|sapling/i);
});

test('keepsakes: water gift, no repeat kinds on one island, at most the cap, a fountain only with room', () => {
  const kinds = new Set();
  for (let k = 0; k < 3000; k++) {
    const surprise = dressed('seeds', `keep:checkin:${k}`, islandOf(), { keepsake: true, number: k });
    assert.equal(surprise.flavour, 'keepsake');
    assert.deepEqual(surprise.gifts, play.slotGifts('seeds', rules));
    assert.equal(surprise.keepsake.id, `keepsake-${k}`);
    assert.ok(surprise.text.endsWith(` ${R.KEEPSAKE_ENDING}`));
    assert.equal(surprise.keepsake.ground ?? 0, R.KEEPSAKES.find(x => x.id === surprise.keepsake.kind).ground ?? 0);
    kinds.add(surprise.keepsake.kind);
  }
  assert.deepEqual([...kinds].sort(), R.KEEPSAKES.map(k => k.id).sort(), 'every kind comes up');
  const has = (...list) => islandOf({ keepsakes: list.map((kind, i) => ({ id: `keepsake-${i}`, kind })) });
  for (let k = 0; k < 500; k++) {
    const two = dressed('seeds', `keep:checkin:${k}`, has('fountain', 'well'), { keepsake: true, number: 1 });
    assert.ok(!['fountain', 'well'].includes(two.keepsake.kind), 'no repeat kind');
    // At the cap, the roll's keepsake turns plain and a forced one turns into the other flavours.
    const full = dressed('seeds', `keep:checkin:${k}`, has('bench', 'well', 'lamp'));
    assert.equal(full.keepsake, undefined);
    assert.notEqual(full.flavour, 'keepsake');
    assert.equal(dressed('seeds', `keep:checkin:${k}`, has('bench', 'well', 'lamp'), { keepsake: true }).keepsake, undefined);
    // Without a point of room (land 40: about 9.9 room before used), no fountain.
    const cramped = dressed('seeds', `keep:checkin:${k}`, islandOf({ land: 40, used: 9.5 }), { keepsake: true, number: 1 });
    assert.notEqual(cramped.keepsake.kind, 'fountain');
  }
});

test('the golden slot leaves a keepsake once its island has the golden tree', () => {
  let key = null;
  for (let k = 0; key === null; k++) if (pickWeighted(`gold:checkin:${k}:surprise-kind`, R.SURPRISES, s => s.weight).id === 'golden') key = `gold:checkin:${k}`;
  const make = golden => play.makeSurprise({ islands: [islandOf({ golden })], lostHelpers: 0, links: [] },
    { activeDays: 30, helpersQueued: [], number: 12 }, rules, key);
  const fresh = make(false);
  assert.equal(fresh.id, 'golden');
  assert.equal(fresh.golden, true);
  assert.equal(fresh.flavour, undefined);
  const again = make(true);
  assert.equal(again.id, 'seeds', 'the slot is the old fallback');
  assert.equal(again.flavour, 'keepsake');
  assert.equal(again.keepsake.id, 'keepsake-12');
  assert.deepEqual(again.gifts, play.slotGifts('seeds', rules));
  assert.equal(again.golden, undefined);
});

const STRIPPED = ['flavour', 'visitor', 'keepsake'];
const strip = events => events.map(e => (e.kind === 'gameCheckedIn' && e.payload.surprise
  ? { ...e, payload: { ...e.payload, surprise: Object.fromEntries(Object.entries(e.payload.surprise).filter(([k]) => !STRIPPED.includes(k))) } }
  : e));

test('records without the new fields replay as before, and keepsakes replay from the record', () => {
  const full = play.fold(scan(STEADY.events), rules);
  const old = play.fold(scan(strip(STEADY.events)), rules);
  const kept = STEADY.log.filter(p => p.surprise?.keepsake);
  assert.ok(kept.length > 0);
  for (const island of old.islands) assert.deepEqual(island.keepsakes, []);
  // Apart from the keepsakes (and the room a fountain takes), the two states are the same.
  const without = state => JSON.stringify({ ...state, last: null, islands: state.islands.map(({ keepsakes, used, ...rest }) => rest) });
  assert.equal(without(old), without(full));
  for (const island of full.islands) {
    const ground = island.keepsakes.reduce((n, k) => n + (R.KEEPSAKES.find(x => x.id === k.kind).ground ?? 0), 0);
    assert.equal(island.used, old.islands.find(i => i.id === island.id).used + ground, island.id);
    const kinds = island.keepsakes.map(k => k.kind);
    assert.equal(new Set(kinds).size, kinds.length, `${island.id}: no repeat kinds`);
    assert.ok(kinds.length <= rules.maxKeepsakesPerIsland);
  }
  const text = list => list.map(item => item.join(' ')).sort();
  assert.deepEqual(text(full.islands.flatMap(i => i.keepsakes.map(k => [k.id, k.kind, i.id, k.checkIn]))),
    text(kept.map(p => [p.surprise.keepsake.id, p.surprise.keepsake.kind, p.surprise.island, p.number])));
});

test('a visitor stays from its check-in until the next one', () => {
  const { events } = STEADY;
  const checkIns = events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'gameCheckedIn');
  const at = checkIns.findIndex(({ e }, n) => e.payload.surprise?.visitor && !checkIns[n + 1]?.e.payload.surprise?.visitor && checkIns[n + 1]);
  assert.ok(at >= 0, 'a visitor check-in with a plain one after it');
  const { e: visit, i } = checkIns[at];
  const before = game.gameState(events.slice(0, i), {});
  const during = game.gameState(events.slice(0, i + 1), {});
  const after = game.gameState(events.slice(0, checkIns[at + 1].i + 1), {});
  assert.deepEqual(during.visitor, { kind: visit.payload.surprise.visitor, island: visit.payload.surprise.island });
  assert.notDeepEqual(before.visitor, during.visitor);
  assert.equal(after.visitor, null);
});
