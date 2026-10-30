import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const [portText, statusFile, manifestFile, liveControl] = process.argv.slice(2);
const port = Number(portText);
const extensionId = 'gpomofinaopfjfpieooejmlpjaiadfnp';
const destination = 'https://www.reddit.com/cozy-focus-smoke';

function publish(phase, stale = false) {
  if (liveControl) {
    assert.equal(stale, false);
    execFileSync(liveControl, [phase === 'focus' ? 'start-focus' : 'start-break'], { stdio: 'pipe' });
    return;
  }
  const now = Date.now();
  const updatedAt = new Date(stale ? now - 240_000 : now).toISOString();
  const expiresAt = new Date(stale ? now - 120_000 : now + 90_000).toISOString();
  const temporary = `${statusFile}.next`;
  fs.writeFileSync(temporary, JSON.stringify({ phase, updatedAt, expiresAt }));
  fs.renameSync(temporary, statusFile);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    socket.onmessage = event => {
      const reply = JSON.parse(event.data);
      if (reply.method === 'Fetch.requestPaused') {
        this.call('Fetch.fulfillRequest', {
          requestId: reply.params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from('<!doctype html><title>Smoke destination</title><h1>Destination loaded</h1>').toString('base64')
        }).catch(() => {});
        return;
      }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error.message));
      else pending.resolve(reply.result);
    };
  }

  async call(method, params = {}) {
    const id = ++this.serial;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
}

async function page() {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  assert.ok(response.ok, `Could not create Chrome tab: ${response.status}`);
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return new CDP(socket);
}

async function navigate(cdp, url) {
  await cdp.call('Page.navigate', { url });
}

async function waitFor(cdp, predicate, label, maxMs = 60_000) {
  const start = Date.now();
  let current;
  while (Date.now() - start < maxMs) {
    try {
      current = await cdp.evaluate('location.href');
      if (predicate(current)) return current;
    } catch (_) { /* Navigation can replace the execution context briefly. */ }
    await sleep(300);
  }
  throw new Error(`${label}: last URL was ${current}`);
}

async function waitForRedirect(cdp, label) {
  return waitFor(cdp, url => url.startsWith(`chrome-extension://${extensionId}/nudge.html#`), label);
}

async function waitForRelease(cdp, label, maxMs = 55_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await navigate(cdp, destination);
    try {
      const url = await waitFor(cdp, current =>
        current.startsWith('chrome-extension://') || current.startsWith('https://www.reddit.com/') ||
        current.startsWith('chrome-error://'), 'navigation settled', 3000);
      if (!url.startsWith('chrome-extension://')) return url;
    } catch (_) { /* The host lease may not have been sampled yet. */ }
    await sleep(1500);
  }
  throw new Error(`${label}: redirect remained active`);
}

async function reactivateFocus(cdp, label) {
  publish('focus');
  await navigate(cdp, `chrome-extension://${extensionId}/popup.html`);
  await waitFor(cdp, url => url.startsWith(`chrome-extension://${extensionId}/popup.html`), 'popup load', 5000);
  const status = await cdp.evaluate('chrome.runtime.sendMessage({command:"status"})');
  assert.equal(status.active, true);
  await navigate(cdp, destination);
  await waitForRedirect(cdp, label);
}

const cdp = await page();
await cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*://*.reddit.com/*' }] });
publish('focus');
await navigate(cdp, `chrome-extension://${extensionId}/popup.html`);
await waitFor(cdp, url => url.startsWith(`chrome-extension://${extensionId}/popup.html`), 'extension page load', 5000);
console.log('Extension page:', await cdp.evaluate('document.body?.innerText'));
console.log('Extension status:', await cdp.evaluate('chrome.runtime.sendMessage({command:"status"})'));
await sleep(1200);
await navigate(cdp, destination);
const redirected = await waitForRedirect(cdp, 'focus redirect');
assert.equal(redirected.split('#').slice(1).join('#'), destination);
assert.equal(await cdp.evaluate('document.title'), 'Focus site pause · Focus Islands');
for (let attempt = 0; attempt < 50; attempt++) {
  if (await cdp.evaluate('document.readyState === "complete" && !!document.getElementById("continue") && !document.getElementById("continue").disabled')) break;
  if (attempt === 49) throw new Error('Nudge page did not become ready');
  await sleep(100);
}
console.log('PASS focus redirect and destination preservation');

await cdp.evaluate('document.getElementById("continue").click()');
const bypassed = await waitFor(cdp, url =>
  url.startsWith('https://www.reddit.com/') || url.startsWith('chrome-error://'), 'one-time bypass', 15_000);
console.log(`PASS one-time bypass (${bypassed})`);
await sleep(1500);
await navigate(cdp, destination);
await waitForRedirect(cdp, 'redirect rearmed after bypass');
console.log('PASS redirect rearmed after bypass');

publish('break');
const releaseStarted = Date.now();
await waitForRelease(cdp, 'break release');
console.log(`PASS break release (${((Date.now() - releaseStarted) / 1000).toFixed(1)} seconds)`);

if (liveControl) {
  cdp.socket.close();
  process.exit(0);
}

await reactivateFocus(cdp, 'focus reactivation');
publish('focus', true);
await waitForRelease(cdp, 'stale host release');
console.log('PASS stale host release');

await reactivateFocus(cdp, 'focus reactivation before host failure');
fs.unlinkSync(manifestFile);
const failedHost = await cdp.evaluate('chrome.runtime.sendMessage({command:"status"})');
assert.equal(failedHost.reason, 'host-unavailable');
await waitForRelease(cdp, 'native host failure release');
console.log('PASS native host failure release');
cdp.socket.close();
