const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('./index');
const play = require('./play');
const R = require('./rules');
const { scan } = require('./history');
const { pickWeighted } = require('./dice');
const sim = require('./simulate');

const rules = R.DEFAULT_RULES;
const withoutAnimals = { ...rules, maxResidents: 0, birdChanceInPlainStonesSurprise: 0 };
const work = () => play.initialState({ id: 'resident-test', sequence: 1, payload: { rulesVersion: 2 } }, rules);
const draft = () => ({ activeDays: 10, number: 12, helpersQueued: [] });
const keyFor = slot => {
  for (let k = 0; k < 10000; k++) {
    const key = `resident:checkin:${k}`;
    if (pickWeighted(`${key}:surprise-kind`, R.SURPRISES, x => x.weight).id === slot) return key;
  }
  throw new Error('No matching surprise key');
};

test('residents arrive as an existing gift flavor, only after active-day eligibility and below the cap', () => {
  const key = keyFor('soil'), state = work();
  const sure = { ...rules, residentChanceInSoilSurprise: 1 };
  const old = play.makeSurprise(state, draft(), withoutAnimals, key);
  const arrival = play.makeSurprise(state, draft(), sure, key);
  assert.deepEqual([arrival.id, arrival.island, arrival.gifts], [old.id, old.island, old.gifts]);
  assert.deepEqual(arrival, play.makeSurprise(state, draft(), sure, key));
  assert.equal(arrival.resident.kind, 'cat');
  assert.equal(arrival.resident.island, 'home');
  assert.equal(arrival.resident.arrivedAtCheckIn, 12);
  assert.equal(arrival.visitor, undefined, 'no second creature moment');
  assert.equal(arrival.keepsake, undefined);
  assert.deepEqual(state.residents, [], 'preparing the offer never mutates saved state');
  assert.equal(play.makeSurprise(state, { ...draft(), activeDays: rules.residentAfterActiveDays - 1 }, sure, key).resident, undefined);
  state.residents.push(arrival.resident);
  assert.equal(play.makeSurprise(state, draft(), sure, key).resident, undefined);
});

test('bird flavor leaves gifts and existing special presentations intact', () => {
  const sure = { ...rules, birdChanceInPlainStonesSurprise: 1 };
  let plain, decorated;
  for (let k = 0; k < 10000 && (!plain || !decorated); k++) {
    const key = `bird:checkin:${k}`;
    const original = play.makeSurprise(work(), draft(), withoutAnimals, key);
    if (original.id !== 'stones') continue;
    const next = play.makeSurprise(work(), draft(), sure, key);
    assert.deepEqual(next.gifts, original.gifts);
    assert.equal(next.island, original.island);
    if (original.flavour === 'plain') {
      plain = key;
      assert.equal(next.visitor, 'bird');
      assert.equal(next.resident, undefined);
    } else {
      decorated = key;
      assert.deepEqual(next, original, 'already dressed stones keep their presentation');
    }
  }
  assert.ok(plain && decorated);
  assert.equal(play.makeSurprise(work(), { ...draft(), activeDays: 0 }, sure, plain).visitor, undefined);
});

const baseline = sim.run('steady', 180, { rules: withoutAnimals });
const current = sim.run('steady', 180);

test('six months keep exactly the same gifts, choices, land and resource balances', () => {
  assert.deepEqual(current.timeline, baseline.timeline);
  const economy = log => log.map(p => ({ number: p.number, collected: p.collected, newLand: p.newLand,
    surprise: p.surprise && [p.surprise.id, p.surprise.island, p.surprise.gifts], choice: p.choice, built: p.built, job: p.job }));
  assert.deepEqual(economy(current.log), economy(baseline.log));
  assert.equal(current.log.filter(p => p.surprise?.resident).length, 1);
  assert.ok(current.log.some(p => p.surprise?.visitor === 'bird'));
});

test('old history gains no residents, and saved arrivals persist independently of future tuning', () => {
  const oldBytes = JSON.stringify(baseline.events);
  assert.deepEqual(game.gameState(baseline.events).residents, []);
  const resident = current.log.find(p => p.surprise?.resident).surprise.resident;
  const folded = play.fold(scan(current.events), withoutAnimals);
  assert.deepEqual(folded.residents, [resident]);
  const state = game.gameState(current.events, { rules: withoutAnimals });
  assert.deepEqual(state.residents, [resident]);
  state.residents[0].kind = 'changed-outside';
  assert.deepEqual(game.gameState(current.events).residents, [resident], 'view is detached from the ledger');
  assert.equal(JSON.stringify(baseline.events), oldBytes);
});

