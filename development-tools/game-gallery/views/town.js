// The town scene (stream E): whole worlds drawn the way Today draws them, with the follow camera.
// Real states (data.town.states) once the layout draws them; the sample towns (town/samples.js) until then.
import * as THREE from 'three';
import { CLEAR_TOP, createSceneCore } from '../../../electron/renderer/game/scene/core.js';
import { AIM_SECONDS } from '../../../electron/renderer/game/scene/stage.js';
import { SWAY, driftPose, swayYaw } from '../../../electron/renderer/game/scene/drift.js';
import { SAMPLE_NAMES, sampleFilm, sampleTown } from '../../../electron/renderer/game/town/samples.js';
import { buildTown } from '../../../electron/renderer/game/town/index.js';

const TODAY = [591, 357];
const LARGE = [960, 580];
const FILM = [394, 238];
const BUDGET = { triangles: 300000, calls: 80, frameMs: 4, islandMs: 60, allMs: 250, layoutMs: 30 };
const now = () => performance.now();
const isTown = world => Boolean(world?.islands?.some(island => island.grid));

// ---------- What to draw ----------
// Real states with a drawn town, steady planner first in day order; or null.
function realStates(tools) {
  const list = tools.data.town.states.filter(entry => isTown(entry.world));
  return list.length ? list : null;
}
const steady = states => states.filter(s => s.person === 'steady').sort((a, b) => a.day - b.day);
const describe = world => {
  const islands = world.islands.map(i => `${i.id} ${i.land.length}${i.lift ? ` ↕${i.lift}` : ''}`).join(', ');
  return `${islands} · ${world.bridges.length} bridges · view: ${world.view.island ?? 'none'}`;
};

// [{ label, world }] for the state pictures.
function stateList(tools) {
  const real = realStates(tools);
  if (real) return [...steady(real), ...real.filter(s => s.person !== 'steady')].map(s => ({ label: `${s.personName ?? s.person}, day ${s.day}`, world: s.world }));
  return SAMPLE_NAMES.map(name => ({ label: `sample: ${name}`, world: sampleTown(name) }));
}
// The growth film: [{ label, world }].
function filmList(tools) {
  const real = realStates(tools);
  if (real) return steady(real).map(s => ({ label: `day ${s.day}`, world: s.world }));
  return ['village', 'manyIslands'].flatMap(name => sampleFilm(name).map((step, n) => ({ label: `${name} ${n + 1}: ${step.label}`, world: step.world })));
}
// The biggest town: day 180 of the steady planner, or the sample with many islands.
function bigWorld(tools) {
  const real = realStates(tools);
  const last = real && steady(real).at(-1);
  return last ? { label: `steady, day ${last.day}`, world: last.world, game: last.game } : { label: 'sample: manyIslands', world: sampleTown('manyIslands') };
}
// Two neighbouring states where the view moves to a new island.
function cameraPair(tools) {
  const film = filmList(tools);
  for (let i = 1; i < film.length; i++) if (film[i].world.view.island !== film[i - 1].world.view.island) return [film[i - 1], film[i]];
  return film.length > 1 ? [film.at(-2), film.at(-1)] : null;
}

