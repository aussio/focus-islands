// Page glue for the sky island, built as electron/renderer/game.js and loaded before app.js.
//
//   window.focusIslandsGame = { mount(host), show({ game, mood, profile }), capture() }
//
// - mount(host) remembers the island slot. The scene itself starts on the first show() that has a game,
//   so until then (and whenever anything fails) the slot keeps its plain CSS sky.
// - show() lays the town out again (town/index.js buildTown) only when game.change (or the profile) moves,
//   and changes the mood only when it changes.
// - capture() asks the scene for one fresh frame and resolves true when it drew one, false otherwise.
// Nothing here ever throws into the page.
import { buildTown } from './town/index.js';
import { createIslandScene } from './scene/index.js';

let host = null, stage = null, scene = null, failed = false;
let shownChange, shownMood = null, wanted = { game: null, mood: 'focus', profile: '' };

const report = (what, error) => { try { console.error(`Sky island: ${what}`, error); } catch { /* ignore */ } };

function stop() {
  try { scene?.dispose(); } catch (error) { report('could not stop the scene.', error); }
  try { stage?.remove(); } catch { /* ignore */ }
  scene = stage = null;
  shownChange = undefined;
  shownMood = null;
}

// The scene gets its own box that fills the slot, so the canvas size never feeds back into the page layout.
function start() {
  if (scene || failed || !host) return Boolean(scene);
  try {
    stage = host.ownerDocument.createElement('div');
    stage.className = 'focus-islands-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    host.appendChild(stage);
    scene = createIslandScene(stage);
    return true;
  } catch (error) {
    report('the scene could not start; keeping the plain sky.', error);
    failed = true;
    stop();
    return false;
  }
}

function apply() {
  const { game, mood, profile } = wanted;
  if (!host) return;
  if (!game) { if (scene) stop(); return; }
  if (!start()) return;
  // game.change is the saved order of the newest game record in one database. The profile is part of the
  // key because Personal and Testing are separate databases that can sit at the same saved order.
  const change = `${profile}:${game.change}`;
  if (change !== shownChange) {
    shownChange = change;
    try {
      scene.setWorld(buildTown(game));
    } catch (error) {
      // Keep whatever was drawn before; try again when the game changes.
      report('could not lay out the town.', error);
    }
  }
  if (mood !== shownMood) {
    try { scene.setMood(mood); } catch (error) { report('could not change the mood.', error); }
    shownMood = mood;
  }
}

window.focusIslandsGame = {
  mount(target) {
    try {
      if (!target || host === target) return;
      if (host) stop();
      host = target;
      apply();
    } catch (error) { report('could not mount.', error); }
  },
  show({ game = null, mood = 'focus', profile = '' } = {}) {
    try {
      wanted = { game: game && typeof game === 'object' && Array.isArray(game.islands) ? game : null, mood, profile: String(profile ?? '') };
      apply();
    } catch (error) { report('could not show the island.', error); }
  },
  capture() {
    try {
      if (!scene) return Promise.resolve(false);
      return Promise.resolve(scene.capture()).then(canvas => Boolean(canvas), () => false);
    } catch { return Promise.resolve(false); }
  },
};
