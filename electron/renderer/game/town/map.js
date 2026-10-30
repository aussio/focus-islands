// A flat map of a town world for reviews (the gallery's map view and the layout's own debugging).
// Plain code: returns SVG text, with no DOM, so it also runs in Node.
//
//   townToSvg(world, { island, scale, mark }) => '<svg ...>'
//     island: draw only this island (zoomed in), else every island where it floats
//     scale: pixels per world unit (default 40 for one island, 12 for the whole sky)
//     mark: { [islandId]: [points] } points to ring in orange (say, what changed since the day before)
//
// Shows grid points, land, kept sky, lanes, blocks with their floors, pads with their fronts, things,
// bridge feet with their ways out, decks labelled with their type, and each island's land and lift.
import { deckLine } from './sky.js';

const COLOURS = {
  sky: '#eaf3fb', point: '#c6d6e4', land: '#9fd18b', coast: '#86c172', kept: '#7fb6e6', lane: '#f4e7c3', laneEdge: '#d8c69a',
  pad: '#b9b2a6', padEdge: '#8d857a', front: '#7a5c3a', foot: '#d9534f', deck: '#a0522d', text: '#33414e', golden: '#e8b400',
};
const LOOKS = ['#ffd25e', '#7cc8ff', '#ff9a85', '#fff3e2', '#b9a8f5', '#8fe0b0'];
const THING_COLOURS = {
  tree: '#2f7d32', rock: '#8a8f96', bush: '#4caf50', flower: '#ec6fa5', pile: '#a1887f', fire: '#ff7043', seat: '#8d6e63',
  mushroom: '#d84315', crystal: '#7e57c2', goldentree: '#e8b400', flowers: '#f48fb1', lanterns: '#ffb300',
};
const SHORT = {
  garden: 'Ga', nursery: 'Nu', sawmill: 'Sa', workshop: 'Wo', windmill: 'Wi', orchard: 'Or', tower: 'To', pond: 'Po', greattree: 'GT',
  grotto: 'Gr', quarry: 'Qu', beehives: 'Be', forge: 'Fo', loom: 'Lo', lighthouse: 'Li', airship: 'Ai', observatory: 'Ob', skyfall: 'Sf', aurora: 'Au',
};
const BRIDGE_COLOURS = { rope: '#8d6e63', arch: '#78909c', slide: '#29b6f6', cloudsteps: '#b0bec5', flowerarch: '#ec407a', rainbow: '#ab47bc' };

