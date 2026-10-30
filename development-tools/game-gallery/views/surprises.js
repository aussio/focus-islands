// Surprise flavours, visitors and keepsakes (rules.js SURPRISE_FLAVOURS and KEEPSAKES; scene/town/visitors.js;
// scene/models/keepsakes.js). Never ships.
//
//   #surprises-keepsakes   each keepsake close up on a grass stand-in, and the lamp and well at night
//   #surprises-placed      keepsakes as the layout places them on a real island: the fountain by the
//                          square, the rest on the coast facing out
//   #surprises-visitors    each visitor on a real island, in the moods where it looks different
//   #surprises-today       visitors on the busy island at Today's size, camera at rest
//   #surprises-cards       every card text, with each flavour's weight
//
// The islands are the steady planner's day 60 (make-states.js), with keepsakes and a visitor added here.
// Moving parts (rain, flames, the balloon, fireflies, fountain ripples) are held at fixed scene times, so
// the pictures repeat exactly.
import * as THREE from 'three';
import rules from '../../../electron/core/game/rules.js';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { P, createMaterials } from '../../../electron/renderer/game/scene/style.js';
import { MODELS } from '../../../electron/renderer/game/scene/models/index.js';
import { createSceneCore } from '../../../electron/renderer/game/scene/core.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { makeBlobMaterial, makeModelContext } from '../../../electron/renderer/game/scene/town/build.js';
import { buildGround } from '../../../electron/renderer/game/scene/town/ground.js';
import { buildLanes } from '../../../electron/renderer/game/scene/town/lanes.js';
import { buildBlocks } from '../../../electron/renderer/game/scene/town/blocks.js';
import { buildThings } from '../../../electron/renderer/game/scene/town/pads.js';
import { buildVisitors, VISITOR_KINDS } from '../../../electron/renderer/game/scene/town/visitors.js';
import { buildTown } from '../../../electron/renderer/game/town/index.js';

const TIME = 6; // scene seconds the moving parts are held at
const CLOSE = [240, 220];
const ISLAND = [420, 320];
const TODAY = [591, 357];
const DAY = 60;
const KEEPSAKE_KINDS = rules.KEEPSAKES.map(k => k.id);
// Where the placed section puts each keepsake (at most three on an island, as the rules allow).
const PLACED = { home: ['fountain', 'bench', 'lamp'], 'isle-1': ['well', 'cairn', 'telescope'], 'isle-2': ['birdhouse'] };
// The moods each visitor is shown in: the ones where it looks different.
const VISITOR_MOODS = { raincloud: ['focus'], tent: ['focus', 'break', 'done'], balloon: ['focus', 'break'], rainbow: ['focus', 'away', 'done'], fireflies: ['break', 'done'] };

// ---------- Game states ----------
const steadyEntry = tools => tools.data.town.states.find(s => s.person === 'steady' && s.day === DAY && s.game);
const copy = value => JSON.parse(JSON.stringify(value));

// The day's game with keepsakes added as a surprise would leave them: each at the island's land now,
// one check-in after everything else.
function withKeepsakes(game, placed) {
  const next = copy(game);
  const last = Math.max(0, ...next.islands.flatMap(i => (i.buildings ?? []).map(b => b.checkIn)), ...(next.links ?? []).map(l => l.checkIn));
  let n = 0;
  for (const island of next.islands) {
    island.keepsakes = (placed[island.id] ?? []).map(kind => {
      const ground = rules.KEEPSAKES.find(k => k.id === kind)?.ground;
      return { id: `keepsake-${last + 1 + n++}`, kind, land: island.land, checkIn: last + 1, ...(ground ? { ground } : {}) };
    });
  }
  return next;
}

// ---------- Drawing ----------
// The whole island as Today draws it (scene/town/build.js buildTownIsland), with its visitor.
function drawIsland(ctx, island) {
  buildGround(ctx, island);
  buildLanes(ctx, island);
  buildBlocks(ctx, island);
  buildThings(ctx, island, island.things);
  buildVisitors(ctx, island);
}

function keepsakeThing(kind, id, yaw = 0) {
  return { id, kind, island: 'home', x: 0, z: 0, c: 3, r: 211, c0: 3, r0: 211, fw: 1, fd: 1, w: 1, h: 1, facing: yaw / (Math.PI / 2), yaw, height: 0, blocks: true, old: false, modelScale: 1, coast: null };
}

