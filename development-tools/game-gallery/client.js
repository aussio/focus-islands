// Gallery page for the sky-island scene. Bundled with three and the scene by build.js. Never ships.
// build.js writes a small entry that loads every views/*.js and calls start(views).
//
// Views (development-tools/game-gallery/views/<file>.js) export
//   default { id, title, sections: [{ id, title, render: async (host, tools) => {} }] }
// and are picked by the hash, before the older sections below:
//   #<viewId>                                                    every section of a view
//   #<viewId>-<sectionId>                                        one section
// tools are in tools.js. A view that fails to load, or a section that throws, shows its error in its
// place and leaves the others working.
//
// The older sections:
//   #kinds (or #kinds-nature, #kinds-buildings, #kinds-wonders)  a portrait of every kind, focus and break
//   #kind-<kind>                                                 one kind, large
//   #helpers                                                     work, carry and rest poses
//   #worlds                                                      sample worlds in every mood
//   #world-<name>-<mood>                                         one sample world, large
//   #live-<name>-<mood>                                          one sample world, animated
//   #state-day-<n>                                               a made-up game state through the real layout
// Every portrait is drawn by one hidden scene and copied into an image, because a page can only hold a
// few WebGL canvases. window.galleryReady turns true when the chosen sections have finished drawing.
import { KINDS } from '../../electron/renderer/game/kinds.js';
import { createIslandScene } from '../../electron/renderer/game/scene/index.js';
import { hasModel } from '../../electron/renderer/game/scene/models/index.js';
import { SAMPLE_WORLDS, kindWorld, poseWorld } from '../../electron/renderer/game/scene/sample-worlds.js';
import { MOOD_NAMES as MOODS, card, data as DATA, escape, heading as headingEl, toolsFor, worldShot } from './tools.js';
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
const main = $('#gallery-main');
let VIEWS = []; // [{ file, id, view, error }]

const portrait = (world, mood, width, height) => worldShot(world, mood, { width, height });

