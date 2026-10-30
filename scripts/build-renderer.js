const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'electron/renderer');
const shared = { bundle: true, platform: 'browser', format: 'iife', target: 'chrome120' };
buildSync({
  ...shared,
  entryPoints: [path.join(renderer, 'app-source.js')],
  outfile: path.join(renderer, 'app.js'),
});
// The sky island (Three.js, layout, and scene) is its own script, loaded before app.js.
buildSync({
  ...shared,
  entryPoints: [path.join(renderer, 'game/index.js')],
  outfile: path.join(renderer, 'game.js'),
  minify: true,
});