async function keepsakeCard(tools, kind, { mood = 'focus', yaw = 0.5, extra = '' } = {}) {
  const id = `keepsake-${KEEPSAKE_KINDS.indexOf(kind) + 7}`;
  const img = await tools.shot(ctx => {
    ctx.add(new THREE.CylinderGeometry(0.5, 0.51, 0.14, 28), 'matte', P.grass, place(0, -0.07, 0), null, false);
    MODELS[kind](ctx, keepsakeThing(kind, id, yaw), place(0, 0, 0, { ry: yaw }));
  }, { mood, time: TIME, width: CLOSE[0], height: CLOSE[1], pitch: 0.55 });
  const def = rules.KEEPSAKES.find(k => k.id === kind);
  const total = rules.KEEPSAKES.reduce((sum, k) => sum + k.weight, 0);
  return tools.card(`${kind}${extra}`, `weight ${def.weight} of ${total}${def.ground ? ' · takes 1 building room' : ' · on the coast'} ${mood !== 'focus' ? ` · ${mood}` : ''}`, [img]);
}

// A close look at the island's keepsakes (or the whole island when it has none).
function keepsakeAim(island) {
  const points = island.things.filter(t => KEEPSAKE_KINDS.includes(t.kind)).map(t => t.local);
  if (!points.length) return null;
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - 1.1, Math.max(...xs) + 1.1, Math.min(...zs) - 1.1, Math.max(...zs) + 1.1];
  return [[x0, 0, z0], [x1, 0, z0], [x0, 0.6, z1], [x1, 0.6, z1]];
}

