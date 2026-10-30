// The set of helpers in the town: builds their figures, plans their routines for a mood (on the town
// grid, scene/town/walk.js), and moves them each frame. The helpers hold nothing worth keeping: a new
// plan or a fresh clock restarts them.
import * as THREE from 'three';
import { lookFor } from './style.js';
import { buildHelper, helperMaterials, restExtras, HELPER_SCALE } from './helpers.js';
import { planHelpers } from './town/walk.js';
import { driveHelper } from './motion.js';

export function createActors(scene) {
  const group = new THREE.Group();
  group.name = 'helpers';
  scene.add(group);
  let M = helperMaterials();
  let rigs = [], plans = [], extras = null, scale = 1;

  const clearRigs = () => {
    extras?.dispose();
    extras = null;
    for (const rig of rigs) {
      rig.root.removeFromParent();
      rig.root.traverse(node => { if (node.isMesh && node.geometry && !rig.shared.has(node.geometry)) node.geometry.dispose(); });
    }
    rigs = [];
    plans = [];
  };

  return {
    group,
    get rigs() { return rigs; },
    get plans() { return plans; },
    setWorld(model) {
      clearRigs();
      M.dispose();
      M = helperMaterials();
      rigs = model.helpers.map((helper, index) => {
        const rig = buildHelper(lookFor(helper, index), M);
        rig.seed = index * 1.7;
        rig.shared = new Set();
        rig.root.traverse(node => { if (node.isMesh && node.geometry?.userData.shared) rig.shared.add(node.geometry); });
        rig.root.scale.setScalar(HELPER_SCALE * scale);
        group.add(rig.root);
        return rig;
      });
    },
    // Plans routines for the mood, for parseTown's model. bottomY: how far a fishing line hangs when a plan
    // doesn't say (walk.js gives each fishing plan its own, from its island's lift). If planning throws,
    // the helpers are left standing with no plan.
    plan(model, mood, { bottomY = -1.5 } = {}) {
      extras?.dispose();
      extras = null;
      plans = [];
      plans = planHelpers(model, mood);
      extras = restExtras(group, rigs, plans, { bottomY });
    },
    setScale(k) {
      scale = k;
      for (const rig of rigs) rig.root.scale.setScalar(HELPER_SCALE * k);
    },
    update(t, still = false) {
      rigs.forEach((rig, index) => driveHelper(rig, plans[index]?.line, t, { still: still || Boolean(plans[index]?.still) }));
      extras?.update(still ? 0 : t);
    },
    dispose() {
      clearRigs();
      M.dispose();
      group.removeFromParent();
    },
  };
}