test('arrival changes a pending token, is saved once, and survives subsequent plain check-ins', () => {
  const at = current.events.findIndex(e => e.payload?.surprise?.resident);
  assert.ok(at > 0);
  const prefix = current.events.slice(0, at), resident = current.events[at].payload.surprise.resident;
  const original = game.gameState(prefix, { rules: withoutAnimals }).checkIn;
  const waiting = game.gameState(prefix).checkIn;
  assert.ok(original && waiting);
  assert.notEqual(original.token, waiting.token);
  assert.deepEqual(game.gameState(prefix).residents, [], 'arrival waits for collection');
  assert.throws(() => game.checkInRecord(prefix, {}, { token: original.token }), /card has changed/);
  const record = game.checkInRecord(prefix, {}, { token: waiting.token });
  const saved = [...prefix, { ...record, id: 'saved-resident', sequence: prefix.at(-1).sequence + 1 }];
  assert.deepEqual(game.gameState(saved).residents, [resident]);
  assert.throws(() => game.checkInRecord(saved, {}, { token: waiting.token }), /nothing to collect|card has changed/);
  assert.deepEqual(game.gameState(current.events).residents, [resident]);
});

test('bird visitors end at the next check-in, while the resident stays', () => {
  const at = current.events.findIndex(e => e.payload?.surprise?.visitor === 'bird');
  const next = current.events.findIndex((e, i) => i > at && e.kind === 'gameCheckedIn');
  assert.ok(at > 0 && next > at);
  const visit = game.gameState(current.events.slice(0, at + 1));
  assert.equal(visit.visitor.kind, 'bird');
  const after = game.gameState(current.events.slice(0, next + 1));
  assert.notEqual(after.visitor?.kind, 'bird');
  assert.deepEqual(after.residents, visit.residents);
});

test('the cat comes with the first soil surprise once the player is settled in, and every plain stones surprise after that is a bird', () => {
  assert.equal(rules.residentChanceInSoilSurprise, 1);
  assert.equal(rules.birdChanceInPlainStonesSurprise, 1);
  const soil = current.log.filter(p => p.surprise?.id === 'soil' && p.activeDays >= rules.residentAfterActiveDays);
  assert.ok(soil[0].surprise.resident, 'the first eligible soil surprise brings the cat');
  assert.ok(soil.slice(1).every(p => !p.surprise.resident), 'only one cat');
  const plainBefore = baseline.log.filter(p => p.surprise?.id === 'stones' && p.surprise.flavour === 'plain');
  for (const p of plainBefore) {
    const now = current.log.find(q => q.number === p.number).surprise;
    if (p.activeDays >= rules.birdAfterActiveDays) assert.equal(now.visitor, 'bird', `check-in ${p.number}`);
    else assert.deepEqual(now, p.surprise, `check-in ${p.number} is too early for a bird`);
  }
});

test('the cat and bird lines name their island, and the plain stones words stay as they were', () => {
  const home = work().islands[0];
  const cat = play.makeSurprise(work(), draft(), rules, keyFor('soil'));
  assert.equal(cat.text, `A cat padded in with muddy paws and curled up on ${home.name}. It seems to have decided to stay. Its paws left a little rich soil behind.`);
  const birdWords = R.ANIMAL_FLAVOURS.stones.texts.map(text => text.replace('{island}', home.name));
  const seen = new Set();
  for (let k = 0; k < 10000 && seen.size < birdWords.length; k++) {
    const key = `bird-words:checkin:${k}`;
    const plain = play.makeSurprise(work(), draft(), withoutAnimals, key);
    if (plain.id !== 'stones' || plain.flavour !== 'plain') continue;
    assert.equal(plain.text, 'A magpie dropped a little pile of shiny stones by the big rock.');
    const bird = play.makeSurprise(work(), draft(), rules, key);
    assert.ok(birdWords.includes(bird.text), bird.text);
    assert.deepEqual({ ...bird, text: null, flavour: null, visitor: null }, { ...plain, text: null, flavour: null, visitor: null }, 'only the words and the visitor change');
    seen.add(bird.text);
  }
  assert.equal(seen.size, birdWords.length, 'every bird line comes up');
  // The bird may perch on a roof, so no line promises a tree.
  for (const text of birdWords) assert.doesNotMatch(text, /tree/i);
});
