// Stream C2's view: block houses (scene/town/blocks.js) on made-up islands and on real states. Never ships.
//
//   #blocks-shapes, #blocks-shapes-break   a lone block (four-, three- and five-way points), rows of 2 to 4,
//                                          L, T, cross, and blocks of four and six, in focus and in break
//   #blocks-storeys                        2 and 3 storeys, step-in ledges, joined houses of two colours
//   #blocks-details                        close-ups at Today's size: ridge trims, gables, doors and
//                                          windows, chimneys
//   #blocks-dusk                           a small town in every mood: windows glow at dusk
//   #blocks-sides                          one town seen from all four sides (cracks hide round the back)
//   #blocks-zoom                           large: a T, a block of four, a stepped row beside another house
//   #blocks-real                           every island of the steady planner's day 180, blocks only, at
//                                          Today's size, with triangle counts
//   #blocks-real-large                     the same islands large, from the south and the north-west
// Each section fits one gallery screenshot (1400 wide; pass a taller height for the longer ones).
import { gridFor } from '../../../electron/renderer/game/town/grid.js';
import { HOUSE_LOOKS, TOWN } from '../../../electron/renderer/game/scene/style.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { buildGround } from '../../../electron/renderer/game/scene/town/ground.js';
import { buildLanes } from '../../../electron/renderer/game/scene/town/lanes.js';
import { buildBlocks, planRoofs } from '../../../electron/renderer/game/scene/town/blocks.js';
import { checkTown } from '../../../electron/renderer/game/town/check.js';

const SMALL = [300, 210];
const TODAY = [591, 357];
const GRID = gridFor('blocks', 'medium');

// ---------- Finding points on the made-up grid ----------
const at = (grid, p) => grid.points[p];
// The neighbour of p whose way best matches a compass way: E, S (toward the camera), W, N.
const COMPASS = { E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] };
function toward(grid, p, way) {
  const [dx, dz] = COMPASS[way];
  const [x, z] = at(grid, p);
  let best = -1, score = -Infinity;
  for (const n of grid.neighbours[p]) {
    const [nx, nz] = at(grid, n), l = Math.hypot(nx - x, nz - z) || 1;
    const s = ((nx - x) * dx + (nz - z) * dz) / l;
    if (s > score) { score = s; best = n; }
  }
  return best;
}
// From p, take the given ways one after another: walk(grid, p, 'EEN') -> [p, e, ee, een].
const walk = (grid, p, ways) => [...ways].reduce((list, way) => [...list, toward(grid, list[list.length - 1], way)], [p]);
// The point nearest a spot with the given number of neighbours.
function pointNear(grid, [x, z], degree = 4) {
  let best = -1, d = Infinity;
  grid.points.forEach((q, p) => {
    if (grid.neighbours[p].length !== degree || grid.fromRim[p] < 6) return;
    const e = Math.hypot(q[0] - x, q[1] - z);
    if (e < d) { d = e; best = p; }
  });
  return best;
}
// The fourth point of the cell holding a, b and c (or -1).
function fourth(grid, a, b, c) {
  const cell = grid.around[a].find(i => [b, c].every(p => grid.cells[i].includes(p)));
  return cell === undefined ? -1 : grid.cells[cell].find(p => ![a, b, c].includes(p));
}
// Grid steps from a to b (Infinity when b can't be reached).
function hops(grid, a, b) {
  const seen = new Map([[a, 0]]);
  const queue = [a];
  for (let h = 0; h < queue.length; h++) {
    if (queue[h] === b) return seen.get(b);
    for (const q of grid.neighbours[queue[h]]) if (!seen.has(q)) { seen.set(q, seen.get(queue[h]) + 1); queue.push(q); }
  }
  return Infinity;
}
function within(grid, start, steps) {
  const seen = new Map([[start, 0]]);
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h];
    if (seen.get(p) >= steps) continue;
    for (const q of grid.neighbours[p]) if (!seen.has(q)) { seen.set(q, seen.get(p) + 1); queue.push(q); }
  }
  return queue;
}

