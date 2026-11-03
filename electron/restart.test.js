const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { build, restartLatest, restartHelperArguments } = require('./restart');

function checkout(t, script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-restart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts/build.sh'), script);
  return root;
}

test('restart build records errors and leaves the running app alone', async t => {
  const root = checkout(t, 'echo broken-build >&2\nexit 1\n');
  let stopped = false;
  await assert.rejects(restartLatest({
    app: { isPackaged: true, quit() { stopped = true; }, relaunch() { stopped = true; } },
    development: false, repository: root,
  }), /Build failed/);
  assert.equal(stopped, false);
  assert.match(fs.readFileSync(path.join(root, '.build/restart.log'), 'utf8'), /broken-build/);
});

test('build uses the requested checkout and staging environment', async t => {
  const root = checkout(t, 'test "$FOCUS_ISLANDS_STAGE_BUILD" = 1 && pwd\n');
  await build(root, { ...process.env, FOCUS_ISLANDS_STAGE_BUILD: '1' }, true);
  assert.equal(fs.readFileSync(path.join(root, '.build/restart.log'), 'utf8').trim(), fs.realpathSync(root));
});

test('installer waits for shutdown and recovers from failures', () => {
  const result = spawnSync('/usr/bin/python3', [path.join(__dirname, '../scripts/test-restart.py')], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('Python starts the helper without needing access to its packaged file', { timeout: 5000 }, async t => {
  // This live PID keeps the helper waiting: it must never install or open an app in this test.
  const args = restartHelperArguments(process.pid, '/unused-checkout', '/unused-built.app', '/unused-target.app');
  assert.equal(args[0], '-c');
  const helper = spawn('/usr/bin/python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => helper.kill());
  const closed = once(helper, 'close');
  const ready = await Promise.race([
    once(helper.stdout, 'data'),
    closed.then(() => { throw new Error('Helper exited before reporting readiness'); }),
  ]);
  assert.equal(ready[0].toString().trim(), 'ready');
  helper.kill();
  await closed;
});
