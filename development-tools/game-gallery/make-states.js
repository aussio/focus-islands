#!/usr/bin/env node
// Writes made-up game states for the gallery and for layout work:
//
//   node development-tools/game-gallery/make-states.js [person]
//
// Plays a made-up person (default: steady) through the real game rules and saves the game state at
// the end of days 1, 7, 30, 90, and 180 to development-tools/game-gallery/states/day-<n>.json.
// Each file holds exactly what gameState() returns, the same shape the app shows. It reads no app data.
const fs = require('node:fs');
const path = require('node:path');
const { simulate } = require('../../electron/core/game/simulate');
const { PEOPLE } = require('../../electron/core/game/made-up-days');

const DAYS = [1, 7, 30, 90, 180];
const person = process.argv[2] || 'steady';
if (!PEOPLE.some(p => p.id === person)) {
  console.error(`Unknown person "${person}". Try one of: ${PEOPLE.map(p => p.id).join(', ')}.`);
  process.exit(1);
}

const dir = path.join(__dirname, 'states');
fs.mkdirSync(dir, { recursive: true });
const states = simulate(person, DAYS);
for (const day of DAYS) {
  const state = states[day];
  const file = path.join(dir, `day-${day}.json`);
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  const buildings = state.islands.reduce((n, island) => n + island.buildings.length, 0);
  console.log(`${path.relative(process.cwd(), file)}: ${state.islands.length} islands, ${buildings} buildings, ` +
    `${state.links.length} bridges, ${state.helpers.length} helpers, ${state.wonders.length} wonders`);
}
