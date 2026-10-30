#!/usr/bin/env node
// Writes made-up game states for the gallery and for layout work, from the real game rules:
//
//   node development-tools/game-gallery/make-states.js            the town states (below)
//   node development-tools/game-gallery/make-states.js --square [person]
//                                                                  the old square states (states/day-<n>.json)
//   --commit <ref>   use the rules as committed at <ref> (say HEAD) instead of the working tree, for when
//                    the rules are half-way through a change. Reads git only; changes nothing.
//
// Town states go to development-tools/game-gallery/states/town/<person>-day-<n>.json: the steady planner
// at the end of days 1, 7, 21, 30, 40, 60, 90, 130 and 180, and day 180 for every other made-up person.
// build.js lays them out with buildTown and hands them to the page as data.town.states.
// Each file holds exactly what gameState() returns, the same shape the app shows. It reads no app data.
// Run it again whenever the rules change; it replaces the whole states/town/ folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const commitAt = args.indexOf('--commit');
const commit = commitAt >= 0 ? args.splice(commitAt, 2)[1] : null;

// The rules folder: the working tree, or a copy of it at a commit.
function rulesDir() {
  const live = path.resolve(__dirname, '../../electron/core/game');
  if (!commit) return live;
  const root = path.resolve(__dirname, '../..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-rules-'));
  for (const file of git('ls-tree', '--name-only', commit, 'electron/core/game/').split('\n').filter(f => f.endsWith('.js'))) {
    fs.writeFileSync(path.join(dir, path.basename(file)), git('show', `${commit}:${file}`));
  }
  console.log(`Rules from ${commit} (${git('rev-parse', '--short', commit).trim()})`);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const dir = rulesDir();
const { simulate } = require(path.join(dir, 'simulate'));
const { PEOPLE } = require(path.join(dir, 'made-up-days'));

const FILM_DAYS = [1, 7, 21, 30, 40, 60, 90, 130, 180];
const OTHERS_DAY = 180;
const SQUARE_DAYS = [1, 7, 30, 90, 180];

function describe(state) {
  const buildings = state.islands.reduce((n, island) => n + island.buildings.length, 0);
  const land = state.islands.reduce((n, island) => n + (island.land ?? 0), 0);
  return `v${state.rulesVersion}: ${state.islands.length} islands, ${land} land, ${buildings} buildings, ` +
    `${state.links.length} bridges, ${state.helpers.length} helpers, ${state.wonders.length} wonders`;
}

const write = (file, state) => {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`${path.relative(process.cwd(), file)}: ${describe(state)}`);
};

function townStates() {
  // Play everyone first, so a rules error leaves the old files in place.
  const files = [];
  for (const person of PEOPLE) {
    const days = person.id === 'steady' ? FILM_DAYS : [OTHERS_DAY];
    const states = simulate(person.id, days);
    for (const day of days) files.push([`${person.id}-day-${day}.json`, states[day]]);
  }
  const out = path.join(__dirname, 'states', 'town');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [name, state] of files) write(path.join(out, name), state);
}

function squareStates(person = 'steady') {
  if (!PEOPLE.some(p => p.id === person)) {
    console.error(`Unknown person "${person}". Try one of: ${PEOPLE.map(p => p.id).join(', ')}.`);
    process.exit(1);
  }
  const out = path.join(__dirname, 'states');
  fs.mkdirSync(out, { recursive: true });
  const states = simulate(person, SQUARE_DAYS);
  for (const day of SQUARE_DAYS) write(path.join(out, `day-${day}.json`), states[day]);
}

if (args[0] === '--square') squareStates(args[1]);
else if (args[0]) { console.error('Usage: make-states.js [--commit <ref>] [--square [person]]'); process.exit(2); }
else townStates();
