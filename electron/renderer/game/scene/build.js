// Assembles the static island from a grid model: ground, underside and roots, stepping-stone paths,
// rope bridges, every thing's model, and small lawn details. Everything static is merged per material,
// so a whole world is a handful of draw calls. Built once per world; moods never rebuild it.
import * as THREE from 'three';
import { CELL, LEVEL, P, ISLAND_GRASS } from './style.js';
import { Batch, colourSlab, hash01, loopToWorld, outlineLoops, pathStones, place, slabGeometry, taperedTube, undersideGeometry } from './ground.js';
import { blobTexture, lump, rbox } from './parts.js';
import { decor, modelFor } from './models/index.js';

const OUTLINE = { convex: 1.1, concave: 0.5, wobble: 0.05, spacing: 0.3 };
const SLAB = { depth: 0.1, bevel: 0.1, segments: 4, smooth: true };
const UNDERSIDE = { rings: 8, spacing: 0.24, jitter: 0.07, profile: t => 1 - Math.pow(t, 2.3) };
const DECOR_DENSITY = 0.18;

function underColour(color, t) {
  const stops = [[0, P.soil], [0.22, P.soilDeep], [0.45, P.rock], [1, P.rockDeep]];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
  color.set(c0).lerp(new THREE.Color(c1), Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  color.multiplyScalar(1 - t * 0.12);
}

export function buildIsland(model, materials) {
  const root = new THREE.Group();
  root.name = 'island';
  const batch = new Batch();
  const dynamic = [], moodHooks = [], disposables = [];
  const blobMaterial = new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#3a4a7a', transparent: true, opacity: 0.28, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(blobMaterial);
  const blobPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ctx = {
    batch, model, materials, root, dynamic, palette: P,
    add(geometry, mat, color, local, base, ao = true, grad = null) {
      const matrix = base.clone().multiply(local ?? new THREE.Matrix4());
      const ground = base.elements[13];
      batch.add(geometry, mat, {
        color, matrix,
        ao: ao ? { ground, height: 0.32, min: 0.6 } : null,
        grad: grad ? { y0: ground + grad[0], y1: ground + grad[1], min: grad[2], max: grad[3] } : null,
      });
      geometry.dispose();
    },
    blob(base, sx, sz = sx, ox = 0, oz = 0) {
      batch.add(blobPlane, 'blob', { matrix: base.clone().multiply(place(ox, 0.008, oz, { sx, sz, sy: 1 })) });
    },
    onMood(fn) { moodHooks.push(fn); },
    track(...items) { disposables.push(...items); },
  };

  // ---- Ground, island by island ----
  const islandInfo = [];
  model.islands.forEach((island, index) => {
    const grass = ISLAND_GRASS[island.kind] ?? ISLAND_GRASS.home;
    const isLand = (c, r) => model.get(c, r)?.island === index;
    const loops = outlineLoops(island.cells, isLand, { ...OUTLINE, seed: 3 + index });
    const width = Math.sqrt(island.cells.length) * CELL;
    const depth = Math.max(1.0, width * 0.64);
    for (const cellLoop of loops) {
      const loop = loopToWorld(cellLoop, model.centre);
      const slab = slabGeometry(loop, { top: 0, ...SLAB });
      colourSlab(slab, grass.top, grass.side, 0);
      batch.add(slab, 'ground');
      slab.dispose();
      const thickness = SLAB.depth + SLAB.bevel * 2;
      const under = undersideGeometry(loop, { yTop: -thickness + 0.05, depth, seed: 11 + index, ...UNDERSIDE, colorAt: underColour });
      batch.add(under.geometry, 'under');
      under.geometry.dispose();
      addRoots(batch, under, loop, index);
      islandInfo.push({ loop, depth, under });
    }
    // Raised levels: the same slab, traced from the raised cells only.
    const raised = island.cells.filter(cell => cell.height > 0);
    if (raised.length) {
      const isRaised = (c, r) => { const cell = model.get(c, r); return cell?.island === index && cell.height > 0; };
      for (const cellLoop of outlineLoops(raised, isRaised, { ...OUTLINE, seed: 9 + index })) {
        const loop = loopToWorld(cellLoop, model.centre);
        const hill = slabGeometry(loop, { top: LEVEL, depth: LEVEL - SLAB.bevel, bevel: SLAB.bevel, segments: SLAB.segments, smooth: true });
        colourSlab(hill, grass.top, P.hillSide, LEVEL);
        batch.add(hill, 'ground');
        hill.dispose();
      }
    }
  });

  // ---- Paths: white stepping stones ----
  const stone = lump(0.11, 2, 0.05, 4, [1, 0.3, 0.85]);
  for (const matrix of pathStones(model)) batch.add(stone, 'matte', { color: P.path, matrix });
  stone.dispose();

  // ---- Bridges ----
  for (const bridge of model.bridges) buildBridge(ctx, bridge);

  // ---- Things on cells ----
  const seenTree = new Set();
  for (const thing of model.things) {
    if (thing.kind === 'tree' && !seenTree.has(thing.island)) { thing.old = true; seenTree.add(thing.island); }
  }
  // Seats turn to face the nearest campfire.
  const fires = model.things.filter(t => t.kind === 'fire');
  const thingTops = [];
  for (const thing of model.things) {
    let yaw = thing.facing * Math.PI / 2;
    if (thing.kind === 'seat' && fires.length) {
      const fire = fires.slice().sort((a, b) => Math.hypot(a.x - thing.x, a.z - thing.z) - Math.hypot(b.x - thing.x, b.z - thing.z))[0];
      if (Math.hypot(fire.x - thing.x, fire.z - thing.z) < CELL * 3) yaw = Math.atan2(fire.x - thing.x, fire.z - thing.z);
    }
    const y = thing.height * LEVEL;
    const base = place(thing.x, y, thing.z, { ry: yaw });
    batch.top = -Infinity;
    try { modelFor(thing.kind)(ctx, thing, base); } catch (error) { console.error(`Model for ${thing.kind} failed:`, error); }
    thing.top = Number.isFinite(batch.top) ? batch.top : y + 0.3;
    thingTops.push(thing);
  }

  // ---- A light scatter of small details on free grass ----
  for (const cell of model.cells.values()) {
    if (cell.thing || cell.type !== 'grass') continue;
    const roll = hash01(cell.c, cell.r, 5);
    if (roll > DECOR_DENSITY) continue;
    const [x, z] = model.toWorld(cell.c, cell.r);
    const jx = (hash01(cell.c, cell.r, 6) - 0.5) * CELL * 0.6, jz = (hash01(cell.c, cell.r, 8) - 0.5) * CELL * 0.6;
    decor(ctx, place(x + jx, cell.height * LEVEL, z + jz, { ry: roll * 40 }), roll / DECOR_DENSITY);
  }
  blobPlane.dispose();
  const meshes = batch.build({ ...materials, blob: blobMaterial }, root);
  for (const mesh of meshes) disposables.push(mesh.geometry);

  // ---- Points the camera must keep in view ----
  let framePoints = [];
  for (const info of islandInfo) {
    info.loop.forEach((p, i) => { if (i % 3 === 0) framePoints.push([p[0], 0, p[1]]); });
    // The underside's upper front bulge sits low on screen, so keep it in view. Its deep tip fades into
    // the sky anyway, so the view may trim a little of it.
    info.under.rings[2]?.forEach((v, i) => { if (i % 4 === 0) framePoints.push([v.x, v.y, v.z]); });
    framePoints.push([info.under.tip.x, info.under.tip.y * 0.7, info.under.tip.z]);
  }
  for (const thing of thingTops) {
    const hw = thing.w * CELL / 2, hd = thing.h * CELL / 2;
    for (const [dx, dz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) framePoints.push([thing.x + dx, thing.top, thing.z + dz]);
  }
  // A very small world is framed as if it were a little bigger, so it floats in some sky.
  const MIN_HALF = 2.4 * CELL;
  for (const [x, z] of [[-MIN_HALF, -MIN_HALF], [MIN_HALF, -MIN_HALF], [-MIN_HALF, MIN_HALF], [MIN_HALF, MIN_HALF]]) framePoints.push([x, 0, z]);
  // Gallery only: world.debugView { at: [c, r], radius } frames a close-up of one spot instead.
  const view = model.data?.debugView;
  if (view && Array.isArray(view.at)) {
    const [x, z] = model.toWorld(Number(view.at[0]) || 0, Number(view.at[1]) || 0);
    const radius = Math.max(0.4, Number(view.radius) || 1) * CELL;
    framePoints = [];
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (const y of [0, radius * 1.1]) framePoints.push([x + dx * radius, y, z + dz * radius]);
    // Tall things in view keep their tops in the picture.
    for (const thing of thingTops) if (Math.abs(thing.x - x) < radius && Math.abs(thing.z - z) < radius) framePoints.push([thing.x, thing.top, thing.z]);
  }
  // Grass cells away from things, where fireflies may hover (every few cells is plenty).
  const landSpots = [];
  let n = 0;
  for (const cell of model.cells.values()) if (cell.island >= 0 && !cell.height && !cell.thing && n++ % 3 === 0) landSpots.push(model.toWorld(cell.c, cell.r));
  const maxDepth = islandInfo.length ? Math.max(...islandInfo.map(i => i.depth)) : 1;
  const span = framePoints.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[2])), 1);

  return {
    root, dynamic, moodHooks, framePoints, landSpots, span, depth: maxDepth,
    // How far a fishing line hangs: well below the front edge.
    bottomY: -Math.min(1.6, maxDepth * 0.75),
    dispose() {
      root.removeFromParent();
      for (const item of disposables) item.dispose?.();
      root.traverse(node => { if (node.isLight) node.dispose?.(); });
    },
  };
}

