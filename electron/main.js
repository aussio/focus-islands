const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, powerMonitor, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCore } = require('./core');
const { createActivityDetector } = require('./activity');
const { createBreakReminder } = require('./break-reminders');

const development = process.env.COZY_FOCUS_DEV === '1';
const support = path.join(os.homedir(), 'Library', 'Application Support', 'CozyFocusPet');
const repository = fs.realpathSync(development && process.env.COZY_FOCUS_DEV_REPOSITORY
  ? process.env.COZY_FOCUS_DEV_REPOSITORY : path.resolve(__dirname, '..'));
const devInstance = process.argv.find(argument => argument.startsWith('--cozy-instance='))?.slice('--cozy-instance='.length) || 'default';
if (development && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(devInstance)) throw new Error('Invalid development instance name.');
const devState = devInstance === 'default'
  ? path.join(repository, '.build', 'dev-state')
  : path.join(repository, '.build', 'dev-instances', devInstance);
if (development) {
  fs.mkdirSync(devState, { recursive: true });
  if (fs.realpathSync(devState) !== devState) throw new Error('Development state must stay inside this checkout.');
}
const controlDir = development ? path.join(devState, 'control') : null;
const dbPath = development ? path.join(devState, 'events.sqlite') : path.join(support, 'events.sqlite');
const statusPath = development ? path.join(devState, 'focus-status.json') : path.join(support, 'focus-status.json');
if (development) {
  for (const candidate of [controlDir, dbPath, statusPath, path.join(devState, 'preferences-testing.json'), path.join(devState, 'electron-user-data')]) {
    let item;
    try { item = fs.lstatSync(candidate); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (item?.isSymbolicLink() || (item && fs.realpathSync(candidate) !== candidate)) {
      throw new Error('Development paths must stay inside this checkout.');
    }
  }
}
const initialProfile = development ? 'testing' : 'personal';
let activeProfile = initialProfile;
const rendererActions = new Set([
  'navigate', 'start-focus', 'end-focus', 'start-break', 'start-long-break', 'finish-break', 'confirm-return', 'keep-break', 'snooze-break',
  'skip-break', 'end-day', 'snooze-end-day', 'save-plan', 'upsert-meeting', 'remove-meeting', 'save-reflection',
  'save-preferences', 'switch-profile', 'purchase', 'preview-rewards',
  'today-suggestion', 'today-break', 'flush-plan', 'export-json', 'backup-database',
  'dev-scenario', 'dev-advance', 'dev-away', 'dev-return', 'dev-sleep-wake',
]);

let core;
let window;
let tray;
let quitting = false;
let lastReturnPromptSince = null;
let lastBreakReminderPreview = null;
let publicationEpoch = 0;
let publicationNumber = 0;
let controlProcessing = false;
const activity = createActivityDetector(development ? 5 : 120);
const breakReminder = createBreakReminder();
let lastBreakAlertKey = null;
const reminderWindows = new Set();
let reminderTimer = null;
let screenLocked = false;
let systemSuspended = false;
let activityOverrideUntil = 0;
let activityOverrideSeconds = 0;

app.setName('Cozy Focus Pet');
const userDataPath = development ? path.join(devState, 'electron-user-data') : path.join(support, 'electron-user-data');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
if (!app.requestSingleInstanceLock({ development })) app.quit();
app.on('second-instance', () => {
  if (!development) showWindow();
});

function appStatus() {
  const { events: _events, ...state } = core.status();
  return {
    ...state,
    activity: state.dayEndedAt ? { ...activity.status(), state: 'inactive', idleSeconds: null } : activity.status(),
    appActive: Boolean(window?.isFocused()),
    dockIconActive: app.dock?.isVisible() ?? false,
    publicationEpoch, publicationNumber,
    developmentMode: development,
    canSwitchProfiles: !development,
    ...(development ? { lastBreakReminderPreview } : {}),
  };
}

function revealTodayForReminder(key) {
  setTimeout(() => {
    if (!breakReminder.isCurrent(key, appStatus())) return;
    execute('navigate', 'today');
    if (window && !window.isDestroyed()) window.showInactive();
  }, 750);
}

function closeReminderEffect() {
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = null;
  for (const overlay of reminderWindows) if (!overlay.isDestroyed()) overlay.close();
  reminderWindows.clear();
}

function showReminderEffect(effect) {
  closeReminderEffect();
  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.bounds;
    const overlay = new BrowserWindow({
      x, y, width, height, show: false, frame: false, transparent: true,
      focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, 'floating');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    reminderWindows.add(overlay);
    overlay.on('closed', () => reminderWindows.delete(overlay));
    overlay.loadFile(path.join(__dirname, 'renderer', 'break-reminder-effect.html'), { query: { effect } })
      .then(() => { if (!overlay.isDestroyed()) overlay.showInactive(); })
      .catch(error => { console.error('Could not show reminder effect:', error); if (!overlay.isDestroyed()) overlay.close(); });
  }
  reminderTimer = setTimeout(closeReminderEffect, 3500);
  return reminderWindows.size;
}

function publish() {
  publicationNumber++;
  const state = appStatus();
  if (window && !window.isDestroyed()) window.webContents.send('cozy:status-changed', state);
  if (state.returnPrompt?.since && state.returnPrompt.since !== lastReturnPromptSince && !development) showWindow();
  lastReturnPromptSince = state.returnPrompt?.since || null;
  if (tray) {
    tray.setTitle(`${state.profile === 'testing' ? '🧪' : state.activity.state === 'inactive' ? '😴' : '😊'}${state.dayEndedAt ? ' Day done' : state.phase === 'idle' ? '' : ` ${state.breakDue && state.todaySituation !== 'working' ? 'Break due' : state.countdown || ''}`}`);
    tray.setToolTip(`Cozy Focus Pet · ${state.profile === 'testing' ? 'Testing' : 'Personal'} profile`);
  }
  const notice = breakReminder.next(state);
  if (notice) {
    const first = notice.key !== lastBreakAlertKey;
    lastBreakAlertKey = notice.key;
    const effect = first ? (notice.kind === 'endDay' ? null : 'confetti') : 'clock';
    if (development) lastBreakReminderPreview = { ...notice, effect };
    else {
      if (effect) showReminderEffect(effect);
      if (first) revealTodayForReminder(notice.key);
    }
  }
  return state;
}

function execute(name, value) {
  if (name.startsWith('dev-') && !development) throw new Error('Development action unavailable');
  if (name === 'dev-confetti' || name === 'dev-clock') return { ...publish(), reminderDisplayCount: showReminderEffect(name === 'dev-clock' ? 'clock' : 'confetti') };
  if (name === 'export-json' || name === 'backup-database') return saveUserCopy(name);
  if (name === 'switch-profile') {
    if (development || !['personal', 'testing'].includes(value)) throw new Error('Profile switch unavailable');
    if (core.status().phase !== 'idle') throw new Error('Finish the session before switching profiles');
    if (value !== activeProfile) {
      core.action('flush-plan');
      core.close();
      activeProfile = value;
      const nextDbPath = value === 'personal' ? path.join(support, 'events.sqlite') : path.join(support, 'profiles', 'testing', 'events.sqlite');
      core = createCore({ dbPath: nextDbPath, statusPath, profile: value, development: false });
      activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
      publicationEpoch++;
      publicationNumber = 0;
      lastReturnPromptSince = null;
      lastBreakReminderPreview = null;
      lastBreakAlertKey = null;
      closeReminderEffect();
      breakReminder.reset();
    }
    return publish();
  }
  core.action(name, value);
  if (['start-break', 'start-long-break', 'snooze-break', 'skip-break', 'end-day'].includes(name)) closeReminderEffect();
  if (name === 'save-preferences') {
    activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
    if (!core.status().notificationsEnabled) closeReminderEffect();
  }
  return publish();
}

async function saveUserCopy(name) {
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    defaultPath: path.join(os.homedir(), name === 'export-json' ? 'cozy-focus-events.json' : 'cozy-focus-events.sqlite'),
  });
  if (canceled) return appStatus();
  if (name === 'export-json') core.exportJSON(filePath);
  else await core.backup(filePath);
  return publish();
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  window.show();
  window.focus();
}

function makeTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(activeProfile === 'testing' ? '🧪' : '😊');
  tray.setToolTip(`Cozy Focus Pet · ${activeProfile === 'testing' ? 'Testing' : 'Personal'} profile`);
  tray.on('click', () => window.isVisible() ? window.hide() : showWindow());
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: `${appStatus().profile === 'testing' ? 'Testing' : 'Personal'} profile`, enabled: false },
    { label: 'Open Window', click: showWindow },
    { label: 'Quit Cozy Focus Pet', click: () => { quitting = true; app.quit(); } },
  ])));
}

async function driveUI(action, value) {
  const input = typeof value === 'string' ? { selector: value } : value;
  if (!input || typeof input.selector !== 'string' || input.selector.length > 160 ||
    !['ui-click', 'ui-fill', 'ui-read', 'ui-drag'].includes(action)) throw new Error('Invalid UI control request.');
  if (action === 'ui-fill' && (typeof input.text !== 'string' || input.text.length > 2000)) throw new Error('Invalid UI text.');
  if (action === 'ui-drag') {
    const horizontal = [input.fromX, input.toX].every(Number.isFinite);
    const vertical = [input.fromY, input.toY].every(Number.isFinite);
    if ((!horizontal && !vertical) || [input.fromX, input.toX, input.fromY, input.toY]
      .some(coordinate => coordinate !== undefined && (!Number.isFinite(coordinate) || Math.abs(coordinate) > 5000))) {
      throw new Error('Invalid UI drag.');
    }
  }
  const outcome = await window.webContents.executeJavaScript(`(() => {
    const input = ${JSON.stringify(input)};
    const node = document.querySelector(input.selector);
    if (!node) return { found: false };
    if (${JSON.stringify(action)} === 'ui-read') return { found: true, value: 'value' in node ? node.value : node.textContent };
    if (${JSON.stringify(action)} === 'ui-click') node.click();
    if (${JSON.stringify(action)} === 'ui-fill') {
      if (!node.matches('input, textarea, select')) throw new Error('Target is not a form field.');
      node.value = input.text;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    if (${JSON.stringify(action)} === 'ui-drag') {
      const rect = node.getBoundingClientRect();
      const fromX = rect.left + (input.fromX ?? rect.width / 2), toX = rect.left + (input.toX ?? rect.width / 2);
      const fromY = rect.top + (input.fromY ?? rect.height / 2), toY = rect.top + (input.toY ?? rect.height / 2);
      const start = document.elementFromPoint(fromX, fromY) || node;
      start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: fromX, clientY: fromY }));
      const middleX = (fromX + toX) / 2, middleY = (fromY + toY) / 2;
      (document.elementFromPoint(middleX, middleY) || node).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: middleX, clientY: middleY }));
      const previewVisible = Boolean(document.querySelector('.meeting-drag-preview')?.getBoundingClientRect().height);
      (document.elementFromPoint(toX, toY) || node).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: toX, clientY: toY }));
      const end = document.elementFromPoint(toX, toY) || node;
      end.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: toX, clientY: toY }));
      return { found: true, previewVisible };
    }
    return { found: true };
  })()`);
  if (!outcome.found) throw new Error(`UI target not found: ${input.selector}`);
  await new Promise(resolve => setTimeout(resolve, 100));
  return outcome;
}

