// A tidy stand-in for any kind without its own model yet, so every world draws.
// Buildings become a pastel block with a white-trimmed pitched roof that fills the footprint,
// walls in the kind's colour and the roof a deeper shade of it. Open-air places (garden, pond,
// quarry...) become a raised bed with posts and a sign. Kinds helpers walk over (flowers, lanterns)
// become a low planter.
// Wonders get a golden star on top. A later model for the kind replaces this completely.
import * as THREE from 'three';
import { P, CELL } from '../style.js';
import { hashString, place } from '../ground.js';
import { rbox } from '../parts.js';
import { addDoor, addRoof, addWindow } from './buildings.js';

export const PLACEHOLDER_COLOURS = {
  flowers: '#ff9cc0', garden: '#e8b07a', nursery: '#a6e48a', sawmill: '#f0c98f', workshop: '#a9c4e0',
  windmill: '#fff0c2', orchard: '#ff9a85', lanterns: '#ffd25e', tower: '#c6b8f0', pond: '#8fd3ff',
  greattree: '#7ed67a', grotto: '#9fd0c8', quarry: '#d4d6e6', beehives: '#ffd84d', forge: '#ff9a7a',
  loom: '#e6b3e8', lighthouse: '#fff4ec', airship: '#ffc14d', observatory: '#a9b6ec', skyfall: '#9fe2ff',
  aurora: '#a8f0d4',
};
const WONDERS = new Set(['lighthouse', 'airship', 'observatory', 'skyfall', 'aurora']);
const PLOTS = new Set(['garden', 'nursery', 'orchard', 'pond', 'quarry', 'greattree', 'beehives']);
const LIGHTS = new Set(['lanterns']); // their blooms glow in the evening

export function placeholderColour(kind) {
  return PLACEHOLDER_COLOURS[kind] ?? `hsl(${Math.round(hashString(kind) * 360)}, 80%, 74%)`;
}

export function placeholder(ctx, thing, base) {
  const colour = new THREE.Color().setStyle(placeholderColour(thing.kind)).getStyle();
  // A deeper shade of the kind's colour for roofs and signs, so each placeholder reads as one colour
  // and none of them look like the red-roofed cottage.
  const hsl = new THREE.Color().setStyle(colour).getHSL({}, THREE.SRGBColorSpace);
  const deep = new THREE.Color().setHSL(hsl.h, Math.min(0.75, hsl.s * 0.6 + 0.1), Math.max(0.42, hsl.l * 0.74), THREE.SRGBColorSpace).getStyle();
  const W = thing.fw * CELL, D = thing.fd * CELL;
  if (thing.blocks && PLOTS.has(thing.kind)) {
    // An open-air place: a raised bed in the kind's colour with corner posts, rounded tufts and a sign.
    const w = W - 0.16, d = D - 0.16;
    ctx.add(rbox(w, 0.08, d, 0.02, 2), 'matte', P.trim, place(0, 0.04, 0), base);
    ctx.add(rbox(w - 0.1, 0.03, d - 0.1, 0.012, 2), 'matte', colour, place(0, 0.08, 0), base, false);
    const nx = Math.max(2, Math.round(w / 0.45)), nz = Math.max(2, Math.round(d / 0.45));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = (i + 0.5) / nx * (w - 0.3) - (w - 0.3) / 2, z = (k + 0.5) / nz * (d - 0.3) - (d - 0.3) / 2;
      const tall = 0.16 + ((i * 7 + k * 3) % 5) * 0.035;
      ctx.add(rbox(0.2, tall, 0.2, 0.08, 3), 'matte', (i + k) % 2 ? deep : colour, place(x, 0.09 + tall / 2, z), base);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.add(rbox(0.06, 0.22, 0.06, 0.015, 1), 'matte', P.trim, place(sx * (w / 2 - 0.03), 0.11, sz * (d / 2 - 0.03)), base, false);
    ctx.add(rbox(0.04, 0.34, 0.04, 0.01, 1), 'matte', P.log, place(w * 0.28, 0.17, d / 2 + 0.04), base);
    ctx.add(rbox(0.26, 0.14, 0.035, 0.012, 1), 'matte', deep, place(w * 0.28, 0.32, d / 2 + 0.06), base, false);
    ctx.blob(base, W * 0.95, D * 0.95);
    return;
  }
  if (!thing.blocks) {
    // Low planter with coloured blooms.
    const w = W - 0.12, d = D - 0.12;
    ctx.add(rbox(w, 0.1, d, 0.012, 2), 'matte', P.trim, place(0, 0.05, 0), base);
    ctx.add(rbox(w - 0.06, 0.04, d - 0.06, 0.01, 2), 'matte', '#c98a5a', place(0, 0.1, 0), base, false);
    const nx = Math.max(1, Math.round(w / 0.14)), nz = Math.max(1, Math.round(d / 0.14));
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = (i + 0.5) / nx * (w - 0.1) - (w - 0.1) / 2, z = (k + 0.5) / nz * (d - 0.1) - (d - 0.1) / 2;
      const light = LIGHTS.has(thing.kind) && (i + k) % 3;
      ctx.add(new THREE.IcosahedronGeometry(0.045, 0), light ? 'glow' : 'facet', (i + k) % 3 ? colour : P.white, place(x, 0.15, z, { ry: i + k }), base, false);
    }
    ctx.blob(base, W * 0.9, D * 0.9);
    return;
  }
  const wonder = WONDERS.has(thing.kind);
  const roof = deep;
  const w = Math.max(0.36, W - 0.26), d = Math.max(0.36, D - 0.26);
  const wallH = Math.min(1.2, 0.5 + Math.max(thing.fw, thing.fd) * 0.08 + (wonder ? 0.35 : 0));
  ctx.add(rbox(w + 0.06, 0.07, d + 0.06, 0.012, 2), 'matte', P.trim, place(0, 0.035, 0), base);
  ctx.add(rbox(w, wallH, d, 0.012, 2), 'matte', colour, place(0, wallH / 2 + 0.02, 0), base);
  ctx.add(rbox(w + 0.03, 0.045, d + 0.03, 0.008, 2), 'matte', P.trim, place(0, wallH - 0.005, 0), base, false);
  // The gable always faces the front, like the cottage. Wide footprints get a flatter pitch so the
  // roof never towers over the walls.
  const pitch = Math.min(0.7, Math.atan(0.62 / (w / 2)));
  const rise = addRoof(ctx, base, { w, d, top: wallH + 0.02, roof, wall: colour, pitch, chimney: false, gableWindow: true });
  if (w >= 0.5) addDoor(ctx, base, -Math.min(0.18, w * 0.2), d / 2);
  for (let level = 0; level < Math.floor((wallH - 0.1) / 0.4); level++) addWindow(ctx, base, w >= 0.5 ? Math.min(0.24, w * 0.25) : 0, 0.38 + level * 0.4, d / 2, 0.2);
  if (wonder) {
    // A golden star on a short post above the ridge marks a Starlight wonder.
    const ridge = wallH + 0.02 + rise + 0.07;
    ctx.add(rbox(0.03, 0.24, 0.03, 0.008, 1), 'matte', '#e8b53a', place(0, ridge + 0.12, 0), base, false);
    ctx.add(new THREE.OctahedronGeometry(0.12, 0), 'glow', '#ffd23f', place(0, ridge + 0.3, 0, { ry: 0.6 }), base, false);
  }
  ctx.blob(base, W * 1.05, D * 1.0, 0, 0.03);
}
