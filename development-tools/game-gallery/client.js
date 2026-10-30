// Gallery page for the sky-island scene. Bundled with three and the scene by build.js. Never ships.
// Sections are picked by the URL hash:
//   #kinds (or #kinds-nature, #kinds-buildings, #kinds-wonders)  a portrait of every kind, focus and break
//   #kind-<kind>                                                 one kind, large
//   #helpers                                                     work, carry and rest poses
//   #worlds                                                      sample worlds in every mood
//   #world-<name>-<mood>                                         one sample world, large
//   #live-<name>-<mood>                                          one sample world, animated
//   #state-day-<n>                                               a made-up game state through the real layout
// Every portrait is drawn by one hidden scene and copied into an image, because a page can only hold a
// few WebGL canvases. window.galleryReady turns true when the section has finished drawing.
import { KINDS } from '../../electron/renderer/game/kinds.js';
import { createIslandScene } from '../../electron/renderer/game/scene/index.js';
import { hasModel } from '../../electron/renderer/game/scene/models/index.js';
import { SAMPLE_WORLDS, kindWorld, poseWorld } from '../../electron/renderer/game/scene/sample-worlds.js';

const DATA = globalThis.GALLERY ?? { states: [], stateNote: '' };
const MOODS = ['focus', 'break', 'away', 'done'];
const NATURE = ['tree', 'rock', 'bush', 'flower', 'pile', 'fire', 'seat', 'mushroom', 'crystal'];
const WONDERS = ['lighthouse', 'airship', 'observatory', 'skyfall', 'aurora'];
const BUILDINGS = Object.keys(KINDS).filter(kind => !NATURE.includes(kind) && !WONDERS.includes(kind));
const KIND_GROUPS = { nature: NATURE, buildings: BUILDINGS, wonders: WONDERS };

const POSES = [
  { group: 'Work', label: 'Chop (wood)', mood: 'focus', pose: { anim: 'chop', tool: 'axe', job: 'wood', prop: 'tree', at: [2.8, 1.35] } },
  { group: 'Work', label: 'Mine (stone)', mood: 'focus', pose: { anim: 'mine', tool: 'pick', job: 'stone', prop: 'rock', at: [2.8, 1.35] } },
  { group: 'Work', label: 'Saw (planks)', mood: 'focus', pose: { anim: 'saw', tool: 'saw', job: 'planks', prop: 'sawmill', at: [2.75, 1.15] } },
  { group: 'Work', label: 'Hoe (soil)', mood: 'focus', pose: { anim: 'hoe', tool: 'hoe', job: 'soil', prop: 'garden', at: [2.75, 1.15] } },
  { group: 'Work', label: 'Water (saplings)', mood: 'focus', pose: { anim: 'water', tool: 'can', job: 'saplings', prop: 'nursery', at: [2.75, 1.15] } },
  { group: 'Carry', label: 'Log', mood: 'focus', pose: { anim: 'walk', carry: 'log', job: 'wood', yaw: 1.1 } },
  { group: 'Carry', label: 'Stone', mood: 'focus', pose: { anim: 'walk', carry: 'stone', job: 'stone', yaw: 1.1 } },
  { group: 'Carry', label: 'Plank', mood: 'focus', pose: { anim: 'walk', carry: 'plank', job: 'planks', yaw: 1.1 } },
  { group: 'Carry', label: 'Soil sack', mood: 'focus', pose: { anim: 'walk', carry: 'sack', job: 'soil', yaw: 1.1 } },
  { group: 'Carry', label: 'Sapling', mood: 'focus', pose: { anim: 'walk', carry: 'sapling', job: 'saplings', yaw: 1.1 } },
  { group: 'Carry', label: 'Drop at pile', mood: 'focus', pose: { anim: 'drop', carry: 'log', job: 'wood', prop: 'pile', local: 0.3 } },
  { group: 'Rest', label: 'Sit on a log', mood: 'break', pose: { anim: 'sit', prop: 'seat', seat: 0.11, yaw: 0.75 } },
  { group: 'Rest', label: 'Sit by the fire', mood: 'break', pose: { anim: 'sit', prop: 'fire', seat: 0.02, at: [2.95, 1.05] } },
  { group: 'Rest', label: 'Stretch', mood: 'break', pose: { anim: 'stretch', local: 5, yaw: 0.3 } },
  { group: 'Rest', label: 'Nap', mood: 'break', pose: { anim: 'nap' } },
  { group: 'Rest', label: 'Fish off the edge', mood: 'break', pose: { anim: 'fish', at: [2, 4.42], yaw: 0 } },
  { group: 'Rest', label: 'Stroll', mood: 'break', pose: { anim: 'walk', yaw: 1.5 } },
  { group: 'Rest', label: 'Look around', mood: 'away', pose: { anim: 'look', local: 1.0, yaw: 0.25 } },
  { group: 'Rest', label: 'Asleep (day done)', mood: 'done', pose: { anim: 'sleep' } },
];

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const main = $('#gallery-main');

