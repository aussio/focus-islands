// Builds the town, island by island, from the model (world.js). Stream E (scene glue) owns this.
//
//   createTownBuilder(parent, materials, { log }) => builder
//     builder.update(model)   rebuilds only the islands whose key changed, moves islands that only drifted,
//                             and rebuilds only the bridges whose ends, clear or type changed.
//                             Returns { rebuilt, moved, kept, removed, bridges, ms, islandMs }.
//     builder.rebuildAll(model)   everything again (after a lost drawing context comes back)
//     builder.framePoints(id)     world points that frame one island whole
//     builder.closePoints(id, ids, steps)   world points around some grid points, steps out
//     builder.landSpots(id)       [x, z, y] grass spots for fireflies
//     builder.moodHooks(), builder.update... see below
//   makeModelContext({ materials, blobMaterial, blobPlane, model, root, log }) => { ctx, ... }
//     the model context every drawing function gets, with piece(key) and island.
//
// Each island is its own group at [at[0], lift, at[1]], drawn in island units with y = 0 at the grass top.
// Its parts are drawn in this order, each into the island's Batch (one mesh per material):
//   buildGround (C), buildLanes (C), buildBlocks (C), buildThings (D).
// Then a surprise's visitor, if one is there (visitors.js): its own meshes, never in the batch.
// Bridges are their own groups, in world space: buildBridge (D). Any of these may draw nothing.
//
// Piece logs, for the stability check: with log (a Map), each island's pieces go in log.get(island.id)
// (a Map of key -> vertex text, island units), and each bridge's in log.get(`bridge:<id>`) (world units).
// Geometry added before any piece(key) in a part is logged as `<part>:unkeyed`, so nothing hides.
import * as THREE from 'three';
import { P, TOWN } from '../style.js';
import { Batch, place } from '../ground.js';
import { blobTexture } from '../parts.js';
import { withPieces } from './pieces.js';
import { buildGround } from './ground.js';
import { buildLanes } from './lanes.js';
import { buildBlocks } from './blocks.js';
import { buildThings } from './pads.js';
import { buildBridge } from './bridges.js';
import { buildVisitors } from './visitors.js';

