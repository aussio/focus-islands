// The scene without a renderer: world, mood, island, helpers, stage and camera. index.js wraps it with
// WebGL and the drawing loop; the Node test drives it directly.
//
// Two ways to draw, picked by the world's shape:
// - square (the square layout's world, on Today until stage 2): one island model, framed once.
// - town (a world whose islands carry a grid, town/shape.js): each island is its own group, rebuilt only
//   when its own part of the world changes (scene/town/build.js). The camera aims at view.island and
//   moves there slowly when a new world asks it to look somewhere else (stage.aim).
import { MOODS, moodOf, createMaterials, moodMaterials } from './style.js';
import { parseWorld, worldKey } from './world.js';
import { buildIsland } from './build.js';
import { createStage, fitView, pixelsPerUnit } from './stage.js';
import { createActors } from './actors.js';
import { isTownWorld, parseTown } from './town/world.js';
import { createTownBuilder } from './town/build.js';
import { planHelpers as planTownHelpers } from './town/walk.js';
import { townKey } from '../town/shape.js';

const HELPER_MIN_PX = 18; // a helper should stand at least this tall on screen
const HELPER_MAX_BOOST = 1.7;
const TOWN_MAX_BOOST = 1.4; // the town frames closer instead of growing helpers past this
const HELPER_HEIGHT = 0.4; // a helper's height in world units at scale 1
const CLOSE_STEPS = 4; // the close view keeps this many grid steps around view.points

// now: a clock in milliseconds (camera moves and rebuild timing). log: a Map for the town's piece logs.
export function createSceneCore({ now, log = null } = {}) {
  const materials = createMaterials();
  const stage = createStage(now ? { now } : {});
  const actors = createActors(stage.scene);
  let model = null, island = null, key = null, mood = 'focus';
  let town = null; // the town builder, while a town world is shown
  let lastReport = null;
  let size = [591, 357];
  let changed = true; // the shadow map and still frame need redrawing

  const reframe = () => {
    if (!island) return;
    const fit = stage.frame(island.framePoints, size[0] / Math.max(1, size[1]), island.landSpots);
    // Keep helpers readable: if the world is so big that they would shrink to specks, grow them a little.
    const pxPerUnit = size[1] / (2 * fit.distance * Math.tan(stage.camera.fov * Math.PI / 360));
    const helperPx = 0.4 * pxPerUnit;
    actors.setScale(Math.min(HELPER_MAX_BOOST, Math.max(1, HELPER_MIN_PX / Math.max(1e-3, helperPx))));
    changed = true;
  };

  // The town camera (decision 6). It frames view.island whole if helpers there stay at least 18 px tall
  // with a boost of at most 1.4; otherwise view.points and 4 steps around them. ease: move there slowly.
  let aimed = null;
  const aimTown = (ease = false) => {
    if (!town || !model) return;
    const aspect = size[0] / Math.max(1, size[1]);
    const boostAt = points => HELPER_MIN_PX / Math.max(1e-3, HELPER_HEIGHT * pixelsPerUnit(fitView(points, aspect).distance, size[1]));
    const view = model.view;
    const id = view.island ?? model.islands[0]?.id ?? null;
    let points = id ? town.framePoints(id) : [];
    if (!view.island) points = model.islands.flatMap(i => town.framePoints(i.id));
    if (!points.length) points = [[-2, 0, -2], [2, 0, -2], [-2, 0, 2], [2, 0, 2]];
    let boost = boostAt(points);
    let close = false;
    if (view.island && boost > TOWN_MAX_BOOST) {
      const near = town.closePoints(view.island, view.ids.length ? view.ids : [town.islands.get(view.island)?.island.plaza].filter(p => p >= 0), CLOSE_STEPS);
      if (near.length) { points = near; boost = boostAt(points); close = true; }
    }
    actors.setScale(Math.min(TOWN_MAX_BOOST, Math.max(1, boost)));
    stage.aim(points, aspect, { ease: ease && Boolean(aimed), land: id ? town.landSpots(id) : [] });
    aimed = { island: id, close, points: points.length };
    changed = true;
  };

  const planActors = () => {
    if (!model) return;
    if (!model.town) { actors.plan(model, mood, { bottomY: island?.bottomY }); return; }
    const lift = model.byId.get(model.view.island)?.lift ?? 0;
    try {
      // ASK (stream D, actors.js): use options.planner when given, so the town's helpers walk on the grid.
      actors.plan(model, mood, { bottomY: lift - 1.5, planner: planTownHelpers });
    } catch {
      // Today's actors plan with the square routes, which can't read a town. Helpers stand still until
      // actors.js takes the planner.
    }
  };

  const applyMood = () => {
    stage.setMood(mood);
    moodMaterials(materials, mood);
    if (island) for (const hook of island.moodHooks) hook(mood, MOODS[mood]);
    town?.applyMood(mood, MOODS[mood]);
    planActors();
    changed = true;
  };

  const leaveTown = () => {
    town?.dispose();
    town = null;
    aimed = null;
  };

  // A town world: rebuild only what changed, then aim (easing only when it has aimed before).
  const setTown = (world, ease) => {
    const next = townKey(world);
    if (next === key) return false;
    island?.dispose();
    island = null;
    model = parseTown(world);
    town ??= createTownBuilder(stage.scene, materials, { log });
    key = null; // until it is built, so trying the same world again builds it again
    lastReport = town.update(model);
    key = next;
    actors.setWorld(model);
    aimTown(ease);
    applyMood();
    return true;
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
    get hasWorld() { return Boolean(island || town); },
    // What the last setWorld rebuilt (town only): { rebuilt, moved, kept, removed, bridges, ms, islandMs }.
    get lastReport() { return lastReport; },
    // True once after anything that needs the shadows or a still frame redrawn.
    takeChanged() { const was = changed; changed = false; return was; },
    // ease (town only): move the camera slowly if it should look somewhere new. The page passes false
    // while hidden or with reduced motion.
    setWorld(world, { ease = true } = {}) {
      if (isTownWorld(world)) return setTown(world, ease);
      const next = worldKey(world);
      if (next === key) return false;
      key = next;
      leaveTown();
      island?.dispose();
      island = null;
      model = parseWorld(world ?? {});
      island = buildIsland(model, materials);
      stage.scene.add(island.root);
      actors.setWorld(model);
      reframe();
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
      reframe();
      if (town) aimTown(false);
      if (!island && !town) { stage.camera.aspect = width / Math.max(1, height); stage.camera.updateProjectionMatrix(); }
      return true;
    },
    // Finishes any camera move at once (before a capture, or when the page is hidden).
    settle() { return stage.settle(); },
    get moving() { return stage.moving; },
    // Builds every town island and bridge again (after a lost drawing context comes back).
    rebuild() {
      if (!town || !model) return false;
      lastReport = town.rebuildAll(model);
      applyMood();
      return true;
    },
    // Moves helpers and the few living details. still: everyone stands at their spot, nothing moves.
    update(t, still = false) {
      const time = still ? 0 : t;
      actors.update(time, still);
      if (island) for (const fn of island.dynamic) fn(time);
      town?.animate(time);
      stage.update(time);
    },
    // Triangles and meshes in the static island groups (town only; helpers and sky not counted).
    stats() { return town ? { ...town.stats(), rebuildMs: lastReport?.ms ?? 0, islandMs: lastReport?.islandMs ?? {} } : null; },
    dispose() {
      actors.dispose();
      island?.dispose();
      island = null;
      leaveTown();
      stage.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