// Roots hanging from the underside, mostly at the front where they show.
function addRoots(batch, under, loop, index) {
  const ring = under.rings[1];
  const front = ring.map((v, i) => ({ v, i })).filter(({ v }) => v.z > under.centre[1] + 0.3);
  const perimeter = loop.length * 0.18;
  const count = Math.max(3, Math.min(9, Math.round(perimeter / 2.4)));
  const step = Math.max(1, Math.floor(front.length / count));
  front.filter((_, k) => k % step === Math.floor(step / 2)).slice(0, count).forEach(({ v }, k) => {
    // Short roots that hang nearly straight down, starting just inside the rock so they grow out of it.
    const len = 0.28 + hash01(k, index, 3) * 0.3, sway = (hash01(k, index, 5) - 0.5) * 0.12;
    const inX = (under.centre[0] - v.x), inZ = (under.centre[1] - v.z), inLen = Math.hypot(inX, inZ) || 1;
    const start = [v.x + inX / inLen * 0.08, v.y + 0.06, v.z + inZ / inLen * 0.08];
    const pts = [start, [v.x + sway * 0.4, v.y - len * 0.55, v.z + 0.03], [v.x + sway, v.y - len, v.z + 0.02]];
    const tube = taperedTube(pts, 0.035, 0.01, 6);
    batch.add(tube, 'matte', { color: P.root });
    tube.dispose();
  });
}

