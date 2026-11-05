const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./rules');
const play = require('./play');
const sim = require('./simulate');
const game = require('./index');
const { scan } = require('./history');

const rules = R.DEFAULT_RULES;
const farm = R.DEFAULT_BLUEPRINTS.find(b => b.id === 'farmyard');
const extension = R.DEFAULT_BLUEPRINTS.find(b => b.id === 'farmextension');
function state() {
  const s = play.initialState({ id: 'farm-test', sequence: 1, payload: { startingLand: 120 } }, rules);
  Object.assign(s.onHand, { wood: 1000, stone: 1000, planks: 1000, soil: 1000, saplings: 1000 });
  s.counts.sawmill = 1;
  return s;
}
function addFarm(s) {
  const record = { number: 1, collected: {}, landProgress: 0, built: { id: 'farm-parent', blueprint: farm.id, name: farm.name,
    kind: farm.kind, island: 'home', price: farm.cost, landWhenBuilt: 120 } };
  play.applyRecord(s, record, 2, rules, R.DEFAULT_BLUEPRINTS);
  return record;
}
// Ages the saved farm (built at check-in 1) until its extension may be offered.
function ripen(s, age = rules.extensionAfterCheckIns) { s.checkIns = age; return s; }
function offer(s) { return play.makeOffer(s, rules, [extension], 'farm-test:offer')?.[0]; }
function prepare(s, option) {
  return { work: s, draft: { number: s.checkIns + 1, firsts: [], moments: [], choice: { kind: 'build', options: [
    { blueprint: extension.id, island: option.island, price: option.price, parentBuildingId: option.parentBuildingId },
  ] } } };
}

test('an extension requires a previously saved parent on the selected island', () => {
  const s = state();
  assert.equal(play.available(extension, s, rules, R.DEFAULT_BLUEPRINTS), false);
  assert.equal(offer(s), undefined);
  addFarm(s);
  s.checkIns = 0;
  assert.equal(offer(s), undefined, 'the same check-in cannot offer a new farm and its extension');
  ripen(s);
  const option = offer(s);
  assert.equal(option.parentBuildingId, 'farm-parent');
  const prepared = prepare(s, { ...option, parentBuildingId: 'missing-parent' });
  assert.throws(() => play.pick(prepared, extension.id, { rules, blueprints: R.DEFAULT_BLUEPRINTS }), /eligible building/);
});

test('one extension spends its price without adding ground, pads, jobs or helper beds', () => {
  const s = state(); addFarm(s); ripen(s);
  const island = s.islands[0];
  const before = { room: play.roomOn(island, rules), pads: island.pads, beds: play.beds(s, rules), jobs: play.openJobs(s, R.DEFAULT_BLUEPRINTS), amounts: { ...s.onHand } };
  const prepared = play.pick(prepare(s, offer(s)), extension.id, { rules, blueprints: R.DEFAULT_BLUEPRINTS });
  assert.equal(prepared.draft.built.parentBuildingId, 'farm-parent');
  assert.equal(island.buildings.at(-1).parentBuildingId, 'farm-parent');
  assert.equal(play.roomOn(island, rules), before.room);
  assert.equal(island.pads, before.pads);
  assert.equal(play.beds(s, rules), before.beds);
  assert.deepEqual(play.openJobs(s, R.DEFAULT_BLUEPRINTS), before.jobs);
  for (const [key, amount] of Object.entries(extension.cost)) assert.equal(s.onHand[key], before.amounts[key] - amount);
  assert.equal(offer(s), undefined, 'the parent is expanded only once');
});

test('saved extensions replay their exact parent and old history gains no farm buildings', () => {
  // 60 days: the steady player first builds the Farmyard on day 8 and extends it on day 16 (with the
  // Farmyard charged 13 ground before its gift it was days 32 and 39).
  const result = sim.run('steady', 60);
  const saved = result.events.find(e => e.payload?.built?.blueprint === extension.id);
  assert.ok(saved);
  const built = saved.payload.built;
  const current = game.gameState(result.events);
  const island = current.islands.find(i => i.id === built.island);
  assert.equal(island.buildings.find(b => b.id === built.id).parentBuildingId, built.parentBuildingId);
  assert.equal(island.buildings.find(b => b.id === built.parentBuildingId).blueprint, farm.id);
  const prefix = result.events.slice(0, result.events.findIndex(e => e.payload?.built?.blueprint === farm.id));
  assert.ok(game.gameState(prefix).islands.every(i => i.buildings.every(b => ![farm.id, extension.id].includes(b.blueprint))));
  const tuned = R.DEFAULT_BLUEPRINTS.map(bp => [farm.id, extension.id].includes(bp.id) ? { ...bp, cost: { wood: 9999 } } : bp);
  const folded = play.fold(scan(result.events), rules, tuned);
  assert.equal(folded.islands.find(i => i.id === built.island).buildings.find(b => b.id === built.id).parentBuildingId, built.parentBuildingId);
});

