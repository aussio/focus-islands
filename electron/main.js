const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, powerMonitor, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCore } = require('./core');
const { createActivityDetector } = require('./activity');
const { createBreakReminder } = require('./break-reminders');

const development = process.env.COZY_FOCUS_DEV === '1';
// The game demo (scripts/run-game-demo.sh, or scripts/run-dev.sh --demo): a development app whose Today has demo
// buttons. It treats you as present the whole time; only its Step away button takes you away.
const demo = development && process.argv.includes('--demo');
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
  for (const candidate of [controlDir, dbPath, statusPath, path.join(devState, 'preferences-testing.json'), path.join(devState, 'electron-user-data'),
    path.join(devState, 'demo-clock.json')]) {
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
  'save-preferences', 'switch-profile',
  'today-suggestion', 'today-break', 'flush-plan', 'export-json', 'backup-database', 'game-check-in',
  'dev-scenario', 'dev-advance', 'dev-away', 'dev-return', 'dev-sleep-wake', 'dev-demo',
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

app.setName('Focus Islands');
const userDataPath = development ? path.join(devState, 'electron-user-data') : path.join(support, 'electron-user-data');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
if (!app.requestSingleInstanceLock({ development })) app.quit();
app.on('second-instance', () => {
  if (!development) showWindow('a second launch');
});

// Development only: every time macOS made this app the active one since launch, so checks see it even when it
// happened between two status calls. The app asks for this only through showWindow(); anything else came from
// outside, almost always a click on the Testing window or its menu bar item.
const activations = [];
let runningControlAction = null;
let requestedActivation = null;
app.on('did-become-active', () => {
  if (!development) return;
  const asked = requestedActivation && Date.now() - requestedActivation.at < 3000 ? requestedActivation.cause : null;
  requestedActivation = null;
  activations.push({ at: new Date().toISOString(), duringControlAction: runningControlAction,
    cause: asked || 'not requested by this app: a click on its window or menu bar item, or another app' });
  if (activations.length > 20) activations.shift();
});

function appStatus() {
  const { events: _events, ...state } = core.status();
  return {
    ...state,
    activity: state.dayEndedAt ? { ...activity.status(), state: 'inactive', idleSeconds: null } : activity.status(),
    // The macOS active app, or a window with keyboard focus. Either one means the user's typing can land here.
    appActive: Boolean(window?.isFocused() || app.isActive?.()),
    dockIconActive: app.dock?.isVisible() ?? false,
    publicationEpoch, publicationNumber,
    developmentMode: development,
    canSwitchProfiles: !development,
    ...(development ? { lastBreakReminderPreview, pid: process.pid, activations: [...activations] } : {}),
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
  if (state.returnPrompt?.since && state.returnPrompt.since !== lastReturnPromptSince && !development) showWindow('the are-you-back prompt');
  lastReturnPromptSince = state.returnPrompt?.since || null;
  if (tray) {
    showTrayIsland(state.activity.state === 'inactive' ? 'night' : 'day');
    tray.setTitle(`${state.profile === 'testing' ? ' 🧪' : ''}${state.dayEndedAt ? ' Day done' : state.phase === 'idle' ? '' : ` ${state.breakDue && state.todaySituation !== 'working' ? 'Break due' : state.countdown || ''}`}`);
    tray.setToolTip(`Focus Islands · ${state.profile === 'testing' ? 'Testing' : 'Personal'} profile`);
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

// Demo only: Start over closes this demo instance's database, deletes it (with its SQLite side files and the
// demo clock), and opens a fresh one, which begins on day 1 at the usual start time. A new publication epoch
// tells the page to drop everything it showed from the old database. Nothing outside this instance is touched.
function startOverDemo() {
  if (!demo) throw new Error('Start over is only for the game demo.');
  core.close();
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, path.join(devState, 'demo-clock.json')]) fs.rmSync(file, { force: true });
  core = createCore({ dbPath, statusPath, profile: activeProfile, development, demo });
  activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
  publicationEpoch++;
  publicationNumber = 0;
  lastReturnPromptSince = null;
  lastBreakReminderPreview = null;
  lastBreakAlertKey = null;
  closeReminderEffect();
  breakReminder.reset();
  return publish();
}

function execute(name, value) {
  if (name.startsWith('dev-') && !development) throw new Error('Development action unavailable');
  if (name === 'dev-demo' && value === 'start-over') return startOverDemo();
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
    defaultPath: path.join(os.homedir(), name === 'export-json' ? 'focus-islands-events.json' : 'focus-islands-events.sqlite'),
  });
  if (canceled) return appStatus();
  if (name === 'export-json') core.exportJSON(filePath);
  else await core.backup(filePath);
  return publish();
}

