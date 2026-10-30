// Stream C's view: the ground and lane pieces (scene/town/ground.js, lanes.js), on made-up islands and on
// real states. Sections: grid lines on each grid size, every lane piece (from above and at Today's angle),
// where lanes reach (a door, a pad front, a bridge deck), whole islands at Today's size, the underside,
// a bridge foot moving out along its pier as the island grows, and the bay of sky kept in front of a coast
// building.
import * as THREE from 'three';
import { gridFor } from '../../../electron/renderer/game/town/grid.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { buildGround } from '../../../electron/renderer/game/scene/town/ground.js';
import { buildLanes } from '../../../electron/renderer/game/scene/town/lanes.js';
import { buildBlocks } from '../../../electron/renderer/game/scene/town/blocks.js';
import { buildThings } from '../../../electron/renderer/game/scene/town/pads.js';
import { buildBridge } from '../../../electron/renderer/game/scene/town/bridges.js';

const SMALL = [300, 210];
const MEDIUM = [400, 270];
const TODAY = [591, 357];

// ---------- Made-up islands ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// The point nearest the grid's middle with four neighbours (so a cross has four ways).
const middlePoint = grid => grid.points.reduce((best, p, i) => (grid.neighbours[i].length === 4 && (best < 0 || Math.hypot(...p) < Math.hypot(...grid.points[best])) ? i : best), -1);
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
// The neighbours of p, going round.
const around = (grid, p) => [...grid.neighbours[p]].sort((a, b) => {
  const [x, z] = grid.points[p];
  return Math.atan2(grid.points[a][1] - z, grid.points[a][0] - x) - Math.atan2(grid.points[b][1] - z, grid.points[b][0] - x);
});
// The neighbour of `to` that carries straight on from `from`: never one that shares a cell with `from`
// (that would cut across a cell), and the best lined up of the rest; undefined when there is none.
function ahead(grid, from, to) {
  const [fx, fz] = grid.points[from], [tx, tz] = grid.points[to];
  const d = [tx - fx, tz - fz];
  const near = new Set(grid.around[from].flatMap(cell => grid.cells[cell]));
  const away = grid.neighbours[to].filter(q => q !== from && !near.has(q));
  return away.sort((a, b) => {
    const ca = (grid.points[a][0] - tx) * d[0] + (grid.points[a][1] - tz) * d[1];
    const cb = (grid.points[b][0] - tx) * d[0] + (grid.points[b][1] - tz) * d[1];
    return cb - ca;
  })[0];
}
function line(grid, from, to, count) {
  const out = [from, to];
  while (out.length < count) {
    const next = ahead(grid, out[out.length - 2], out[out.length - 1]);
    if (next === undefined) break;
    out.push(next);
  }
  return out;
}

// One made-up island as parseTown's model. extra: more island fields (houses, kept ...), things, bridges.
function madeIsland({ id = 'pieces', size = 'small', kind = 'home', land, lanes = [], kept = [], houses = [], things = [] }) {
  const grid = gridFor(id, size);
  const world = {
    islands: [{ id, kind, size, grid, at: [0, 0], lift: 0, land, lanes, kept, houses, reach: 1 }],
    things: things.map(t => ({ island: id, ...t })), bridges: [], helpers: [], view: { island: id, points: [] },
  };
  const model = parseTown(world);
  return { model, island: model.islands[0] };
}