test('the extension waits until its farm is extensionAfterCheckIns old, so the two never come back to back', () => {
  assert.ok(rules.extensionAfterCheckIns > 1);
  const s = state(); addFarm(s);
  // The farm was built at check-in 1; check-in n + 1 is being made when s.checkIns is n.
  ripen(s, rules.extensionAfterCheckIns - 1);
  assert.equal(play.available(extension, s, rules, R.DEFAULT_BLUEPRINTS), false);
  assert.equal(play.placeFor(extension, s, rules), null);
  assert.equal(offer(s), undefined);
  ripen(s);
  assert.equal(offer(s).parentBuildingId, 'farm-parent');
  // A pending card made before the farm was old enough can't be picked with a made-up parent.
  const early = ripen(state(), 0); addFarm(early); ripen(early, 1);
  assert.throws(() => play.pick(prepare(early, { island: 'home', price: extension.cost, parentBuildingId: 'farm-parent' }), extension.id,
    { rules, blueprints: R.DEFAULT_BLUEPRINTS }), /eligible building/);
  // With the old setting the extension came one check-in later, as before.
  const old = { ...rules, extensionAfterCheckIns: 1 }, s1 = state(); addFarm(s1);
  assert.equal(play.makeOffer(s1, old, [extension], 'farm-test:offer')[0].parentBuildingId, 'farm-parent');
});

test('the extension takes no ground, so it is offered even when its island has no room left', () => {
  const s = ripen(state()); addFarm(s); ripen(s);
  const island = s.islands[0];
  island.used += play.roomOn(island, rules) + 3; // room below zero, as bridges can make it
  assert.ok(play.roomOn(island, rules) < 0);
  assert.equal(play.placeFor(extension, s, rules), 0);
  assert.equal(offer(s).island, 'home');
  // Other buildings still wait for room.
  assert.equal(play.placeFor(R.DEFAULT_BLUEPRINTS.find(b => b.id === 'orchard'), s, rules), null);
});

test('building a Farmyard saves a land gift on the record, and the island grows by exactly that', () => {
  assert.equal(farm.landGift, 6);
  assert.ok(!farm.onlyOn && !extension.onlyOn, 'neither is tied to a kind of island');
  const s = state(), island = s.islands[0], before = island.land;
  const option = play.makeOffer(s, rules, [farm], 'farm-test:gift')[0];
  assert.equal(option.landGift, 6);
  const prepared = play.pick({ work: s, draft: { number: 1, firsts: [], moments: [], choice: { kind: 'build', options: [
    { blueprint: farm.id, island: option.island, price: option.price, landGift: option.landGift }] } } }, farm.id, { rules, blueprints: R.DEFAULT_BLUEPRINTS });
  const built = prepared.draft.built;
  assert.equal(built.landGift, 6);
  assert.equal(built.landWhenBuilt, before + 6, 'the farm stands on the grown island');
  assert.equal(island.land, before + 6);
  assert.deepEqual(prepared.draft.moments, ['The first building on the island: a Farmyard.', 'Two hens moved into the Farmyard.']);
  // Replay reads the record, not the blueprint: a later change to the blueprint changes nothing.
  for (const blueprints of [R.DEFAULT_BLUEPRINTS, R.DEFAULT_BLUEPRINTS.map(bp => bp.id === farm.id ? { ...bp, landGift: 40 } : bp)]) {
    const replayed = state();
    play.applyRecord(replayed, { number: 1, collected: {}, landProgress: 0, built }, 2, rules, blueprints);
    assert.equal(replayed.islands[0].land, before + 6);
  }
});

test('the Farmyard is charged for its footprint plus a margin of 1, and fits once its gift is counted', () => {
  assert.equal(farm.ground, 7 + farm.roomMargin, 'the usual charge for a cells footprint, plus its margin');
  assert.equal(farm.roomMargin, 1);
  const s = state(), island = s.islands[0];
  const gift = play.landGiftOn(farm, island, rules);
  const roomAfterGift = () => play.roomOn(island, rules, island.land + gift);
  // Leave room just under the charge before the gift, but enough once the gift is added.
  island.used += Math.floor(play.roomOn(island, rules) - farm.ground) + 2;
  assert.ok(play.roomOn(island, rules) < farm.ground && roomAfterGift() >= farm.ground);
  assert.equal(play.placeFor(farm, s, rules), 0);
  // Without enough room even after the gift, it waits.
  island.used += Math.ceil(roomAfterGift() - farm.ground) + 1;
  assert.equal(play.placeFor(farm, s, rules), null);
});

test('the land gift stops at the island\'s most land, and is left out when there is none to give', () => {
  const s = state(), island = s.islands[0], most = R.maxLandOf(island, rules);
  island.land = most - 2;
  assert.equal(play.makeOffer(s, rules, [farm], 'farm-test:gift')[0].landGift, 2);
  island.land = most;
  assert.equal('landGift' in play.makeOffer(s, rules, [farm], 'farm-test:gift')[0], false);
});

