// The rare looks: look-only surprises on trees, rocks, mushrooms, crystals, flower spots and windmills,
// each picked from the thing's own id (RARE in scene/models/nature.js; the windmill's sails in
// models/making.js). Nothing is saved: the same id always shows the same look. Never ships.
//
//   #variety                 every section
//   #variety-trees           plain, blossom, autumn, a nest in a round tree and in a pine
//   #variety-rocks           plain, moss cap, tiny round door, both
//   #variety-mushrooms       red, blue, glowing (by day and at night), fairy rings
//   #variety-flowers         daisies, two and three sunflowers, a bird bath, with a bird sitting and dipping
//   #variety-crystals        crystals (normal and rose) and windmills (white and striped sails)
//   #variety-today           every look in two rows at Today's size, with a helper standing 18 px tall
//
// Each card finds its id by counting through ids shaped like the real ones (home:decor-11, isle-1:decor-14,
// ...; b1, b2, ... for windmills) until one has the look, so every look always shows. The ground is a
// simple grass stand-in, not the real island.
import * as THREE from 'three';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { P, TOWN, lookFor } from '../../../electron/renderer/game/scene/style.js';
import { MODELS } from '../../../electron/renderer/game/scene/models/index.js';
import { RARE, birdTilt, lookRoll, rare } from '../../../electron/renderer/game/scene/models/nature.js';
import { modelScale } from '../../../electron/renderer/game/scene/town/pads.js';
import { buildHelper, helperMaterials } from '../../../electron/renderer/game/scene/helpers.js';
import { fitView, pixelsPerUnit } from '../../../electron/renderer/game/scene/stage.js';

const SIZE = [260, 220];
const QUARTER = Math.PI / 2;
const ISLANDS = ['home', 'isle-1', 'isle-2', 'isle-3', 'isle-4', 'isle-5'];
const decorId = n => `${ISLANDS[n % ISLANDS.length]}:decor-${Math.floor(n / ISLANDS.length) * 3 + 11}`;
const buildingId = n => `b${n + 1}`;
const has = (id, look) => rare({ id }, look);
const pine = id => lookRoll({ id }, 'pine') < 0.3;
const oneIn = look => `about 1 in ${Math.round(1 / RARE[look])}`;

// The skip-th id (counting up) that passes test.
function findId(test, { make = decorId, skip = 0 } = {}) {
  for (let n = 0, found = 0; n < 50000; n++) if (test(make(n)) && found++ === skip) return make(n);
  return null;
}

// What each card shows: a kind, an id with the look, and how often the look comes up.
const LOOKS = {
  plainTree: { kind: 'tree', label: 'round tree', note: 'the plain look', id: () => findId(id => !pine(id) && !has(id, 'blossom') && !has(id, 'autumn') && !has(id, 'nest')) },
  blossom: { kind: 'tree', label: 'blossom', note: `${oneIn('blossom')} round trees`, id: () => findId(id => !pine(id) && has(id, 'blossom') && !has(id, 'nest')) },
  autumn: { kind: 'tree', label: 'autumn', note: 'about 1 in 14 round trees', id: () => findId(id => !pine(id) && !has(id, 'blossom') && has(id, 'autumn') && !has(id, 'nest')) },
  nestRound: { kind: 'tree', label: 'nest in a round tree', note: `${oneIn('nest')} trees`, id: () => findId(id => !pine(id) && !has(id, 'blossom') && !has(id, 'autumn') && has(id, 'nest')) },
  nestPine: { kind: 'tree', label: 'nest in a pine', note: `${oneIn('nest')} trees`, id: () => findId(id => pine(id) && has(id, 'nest')) },
  plainRock: { kind: 'rock', label: 'rock', note: 'the plain look', id: () => findId(id => !has(id, 'moss') && !has(id, 'door')) },
  moss: { kind: 'rock', label: 'moss cap', note: `${oneIn('moss')} rocks`, id: () => findId(id => has(id, 'moss') && !has(id, 'door')) },
  door: { kind: 'rock', label: 'tiny round door', note: `${oneIn('door')} rocks`, id: () => findId(id => !has(id, 'moss') && has(id, 'door')) },
  mossDoor: { kind: 'rock', label: 'moss and a door', note: 'about 1 in 160 rocks', id: () => findId(id => has(id, 'moss') && has(id, 'door')) },
  redCap: { kind: 'mushroom', label: 'red caps', note: 'the plain look', id: () => findId(id => !has(id, 'bluecap') && !has(id, 'glowcap') && !has(id, 'fairyring')) },
  blueCap: { kind: 'mushroom', label: 'blue caps', note: `${oneIn('bluecap')} mushrooms`, id: () => findId(id => !has(id, 'glowcap') && has(id, 'bluecap') && !has(id, 'fairyring')) },
  glowCap: { kind: 'mushroom', label: 'glowing caps', note: `${oneIn('glowcap')} mushrooms`, id: () => findId(id => has(id, 'glowcap') && !has(id, 'fairyring')) },
  ring: { kind: 'mushroom', label: 'fairy ring', note: `${oneIn('fairyring')} decoration mushrooms`, id: () => findId(id => !has(id, 'bluecap') && !has(id, 'glowcap') && has(id, 'fairyring')) },
  blueRing: { kind: 'mushroom', label: 'blue fairy ring', note: 'about 1 in 70', id: () => findId(id => !has(id, 'glowcap') && has(id, 'bluecap') && has(id, 'fairyring')) },
  daisies: { kind: 'flower', label: 'daisies', note: 'the plain look', id: () => findId(id => !has(id, 'birdbath') && !has(id, 'sunflowers')) },
  sun2: { kind: 'flower', label: 'two sunflowers', note: `${oneIn('sunflowers')} flower spots (two or three)`, id: () => findId(id => !has(id, 'birdbath') && has(id, 'sunflowers') && lookRoll({ id }, 'sunflowers') < RARE.sunflowers / 2) },
  sun3: { kind: 'flower', label: 'three sunflowers', note: `${oneIn('sunflowers')} flower spots (two or three)`, id: () => findId(id => !has(id, 'birdbath') && has(id, 'sunflowers') && lookRoll({ id }, 'sunflowers') >= RARE.sunflowers / 2) },
  bath: { kind: 'flower', label: 'bird bath', note: `${oneIn('birdbath')} flower spots`, id: () => findId(id => has(id, 'birdbath') && !has(id, 'bird')) },
  bird: { kind: 'flower', label: 'bird bath with a bird', note: `${oneIn('bird')} bird baths`, id: () => findId(id => has(id, 'birdbath') && has(id, 'bird')) },
  crystal: { kind: 'crystal', label: 'crystal', note: 'the plain look', id: () => findId(id => !has(id, 'rose')) },
  rose: { kind: 'crystal', label: 'rose crystal', note: `${oneIn('rose')} crystals`, id: () => findId(id => has(id, 'rose')) },
  mill: { kind: 'windmill', label: 'windmill', note: 'the plain look', id: () => findId(id => !has(id, 'stripes'), { make: buildingId }) },
  stripes: { kind: 'windmill', label: 'striped sails', note: `${oneIn('stripes')} windmills`, id: () => findId(id => has(id, 'stripes'), { make: buildingId }) },
};