// One hidden scene draws every portrait in turn.
const stage = document.createElement('div');
stage.className = 'gallery-stage';
document.body.append(stage);
const scene = createIslandScene(stage);

async function portrait(world, mood, width, height) {
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  scene.setWorld(world);
  scene.setMood(mood);
  const canvas = await scene.capture();
  const img = document.createElement('img');
  img.width = width; img.height = height;
  img.alt = '';
  if (canvas) img.src = canvas.toDataURL('image/png');
  else img.className = 'gallery-missing';
  await new Promise(resolve => { if (!canvas || img.complete) resolve(); else { img.onload = resolve; img.onerror = resolve; } });
  return img;
}

function card(title, note, images) {
  const el = document.createElement('figure');
  el.className = 'gallery-card';
  el.innerHTML = `<figcaption><strong>${escape(title)}</strong>${note ? ` <span>${escape(note)}</span>` : ''}</figcaption><div class="gallery-images"></div>`;
  el.querySelector('.gallery-images').append(...images);
  return el;
}

function heading(text, note = '') {
  const el = document.createElement('h2');
  el.innerHTML = `${escape(text)}${note ? ` <small>${escape(note)}</small>` : ''}`;
  main.append(el);
}

function gridEl(className = '') {
  const el = document.createElement('div');
  el.className = `gallery-grid ${className}`;
  main.append(el);
  return el;
}

async function showKinds(group) {
  const groups = group ? { [group]: KIND_GROUPS[group] ?? [] } : KIND_GROUPS;
  for (const [name, kinds] of Object.entries(groups)) {
    heading(name[0].toUpperCase() + name.slice(1), 'focus, then break');
    const grid = gridEl('gallery-kinds');
    for (const kind of kinds) {
      const world = kindWorld(kind);
      const size = KINDS[kind].size;
      const images = [await portrait(world, 'focus', 200, 170), await portrait(world, 'break', 200, 170)];
      grid.append(card(kind, `${size[0]}×${size[1]}${hasModel(kind) ? '' : ' · placeholder'}`, images));
    }
  }
}

async function showKind(kind) {
  if (!KINDS[kind]) { heading(`Unknown kind: ${kind}`); return; }
  heading(kind, hasModel(kind) ? 'model' : 'placeholder');
  const grid = gridEl('gallery-large');
  const world = kindWorld(kind);
  for (const mood of MOODS) grid.append(card(mood, '', [await portrait(world, mood, 640, 440)]));
}

async function showHelpers() {
  let group = '';
  let grid = null;
  for (const item of POSES) {
    if (item.group !== group) { group = item.group; heading(group); grid = gridEl('gallery-poses'); }
    const world = poseWorld(item.pose);
    grid.append(card(item.label, item.mood, [await portrait(world, item.mood, 250, 220)]));
  }
}

async function showWorlds() {
  for (const [key, { name, world }] of Object.entries(SAMPLE_WORLDS)) {
    heading(name, `#world-${key}-<mood> for a large view`);
    const grid = gridEl('gallery-moods');
    for (const mood of MOODS) grid.append(card(mood, '', [await portrait(world, mood, 330, 220)]));
  }
}