// ---------- Drawing ----------
// Thin lines along the grid sides between land points, a little above the grass.
function gridLines(ctx, island, { y = 0.035, colour = '#2d6a3a', opacity = 0.45 } = {}) {
  const { grid, land } = island;
  const positions = [];
  const seen = new Set();
  grid.cells.forEach(cell => cell.forEach((p, k) => {
    const q = cell[(k + 1) % 4];
    const key = p < q ? `${p}:${q}` : `${q}:${p}`;
    if (seen.has(key) || !land.has(p) || !land.has(q)) return;
    seen.add(key);
    positions.push(grid.points[p][0], y, grid.points[p][1], grid.points[q][0], y, grid.points[q][1]);
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity });
  ctx.track(material, geometry);
  ctx.root.add(new THREE.LineSegments(geometry, material));
}
// Small dots on chosen points (lane points, a foot), to show which points a picture is about.
function dots(ctx, island, points, colour = '#e9553f', radius = 0.035) {
  const geometry = new THREE.SphereGeometry(radius, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: colour });
  ctx.track(material, geometry);
  for (const p of points) {
    const dot = new THREE.Mesh(geometry, material);
    dot.position.set(island.grid.points[p][0], 0.09, island.grid.points[p][1]);
    ctx.root.add(dot);
  }
}
// Draws one island the way the town scene does (ground, lanes, then blocks and things when asked).
function drawIsland(ctx, island, { blocks = false, things = false, lines = false, marks = [] } = {}) {
  const ground = buildGround(ctx, island);
  buildLanes(ctx, island);
  if (blocks) buildBlocks(ctx, island);
  if (things) buildThings(ctx, island, island.things);
  if (lines) gridLines(ctx, island);
  if (marks.length) dots(ctx, island, marks);
  return ground;
}
const aimAt = (island, points, pad = 0.55) => points.flatMap(p => {
  const [x, z] = island.grid.points[p];
  return [[x - pad, 0, z - pad], [x + pad, 0, z + pad], [x - pad, 0, z + pad], [x + pad, 0, z - pad]];
});
const statsNote = img => (img.stats ? `${img.stats.triangles} triangles · ${img.stats.calls} draw calls · built in ${img.stats.buildMs} ms` : '');

// ---------- Real states ----------
function realIslands(tools) {
  const entries = tools.data.town.states.filter(entry => entry.world?.islands?.some(i => i.grid?.points));
  const day180 = entries.filter(e => e.person === 'steady').sort((a, b) => b.day - a.day)[0] ?? entries[0];
  if (!day180) return null;
  const model = parseTown(day180.world);
  return { label: `${day180.personName ?? day180.person}, day ${day180.day}`, model, entries };
}

// One bridge end through the steady planner's days: the end facing the camera most whose foot moved
// most. { end: { island, bridge }, steps: [{ day, model, island, foot }] } or null. Each step's island is
// that day's, drawn in island units, so the pictures line up.
function pierFilm(tools) {
  const days = tools.data.town.states.filter(e => e.person === 'steady' && e.world?.islands?.some(i => i.grid?.points)).sort((a, b) => a.day - b.day)
    .map(entry => ({ day: entry.day, model: parseTown(entry.world) }));
  const ends = new Map(); // `${island}|${bridge}` -> [{ day, model, island, foot }]
  for (const { day, model } of days) for (const island of model.islands) for (const foot of island.feet) {
    const key = `${island.id}|${foot.bridge}`;
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push({ day, model, island, foot });
  }
  const moves = list => new Set(list.map(step => step.foot.point)).size;
  const best = [...ends.entries()].sort(([ka, a], [kb, b]) => (b[0].foot.out[1] > -0.3) - (a[0].foot.out[1] > -0.3) || moves(b) - moves(a) || a[0].day - b[0].day || ka.localeCompare(kb))[0];
  if (!best) return null;
  const [island, bridge] = best[0].split('|');
  // Each day the foot moved, plus the first and the last day.
  const steps = best[1].filter((step, i, all) => i === 0 || i === all.length - 1 || step.foot.point !== all[i - 1].foot.point);
  return { end: { island, bridge }, steps };
}

// A coast building and its bay: steady day 180 first, then any state. { label, island, thing, bay } or null.
function coastBay(tools) {
  const entries = tools.data.town.states.filter(e => e.world?.islands?.some(i => i.grid?.points))
    .sort((a, b) => (b.person === 'steady') - (a.person === 'steady') || b.day - a.day);
  for (const entry of entries) {
    const model = parseTown(entry.world);
    for (const island of model.islands) {
      const thing = island.things.find(t => t.coast && t.pad);
      if (thing && island.kept.size) return { label: `${entry.personName ?? entry.person}, day ${entry.day}`, island, thing, bay: [...island.kept] };
    }
  }
  return null;
}