function heading(text, note = '') {
  main.append(headingEl(text, note));
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

// ---------- Views ----------
const VIEW_ID = /^[\w-]{1,60}$/;

// Checks what a view file gave, so a broken view says what is wrong instead of failing later.
function checkView(entry) {
  const fileId = entry.file.replace(/\.js$/, '');
  if (entry.error) return { ...entry, id: fileId };
  const view = entry.view;
  if (!view || typeof view !== 'object') return { ...entry, id: fileId, error: 'The file has no default export.' };
  const id = typeof view.id === 'string' && VIEW_ID.test(view.id) ? view.id : null;
  if (!id) return { ...entry, id: fileId, error: `The view id ${JSON.stringify(view.id)} must be letters, numbers, - or _.` };
  if (!Array.isArray(view.sections)) return { ...entry, id, error: 'The view has no sections list.' };
  const bad = view.sections.find(section => !section || !VIEW_ID.test(String(section.id ?? '')) || typeof section.render !== 'function');
  if (bad) return { ...entry, id, error: `Section ${JSON.stringify(bad?.id)} needs an id (letters, numbers, - or _) and a render function.` };
  return { ...entry, id };
}

// #<viewId> or #<viewId>-<sectionId>. View ids are checked before the older sections; the longest
// matching view id wins. A hash whose rest is not one of the view's sections falls through to the older
// sections, so #kind-tree still works even if a view is called "kind".
function pickView(hash) {
  const byLength = [...VIEWS].sort((a, b) => b.id.length - a.id.length);
  for (const entry of byLength) {
    if (hash === entry.id) return { entry, section: null };
    if (!hash.startsWith(`${entry.id}-`)) continue;
    const rest = hash.slice(entry.id.length + 1);
    const section = entry.view?.sections?.find(s => s.id === rest);
    if (section) return { entry, section };
  }
  return null;
}

async function showView({ entry, section }) {
  if (entry.error) {
    heading(entry.id, entry.file);
    main.insertAdjacentHTML('beforeend', `<pre class="gallery-error">${escape(entry.error)}</pre>`);
    return;
  }
  const { view } = entry;
  const sections = section ? [section] : view.sections;
  const top = document.createElement('h1');
  top.className = 'gallery-view-title';
  top.innerHTML = `${escape(view.title ?? view.id)} <small>${escape(entry.file)}${section ? ` · <a href="#${escape(entry.id)}">all sections</a>` : ''}</small>`;
  main.append(top);
  if (!sections.length) main.insertAdjacentHTML('beforeend', '<p class="gallery-note">This view has no sections yet.</p>');
  for (const item of sections) {
    const box = document.createElement('section');
    box.className = 'gallery-section';
    const link = `#${entry.id}-${item.id}`;
    box.innerHTML = `<h2 class="gallery-section-title">${escape(item.title ?? item.id)} <small><a href="${escape(link)}">${escape(link)}</a></small></h2><div class="gallery-section-body"></div>`;
    main.append(box);
    const host = box.querySelector('.gallery-section-body');
    try {
      await item.render(host, toolsFor(host));
    } catch (error) {
      console.error(`Section ${link} failed:`, error);
      host.insertAdjacentHTML('beforeend', `<pre class="gallery-error">This section failed: ${escape(error?.stack ?? error)}</pre>`);
    }
  }
}

async function showIndex() {
  if (VIEWS.length) {
    heading('Views', 'from development-tools/game-gallery/views/');
    const items = VIEWS.map(entry => {
      const sections = entry.error ? `<span class="gallery-error-inline">${escape(entry.error.split('\n').slice(0, 2).join(' '))}</span>`
        : entry.view.sections.map(s => `<a href="#${escape(entry.id)}-${escape(s.id)}">${escape(s.title ?? s.id)}</a>`).join(' · ');
      return `<li><a href="#${escape(entry.id)}"><strong>${escape(entry.view?.title ?? entry.id)}</strong></a> <small>#${escape(entry.id)}</small><br>${sections}</li>`;
    });
    main.insertAdjacentHTML('beforeend', `<ul class="gallery-view-list">${items.join('')}</ul>`);
  }
  heading('Sections');
  const links = ['#kinds', '#kinds-nature', '#kinds-buildings', '#kinds-wonders', '#helpers', '#worlds',
    ...Object.keys(SAMPLE_WORLDS).flatMap(key => MOODS.map(mood => `#world-${key}-${mood}`)),
    ...DATA.states.map(state => `#${state.name}`)];
  main.insertAdjacentHTML('beforeend', `<ul class="gallery-links">${links.map(link => `<li><a href="${link}">${link}</a></li>`).join('')}</ul>`);
  if (!DATA.states.length) main.insertAdjacentHTML('beforeend', `<p class="gallery-note">${escape(DATA.stateNote || 'No layout states.')}</p>`);
  heading('Town states', DATA.town.note || `${DATA.town.states.length} states from states/town/, for the views in data.town.states`);
  if (DATA.town.states.length) {
    main.insertAdjacentHTML('beforeend', `<ul class="gallery-links">${DATA.town.states.map(entry =>
      `<li>${escape(entry.id)} <small>${escape(entry.error ? `failed: ${entry.error}` : entry.summary)}${entry.problems?.length ? ` · <span class="gallery-error-inline">${entry.problems.length} problems</span>` : ''}</small></li>`).join('')}</ul>`);
  }
}

function nav(hash) {
  const current = pickView(hash)?.entry.id;
  const old = ['#kinds', '#helpers', '#worlds', ...DATA.states.map(state => `#${state.name}`)].map(link =>
    `<a href="${link}" ${`#${hash}` === link ? 'aria-current="page"' : ''}>${link.slice(1)}</a>`);
  const views = VIEWS.map(entry => `<a href="#${escape(entry.id)}" class="gallery-nav-view${entry.error ? ' gallery-nav-failed' : ''}" ${current === entry.id ? 'aria-current="page"' : ''} title="${escape(entry.error ? `Failed: ${entry.error}` : entry.view?.title ?? '')}">${escape(entry.id)}</a>`);
  $('#gallery-nav').innerHTML = [...views, ...old, `<a href="#index" ${hash === 'index' ? 'aria-current="page"' : ''}>index</a>`].join('');
}

async function render() {
  window.galleryReady = false;
  const hash = decodeURIComponent(location.hash.slice(1)) || 'index';
  main.textContent = '';
  // Whatever fails below, the page still says it's done, so a screenshot shows the failure.
  try {
    nav(hash);
    let match, view;
    if ((view = pickView(hash))) await showView(view);
    else if (hash === 'kinds') await showKinds();
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
    main.insertAdjacentHTML('beforeend', `<pre class="gallery-error">Gallery failed: ${escape(error?.stack ?? error)}</pre>`);
  }
  // Two frames later the images are on screen; then a screenshot can be taken. (A hidden window may not
  // run animation frames, so a short timer stands in.)
  const ready = () => { window.galleryReady = true; };
  requestAnimationFrame(() => requestAnimationFrame(ready));
  setTimeout(ready, 300);
}

// views: [{ file, view }] or [{ file, error }], from the entry build.js writes.
export function start(views = []) {
  VIEWS = views.map(entry => { try { return checkView(entry); } catch (error) { return { file: String(entry?.file), id: String(entry?.file).replace(/\.js$/, ''), error: String(error) }; } });
  // Two files with the same view id: the second one says so instead of hiding behind the first.
  const seen = new Map();
  VIEWS = VIEWS.map(entry => {
    if (seen.has(entry.id)) return { ...entry, id: entry.file.replace(/\.js$/, ''), view: null, error: entry.error ?? `This view's id "${entry.id}" is already used by ${seen.get(entry.id)}.` };
    seen.set(entry.id, entry.file);
    return entry;
  });
  window.galleryViews = VIEWS.map(({ file, id, error, view }) => ({ file, id, error: error ?? null, sections: view?.sections?.map(s => s.id) ?? [] }));
  window.addEventListener('hashchange', () => location.reload());
  render();
}
