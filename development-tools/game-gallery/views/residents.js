// Disposable animal art experiment. Nothing here ships or writes game facts.
import * as THREE from 'three';
import { createSceneCore, CLEAR_TOP } from '../../../electron/renderer/game/scene/core.js';
import { buildHelper, helperMaterials, HELPER_SCALE } from '../../../electron/renderer/game/scene/helpers.js';
import { lookFor, P } from '../../../electron/renderer/game/scene/style.js';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { createCat } from '../residents/cat.js';
import { residentRoute, residentMoment } from '../residents/placement.mjs';

const SIZE = [591, 357];
let renderer;
function newRenderDevice() {
  const device = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  device.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  device.outputColorSpace = THREE.SRGBColorSpace;
  device.toneMapping = THREE.NoToneMapping;
  device.shadowMap.enabled = true;
  device.shadowMap.type = THREE.PCFShadowMap;
  device.setSize(...SIZE, false);
  return device;
}
const renderDevice = () => (renderer ??= newRenderDevice());

async function townShot(world, mood, time, withCat) {
  const device = renderDevice();
  const core = createSceneCore({ now: () => 0 });
  let cat;
  try {
    core.resize(...SIZE);
    core.cameraStyle = 'still';
    core.setWorld(world, { ease: false });
    core.setMood(mood);
    core.update(time);
    const route = residentRoute(core.model);
    if (withCat && route) {
      cat = createCat();
      // The same Today-size boost as the helpers (core.js aim), as the normal scene gives its cat.
      const helper = core.actors.rigs[0]?.root;
      if (helper) cat.root.scale.setScalar(helper.scale.x / HELPER_SCALE);
      const moment = residentMoment(time, route);
      cat.pose(moment.pose, moment.time, moment.rig);
      cat.root.position.fromArray(moment.position);
      cat.root.rotation.y = moment.yaw;
      core.scene.add(cat.root);
    }
    // Framing is fixed by the unchanged world, before the cat is added.
    device.shadowMap.needsUpdate = true;
    device.render(core.scene, core.camera);
    const image = document.createElement('img');
    image.width = SIZE[0]; image.height = SIZE[1];
    image.alt = `${mood} town ${withCat ? 'with' : 'without'} resident at ${time} seconds`;
    image.src = device.domElement.toDataURL('image/png');
    await image.decode();
    image.dataset.residentRoute = JSON.stringify(route?.points ?? []);
    return image;
  } finally {
    cat?.dispose();
    core.dispose();
  }
}

// The normal scene with a saved resident, held still the way reduced motion holds it: in done and away
// the cat lies curled and the helpers sleep.
async function stillShot(world, mood) {
  const device = renderDevice();
  const core = createSceneCore({ now: () => 0 });
  try {
    core.resize(...SIZE);
    core.cameraStyle = 'still';
    core.setWorld(world, { ease: false });
    core.setMood(mood);
    core.update(0, true);
    device.shadowMap.needsUpdate = true;
    device.render(core.scene, core.camera);
    const image = document.createElement('img');
    image.width = SIZE[0]; image.height = SIZE[1];
    image.alt = `${mood} town with its resident, held still`;
    image.src = device.domElement.toDataURL('image/png');
    await image.decode();
    return image;
  } finally { core.dispose(); }
}

function band(image) {
  const box = document.createElement('div');
  box.style.cssText = `position:relative;width:${SIZE[0]}px;height:${SIZE[1]}px`;
  const top = document.createElement('div');
  top.style.cssText = `position:absolute;left:0;right:0;top:0;height:${CLEAR_TOP}px;background:#ffffff30;border-bottom:1px dashed #ffffff80;pointer-events:none`;
  box.append(image, top);
  return box;
}

function townSection(id, title, day, mood, times) {
  return {
    id, title,
    async render(host, tools) {
      tools.note('Same world, camera and scene time on both sides. One resident; no new buildings, saved facts or resource effects. The faint band marks the resource bar.');
      const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === day && s.world);
      if (!entry) { tools.note(`Missing gallery fixture for day ${day}.`); return; }
      for (const time of times) {
        const row = tools.grid();
        for (const enabled of [false, true]) {
          const image = await townShot(entry.world, mood, time, enabled);
          const label = enabled ? 'With resident' : 'Original scene';
          row.append(tools.card(label, `${mood} · ${time} s · ${SIZE.join(' × ')} px`, [band(image)]));
        }
      }
    },
  };
}