// ---------- Lane cases ----------
function laneCases() {
  const grid = gridFor('pieces', 'small');
  const p0 = middlePoint(grid);
  const land = within(grid, p0, 4);
  const n = around(grid, p0);
  const n0 = n[0], n2 = ahead(grid, n0, p0); // two ways straight through p0
  const n1 = n.find(q => q !== n0 && q !== n2); // a way off to the side
  const out = q => [q, ahead(grid, p0, q)].filter(p => p !== undefined); // a neighbour and the point beyond it
  const plaza = [...new Set(grid.around[p0].flatMap(cell => grid.cells[cell]))];
  return {
    grid, p0, land,
    cases: [
      ['A lone point', 'the rounded blob each lane point starts as', [p0]],
      ['End', 'a lane of two points: both ends are rounded', [p0, n0]],
      ['Straight', 'joined pieces read as one strip; no rim on the seams', [...out(n2), p0, ...out(n0)]],
      ['Bend', 'a turn: the inside corner is filled in, the outside cut', [...out(n2), p0, ...out(n1)]],
      ['T', 'three ways meet', [...out(n2), p0, ...out(n0), ...out(n1)]],
      ['Cross', 'four ways meet', [p0, ...n.flatMap(out)]],
      ['Plaza', 'all four points of a cell are lanes: the whole piece is filled', plaza],
    ],
  };
}