// ---------- Made-up islands ----------
// houses: [{ blocks: [[point, floors], ...], look, door: point (optional: the block that gets the door) }].
// The lanes are one joined network, as on a real island, so no lane stops short against a house:
// - the first house's door opens toward the camera where it can, and a short lane runs south from it
//   (stopping before it would touch another house);
// - each other house gets the door whose outside point is fewest steps from the lanes so far (toward
//   the camera on a tie), and a lane joins it on, around the blocks.
// The returned island carries `problems`: what checkTown (town/check.js) finds wrong with the made-up
// world, so a stand-in that drifts from the real rules says so on its card.
function makeIsland(id, houses, { grid = GRID, centre, radius = 4 } = {}) {
  const owner = new Map(houses.flatMap((h, i) => h.blocks.map(([p]) => [p, i])));
  const middle = centre ?? houses[0].blocks[0][0];
  // At least two steps of land all round the houses, so no lane or free point is cut off at the coast.
  const far = Math.max(...[...owner.keys()].map(p => hops(grid, middle, p)));
  const land = within(grid, middle, Math.max(radius, far + 2));
  const landSet = new Set(land);
  const free = p => p >= 0 && landSet.has(p) && !owner.has(p);
  // Free land in pieces (blocks can wall some off): point -> how many points its piece has.
  const pieceSize = new Map();
  for (const p of land) {
    if (!free(p) || pieceSize.has(p)) continue;
    const piece = [p], seen = new Set(piece);
    for (let h = 0; h < piece.length; h++) for (const q of grid.neighbours[piece[h]]) if (free(q) && !seen.has(q)) { seen.add(q); piece.push(q); }
    for (const q of piece) pieceSize.set(q, piece.length);
  }
  const lanes = [], laneSet = new Set();
  const addLane = p => { if (!laneSet.has(p)) { laneSet.add(p); lanes.push(p); } };
  // Each place a house's door could go: a block and a free neighbour, scored by how much it faces south.
  const doorOptions = house => {
    const options = [];
    for (const p of house.door !== undefined ? [house.door] : house.blocks.map(([q]) => q)) {
      for (const n of grid.neighbours[p]) {
        if (!free(n)) continue;
        const [dx, dz] = [at(grid, n)[0] - at(grid, p)[0], at(grid, n)[1] - at(grid, p)[1]];
        options.push({ point: p, outside: n, score: dz / (Math.hypot(dx, dz) || 1) + at(grid, p)[1] * 0.2 });
      }
    }
    return options.sort((a, b) => b.score - a.score);
  };
  const doors = houses.map((house, i) => {
    const options = doorOptions(house);
    if (!options.length) return null;
    if (!laneSet.size) {
      // The first lane starts in the biggest piece of free land, not in a corner the blocks wall off.
      const door = options.reduce((best, o) => (pieceSize.get(o.outside) > pieceSize.get(best.outside) ? o : best));
      addLane(door.outside);
      const touchesOther = q => grid.neighbours[q].some(n => owner.has(n) && owner.get(n) !== i);
      for (let k = 0, p = door.outside; k < 2; k++) {
        const q = toward(grid, p, 'S');
        if (!free(q) || laneSet.has(q) || touchesOther(q)) break;
        addLane(q);
        p = q;
      }
      return door;
    }
    // Fewest steps from the lanes so far, through free land.
    const from = new Map(lanes.map(p => [p, -1]));
    const queue = [...lanes];
    for (let h = 0; h < queue.length; h++) {
      for (const q of grid.neighbours[queue[h]]) if (free(q) && !from.has(q)) { from.set(q, queue[h]); queue.push(q); }
    }
    const steps = p => { let n = 0; for (let q = p; from.get(q) !== -1; q = from.get(q)) n++; return n; };
    const reached = options.filter(o => from.has(o.outside));
    if (!reached.length) { addLane(options[0].outside); return options[0]; } // cut off: checkTown says so
    const door = reached.reduce((best, o) => (steps(o.outside) < steps(best.outside) ? o : best));
    for (let q = door.outside; q !== -1; q = from.get(q)) addLane(q);
    return door;
  });
  const shaped = houses.map((house, i) => ({
    id: `${id}-house-${i}`, look: house.look ?? 0, door: doors[i] && { point: doors[i].point, outside: doors[i].outside },
    blocks: house.blocks.map(([point, floors]) => ({ point, floors })),
  }));
  const world = {
    islands: [{ id, kind: 'home', size: grid.size, grid, at: [0, 0], lift: 0, land, kept: [], lanes, houses: shaped, reach: 3 }],
    things: [], bridges: [], helpers: [], view: { island: id, points: [] },
  };
  const island = parseTown(world).islands[0];
  island.problems = checkTown(world);
  return island;
}