// ---------- A renderer of our own, for camera moves and timing ----------
// Set up like scene/index.js. Drives the scene core directly, with a clock this view moves by hand.
let own = null;
function ownRenderer() {
  if (own) return own;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  own = { renderer, gl: renderer.getContext() };
  return own;
}
function coreAt(size) {
  const clock = { ms: 0 };
  const core = createSceneCore({ now: () => clock.ms });
  core.resize(size[0], size[1]);
  const { renderer } = ownRenderer();
  renderer.setSize(size[0], size[1], false);
  const draw = (t = 0) => {
    core.update(t);
    if (core.takeChanged()) renderer.shadowMap.needsUpdate = true;
    renderer.render(core.scene, core.camera);
  };
  return { core, clock, draw, renderer };
}
function picture(renderer, size) {
  const img = document.createElement('img');
  img.width = size[0]; img.height = size[1];
  img.src = renderer.domElement.toDataURL('image/png');
  return new Promise(resolve => { img.onload = img.onerror = () => resolve(img); });
}
// Gallery only: until the ground, lanes and blocks are drawn (streams C and D), dots stand in for land
// points and boxes for blocks while an island has no ground (no coast loop from buildGround), boxes for
// things while an island draws nothing at all, and lines for bridges that draw nothing.
const DOT = { land: '#7fd26a', lane: '#fff3dc', coast: '#5cae4f', thing: '#b8a9dd' };
function placeholders(core) {
  const made = [];
  const m = new THREE.Matrix4(), colour = new THREE.Color();
  for (const built of core.town?.islands.values() ?? []) {
    if (built.loop.length) continue;
    const island = built.island;
    const bare = !built.meshes.length;
    const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 8);
    const box = new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const dots = new THREE.InstancedMesh(disc, material, island.land.size);
    let i = 0;
    for (const p of island.land) {
      const [x, z] = island.grid.points[p];
      dots.setMatrixAt(i, m.makeTranslation(x, -0.04, z));
      dots.setColorAt(i++, colour.set(island.lanes.has(p) ? DOT.lane : island.coast.has(p) ? DOT.coast : DOT.land));
    }
    const tall = [...island.floors].map(([p, floors]) => ({ p, h: floors * 0.5 + 0.25, c: ['#ffd25e', '#7cc8ff', '#ff9a85', '#fff3e2', '#b9a8f5', '#8fe0b0'][island.look.get(p) ?? 0] }))
      .concat(bare ? island.things.flatMap(t => t.points.map(p => ({ p, h: t.pad ? 0.7 : 0.3, c: DOT.thing }))) : []);
    const boxes = new THREE.InstancedMesh(box, material, Math.max(1, tall.length));
    boxes.count = tall.length;
    tall.forEach(({ p, h, c }, k) => {
      const [x, z] = island.grid.points[p];
      boxes.setMatrixAt(k, m.makeScale(1, h, 1).setPosition(x, 0, z));
      boxes.setColorAt(k, colour.set(c));
    });
    for (const mesh of [dots, boxes]) { mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'placeholder'; built.group.add(mesh); }
    made.push(disc, box, material);
  }
  for (const bridge of core.model?.bridges ?? []) {
    if (core.town?.bridges.get(bridge.id)?.meshes.length) continue;
    const { from, to } = bridge;
    const out = (end, k) => [end.at[0] + end.out[0] * end.clear * k, end.at[1], end.at[2] + end.out[1] * end.clear * k];
    const line = new THREE.BufferGeometry().setFromPoints([from.at, out(from, 1), out(to, 1), to.at].map(p => new THREE.Vector3(...p)));
    const material = new THREE.LineBasicMaterial({ color: bridge.type === 'rope' ? '#b9825a' : '#ff6fa8' });
    const mesh = new THREE.Line(line, material);
    mesh.name = 'placeholder';
    core.scene.add(mesh);
    made.push(line, material, { dispose: () => mesh.removeFromParent() });
  }
  return () => made.forEach(item => item.dispose());
}

// Every triangle in the scene, seen or not: islands, bridges, helpers and sky.
function sceneTriangles(scene) {
  let total = 0;
  scene.traverse(node => {
    if (!node.isMesh || !node.visible) return;
    const g = node.geometry;
    total += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (node.isInstancedMesh ? node.count : 1);
  });
  return Math.round(total);
}

const framing = core => (core.aimed ? `frames ${core.aimed.island} ${core.aimed.close ? 'close (view points + 4 steps)' : 'whole'}` : '');

