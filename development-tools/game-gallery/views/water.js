// Waterfalls (scene/town/water.js) and the small house looks in scene/town/blocks.js: window boxes,
// chimney nests and chimney smoke. Look only: nothing is saved, the same id always shows the same look.
// Never ships.
//
//   #water-sway     the real scene at Today's size, at both ends of the camera's sway, by day
//   #water-close    close-ups of waterfalls from both ends of the sway and from the south, by day and at dusk
//   #water-houses   houses at dusk: at the real chances, and with every look switched on, in break and done
//
// Moving parts are held at fixed scene times, so the pictures repeat exactly.
import * as THREE from 'three';
import { createSceneCore } from '../../../electron/renderer/game/scene/core.js';
import { SWAY, driftPose, swayYaw } from '../../../electron/renderer/game/scene/drift.js';
import { Batch } from '../../../electron/renderer/game/scene/ground.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { buildGround } from '../../../electron/renderer/game/scene/town/ground.js';
import { buildLanes } from '../../../electron/renderer/game/scene/town/lanes.js';
import { LOOKS, SMOKE, buildBlocks, hasLook, planRoofs } from '../../../electron/renderer/game/scene/town/blocks.js';
import { buildThings } from '../../../electron/renderer/game/scene/town/pads.js';
import { hasWaterfall, waterfallSpot } from '../../../electron/renderer/game/scene/town/water.js';

const TODAY = [591, 357];
const CLOSE = [420, 330];
const HOUSES = [660, 420];
const TIME = 6; // scene seconds the moving parts are held at
const END = SWAY.degrees * Math.PI / 180;

// ---------- Finding states and islands ----------
const steadyDay = (tools, day) => tools.data.town.states.find(s => s.person === 'steady' && s.day === day && s.world?.islands?.some(i => i.grid));
function islandOf(tools, day, id) {
  const entry = steadyDay(tools, day);
  if (!entry) return null;
  const model = parseTown(entry.world);
  const island = model.byId.get(id);
  return island ? { model, island, day } : null;
}
// The island's waterfall spot, found the way buildGround finds it (a throwaway ground, nothing drawn).
function spotOf(island) {
  const ctx = { batch: new Batch(), add() {}, piece() {}, root: new THREE.Group(), dynamic: [], onMood() {}, track() {} };
  const { loop } = buildGround(ctx, island);
  ctx.root.traverse(node => node.geometry?.dispose?.());
  return hasWaterfall(island) ? waterfallSpot(island, loop) : null;
}
// The whole island, as Today draws it (scene/town/build.js buildTownIsland, without the group's place).
function drawIsland(ctx, island) {
  buildGround(ctx, island);
  buildLanes(ctx, island);
  buildBlocks(ctx, island);
  buildThings(ctx, island, island.things);
}
const withLooks = async (looks, fn) => {
  const saved = { ...LOOKS };
  Object.assign(LOOKS, looks);
  try { return await fn(); } finally { Object.assign(LOOKS, saved); }
};

// ---------- The real scene, held at one moment of the sway ----------
let own = null;
function ownRenderer() {
  if (own) return own;
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  own = renderer;
  return own;
}
async function swayShots(tools, day, moods = ['focus']) {
  const entry = steadyDay(tools, day);
  if (!entry) { tools.note(`No steady state for day ${day}.`); return; }
  const clock = { ms: 0 };
  const core = createSceneCore({ now: () => clock.ms });
  const renderer = ownRenderer();
  try {
    core.resize(TODAY[0], TODAY[1]);
    renderer.setSize(TODAY[0], TODAY[1], false);
    core.setWorld(entry.world, { ease: false });
    const route = core.stage.route;
    const atHome = s => !route || driftPose(route, s) === route.home;
    const find = sign => { for (let s = 0; s < 20000; s += 0.5) if (Math.abs(swayYaw(s) - sign * END) < 1e-6 && atHome(s)) return s; return null; };
    const view = core.model.view.island ?? core.model.islands[0]?.id;
    const falls = core.model.islands.filter(i => hasWaterfall(i)).map(i => i.id).join(', ') || 'none';
    const images = [];
    for (const sign of [-1, 1]) for (const mood of moods) {
      const seconds = find(sign);
      if (seconds === null) continue;
      core.setMood(mood);
      clock.ms = seconds * 1000;
      core.update(seconds);
      core.town.animate(TIME); // the water and smoke held still
      renderer.shadowMap.needsUpdate = true;
      renderer.render(core.scene, core.camera);
      const img = document.createElement('img');
      img.width = TODAY[0]; img.height = TODAY[1];
      img.src = renderer.domElement.toDataURL('image/png');
      await new Promise(resolve => { img.onload = img.onerror = resolve; });
      images.push(img);
    }
    tools.grid('gallery-today').append(tools.card(`steady, day ${day}: view on ${view}`, `left: turned right ${SWAY.degrees}° (camera to the west) · right: turned left ${SWAY.degrees}° (camera to the east) · ${moods.join(' · ')} · islands with a waterfall: ${falls}`, images));
  } finally { core.dispose(); }
}