// The model as the town places it (scene/town/pads.js placeModel): a windmill on its pad and scaled
// like one, everything else at full size. n picks the size the model's own seed gives.
function drawThing(ctx, kind, id, { x = 0, z = 0, yaw = 0, n = 3 } = {}) {
  const pad = kind === 'windmill';
  const s = modelScale({ kind, pad });
  const thing = { id, kind, island: 'home', x, z, c: n, r: 211, c0: n, r0: 211, fw: pad ? 2 : 1, fd: pad ? 2 : 1, w: 1, h: 1, facing: yaw / QUARTER, yaw, height: 0, blocks: pad, old: false, modelScale: s, coast: null };
  MODELS[kind](ctx, thing, place(x, pad ? TOWN.padRise : 0, z, { ry: yaw, s }));
  if (pad) ctx.add(new THREE.BoxGeometry(1.5, TOWN.padRise, 1.5), 'matte', P.stone, place(x, TOWN.padRise / 2, z), null, false);
}

// A grass stand-in: a round slab with its top at y = 0.
function grass(ctx, radius, x = 0, z = 0) {
  ctx.add(new THREE.CylinderGeometry(radius, radius * 1.02, 0.14, 28), 'matte', P.grass, place(x, -0.07, z), null, false);
}

// One look on its own, close up.
async function lookCard(tools, key, { mood = 'focus', time = 0, extra = '' } = {}) {
  const look = LOOKS[key], id = look.id();
  if (!id) return tools.card(look.label, 'no id found', [tools.messageImage(...SIZE, 'No id with this look in 50,000.')]);
  const radius = look.kind === 'windmill' ? 1.05 : 0.6;
  const img = await tools.shot(ctx => { grass(ctx, radius); drawThing(ctx, look.kind, id); }, { mood, time, width: SIZE[0], height: SIZE[1], pitch: 0.6 });
  return tools.card(`${look.label}${extra}`, `${look.note} · ${id}${mood !== 'focus' ? ` · ${mood}` : ''}`, [img]);
}

// A time when the bird's head is lowest, and one when it sits up.
function birdTimes(id) {
  let low = 0;
  for (let t = 0; t < 30; t += 0.02) if (birdTilt({ id }, t) > birdTilt({ id }, low)) low = t;
  return { low, up: low + 6 };
}

function section(id, title, note, cards) {
  return {
    id, title,
    async render(host, tools) {
      if (note) tools.note(note);
      const row = tools.grid('gallery-medium');
      for (const [key, options] of cards) row.append(await lookCard(tools, key, options));
    },
  };
}

// Every look in two rows at Today's zoom: framed so a helper (also drawn) stands 18 px tall, as Today
// keeps them at least.
const TODAY_ROWS = [
  ['plainTree', 'blossom', 'autumn', 'nestRound', 'nestPine', 'moss', 'door', 'mill'],
  ['redCap', 'blueCap', 'glowCap', 'ring', 'rose', 'sun3', 'bath', 'bird', 'stripes'],
];
const HELPER_PX = 18, HELPER_HEIGHT = 0.4; // as scene/core.js

