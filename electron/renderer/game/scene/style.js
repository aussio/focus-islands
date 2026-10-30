// Style D ("Townscaper-like"): bright saturated colours, white trim, crisp shapes with small bevels,
// grey-lilac rocks, faceted trees, a soft rounded coast and a faceted underside with roots.
// Everything about colour, light and sky lives here so models and moods share one palette.
import * as THREE from 'three';

export const CELL = 0.6; // world units per grid cell
export const LEVEL = 0.3; // height of one raised level

export const P = {
  grass: '#8edb6c', grassSide: '#6cc35a', hillSide: '#78cb5f',
  path: '#fff7ea', white: '#ffffff', trim: '#fffaf2',
  soil: '#f4cf98', soilDeep: '#e9a982', rock: '#b8a9dd', rockDeep: '#8e85c6',
  trunk: '#b9825a', leaf: ['#5cc85d', '#73d56a', '#4fbd5b'], blossom: '#ffffff',
  stone: '#d9dbe8', stoneDark: '#c3c6da', boulder: '#c9cce0', lilac: '#b4a6d8', lilacDeep: '#9488c4',
  log: '#c48a5f', logCut: '#f6dcb0', plank: '#f0c98f', plankDark: '#e2b47a', post: '#b9825a', rope: '#f1e2c4',
  handle: '#a87650', steel: '#e3e7ef', ash: '#7b7486', ember: '#ff9a52',
  walls: ['#ffd25e', '#7cc8ff', '#ff9a85'], roofs: ['#e9553f', '#e9553f', '#5b6fd6'], door: '#2fb8a5', glass: '#a8dcff',
  flower: ['#ffffff', '#ff8fb4', '#ffd25e', '#b88cff', '#ff6b6b'],
  mushroomCap: '#ff5a5f', mushroomStem: '#fff3e2', crystal: ['#b99cff', '#8fd8ff', '#ffa8e0'],
  root: '#c99467',
};

// Grass tint per island kind, so new islands read as their own place.
export const ISLAND_GRASS = {
  home: { top: P.grass, side: P.grassSide },
  mossy: { top: '#6fcf6a', side: '#52b45a' },
  rocky: { top: '#a3d47a', side: '#86bb64' },
  meadow: { top: '#a6e36a', side: '#86cc55' },
  crystal: { top: '#8fe0b0', side: '#6cc799' },
  misty: { top: '#94d9a6', side: '#72c08f' },
};

// Helper outfits. Shirts follow arrival order so the first helpers all look different; the hat
// follows the job, so you can tell at a glance who chops and who mines.
export const SHIRTS = ['#ff4f5e', '#2f8bff', '#ffb21e', '#24c49a', '#a35cff', '#ff7ab6', '#3fc7e0', '#ff8a3d'];
export const PANTS = ['#3b4a8f', '#3a3550', '#4c5aa8'];
export const JOB_HATS = {
  wood: { hat: 'beanie', hatColor: '#ffd23f' },
  stone: { hat: 'hardhat', hatColor: '#ffcf2e' },
  planks: { hat: 'cap', hatColor: '#ff4f5e' },
  soil: { hat: 'straw', hatColor: '#ffe7a6' },
  saplings: { hat: 'hood', hatColor: '#7be07b' },
  none: { hat: 'beanie', hatColor: '#fff1d6' }, // cream, so it never melts into a shirt
};
export function lookFor(helper, index) {
  return { shirt: SHIRTS[index % SHIRTS.length], pants: PANTS[index % PANTS.length], ...(JOB_HATS[helper.job] ?? JOB_HATS.none) };
}

