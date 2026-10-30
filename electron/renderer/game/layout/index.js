// Layout: turns the game state into a world map for the scene. Plain code, no Three.js, no DOM.
//
//   buildWorld(game) => { islands, things, bridges, helpers }   (shape in game/BUILD_PLAN.md)
//   worldToText(world, { legend }) => ASCII map for tests and reviews
//   checkWorld(world) => list of broken layout rules (empty when all is well)
//   islandAnchor(world, islandId) => the island's pile cell, its fixed reference point
//
// The same game state always gives a deep-equal world. Nothing already placed ever moves
// relative to its island, and land never disappears.
import { key } from './grid.js';
import { layoutIsland } from './island.js';
import { placeIslands } from './sky.js';

export { worldToText } from './text.js';
export { checkWorld } from './check.js';

// The last world built, so asking again with the same state is cheap. Callers get a fresh copy.
let last = { input: null, world: null };

export function buildWorld(game) {
  const input = JSON.stringify([game?.islands ?? [], game?.links ?? [], game?.helpers ?? []]);
  if (input !== last.input) last = { input, world: layoutWorld(game) };
  return structuredClone(last.world);
}

function layoutWorld(game) {
  const gameIslands = game?.islands ?? [];
  const layouts = gameIslands.map(island => layoutIsland(island));
  const { anchors, bridges } = placeIslands(layouts, game?.links ?? []);

  const islands = layouts.map((layout, i) => {
    const [ax, ay] = anchors[i];
    const { minX, maxX, minY, maxY } = layout.box;
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      let row = '';
      for (let x = minX; x <= maxX; x++) {
        const k = key(x, y);
        row += !layout.land.has(k) ? '.' : layout.path.has(k) ? 'p' : 'g';
      }
      rows.push(row);
    }
    return { id: layout.id, kind: layout.kind, origin: [ax + minX, ay + minY], rows, heights: null };
  });

  const things = [];
  layouts.forEach((layout, i) => {
    const [ax, ay] = anchors[i];
    for (const thing of layout.things) {
      if (thing.golden && !gameIslands[i].golden) continue; // its kept spot stays plain grass
      things.push({ id: thing.id, kind: thing.kind, island: layout.id, c: ax + thing.x, r: ay + thing.y, w: thing.w, h: thing.h, facing: thing.facing });
    }
  });

  const helpers = (game?.helpers ?? []).map(({ id, name, job, island }) => ({ id, name, job: job ?? null, island }));
  return { islands, things, bridges, helpers };
}

// For tests and tools: an island's fixed reference cell (its storage pile) on the world grid.
export function islandAnchor(world, islandId) {
  const pile = world.things.find(thing => thing.island === islandId && thing.kind === 'pile');
  return pile ? [pile.c, pile.r] : null;
}

