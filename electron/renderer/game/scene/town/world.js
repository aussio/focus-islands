// Turns a town world (town/shape.js) into the model the town scene draws from.
//
//   parseTown(world) => { islands, things, bridges, helpers, view }
//   islands[]: { id, kind, grid, at, land: Set, lanes: Set, floors: Map, look: Map, doors, kept },
//   with things, bridges, helpers and view in world positions.

// Stream E (scene glue) owns this. Stub from stage 0: an empty model.
export function parseTown(world) {
  return { islands: [], things: [], bridges: [], helpers: [], view: null };
}