// Moods change only the sky, the light, what glows and what helpers do. Geometry never changes.
export const MOODS = {
  focus: {
    gradient: [[0, '#62b9f5'], [0.55, '#bfe6ff'], [1, '#fff1df']],
    fog: '#d3ecff', fogNear: 1.0, fogFar: 2.5,
    hemi: ['#ffffff', '#b7cff5', 1.35],
    sun: { color: '#fff3dc', intensity: 2.3, dir: [0.45, 0.8, 0.4] },
    fill: ['#ffe8f0', 0.35],
    stars: 0, moon: false, windows: 0, fire: 'out', fireflies: 0,
    cloud: { color: '#ffffff', emissive: '#ffffff', glow: 0.5, opacity: 1 },
    fallback: 'linear-gradient(#62b9f5, #bfe6ff 55%, #fff1df)',
  },
  break: {
    gradient: [[0, '#4a4f9d'], [0.45, '#a77dc3'], [0.8, '#ffa89a'], [1, '#ffd3a0']],
    fog: '#cf9dbd', fogNear: 1.0, fogFar: 2.4,
    hemi: ['#ffc8dc', '#7c72c6', 1.05],
    sun: { color: '#ffae7c', intensity: 1.8, dir: [-0.6, 0.5, 0.45] },
    fill: ['#ff9fb4', 0.3],
    stars: 70, moon: false, windows: 1.15, fire: 'lit', fireflies: 1,
    cloud: { color: '#ffd8e2', emissive: '#ffc4d4', glow: 0.35, opacity: 1 },
    fallback: 'linear-gradient(#4a4f9d, #a77dc3 45%, #ffa89a 80%, #ffd3a0)',
  },
  // Like break, but quieter: a cooler, greyer dusk, fewer stars, the fire down to embers, no fireflies.
  away: {
    gradient: [[0, '#4d5894'], [0.5, '#8088b6'], [0.85, '#b4b2cc'], [1, '#d4cbd6']],
    fog: '#9fa0c2', fogNear: 1.0, fogFar: 2.4,
    hemi: ['#d6d6ee', '#6f74ad', 1.05],
    sun: { color: '#e6d4d8', intensity: 1.35, dir: [-0.5, 0.6, 0.45] },
    fill: ['#b8bce6', 0.28],
    stars: 28, moon: false, windows: 0.75, fire: 'embers', fireflies: 0,
    cloud: { color: '#d8d6ea', emissive: '#c4c4de', glow: 0.3, opacity: 0.9 },
    fallback: 'linear-gradient(#4d5894, #8088b6 50%, #b4b2cc 85%, #d4cbd6)',
  },
  // Night: the day is over and everyone sleeps. Kept light enough that the island still reads.
  done: {
    gradient: [[0, '#1d2456'], [0.55, '#33407f'], [1, '#6a6aa8']],
    fog: '#3c4684', fogNear: 1.0, fogFar: 2.6,
    hemi: ['#a9b6ff', '#3d3f78', 1.15],
    sun: { color: '#c9d4ff', intensity: 1.15, dir: [0.35, 0.8, 0.45] },
    fill: ['#8f9cff', 0.25],
    stars: 140, moon: true, windows: 1.35, fire: 'embers', fireflies: 0,
    cloud: { color: '#7d86c4', emissive: '#5a62a4', glow: 0.25, opacity: 0.85 },
    fallback: 'linear-gradient(#1d2456, #33407f 55%, #6a6aa8)',
  },
};
export const moodOf = mood => (MOODS[mood] ? mood : 'focus');
export const isEvening = mood => mood !== 'focus';

// Shared materials. Static geometry carries its colour in vertex colours, so a handful of
// materials draws the whole island in a few draw calls.
export function createMaterials() {
  const std = extra => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...extra });
  return {
    ground: std({ roughness: 0.95 }),
    under: std({ roughness: 0.95, flatShading: true }),
    matte: std({}),
    facet: std({ flatShading: true }),
    glass: std({ roughness: 0.25, emissive: '#ffd27a', emissiveIntensity: 0 }),
    // Things that glow at night (lantern panes, crystal hearts): emissive follows the mood.
    glow: std({ roughness: 0.4, emissive: '#ffe2a0', emissiveIntensity: 0 }),
    // Crystals: a cool inner light that is faint by day and bright at night.
    shine: std({ roughness: 0.3, flatShading: true, emissive: '#b9a4ff', emissiveIntensity: 0.12 }),
  };
}

// Applies a mood to the shared materials.
export function moodMaterials(materials, mood) {
  const m = MOODS[moodOf(mood)];
  materials.glass.emissiveIntensity = m.windows;
  materials.glow.emissiveIntensity = m.windows ? 0.9 + m.windows * 0.3 : 0.08;
  materials.shine.emissiveIntensity = m.windows ? 0.35 + m.windows * 0.3 : 0.12;
}
