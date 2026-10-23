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
  fs.cpSync(path.join(root, 'electron'), path.join(source, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, main: manifest.main,
  }));
  const bundles = await packager({
    dir: source, out: output, name: 'CozyFocusPet', executableName: 'CozyFocusPet',
    platform: 'darwin', arch: process.arch, electronVersion: manifest.devDependencies.electron,
    electronZipDir: cachedElectronZip(manifest.devDependencies.electron),
    appBundleId: 'local.cozyfocuspet.app', overwrite: true,
    extendInfo: { LSUIElement: true, NSUserNotificationAlertStyle: 'alert' },
  });
  const app = path.join(bundles[0], 'CozyFocusPet.app');
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  if (signed.status !== 0) throw new Error('Local app signing failed.');
  const verified = spawnSync('codesign', ['--verify', '--deep', app], { stdio: 'inherit' });
  if (verified.status !== 0) throw new Error('Local app signature verification failed.');
  console.log(app);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