export default {
  id: 'pieces',
  title: 'Ground and lane pieces (stream C)',
  sections: [
    {
      id: 'grids', title: 'Grid lines on each grid size, over the ground',
      async render(host, tools) {
        tools.note('Each grid size with a round patch of land: the coast follows the cells, then gets rounded. Lines show the grid sides between land points.');
        const row = tools.grid('gallery-medium');
        for (const size of ['small', 'medium', 'large']) {
          const grid = gridFor(`pieces-${size}`, size);
          const land = within(grid, middlePoint(grid), { small: 4, medium: 5, large: 6 }[size]);
          const { island } = madeIsland({ id: `pieces-${size}`, size, land });
          const img = await tools.shot(ctx => { drawIsland(ctx, island, { lines: true }); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 1.15, aim: island.order.map(p => [island.grid.points[p][0], 0, island.grid.points[p][1]]) });
          row.append(tools.card(`${size} grid`, `${grid.points.length} points · ${land.length} land · ${statsNote(img)}`, [img]));
        }
      },
    },
    {
      id: 'lanes', title: 'Lane pieces from above: lone point, end, straight, bend, T, cross and plaza',
      async render(host, tools) {
        const { p0, land, cases } = laneCases();
        tools.note('Red dots mark the lane points; lines are the grid sides. Pitch 1.2 (from high up).');
        const top = tools.grid('gallery-medium');
        for (const [title, note, points] of cases) {
          const lanes = [...new Set(points)].filter(p => land.includes(p));
          const { island } = madeIsland({ land, lanes });
          const img = await tools.shot(ctx => { drawIsland(ctx, island, { lines: true, marks: lanes }); }, { width: SMALL[0], height: SMALL[1], pitch: 1.2, aim: aimAt(island, [p0, ...lanes], 0.4) });
          top.append(tools.card(title, `${note} · ${img.stats?.triangles ?? '?'} triangles`, [img]));
        }
      },
    },
    {
      id: 'lanes-today', title: 'The same lane pieces at Today\'s angle',
      async render(host, tools) {
        const { p0, land, cases } = laneCases();
        const row = tools.grid('gallery-medium');
        for (const [title, , points] of cases) {
          const lanes = [...new Set(points)].filter(p => land.includes(p));
          const { island } = madeIsland({ land, lanes });
          row.append(tools.card(title, '', [await tools.shot(ctx => { drawIsland(ctx, island); }, { width: SMALL[0], height: SMALL[1], aim: aimAt(island, [p0, ...lanes], 0.4) })]));
        }
      },
    },
    {
      id: 'reach', title: 'Where lanes reach: under a door, under a pad front, onto a bridge deck',
      async render(host, tools) {
        const grid = gridFor('pieces', 'small');
        const p0 = middlePoint(grid);
        const land = within(grid, p0, 4);
        const n = around(grid, p0);
        // A lane through p0; a house block on one side with its door onto p0; a pad cell on the other side.
        const [a, b] = [n[0], ahead(grid, n[0], p0)];
        const lanes = line(grid, a, p0, 4).concat([ahead(grid, p0, a)]).filter(p => p !== undefined && land.includes(p));
        const side = n.filter(q => !lanes.includes(q));
        const block = side[0];
        const padCell = grid.around[side[1] ?? side[0]].find(cell => !grid.cells[cell].some(p => lanes.includes(p) || p === block)) ?? null;
        const houses = [{ id: 'house-1', look: 1, blocks: [{ point: block, floors: 1 }], door: { point: block, outside: p0 } }];
        const padPoints = padCell === null ? [] : grid.cells[padCell];
        const front = padPoints.length ? lanes.find(p => grid.neighbours[p].some(q => padPoints.includes(q))) ?? null : null;
        const things = padPoints.length && front !== null ? [{ id: 'pad-1', kind: 'workshop', points: padPoints, front, pad: true }] : [];
        const { island } = madeIsland({ land, lanes, houses, things });
        const aim = aimAt(island, [p0, block, ...padPoints], 0.45);
        const row = tools.grid('gallery-medium');
        row.append(tools.card('Door and pad front', `the lane runs a little under the door's wall and the pad's edge (house: ${houses[0].blocks[0].point}, pad front: ${front ?? 'none'})`, [await tools.shot(ctx => { drawIsland(ctx, island, { blocks: true, things: true }); }, { width: MEDIUM[0], height: MEDIUM[1], aim })]));
        row.append(tools.card('The same, ground and lanes only', 'what the lane pieces draw by themselves', [await tools.shot(ctx => { drawIsland(ctx, island, { lines: true, marks: lanes }); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 1.2, aim })]));
        const real = realIslands(tools);
        const withFoot = real?.model.islands.find(i => i.feet.length);
        if (withFoot) {
          const foot = withFoot.feet[0];
          const bridge = real.model.bridges.find(b => b.id === foot.bridge);
          const aimFoot = aimAt(withFoot, [foot.point], 1.1);
          const shotFoot = (options, withBridge) => tools.shot(ctx => {
            drawIsland(ctx, withFoot, { blocks: true, things: true });
            if (withBridge && bridge) drawBridgeHere(ctx, bridge, real.model, withFoot);
          }, { width: MEDIUM[0], height: MEDIUM[1], aim: aimFoot, ...options });
          const deck = tools.grid('gallery-medium');
          deck.append(tools.card(`Bridge foot on ${withFoot.id}`, `${real.label} · the lane runs out past the grass onto the ${foot.type} deck`, [await shotFoot({}, true)]));
          deck.append(tools.card('The same from above, no bridge', 'the deck strip by itself', [await shotFoot({ pitch: 1.2 }, false)]));
        } else tools.note('No real state with a bridge foot yet.');
      },
    },
    {
      id: 'coast', title: 'Whole islands: the coast at Today\'s size',
      async render(host, tools) {
        const real = realIslands(tools);
        if (!real) { tools.note(`No real town states: ${tools.data.town.note || 'none'}`); return; }
        tools.note(`${real.label}. Ground and lanes only (no houses or things), so the ground shows.`);
        const islands = [...real.model.islands].sort((a, b) => b.land.size - a.land.size);
        const big = islands[0];
        const wide = tools.grid('gallery-wide');
        const img = await tools.shot(ctx => { drawIsland(ctx, big); }, { width: TODAY[0], height: TODAY[1] });
        wide.append(tools.card(`${big.id} (${big.kind}) at Today's size`, `${big.land.size} land points · ${statsNote(img)}`, [img]));
        const full = await tools.shot(ctx => { drawIsland(ctx, big, { blocks: true, things: true }); }, { width: TODAY[0], height: TODAY[1] });
        wide.append(tools.card('The same with houses and things', statsNote(full), [full]));
        const row = tools.grid('gallery-medium');
        for (const island of islands.slice(1)) {
          const pic = await tools.shot(ctx => { drawIsland(ctx, island); }, { width: SMALL[0], height: SMALL[1] });
          row.append(tools.card(`${island.id} (${island.kind}, ${island.size})`, `${island.land.size} land · ${statsNote(pic)}`, [pic]));
        }
      },
    },
    {
      id: 'underside', title: 'The underside: from low down, from the east, close to the front, from below',
      async render(host, tools) {
        const real = realIslands(tools);
        if (!real) { tools.note('No real town states.'); return; }
        const big = [...real.model.islands].sort((a, b) => b.land.size - a.land.size)[0];
        tools.note(`${real.label}, ${big.id}. Each land point hangs lower the further it is from the coast (at most 5 steps); rock drips under some deep points, roots under some coast points.`);
        const under = tools.grid('gallery-medium');
        under.append(tools.card('From low down', 'pitch 0.2', [await tools.shot(ctx => { drawIsland(ctx, big); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 0.2 })]));
        under.append(tools.card('From the east', 'yaw π/2, Today\'s pitch', [await tools.shot(ctx => { drawIsland(ctx, big); }, { width: MEDIUM[0], height: MEDIUM[1], yaw: Math.PI / 2 })]));
        const front = [...big.coast].sort((a, b) => big.grid.points[b][1] - big.grid.points[a][1]).slice(0, 3);
        const aim = aimAt(big, front, 0.9);
        under.append(tools.card('Close to the front coast', 'the rim, roots and the faceted soil (pitch 0.45)', [await tools.shot(ctx => { drawIsland(ctx, big, { lines: true }); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 0.45, aim: aim.concat(aim.map(([x, , z]) => [x, -1.6, z])) })]));
        under.append(tools.card('From below', 'pitch -0.6', [await tools.shot(ctx => { drawIsland(ctx, big); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: -0.6 })]));
      },
    },
    {
      id: 'pier', title: 'A bridge foot at the end of its pier, moving out as the island grows',
      async render(host, tools) {
        const film = pierFilm(tools);
        if (!film) { tools.note('No real states with a bridge yet.'); return; }
        const { end, steps } = film;
        const last = steps.at(-1);
        const types = [...new Set(steps.map(step => step.foot.type))].join(', then ');
        tools.note(`Steady planner, ${end.island}'s end of ${end.bridge} (${types} bridge). The foot is the outermost land point of a straight strip of points along its fixed way out (its pier, town/sky.js pierOf). Land may grow onto the pier only in order, each new point becomes a lane, and the foot moves out onto it, so the bridge always leaves from the end of a straight lane. Land near the deck's line ahead of the foot waits until the foot has passed. Red dot: the foot that day; orange: where it stood before.`);
        const aim = aimAt(last.island, [...new Set(steps.map(step => step.foot.point))], 1.1)
          .concat([[...last.island.grid.points[last.foot.point]]].map(([x, z]) => [x + last.foot.out[0] * 1.2, 0, z + last.foot.out[1] * 1.2]));
        const row = tools.grid('gallery-medium');
        steps.forEach(step => { step.before = steps.filter(other => other.day < step.day && other.foot.point !== step.foot.point).map(other => other.foot.point); });
        for (const step of steps) {
          const { island, foot, model, day, before } = step;
          const bridge = model.bridges.find(b => b.id === foot.bridge);
          const img = await tools.shot(ctx => {
            drawIsland(ctx, island, { blocks: true, things: true });
            if (bridge) drawBridgeHere(ctx, bridge, model, island);
            dots(ctx, island, [...new Set(before)], '#f0a33a', 0.08);
            dots(ctx, island, [foot.point], '#e9553f', 0.08);
          }, { width: SMALL[0], height: SMALL[1], aim });
          row.append(tools.card(`day ${day}`, `foot at point ${foot.point}${before.length ? `, ${new Set(before).size} earlier` : ', the first'} · ${island.land.size} land`, [img]));
        }
        row.append(tools.card(`day ${last.day} from above`, 'ground and lanes only, with grid lines: the pier is the straight lane out to the foot', [await tools.shot(ctx => {
          drawIsland(ctx, last.island, { lines: true });
          dots(ctx, last.island, [...new Set(last.before)], '#f0a33a', 0.07);
          dots(ctx, last.island, [last.foot.point], '#e9553f', 0.07);
        }, { width: SMALL[0], height: SMALL[1], pitch: 1.2, aim })]));
      },
    },
    {
      id: 'bay', title: "A coast building's bay of kept sky",
      async render(host, tools) {
        const found = coastBay(tools);
        if (!found) { tools.note('No real state with a coast building yet.'); return; }
        const { label, island, thing, bay } = found;
        tools.note(`${label}, ${island.id}: the ${thing.kind} (a coast building). In front of its sea side, a bay of sky is kept open for good: 0.4 wider than that side at the mouth, widening at 35° on each side (BAY_ANGLE in town/pads.js) to at most 1.6 either side of its middle line. Land grows around the bay, never into it, so the building stays on the coast as the island grows. Red dots: the bay's kept points.`);
        const pts = thing.points.map(p => island.grid.points[p]);
        const [mx, mz] = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
        const near = bay.filter(p => dist(island.grid.points[p], [mx, mz]) < 2.6);
        const aim = aimAt(island, [...thing.points, ...near], 0.5);
        const row = tools.grid('gallery-medium');
        row.append(tools.card("Today's angle", 'with houses and things', [await tools.shot(ctx => { drawIsland(ctx, island, { blocks: true, things: true }); }, { width: MEDIUM[0], height: MEDIUM[1], aim })]));
        row.append(tools.card('From above', 'ground, lanes and grid lines; red dots: the bay', [await tools.shot(ctx => { drawIsland(ctx, island, { lines: true }); dots(ctx, island, near, '#e9553f', 0.06); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 1.2, aim })]));
        // Looking in from the sky the building faces: the camera sits out along its way out.
        const yaw = thing.coast?.yaw ?? thing.yaw ?? 0;
        const out = [Math.sin(yaw), Math.cos(yaw)];
        const lookIn = [0, 0.8, 1.6].flatMap(k => [[mx + out[0] * k - 0.8, 0, mz + out[1] * k - 0.8], [mx + out[0] * k + 0.8, 0.6, mz + out[1] * k + 0.8], [mx + out[0] * k, -1.4, mz + out[1] * k]]);
        row.append(tools.card('From the sky in front', 'the bay from outside: the coast and underside on both sides of it', [await tools.shot(ctx => { drawIsland(ctx, island, { blocks: true, things: true }); }, { width: MEDIUM[0], height: MEDIUM[1], pitch: 0.4, yaw, aim: lookIn })]));
      },
    },
  ],
};

// A bridge drawn in one island's own units, so it lines up with that island's ground in a shot.
function drawBridgeHere(ctx, bridge, model, island) {
  const shift = end => ({ ...end, at: [end.at[0] - island.at[0], end.at[1] - island.lift, end.at[2] - island.at[1]] });
  buildBridge(ctx, { ...bridge, from: shift(bridge.from), to: shift(bridge.to) }, model);
}
