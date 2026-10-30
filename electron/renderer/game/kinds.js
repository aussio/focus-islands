// Every kind of thing that can sit on an island. Layout uses the footprints to place things;
// the scene uses them to draw and to send helpers to work. Adding a kind means one entry here,
// one model in the scene, and (for buildings) one blueprint in electron/core/game/rules.js.
//
// foot: the points it covers on the town grid (see FOOTS). pad: drawn on a stone pad, facing its
// lane. Flower beds and lanterns are buildings too, placed like pads, but drawn without one.
// blocks: helpers walk around it. work: the job done there.
// edge: a coast building (it hangs over or looks out from the edge).
// size: footprint in square cells [w, h], for the square layout until the town replaces it.

export const KINDS = {
  // Natural things and start things. They are never built.
  tree: { size: [1, 1], foot: 'point', blocks: true, work: 'wood' },
  rock: { size: [1, 1], foot: 'point', blocks: true, work: 'stone' },
  bush: { size: [1, 1], foot: 'point', blocks: true },
  flower: { size: [1, 1], foot: 'point', blocks: false },
  pile: { size: [1, 1], foot: 'point', blocks: true },
  fire: { size: [1, 1], foot: 'point', blocks: true },
  seat: { size: [1, 1], foot: 'point', blocks: false },
  mushroom: { size: [1, 1], foot: 'point', blocks: true },
  crystal: { size: [1, 1], foot: 'point', blocks: true },
  goldentree: { size: [1, 1], foot: 'point', blocks: true },

  // Buildings, one per blueprint id.
  flowers: { size: [2, 1], foot: 'pair', blocks: false },
  cottage: { size: [2, 2], foot: 'cell', blocks: true }, // square layout only; the town uses block houses
  garden: { size: [2, 2], foot: 'cell', pad: true, blocks: true, work: 'soil' },
  nursery: { size: [2, 2], foot: 'cell', pad: true, blocks: true, work: 'saplings' },
  sawmill: { size: [2, 2], foot: 'cell', pad: true, blocks: true, work: 'planks' },
  workshop: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  windmill: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  orchard: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  lanterns: { size: [1, 1], foot: 'point', blocks: false },
  tower: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  pond: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  greattree: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  grotto: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  quarry: { size: [2, 2], foot: 'cell', pad: true, blocks: true, work: 'stone' },
  beehives: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  forge: { size: [2, 2], foot: 'cell', pad: true, blocks: true },
  loom: { size: [2, 2], foot: 'cell', pad: true, blocks: true },

  // Starlight wonders.
  lighthouse: { size: [2, 2], foot: 'cell', pad: true, blocks: true, edge: true },
  airship: { size: [3, 2], foot: 'cells', pad: true, blocks: true, edge: true },
  observatory: { size: [3, 3], foot: 'ring', pad: true, blocks: true },
  skyfall: { size: [2, 2], foot: 'cell', pad: true, blocks: true, edge: true },
  aurora: { size: [3, 3], foot: 'ring', pad: true, blocks: true },
};

// Footprints on the town grid, and how many points each covers.
// point: one point. pair: two neighbouring points. cell: one cell's four corners.
// cells: two cells that share a side (six points). ring: a point with exactly four cells around it (nine points).
export const FOOTS = { point: 1, pair: 2, cell: 4, cells: 6, ring: 9 };

// Pad models are drawn at this scale times the pad's own fit (thing.scale).
export const MODEL_SCALE = 0.9;

// Blueprints that build block houses instead of a thing: a new house, one more block, one more storey.
export const BLOCK_BLUEPRINTS = ['house', 'room', 'floor'];

// Bridge looks (bridge.type in the world). A water slide always runs from a higher island down to a
// lower one (from has the bigger lift).
export const BRIDGE_TYPES = ['rope', 'arch', 'slide', 'cloudsteps', 'flowerarch', 'rainbow'];

// Jobs a helper can hold, and the kinds they work at (nearest first).
export const JOB_SPOTS = {
  wood: ['tree'],
  stone: ['rock', 'quarry'],
  planks: ['sawmill'],
  soil: ['garden'],
  saplings: ['nursery'],
};