// A plank bridge between two coast cells: deck, posts at each end, sagging rope rails with hangers.
function buildBridge(ctx, bridge) {
  const { model } = ctx;
  const first = bridge.span[0], last = bridge.span[bridge.span.length - 1];
  const [ax, az] = model.toWorld(first.c - bridge.dir[0] * 0.75, first.r - bridge.dir[1] * 0.75);
  const [bx, bz] = model.toWorld(last.c + bridge.dir[0] * 0.75, last.r + bridge.dir[1] * 0.75);
  const length = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
  const base = place((ax + bx) / 2, 0, (az + bz) / 2, { ry: yaw });
  const count = Math.round(length / 0.17);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count - 0.5;
    ctx.add(rbox(0.66, 0.05, 0.13, 0.008, 2), 'matte', i % 2 ? P.plank : P.plankDark, place((hash01(i, 2, 3) - 0.5) * 0.03, -0.03, t * length, { ry: (hash01(i, 1, 3) - 0.5) * 0.08 }), base, false);
  }
  // Two stringers under the planks.
  for (const side of [-1, 1]) ctx.add(rbox(0.05, 0.05, length - 0.1, 0.008, 2), 'matte', P.post, place(side * 0.24, -0.07, 0), base, false);
  for (const end of [-0.5, 0.5]) for (const side of [-1, 1]) {
    ctx.add(rbox(0.07, 0.42, 0.07, 0.008, 2).translate(0, 0.21, 0), 'matte', P.post, place(side * 0.3, 0, end * (length - 0.25)), base);
    ctx.add(rbox(0.1, 0.03, 0.1, 0.006, 2), 'matte', P.trim, place(side * 0.3, 0.43, end * (length - 0.25)), base, false);
  }
  const sag = t => 0.33 - Math.sin(t * Math.PI) * 0.1;
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([side * 0.3, sag(t), (t - 0.5) * (length - 0.25)]);
    }
    ctx.add(taperedTube(pts, 0.016, 0.016, 5), 'matte', P.rope, null, base, false);
    const hangers = Math.max(2, Math.round(length / 0.5));
    for (let i = 1; i < hangers; i++) {
      const t = i / hangers, h = sag(t);
      ctx.add(new THREE.CylinderGeometry(0.008, 0.008, h, 4), 'matte', P.rope, place(side * 0.3, h / 2 - 0.01, (t - 0.5) * (length - 0.25)), base, false);
    }
  }
}
