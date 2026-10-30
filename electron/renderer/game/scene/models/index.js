// The model registry: one function per thing kind, all with the same signature:
//
//   model(ctx, thing, base)
//
// thing: { id, kind, x, z, c, r, fw, fd, facing, height, blocks, old } where fw x fd is the footprint
//   in cells in the model's own frame, and old marks the island's first tree.
// base: a Matrix4 at the middle of the footprint on the ground, turned to face the thing's way.
//   Local +z is the front (the camera side when facing is 0). One cell is CELL (0.6) units wide.
// ctx.add(geometry, material, colour, local, base, ao = true, grad = null) bakes a piece into the
//   island's merged meshes. material: 'matte' | 'facet' | 'glass' (windows that glow at night) |
//   'glow' (warm lamps) | 'shine' (cool crystal light). ao darkens it near the ground; grad is
//   [y0, y1, dark, light] for a vertical light ramp.
// ctx.blob(base, sizeX, sizeZ, offsetX, offsetZ) adds a soft contact shadow.
// ctx.root, ctx.dynamic.push(t => ...), ctx.onMood((name, mood) => ...) and ctx.track(...disposables)
//   are for the few things that move or change with the mood (flames). Keep the island calm: only
//   helpers and fire should move.
//
// To add or replace a model, add a function under the kind's name in nature.js or buildings.js.
// Any kind without one draws as the placeholder.
import { NATURE, decor } from './nature.js';
import { BUILDINGS } from './buildings.js';
import { placeholder } from './placeholder.js';
import { GROWING } from './growing.js';
import { MAKING } from './making.js';
import { WONDERS } from './wonders.js';

export const MODELS = { ...NATURE, ...BUILDINGS, ...GROWING, ...MAKING, ...WONDERS };
export const hasModel = kind => Object.hasOwn(MODELS, kind);
export const modelFor = kind => (hasModel(kind) ? MODELS[kind] : placeholder);
export { decor, placeholder };
