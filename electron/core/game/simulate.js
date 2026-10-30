'use strict';
// Plays a made-up person's days through the real rules: the same dueGrants, gameState, and
// checkInRecord the app uses, with a chooser that taps every check-in as soon as it's ready.
// Used by the long-run pacing test and by development-tools/game-gallery/make-states.js.

const game = require('./index');
const R = require('./rules');
const { scan } = require('./history');
const play = require('./play');
const sky = require('./sky');
const MadeUpDays = require('./made-up-days');

// The simulated player: a wonder first. Then homes if a helper is waiting for a bed. Then a rope bridge
// if some island isn't joined to home yet. Then the homes option on every third build choice that
// offers one (homesOffers counts them, this one included), standing in for a player who likes the
// town. Otherwise something new before something repeated.
// For a job it takes the first option, which the rules already rank the way the prototype's job picker did.
function simulatedPlayer(state, { blueprints, helpersWaiting, homesOffers = 0 }) {
  const choice = state.checkIn && state.checkIn.choice;
  if (!choice) return null;
  if (choice.kind === 'job') return choice.options[0].job;
  const owned = {};
  for (const island of state.islands) for (const b of island.buildings) owned[b.blueprint] = (owned[b.blueprint] || 0) + 1;
  owned.bridge = state.links.filter(link => !String(link.id).startsWith('gift-')).length;
  const wonder = choice.options.find(o => o.kind === 'wonder');
  if (wonder) return wonder.blueprint;
  const homes = choice.options.find(o => o.kind === 'homes');
  if (homes && helpersWaiting) return homes.blueprint;
  const bridge = choice.options.find(o => blueprints.find(bp => bp.id === o.blueprint).linkType);
  if (bridge && sky.joinedSet(state.islands, state.links).size < state.islands.length) return bridge.blueprint;
  if (homes && homesOffers > 0 && homesOffers % 3 === 0) return homes.blueprint;
  const again = id => (blueprints.find(bp => bp.id === id).again ? 1 : 0);
  return choice.options.map((o, i) => ({ o, i }))
    .sort((a, b) => (again(a.o.blueprint) - again(b.o.blueprint)) || ((owned[a.o.blueprint] || 0) - (owned[b.o.blueprint] || 0)) || (a.i - b.i))[0].o.blueprint;
}

function helpersWaitingFor(events, rules, blueprints) {
  const facts = scan(events);
  return facts ? play.fold(facts, rules, blueprints).queue.length : 0;
}

// Runs one person for `dayCount` days. Options:
// - snapshots: day numbers whose end-of-day game state to keep
// - rules, blueprints: other numbers to try (defaults to the real ones)
// - chooser(state, info) => pick; defaults to the simulated player
// - fillers: add the app's 30-second progress records, for speed checks
// Returns { states: { [day]: gameState }, timeline: [per-day stats], events, log: [check-in records] }.
function run(personId, dayCount, options = {}) {
  const seed = options.seed ?? MadeUpDays.SEED;
  const rules = options.rules || R.DEFAULT_RULES, blueprints = options.blueprints || R.DEFAULT_BLUEPRINTS;
  const chooser = options.chooser || simulatedPlayer;
  const keep = new Set(options.snapshots || []);
  const history = MadeUpDays.createHistory();
  const plans = new Map();
  const states = {}, timeline = [], log = [];
  let homesOffers = 0;
  let todayKey = MadeUpDays.dayKeyFor(1), now = `${todayKey}T07:00:00.000Z`;
  const ctx = () => ({ now, todayKey, dayKeyOf: MadeUpDays.dayKeyOf, planFor: key => plans.get(key) || null, rules, blueprints });
  history.appendRecord(game.startRecord(ctx()));

  let today = null;
  function settle(mayCheckIn) {
    for (const grant of game.dueGrants(history.events, ctx())) history.appendRecord(grant);
    if (!mayCheckIn) return;
    const state = game.gameState(history.events, ctx());
    if (!state.checkIn) return;
    const choice = state.checkIn.choice;
    if (choice && choice.kind === 'build' && choice.options.some(o => o.kind === 'homes')) homesOffers += 1;
    const pick = chooser(state, { blueprints, rules, helpersWaiting: helpersWaitingFor(history.events, rules, blueprints), homesOffers });
    const record = game.checkInRecord(history.events, ctx(), { token: state.checkIn.token, pick });
    history.appendRecord(record);
    log.push({ day: today.day, ...record.payload });
    today.checkIns += 1;
    if (record.payload.choice) today.choices += 1;
    if (record.payload.surprise) today.surprises += 1;
  }

  for (let d = 1; d <= dayCount; d++) {
    const madeUp = MadeUpDays.make(personId, d, seed);
    todayKey = MadeUpDays.dayKeyFor(d);
    now = `${todayKey}T07:00:00.000Z`;
    plans.set(todayKey, MadeUpDays.planFor(madeUp));
    today = { day: d, checkIns: 0, choices: 0, surprises: 0 };
    settle(true); // a new day: yesterday's day grant may be due
    for (const batch of MadeUpDays.batchesForDay(madeUp, { fillers: options.fillers })) {
      for (const [kind, payload, at] of batch.events) { history.append(kind, payload, at); now = at; }
      settle(batch.kind !== 'focus'); // never a check-in at the moment focus ends
    }
    const state = game.gameState(history.events, ctx());
    if (keep.has(d)) states[d] = state;
    timeline.push({ day: d, label: madeUp.label, activeDays: state.activeDays, islands: state.islands.length,
      helpers: state.helpers.length, buildings: state.islands.reduce((n, i) => n + i.buildings.length, 0) + state.links.length,
      wonders: state.wonders.length, checkInsToday: today.checkIns, choicesToday: today.choices, surprisesToday: today.surprises,
      onHand: state.onHand, land: state.islands.map(island => island.land), links: state.links.length });
  }
  return { states, timeline, events: history.events, log };
}

// Game states for a made-up person at chosen days, for galleries and layouts: { [day]: gameState }.
function simulate(personId, days, options = {}) {
  const list = Array.isArray(days) ? days : [days];
  return run(personId, Math.max(...list), { ...options, snapshots: list }).states;
}

// Milestones in the same terms as the prototype's comparison table.
function milestones(result) {
  const t = result.timeline;
  const sum = (key, from, to) => t.filter(s => s.day >= from && s.day <= to).reduce((n, s) => n + s[key], 0);
  const islandDays = [], wonderDays = [];
  for (let i = 0; i < t.length; i++) {
    const before = i ? t[i - 1] : { islands: 1, wonders: 0 };
    for (let k = before.islands; k < t[i].islands; k++) islandDays.push({ day: t[i].day, activeDay: t[i].activeDays });
    for (let k = before.wonders; k < t[i].wonders; k++) wonderDays.push({ day: t[i].day, activeDay: t[i].activeDays });
  }
  const end = t[t.length - 1];
  return {
    dayOneChoices: t[0].choicesToday, dayOneCheckIns: t[0].checkInsToday, islandDays, wonderDays,
    choicesPerWeekMonth3: t.length >= 90 ? Math.round(sum('choicesToday', 61, 90) / (30 / 7) * 10) / 10 : null,
    surprisesPerWeek: Math.round(sum('surprisesToday', 1, t.length) / (t.length / 7) * 10) / 10,
    helpers: end.helpers, buildings: end.buildings, islands: end.islands,
  };
}

module.exports = { simulate, run, milestones, simulatedPlayer };
