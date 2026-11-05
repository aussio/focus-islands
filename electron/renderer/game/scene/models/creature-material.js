// One material per colour for the small creatures drawn as separate figures (the cat, the visiting bird).
// Their palettes are small and fixed, so the cache stays small and lives as long as the page: a figure
// never disposes these, only its own shapes.
import * as THREE from 'three';

const cache = new Map();
export function creatureMaterial(color) {
  if (!cache.has(color)) cache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
  return cache.get(color);
}
export const isCreatureMaterial = material => [...cache.values()].includes(material);
