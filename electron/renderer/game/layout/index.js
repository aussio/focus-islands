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
  game = squareGame(game);
  const input = JSON.stringify([game?.islands ?? [], game?.links ?? [], game?.helpers ?? []]);
  if (input !== last.input) last = { input, world: layoutWorld(game) };
  return structuredClone(last.world);
}

// TEMPORARY: delete in stage 2 of the town rebuild (game/BUILD_PLAN.md), when Today switches to the town.
// Version-2 rules count land in town-grid points and build block houses. This square layout still thinks
// in building spots and cottages, so read a version-2 state the old way: land ÷ 7 spots, a house drawn as a
// cottage, and rooms and floors left out. Every link is drawn as a plain rope bridge (its type, check-in
// and land are dropped), and each island's ring, angle and lift are ignored: the square sky places
// islands its own way. Version-1 states pass through unchanged.
const POINTS_PER_SPOT = 7;
function squareGame(game) {
  if (!game || !(game.rulesVersion >= 2)) return game;
  const spots = points => Math.floor((Number(points) || 0) / POINTS_PER_SPOT);
  return {
    ...game,
    islands: (game.islands ?? []).map(({ ring, angle, lift, ...island }) => ({
      ...island,
      land: spots(island.land),
      buildings: (island.buildings ?? []).filter(b => b.blueprint !== 'room' && b.blueprint !== 'floor')
        .map(b => ({ ...b, blueprint: b.blueprint === 'house' ? 'cottage' : b.blueprint, landWhenBuilt: spots(b.landWhenBuilt) })),
    })),
    links: (game.links ?? []).map(({ id, from, to }) => ({ id, from, to })),
  };
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