// A disposable, explicitly started preview. Hidden time never advances this clock, and navigating
// away tears down its WebGL scene instead of leaving another renderer running behind the gallery.
function livePreview(host, world) {
  const wrapper = document.createElement('div');
  wrapper.dataset.residentPreview = 'paused';
  host.append(wrapper);
  const controls = document.createElement('div');
  controls.className = 'gallery-note';
  controls.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
  const play = document.createElement('button');
  play.dataset.residentControl = 'play';
  play.type = 'button'; play.textContent = 'Play';
  const reset = document.createElement('button');
  reset.dataset.residentControl = 'reset';
  reset.type = 'button'; reset.textContent = 'Reset';
  const scrub = document.createElement('input');
  scrub.dataset.residentControl = 'time';
  scrub.type = 'range'; scrub.min = '0'; scrub.max = '64'; scrub.step = '0.05'; scrub.value = '0';
  scrub.setAttribute('aria-label', 'Preview time in seconds');
  scrub.style.width = '280px';
  const label = document.createElement('output');
  label.dataset.residentControl = 'time-label';
  const mood = document.createElement('select');
  mood.dataset.residentControl = 'mood';
  mood.setAttribute('aria-label', 'Preview lighting');
  for (const name of ['focus', 'break']) { const option = document.createElement('option'); option.value = name; option.textContent = name; mood.append(option); }
  controls.append(play, reset, scrub, label, mood);
  wrapper.append(controls);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const device = newRenderDevice(), core = createSceneCore({ now: () => 0 });
  const cat = createCat();
  let disposed = false, running = false, frame = 0, last = null, time = 0;
  let observer;
  const pause = () => {
    running = false; last = null; cancelAnimationFrame(frame); frame = 0;
    play.textContent = 'Play'; wrapper.dataset.residentPreview = 'paused';
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true; pause(); wrapper.dataset.residentPreview = 'disposed'; observer?.disconnect();
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', cleanup);
    window.removeEventListener('hashchange', cleanup);
    media.removeEventListener('change', reduced);
    cat.dispose(); core.dispose(); device.dispose(); device.forceContextLoss();
  };
  const draw = () => {
    if (disposed) return;
    core.update(time, media.matches);
    const moment = residentMoment(time, route, media.matches);
    cat.pose(moment.pose, moment.time, moment.rig);
    cat.root.position.fromArray(moment.position); cat.root.rotation.y = moment.yaw;
    device.shadowMap.needsUpdate = true;
    device.render(core.scene, core.camera);
    scrub.value = String(time); label.value = `${time.toFixed(1)} / 64 s${media.matches ? ' · reduced motion: resting' : ''}`;
    wrapper.dataset.time = String(time);
  };
  const tick = timestamp => {
    frame = 0;
    if (disposed || !running) return;
    if (!wrapper.isConnected) { cleanup(); return; }
    if (document.hidden) { pause(); return; }
    // A throttled or suspended frame does not cause a jump through the resident's routine.
    if (last !== null) time = (time + Math.min(0.1, Math.max(0, timestamp - last) / 1000)) % 64;
    last = timestamp; draw(); frame = requestAnimationFrame(tick);
  };
  const hidden = () => { if (document.hidden) pause(); };
  const reduced = () => {
    pause(); play.disabled = media.matches; scrub.disabled = media.matches;
    if (media.matches) time = 0;
    draw();
  };
  let route;
  try {
    core.resize(...SIZE); core.cameraStyle = 'still'; core.setWorld(world, { ease: false }); core.setMood('focus');
    route = residentRoute(core.model);
    if (!route) throw new Error('No safe resident site in this fixture.');
    core.scene.add(cat.root);
    const canvas = device.domElement;
    canvas.style.cssText = `display:block;width:${SIZE[0]}px;height:${SIZE[1]}px`;
    canvas.setAttribute('aria-label', 'Early island with a resident cat');
    canvas.setAttribute('role', 'img');
    wrapper.append(band(canvas));
    play.addEventListener('click', () => {
      if (running) { pause(); return; }
      if (media.matches || document.hidden || disposed) return;
      running = true; last = null; play.textContent = 'Pause'; wrapper.dataset.residentPreview = 'playing';
      frame = requestAnimationFrame(tick);
    });
    reset.addEventListener('click', () => { pause(); time = 0; draw(); });
    scrub.addEventListener('input', () => { pause(); time = media.matches ? 0 : Number(scrub.value); draw(); });
    mood.addEventListener('change', () => { core.setMood(mood.value); draw(); });
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', cleanup);
    window.addEventListener('hashchange', cleanup);
    media.addEventListener('change', reduced);
    observer = new MutationObserver(() => { if (!wrapper.isConnected) cleanup(); });
    observer.observe(document.body, { childList: true, subtree: true });
    reduced();
  } catch (error) { cleanup(); throw error; }
}

