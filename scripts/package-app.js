const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { packager } = require('@electron/packager');

const root = path.resolve(__dirname, '..');
const build = path.join(root, '.build');
const source = path.join(build, 'package-source');
const output = path.join(build, process.env.COZY_FOCUS_STAGE_BUILD === '1' ? 'ElectronBuild-next' : 'ElectronBuild');
const manifest = require(path.join(root, 'package.json'));
const electronCache = path.join(os.homedir(), 'Library', 'Caches', 'electron');

function cachedElectronZip(version) {
  const zip = `electron-v${version}-darwin-${process.arch}.zip`;
  if (!fs.existsSync(electronCache)) return undefined;
  for (const entry of fs.readdirSync(electronCache)) {
    const directory = path.join(electronCache, entry);
    if (fs.existsSync(path.join(directory, zip))) return directory;
  }
  return undefined;
}

async function main() {
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  // The renderer's game sources are already bundled into electron/renderer/game.js, and tests never ship.
  // electron/core/game/ does ship: the main process requires it at runtime.
  const gameSources = path.join(root, 'electron', 'renderer', 'game');
  fs.cpSync(path.join(root, 'electron'), path.join(source, 'electron'), {
    recursive: true,
    filter: file => file !== gameSources && !file.startsWith(gameSources + path.sep) && !file.endsWith('.test.js'),
  });
  if (!fs.existsSync(path.join(source, 'electron', 'renderer', 'game.js'))) throw new Error('Missing electron/renderer/game.js. Run npm run check:source first.');
  if (!fs.existsSync(path.join(source, 'electron', 'core', 'game', 'index.js'))) throw new Error('Missing electron/core/game/ in the packaged copy.');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, main: manifest.main,
  }));
  const bundles = await packager({
    dir: source, out: output, name: 'CozyFocusPet', executableName: 'CozyFocusPet',
    platform: 'darwin', arch: process.arch, electronVersion: manifest.devDependencies.electron,
    electronZipDir: cachedElectronZip(manifest.devDependencies.electron),
    appBundleId: 'local.cozyfocuspet.app', overwrite: true,
    extendInfo: { LSUIElement: true },
  });
  const app = path.join(bundles[0], 'CozyFocusPet.app');
  const displayName = spawnSync('/usr/libexec/PlistBuddy',
    ['-c', 'Set :CFBundleDisplayName Cozy Focus Pet', path.join(app, 'Contents', 'Info.plist')], { stdio: 'inherit' });
  if (displayName.status !== 0) throw new Error('Could not set the app display name.');
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  if (signed.status !== 0) throw new Error('Local app signing failed.');
  const verified = spawnSync('codesign', ['--verify', '--deep', app], { stdio: 'inherit' });
  if (verified.status !== 0) throw new Error('Local app signature verification failed.');
  console.log(app);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
