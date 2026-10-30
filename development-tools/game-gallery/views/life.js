// Small life on the growing places (the "Small life" part of scene/models/growing.js) and its two looks:
// more lilies on a pond and a scarecrow in a garden. Never ships.
//
//   #life            every section
//   #life-day        each place close up by day: butterflies, bees, ducks, the frog, leaves, the drip
//   #life-break      at break: the drizzle cloud over the rain catcher, moths at the lit lamps
//   #life-night      at night (done): moths at the lamps, the ducks and the frog keeping still
//   #life-looks      ponds plain, with more lilies and with the frog's pad; gardens with and without a
//                    scarecrow; all at rest (time 0)
//   #life-today      every place in a row at Today's size, with a helper standing 18 px tall
//
// Each section opens at its own fixed mood and time, so a picture of a hash always shows the same thing.
// Its buttons redraw it in place at another mood or time. "Busy" is, for each card, the moment in its
// first 45 seconds with the most going on (things in the air, ripples, a falling leaf or drop).
// Each card finds its id by counting up b1, b2, ... until one has what the card shows.
import * as THREE from 'three';
import { place, hashString } from '../../../electron/renderer/game/scene/ground.js';
import { P, TOWN, MOODS, lookFor } from '../../../electron/renderer/game/scene/style.js';
import { MODELS } from '../../../electron/renderer/game/scene/models/index.js';
import { lifeOf } from '../../../electron/renderer/game/scene/models/growing.js';
import { modelScale } from '../../../electron/renderer/game/scene/town/pads.js';
import { makeModelContext } from '../../../electron/renderer/game/scene/town/build.js';
import { buildHelper, helperMaterials } from '../../../electron/renderer/game/scene/helpers.js';
import { fitView, pixelsPerUnit } from '../../../electron/renderer/game/scene/stage.js';

const SIZE = [440, 340];
// How tall each kind's close-up frame is (the great tree is tall; the rain catcher's cloud sits above it).
const TALL = { greattree: 1.95, nursery: 1.2, lanterns: 0.65 };
const CELL = 0.6;
const roll = (id, name) => hashString(`${id}:${name}`);
const findId = test => { for (let n = 1; n < 20000; n++) if (test(`b${n}`)) return `b${n}`; return null; };

// What each card shows, with the rule from growing.js that picks an id for it.
const CARDS = {
  garden: { kind: 'garden', label: 'garden with a scarecrow', note: 'scarecrow on about 1 in 3; 2 or 3 butterflies by day', id: () => findId(id => roll(id, 'scarecrow') < 1 / 3 && roll(id, 'butterflies') < 0.5) },
  plainGarden: { kind: 'garden', label: 'garden', note: 'no scarecrow', id: () => findId(id => roll(id, 'scarecrow') >= 1 / 3) },
  flowers: { kind: 'flowers', label: 'flower bed', note: '0 to 2 butterflies by day', id: () => findId(id => roll(id, 'butterflies') >= 0.75) },
  lanterns: { kind: 'lanterns', label: 'lantern path', note: 'a moth at about 1 lamp in 2, while lit', id: () => findId(id => roll(id, 'moth:0') < 0.5 && roll(id, 'moth:1') < 0.5) },
  pond: { kind: 'pond', label: 'pond with a frog and more lilies', note: 'frog and lilies each on about 1 in 3; a duck, sometimes a duckling', id: () => findId(id => roll(id, 'lilies') < 1 / 3 && roll(id, 'frog') < 1 / 3 && roll(id, 'duckling') < 0.5) },
  plainPond: { kind: 'pond', label: 'pond', note: 'no frog, no extra lilies; one duck', id: () => findId(id => roll(id, 'lilies') >= 1 / 3 && roll(id, 'frog') >= 1 / 3 && roll(id, 'duckling') >= 0.5) },
  lilyPond: { kind: 'pond', label: 'pond with more lilies', note: 'about 1 in 3 ponds', id: () => findId(id => roll(id, 'lilies') < 1 / 3 && roll(id, 'frog') >= 1 / 3) },
  frogPond: { kind: 'pond', label: 'pond with a frog', note: "about 1 in 3 ponds; the frog's second pad comes with it", id: () => findId(id => roll(id, 'lilies') >= 1 / 3 && roll(id, 'frog') < 1 / 3) },
  beehives: { kind: 'beehives', label: 'beehive meadow', note: '3 to 5 bees by day', id: () => findId(id => roll(id, 'bees') >= 2 / 3) },
  greattree: { kind: 'greattree', label: 'great tree', note: 'a leaf drifts down every few seconds', id: () => 'b1' },
  nursery: { kind: 'nursery', label: 'rain catcher', note: 'the tap drips; a drizzle cloud at break', id: () => 'b1' },
};

