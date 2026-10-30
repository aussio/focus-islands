#!/usr/bin/env node
// Builds the sky-island gallery into one self-contained HTML page (three and the scene bundled in).
//
//   node development-tools/game-gallery/build.js .build/game-gallery.html
//
// Open a section by hash: #index, #<view> or #<view>-<section> (see client.js). The page reads no app
// data and never ships.
//
// - Views: every development-tools/game-gallery/views/*.js is found here and bundled through a small
//   generated entry, which loads each one inside try/catch and hands the list to client.js. A view
//   that doesn't build (a syntax error, a missing import) is left out and shows its error on the page.
// - Town states: states/town/<person>-day-<n>.json (from make-states.js) are laid out here in Node with
//   buildTown from electron/renderer/game/town/index.js. Each island's grid is left out of the page data
//   (it is big) and put back in the page with gridFor(id, size), which gives the same grid every time.
//   Missing states are fine: the views that need them say so.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const statesDir = path.join(__dirname, 'states');
const viewsDir = path.join(__dirname, 'views');

// ---------- Town states ----------
const PEOPLE = (() => { try { return require('../../electron/core/game/made-up-days').PEOPLE; } catch { return []; } })();
const personOrder = id => { const i = PEOPLE.findIndex(p => p.id === id); return i < 0 ? PEOPLE.length : i; };

// The world without its grids: each island keeps only grid: { key }. tools.js puts the grids back.
function stripGrids(world) {
  return { ...world, islands: (world.islands ?? []).map(island => ({ ...island, grid: island.grid ? { key: island.grid.key } : null })) };
}

async function townStates() {
  const dir = path.join(statesDir, 'town');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^[\w]+-day-\d+\.json$/.test(name)) : [];
  if (!files.length) return { states: [], note: 'No town states yet: run node development-tools/game-gallery/make-states.js.' };
  const parse = name => { const [, person, day] = name.match(/^([\w]+)-day-(\d+)\.json$/); return { person, day: Number(day) }; };
  files.sort((a, b) => { const x = parse(a), y = parse(b); return (personOrder(x.person) - personOrder(y.person)) || x.person.localeCompare(y.person) || (x.day - y.day); });
  let buildTown = null, checkTown = null, note = '';
  try {
    const town = await import(pathToFileURL(path.join(root, 'electron/renderer/game/town/index.js')).href);
    if (typeof town.buildTown === 'function') buildTown = town.buildTown;
    else note = 'town/index.js does not export buildTown yet, so the states have no worlds.';
  } catch (error) { note = `The town layout failed to load: ${error.message}`; }
  try { ({ checkTown } = await import(pathToFileURL(path.join(root, 'electron/renderer/game/town/check.js')).href)); } catch { /* checks are optional */ }
  let empty = 0;
  const states = files.map(file => {
    const { person, day } = parse(file);
    const id = file.replace(/\.json$/, '');
    const entry = { id, person, personName: PEOPLE.find(p => p.id === person)?.name ?? person, day };
    try {
      const source = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const game = source.islands ? source : source.state ?? source.game ?? source;
      entry.game = game;
      const buildings = (game.islands ?? []).reduce((n, island) => n + (island.buildings?.length ?? 0), 0);
      const facts = `${game.islands?.length ?? 0} islands · ${buildings} buildings · ${game.links?.length ?? 0} bridges · ${game.helpers?.length ?? 0} helpers`;
      if (!buildTown) { entry.summary = facts; entry.world = null; return entry; }
      const started = performance.now();
      const world = buildTown(game);
      const ms = Math.round(performance.now() - started);
      if (!world?.islands?.length) empty += 1;
      entry.problems = typeof checkTown === 'function' ? checkTown(world) : [];
      const land = (world.islands ?? []).reduce((n, island) => n + (island.land?.length ?? 0), 0);
      entry.summary = `${facts} → ${world.islands?.length ?? 0} town islands, ${land} land points, ${world.things?.length ?? 0} things, ${world.bridges?.length ?? 0} bridges (${ms} ms)`;
      entry.world = stripGrids(world);
    } catch (error) {
      entry.error = error.message;
    }
    return entry;
  });
  if (buildTown && empty === states.length) note = 'buildTown gave no islands for any state yet (it is still a stub).';
  return { states, note };
}

