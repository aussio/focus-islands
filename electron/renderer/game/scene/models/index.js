// The model registry: one function per thing kind, all with the same signature:
//
//   model(ctx, thing, base)
//
// thing: what scene/town/pads.js hands over: { id, kind, island, x, z, c, r, fw, fd, w, h, facing, yaw,
//   blocks, old, modelScale, coast, coastDepth }, where fw x fd is the footprint the model was designed
//   for, in cells of CELL (0.6) units, in the model's own frame; facing is yaw in quarter turns; c and r
//   are numbers for rolls; old marks the island's first tree; coast and coastDepth are set for coast
//   buildings (wonders.js coastFrame).
// base: a Matrix4 at the middle of the footprint on the ground, turned by yaw and scaled to the pad.
//   Local +z is the front (toward the camera when yaw is 0).
// ctx.add(geometry, material, colour, local, base, ao = true, grad = null) bakes a piece into the
//   island's merged meshes. material: 'matte' | 'facet' | 'glass' (windows that glow at night) |
//   'glow' (warm lamps) | 'shine' (cool crystal light). ao darkens it near the ground; grad is
//   [y0, y1, dark, light] for a vertical light ramp.
// ctx.blob(base, sizeX, sizeZ, offsetX, offsetZ) adds a soft contact shadow.
// ctx.root, ctx.dynamic.push(t => ...), ctx.onMood((name, mood) => ...) and ctx.track(...disposables)
//   are for the few things that move or change with the mood (flames). Keep the island calm: besides
//   helpers and fire, only small slow things move (sails, water, small life), capped and still at time 0.
//
// To add or replace a model, add a function under the kind's name in nature.js, growing.js, making.js,
// wonders.js or keepsakes.js. Any kind without one draws as the placeholder. Block houses are not
// models: they are drawn by scene/town/blocks.js.
import { NATURE, decor } from './nature.js';
import { placeholder } from './placeholder.js';
import { GROWING } from './growing.js';
import { MAKING } from './making.js';
import { WONDERS } from './wonders.js';
import { KEEPSAKES } from './keepsakes.js';

export const MODELS = { ...NATURE, ...GROWING, ...MAKING, ...WONDERS, ...KEEPSAKES };
export const hasModel = kind => Object.hasOwn(MODELS, kind);
export const modelFor = kind => (hasModel(kind) ? MODELS[kind] : placeholder);
export { decor, placeholder };