// A card with checkTown's problems for a made-up island under its picture (none: the card as it is).
function checked(card, island) {
  const problems = island.problems ?? [];
  if (!problems.length) return card;
  const box = document.createElement('div');
  box.style.cssText = 'color:#b3261e;font-size:12px;max-width:560px;margin-top:4px';
  box.textContent = `Breaks the town rules (checkTown): ${problems.slice(0, 4).join(' · ')}${problems.length > 4 ? ' · …' : ''}`;
  card.append(box);
  return card;
}

// Frame the houses: their points, up to their roofs, with a margin.
function aimAt(island, pad = 0.45) {
  const points = [];
  for (const [p, floors] of island.floors) {
    const [x, z] = island.grid.points[p];
    const top = floors * TOWN.storey + TOWN.roofRise + 0.12;
    for (const [dx, dz] of [[-pad, -pad], [pad, -pad], [-pad, pad], [pad, pad]]) points.push([x + dx, 0, z + dz], [x + dx, top, z + dz]);
  }
  return points;
}

const drawIsland = island => ctx => {
  buildGround(ctx, island);
  buildLanes(ctx, island);
  buildBlocks(ctx, island);
};
const statsNote = img => (img.stats ? `${img.stats.triangles} triangles · ${img.stats.calls} draw calls` : '');

// ---------- The cases ----------
function shapeCases() {
  const g = GRID;
  const c4 = pointNear(g, [0, 0], 4), c3 = pointNear(g, [0, 0], 3), c5 = pointNear(g, [0, 0], 5);
  const [w, , e, ee] = [toward(g, c4, 'W'), c4, toward(g, c4, 'E'), walk(g, c4, 'EE')[2]];
  const n = toward(g, c4, 'N'), s = toward(g, c4, 'S');
  const one = list => [{ blocks: list.map(p => [p, 1]) }];
  const sq = fourth(g, c4, e, s);
  const sq2 = fourth(g, e, ee, toward(g, e, 'S'));
  return [
    ['Lone block', 'a four-way point', one([c4])],
    ['Lone block, three-way', 'no opposite pair: a hip roof', one([c3])],
    ['Lone block, five-way', 'no even split: a pyramid roof', one([c5])],
    ['Row of 2', 'gables at both ends', one([c4, e])],
    ['Row of 3', '', one([w, c4, e])],
    ['Row of 4', '', one([w, c4, e, ee])],
    ['Row of 3, north to south', 'the gable faces the camera', one([n, c4, s])],
    ['L', 'a valley inside, a hip outside', one(walk(g, c4, 'WW').reverse().concat(walk(g, c4, 'NN').slice(1)))],
    ['T', '', one([w, c4, e, ...walk(g, c4, 'SS').slice(1)])],
    ['Cross', '', one([w, c4, e, n, s])],
    ['Block of four', 'two gabled rows, a valley between', one([c4, e, s, sq].filter(p => p >= 0))],
    ['Block of six', '', one([c4, e, ee, s, sq, toward(g, ee, 'S'), sq2].filter((p, i, list) => p >= 0 && list.indexOf(p) === i).slice(0, 6))],
  ];
}