// ---------- Close-ups ----------
async function closeUps(tools, day, id, mood) {
  const found = islandOf(tools, day, id);
  if (!found) { tools.note(`No ${id} on day ${day}.`); return; }
  const { model, island } = found;
  const spot = spotOf(island);
  if (!spot) { tools.note(`Day ${day} ${id} (${island.kind}) has no waterfall.`); return; }
  const aim = [[spot.x - 1.6, 0.3, spot.z - 1.2], [spot.x + 1.6, 0.3, spot.z - 1.2], [spot.x - 1.2, -1.6, spot.z + 0.4], [spot.x + 1.2, -1.6, spot.z + 0.4]];
  const images = [];
  for (const yaw of [-END, 0, END]) images.push(await tools.shot(ctx => drawIsland(ctx, island), { width: CLOSE[0], height: CLOSE[1], mood, aim, yaw, time: TIME, model, island }));
  const later = await tools.shot(ctx => drawIsland(ctx, island), { width: CLOSE[0], height: CLOSE[1], mood, aim, yaw: 0, time: TIME + 2.5, model, island });
  images.push(later);
  tools.grid('gallery-wide').append(tools.card(`day ${day}, ${id} (${island.kind}), ${mood}`,
    `camera turned ${SWAY.degrees}° west · from the south · ${SWAY.degrees}° east (all at ${TIME} s) · from the south 2.5 s later (the streaks have slid down, the mist has sunk) · `
    + `spot ${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}, ${Math.round(spot.bearing * 180 / Math.PI)}° from south`, images));
}

// ---------- Houses ----------
// Block points of the island near its first smoking (or, with every look on, nesting) chimney.
function houseAim(island, look) {
  const { chimneys } = planRoofs(island);
  const s = [...chimneys.keys()].find(p => hasLook(look, island.id, p)) ?? [...chimneys.keys()][0] ?? [...island.floors.keys()][0];
  const [x, z] = island.grid.points[s];
  const near = [...island.floors.keys()].map(p => island.grid.points[p]).filter(([px, pz]) => Math.hypot(px - x, pz - z) < 1.6);
  return near.map(([px, pz]) => [px, 1.6, pz]).concat(near.map(([px, pz]) => [px, 0, pz]));
}
async function houseShots(tools, day, id, looks, label) {
  const found = islandOf(tools, day, id);
  if (!found) { tools.note(`No ${id} on day ${day}.`); return; }
  const { model, island } = found;
  await withLooks(looks, async () => {
    const aim = houseAim(island, LOOKS.nest >= 1 ? 'nest' : 'smoke');
    const images = [];
    for (const mood of ['break', 'done', 'focus']) images.push(await tools.shot(ctx => drawIsland(ctx, island), { width: HOUSES[0], height: HOUSES[1], mood, aim, time: TIME, model, island }));
    const { chimneys } = planRoofs(island);
    const nests = [...chimneys.keys()].filter(p => hasLook('nest', island.id, p)).length;
    const smoking = [...chimneys.keys()].filter(p => !hasLook('nest', island.id, p) && hasLook('smoke', island.id, p)).length;
    tools.grid('gallery-wide').append(tools.card(`day ${day}, ${id}: ${label}`,
      `break · done · focus (no smoke by day), at ${TIME} s · chances: boxes ${LOOKS.box}, nests ${LOOKS.nest.toFixed(2)}, smoke ${LOOKS.smoke.toFixed(2)} · `
      + `${chimneys.size} chimneys here: ${nests} with a nest, ${Math.min(smoking, SMOKE.chimneys)} smoking`, images));
  });
}

export default {
  id: 'water',
  title: 'Waterfalls and house details: window boxes, chimney nests, chimney smoke',
  sections: [
    {
      id: 'sway', title: 'Waterfalls in the real scene at Today\'s size, at both ends of the sway',
      async render(host, tools) {
        tools.note(`Islands with a pond or a rain catcher, and mossy and misty islands, pour a waterfall off the south side. The camera sways up to ${SWAY.degrees}° each way; these are its two ends, with the water held at ${TIME} s.`);
        for (const day of [7, 21, 180]) await swayShots(tools, day);
      },
    },
    {
      id: 'close', title: 'Close-ups from both ends of the sway, by day and at dusk',
      async render(host, tools) {
        await closeUps(tools, 21, 'home', 'focus');
        await closeUps(tools, 180, 'isle-1', 'break');
      },
    },
    {
      id: 'houses', title: 'Houses: window boxes, chimney nests and smoke',
      async render(host, tools) {
        tools.note('Window boxes come on about 1 in 4 windows, nests on about 1 in 6 chimneys, and about 3 in 5 chimneys without a nest smoke in the evening moods.');
        await houseShots(tools, 180, 'home', {}, 'the real chances');
        await houseShots(tools, 180, 'home', { box: 1, nest: 0.5, smoke: 1 }, 'every look switched on (half the chimneys nest)');
      },
    },
  ],
};
