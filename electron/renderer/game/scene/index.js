// The sky-island scene. createIslandScene(host, { cameraStyle, clearTop }) draws a town world
// (town/index.js buildTown) in style D and returns
// { setWorld(world), setMood(mood), capture(), stats(), dispose(), cameraStyle, clearTop }.
//
// - setWorld rebuilds geometry only when the world data changed. setMood (focus | break | away | done)
//   changes only the sky, the light, what glows and what the helpers do.
// - Draws at most about 30 frames a second, and stops completely while the page is hidden, the host is
//   detached, has no size, or is scrolled off screen. When shown again, helpers start fresh.
// - With reduced motion, it draws one still frame per change with helpers standing at their spots.
// - capture() draws one fresh frame right away (even while paused), with any check-in move finished
//   first and the camera where the drift is at that moment, and resolves with the canvas (or null when
//   nothing can be drawn).
// - The camera moves slowly to where a new world should be seen. It jumps instead on the first world, on
//   resize, with reduced motion, and while hidden or off screen. After a lost drawing context comes back,
//   every island is built again. A world that isn't a town draws as an empty sky (scene/core.js).
// - Between check-ins the camera sways and drifts (scene/drift.js). It turns slowly up to 45° left and
//   right of north and back, one whole swing every 480 s, even with only one island. It turns around the
//   middle of what it shows, along an ellipse fitted to the islands' shape, so the zoom stays the same
//   facing north and the town fills the picture about the same at every turn. With other islands it
//   also rests on the busy view, then slowly pulls back to the whole group now and then, visits each other
//   island framed whole, and comes home. Where it is depends only on the clock (the trips on the time since
//   the world last changed, the turn on the time since the first world), so nothing is drawn while hidden;
//   when shown again it is wherever it has got to. With reduced motion it stays on the busy view, facing
//   north.
// - cameraStyle (get or set): 'sway' (default), 'drift' (the trips without the turn) or 'still' (the busy
//   view only). CAMERA_STYLES lists them. A change eases back to the busy view.
// - clearTop (get or set): pixels kept clear of the town across the top, where the page's resource bar
//   sits (scene/core.js CLEAR_TOP, 64 by default).
// - clearLeft (creation option): pixels reserved at the left for Today’s floating session card.
// - stats() is a speed readout for the gallery: triangles, draw calls, frame time and rebuild time.
// - If WebGL cannot start, the host gets a soft sky-coloured background instead, and nothing throws.
// The canvas fills the host (width and height 100%), so the host needs a size of its own.
import * as THREE from 'three';
import { MOODS, moodOf } from './style.js';
import { CLEAR_TOP, createSceneCore } from './core.js';
import { CAMERA_STYLES } from './stage.js';

export { CAMERA_STYLES };

const FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 2;