// Rough heights of things by footprint, for framing only (the models are drawn by stream D).
const THING_TOP = { point: 0.5, pair: 0.3, cell: 1.0, cells: 1.1, ring: 1.2 };
const FOOT_OF = { 1: 'point', 2: 'pair', 4: 'cell', 6: 'cells', 9: 'ring' };
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function makeBlobMaterial() {
  return new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#3a4a7a', transparent: true, opacity: 0.28, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// The model context every drawing function gets (models/index.js describes it), plus piece(key) and island.
//   finish() merges the batch into one mesh per material under root and returns the meshes.
export function makeModelContext({ materials, blobMaterial, blobPlane, model = null, island = null, root = new THREE.Group(), log = null }) {
  const batch = new Batch();
  const dynamic = [], moodHooks = [], disposables = [];
  const ctx = {
    batch, model, island, materials, root, dynamic, palette: P,
    add(geometry, mat, color, local, base, ao = true, grad = null) {
      base = base ?? new THREE.Matrix4();
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
  withPieces(ctx, log);
  const finish = () => {
    const meshes = batch.build({ ...materials, blob: blobMaterial }, root);
    for (const mesh of meshes) disposables.push(mesh.geometry);
    return meshes;
  };
  return { ctx, batch, dynamic, moodHooks, disposables, finish };
}

// One drawing step that never breaks the rest: an error is logged and the island keeps what it has.
function part(ctx, name, fn) {
  ctx.piece(`${name}:unkeyed`);
  try { return fn(); } catch (error) { console.error(`Town ${name} failed:`, error); return null; } finally { ctx.piece(null); }
}

// Builds one island into its own group. Returns everything the builder keeps about it.
export function buildTownIsland(island, model, shared, { log = null } = {}) {
  const started = now();
  const group = new THREE.Group();
  group.name = `island-${island.id}`;
  group.position.set(island.at[0], island.lift, island.at[1]);
  const pieces = log ? new Map() : null;
  const made = makeModelContext({ ...shared, model, island, root: group, log: pieces });
  const { ctx } = made;
  const ground = part(ctx, 'ground', () => buildGround(ctx, island)) ?? {};
  part(ctx, 'lanes', () => buildLanes(ctx, island));
  part(ctx, 'blocks', () => buildBlocks(ctx, island));
  part(ctx, 'things', () => buildThings(ctx, island, island.things));
  part(ctx, 'visitors', () => buildVisitors(ctx, island));
  const meshes = made.finish();
  if (log) log.set(island.id, pieces);
  const frame = islandFrame(island, ground.framePoints);
  return {
    kind: 'island', id: island.id, key: island.key, group, meshes, island,
    loop: Array.isArray(ground.loop) ? ground.loop : [], frame,
    dynamic: made.dynamic, moodHooks: made.moodHooks, ms: now() - started,
    dispose() {
      group.removeFromParent();
      for (const item of made.disposables) item?.dispose?.();
    },
  };
}

// A bridge's key: everything that changes its drawing. Either island drifting moves its feet (at).
export const bridgeKey = bridge => JSON.stringify([bridge.type, [bridge.from, bridge.to].map(end => [end.island, end.point, end.at, end.out, end.clear])]);

export function buildTownBridge(bridge, model, shared, { log = null } = {}) {
  const started = now();
  const group = new THREE.Group();
  group.name = `bridge-${bridge.id}`;
  const pieces = log ? new Map() : null;
  const made = makeModelContext({ ...shared, model, root: group, log: pieces });
  part(made.ctx, `bridge:${bridge.id}`, () => buildBridge(made.ctx, bridge, model));
  const meshes = made.finish();
  if (log) log.set(`bridge:${bridge.id}`, pieces);
  return {
    kind: 'bridge', id: bridge.id, key: bridgeKey(bridge), group, meshes,
    dynamic: made.dynamic, moodHooks: made.moodHooks, ms: now() - started,
    dispose() {
      group.removeFromParent();
      for (const item of made.disposables) item?.dispose?.();
    },
  };
}

// Points that frame one island whole, in island units: the coast at grass height, block roofs, things
// at a rough height for their footprint, and the ground's own frame points (the underside's upper bulge).
// Without those, a little below the coast stands in for the underside.
function islandFrame(island, groundPoints) {
  const points = [];
  for (const p of island.coast) points.push([...pointAt(island, p, 0)]);
  for (const [p, floors] of island.floors) points.push(pointAt(island, p, floors * TOWN.storey + TOWN.roofRise));
  for (const thing of island.things) points.push([thing.at[0], (THING_TOP[FOOT_OF[thing.points.length]] ?? 0.5) * thing.scale, thing.at[1]]);
  const given = Array.isArray(groundPoints) ? groundPoints.filter(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) : [];
  if (given.length) points.push(...given);
  else [...island.coast].forEach((p, i) => { if (i % 3 === 0) points.push(pointAt(island, p, -0.45)); });
  if (!points.length) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) points.push([x, 0, z]);
  return points;
}

const pointAt = (island, p, y) => [island.grid.points[p][0], y, island.grid.points[p][1]];

export function createTownBuilder(parent, materials, { log = null } = {}) {
  const root = new THREE.Group();
  root.name = 'town';
  parent.add(root);
  const shared = { materials, blobMaterial: makeBlobMaterial(), blobPlane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  const islands = new Map(); // id -> built island
  const bridges = new Map(); // id -> built bridge
  let model = null;

  const add = built => { root.add(built.group); return built; };

  return {
    root,
    get islands() { return islands; },
    get bridges() { return bridges; },
    get model() { return model; },
    update(next, { force = false } = {}) {
      const started = now();
      model = next;
      const report = { rebuilt: [], moved: [], kept: [], removed: [], bridges: [], ms: 0, islandMs: {} };
      const ids = new Set(next.islands.map(i => i.id));
      for (const [id, built] of islands) if (!ids.has(id)) { built.dispose(); islands.delete(id); report.removed.push(id); }
      for (const island of next.islands) {
        const old = islands.get(island.id);
        if (old && old.key === island.key && !force) {
          const moved = old.group.position.x !== island.at[0] || old.group.position.y !== island.lift || old.group.position.z !== island.at[1];
          old.group.position.set(island.at[0], island.lift, island.at[1]);
          old.island = island;
          (moved ? report.moved : report.kept).push(island.id);
          continue;
        }
        old?.dispose();
        const built = add(buildTownIsland(island, next, shared, { log }));
        islands.set(island.id, built);
        report.rebuilt.push(island.id);
        report.islandMs[island.id] = built.ms;
      }
      const bridgeIds = new Set(next.bridges.map(b => b.id));
      for (const [id, built] of bridges) if (!bridgeIds.has(id)) { built.dispose(); bridges.delete(id); }
      for (const bridge of next.bridges) {
        const old = bridges.get(bridge.id);
        if (old && old.key === bridgeKey(bridge) && !force) continue;
        old?.dispose();
        bridges.set(bridge.id, add(buildTownBridge(bridge, next, shared, { log })));
        report.bridges.push(bridge.id);
      }
      report.ms = now() - started;
      return report;
    },
    rebuildAll(next = model) { return next ? this.update(next, { force: true }) : null; },
    // World points that frame one island whole (it may have drifted since it was built).
    framePoints(id) {
      const built = islands.get(id);
      if (!built) return [];
      const { at, lift } = built.island;
      return built.frame.map(([x, y, z]) => [at[0] + x, lift + y, at[1] + z]);
    },
    // World points for some grid points of one island and every point within `steps` of them, with
    // heights for blocks and things standing there.
    closePoints(id, ids, steps = 4) {
      const built = islands.get(id);
      if (!built) return [];
      const island = built.island;
      const { grid } = island;
      const near = new Map(ids.map(p => [p, 0]));
      const queue = [...ids];
      for (let h = 0; h < queue.length; h++) {
        const d = near.get(queue[h]);
        if (d >= steps) continue;
        for (const n of grid.neighbours[queue[h]]) if (!near.has(n)) { near.set(n, d + 1); queue.push(n); }
      }
      const points = [];
      for (const p of near.keys()) {
        if (!island.land.has(p)) continue;
        const floors = island.floors.get(p);
        const thing = island.taken.get(p);
        const top = floors ? floors * TOWN.storey + TOWN.roofRise : thing ? (THING_TOP[FOOT_OF[thing.points.length]] ?? 0.5) * thing.scale : 0;
        points.push(island.world(p, 0));
        if (top) points.push(island.world(p, top));
      }
      return points;
    },
    // Grass spots for fireflies, [x, z, y] in world space: every third free land point.
    landSpots(id) {
      const island = islands.get(id)?.island;
      if (!island) return [];
      const spots = [];
      island.order.forEach((p, i) => {
        if (i % 3 || island.lanes.has(p) || island.floors.has(p) || island.taken.has(p)) return;
        const [x, y, z] = island.world(p);
        spots.push([x, z, y]);
      });
      return spots;
    },
    *parts() { yield* islands.values(); yield* bridges.values(); },
    applyMood(mood, settings) { for (const built of this.parts()) for (const hook of built.moodHooks) hook(mood, settings); },
    animate(t) { for (const built of this.parts()) for (const fn of built.dynamic) fn(t); },
    // Triangles and meshes in the town's static groups.
    stats() {
      let triangles = 0, meshes = 0;
      for (const built of this.parts()) for (const mesh of built.meshes) {
        meshes++;
        const g = mesh.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
      return { triangles: Math.round(triangles), meshes, islands: islands.size, bridges: bridges.size };
    },
    dispose() {
      for (const built of this.parts()) built.dispose();
      islands.clear();
      bridges.clear();
      root.removeFromParent();
      shared.blobMaterial.dispose();
      shared.blobPlane.dispose();
    },
  };
}