async function processControl() {
  if (!controlDir) return;
  let names;
  try { names = fs.readdirSync(controlDir).filter(name => name.endsWith('.json')); }
  catch { return; }
  for (const name of names) {
    const requestPath = path.join(controlDir, name);
    let request;
    try { request = JSON.parse(fs.readFileSync(requestPath, 'utf8')); }
    catch { fs.rmSync(requestPath, { force: true }); continue; }
    fs.rmSync(requestPath, { force: true });
    let result;
    try {
      if (request.action === 'screenshot') {
        await new Promise(resolve => setTimeout(resolve, 200));
        const image = await window.webContents.capturePage();
        const screenshot = path.join(devState, `screenshot-${Date.now()}.png`);
        fs.writeFileSync(screenshot, image.toPNG());
        const renderedPage = await window.webContents.executeJavaScript('document.querySelector("h1")?.textContent || document.querySelector("#today-guidance")?.textContent || ""');
        result = { ok: true, screenshot, renderedPage, status: appStatus() };
      } else if (request.action === 'confetti-screenshot' || request.action === 'clock-screenshot') {
        const effect = request.action === 'clock-screenshot' ? 'clock' : 'confetti';
        const displayCount = showReminderEffect(effect);
        await new Promise(resolve => setTimeout(resolve, effect === 'clock' ? 1500 : 400));
        const overlay = [...reminderWindows][0];
        if (!overlay) throw new Error('No display is available for the reminder effect.');
        const image = await overlay.webContents.capturePage();
        const screenshot = path.join(devState, `${effect}-${Date.now()}.png`);
        fs.writeFileSync(screenshot, image.toPNG());
        result = { ok: true, screenshot, displayCount, status: appStatus() };
      } else if (request.action === 'status') {
        result = { ok: true, status: appStatus() };
      } else if (request.action === 'activity-sample') {
        const seconds = Number(request.value);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new Error('Invalid idle seconds');
        activityOverrideSeconds = seconds;
        activityOverrideUntil = Date.now() + 15000;
        activity.observe(seconds);
        result = { ok: true, status: publish() };
      } else if (request.action === 'events') {
        result = { ok: true, events: core.status().events, status: appStatus() };
      } else if (typeof request.action === 'string' && request.action.startsWith('ui-')) {
        result = { ok: true, ui: await driveUI(request.action, request.value), status: appStatus() };
      } else if (request.action === 'input-stability') {
        execute('navigate', 'settings');
        await new Promise(resolve => setTimeout(resolve, 200));
        const prepared = await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('#settings-focus');
          if (!input) return false;
          input.value = '47';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        if (core.status().phase === 'focus') execute('advance', 1);
        await new Promise(resolve => setTimeout(resolve, 1600));
        const preserved = await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('#settings-focus');
          const kept = Boolean(input && input.value === '47');
          input?.dispatchEvent(new Event('focusout', { bubbles: true }));
          return kept;
        })()`);
        await new Promise(resolve => setTimeout(resolve, 1200));
        const afterBlur = await window.webContents.executeJavaScript("document.querySelector('#settings-focus')?.value === '47'");
        await window.webContents.executeJavaScript("document.querySelector('[data-action=save-preferences]')?.click()");
        await new Promise(resolve => setTimeout(resolve, 200));
        const saved = core.status().defaultFocusLength === 47;
        result = { ok: prepared && preserved && afterBlur && saved, prepared, preserved, afterBlur, saved, status: appStatus() };
      } else if (request.action === 'plan-tomorrow') {
        execute('navigate', 'plan');
        await new Promise(resolve => setTimeout(resolve, 200));
        const prepared = await window.webContents.executeJavaScript(`(() => {
          document.querySelector('[data-plan-day="tomorrow"]')?.click();
          const input = document.querySelector('#focus-length');
          if (!input) return false;
          input.value = '35';
          input.dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelector('#save-plan')?.click();
          return true;
        })()`);
        await new Promise(resolve => setTimeout(resolve, 1800));
        const state = appStatus();
        const saved = state.dayPlans[state.tomorrowKey]?.baseline?.focusMinutes === 35;
        result = { ok: prepared && saved, prepared, saved, status: state };
      } else if (request.action === 'quit') {
        result = { ok: true, status: appStatus() };
      } else if (request.action === 'show-window') {
        showWindow(); result = { ok: true, status: appStatus() };
      } else if (request.action === 'close-window') {
        window.hide(); result = { ok: true, status: appStatus() };
      } else {
        if (typeof request.action !== 'string' || request.action.length > 64) throw new Error('Invalid command');
        result = { ok: true, status: await execute(request.action, request.value) };
      }
    } catch (error) { result = { ok: false, error: String(error.message || error), status: appStatus() }; }
    fs.writeFileSync(path.join(controlDir, `${request.id}.response`), JSON.stringify(result));
    if (request.action === 'quit') { quitting = true; setTimeout(() => app.quit(), 50); }
  }
}

app.whenReady().then(() => {
  app.dock?.hide();
  core = createCore({ dbPath, statusPath, profile: initialProfile, development });
  activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
  activity.observe(powerMonitor.getSystemIdleTime());
  window = new BrowserWindow({
    width: 1200, height: 900, minWidth: 790, minHeight: 590, show: false,
    title: 'Cozy Focus Pet', backgroundColor: '#f4eee4',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.on('minimize', event => { event.preventDefault(); window.hide(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  makeTray();
  ipcMain.handle('cozy:status', () => appStatus());
  ipcMain.handle('cozy:action', (_event, name, value) => {
    if (!rendererActions.has(name)) throw new Error('Unknown action');
    if (name.startsWith('dev-') && !development) throw new Error('Development action unavailable');
    return execute(name, value);
  });
  powerMonitor.on('suspend', () => { const idleSeconds = powerMonitor.getSystemIdleTime(); systemSuspended = true; activity.setUnavailable(true); execute('sleep', idleSeconds); });
  powerMonitor.on('resume', () => { systemSuspended = false; activity.setUnavailable(screenLocked); execute('wake'); });
  powerMonitor.on('lock-screen', () => { const idleSeconds = powerMonitor.getSystemIdleTime(); screenLocked = true; activity.setUnavailable(true); execute('lock', idleSeconds); });
  powerMonitor.on('unlock-screen', () => { screenLocked = false; activity.setUnavailable(systemSuspended); execute('unlock'); });
  setInterval(() => {
    try {
      const idleSeconds = development && Date.now() < activityOverrideUntil
        ? activityOverrideSeconds : powerMonitor.getSystemIdleTime();
      activity.observe(idleSeconds);
      core.action('tick', idleSeconds);
      publish();
    } catch (error) { console.error('Timer tick failed; retrying next tick:', error); }
    if (!controlProcessing) {
      controlProcessing = true;
      void processControl().catch(error => console.error('Development control failed:', error))
        .finally(() => { controlProcessing = false; });
    }
  }, 1000);
  if (controlDir) fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  window.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden-window')) {
      if (process.argv.includes('--background-window')) window.showInactive();
      else window.show();
    }
    publish();
  });
});

app.on('before-quit', () => {
  quitting = true;
  closeReminderEffect();
  if (core) {
    try { core.action('flush-plan'); core.action('publish-idle'); core.close(); } catch (error) { console.error(error); }
  }
});

process.on('SIGUSR1', () => app.quit());
