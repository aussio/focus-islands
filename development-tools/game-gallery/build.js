#!/usr/bin/env node
// Builds the sky-island gallery into one self-contained HTML page (three and the scene bundled in).
//
//   node development-tools/game-gallery/build.js .build/game-gallery.html
//
// Open a section by hash: #kinds, #helpers, #worlds, #world-grown-break, #state-day-7 (see client.js).
// When development-tools/game-gallery/states/day-*.json exist and electron/renderer/game/layout/index.js
// exports buildWorld, each state is laid out here in Node and shown as #state-day-<n>. Missing either
// is fine: those sections are skipped. The page reads no app data and never ships.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');

async function layoutStates() {
  const dir = path.join(__dirname, 'states');
  const layoutFile = path.join(root, 'electron/renderer/game/layout/index.js');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^day-\d+\.json$/.test(name)) : [];
  if (!files.length) return { states: [], note: 'No layout states yet (development-tools/game-gallery/states/day-*.json).' };
  if (!fs.existsSync(layoutFile)) return { states: [], note: 'No layout yet (electron/renderer/game/layout/index.js).' };
  let layout;
  try { layout = await import(pathToFileURL(layoutFile).href); } catch (error) { return { states: [], note: `The layout failed to load: ${error.message}` }; }
  if (typeof layout.buildWorld !== 'function') return { states: [], note: 'The layout does not export buildWorld yet.' };
  files.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const states = files.map(file => {
    const name = `state-${file.replace(/\.json$/, '')}`;
    try {
      const source = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      // A state file may hold the game state itself, or wrap it as { state } or { game }.
      const state = source.islands ? source : source.state ?? source.game ?? source;
      const world = layout.buildWorld(state);
      const summary = `${world.islands?.length ?? 0} islands · ${world.things?.length ?? 0} things · ${world.helpers?.length ?? 0} helpers`;
      return { name, world, summary };
    } catch (error) {
      return { name, error: error.message };
    }
  });
  return { states, note: '' };
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error('Usage: node development-tools/game-gallery/build.js gallery.html');
    process.exit(2);
  }
  const { states, note } = await layoutStates();
  const bundle = buildSync({
    entryPoints: [path.join(__dirname, 'client.js')],
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', write: false, legalComments: 'none',
  }).outputFiles[0].text;
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const data = JSON.stringify({ states, stateNote: note }).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cozy Focus Pet · Sky island gallery</title><style>${css}</style></head>
<body><header class="gallery-header"><span class="gallery-title">Sky island gallery</span><nav id="gallery-nav"></nav></header>
<main id="gallery-main"></main>
<script>window.GALLERY = ${data};</script><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  const output = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  console.log(`Wrote ${output} (${Math.round(html.length / 1024)} KB; ${states.length} layout states${note ? `; ${note}` : ''})`);
}

main().catch(error => { console.error(error); process.exit(1); });