// A view around the island's visitor, found by drawing it once on its own (nothing is shown).
let spare = null;
function visitorAim(model, island, margin = 1.3) {
  spare ??= { materials: createMaterials(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  const { ctx, disposables, finish } = makeModelContext({ ...spare, model, island });
  const group = buildVisitors(ctx, island);
  finish();
  for (const fn of ctx.dynamic) fn(TIME);
  const box = group ? new THREE.Box3().setFromObject(group) : null;
  for (const item of disposables) item?.dispose?.();
  if (!box || box.isEmpty()) return null;
  const [x0, x1, z0, z1] = [box.min.x - margin, box.max.x + margin, box.min.z - margin, box.max.z + margin];
  return [[x0, Math.min(0, box.min.y), z0], [x1, Math.min(0, box.min.y), z0], [x0, box.max.y, z1], [x1, box.max.y, z1]];
}

// ---------- Today's size ----------
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

// The real scene at Today's size, camera at rest on the busy view, moving parts at TIME.
async function todayShot(world, mood) {
  const core = createSceneCore({ now: () => 0 });
  const renderer = ownRenderer();
  try {
    core.resize(TODAY[0], TODAY[1]);
    renderer.setSize(TODAY[0], TODAY[1], false);
    core.setWorld(world, { ease: false });
    core.setMood(mood);
    core.update(0, true);
    core.town.animate(TIME);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(core.scene, core.camera);
    const img = document.createElement('img');
    img.width = TODAY[0]; img.height = TODAY[1];
    img.src = renderer.domElement.toDataURL('image/png');
    await new Promise(resolve => { img.onload = img.onerror = resolve; });
    return img;
  } finally { core.dispose(); }
}

// ---------- Card texts ----------
const SAMPLE = 'Mossy Hollow';
const fill = text => String(text ?? '').replace('{island}', SAMPLE);

function cardTable() {
  const table = document.createElement('table');
  table.className = 'gallery-table';
  table.style.cssText = 'border-collapse:collapse;font-size:13px;margin:8px 0 20px;max-width:1100px';
  const row = (cells, head = false) => {
    const tr = document.createElement('tr');
    for (const text of cells) {
      const cell = document.createElement(head ? 'th' : 'td');
      cell.textContent = text;
      cell.style.cssText = 'text-align:left;vertical-align:top;padding:4px 10px;border-bottom:1px solid #e3dccf';
      tr.append(cell);
    }
    table.append(tr);
  };
  row(['slot', 'flavour', 'chance in its slot', 'leaves', 'card text'], true);
  const slotWeight = id => rules.SURPRISES.find(s => s.id === id)?.weight ?? 0;
  const allSlots = rules.SURPRISES.reduce((sum, s) => sum + s.weight, 0);
  for (const [slot, flavours] of Object.entries(rules.SURPRISE_FLAVOURS)) {
    const total = flavours.reduce((sum, f) => sum + f.weight, 0);
    for (const f of flavours) {
      const leaves = f.visitor ? `visitor: ${f.visitor}` : f.id === 'keepsake' ? 'a keepsake (below)' : '';
      const text = f.id === 'keepsake' ? '(the keepsake\'s own text, then the ending)' : f.text ? fill(f.text) : '(the slot\'s own words)';
      row([`${slot} (${slotWeight(slot)} of ${allSlots})`, f.id, `${f.weight} of ${total}`, leaves, text]);
    }
  }
  const total = rules.KEEPSAKES.reduce((sum, k) => sum + k.weight, 0);
  for (const k of rules.KEEPSAKES) row(['keepsake', k.id, `${k.weight} of ${total}`, k.ground ? 'takes 1 building room' : 'stands on the coast', `${fill(k.text)} ${rules.KEEPSAKE_ENDING}`]);
  return table;
}

export default {
  id: 'surprises',
  title: 'Surprises: flavours, visitors and keepsakes',
  sections: [
    {
      id: 'keepsakes', title: 'Keepsakes close up',
      async render(host, tools) {
        tools.note(`Each stands on one point and faces out from the coast (+z, turned a little here). Held at ${TIME} s (the fountain's ripples move).`);
        const row = tools.grid('gallery-medium');
        for (const kind of KEEPSAKE_KINDS) row.append(await keepsakeCard(tools, kind));
        row.append(await keepsakeCard(tools, 'lamp', { mood: 'done', extra: ' at night' }));
        row.append(await keepsakeCard(tools, 'well', { mood: 'done', extra: ' at night' }));
      },
    },
    {
      id: 'placed', title: 'Keepsakes as the layout places them',
      async render(host, tools) {
        const entry = steadyEntry(tools);
        if (!entry) { tools.note(`No steady state for day ${DAY}: run make-states.js.`); return; }
        const model = parseTown(buildTown(withKeepsakes(entry.game, PLACED)));
        tools.note(`Steady planner, day ${DAY}, with keepsakes added one check-in after everything else: ${Object.entries(PLACED).map(([id, kinds]) => `${id}: ${kinds.join(', ')}`).join(' · ')}.`);
        const row = tools.grid('gallery-wide');
        for (const id of Object.keys(PLACED)) {
          const island = model.byId.get(id);
          if (!island) { tools.note(`No ${id} on day ${DAY}.`); continue; }
          const aim = keepsakeAim(island);
          const images = [];
          for (const mood of ['focus', 'done']) images.push(await tools.shot(ctx => drawIsland(ctx, island), { width: ISLAND[0], height: ISLAND[1], mood, aim, time: TIME, model, island }));
          const where = island.things.filter(t => KEEPSAKE_KINDS.includes(t.kind)).map(t => `${t.kind} at ${t.points[0]}${island.coast.has(t.points[0]) ? ' (coast)' : ''}`).join(', ');
          row.append(tools.card(`${id} (${island.kind})`, `focus · done · ${where || 'nothing placed'}`, images));
        }
      },
    },
    {
      id: 'visitors', title: 'Visitors on a real island',
      async render(host, tools) {
        const entry = steadyEntry(tools);
        if (!entry) { tools.note(`No steady state for day ${DAY}: run make-states.js.`); return; }
        tools.note(`Each stays on its island until the next check-in. Steady planner, day ${DAY}, home island, held at ${TIME} s. The rainbow hides at night; fireflies show only in break and done.`);
        const row = tools.grid('gallery-wide');
        for (const kind of VISITOR_KINDS) {
          const model = parseTown(buildTown({ ...entry.game, visitor: { kind, island: 'home' } }));
          const island = model.byId.get('home');
          const aim = visitorAim(model, island);
          const images = [];
          for (const mood of VISITOR_MOODS[kind]) images.push(await tools.shot(ctx => drawIsland(ctx, island), { width: ISLAND[0], height: ISLAND[1], mood, time: TIME, model, island, aim }));
          row.append(tools.card(kind, `${VISITOR_MOODS[kind].join(' · ')} · framed on the visitor`, images));
        }
      },
    },
    {
      id: 'today', title: "Visitors at Today's size",
      async render(host, tools) {
        const entry = steadyEntry(tools);
        if (!entry) { tools.note(`No steady state for day ${DAY}: run make-states.js.`); return; }
        const view = buildTown(entry.game).view.island ?? 'home';
        tools.note(`On the busy island (${view}), the camera at rest as Today shows it, held at ${TIME} s.`);
        const row = tools.grid('gallery-today');
        for (const [kind, mood] of [['balloon', 'break'], ['raincloud', 'focus'], ['rainbow', 'focus'], ['tent', 'break']]) {
          const img = await todayShot(buildTown({ ...entry.game, visitor: { kind, island: view } }), mood);
          row.append(tools.card(`${kind} · ${mood}`, '', [img]));
        }
      },
    },
    {
      id: 'cards', title: 'Every card text',
      async render(host, tools) {
        tools.note(`{island} reads "${SAMPLE}" here. Every flavour gives exactly its slot's gift. The slot roll and the island roll are unchanged; a separate surprise-flavour roll picks the flavour.`);
        host.append(cardTable());
      },
    },
  ],
};
