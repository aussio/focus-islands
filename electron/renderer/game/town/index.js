// The town layout: turns the game state into a world (see shape.js). Plain code: no DOM, no Three.js.
//
//   buildTown(game) => world   the same state always gives a deep-equal world, with the same grids
//
// Not used on Today until stage 2; the square layout in layout/ still draws Today.
import { emptyTown } from './shape.js';

// Stream B (layout) owns this. Stub from stage 0: an empty world.
export function buildTown(game) {
  return emptyTown();
}
