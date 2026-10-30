// Shared building parts: framed windows, arched doors and pitched roofs, used by the building models
// (making.js, wonders.js) and the placeholder. Houses are block houses now (scene/town/blocks.js).
import * as THREE from 'three';
import { P } from '../style.js';
import { place } from '../ground.js';
import { gableGeometry, rbox } from '../parts.js';

const R = 2; // rounded-box segments

// A white-framed window with a cross, recessed glass and a sill, on the wall plane z.
export function addWindow(ctx, base, x, y, z, size = 0.22) {
  const f = 0.035;
  ctx.add(rbox(size, size, 0.02, 0.004, 1), 'glass', P.glass, place(x, y, z + 0.008), base, false);
  for (const sy of [-1, 1]) ctx.add(rbox(size + f * 2, f, 0.05, 0.005, R), 'matte', P.trim, place(x, y + sy * (size + f) / 2, z + 0.02), base, false);
  for (const sx of [-1, 1]) ctx.add(rbox(f, size, 0.05, 0.005, R), 'matte', P.trim, place(x + sx * (size + f) / 2, y, z + 0.02), base, false);
  ctx.add(rbox(0.016, size, 0.03, 0.004, 1), 'matte', P.trim, place(x, y, z + 0.018), base, false);
  ctx.add(rbox(size, 0.016, 0.03, 0.004, 1), 'matte', P.trim, place(x, y, z + 0.018), base, false);
  ctx.add(rbox(size + f * 2 + 0.04, 0.03, 0.08, 0.005, R), 'matte', P.trim, place(x, y - size / 2 - f - 0.012, z + 0.03), base, false);
}

// An arched door with a white frame and a step, on the wall plane z.
export function addDoor(ctx, base, x, z, colour = P.door) {
  ctx.add(rbox(0.29, 0.41, 0.035, 0.006, R), 'matte', P.trim, place(x, 0.225, z + 0.01), base);
  ctx.add(rbox(0.2, 0.3, 0.045, 0.006, R), 'matte', colour, place(x, 0.2, z + 0.018), base);
  ctx.add(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 'matte', colour, place(x, 0.35, z + 0.018), base, false);
  ctx.add(rbox(0.32, 0.035, 0.12, 0.006, R), 'matte', P.trim, place(x, 0.018, z + 0.07), base);
}

// A pitched roof with a crisp overhang and white trim on every edge. The ridge runs front to back,
// so from the camera both slopes show (one lit, one shaded) and the gable faces forward.
// w: width across (x), d: depth front to back (z), top: wall top height. Returns the roof rise.
// The default pitch is low (about 29 degrees): seen from the high camera, a steep roof turned side-on
// covers the walls and reads as a flat coloured board. A low roof leaves the walls, door and windows
// in view, and both slopes plus the white ridge and gable trim still read as a roof.
// To run the ridge left to right instead, pass a base turned a quarter turn and swap w and d.
export function addRoof(ctx, base, { w, d, top, roof, wall, pitch = 0.5, over = 0.08, chimney = true, gableWindow = true }) {
  const roofBase = base.clone().multiply(place(0, 0, 0, { ry: Math.PI / 2 }));
  // In roofBase, local x runs front to back (the ridge) and local z runs across.
  const half = w / 2 + over, slope = half / Math.cos(pitch);
  const rise = (w / 2) * Math.tan(pitch), drop = over * Math.tan(pitch);
  const mid = top + (rise - drop) / 2;
  const len = d + over * 2 + 0.04; // along the ridge, with the same overhang front and back
  const T = 0.055; // slab thickness
  // Shingle rows: a few slightly darker bands along each slope, so a roof seen side-on (a building
  // turned east or west) still reads as a roof and not as a flat coloured board.
  const band = new THREE.Color().setStyle(roof).multiplyScalar(0.82).getStyle();
  for (const side of [-1, 1]) {
    ctx.add(rbox(len, T, slope, 0.008, R), 'matte', roof, place(0, mid + T / 2 * Math.cos(pitch), side * (half / 2 + T / 2 * Math.sin(pitch)), { rx: side * pitch }), roofBase);
    for (const f of [0.35, 0.68]) {
      ctx.add(rbox(len - 0.02, 0.02, 0.03, 0.006, 1), 'matte', band, place(0, top + rise - (rise + drop) * f + T * 1.05, side * half * f, { rx: side * pitch }), roofBase, false);
    }
    // White fascia along the eave and bargeboards up each gable edge.
    ctx.add(rbox(len + 0.04, 0.05, 0.05, 0.006, R), 'matte', P.trim, place(0, top - drop, side * (half + 0.005)), roofBase);
    for (const end of [-1, 1]) ctx.add(rbox(0.05, 0.06, slope + 0.03, 0.006, R), 'matte', P.trim, place(end * len / 2, mid + T * 0.7, side * half / 2, { rx: side * pitch }), roofBase, false);
  }
  ctx.add(gableGeometry(d - 0.02, w - 0.02, rise - 0.01), 'matte', wall, place(0, top - 0.01, 0), roofBase, false);
  // A wide white ridge cap, so the peak shows as a bright line from above.
  ctx.add(rbox(len + 0.05, 0.05, 0.1, 0.01, R), 'matte', P.trim, place(0, top + rise + T, 0), roofBase, false);
  if (chimney) {
    // Stands on the back slope, its foot sunk into the roof and its top well above the ridge.
    const across = -half * 0.45, foot = top + (w / 2 - Math.abs(across)) * Math.tan(pitch) + T - 0.04;
    const head = top + rise + 0.24, h = head - foot;
    ctx.add(rbox(0.13, h, 0.13, 0.008, R), 'matte', P.trim, place(d * 0.26, foot + h / 2, across), roofBase, false);
    ctx.add(rbox(0.17, 0.04, 0.17, 0.006, R), 'matte', P.trim, place(d * 0.26, head, across), roofBase, false);
  }
  if (gableWindow) {
    // Round window in the front gable, sized to fit the triangle.
    // Kept low in the triangle: the roof's front overhang hides the top of the gable from the camera.
    const r = Math.min(0.07, rise * 0.26), y = top + Math.min(rise * 0.36, 0.18);
    ctx.add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.04, 20).rotateX(Math.PI / 2), 'matte', P.trim, place(0, y, d / 2 + 0.01), base, false);
    ctx.add(new THREE.CylinderGeometry(r, r, 0.04, 20).rotateX(Math.PI / 2), 'glass', P.glass, place(0, y, d / 2 + 0.02), base, false);
  }
  return rise;
}