export function createIslandScene(host, { cameraStyle = CAMERA_STYLES[0], clearTop = CLEAR_TOP, clearLeft = 0 } = {}) {
  const doc = host?.ownerDocument ?? globalThis.document;
  const view = doc?.defaultView ?? globalThis.window ?? globalThis;
  const now = () => (globalThis.performance?.now?.() ?? Date.now());
  let core = null, renderer = null, canvas = null, fallback = null;
  let disposed = false, lost = false, broken = false;
  let running = false, frameRequest = 0, lastDraw = 0, clockStart = now();
  let onScreen = true, width = 0, height = 0;
  const frameTimes = []; // the last draws, in ms, for stats()
  let mood = 'focus';
  const reducedQuery = view.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  const reduced = () => Boolean(reducedQuery?.matches);
  const hidden = () => Boolean(doc?.hidden);

  const showFallback = () => {
    if (fallback || !doc || !host) return;
    try {
      fallback = doc.createElement('div');
      fallback.setAttribute?.('aria-hidden', 'true');
      fallback.className = 'focus-islands-fallback';
      if (fallback.style) fallback.style.cssText = `display:block;width:100%;height:100%;background:${MOODS[mood].fallback};`;
      host.appendChild?.(fallback);
    } catch { /* nothing more we can do; the page stays as it was */ }
  };

  try {
    canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'focus-islands-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;';
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Only helpers move and they use soft blob shadows, so the island's shadows are drawn once per change.
    renderer.shadowMap.autoUpdate = false;
    core = createSceneCore({ clearTop, clearLeft });
    core.cameraStyle = cameraStyle;
    host.appendChild(canvas);
  } catch (error) {
    try { renderer?.dispose(); } catch { /* ignore */ }
    renderer = null;
    core = null;
    canvas = null;
    showFallback();
  }

  const measure = () => {
    const w = Math.round(host?.clientWidth ?? 0), h = Math.round(host?.clientHeight ?? 0);
    if (w === width && h === height) return false;
    width = w; height = h;
    if (renderer && w > 0 && h > 0) {
      renderer.setSize(w, h, false);
      core.resize(w, h);
    }
    return true;
  };

  const draw = (still = reduced()) => {
    if (!renderer || lost || broken || disposed || width <= 0 || height <= 0) return false;
    try {
      const started = now();
      core.update((now() - clockStart) / 1000, still);
      if (core.takeChanged()) renderer.shadowMap.needsUpdate = true;
      renderer.render(core.scene, core.camera);
      frameTimes.push(now() - started);
      if (frameTimes.length > 60) frameTimes.shift();
      return true;
    } catch (error) {
      // A drawing error should never break the page: stop drawing and keep the last frame.
      broken = true;
      console.error('Island scene stopped drawing:', error);
      stop();
      return false;
    }
  };

  const shouldRun = () => Boolean(renderer) && !disposed && !lost && !broken && !reduced() && !hidden()
    && onScreen && host.isConnected !== false && width > 0 && height > 0 && core.hasWorld;

  function stop() {
    running = false;
    if (frameRequest) view.cancelAnimationFrame?.(frameRequest);
    frameRequest = 0;
  }

  function frame(time) {
    frameRequest = 0;
    if (!running) return;
    if (!shouldRun()) { sync(); return; }
    frameRequest = view.requestAnimationFrame(frame);
    if (time - lastDraw < FRAME_MS - 4) return;
    lastDraw = time;
    draw(false);
  }

  // Starts or stops the loop to match what can be seen. Coming back always restarts the helpers.
  function sync() {
    if (!renderer || disposed) return;
    if (shouldRun()) {
      if (!running) {
        running = true;
        clockStart = now();
        lastDraw = 0;
        draw(false);
        frameRequest = view.requestAnimationFrame?.(frame) ?? 0;
      }
    } else {
      if (running) stop();
      // Nobody sees a camera move while paused: finish it.
      core?.settle();
      // Reduced motion: a still frame for each change while visible.
      if (reduced() && !hidden() && core?.hasWorld) draw(true);
    }
  }

  const onVisibility = () => sync();
  const onLost = event => { event.preventDefault(); lost = true; stop(); };
  const onRestored = () => {
    lost = false;
    if (core) {
      // Every island and bridge is built again from the model.
      try { core.rebuild(); } catch (error) { console.error('Island scene could not rebuild:', error); }
      core.takeChanged();
    }
    renderer.shadowMap.needsUpdate = true;
    sync();
    if (!running) draw();
  };
  const onReducedChange = () => { stop(); sync(); };
  let resizeObserver = null, intersectionObserver = null;
  if (renderer) {
    doc.addEventListener?.('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    reducedQuery?.addEventListener?.('change', onReducedChange);
    if (typeof view.ResizeObserver === 'function') {
      resizeObserver = new view.ResizeObserver(() => {
        if (disposed) return;
        if (measure() && running) draw(false);
        sync();
      });
      resizeObserver.observe(host);
    }
    if (typeof view.IntersectionObserver === 'function') {
      intersectionObserver = new view.IntersectionObserver(entries => {
        onScreen = entries[entries.length - 1].isIntersecting;
        sync();
      });
      intersectionObserver.observe(host);
    }
    core.setMood(mood);
    measure();
  }

  return {
    // Returns true when the scene now shows this world (newly built, or the same as before), and false
    // when it can't: disposed, no WebGL, or the world failed to build (the last world stays on screen).
    setWorld(world) {
      if (disposed) return false;
      if (!core) return false;
      measure();
      try {
        // A camera move only makes sense while someone can watch it.
        const ease = !reduced() && !hidden() && onScreen && host.isConnected !== false;
        if (core.setWorld(world, { ease })) { clockStart = now(); lastDraw = 0; }
      } catch (error) {
        console.error('Island scene could not build this world:', error);
        return false;
      }
      if (running) draw(false);
      sync();
      return true;
    },
    setMood(next) {
      if (disposed) return;
      mood = moodOf(next);
      if (fallback?.style) fallback.style.background = MOODS[mood].fallback;
      if (!core) return;
      try {
        if (core.setMood(mood)) { clockStart = now(); lastDraw = 0; }
      } catch (error) {
        console.error('Island scene could not change mood:', error);
        return;
      }
      if (running) draw(false);
      sync();
    },
    get cameraStyle() { return core?.cameraStyle ?? null; },
    set cameraStyle(style) {
      if (disposed || !core) return;
      core.cameraStyle = style;
      if (running) draw(false);
      sync();
    },
    get clearTop() { return core?.clearTop ?? null; },
    set clearTop(pixels) {
      if (disposed || !core) return;
      core.clearTop = pixels;
      if (running) draw(false);
      sync();
    },
    capture() {
      if (!renderer || disposed || lost) return Promise.resolve(null);
      measure();
      core.settle();
      return Promise.resolve(draw() ? canvas : null);
    },
    // Speed readout (gallery only): what the last frame drew, the average frame time over the last
    // draws, and what the last world change rebuilt. Null without WebGL.
    stats() {
      if (!renderer || !core) return null;
      const info = renderer.info.render;
      const average = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
      return { triangles: info.triangles, calls: info.calls, frameMs: average, frames: frameTimes.length, town: core.stats() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      reducedQuery?.removeEventListener?.('change', onReducedChange);
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      }
      try { core?.dispose(); } catch (error) { console.error(error); }
      try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* ignore */ }
      canvas?.remove?.();
      fallback?.remove?.();
      core = renderer = canvas = fallback = null;
    },
  };
}