const f = v => (Math.round(v * 100) / 100).toString();
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function townToSvg(world, options = {}) {
  const only = options.island ? world.islands.filter(i => i.id === options.island) : world.islands;
  if (!only.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="8" y="24">No islands</text></svg>';
  const scale = options.scale ?? (options.island ? 40 : 12);
  // In the one-island view the island sits at its grid's middle; otherwise where it floats.
  const offset = island => (options.island ? [0, 0] : island.at);
  // Bounds: each drawn island's reach, plus room for its kept sky and label.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const labelOf = island => `${island.id}: land ${island.land.length}, lift ${island.lift}${island.borrowed ? `, borrowed ${island.borrowed}` : ''}`;
  const labelSize = options.island ? 14 : 11;
  for (const island of only) {
    const [ox, oz] = offset(island);
    const around = island.reach + 2.5;
    // The label is centred above the island; about 0.55 of its font size per letter.
    const wide = Math.max(around, (labelOf(island).length * labelSize * 0.55) / 2 / scale);
    minX = Math.min(minX, ox - wide); maxX = Math.max(maxX, ox + wide); minZ = Math.min(minZ, oz - around); maxZ = Math.max(maxZ, oz + around);
  }
  const pad = 1;
  const width = Math.ceil((maxX - minX + 2 * pad) * scale), height = Math.ceil((maxZ - minZ + 2 * pad) * scale);
  const X = x => (x - minX + pad) * scale, Z = z => (z - minZ + pad) * scale;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`);
  out.push(`<rect width="${width}" height="${height}" fill="${COLOURS.sky}"/>`);
  const r = scale * 0.3;

  for (const island of only) {
    const [ox, oz] = offset(island);
    const { grid } = island;
    const P = p => [X(grid.points[p][0] + ox), Z(grid.points[p][1] + oz)];
    const land = new Set(island.land), lanes = new Set(island.lanes);
    const blocks = new Map(island.houses.flatMap(h => h.blocks.map(b => [b.point, { house: h, floors: b.floors }])));
    // Grid points, faint (only near the island in the whole-sky view).
    const near = island.reach + 2.5;
    out.push('<g>');
    grid.points.forEach(([x, z], p) => {
      if (Math.hypot(x, z) > near) return;
      out.push(`<circle cx="${f(X(x + ox))}" cy="${f(Z(z + oz))}" r="${f(scale * 0.05)}" fill="${COLOURS.point}"/>`);
    });
    out.push('</g>');
    // Land: cells with every corner on land are filled; each land point also gets a soft round patch.
    out.push('<g>');
    grid.cells.forEach(cell => {
      if (!cell.every(p => land.has(p))) return;
      out.push(`<polygon points="${cell.map(p => P(p).map(f).join(',')).join(' ')}" fill="${COLOURS.land}"/>`);
    });
    for (const p of island.land) {
      const coast = grid.neighbours[p].some(n => !land.has(n));
      out.push(`<circle cx="${f(P(p)[0])}" cy="${f(P(p)[1])}" r="${f(r)}" fill="${coast ? COLOURS.coast : COLOURS.land}"/>`);
    }
    // The grid's edges between land points, so the cells can be counted.
    out.push(`<g stroke="#ffffff" stroke-opacity="0.55" stroke-width="1">`);
    for (const p of island.land) for (const n of grid.neighbours[p]) if (n > p && land.has(n)) out.push(`<line x1="${f(P(p)[0])}" y1="${f(P(p)[1])}" x2="${f(P(n)[0])}" y2="${f(P(n)[1])}"/>`);
    out.push('</g>');
    out.push('</g>');
    // Kept sky.
    for (const p of island.kept) if (Math.hypot(...grid.points[p]) <= near) out.push(`<circle cx="${f(P(p)[0])}" cy="${f(P(p)[1])}" r="${f(scale * 0.16)}" fill="${COLOURS.kept}"/>`);
    // Lanes: a thick line between neighbouring lane points, and a patch on each.
    out.push(`<g stroke="${COLOURS.lane}" stroke-width="${f(scale * 0.3)}" stroke-linecap="round">`);
    for (const p of island.lanes) for (const n of grid.neighbours[p]) if (n > p && lanes.has(n)) out.push(`<line x1="${f(P(p)[0])}" y1="${f(P(p)[1])}" x2="${f(P(n)[0])}" y2="${f(P(n)[1])}"/>`);
    out.push('</g>');
    for (const p of island.lanes) out.push(`<circle cx="${f(P(p)[0])}" cy="${f(P(p)[1])}" r="${f(scale * 0.17)}" fill="${COLOURS.lane}" stroke="${COLOURS.laneEdge}" stroke-width="0.6"/>`);
    // Blocks: a square in the house's colour, its floors written on it, and the door as a dark tick.
    for (const [p, { house, floors }] of blocks) {
      const [x, z] = P(p), s = scale * 0.52;
      out.push(`<rect x="${f(x - s / 2)}" y="${f(z - s / 2)}" width="${f(s)}" height="${f(s)}" rx="${f(s * 0.12)}" fill="${LOOKS[house.look] ?? '#ddd'}" stroke="#5d4037" stroke-width="1"/>`);
      out.push(`<text x="${f(x)}" y="${f(z + scale * 0.12)}" font-size="${f(scale * 0.34)}" text-anchor="middle" fill="#3e2723">${floors}</text>`);
    }
    for (const house of island.houses) {
      if (!house.door) continue;
      const [ax, az] = P(house.door.point), [bx, bz] = P(house.door.outside);
      out.push(`<line x1="${f(ax + (bx - ax) * 0.3)}" y1="${f(az + (bz - az) * 0.3)}" x2="${f(ax + (bx - ax) * 0.55)}" y2="${f(az + (bz - az) * 0.55)}" stroke="#3e2723" stroke-width="${f(scale * 0.12)}"/>`);
    }
    // Plaza (the first lane point).
    if (island.lanes.length) {
      const [x, z] = P(island.lanes[0]);
      out.push(`<circle cx="${f(x)}" cy="${f(z)}" r="${f(scale * 0.24)}" fill="none" stroke="#6d4c41" stroke-width="1.5"/>`);
    }
  }

  // Things.
  const islandsById = new Map(only.map(i => [i.id, i]));
  for (const thing of world.things) {
    const island = islandsById.get(thing.island);
    if (!island) continue;
    const [ox, oz] = offset(island);
    const { grid } = island;
    const P = p => [X(grid.points[p][0] + ox), Z(grid.points[p][1] + oz)];
    const [cx, cz] = [X(thing.at[0] + ox), Z(thing.at[1] + oz)];
    if (thing.pad) {
      // The pad: its cells' outline, the kind's short name, and a line to its front.
      const pts = thing.points.map(P);
      const hull = convexHull(pts);
      out.push(`<polygon points="${hull.map(p => p.map(f).join(',')).join(' ')}" fill="${COLOURS.pad}" stroke="${COLOURS.padEdge}" stroke-width="1" fill-opacity="0.9"/>`);
      if (thing.front !== null) {
        const [fx, fz] = P(thing.front);
        out.push(`<line x1="${f(cx)}" y1="${f(cz)}" x2="${f(fx)}" y2="${f(fz)}" stroke="${COLOURS.front}" stroke-width="1.5" stroke-dasharray="3,2"/>`);
      }
      const facing = [Math.sin(thing.yaw), Math.cos(thing.yaw)];
      out.push(`<line x1="${f(cx)}" y1="${f(cz)}" x2="${f(cx + facing[0] * scale * 0.45)}" y2="${f(cz + facing[1] * scale * 0.45)}" stroke="#263238" stroke-width="2"/>`);
      if (thing.coast) {
        const way = [Math.sin(thing.coast.yaw), Math.cos(thing.coast.yaw)];
        out.push(`<line x1="${f(cx)}" y1="${f(cz)}" x2="${f(cx + way[0] * scale * 1.2)}" y2="${f(cz + way[1] * scale * 1.2)}" stroke="#0277bd" stroke-width="2"/>`);
      }
      out.push(`<text x="${f(cx)}" y="${f(cz + scale * 0.14)}" font-size="${f(scale * 0.4)}" text-anchor="middle" fill="#212121" font-weight="bold">${esc(SHORT[thing.kind] ?? thing.kind.slice(0, 2))}</text>`);
      continue;
    }
    const colour = THING_COLOURS[thing.kind] ?? '#555';
    const decor = thing.id.includes(':decor-');
    if (thing.points.length === 2) {
      const [a, b] = thing.points.map(P);
      out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${colour}" stroke-width="${f(scale * 0.3)}" stroke-linecap="round"/>`);
      continue;
    }
    const size = (decor ? 0.14 : 0.22) * scale * (thing.kind === 'tree' ? 1.4 : 1);
    if (thing.kind === 'rock' || thing.kind === 'crystal') out.push(`<rect x="${f(cx - size)}" y="${f(cz - size)}" width="${f(size * 2)}" height="${f(size * 2)}" fill="${colour}" stroke="#263238" stroke-width="${decor ? 0.4 : 1}"/>`);
    else out.push(`<circle cx="${f(cx)}" cy="${f(cz)}" r="${f(size)}" fill="${colour}" stroke="#263238" stroke-width="${decor ? 0.4 : 1}"/>`);
  }
  // Golden points: a gold ring even before the island turns golden (the tree shows once it does).
  for (const thing of world.things.filter(t => t.kind === 'goldentree' && islandsById.has(t.island))) {
    const island = islandsById.get(thing.island);
    const [ox, oz] = offset(island);
    out.push(`<circle cx="${f(X(thing.at[0] + ox))}" cy="${f(Z(thing.at[1] + oz))}" r="${f(scale * 0.3)}" fill="none" stroke="${COLOURS.golden}" stroke-width="2"/>`);
  }

  // Bridges: decks (whole-sky view only) and feet with their ways out.
  for (const bridge of world.bridges) {
    const ends = [bridge.from, bridge.to].filter(end => islandsById.has(end.island));
    if (!options.island && ends.length === 2) {
      const line = deckLine(world, bridge);
      out.push(`<polyline points="${line.map(([x, z]) => `${f(X(x))},${f(Z(z))}`).join(' ')}" fill="none" stroke="${BRIDGE_COLOURS[bridge.type] ?? COLOURS.deck}" stroke-width="${f(scale * 0.35)}" stroke-linecap="round" opacity="0.85"/>`);
      const mid = line[Math.floor(line.length / 2)];
      out.push(`<text x="${f(X(mid[0]))}" y="${f(Z(mid[1]) - scale * 0.5)}" font-size="11" text-anchor="middle" fill="${COLOURS.text}">${esc(bridge.type)}</text>`);
    }
    for (const end of ends) {
      const island = islandsById.get(end.island);
      const [ox, oz] = offset(island);
      const [x, z] = island.grid.points[end.point];
      const [px, pz] = [X(x + ox), Z(z + oz)];
      out.push(`<line x1="${f(px)}" y1="${f(pz)}" x2="${f(px + end.out[0] * end.clear * scale)}" y2="${f(pz + end.out[1] * end.clear * scale)}" stroke="${COLOURS.foot}" stroke-width="2"/>`);
      out.push(`<circle cx="${f(px)}" cy="${f(pz)}" r="${f(scale * 0.2)}" fill="${COLOURS.foot}"/>`);
      if (options.island) out.push(`<text x="${f(px + end.out[0] * scale)}" y="${f(pz + end.out[1] * scale)}" font-size="10" fill="${COLOURS.foot}">${esc(bridge.type)}</text>`);
    }
  }

  // Marked points: an orange ring.
  for (const island of only) {
    const [ox, oz] = offset(island);
    for (const p of options.mark?.[island.id] ?? []) {
      const [x, z] = island.grid.points[p];
      out.push(`<circle cx="${f(X(x + ox))}" cy="${f(Z(z + oz))}" r="${f(scale * 0.32)}" fill="none" stroke="#ff6d00" stroke-width="1.2"/>`);
    }
  }

  // Labels: each island's id, land and lift.
  for (const island of only) {
    const [ox, oz] = offset(island);
    out.push(`<text x="${f(X(ox))}" y="${f(Z(oz - island.reach - 0.9))}" font-size="${labelSize}" text-anchor="middle" fill="${COLOURS.text}" font-weight="bold">${esc(labelOf(island))}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

function convexHull(points) {
  const pts = points.map(p => [...p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
