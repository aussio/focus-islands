const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function restartHelperArguments(pid, root, built, target) {
  // Electron can read app.asar, but external Python cannot traverse it as a directory.
  // Passing the source also lets the helper survive replacement of the installed bundle.
  return ['-c', fs.readFileSync(path.join(__dirname, 'restart-install.py'), 'utf8'),
    String(pid), root, built, target];
}

function build(root, environment, packaged) {
  return new Promise((resolve, reject) => {
    const logPath = path.join(root, '.build', 'restart.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const log = fs.openSync(logPath, 'w');
    const child = spawn('/bin/bash', packaged ? [path.join(root, 'scripts/build.sh')]
      : ['-c', 'npm run check:source'], { cwd: root, env: environment, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Build failed. The app is still running. See ${logPath}`)));
  });
}

async function restartLatest({ app, development, repository }) {
  const metadata = require('../package.json').localBuild;
  const root = development ? repository : metadata?.repository || repository;
  const environment = { ...process.env, FOCUS_ISLANDS_STAGE_BUILD: '1',
    PATH: [metadata?.nodeDirectory, process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':') };
  if (development && app.isPackaged) {
    throw new Error('Use scripts/run-dev.sh --packaged to rebuild this isolated packaged instance.');
  }
  await build(root, environment, app.isPackaged);
  if (!app.isPackaged) {
    app.relaunch();
    app.quit();
    return;
  }
  // The helper outlives this process, waits for SQLite to close, then installs the built bundle.
  // LaunchServices reopens it in the background, without interrupting typing in another app.
  const built = path.join(root, '.build', 'ElectronBuild-next', `FocusIslands-darwin-${process.arch}`, 'FocusIslands.app');
  const target = path.resolve(process.execPath, '../../..');
  if (target !== '/Applications/Focus Islands.app') {
    throw new Error('Install the Personal app with scripts/run-personal.sh before using Restart with Latest Changes.');
  }
  await new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(root, '.build', 'restart.log'), 'a');
    const helper = spawn('/usr/bin/python3', restartHelperArguments(process.pid, root, built, target),
      { detached: true, stdio: ['ignore', 'pipe', log] });
    fs.closeSync(log);
    helper.once('error', reject);
    helper.once('exit', () => reject(new Error('Restart helper failed. See .build/restart.log.')));
    helper.stdout.once('data', () => {
      helper.stdout.destroy();
      helper.unref();
      resolve();
    });
  });
  app.quit();
}

module.exports = { restartLatest, build, restartHelperArguments };
