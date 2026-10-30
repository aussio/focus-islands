// One island's things: stone pads with their models, and the one-point and pair things. Stream D owns this.
//
//   buildThings(ctx, island, things = island.things) => [{ id, top: [x, y, z] }]
//
// Drawn in island units (the island's group floats at [at.x, lift, at.z]; y = 0 is the grass top).
// island: parseTown's island (grid, id, index, things). things: parseTown's things, each with points,
// local (its middle in island units), yaw (0 faces south, toward the camera), scale, pad, coast.
//
// - A special building stands on the grid prototype's stone pad: a raised slab 0.74 of a piece wide and
//   0.05 high, drawn as corner pieces around each of its points, with cut outer corners. Its model sits
//   at the pad's middle, turned by yaw at any angle and scaled by MODEL_SCALE × the kind's own scale
//   (kinds.js `scale`, if a kind ever needs one) × thing.scale.
// - One-point things (trees, rocks, the pile, seats...) and the flower bed on a pair stand on the grass
//   without a pad, at thing.scale.
// - Models keep the square scene's signature (models/index.js). They get the square fields they read,
//   worked out here: footprint in cells (fw, fd), facing in quarter turns (any fraction, so windmill sails
//   keep the shared wind), and for coast buildings `coast` with how far the island's edge is
//   (coastDepth), which coastFrame in wonders.js reads instead of looking at square cells.
// - Each pad corner piece is tagged pad:<cell>:<corner>, and each model thing:<id>, so the drawing check
//   can see that a thing's pieces change only when its own points do.
import { KINDS, MODEL_SCALE } from '../../kinds.js';
import { CELL, P, TOWN } from '../style.js';
import { hashString, place } from '../ground.js';
import { modelFor } from '../models/index.js';
import { addPiece, piecesAt, slabPiece } from './pieces.js';

export const COAST_EDGE = 0.3; // how far the grass reaches past the coast points (half a step, less rounding)
const QUARTER = Math.PI / 2;
const PAD_AO = { ao: { ground: 0, height: 0.2, min: 0.85 } };

// The middle of a thing in island units: from the layout, else from its points.
export function thingMiddle(island, thing) {
  if (Array.isArray(thing.local)) return thing.local;
  if (Array.isArray(thing.at)) return thing.at;
  const pts = thing.points.map(p => island.grid.points[p]);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

// The size a model is drawn at: pad models at MODEL_SCALE × the kind's scale × the pad's fit.
export function modelScale(thing) {
  const scale = Number.isFinite(thing.scale) && thing.scale > 0 ? thing.scale : 1;
  return thing.pad ? MODEL_SCALE * (KINDS[thing.kind]?.scale ?? 1) * scale : scale;
}

export function buildThings(ctx, island, things = island.things ?? []) {
  const tops = [];
  const firstTree = things.find(t => t.kind === 'tree' && t.id === `${island.id}:tree`) ?? things.find(t => t.kind === 'tree');
  for (const thing of things) {
    if (!thing?.points?.length) continue;
    if (thing.pad) buildPad(ctx, island, thing);
    ctx.piece?.(`thing:${thing.id}`);
    const before = ctx.batch.top;
    ctx.batch.top = -Infinity;
    const [x, z] = thingMiddle(island, thing);
    try {
      placeModel(ctx, island, thing, thing === firstTree);
    } catch (error) {
      console.error(`Model for ${thing.kind} failed:`, error);
    }
    const top = Number.isFinite(ctx.batch.top) ? ctx.batch.top : (thing.pad ? 1 : 0.4);
    ctx.batch.top = Math.max(before, top);
    tops.push({ id: thing.id, top: [x, top, z] });
  }
  return tops;
}

// The stone pad: corner pieces around each of the thing's points, joined where its points meet.
function buildPad(ctx, island, thing) {
  const mine = new Set(thing.points);
  const on = p => mine.has(p);
  for (const p of thing.points) {
    for (const c of piecesAt(island.grid, p)) {
      const mesh = slabPiece(c, { width: TOWN.padWidth, rise: TOWN.padRise, fA: on(c.next), fB: on(c.prev), fO: on(c.opp), top: P.stone, side: P.stoneDark });
      addPiece(ctx, `pad:${c.key}`, mesh, 'matte', PAD_AO);
    }
  }
}

function placeModel(ctx, island, thing, old) {
  const kind = KINDS[thing.kind] ?? {};
  const [x, z] = thingMiddle(island, thing);
  const yaw = Number.isFinite(thing.yaw) ? thing.yaw : 0;
  const s = modelScale(thing);
  const y = thing.pad ? TOWN.padRise : 0;
  const base = place(x, y, z, { ry: yaw, s });
  // The footprint the model was designed for, in square cells, in its own frame.
  let [fw, fd] = kind.size ?? [1, 1];
  if (kind.foot === 'pair' && thing.points.length === 2) {
    const [a, b] = thing.points.map(p => island.grid.points[p]);
    fw = (Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.4) / CELL;
    fd = 0.5 / CELL;
  } else if (kind.foot === 'point') {
    fw = fd = 1;
  }
  const seed = Math.floor(hashString(`island:${island.id}`) * 997);
  const model = {
    id: thing.id, kind: thing.kind, island: thing.island,
    x, z, c: thing.points[0], r: seed, c0: thing.points[0], r0: seed,
    fw, fd, w: fw, h: fd, facing: yaw / QUARTER, yaw, height: 0,
    blocks: thing.blocks ?? kind.blocks, old, modelScale: s,
    coast: thing.coast ?? null, coastDepth: thing.coast ? coastDepth(island, thing, x, z) : null,
  };
  modelFor(thing.kind)(ctx, model, base);
}

// How far the island's edge is from a coast building's middle, toward its coast.
function coastDepth(island, thing, x, z) {
  const dx = Math.sin(thing.coast.yaw), dz = Math.cos(thing.coast.yaw);
  const most = Math.max(...thing.points.map(p => (island.grid.points[p][0] - x) * dx + (island.grid.points[p][1] - z) * dz));
  return most + COAST_EDGE;
}