async function showWorld(key, mood) {
  const sample = SAMPLE_WORLDS[key];
  if (!sample) { heading(`Unknown world: ${key}`); return; }
  heading(`${sample.name} · ${mood}`);
  const width = Math.max(320, window.innerWidth - 32), height = Math.max(240, window.innerHeight - 90);
  main.append(await portrait(sample.world, MOODS.includes(mood) ? mood : 'focus', width, height));
}

async function showLive(key, mood) {
  const sample = SAMPLE_WORLDS[key];
  if (!sample) { heading(`Unknown world: ${key}`); return; }
  heading(`${sample.name} · ${mood} · live`);
  const host = document.createElement('div');
  host.className = 'gallery-live';
  main.append(host);
  const live = createIslandScene(host);
  live.setWorld(sample.world);
  live.setMood(mood);
  await new Promise(resolve => setTimeout(resolve, 1500));
}

async function showState(name) {
  const entry = DATA.states.find(state => state.name === name);
  if (!entry) { heading(`No state named ${name}`, DATA.stateNote); return; }
  heading(`${name} (through the real layout)`, entry.summary ?? '');
  if (entry.error) { main.insertAdjacentHTML('beforeend', `<p class="gallery-note">The layout failed: ${escape(entry.error)}</p>`); return; }
  const grid = gridEl('gallery-large');
  for (const mood of ['focus', 'break', 'done']) grid.append(card(mood, '', [await portrait(entry.world, mood, 640, 420)]));
}

async function showIndex() {
  heading('Sections');
  const links = ['#kinds', '#kinds-nature', '#kinds-buildings', '#kinds-wonders', '#helpers', '#worlds',
    ...Object.keys(SAMPLE_WORLDS).flatMap(key => MOODS.map(mood => `#world-${key}-${mood}`)),
    ...DATA.states.map(state => `#${state.name}`)];
  main.insertAdjacentHTML('beforeend', `<ul class="gallery-links">${links.map(link => `<li><a href="${link}">${link}</a></li>`).join('')}</ul>`);
  if (!DATA.states.length) main.insertAdjacentHTML('beforeend', `<p class="gallery-note">${escape(DATA.stateNote || 'No layout states.')}</p>`);
}

function nav() {
  const links = ['#kinds', '#helpers', '#worlds', ...DATA.states.map(state => `#${state.name}`), '#index'];
  $('#gallery-nav').innerHTML = links.map(link => `<a href="${link}" ${location.hash === link ? 'aria-current="page"' : ''}>${link.slice(1)}</a>`).join('');
}

async function render() {
  window.galleryReady = false;
  const hash = decodeURIComponent(location.hash.slice(1)) || 'worlds';
  nav();
  main.textContent = '';
  try {
    let match;
    if (hash === 'kinds') await showKinds();
    else if ((match = hash.match(/^kinds-(\w+)$/))) await showKinds(match[1]);
    else if ((match = hash.match(/^kind-(\w+)$/))) await showKind(match[1]);
    else if (hash === 'helpers') await showHelpers();
    else if (hash === 'worlds') await showWorlds();
    else if ((match = hash.match(/^world-(\w+)-(\w+)$/))) await showWorld(match[1], match[2]);
    else if ((match = hash.match(/^live-(\w+)-(\w+)$/))) await showLive(match[1], match[2]);
    else if (hash.startsWith('state-')) await showState(hash);
    else await showIndex();
  } catch (error) {
    console.error(error);
    main.insertAdjacentHTML('beforeend', `<p class="gallery-note">Gallery failed: ${escape(error.message)}</p>`);
  }
  // Two frames later the images are on screen; then a screenshot can be taken. (A hidden window may not
  // run animation frames, so a short timer stands in.)
  const ready = () => { window.galleryReady = true; };
  requestAnimationFrame(() => requestAnimationFrame(ready));
  setTimeout(ready, 300);
}

window.addEventListener('hashchange', () => location.reload());
render();