// ---------- The drift ----------
// A picture with a faint band over the top CLEAR_TOP pixels, where Today's resource bar sits.
function banded(img, size) {
  const box = document.createElement('div');
  box.style.cssText = `position:relative;width:${size[0]}px;height:${size[1]}px;`;
  const band = document.createElement('div');
  band.style.cssText = `position:absolute;left:0;right:0;top:0;height:${CLEAR_TOP}px;background:#ffffff40;border-bottom:1px dashed #ffffffb0;pointer-events:none;`;
  box.append(img, band);
  return box;
}
// One state's steady-planner world, by day; or null.
function steadyDay(tools, day) {
  const real = realStates(tools);
  return real && steady(real).find(s => s.day === day);
}
// What the camera does in a segment of the drift's route, in words.
function segmentName(route, segment) {
  const name = pose => (pose === route.home ? 'home (busy view)' : pose === route.wide ? 'the whole group' : `island ${route.places.indexOf(pose) + 2} of ${route.places.length + 1}`);
  return segment.from === segment.to ? `rest at ${name(segment.from)}` : `${name(segment.from)} → ${name(segment.to)}`;
}
// Pictures of one world's drift: the middle of each rest and of each move, for the first `count`
// segments, in each mood side by side. The core's clock is moved by hand, so the pictures repeat exactly.
// The drift style alone, facing north: the sway's turn on top of it is in the sway sections.
async function driftPictures(tools, entry, { moods = ['focus', 'break'], count = 12 } = {}) {
  if (!entry) { tools.note('No state for this day.'); return; }
  const { core, clock, draw, renderer } = coreAt(TODAY);
  try {
    core.cameraStyle = 'drift';
    core.setWorld(entry.world);
    const route = core.stage.route;
    if (!route) { tools.note(`${entry.label ?? ''}: nowhere else to look, so the camera stays on the busy view.`); return; }
    const segments = route.segments.slice(0, count);
    tools.note(`steady, day ${entry.day}: ${describe(entry.world)}. One round of trips takes ${Math.round(route.period)} s; `
      + `these are its first ${segments.length} parts, facing north (the default sway also turns the view; see the sway sections). `
      + `${framing(core)}. The faint band is the top ${CLEAR_TOP} px kept clear for the resource bar.`);
    const grid = tools.grid('gallery-today');
    for (const segment of segments) {
      const seconds = segment.start + segment.seconds / 2;
      const images = [];
      for (const mood of moods) {
        core.setMood(mood);
        clock.ms = seconds * 1000;
        draw(seconds);
        images.push(banded(await picture(renderer, TODAY), TODAY));
      }
      const pose = core.stage.look;
      grid.append(tools.card(`${Math.round(seconds)} s: ${segmentName(route, segment)}${segment.from === segment.to ? '' : ' (half way)'}`,
        `${moods.join(' · ')} · distance ${pose.distance.toFixed(1)} · ${segment.seconds.toFixed(1)} s long`, images));
    }
  } finally { core.dispose(); }
}