export default {
  id: 'residents',
  title: 'Resident cat — gallery experiment',
  sections: [
    {
      id: 'production', title: 'Saved resident in the normal scene',
      async render(host, tools) {
        tools.note('The normal scene consumes a resident fact. No gallery-only figure is added to these pictures.');
        const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === 7 && s.world);
        if (!entry) { tools.note('Missing early-town fixture.'); return; }
        const world = { ...entry.world, residents: [{ id: 'gallery-resident', kind: 'cat', island: 'home', appearanceSeed: 7, arrivedAtCheckIn: 1 }] };
        const row = tools.grid();
        for (const mood of ['focus', 'break']) row.append(tools.card(mood, 'Normal scene · saved resident', [await tools.worldShot(world, mood, { width: SIZE[0], height: SIZE[1] })]));
      },
    },
    {
      id: 'sleep', title: 'Asleep beside the helpers',
      async render(host, tools) {
        tools.note('Normal scene, done mood, held still. The cat sleeps on its own spot, at least a lying helper\'s length from every sleeping helper. Days 40 and 90 have the closest helpers of the saved towns.');
        const row = tools.grid();
        for (const day of [7, 40, 90]) {
          const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === day && s.world);
          if (!entry) { tools.note(`Missing gallery fixture for day ${day}.`); continue; }
          const world = { ...entry.world, residents: [{ id: 'gallery-resident', kind: 'cat', island: 'home', appearanceSeed: 7, arrivedAtCheckIn: 1 }] };
          row.append(tools.card(`Day ${day}`, `done · ${SIZE.join(' × ')} px`, [band(await stillShot(world, 'done'))]));
        }
      },
    },
    {
      id: 'motion', title: 'Resident motion preview',
      async render(host, tools) {
        tools.note('Press Play to watch the full 64-second routine, or scrub to inspect a transition. It starts paused, uses the normal Today camera, and pauses when hidden. Reduced motion keeps the scene resting.');
        const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === 1 && s.world);
        if (!entry) { tools.note('Missing early-town fixture.'); return; }
        livePreview(host, entry.world);
      },
    },
    {
      id: 'transitions', title: 'Held transition samples',
      async render(host, tools) {
        tools.note('Enlarged samples for inspecting the pose blend. The live preview decides how movement feels at normal scale.');
        const row = tools.grid();
        const route = { points: [0, 1], from: [0, 0, 0], to: [0.4, 0, 0] };
        for (const time of [21, 22.5, 26, 29.5, 40, 52.5]) {
          const moment = residentMoment(time, route);
          const image = await tools.shot(ctx => {
            ctx.add(new THREE.BoxGeometry(0.8, 0.08, 0.8), 'matte', P.grass, place(0, -0.04, 0), null, false);
            const cat = createCat();
            cat.pose(moment.pose, moment.time, moment.rig); cat.root.rotation.y = -0.35;
            ctx.root.add(cat.root); ctx.track(cat);
          }, { mood: 'focus', width: 280, height: 200, aim: [[-0.4, 0, -0.4], [0.4, 0.4, 0.4]] });
          row.append(tools.card(`${time} s`, moment.pose, [image]));
        }
      },
    },
    {
      id: 'poses', title: 'Silhouette and scale',
      async render(host, tools) {
        tools.note('Inspection view only: sitting, curled rest and held walking pose at the same world scale as a helper. Today-size views below decide readability.');
        const row = tools.grid();
        for (const mood of ['focus', 'break']) {
          const image = await tools.shot(ctx => {
            ctx.add(new THREE.BoxGeometry(2.6, 0.08, 1), 'matte', P.grass, place(0, -0.04, 0), null, false);
            for (const [i, state] of ['sit', 'rest', 'walk'].entries()) {
              const cat = createCat();
              cat.pose(state, state === 'walk' ? 0.35 : 0);
              cat.root.position.set(-0.9 + i * 0.55, 0, 0);
              cat.root.rotation.y = -0.35;
              ctx.root.add(cat.root);
              ctx.track(cat);
            }
            const materials = helperMaterials();
            ctx.track(materials);
            const helper = buildHelper(lookFor({ name: 'Pip', job: 'wood' }, 0), materials);
            helper.root.position.set(0.95, 0, 0);
            ctx.root.add(helper.root);
          }, { mood, width: 560, height: 270, aim: [[-1.4, 0, -0.5], [1.4, 0.5, 0.5]] });
          row.append(tools.card(mood, 'Sitting · resting · walking · helper', [image]));
        }
      },
    },
    townSection('early', 'Early town at Today size', 1, 'focus', [0, 26]),
    townSection('break', 'Early town at break', 1, 'break', [40]),
    townSection('mature', 'Mature town — internal density check', 180, 'focus', [0, 26]),
    {
      id: 'review', title: 'Dusk rest and mature density — internal review',
      async render(host, tools) {
        tools.note('Held poses only. Left: resting at dusk. Right: one resident among the existing mature scene. No camera reframing for the animal.');
        const row = tools.grid();
        for (const [day, mood, time, label] of [[1, 'break', 40, 'Early town · resting'], [180, 'focus', 0, 'Mature town · seated']]) {
          const entry = tools.data.town.states.find(s => s.person === 'steady' && s.day === day && s.world);
          if (!entry) { tools.note(`Missing gallery fixture for day ${day}.`); continue; }
          row.append(tools.card(label, `${mood} · ${time} s · ${SIZE.join(' × ')} px`, [band(await townShot(entry.world, mood, time, true))]));
        }
      },
    },
  ],
};