// Shows the window and makes this the active app, taking the keyboard. Only for a deliberate request.
function showWindow(cause) {
  if (!window || window.isDestroyed()) return;
  requestedActivation = { cause, at: Date.now() };
  window.show();
  window.focus();
}

// Menu bar island: day while you are at the Mac, night while you are away. Colour images, not template
// images, because the colour is the signal. scripts/make-icon.js draws them at 1x and 2x.
const trayIslands = {};
let shownTrayIsland = null;
function trayIsland(look) {
  if (!trayIslands[look]) {
    const image = nativeImage.createEmpty();
    for (const [scaleFactor, suffix] of [[1, ''], [2, '@2x']]) {
      image.addRepresentation({ scaleFactor, buffer: fs.readFileSync(path.join(__dirname, 'tray', `island-${look}${suffix}.png`)) });
    }
    trayIslands[look] = image;
  }
  return trayIslands[look];
}
function showTrayIsland(look) {
  if (look === shownTrayIsland) return;
  tray.setImage(trayIsland(look));
  shownTrayIsland = look;
}

function makeTray() {
  tray = new Tray(trayIsland('day'));
  shownTrayIsland = 'day';
  tray.setTitle(activeProfile === 'testing' ? ' 🧪' : '');
  tray.setToolTip(`Focus Islands · ${activeProfile === 'testing' ? 'Testing' : 'Personal'} profile`);
  const menu = () => Menu.buildFromTemplate([
    { label: `${appStatus().profile === 'testing' ? 'Testing' : 'Personal'} profile${development ? ` · ${devInstance}` : ''}`, enabled: false },
    { label: 'Open Window', click: () => showWindow('Open Window in the menu bar menu') },
    { label: 'Quit Focus Islands', click: () => { quitting = true; app.quit(); } },
  ]);
  // A Testing app's menu bar item only opens its menu on a click. Agents run several Testing apps at once, and
  // their look-alike items come and go, so a click that showed and focused the window took the user's keyboard.
  tray.on('click', () => {
    if (development) tray.popUpContextMenu(menu());
    else if (window.isVisible()) window.hide();
    else showWindow('a menu bar click');
  });
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
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

// Development only: draws a page built into this checkout's .build/ folder (such as the sky-island
// gallery) in a window that is never shown, waits for window.galleryReady, and saves a picture of it.
async function galleryScreenshot(value) {
  const input = value && typeof value === 'object' ? value : {};
  const buildDir = path.join(repository, '.build');
  const file = typeof input.file === 'string' ? fs.realpathSync(path.resolve(repository, input.file)) : '';
  if (!file.startsWith(buildDir + path.sep) || !file.endsWith('.html')) throw new Error('The gallery page must be an .html file inside .build/.');
  const hash = typeof input.hash === 'string' ? input.hash.replace(/^#/, '') : '';
  if (!/^[\w-]{0,80}$/.test(hash)) throw new Error('Invalid gallery hash.');
  const size = (number, fallback, max) => Math.round(Math.min(max, Math.max(200, Number(number) || fallback)));
  const width = size(input.width, 1400, 4000), height = size(input.height, 1000, 8000);
  // Seconds to wait for window.galleryReady. Pages with many worlds can need longer than the usual 12.
  const seconds = input.timeout === undefined ? 12 : Number(input.timeout);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('The gallery timeout must be 1 to 60 seconds.');
  const page = new BrowserWindow({
    width, height, useContentSize: true, show: false, focusable: false, skipTaskbar: true, frame: false,
    // No alert(), confirm() or prompt(): a native dialog from a broken page would make the app active.
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, disableDialogs: true },
  });
  try {
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    page.webContents.on('will-navigate', event => event.preventDefault());
    await page.loadFile(file, { hash });
    const deadline = Date.now() + seconds * 1000;
    while (!(await page.webContents.executeJavaScript('window.galleryReady === true'))) {
      if (Date.now() > deadline) throw new Error(`The gallery page did not finish drawing within ${seconds} seconds.`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    const image = await page.webContents.capturePage();
    const screenshot = path.join(devState, `gallery-${hash || 'index'}-${Date.now()}.png`);
    fs.writeFileSync(screenshot, image.toPNG());
    return screenshot;
  } finally {
    if (!page.isDestroyed()) page.destroy();
  }
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
    runningControlAction = request.action;
    try {
      if (request.action === 'screenshot') {
        await new Promise(resolve => setTimeout(resolve, 200));
        // Ask the sky island for one fresh frame first, since a covered or hidden window may not be drawing.
        // A missing scene, an error, or a slow answer just means the picture is taken without it.
        const islandDrew = await Promise.race([
          window.webContents.executeJavaScript('Promise.resolve(window.cozyGame?.capture?.()).then(drew => drew === true, () => false)')
            .catch(() => false),
          new Promise(resolve => setTimeout(() => resolve(false), 1500)),
        ]);
        const image = await window.webContents.capturePage();
        const screenshot = path.join(devState, `screenshot-${Date.now()}.png`);
        fs.writeFileSync(screenshot, image.toPNG());
        const renderedPage = await window.webContents.executeJavaScript('document.querySelector("h1")?.textContent || document.querySelector("#today-guidance")?.textContent || ""');
        result = { ok: true, screenshot, renderedPage, islandDrew, status: appStatus() };
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
      } else if (request.action === 'gallery-screenshot') {
        result = { ok: true, screenshot: await galleryScreenshot(request.value), status: appStatus() };
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
        showWindow('the show-window control action'); result = { ok: true, status: appStatus() };
      } else if (request.action === 'close-window') {
        window.hide(); result = { ok: true, status: appStatus() };
      } else {
        if (typeof request.action !== 'string' || request.action.length > 64) throw new Error('Invalid command');
        result = { ok: true, status: await execute(request.action, request.value) };
      }
    } catch (error) { result = { ok: false, error: String(error.message || error), status: appStatus() }; }
    runningControlAction = null;
    fs.writeFileSync(path.join(controlDir, `${request.id}.response`), JSON.stringify(result));
    if (request.action === 'quit') { quitting = true; setTimeout(() => app.quit(), 50); }
  }
}

app.whenReady().then(() => {
  app.dock?.hide();
  core = createCore({ dbPath, statusPath, profile: initialProfile, development, demo });
  activity.setInactiveAfterSeconds(core.status().activityDelaySeconds);
  activity.observe(demo ? 0 : powerMonitor.getSystemIdleTime());
  window = new BrowserWindow({
    width: 1200, height: 900, minWidth: 790, minHeight: 590, show: false,
    title: 'Focus Islands', backgroundColor: '#f4eee4',
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
  // The demo ignores sleep and screen lock: you stay present. Its timer still pauses over a sleep, because it
  // never counts a gap it did not see (see tick() in electron/core/index.js).
  const onPower = (event, handler) => powerMonitor.on(event, () => { if (!demo) handler(); });
  onPower('suspend', () => { const idleSeconds = powerMonitor.getSystemIdleTime(); systemSuspended = true; activity.setUnavailable(true); execute('sleep', idleSeconds); });
  onPower('resume', () => { systemSuspended = false; activity.setUnavailable(screenLocked); execute('wake'); });
  onPower('lock-screen', () => { const idleSeconds = powerMonitor.getSystemIdleTime(); screenLocked = true; activity.setUnavailable(true); execute('lock', idleSeconds); });
  onPower('unlock-screen', () => { screenLocked = false; activity.setUnavailable(systemSuspended); execute('unlock'); });
  setInterval(() => {
    try {
      // The demo always reads as recent input (an agent's activity-sample still wins for its 15 seconds).
      const idleSeconds = development && Date.now() < activityOverrideUntil
        ? activityOverrideSeconds : demo ? 0 : powerMonitor.getSystemIdleTime();
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
      if (process.argv.includes('--background-window')) {
        // showInactive() leaves the keyboard alone but stacks the window above every other app's windows, where the
        // user's next click lands on it and makes it active. On macOS, blur() moves it behind all of them.
        window.showInactive();
        window.blur();
      } else window.show();
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
