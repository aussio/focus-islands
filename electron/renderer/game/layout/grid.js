// Small grid and hashing helpers shared by the layout files. Plain code: no DOM, no Three.js.

// Cells are stored as one number so Sets and Maps stay fast. Coordinates may be negative.
const OFFSET = 2048;
const SPAN = 4096;
export const key = (x, y) => (x + OFFSET) * SPAN + (y + OFFSET);
export const keyX = k => Math.floor(k / SPAN) - OFFSET;
export const keyY = k => (k % SPAN) - OFFSET;

// Steps by facing: 0 south (+y, toward the camera), 1 east (+x), 2 north (-y), 3 west (-x).
export const STEP = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const N4 = STEP;
// The eight cells around a cell, in a loop: N, NE, E, SE, S, SW, W, NW.
export const RING8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

// FNV-1a over the text, so each island id gives its own seed.
export function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Mixes whole numbers into a seed (murmur3 finaliser). Same inputs, same result, every time.
export function mix(seed, ...parts) {
  let h = seed >>> 0;
  for (const part of parts) {
    h ^= Math.imul((part | 0) + 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

// A "dice roll" in [0, 1) from a seed and the parts it is for.
export const roll = (seed, ...parts) => mix(seed, ...parts) / 4294967296;

// Picks from [[value, weight], ...] with a roll in [0, 1).
export function pickWeighted(options, r) {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let left = r * total;
  for (const [value, weight] of options) {
    left -= weight;
    if (left < 0) return value;
  }
  return options[options.length - 1][0];
}
