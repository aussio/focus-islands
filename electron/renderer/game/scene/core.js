// The scene without a renderer: world, mood, island, helpers, stage and camera. index.js wraps it with
// WebGL and the drawing loop; the Node test drives it directly.
import { MOODS, moodOf, createMaterials, moodMaterials } from './style.js';
import { parseWorld, worldKey } from './world.js';
import { buildIsland } from './build.js';
import { createStage } from './stage.js';
import { createActors } from './actors.js';

const HELPER_MIN_PX = 18; // a helper should stand at least this tall on screen
const HELPER_MAX_BOOST = 1.7;

export function createSceneCore() {
  const materials = createMaterials();
  const stage = createStage();
  const actors = createActors(stage.scene);
  let model = null, island = null, key = null, mood = 'focus';
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

  const applyMood = () => {
    stage.setMood(mood);
    moodMaterials(materials, mood);
    if (island) for (const hook of island.moodHooks) hook(mood, MOODS[mood]);
    if (model) actors.plan(model, mood, { bottomY: island?.bottomY });
    changed = true;
  };

  return {
    scene: stage.scene,
    camera: stage.camera,
    get model() { return model; },
    get mood() { return mood; },
    get actors() { return actors; },
    get hasWorld() { return Boolean(island); },
    // True once after anything that needs the shadows or a still frame redrawn.
    takeChanged() { const was = changed; changed = false; return was; },
    setWorld(world) {
      const next = worldKey(world);
      if (next === key) return false;
      key = next;
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
      if (!island) { stage.camera.aspect = width / Math.max(1, height); stage.camera.updateProjectionMatrix(); }
      return true;
    },
    // Moves helpers and the few living details. still: everyone stands at their spot, nothing moves.
    update(t, still = false) {
      const time = still ? 0 : t;
      actors.update(time, still);
      if (island) for (const fn of island.dynamic) fn(time);
      stage.update(time);
    },
    dispose() {
      actors.dispose();
      island?.dispose();
      island = null;
      stage.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