test('an already saved Farmyard without a land gift replays exactly as before', () => {
  const s = state(), before = s.islands[0].land;
  addFarm(s); // the record has no landGift, as saved before the gift existed
  assert.equal(s.islands[0].land, before);
  assert.equal(s.islands[0].buildings[0].landWhenBuilt, 120);
  assert.equal('landGift' in s.islands[0].buildings[0], false);
});

test('the barn says hello once', () => {
  const s = state(); addFarm(s); ripen(s);
  s.firsts.building = 1; // the farm was the first building
  const prepared = play.pick(prepare(s, offer(s)), extension.id, { rules, blueprints: R.DEFAULT_BLUEPRINTS });
  assert.deepEqual(prepared.draft.moments, ['A woolly sheep wandered into the new barn and settled in.']);
  assert.equal(extension.name, 'Barn');
  // "Someone new" means a helper in this game, so the barn's words name an animal instead.
  for (const words of [extension.does, ...prepared.draft.moments]) assert.doesNotMatch(words, /someone/i);
  assert.equal(prepared.draft.built.landGift, undefined, 'only the Farmyard brings land');
});

test('in a long run the Farmyard brings its saved gift, the land adds up, and the barn comes about a week later', () => {
  const result = sim.run('steady', 60);
  const farmRecord = result.log.find(p => p.built?.blueprint === farm.id);
  const barnRecord = result.log.find(p => p.built?.blueprint === extension.id);
  assert.ok(farmRecord && barnRecord);
  assert.ok(farmRecord.built.landGift > 0);
  assert.ok(barnRecord.number - farmRecord.number >= rules.extensionAfterCheckIns);
  assert.ok(barnRecord.day - farmRecord.day >= 3, 'not back to back');
  // Every island's land is its start, the land it grew at check-ins, and the gifts saved with builds.
  const end = game.gameState(result.events);
  const started = result.events.find(e => e.kind === 'gameStarted').payload;
  for (const island of end.islands) {
    const start = island.id === 'home' ? started.startingLand ?? rules.startingLand
      : result.log.flatMap(p => p.islands || []).find(i => i.id === island.id).land;
    const grown = result.log.flatMap(p => p.newLand || []).filter(n => n.island === island.id).reduce((n, g) => n + g.amount, 0);
    const gifts = result.log.filter(p => p.built?.island === island.id).reduce((n, p) => n + (p.built.landGift || 0), 0);
    assert.equal(island.land, start + grown + gifts, island.id);
  }
});

test('a pending card offering the Farmyard covers its land gift', () => {
  const result = sim.run('steady', 60); // the steady player is first offered the Farmyard on day 8
  const at = result.events.findIndex(e => e.kind === 'gameCheckedIn' && e.payload.choice?.options?.some(o => o.blueprint === farm.id));
  assert.ok(at > 0);
  const prefix = result.events.slice(0, at);
  const tuned = R.DEFAULT_BLUEPRINTS.map(bp => bp.id === farm.id ? { ...bp, landGift: 3 } : bp);
  const waiting = game.gameState(prefix), other = game.gameState(prefix, { blueprints: tuned });
  assert.notEqual(waiting.checkIn.token, other.checkIn.token);
  assert.throws(() => game.checkInRecord(prefix, {}, { token: other.checkIn.token }), /card has changed/);
});

test('a history saved under the earlier animal rules replays exactly the same under today\'s rules', () => {
  // The rules and catalogue as they were before the land gift, the extension wait and the new chances.
  const earlierRules = { ...rules, residentChanceInSoilSurprise: 0.35, birdChanceInPlainStonesSurprise: 0.5, extensionAfterCheckIns: 1 };
  const earlierBlueprints = R.DEFAULT_BLUEPRINTS.map(bp => bp.id === farm.id ? { ...bp, landGift: undefined }
    : bp.id === extension.id ? { ...bp, name: 'Barn extension', cost: { wood: 100, stone: 40, planks: 60, soil: 120, saplings: 80 } } : bp);
  const old = sim.run('steady', 60, { rules: earlierRules, blueprints: earlierBlueprints });
  assert.ok(old.log.some(p => p.built?.blueprint === farm.id) && old.log.some(p => p.built?.blueprint === extension.id));
  assert.ok(old.log.every(p => !p.built || !('landGift' in p.built)));
  const bytes = JSON.stringify(old.events);
  const saved = play.fold(scan(old.events), earlierRules, earlierBlueprints);
  const now = play.fold(scan(old.events), rules, R.DEFAULT_BLUEPRINTS);
  const kept = s => ({ onHand: s.onHand, islands: s.islands, links: s.links, residents: s.residents, helpers: s.helpers, wonders: s.wonders, counts: s.counts });
  assert.deepEqual(kept(now), kept(saved));
  assert.equal(JSON.stringify(old.events), bytes);
});
