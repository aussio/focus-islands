// The scene without a renderer: world, mood, town, helpers, stage and camera. index.js wraps it with
// WebGL and the drawing loop; the Node test drives it directly.
//
// The world is a town (town/shape.js, from town/index.js buildTown). Each island is its own group,
// rebuilt only when its own part of the world changes (scene/town/build.js). The camera aims at
// view.island and moves there slowly when a new world asks it to look somewhere else (stage.aim). Between
// check-ins it drifts: slow trips to the whole group and to each other island, and back (drift.js).
// Anything that isn't a town world (a missing or broken world, or one with no islands) draws as an
// empty sky.
import { MOODS, moodOf, createMaterials, moodMaterials } from './style.js';
import { TOP, createStage, fitView, pixelsPerUnit } from './stage.js';
import { createActors } from './actors.js';
import { isTownWorld, parseTown } from './town/world.js';
import { createTownBuilder } from './town/build.js';
import { townKey } from '../town/shape.js';

const HELPER_MIN_PX = 18; // a helper should stand at least this tall on screen
const TOWN_MAX_BOOST = 1.4; // the town frames closer instead of growing helpers past this
const HELPER_HEIGHT = 0.4; // a helper's height in world units at scale 1
const CLOSE_STEPS = 4; // the close view keeps this many grid steps around view.points
const EMPTY = 'empty'; // the key of the empty sky
const SKY_POINTS = [[-2, 0, -2], [2, 0, -2], [-2, 0, 2], [2, 0, 2]]; // what the camera frames with nothing to show
// Pixels kept clear of the town across the top of the picture, where Today's resource bar sits (about 60
// to 70 px tall). The picture's own top margin already keeps about 25 px of a 357 px picture clear.
export const CLEAR_TOP = 64;
const LOWEST_TOP = 0.3; // however tall the band, the town keeps at least this much of the frame's top half

// A text key for a world; one that can't be written down gets a key of its own, so it is always built.
function keyOf(world) {
  if (!isTownWorld(world)) return EMPTY;
  try { return townKey(world); } catch { return `unkeyed:${Math.random()}`; }
}

