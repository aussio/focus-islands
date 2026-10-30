// Gallery page for the sky-island town. Bundled with three and the scene by build.js. Never ships.
// build.js writes a small entry that loads every views/*.js and calls start(views).
//
// Views (development-tools/game-gallery/views/<file>.js) export
//   default { id, title, sections: [{ id, title, render: async (host, tools) => {} }] }
// and are picked by the hash:
//   #<viewId>                                                    every section of a view
//   #<viewId>-<sectionId>                                        one section
//   #index (or anything else)                                    the list of views and town states
// tools are in tools.js. A view that fails to load, or a section that throws, shows its error in its
// place and leaves the others working. window.galleryReady turns true when the chosen sections have
// finished drawing.
import { data as DATA, escape, heading as headingEl, toolsFor } from './tools.js';

const $ = selector => document.querySelector(selector);
const main = $('#gallery-main');
let VIEWS = []; // [{ file, id, view, error }]

function heading(text, note = '') {
  main.append(headingEl(text, note));
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

// #<viewId> or #<viewId>-<sectionId>. The longest matching view id wins, so a view called "pads" and one
// called "pads-extra" can both be reached. A hash that matches nothing shows the index.
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
  heading('Town states', DATA.town.note || `${DATA.town.states.length} states from states/town/, for the views in data.town.states`);
  if (DATA.town.states.length) {
    main.insertAdjacentHTML('beforeend', `<ul class="gallery-links">${DATA.town.states.map(entry =>
      `<li>${escape(entry.id)} <small>${escape(entry.error ? `failed: ${entry.error}` : entry.summary)}${entry.problems?.length ? ` · <span class="gallery-error-inline">${entry.problems.length} problems</span>` : ''}</small></li>`).join('')}</ul>`);
  }
}

function nav(hash) {
  const current = pickView(hash)?.entry.id;
  const views = VIEWS.map(entry => `<a href="#${escape(entry.id)}" class="gallery-nav-view${entry.error ? ' gallery-nav-failed' : ''}" ${current === entry.id ? 'aria-current="page"' : ''} title="${escape(entry.error ? `Failed: ${entry.error}` : entry.view?.title ?? '')}">${escape(entry.id)}</a>`);
  $('#gallery-nav').innerHTML = [...views, `<a href="#index" ${hash === 'index' ? 'aria-current="page"' : ''}>index</a>`].join('');
}

async function render() {
  window.galleryReady = false;
  const hash = decodeURIComponent(location.hash.slice(1)) || 'index';
  main.textContent = '';
  // Whatever fails below, the page still says it's done, so a screenshot shows the failure.
  try {
    nav(hash);
    const view = pickView(hash);
    if (view) await showView(view);
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
