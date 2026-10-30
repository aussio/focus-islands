const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [
  'electron/main.js', 'electron/preload.js', 'electron/core/index.js',
  'electron/renderer/index.html', 'electron/renderer/app.js', 'electron/renderer/app-source.js',
  'electron/renderer/game.js', 'electron/renderer/game/index.js',
  'electron/renderer/break-reminder-effect.html', 'electron/renderer/break-reminder-effect.js',
  'electron/renderer/alarm-clock.svg',
  'electron/renderer/state.js', 'scripts/build-renderer.js',
  'electron/renderer/styles.css',
  'scripts/package-app.js',
];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
for (const file of files.filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Electron source files are present.');