// ---------- Views ----------
function findViews() {
  if (!fs.existsSync(viewsDir)) return [];
  return fs.readdirSync(viewsDir).filter(name => /^[\w-]+\.js$/.test(name) && !name.endsWith('.test.js')).sort();
}

// The entry: loads each view inside try/catch (require, so a view that throws while loading can't stop
// the others), then starts the page. broken: [{ file, error }] for views that didn't build.
function entrySource(views, broken) {
  const lines = ["import { start } from './client.js';", 'const views = [];'];
  for (const { file, error } of broken) lines.push(`views.push({ file: ${JSON.stringify(file)}, error: ${JSON.stringify(`This view did not build:\n${error}`)} });`);
  for (const file of views) {
    lines.push(`try { const mod = require(${JSON.stringify(`./views/${file}`)}); views.push({ file: ${JSON.stringify(file)}, view: mod.default ?? mod }); }`);
    lines.push(`catch (error) { console.error(error); views.push({ file: ${JSON.stringify(file)}, error: 'This view failed to load:\\n' + (error && error.stack || error) }); }`);
  }
  lines.push('views.sort((a, b) => a.file.localeCompare(b.file));', 'start(views);');
  return lines.join('\n');
}

const bundleOf = (views, broken) => buildSync({
  stdin: { contents: entrySource(views, broken), resolveDir: __dirname, sourcefile: 'gallery-entry.js', loader: 'js' },
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', write: false, legalComments: 'none', logLevel: 'silent',
}).outputFiles[0].text;

const buildMessage = error => (error.errors ?? []).map(e => `${e.location ? `${path.relative(root, path.resolve(e.location.file))}:${e.location.line}: ` : ''}${e.text}`).join('\n') || error.message;

function bundleViews() {
  const views = findViews();
  try {
    return { bundle: bundleOf(views, []), views, broken: [] };
  } catch (error) {
    // Something didn't build. Try each view alone and leave out the ones that fail.
    const good = [], broken = [];
    for (const file of views) {
      try { bundleOf([file], []); good.push(file); } catch (viewError) { broken.push({ file, error: buildMessage(viewError) }); }
    }
    // If the gallery itself is broken (not a view), say so plainly.
    try { return { bundle: bundleOf(good, broken), views: good, broken }; } catch { throw new Error(`The gallery did not build:\n${buildMessage(error)}`); }
  }
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error('Usage: node development-tools/game-gallery/build.js gallery.html');
    process.exit(2);
  }
  const town = await townStates();
  const { bundle, views, broken } = bundleViews();
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const data = JSON.stringify({ town }).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus Islands · Sky island gallery</title><style>${css}</style></head>
<body><header class="gallery-header"><a class="gallery-title" href="#index">Sky island gallery</a><nav id="gallery-nav"></nav></header>
<main id="gallery-main"></main>
<script>window.GALLERY = ${data};</script><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  const output = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  const kb = bytes => `${Math.round(bytes / 1024)} KB`;
  console.log(`Wrote ${output} (${kb(html.length)}: script ${kb(bundle.length)}, data ${kb(data.length)})`);
  console.log(`Views: ${views.length ? views.join(', ') : 'none'}${broken.length ? `; did not build: ${broken.map(b => b.file).join(', ')}` : ''}`);
  for (const { file, error } of broken) console.log(`  ${file}: ${error.split('\n')[0]}`);
  console.log(`Town states: ${town.states.length}${town.note ? ` (${town.note})` : ''}`);
  for (const entry of town.states) if (entry.error) console.log(`  ${entry.id}: failed: ${entry.error}`);
}

main().catch(error => { console.error(error.message ?? error); process.exit(1); });
