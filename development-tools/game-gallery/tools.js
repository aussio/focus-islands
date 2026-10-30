// Drawing tools for the gallery views (development-tools/game-gallery/views/*.js). Never ships.
//
// A view's sections get these as `tools` in render(host, tools):
//
//   shot(build, { width, height, mood, aim, yaw, pitch, time, log, model, island }) => Promise<img>
//       Makes a fresh model context with the town scene's makeModelContext (scene/town/build.js): batch,
//       materials, root, dynamic, palette, add, blob, onMood, track, piece(key), and model and island
//       (null unless given as options).
//       Calls build(ctx) (it may be async), frames the camera on everything added (or on `aim`), lights it
//       with the scene's own stage in `mood`, and draws one frame with one shared hidden renderer.
//       - width, height: the picture size in page pixels (default 320 × 220).
//       - mood: focus | break | away | done (default focus).
//       - aim: world points [[x, y, z], ...] (or [[x, z], ...]) to frame instead of everything added.
//       - yaw: turns the view about the vertical, in radians. 0 is Today's view from the south; π/2 looks
//         from the east. The subject is turned, not the sun, so the light falls as it does on Today.
//       - pitch: the camera's angle above the horizon, in radians. Left out, it is Today's (ELEVATION, 0.8).
//       - time: seconds handed to ctx.dynamic functions and the sky (clouds, fireflies), default 0.
//       - log: a Map; every piece's vertices are recorded in it (see withPieces in scene/town/pieces.js).
//       The image carries img.stats = { triangles, calls, buildMs, drawMs }. If build throws, the image
//       shows the error instead.
//   worldShot(world, mood, { width, height }) => Promise<img>
//       Draws a whole world through createIslandScene, the same way Today does: square worlds and town
//       worlds (islands with a grid). If the scene can't build the world, the image says so. The image
//       carries img.stats from the scene's stats().
//   card(title, note, images) => <figure>         a labelled card; append it yourself
//   heading(text, note) => <h2>                   added to the section's host (and returned)
//   grid(className) => <div class="gallery-grid">  a row of cards added to the host: cards sit side by side
//                                                  at their pictures' size and wrap; className is extra
//   note(text) => <p>                             a grey note added to the host
//   data                                          what build.js hands the page (see below)
//
// data.town.states: [{ id, person, personName, day, summary, game, world, problems, error }], the town
// states from make-states.js laid out by buildTown in Node. Grids are stripped from the page data and put
// back here with gridFor(id, size), so each island.grid is the real shared grid. data.town.note says why
// there are none. data.states: the old square states for #state-day-<n>.
import * as THREE from 'three';
import { MOODS, createMaterials, moodMaterials, moodOf } from '../../electron/renderer/game/scene/style.js';
import { ELEVATION, createStage } from '../../electron/renderer/game/scene/stage.js';
import { createIslandScene } from '../../electron/renderer/game/scene/index.js';
import { makeBlobMaterial, makeModelContext } from '../../electron/renderer/game/scene/town/build.js';
import { gridFor } from '../../electron/renderer/game/town/grid.js';

export const MOOD_NAMES = ['focus', 'break', 'away', 'done'];
export const TODAY_SIZE = [591, 357]; // the island's size on Today

// ---------- Page data ----------
const raw = globalThis.GALLERY ?? {};
export const data = {
  ...raw,
  states: raw.states ?? [],
  stateNote: raw.stateNote ?? '',
  town: { states: [], note: '', ...(raw.town ?? {}) },
};
// Put each town island's grid back. gridFor gives the same frozen grid every time.
for (const entry of data.town.states) {
  for (const island of entry.world?.islands ?? []) {
    if (island.grid?.points) continue;
    const key = island.grid?.key ?? island.grid;
    try {
      island.grid = gridFor(island.id, island.size);
      if (key && island.grid.key !== key) (entry.problems ??= []).push(`${island.id}: page grid ${island.grid.key} is not the layout's ${key}`);
    } catch (error) {
      (entry.problems ??= []).push(`${island.id}: no grid (${error.message})`);
    }
  }
}

// ---------- Elements ----------
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export { escape };

export function card(title, note, images = []) {
  const el = document.createElement('figure');
  el.className = 'gallery-card';
  el.innerHTML = `<figcaption><strong>${escape(title)}</strong>${note ? ` <span>${escape(note)}</span>` : ''}</figcaption><div class="gallery-images"></div>`;
  el.querySelector('.gallery-images').append(...[images].flat().filter(Boolean));
  return el;
}

export function heading(text, note = '') {
  const el = document.createElement('h2');
  el.innerHTML = `${escape(text)}${note ? ` <small>${escape(note)}</small>` : ''}`;
  return el;
}

export function grid(className = '') {
  const el = document.createElement('div');
  el.className = `gallery-grid ${className}`.trim();
  return el;
}

export function note(text) {
  const el = document.createElement('p');
  el.className = 'gallery-note';
  el.textContent = text;
  return el;
}

// An image that shows a message instead of a drawing (an error, or nothing to draw).
export function messageImage(width, height, text) {
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  g.fillStyle = '#f6e9e6'; g.fillRect(0, 0, width, height);
  g.fillStyle = '#9a3b32'; g.font = '12px ui-sans-serif, -apple-system, sans-serif';
  const words = String(text).split(/\s+/);
  let line = '', y = 18;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width - 16 && line) { g.fillText(line, 8, y); line = word; y += 15; }
    else line = next;
    if (y > height - 8) break;
  }
  if (line && y <= height - 8) g.fillText(line, 8, y);
  return imageFrom(canvas.toDataURL('image/png'), width, height, 'gallery-error-image', String(text));
}

