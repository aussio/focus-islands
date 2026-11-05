// Every kind of thing that can sit on an island. Layout uses the footprints to place things;
// the scene uses them to draw and to send helpers to work. Adding a kind means one entry here,
// one model in the scene, and (for buildings) one blueprint in electron/core/game/rules.js.
//
// foot: the points it covers on the town grid (see FOOTS). pad: drawn on a stone pad, facing its
// lane. Flower beds and lanterns are buildings too, placed like pads, but drawn without one.
// blocks: helpers walk around it. work: the job done there.
// edge: a coast building (it hangs over or looks out from the edge).
// along: lies along its plot's long side (town/pads.js farmYaw) and fills it; its model gets the plot's
// outline. padLook: its pad's colours, if not stone (scene/town/pads.js PAD_LOOKS).

export const KINDS = {
  // Natural things and start things. They are never built.
  tree: { foot: 'point', blocks: true, work: 'wood' },
  rock: { foot: 'point', blocks: true, work: 'stone' },
  bush: { foot: 'point', blocks: true },
  flower: { foot: 'point', blocks: false },
  pile: { foot: 'point', blocks: true },
  fire: { foot: 'point', blocks: true },
  seat: { foot: 'point', blocks: false },
  mushroom: { foot: 'point', blocks: true },
  crystal: { foot: 'point', blocks: true },
  goldentree: { foot: 'point', blocks: true },

  // Buildings, one per blueprint id.
  flowers: { foot: 'pair', blocks: false },
  garden: { foot: 'cell', pad: true, blocks: true, work: 'soil' },
  nursery: { foot: 'cell', pad: true, blocks: true, work: 'saplings' },
  farmyard: { foot: 'cells', pad: true, blocks: true, along: true, padLook: 'straw' },
  sawmill: { foot: 'cell', pad: true, blocks: true, work: 'planks' },
  workshop: { foot: 'cell', pad: true, blocks: true },
  windmill: { foot: 'cell', pad: true, blocks: true },
  orchard: { foot: 'cell', pad: true, blocks: true },
  lanterns: { foot: 'point', blocks: false },
  tower: { foot: 'cell', pad: true, blocks: true },
  pond: { foot: 'cell', pad: true, blocks: true },
  greattree: { foot: 'cell', pad: true, blocks: true },
  grotto: { foot: 'cell', pad: true, blocks: true },
  quarry: { foot: 'cell', pad: true, blocks: true, work: 'stone' },
  beehives: { foot: 'cell', pad: true, blocks: true },
  forge: { foot: 'cell', pad: true, blocks: true },
  loom: { foot: 'cell', pad: true, blocks: true },

  // Starlight wonders.
  lighthouse: { foot: 'cell', pad: true, blocks: true, edge: true },
  airship: { foot: 'cells', pad: true, blocks: true, edge: true },
  observatory: { foot: 'ring', pad: true, blocks: true },
  skyfall: { foot: 'cell', pad: true, blocks: true, edge: true },
  aurora: { foot: 'ring', pad: true, blocks: true },

  // Keepsakes: small things a surprise leaves for good (rules.js KEEPSAKES). Never built. The fountain
  // stands by the square; the rest on the coast, facing out (town/island.js placeKeepsake).
  fountain: { foot: 'point', blocks: true },
  well: { foot: 'point', blocks: true },
  bench: { foot: 'point', blocks: false },
  cairn: { foot: 'point', blocks: true },
  telescope: { foot: 'point', blocks: true },
  birdhouse: { foot: 'point', blocks: true },
  lamp: { foot: 'point', blocks: false },
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