// The model as the town places it (scene/town/pads.js placeModel): a pad kind on its pad and scaled like
// one, with the footprint its kind is designed for.
function drawThing(ctx, kind, id, { x = 0, z = 0, yaw = 0 } = {}) {
  const pad = !['flowers', 'lanterns'].includes(kind);
  const s = modelScale({ kind, pad });
  const [fw, fd] = kind === 'flowers' ? [1 / CELL, 0.5 / CELL] : pad ? [2, 2] : [1, 1];
  const thing = { id, kind, island: 'home', x, z, c: 3, r: 211, c0: 3, r0: 211, fw, fd, w: fw, h: fd, facing: yaw / (Math.PI / 2), yaw, height: 0, blocks: pad, old: false, modelScale: s, coast: null };
  MODELS[kind](ctx, thing, place(x, pad ? TOWN.padRise : 0, z, { ry: yaw, s }));
  if (pad) ctx.add(new THREE.BoxGeometry(1.3, TOWN.padRise, 1.3), 'matte', P.stone, place(x, TOWN.padRise / 2, z), null, false);
}

function grass(ctx, radius) {
  ctx.add(new THREE.CylinderGeometry(radius, radius * 1.02, 0.14, 28), 'matte', P.grass, place(0, -0.07, 0), null, false);
}

