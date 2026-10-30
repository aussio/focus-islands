'use strict';
// The sky-island game rules. Pure functions over the saved events: they never read the clock,
// never use Math.random, and never touch the database. The core writes what they return.
//
// ctx: { now: ISO string (only used as occurredAt for new records), todayKey: 'YYYY-MM-DD',
//        dayKeyOf(iso) => local 'YYYY-MM-DD', planFor(dayKey) => { focusSessions, focusMinutes, breakMinutes } | null }
// Tests may also pass ctx.rules and ctx.blueprints to try other numbers.

const R = require('./rules');
const { scan } = require('./history');
const play = require('./play');
const { computeDueGrants } = require('./grants');

function localDayKey(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function environment(ctx = {}) {
  return { rules: ctx.rules || R.DEFAULT_RULES, blueprints: ctx.blueprints || R.DEFAULT_BLUEPRINTS,
    dayKeyOf: ctx.dayKeyOf || localDayKey, now: ctx.now };
}

// The record that turns the game on. The starting land and pouch are saved in it, so a later rules
// change can't rewrite how the game began.
function startRecord(ctx = {}) {
  const rules = environment(ctx).rules;
  return { kind: 'gameStarted', uniqueKey: 'game:started', occurredAt: ctx.now,
    payload: { rulesVersion: rules.rulesVersion, startingLand: rules.startingSpots,
      startingSoil: rules.startingSoil, startingSaplings: rules.startingSaplings } };
}

// The gameGranted records that should exist but don't yet, in the order to write them.
// Never returns a record whose unique key already exists.
function dueGrants(events, ctx = {}) {
  const facts = scan(events);
  if (!facts) return [];
  const env = environment(ctx);
  return computeDueGrants(facts, play.fold(facts, env.rules), ctx, env);
}

// The game state for the page, or null before the game has started.
function gameState(events, ctx = {}) {
  const facts = scan(events);
  if (!facts) return null;
  const env = environment(ctx);
  const state = play.fold(facts, env.rules);
  const prepared = play.prepare(state, facts, env);
  const plan = ctx.planFor && ctx.todayKey ? ctx.planFor(ctx.todayKey) : null;
  env.typical = { focusMinutes: (plan && plan.focusMinutes) || 60, breakMinutes: (plan && plan.breakMinutes) || 10 };
  return play.viewState(state, facts, prepared, env);
}

// The gameCheckedIn record for one tap on the check-in card. pick: a blueprint id, a job id, or
// null to collect without choosing. Throws an Error with a short message if the tap doesn't fit.
function checkInRecord(events, ctx = {}, { token, pick = null } = {}) {
  const facts = scan(events);
  if (!facts) throw new Error("The island hasn't started yet.");
  const env = environment(ctx);
  const prepared = play.prepare(play.fold(facts, env.rules), facts, env);
  if (!prepared) throw new Error('There is nothing to collect right now.');
  if (token !== prepared.draft.token) throw new Error('This card has changed. Please look at it again.');
  play.pick(prepared, pick, env);
  const payload = prepared.draft;
  payload.covered = facts.lastSequence;
  return { kind: 'gameCheckedIn', uniqueKey: `game:checkin:${payload.number}`, occurredAt: ctx.now, payload };
}

const GAME_KINDS = Object.freeze(['gameStarted', 'gameGranted', 'gameCheckedIn']);

module.exports = {
  startRecord, dueGrants, gameState, checkInRecord, GAME_KINDS,
  DEFAULT_RULES: R.DEFAULT_RULES, DEFAULT_BLUEPRINTS: R.DEFAULT_BLUEPRINTS, JOBS: R.JOBS, KIND_NAMES: R.KIND_NAMES,
  ISLAND_KINDS: R.ISLAND_KINDS, RESOURCES: R.RESOURCES,
  isRealBreak: R.isRealBreak, restValue: R.restValue, focusOnPlan: R.focusOnPlan, dayPlanMatch: R.dayPlanMatch,
  priceOf: R.priceOf, islandDueAt: R.islandDueAt, helperDueAt: R.helperDueAt,
};