function storeyCases() {
  const g = GRID;
  const c = pointNear(g, [0, 0], 4);
  const [w, e, n, s] = ['W', 'E', 'N', 'S'].map(way => toward(g, c, way));
  const ee = toward(g, e, 'E'), ww = toward(g, w, 'W');
  return [
    ['2 storeys', 'a lone tower', [{ blocks: [[c, 2]], look: 1 }]],
    ['3 storeys', '', [{ blocks: [[c, 3]], look: 2 }]],
    ['Row with a taller middle', 'ledges where it steps in', [{ blocks: [[w, 1], [c, 2], [e, 1]], look: 0 }]],
    ['Row stepping up', '1, 2, 3 storeys', [{ blocks: [[w, 1], [c, 2], [e, 3]], look: 3 }]],
    ['Tower at a row end', '', [{ blocks: [[ww, 1], [w, 1], [c, 1], [e, 3]], look: 4 }]],
    ['L with a 2-storey corner', '', [{ blocks: [[w, 1], [c, 2], [n, 1], [e, 1]], look: 5 }]],
    ['Two houses joined, same height', 'the roofs run together', [{ blocks: [[w, 1], [c, 1]], look: 0 }, { blocks: [[e, 1], [ee, 1]], look: 2 }]],
    ['Two houses joined, 2 and 1 storeys', '', [{ blocks: [[w, 2], [c, 2]], look: 1 }, { blocks: [[e, 1], [ee, 1], [toward(g, e, 'S'), 1]], look: 3 }]],
    ['Two houses, a T', '', [{ blocks: [[w, 1], [c, 1], [e, 1]], look: 5 }, { blocks: [[s, 2]], look: 4 }]],
  ];
}

// A small town: several houses of every look, joined and apart.
function littleTown(id = 'blocks-town') {
  const g = GRID;
  const c = pointNear(g, [0, 0], 4);
  const row = walk(g, c, 'WW').reverse().concat(walk(g, c, 'E').slice(1));
  const north = walk(g, toward(g, c, 'N'), 'N');
  const east = walk(g, toward(g, toward(g, c, 'E'), 'E'), 'EN').slice(1);
  const south = walk(g, toward(g, toward(g, c, 'S'), 'S'), 'E').slice(0);
  const west = walk(g, toward(g, toward(g, row[0], 'W'), 'S'), 'S');
  return makeIsland(id, [
    { blocks: row.map((p, i) => [p, i === 2 ? 2 : 1]), look: 0 },
    { blocks: north.map((p, i) => [p, i ? 3 : 2]), look: 1 },
    { blocks: east.map(p => [p, 1]), look: 2 },
    { blocks: south.map(p => [p, 1]), look: 3 },
    { blocks: west.map((p, i) => [p, i ? 1 : 2]), look: 4 },
  ].filter(h => h.blocks.every(([p]) => p >= 0)), { centre: c, radius: 5 });
}

// An island id whose rolls give the most chimneys for these houses (rolls are keyed by island id).
function chimneyIsland(houses, centre) {
  let best = null, most = -1;
  for (let k = 0; k < 40; k++) {
    const island = makeIsland(`chimneys-${k}`, houses, { centre });
    const count = planRoofs(island).chimneys.size;
    if (count > most) { most = count; best = island; }
  }
  return best;
}

// ---------- Sections ----------
async function shapes(tools, mood) {
  tools.heading(`Shapes (${mood})`, 'ridges run along rows, end in gables, and meet in valleys and hips');
  const row = tools.grid('gallery-medium');
  let i = 0;
  for (const [title, note, houses] of shapeCases()) {
    const island = makeIsland(`shape-${i}`, houses.map(h => ({ ...h, look: h.look ?? i % HOUSE_LOOKS.length })));
    const img = await tools.shot(drawIsland(island), { width: SMALL[0], height: SMALL[1], mood, aim: aimAt(island) });
    row.append(checked(tools.card(title, note, [img]), island));
    i++;
  }
}

