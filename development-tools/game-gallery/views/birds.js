// Bird arrival appearance and held flight; uses the production visitor and real islands.
import * as THREE from 'three';
import { createBird } from '../../../electron/renderer/game/scene/models/bird.js';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { P } from '../../../electron/renderer/game/scene/style.js';
import { createSceneCore } from '../../../electron/renderer/game/scene/core.js';
import { loopOwner, LOOP } from '../../../electron/renderer/game/scene/calm.js';
import { buildTown } from '../../../electron/renderer/game/town/index.js';

// The start of the first loop that is the bird's turn on an island (calm.js).
const birdLoop = island => { for (let n = 1; ; n++) if (loopOwner(island, n) === 'bird') return n * LOOP; };

// The normal scene at Today's size. times: scene clock steps; the last one is drawn.
async function todayShot(world, mood, times) {
  const core = createSceneCore({ now: () => 0 });
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(591, 357, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  try {
    core.resize(591, 357); core.cameraStyle = 'still'; core.setWorld(world, { ease: false }); core.setMood(mood);
    for (const time of times) core.update(time, time === 0);
    renderer.render(core.scene, core.camera);
    const image = document.createElement('img'); image.src = renderer.domElement.toDataURL('image/png'); image.width = 591; image.height = 357; await image.decode();
    return image;
  } finally { core.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
}

export default {
  id: 'birds', title: 'Quiet bird visitor', sections: [{
    id: 'review', title: 'Perched and in flight', async render(host, tools) {
      const row = tools.grid();
      const close = await tools.shot(ctx => {
        ctx.add(new THREE.BoxGeometry(0.7, 0.05, 0.4), 'matte', P.grass, place(0, -0.025, 0), null, false);
        for (const [i, flying] of [0, 1].entries()) {
          const bird = createBird(); bird.pose(37.1, flying); bird.root.position.x = -0.18 + 0.36 * i;
          ctx.root.add(bird.root); ctx.track(bird);
        }
      }, { width: 450, height: 230, aim: [[-0.4, 0, -0.3], [0.4, 0.4, 0.3]] });
      row.append(tools.card('Silhouette', 'Perched · flying', [close]));
      const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === 1);
      if (!entry) return;
      const world = buildTown({ ...entry.game, visitor: { kind: 'bird', island: 'home' } });
      const sceneRow = tools.grid();
      // It flies only in break, on its own turn: 37 seconds into the bird's loop is mid-flight.
      const base = birdLoop('home');
      sceneRow.append(tools.card('Quiet perch', 'focus · Today size', [await todayShot(world, 'focus', [0])]));
      sceneRow.append(tools.card('Brief flight', 'break · its turn · Today size', [await todayShot(world, 'break', [base + 0.5, base + 37])]));
    },
  }, {
    id: 'big', title: 'Big islands at Today size', async render(host, tools) {
      tools.note('Today frames a big island close around its busy spots. The bird perches inside that picture: on a tree there, else a roof there, else anywhere on the island.');
      const row = tools.grid();
      for (const [person, day] of [['steady', 180], ['long', 180], ['irregular', 180]]) {
        const entry = tools.data.town.states.find(s => s.person === person && s.day === day && s.game);
        if (!entry) { tools.note(`Missing gallery fixture for ${person} day ${day}.`); continue; }
        const island = buildTown(entry.game).view?.island ?? 'home';
        const world = buildTown({ ...entry.game, visitor: { kind: 'bird', island } });
        row.append(tools.card(`${person} day ${day}`, `focus · perched on ${island} · Today size`, [await todayShot(world, 'focus', [0])]));
      }
    },
  }],
};