function todayShot(tools, mood, time) {
  const [width, height] = tools.TODAY_SIZE;
  const spots = [];
  TODAY_ROWS.forEach((row, r) => {
    let x = -4.2;
    for (const key of row) {
      const big = LOOKS[key].kind === 'windmill';
      x += big ? 0.85 : 0;
      spots.push({ key, x, z: r ? 0.75 : -0.75, yaw: (spots.length % 4) * QUARTER * (big ? 0 : 1) });
      x += big ? 1.85 : 1;
    }
  });
  // An aim box as wide as gives 18 px helpers at Today's size.
  let lo = 1, hi = 20;
  for (let i = 0; i < 40; i++) {
    const w = (lo + hi) / 2;
    const ppu = pixelsPerUnit(fitView([[-w, 0, -1.4], [w, 0, -1.4], [-w, 0.6, 1.4], [w, 0.6, 1.4]], width / height).distance, height);
    if (ppu * HELPER_HEIGHT > HELPER_PX) lo = w; else hi = w;
  }
  const middle = (Math.min(...spots.map(s => s.x)) + Math.max(...spots.map(s => s.x))) / 2;
  const aim = [[-lo, 0, -1.4], [lo, 0, -1.4], [-lo, 0.6, 1.4], [lo, 0.6, 1.4]].map(([x, y, z]) => [x + middle, y, z]);
  return tools.shot(ctx => {
    ctx.add(new THREE.BoxGeometry(11.5, 0.14, 3.2), 'matte', P.grass, place(middle, -0.07, 0), null, false);
    for (const { key, x, z, yaw } of spots) drawThing(ctx, LOOKS[key].kind, LOOKS[key].id(), { x, z, yaw, n: Math.round(x * 3) });
    const M = helperMaterials();
    ctx.track(M);
    const rig = buildHelper(lookFor({ name: 'Pip', job: 'wood' }, 0), M);
    rig.root.position.set(middle - 4.6, 0, 0.1);
    ctx.root.add(rig.root);
  }, { mood, time, width, height, aim });
}

export default {
  id: 'variety',
  title: 'Rare looks on nature and windmills',
  sections: [
    section('trees', 'Trees: blossom, autumn and a nest', "Each island's first tree always keeps its green crown (its id is the same in every town). Close up, a little lower than Today.", [
      ['plainTree'], ['blossom'], ['autumn'], ['nestRound'], ['nestPine'],
    ]),
    section('rocks', 'Rocks: a moss cap and a tiny round door', 'The door is set into the big stone on the side that faces the camera.', [
      ['plainRock'], ['moss'], ['door'], ['mossDoor'],
    ]),
    section('mushrooms', 'Mushrooms: blue caps, glowing caps and fairy rings', 'Glowing caps use the crystals\' own soft glow: faint by day, brighter at night. No real lights. Fairy rings come only on decoration mushrooms, not on an island\'s first one.', [
      ['redCap'], ['blueCap'], ['glowCap'], ['glowCap', { mood: 'done', extra: ' at night' }], ['ring'], ['blueRing'],
    ]),
    {
      id: 'flowers', title: 'Flower spots: sunflowers and a bird bath',
      async render(host, tools) {
        tools.note('Sunflowers stand at the back of the patch, in place of daisies, so they hide none. The bird dips its head twice about every 20 seconds and sits still the rest of the time; it is moved by the scene time, so it freezes when the scene is held still.');
        const row = tools.grid('gallery-medium');
        const { low, up } = birdTimes(LOOKS.bird.id());
        for (const key of ['daisies', 'sun2', 'sun3', 'bath']) row.append(await lookCard(tools, key));
        row.append(await lookCard(tools, 'bird', { time: up, extra: ' · sitting' }));
        row.append(await lookCard(tools, 'bird', { time: low, extra: ' · dipping' }));
      },
    },
    section('crystals', 'Crystals and windmills: rose crystals and striped sails', 'Windmills stand on a plain stand-in pad.', [
      ['crystal'], ['rose'], ['rose', { mood: 'done', extra: ' at night' }], ['mill', { time: 2 }], ['stripes', { time: 2 }],
    ]),
    {
      id: 'today', title: "Every look at Today's size",
      async render(host, tools) {
        tools.note(`Back row: ${TODAY_ROWS[0].map(k => LOOKS[k].label).join(', ')}. Front row: ${TODAY_ROWS[1].map(k => LOOKS[k].label).join(', ')}. Framed so the helper on the left stands 18 px tall, the smallest Today draws them. Things turn a quarter more each step, as they do in towns.`);
        const row = tools.grid('gallery-medium');
        const { low } = birdTimes(LOOKS.bird.id());
        for (const mood of ['focus', 'done']) row.append(tools.card(`Today's size · ${mood}`, '', [await todayShot(tools, mood, mood === 'focus' ? low : 2)]));
      },
    },
  ],
};