// now: a clock in milliseconds (camera moves, the drift and rebuild timing). log: a Map for the town's
// piece logs. clearTop: pixels kept clear across the top (CLEAR_TOP).
export function createSceneCore({ now, log = null, clearTop = CLEAR_TOP } = {}) {
  const materials = createMaterials();
  const stage = createStage(now ? { now } : {});
  const actors = createActors(stage.scene);
  let model = null, key = null, mood = 'focus';
  let town = null; // the town builder, made on the first world
  let lastReport = null;
  let size = [591, 357];
  let changed = true; // the shadow map and still frame need redrawing

  // The camera (decision 6). It frames view.island whole if helpers there stay at least 18 px tall with a
  // boost of at most 1.4; otherwise view.points and 4 steps around them. ease: move there slowly.
  // Between check-ins it drifts (stage.aim's wide and others): out to the whole group, to each other
  // island framed whole, and back. restart: start the drift again from its rest (false on a resize).
  let aimed = null;
  const aim = (ease = false, { restart = true } = {}) => {
    if (!town || !model) return;
    const aspect = size[0] / Math.max(1, size[1]);
    const top = Math.max(LOWEST_TOP, Math.min(TOP, 1 - 2 * clearTop / Math.max(1, size[1])));
    const boostAt = points => HELPER_MIN_PX / Math.max(1e-3, HELPER_HEIGHT * pixelsPerUnit(fitView(points, aspect, { top }).distance, size[1]));
    const view = model.view;
    const id = view.island ?? model.islands[0]?.id ?? null;
    let points = id ? town.framePoints(id) : [];
    if (!view.island) points = model.islands.flatMap(i => town.framePoints(i.id));
    if (!points.length) points = SKY_POINTS;
    let boost = boostAt(points);
    let close = false;
    if (view.island && boost > TOWN_MAX_BOOST) {
      const near = town.closePoints(view.island, view.ids.length ? view.ids : [town.islands.get(view.island)?.island.plaza].filter(p => p >= 0), CLOSE_STEPS);
      if (near.length) { points = near; boost = boostAt(points); close = true; }
    }
    actors.setScale(Math.min(TOWN_MAX_BOOST, Math.max(1, boost)));
    const others = model.islands.filter(i => i.id !== id).map(i => town.framePoints(i.id)).filter(list => list.length);
    const wide = model.islands.flatMap(i => town.framePoints(i.id));
    stage.aim(points, aspect, { ease: ease && Boolean(aimed), land: id ? town.landSpots(id) : [], top, wide, others, restart });
    aimed = { island: id, close, points: points.length, top };
    changed = true;
  };

  // Helpers walk on the town grid (scene/town/walk.js). If planning fails, the town still shows and the
  // helpers just stand.
  const planActors = () => {
    if (!model) return;
    const lift = model.byId.get(model.view.island)?.lift ?? 0;
    try {
      actors.plan(model, mood, { bottomY: lift - 1.5 });
    } catch (error) {
      console.error('Island helpers could not plan:', error);
    }
  };

  const applyMood = () => {
    stage.setMood(mood);
    moodMaterials(materials, mood);
    town?.applyMood(mood, MOODS[mood]);
    planActors();
    changed = true;
  };

  return {
    scene: stage.scene,
    camera: stage.camera,
    stage,
    get model() { return model; },
    get mood() { return mood; },
    get actors() { return actors; },
    get town() { return town; },
    get aimed() { return aimed; },
    // True once a world (even an empty sky) has been set.
    get hasWorld() { return Boolean(model); },
    // What the last setWorld rebuilt: { rebuilt, moved, kept, removed, bridges, ms, islandMs }.
    get lastReport() { return lastReport; },
    // True once after anything that needs the shadows or a still frame redrawn.
    takeChanged() { const was = changed; changed = false; return was; },
    // Rebuilds only what changed. Returns false when the world is the same as before.
    // ease: move the camera slowly if it should look somewhere new. The page passes false while hidden or
    // with reduced motion.
    setWorld(world, { ease = true } = {}) {
      const next = keyOf(world);
      if (next === key) return false;
      key = null; // until it is built, so trying the same world again builds it again
      model = parseTown(next === EMPTY ? null : world);
      town ??= createTownBuilder(stage.scene, materials, { log });
      lastReport = town.update(model);
      key = next;
      actors.setWorld(model);
      aim(ease);
      applyMood();
      return true;
    },
    setMood(next) {
      const name = moodOf(next);
      if (name === mood && model) return false;
      mood = name;
      applyMood();
      return true;
    },
    resize(width, height) {
      if (width === size[0] && height === size[1]) return false;
      size = [width, height];
      if (town && model) aim(false, { restart: false });
      else { stage.camera.aspect = width / Math.max(1, height); stage.camera.updateProjectionMatrix(); }
      return true;
    },
    // Finishes a check-in move at once (before a capture, or when the page is hidden). The drift goes on.
    settle() { return stage.settle(); },
    get moving() { return stage.moving; },
    // How the camera behaves between check-ins: drift (default), sway or still (stage.js CAMERA_STYLES).
    get cameraStyle() { return stage.style; },
    set cameraStyle(style) { stage.style = style; },
    // Pixels kept clear across the top of the picture. A change frames again at once.
    get clearTop() { return clearTop; },
    set clearTop(pixels) {
      const next = Math.max(0, Number(pixels) || 0);
      if (next === clearTop) return;
      clearTop = next;
      if (town && model) aim(false, { restart: false });
    },
    // Builds every island and bridge again (after a lost drawing context comes back).
    rebuild() {
      if (!town || !model) return false;
      lastReport = town.rebuildAll(model);
      applyMood();
      return true;
    },
    // Moves helpers, the few living details and the camera's drift. still: everyone stands at their spot,
    // nothing moves, and the camera stays on the busy view.
    update(t, still = false) {
      const time = still ? 0 : t;
      actors.update(time, still);
      town?.animate(time);
      stage.update(time, still);
      // The shadow box stepped with the view: the shadow map needs drawing again.
      if (stage.takeShadowMoved()) changed = true;
    },
    // Triangles and meshes in the static island groups (helpers and sky not counted).
    stats() { return town ? { ...town.stats(), rebuildMs: lastReport?.ms ?? 0, islandMs: lastReport?.islandMs ?? {} } : null; },
    dispose() {
      actors.dispose();
      town?.dispose();
      town = null;
      aimed = null;
      stage.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