// The sway (the default camera): the busy view at each end of the swing and at its middle, in each mood.
// The core's clock is moved by hand to the first such moment while the drift rests at home.
const SWAY_TURNS = [[-1, 'turned right (camera to the west)'], [0, 'facing north (the middle of the swing)'], [1, 'turned left (camera to the east)']];
async function swayPictures(tools, entry, size, { moods = ['focus', 'break'], band = false, grid = null } = {}) {
  if (!entry) { tools.note('No state for this day.'); return; }
  const { core, clock, draw, renderer } = coreAt(size);
  try {
    core.setWorld(entry.world);
    const route = core.stage.route;
    const atHome = s => !route || driftPose(route, s) === route.home;
    const find = sign => { for (let s = 0; s < 20000; s += 0.5) if (Math.abs(swayYaw(s) - sign * SWAY.degrees * Math.PI / 180) < 1e-6 && atHome(s)) return s; return null; };
    const list = grid ?? tools.grid(band ? 'gallery-today' : 'gallery-wide');
    for (const [sign, words] of SWAY_TURNS) {
      const seconds = find(sign);
      if (seconds === null) continue;
      const images = [];
      for (const mood of moods) {
        core.setMood(mood);
        clock.ms = seconds * 1000;
        draw(seconds);
        const img = await picture(renderer, size);
        images.push(band ? banded(img, size) : img);
      }
      list.append(tools.card(`day ${entry.day}, ${sign ? `${words} ${SWAY.degrees}°` : words}`, `${seconds} s · ${moods.join(' · ')} · ${framing(core)}, distance ${core.stage.look.distance.toFixed(1)}`, images));
    }
  } finally { core.dispose(); }
}
const SWAY_NOTE = `The sway is the default camera: the view turns slowly up to ${SWAY.degrees}° left and right of north and back, one whole swing every ${SWAY.seconds} s, even with one island (with more, it also takes the drift's trips). Each view turns around its own middle, along an ellipse fitted to the islands' shape: facing north it is framed exactly as without the sway, and near the ends of the swing an edge may slip out of the picture. These are the busy view at each end of the swing and at its middle, to check join walls, the north coast, shadows, the sun's side and models' backs.`;
const SWAY_BIG = [1400, 846];