// The moment in [3, 45] s with the most going on, found by posing a scratch copy (nothing drawn).
const SCRATCH = { materials: { facet: new THREE.MeshBasicMaterial() }, blobMaterial: null, blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
const busyTimes = new Map();
function busyTime(kind, id, mood) {
  const key = `${kind}:${id}:${mood}`;
  if (busyTimes.has(key)) return busyTimes.get(key);
  const made = makeModelContext(SCRATCH);
  drawThing(made.ctx, kind, id);
  for (const hook of made.moodHooks) hook(mood, MOODS[mood]);
  const movers = [...lifeOf(made.ctx).values()].flatMap(s => s.movers.map(m => [m, s.mesh.instanceMatrix.array]));
  const shown = (m, a) => { let n = 0; for (let i = m.first; i < m.first + m.n; i++) if (a[i * 16] || a[i * 16 + 5]) n++; return n; };
  let best = 12, most = -1;
  for (let t = 3; t <= 45; t += 0.25) {
    for (const fn of made.dynamic) fn(t);
    let n = 0;
    for (const [m, a] of movers) n += m.on ? (m.flying ? 3 : ['ripple', 'leaf', 'drip', 'cloud'].includes(m.kind) ? shown(m, a) : 0) : 0;
    if (n > most) { most = n; best = t; }
  }
  for (const item of made.disposables) item?.dispose?.();
  busyTimes.set(key, best);
  return best;
}

async function lifeCard(tools, key, { mood, time }) {
  const look = CARDS[key], id = look.id();
  if (!id) return tools.card(look.label, 'no id found', [tools.messageImage(...SIZE, 'No id found in 20,000.')]);
  const t = time === 'busy' ? busyTime(look.kind, id, mood) : time;
  const r = look.kind === 'flowers' || look.kind === 'lanterns' ? 0.55 : 0.8, top = TALL[look.kind] ?? 0.5;
  const aim = [[-r, 0, -r], [r, 0, -r], [-r, top, r], [r, top, r]];
  const img = await tools.shot(ctx => { grass(ctx, 0.85); drawThing(ctx, look.kind, id); }, { mood, time: t, width: SIZE[0], height: SIZE[1], pitch: 0.55, aim });
  const stats = img.stats ? ` · ${img.stats.triangles} tris, ${img.stats.calls} draws` : '';
  const el = tools.card(look.label, `${id} · ${mood} · ${t} s${stats}`, [img]);
  el.title = look.note;
  el.style.maxWidth = `${SIZE[0] + 24}px`;
  return el;
}

// Mood and time buttons that redraw the section in place.
const TIMES = [['rest (0 s)', 0], ['busy', 'busy'], ['6 s', 6], ['20 s', 20], ['45 s', 45]];
function controls(host, state, redraw) {
  const bar = document.createElement('div');
  bar.className = 'gallery-note';
  const group = (label, options, field) => {
    const span = document.createElement('span');
    span.style.marginRight = '18px';
    span.append(`${label}: `);
    for (const [text, value] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.marginRight = '4px';
      button.style.fontWeight = state[field] === value ? '700' : '400';
      button.addEventListener('click', () => { state[field] = value; for (const b of span.querySelectorAll('button')) b.style.fontWeight = b === button ? '700' : '400'; redraw(); });
      span.append(button);
    }
    bar.append(span);
  };
  group('Mood', ['focus', 'break', 'away', 'done'].map(m => [m, m]), 'mood');
  group('Time', TIMES, 'time');
  host.append(bar);
}

function section(id, title, note, { mood, time, cards, draw = null }) {
  return {
    id, title,
    async render(host, tools) {
      tools.note(note);
      const state = { mood, time };
      let row = null, turn = 0;
      const redraw = async () => {
        const mine = ++turn;
        const next = tools.grid('gallery-medium');
        if (row) row.replaceWith(next); else host.append(next);
        row = next;
        if (draw) { next.append(await draw(tools, state)); return; }
        for (const key of cards) {
          const el = await lifeCard(tools, key, state);
          if (mine !== turn) return; // a newer redraw took over
          next.append(el);
        }
      };
      controls(host, state, redraw);
      await redraw();
    },
  };
}

// Every place in a row at Today's zoom, framed so a helper (also drawn) stands 18 px tall, as Today
// keeps them at least.
const TODAY = ['garden', 'flowers', 'lanterns', 'pond', 'beehives', 'greattree', 'nursery'];
const HELPER_PX = 18, HELPER_HEIGHT = 0.4; // as scene/core.js
async function todayShot(tools, { mood, time }) {
  const [width, height] = tools.TODAY_SIZE;
  const spots = TODAY.map((key, i) => ({ key, x: -4.2 + i * 1.4, z: 0 }));
  let lo = 1, hi = 20;
  for (let i = 0; i < 40; i++) {
    const w = (lo + hi) / 2;
    const ppu = pixelsPerUnit(fitView([[-w, 0, -1.4], [w, 0, -1.4], [-w, 0.6, 1.4], [w, 0.6, 1.4]], width / height).distance, height);
    if (ppu * HELPER_HEIGHT > HELPER_PX) lo = w; else hi = w;
  }
  const t = time === 'busy' ? busyTime('beehives', CARDS.beehives.id(), mood) : time;
  const img = await tools.shot(ctx => {
    ctx.add(new THREE.BoxGeometry(11, 0.14, 3), 'matte', P.grass, place(0, -0.07, 0), null, false);
    for (const { key, x, z } of spots) drawThing(ctx, CARDS[key].kind, CARDS[key].id(), { x, z });
    const M = helperMaterials();
    ctx.track(M);
    const rig = buildHelper(lookFor({ name: 'Pip', job: 'saplings' }, 0), M);
    rig.root.position.set(-5.2, 0, 0.3);
    ctx.root.add(rig.root);
  }, { mood, time: t, width, height, aim: [[-lo, 0, -1.4], [lo, 0, -1.4], [-lo, 0.6, 1.4], [lo, 0.6, 1.4]] });
  const stats = img.stats ? ` · ${img.stats.triangles} triangles, ${img.stats.calls} draws` : '';
  return tools.card(`Today's size · ${mood} · ${t} s`, `${TODAY.map(k => CARDS[k].label).join(', ')}${stats}`, [img]);
}

export default {
  id: 'life',
  title: 'Small life on the growing places',
  sections: [
    section('day', 'By day', 'Butterflies rest on plants and fence posts, then flutter to another; bees hop between a hive and the flowers in front of it; a duck paddles round a lily; the frog sits, then hops to its other pad about every half minute; leaves drift off the great tree; the tap drips. All of it comes from the scene time, so at rest (0 s) nothing is in the air.',
      { mood: 'focus', time: 'busy', cards: ['garden', 'flowers', 'pond', 'plainPond', 'beehives', 'greattree', 'nursery'] }),
    section('break', 'At break', 'No butterflies or bees. A small drizzle cloud rains on the rain catcher\'s roof, and moths circle the lit lamps.',
      { mood: 'break', time: 'busy', cards: ['nursery', 'lanterns', 'pond', 'garden'] }),
    section('night', 'At night', 'Moths stay at the lamps; the ducks and the frog keep still; ripples are fainter.',
      { mood: 'done', time: 'busy', cards: ['lanterns', 'pond', 'greattree', 'nursery'] }),
    section('looks', 'The looks', 'Look-only picks from each thing\'s own id: more lilies (two flowers and two budding pads), the frog\'s own pad, and the scarecrow standing on the side away from the camera.',
      { mood: 'focus', time: 0, cards: ['plainPond', 'lilyPond', 'frogPond', 'plainGarden', 'garden'] }),
    section('today', "At Today's size", 'Framed so the helper on the left stands 18 px tall, the smallest Today draws them.',
      { mood: 'focus', time: 'busy', draw: todayShot }),
  ],
};
