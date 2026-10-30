// Every kind of thing that can sit on an island cell. Layout uses the sizes to place things;
// the scene uses them to draw and to send helpers to work. Adding a kind means one entry here,
// one model in the scene, and (for buildings) one blueprint in electron/core/game/rules.js.
//
// size: footprint in cells [w, h]. blocks: helpers walk around it. work: the job done there.
// edge: must touch the coast (it hangs over or looks out from the edge).

export const KINDS = {
  // Natural things the layout scatters. They are never built.
  tree: { size: [1, 1], blocks: true, work: 'wood' },
  rock: { size: [1, 1], blocks: true, work: 'stone' },
  bush: { size: [1, 1], blocks: true },
  flower: { size: [1, 1], blocks: false },
  pile: { size: [1, 1], blocks: true },
  fire: { size: [1, 1], blocks: true },
  seat: { size: [1, 1], blocks: false },
  mushroom: { size: [1, 1], blocks: true },
  crystal: { size: [1, 1], blocks: true },
  goldentree: { size: [1, 1], blocks: true },

  // Buildings, one per blueprint id.
  flowers: { size: [2, 1], blocks: false },
  cottage: { size: [2, 2], blocks: true },
  garden: { size: [2, 2], blocks: true, work: 'soil' },
  nursery: { size: [2, 2], blocks: true, work: 'saplings' },
  sawmill: { size: [2, 2], blocks: true, work: 'planks' },
  workshop: { size: [2, 2], blocks: true },
  windmill: { size: [2, 2], blocks: true },
  orchard: { size: [2, 2], blocks: true },
  lanterns: { size: [1, 1], blocks: false },
  tower: { size: [2, 2], blocks: true },
  pond: { size: [2, 2], blocks: true },
  greattree: { size: [2, 2], blocks: true },
  grotto: { size: [2, 2], blocks: true },
  quarry: { size: [2, 2], blocks: true, work: 'stone' },
  beehives: { size: [2, 2], blocks: true },
  forge: { size: [2, 2], blocks: true },
  loom: { size: [2, 2], blocks: true },

  // Starlight wonders.
  lighthouse: { size: [2, 2], blocks: true, edge: true },
  airship: { size: [3, 2], blocks: true, edge: true },
  observatory: { size: [3, 3], blocks: true },
  skyfall: { size: [2, 2], blocks: true, edge: true },
  aurora: { size: [3, 3], blocks: true },
};

// Jobs a helper can hold, and the kinds they work at (nearest first).
export const JOB_SPOTS = {
  wood: ['tree'],
  stone: ['rock', 'quarry'],
  planks: ['sawmill'],
  soil: ['garden'],
  saplings: ['nursery'],
};