export default {
  id: 'town',
  title: 'Town scene (stream E): worlds with the follow camera, film, moods, camera moves, the drift, the sway and speed',
  sections: [
    {
      id: 'states', title: 'States, large and at Today\'s size (591 × 357), with the follow camera',
      async render(host, tools) {
        if (!realStates(tools)) tools.note(`No drawn town states yet (${tools.data.town.note || 'the layout is still a stub'}), so these are the sample towns.`);
        const grid = tools.grid('gallery-wide');
        for (const { label, world } of stateList(tools)) {
          const large = await tools.worldShot(world, 'focus', { width: LARGE[0], height: LARGE[1] });
          const today = await tools.worldShot(world, 'focus', { width: TODAY[0], height: TODAY[1] });
          grid.append(tools.card(label, describe(world), [large, today]));
        }
      },
    },
    {
      id: 'film', title: 'The growth film',
      async render(host, tools) {
        if (!realStates(tools)) tools.note('Sample films until the real states are drawn. Each picture uses the follow camera.');
        const grid = tools.grid('gallery-medium');
        for (const { label, world } of filmList(tools)) grid.append(tools.card(label, describe(world), [await tools.worldShot(world, 'focus', { width: FILM[0], height: FILM[1] })]));
      },
    },
    {
      id: 'moods', title: 'All four moods at day 180, at Today\'s size',
      async render(host, tools) {
        const { label, world } = bigWorld(tools);
        tools.note(label);
        const grid = tools.grid('gallery-today');
        for (const mood of tools.MOODS) grid.append(tools.card(mood, '', [await tools.worldShot(world, mood, { width: TODAY[0], height: TODAY[1] })]));
      },
    },
    {
      id: 'framing', title: 'Where the follow camera looks, at Today\'s size (dots stand in for undrawn ground)',
      async render(host, tools) {
        tools.note('Green dots: land (darker on the coast); cream: lanes; boxes: blocks (by colour pair and storeys) and things; lines: bridges (rope brown, fancy pink), straight along each end\'s way out for its clear, then across. Each picture says whether the view island is framed whole or close.');
        const grid = tools.grid('gallery-today');
        const list = [...stateList(tools), ...filmList(tools)];
        const seen = new Set();
        for (const { label, world } of list) {
          if (seen.has(world)) continue;
          seen.add(world);
          const { core, draw, renderer } = coreAt(TODAY);
          try {
            core.setWorld(world);
            const clear = placeholders(core);
            draw();
            const scale = core.actors.rigs[0] ? (core.actors.rigs[0].root.scale.x / 0.48).toFixed(2) : '-';
            grid.append(tools.card(label, `${framing(core)} · helper boost ${scale}`, [await picture(renderer, TODAY)]));
            clear();
          } finally { core.dispose(); }
        }
      },
    },
    {
      id: 'camera', title: 'A check-in that moves the camera: before, half way, after',
      async render(host, tools) {
        const pair = cameraPair(tools);
        if (!pair) { tools.note('No two states to compare.'); return; }
        const { core, clock, draw, renderer } = coreAt(TODAY);
        try {
          let clear = () => {};
          core.setWorld(pair[0].world);
          clear = placeholders(core);
          draw();
          const before = await picture(renderer, TODAY);
          const was = framing(core);
          clear();
          core.setWorld(pair[1].world);
          clear = placeholders(core);
          const moved = core.moving;
          clock.ms = AIM_SECONDS * 500;
          draw(1);
          const half = await picture(renderer, TODAY);
          clock.ms = AIM_SECONDS * 1000 + 1;
          draw(2);
          const after = await picture(renderer, TODAY);
          clear();
          tools.note(`${pair[0].label} → ${pair[1].label}. The move takes ${AIM_SECONDS} s${moved ? '' : ' (here the view did not change, so it stayed put)'}. Dots, boxes and lines stand in for islands and bridges that are not drawn yet.`);
          const grid = tools.grid('gallery-today');
          grid.append(tools.card(`before: ${pair[0].label}`, was, [before]));
          grid.append(tools.card('half way', `${AIM_SECONDS / 2} s in`, [half]));
          grid.append(tools.card(`after: ${pair[1].label}`, framing(core), [after]));
        } finally { core.dispose(); }
      },
    },
    {
      id: 'drift-early', title: 'The drift, day 21 (two islands): rests and moves at Today\'s size, focus and break',
      async render(host, tools) { await driftPictures(tools, steadyDay(tools, 21)); },
    },
    {
      id: 'drift-month', title: 'The drift, day 30 (three islands): rests and moves at Today\'s size, focus and break',
      async render(host, tools) { await driftPictures(tools, steadyDay(tools, 30)); },
    },
    {
      id: 'drift-year', title: 'The drift, day 180 (five islands): rests and moves at Today\'s size, focus and break',
      async render(host, tools) { await driftPictures(tools, steadyDay(tools, 180)); },
    },
    {
      id: 'sway-first', title: 'The sway, day 1 (one island): both ends of the swing and the middle, big, focus and break',
      async render(host, tools) { tools.note(SWAY_NOTE); await swayPictures(tools, steadyDay(tools, 1), SWAY_BIG); },
    },
    {
      id: 'sway-week', title: 'The sway, day 7 (one island): both ends of the swing and the middle, big, focus and break',
      async render(host, tools) { tools.note(SWAY_NOTE); await swayPictures(tools, steadyDay(tools, 7), SWAY_BIG); },
    },
    {
      id: 'sway-month', title: 'The sway, day 30 (three islands): both ends of the swing and the middle, big, focus and break',
      async render(host, tools) { tools.note(SWAY_NOTE); await swayPictures(tools, steadyDay(tools, 30), SWAY_BIG); },
    },
    {
      id: 'sway-year', title: 'The sway, day 180 (five islands): both ends of the swing and the middle, big, focus and break',
      async render(host, tools) { tools.note(SWAY_NOTE); await swayPictures(tools, steadyDay(tools, 180), SWAY_BIG); },
    },
    {
      id: 'sway-today', title: 'The sway at Today\'s size, with the top band: both ends of the swing and the middle',
      async render(host, tools) {
        tools.note(`${SWAY_NOTE} The faint band is the top ${CLEAR_TOP} px kept clear for the resource bar.`);
        const grid = tools.grid('gallery-today');
        for (const day of [1, 7, 21, 30, 60, 180]) await swayPictures(tools, steadyDay(tools, day), TODAY, { moods: ['focus'], band: true, grid });
      },
    },
    {
      id: 'speed', title: 'Speed at Today\'s size, against the budgets',
      async render(host, tools) {
        const { label, world, game } = bigWorld(tools);
        const { core, draw, renderer } = coreAt(TODAY);
        const { gl } = ownRenderer();
        const rows = [];
        try {
          // Layout time, with grids already cached.
          let layoutMs = null;
          if (game) { buildTown(game); const t0 = now(); buildTown(game); layoutMs = now() - t0; }
          // Everything built, then one island rebuilt (the view island loses its newest land point).
          core.setWorld(world);
          const allMs = core.lastReport.ms;
          const changed = { ...world, islands: world.islands.map(i => (i.id !== (world.view.island ?? world.islands[0]?.id) ? i : { ...i, land: i.land.slice(0, -1) })) };
          core.setWorld(changed, { ease: false });
          const one = Math.max(0, ...Object.values(core.lastReport.islandMs));
          core.setWorld(world, { ease: false });
          // Two frames: the first also draws the shadow map; the second is a normal frame.
          draw(0);
          const shadowCalls = renderer.info.render.calls;
          draw(0.1);
          const { triangles, calls } = renderer.info.render;
          // Frame time: update, render and wait for the GPU, averaged over 60 frames.
          const t0 = now();
          for (let i = 0; i < 60; i++) { draw(i / 30); gl.finish(); }
          const frameMs = (now() - t0) / 60;
          const stats = core.stats();
          const ok = (value, budget) => (value <= budget ? 'within' : 'OVER');
          const all = sceneTriangles(core.scene);
          rows.push(['Triangles in the scene', all.toLocaleString(), BUDGET.triangles.toLocaleString(), ok(all, BUDGET.triangles)]);
          rows.push(['  in islands and bridges', stats.triangles.toLocaleString(), '', '']);
          rows.push(['  drawn this frame (the rest is out of view)', triangles.toLocaleString(), '', '']);
          rows.push(['Draw calls in a frame', calls, BUDGET.calls, ok(calls, BUDGET.calls)]);
          rows.push(['  with the shadow map redrawn', shadowCalls, '', '']);
          rows.push(['  island and bridge meshes', stats.meshes, '', '']);
          rows.push(['Frame time (ms, with GPU wait)', frameMs.toFixed(2), BUDGET.frameMs, ok(frameMs, BUDGET.frameMs)]);
          rows.push(['Rebuild one island (ms)', one.toFixed(1), BUDGET.islandMs, ok(one, BUDGET.islandMs)]);
          rows.push(['Build everything (ms)', allMs.toFixed(1), BUDGET.allMs, ok(allMs, BUDGET.allMs)]);
          if (layoutMs !== null) rows.push(['buildTown, grids cached (ms)', layoutMs.toFixed(1), BUDGET.layoutMs, ok(layoutMs, BUDGET.layoutMs)]);
          tools.note(`${label}: ${describe(world)}. ${stats.islands} islands and ${stats.bridges} bridges built; ${framing(core)}.`);
          const table = document.createElement('table');
          table.className = 'gallery-speed';
          table.style.cssText = 'border-collapse:collapse;font:13px ui-sans-serif,-apple-system,sans-serif;margin:8px 0;';
          table.innerHTML = `<tr><th>Measure</th><th>Now</th><th>Budget</th><th></th></tr>${rows.map(r => `<tr>${r.map(c => `<td style="padding:3px 12px;border-bottom:1px solid #0001">${tools.escape(c)}</td>`).join('')}</tr>`).join('')}`;
          host.append(table);
          const grid = tools.grid('gallery-today');
          grid.append(tools.card('the measured frame', '', [await picture(renderer, TODAY)]));
          globalThis.townSpeed = Object.fromEntries(rows.map(r => [r[0].trim(), r[1]]));
        } finally { core.dispose(); }
      },
    },
  ],
};
