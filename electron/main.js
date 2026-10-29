const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCore } = require('./core');
const { createActivityDetector } = require('./activity');
const { createBreakReminder } = require('./break-reminders');

const development = process.env.COZY_FOCUS_DEV === '1';
const support = path.join(os.homedir(), 'Library', 'Application Support', 'CozyFocusPet');
const repository = fs.realpathSync(path.resolve(__dirname, '..'));
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
let lastBreakCompleteSequence = 0;
let lastReturnPromptSince = null;
let lastBreakReminderPreview = null;
let publicationEpoch = 0;
let publicationNumber = 0;
let controlProcessing = false;
const activity = createActivityDetector(development ? 5 : 120);
const breakReminder = createBreakReminder();
let activeBreakNotification = null;
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

function showToday() {
  execute('navigate', 'today');
  showWindow();
}

function closeBreakNotification() {
  if (!activeBreakNotification) return;
  const { prompt } = activeBreakNotification;
  activeBreakNotification = null;
  prompt.close();
}

function showBreakReminder(notice) {
  closeBreakNotification();
  const actions = notice.kind === 'endDay'
    ? [['End day', 'end-day'], ['Snooze 5 min', 'snooze-end-day']]
    : notice.kind === 'timer'
    ? [['Start break', 'start-break'], ['Snooze 5 min', 'snooze-break'], ['Skip', 'skip-break']]
    : [['Start break', 'start-break'], ['Snooze 5 min', 'snooze-break']];
  const prompt = new Notification({
    title: notice.kind === 'endDay' ? 'Time to end your day' : 'Time for a real break',
    body: notice.kind === 'endDay' ? 'You’ve reached your planned finish. End your day, or snooze to wrap up.' : notice.kind === 'timer' ? 'Your focus time is up. Take a break, snooze, or skip.' : 'Your day plan suggests a break now. Take a break or snooze.',
    actions: actions.map(([label]) => ({ type: 'button', text: label })),
    groupId: 'cozy-focus-break-reminder',
  });
  activeBreakNotification = { prompt, key: notice.key };
  prompt.on('click', showToday);
  prompt.on('action', (event, index) => {
    if (!breakReminder.isCurrent(notice.key, appStatus())) return showToday();
    const action = actions[event.actionIndex ?? index]?.[1];
    if (action) execute(action);
    if (action === 'end-day') showToday();
  });
  prompt.on('close', () => {
    if (activeBreakNotification?.prompt === prompt) activeBreakNotification = null;
  });
  prompt.on('failed', (_event, error) => {
    if (activeBreakNotification?.prompt === prompt) activeBreakNotification = null;
    console.error('Break notification failed:', error);
  });
  prompt.show();
}

function publish() {
  publicationNumber++;
  const state = appStatus();
  if (window && !window.isDestroyed()) window.webContents.send('cozy:status-changed', state);
  if (state.returnPrompt?.since && state.returnPrompt.since !== lastReturnPromptSince && !development) showWindow();
  lastReturnPromptSince = state.returnPrompt?.since || null;
  if (tray) tray.setTitle(`${state.activity.state === 'inactive' ? '😴' : '😊'}${state.dayEndedAt ? ' Day done' : state.phase === 'idle' ? '' : ` ${state.breakDue && state.todaySituation !== 'working' ? 'Break due' : state.countdown || ''}`}`);
  const notice = breakReminder.next({ ...state, notificationsEnabled: state.notificationsEnabled && (development || Notification.isSupported()) });
  if (activeBreakNotification && !breakReminder.isCurrent(activeBreakNotification.key, state)) closeBreakNotification();
  if (notice && development) lastBreakReminderPreview = notice;
  if (notice && !development) showBreakReminder(notice);
  if (state.breakCompleteSequence > lastBreakCompleteSequence && !state.dayEnding && !development && state.notificationsEnabled && Notification.isSupported()) {
    const complete = new Notification({ title: 'Break complete', body: 'Open the app to confirm your break.' });
    complete.on('click', showWindow);
    complete.show();
  }
  lastBreakCompleteSequence = state.breakCompleteSequence || 0;
  return state;
}

function execute(name, value) {
  if (name.startsWith('dev-') && !development) throw new Error('Development action unavailable');
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
      lastBreakCompleteSequence = 0;
      lastReturnPromptSince = null;
      lastBreakReminderPreview = null;
      closeBreakNotification();
      breakReminder.reset();
    }
    return publish();
  }
  core.action(name, value);
  if (name === 'save-preferences') activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
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
  tray.setTitle('😊');
  tray.setToolTip('Cozy Focus Pet');
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
        result = { ok: true, status: execute(request.action, request.value) };
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
  if (core) {
    try { core.action('flush-plan'); core.action('publish-idle'); core.close(); } catch (error) { console.error(error); }
  }
});

process.on('SIGUSR1', () => app.quit());