export default {
  id: 'blocks',
  title: 'Block houses (stream C2)',
  sections: [
    { id: 'shapes', title: 'Shapes in focus', render: (host, tools) => shapes(tools, 'focus') },
    { id: 'shapes-break', title: 'Shapes in break', render: (host, tools) => shapes(tools, 'break') },
    {
      id: 'storeys', title: 'Storeys, ledges and joined houses',
      async render(host, tools) {
        for (const mood of ['focus', 'break']) {
          tools.heading(`Storeys and joins (${mood})`, 'a storey that steps in leaves a white ledge; joined houses keep their own colours');
          const row = tools.grid('gallery-medium');
          let i = 0;
          for (const [title, note, houses] of storeyCases()) {
            const island = makeIsland(`storeys-${i++}`, houses);
            row.append(checked(tools.card(title, note, [await tools.shot(drawIsland(island), { width: SMALL[0], height: SMALL[1], mood, aim: aimAt(island) })]), island));
          }
        }
      },
    },
    {
      id: 'details', title: 'Close-ups at Today\'s size',
      async render(host, tools) {
        const g = GRID;
        const c = pointNear(g, [0, 0], 4);
        const row3 = [toward(g, c, 'W'), c, toward(g, c, 'E')];
        const ns = [toward(g, c, 'N'), c, toward(g, c, 'S')];
        tools.heading('Ridges and gables', 'white ridge trim along every ridge; white boards up each gable; eaves only along the sides');
        let grid = tools.grid();
        const ridge = makeIsland('detail-ridge', [{ blocks: [...row3.map(p => [p, 1]), [toward(g, c, 'S'), 1]], look: 0 }, { blocks: [[toward(g, toward(g, c, 'E'), 'E'), 2]], look: 2 }]);
        for (const [label, options] of [['From above', { pitch: 1.25 }], ['Today\'s angle', {}]]) {
          const img = await tools.shot(drawIsland(ridge), { width: TODAY[0], height: TODAY[1], aim: aimAt(ridge, 0.3), ...options });
          grid.append(checked(tools.card(label, statsNote(img), [img]), ridge));
        }
        tools.heading('Doors and windows', 'one door per house, facing its lane; framed windows with sills; a round window in some gables');
        grid = tools.grid();
        const front = makeIsland('detail-door', [{ blocks: ns.map((p, i) => [p, i === 0 ? 2 : 1]), look: 3, door: ns[2] }]);
        for (const [label, options] of [['Low, from the south', { pitch: 0.35 }], ['Low, from the south-east', { pitch: 0.4, yaw: 0.7 }]]) {
          const img = await tools.shot(drawIsland(front), { width: TODAY[0], height: TODAY[1], aim: aimAt(front, 0.25), ...options });
          grid.append(checked(tools.card(label, statsNote(img), [img]), front));
        }
        tools.heading('Chimneys', 'on some blocks, by roll');
        grid = tools.grid();
        const chimneys = chimneyIsland([{ blocks: row3.map(p => [p, 1]), look: 1 }, { blocks: [[toward(g, toward(g, c, 'S'), 'S'), 2]], look: 4 }, { blocks: [[toward(g, toward(g, c, 'N'), 'N'), 1], [toward(g, toward(g, toward(g, c, 'N'), 'N'), 'E'), 1]], look: 5 }], c);
        for (const mood of ['focus', 'break']) {
          const img = await tools.shot(drawIsland(chimneys), { width: TODAY[0], height: TODAY[1], mood, aim: aimAt(chimneys, 0.3) });
          grid.append(checked(tools.card(`${planRoofs(chimneys).chimneys.size} chimneys (${mood})`, statsNote(img), [img]), chimneys));
        }
      },
    },
    {
      id: 'dusk', title: 'A small town in every mood',
      async render(host, tools) {
        tools.heading('Moods', 'windows use the glass material, so they glow in break, away and done');
        const town = littleTown();
        const grid = tools.grid();
        for (const mood of tools.MOODS) {
          const img = await tools.shot(drawIsland(town), { width: TODAY[0], height: TODAY[1], mood, aim: aimAt(town, 0.2) });
          grid.append(checked(tools.card(mood, statsNote(img), [img]), town));
        }
      },
    },
    {
      id: 'sides', title: 'One town from every side',
      async render(host, tools) {
        tools.heading('Turned', 'the back and the sides, where cracks and missing faces would hide');
        const town = littleTown('blocks-sides');
        const grid = tools.grid();
        for (const [label, yaw] of [['From the south (Today)', 0], ['From the east', Math.PI / 2], ['From the north', Math.PI], ['From the west', -Math.PI / 2]]) {
          const img = await tools.shot(drawIsland(town), { width: TODAY[0], height: TODAY[1], yaw, aim: aimAt(town, 0.2) });
          grid.append(checked(tools.card(label, '', [img]), town));
        }
      },
    },
    {
      id: 'zoom', title: 'Large: a T, a block of four, ledges and joined colours',
      async render(host, tools) {
        tools.heading('Large', 'for checking joins: cracks, seams, boards that miss, parts that float or sink');
        const g = GRID;
        const c = pointNear(g, [0, 0], 4);
        const [w, e, s] = ['W', 'E', 'S'].map(way => toward(g, c, way));
        const cases = [
          ['T with a gable toward the camera', makeIsland('zoom-t', [{ blocks: [[w, 1], [c, 1], [e, 1], ...walk(g, c, 'SS').slice(1).map(p => [p, 1])], look: 0 }])],
          ['Block of four', makeIsland('zoom-four', [{ blocks: [c, e, s, fourth(g, c, e, s)].map(p => [p, 1]), look: 4 }])],
          ['Row 1, 2, 3 storeys beside another house', makeIsland('zoom-steps', [{ blocks: [[w, 1], [c, 2], [e, 3]], look: 3 }, { blocks: [[s, 1], [toward(g, s, 'W'), 1]], look: 1 }])],
        ];
        for (const [title, island] of cases) {
          const grid = tools.grid();
          for (const [label, yaw] of [['Today\'s angle', 0], ['from the north-west', Math.PI * 0.8]]) {
            grid.append(checked(tools.card(`${title}, ${label}`, '', [await tools.shot(drawIsland(island), { width: 640, height: 456, yaw, aim: aimAt(island, 0.15) })]), island));
          }
        }
      },
    },
    {
      id: 'real', title: 'Real states: the steady planner at day 180',
      async render(host, tools) {
        const entries = tools.data.town.states.filter(entry => entry.world?.islands?.some(i => i.grid?.points));
        const entry = entries.filter(e => e.person === 'steady').sort((a, b) => b.day - a.day)[0] ?? entries[0];
        if (!entry) { tools.note(tools.data.town.note || 'No town states.'); return; }
        const model = parseTown(entry.world);
        tools.heading(`${entry.personName ?? entry.person}, day ${entry.day}`, 'ground, lanes and blocks of each island, framed on its houses, at Today\'s size');
        const grid = tools.grid();
        let triangles = 0;
        for (const island of model.islands) {
          if (!island.floors.size) continue;
          const blocksOnly = await tools.shot(ctx => buildBlocks(ctx, island), { width: 120, height: 80, aim: aimAt(island) });
          triangles += blocksOnly.stats?.triangles ?? 0;
          for (const mood of ['focus', 'break']) {
            const img = await tools.shot(drawIsland(island), { width: TODAY[0], height: TODAY[1], mood, aim: aimAt(island, 0.6) });
            grid.append(tools.card(`${island.id} (${mood})`, `${island.floors.size} blocks · blocks alone: ${blocksOnly.stats?.triangles ?? '?'} triangles, ${blocksOnly.stats?.calls ?? '?'} draw calls`, [img]));
          }
        }
        tools.note(`Blocks on all islands together: ${triangles} triangles.`);
      },
    },
    {
      id: 'real-large', title: 'Real states, large: day 180 houses from two sides',
      async render(host, tools) {
        const entries = tools.data.town.states.filter(entry => entry.world?.islands?.some(i => i.grid?.points));
        const entry = entries.filter(e => e.person === 'steady').sort((a, b) => b.day - a.day)[0] ?? entries[0];
        if (!entry) { tools.note(tools.data.town.note || 'No town states.'); return; }
        tools.heading(`${entry.personName ?? entry.person}, day ${entry.day}, large`, 'for checking how real towns join: roofs, gables, ledges');
        for (const island of parseTown(entry.world).islands) {
          if (!island.floors.size) continue;
          const grid = tools.grid();
          for (const [label, yaw] of [['Today\'s angle', 0], ['from the north-west', Math.PI * 0.8]]) {
            grid.append(tools.card(`${island.id}, ${label}`, '', [await tools.shot(drawIsland(island), { width: 640, height: 456, yaw, aim: aimAt(island, 0.15) })]));
          }
        }
      },
    },
  ],
};