function imageFrom(url, width, height, className = '', alt = '') {
  const img = document.createElement('img');
  img.width = width; img.height = height;
  img.alt = alt;
  if (className) img.className = className;
  img.src = url;
  return img;
}

const loaded = img => new Promise(resolve => { if (img.complete) resolve(img); else { img.onload = () => resolve(img); img.onerror = () => resolve(img); } });

// ---------- shot ----------
// One hidden renderer, one set of materials and one stage, shared by every shot. Set up the same way as
// the scene's renderer (scene/index.js) and lit by the scene's own stage (scene/stage.js). The model
// context comes from the town scene's own makeModelContext (scene/town/build.js).
let shared;
function sharedRenderer() {
  if (shared !== undefined) return shared;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    shared = { renderer, materials: createMaterials(), stage: createStage(), blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  } catch (error) {
    console.error('The gallery could not start WebGL:', error);
    shared = null;
  }
  return shared;
}

// Points to frame: a sample of every mesh's vertices, in world positions.
function contentPoints(object, limit = 4000) {
  object.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  object.traverse(node => {
    const position = node.geometry?.attributes?.position;
    if ((node.isMesh || node.isLine || node.isPoints) && position && node.visible !== false && node.name !== 'batch-blob') { meshes.push(node); total += position.count; }
  });
  const step = Math.max(1, Math.ceil(total / limit));
  const v = new THREE.Vector3(), points = [];
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (Number.isFinite(v.x + v.y + v.z)) points.push([v.x, v.y, v.z]);
    }
  }
  return points;
}

const now = () => globalThis.performance?.now?.() ?? Date.now();

export async function shot(build, options = {}) {
  const { width = 320, height = 220, aim = null, yaw = 0, pitch = null, time = 0, log = null, model = null, island = null } = options;
  const mood = moodOf(options.mood);
  const s = sharedRenderer();
  if (!s) return messageImage(width, height, 'WebGL could not start.');
  const { renderer, materials, stage } = s;
  const { ctx, moodHooks, disposables, finish } = makeModelContext({ ...s, model, island, log });
  ctx.root.name = 'gallery-shot';
  // Turning the subject (not the camera) keeps the sun where Today has it.
  const holder = new THREE.Group();
  holder.rotation.y = -yaw;
  holder.add(ctx.root);
  const started = now();
  try {
    await build(ctx);
    finish();
    const buildMs = now() - started;
    stage.scene.add(holder);
    const turn = new THREE.Matrix4().makeRotationY(-yaw);
    let points = Array.isArray(aim) && aim.length
      ? aim.map(p => new THREE.Vector3(p[0], p.length > 2 ? p[1] : 0, p.length > 2 ? p[2] : p[1]).applyMatrix4(turn).toArray())
      : contentPoints(holder);
    if (!points.length) points = [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]];
    stage.setMood(mood);
    moodMaterials(materials, mood);
    for (const hook of moodHooks) hook(mood, MOODS[mood]);
    // Today's town camera: a fixed yaw, looking at the points' middle, at Today's angle unless pitch says.
    stage.aim(points, width / height, { elevation: Number.isFinite(pitch) ? pitch : ELEVATION });
    for (const fn of ctx.dynamic) fn(time);
    stage.update(time);
    renderer.setSize(width, height, false);
    renderer.shadowMap.needsUpdate = true;
    const drawStart = now();
    renderer.render(stage.scene, stage.camera);
    const drawMs = now() - drawStart;
    const img = imageFrom(renderer.domElement.toDataURL('image/png'), width, height);
    img.stats = { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, buildMs: Math.round(buildMs * 10) / 10, drawMs: Math.round(drawMs * 10) / 10 };
    return loaded(img);
  } catch (error) {
    console.error('Gallery shot failed:', error);
    return messageImage(width, height, `Shot failed: ${error?.message ?? error}`);
  } finally {
    holder.removeFromParent();
    holder.traverse(node => node.geometry?.dispose?.());
    for (const item of disposables) item?.dispose?.();
  }
}

// ---------- worldShot ----------
// One hidden scene draws every world in turn, the way Today draws it.
let worldStage = null, worldScene = null;
function sharedScene() {
  if (worldScene) return worldScene;
  worldStage = document.createElement('div');
  worldStage.className = 'gallery-stage';
  document.body.append(worldStage);
  worldScene = createIslandScene(worldStage);
  return worldScene;
}

export async function worldShot(world, mood = 'focus', { width = 330, height = 220 } = {}) {
  const scene = sharedScene();
  worldStage.style.width = `${width}px`;
  worldStage.style.height = `${height}px`;
  // setWorld is false when the build failed (the scene logs why) or there's no WebGL. Then clear it, so
  // neither this picture nor the next can show the last world that did build.
  if (!scene.setWorld(world)) {
    scene.setWorld({});
    return messageImage(width, height, 'The scene could not draw this world (see the console).');
  }
  scene.setMood(moodOf(mood));
  const canvas = await scene.capture();
  if (!canvas) return messageImage(width, height, 'Nothing could be drawn (no WebGL).');
  const img = await loaded(imageFrom(canvas.toDataURL('image/png'), width, height));
  img.stats = scene.stats?.() ?? null; // triangles, draw calls, frame and rebuild times (scene/index.js)
  return img;
}

// ---------- Tools for one section ----------
// heading, grid and note add their element to the section's host and return it.
export function toolsFor(host) {
  const into = el => { host.append(el); return el; };
  return {
    shot, worldShot, card, data, messageImage, escape, MOODS: MOOD_NAMES, TODAY_SIZE,
    heading: (text, extra) => into(heading(text, extra)),
    grid: className => into(grid(className)),
    note: text => into(note(text)),
  };
}
