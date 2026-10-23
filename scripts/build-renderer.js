const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
buildSync({
  entryPoints: [path.join(root, 'electron/renderer/app-source.js')],
  outfile: path.join(root, 'electron/renderer/app.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
});
