// Hand-made worlds for the scene test and the development gallery. Nothing in the app imports this.
import { KINDS } from '../kinds.js';

// Writes rows from a list of strings, then lets a caller paint paths on top.
function grid(rows) {
  const cells = rows.map(row => [...row]);
  return {
    path(list) { for (const [c, r] of list) if (cells[r]?.[c] && cells[r][c] !== '.') cells[r][c] = 'p'; return this; },
    rows() { return cells.map(row => row.join('')); },
  };
}
const line = (c0, r0, c1, r1) => {
  const out = [];
  const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
  for (let c = c0, r = r0; ; c += dc, r += dr) { out.push([c, r]); if (c === c1 && r === r1) break; }
  return out;
};
const thing = (id, kind, c, r, extra = {}) => {
  const [w, h] = KINDS[kind]?.size ?? [1, 1];
  const facing = extra.facing ?? 0;
  return { id, kind, island: extra.island ?? 'home', c, r, w: facing % 2 ? h : w, h: facing % 2 ? w : h, facing };
};

const tiny = {
  islands: [{ id: 'home', kind: 'home', origin: [0, 0], rows: [
    '...gggg...',
    '..gggggg..',
    '.gggggggg.',
    'gggggggggg',
    'gggggggggg',
    '.gggggggg.',
    '..gggggg..',
    '...gggg...',
  ] }],
  things: [
    thing('tree-1', 'tree', 2, 2), thing('rock-1', 'rock', 7, 3), thing('pile-1', 'pile', 4, 4),
    thing('fire-1', 'fire', 6, 5), thing('seat-1', 'seat', 5, 5), thing('seat-2', 'seat', 7, 5),
  ],
  bridges: [],
  helpers: [{ id: 'h1', name: 'Pip', job: 'wood', island: 'home' }],
};

const grownGrid = grid([
  '......gggggggg......',
  '...gggggggggggggg...',
  '..gggggggggggggggg..',
  '.gggggggggggggggggg.',
  '.gggggggggggggggggg.',
  'gggggggggggggggggggg',
  'gggggggggggggggggggg',
  'gggggggggggggggggggg',
  'gggggggggggggggggggg',
  '.gggggggggggggggggg.',
  '.gggggggggggggggggg.',
  '..gggggggggggggggg..',
  '...gggggggggggggg...',
  '.....gggggggggg.....',
  '.......gggggg.......',
]).path([...line(3, 7, 16, 7), ...line(10, 3, 10, 12), ...line(8, 5, 9, 5), ...line(12, 5, 13, 5)]);
const grown = {
  islands: [{ id: 'home', kind: 'home', origin: [0, 0], rows: grownGrid.rows() }],
  things: [
    thing('cottage-1', 'cottage', 8, 3), thing('cottage-2', 'cottage', 12, 3),
    thing('garden-1', 'garden', 12, 9), thing('sawmill-1', 'sawmill', 5, 9), thing('nursery-1', 'nursery', 15, 5),
    thing('pile-1', 'pile', 9, 8), thing('fire-1', 'fire', 5, 5), thing('seat-1', 'seat', 4, 5), thing('seat-2', 'seat', 6, 5),
    thing('seat-3', 'seat', 5, 4),
    thing('tree-1', 'tree', 3, 2), thing('tree-2', 'tree', 1, 5), thing('tree-3', 'tree', 2, 9), thing('tree-4', 'tree', 16, 2),
    thing('tree-5', 'tree', 17, 9), thing('tree-6', 'tree', 14, 12), thing('tree-7', 'tree', 4, 11), thing('tree-8', 'tree', 6, 2),
    thing('rock-1', 'rock', 17, 7), thing('rock-2', 'rock', 15, 11), thing('rock-3', 'rock', 15, 2),
    thing('bush-1', 'bush', 7, 12), thing('bush-2', 'bush', 11, 13), thing('bush-3', 'bush', 1, 7),
    thing('flower-1', 'flower', 7, 1), thing('flower-2', 'flower', 13, 1), thing('flower-3', 'flower', 11, 5), thing('flower-4', 'flower', 8, 11),
    thing('mushroom-1', 'mushroom', 3, 10), thing('crystal-1', 'crystal', 12, 12), thing('lanterns-1', 'lanterns', 11, 8),
  ],
  bridges: [],
  helpers: [
    { id: 'h1', name: 'Pip', job: 'wood', island: 'home' },
    { id: 'h2', name: 'Moss', job: 'stone', island: 'home' },
    { id: 'h3', name: 'Fern', job: 'planks', island: 'home' },
    { id: 'h4', name: 'Bramble', job: 'soil', island: 'home' },
    { id: 'h5', name: 'Wren', job: 'saplings', island: 'home' },
    { id: 'h6', name: 'Juniper', job: 'wood', island: 'home' },
    { id: 'h7', name: 'Clover', job: null, island: 'home' },
  ],
};

const twoGrid = grid([
  '...gggggg..',
  '..gggggggg.',
  '.gggggggggg',
  '.gggggggggg',
  'ggggggggggg',
  'ggggggggggg',
  '.gggggggggg',
  '..gggggggg.',
  '...gggggg..',
]).path([[6, 3], ...line(6, 4, 10, 4)]);
const two = {
  islands: [
    { id: 'home', kind: 'home', origin: [0, 0], rows: twoGrid.rows() },
    { id: 'isle', kind: 'rocky', origin: [14, 2], rows: ['.gggg.', 'gggggg', 'pggggg', '.gggg.', '..gg..'] },
  ],
  things: [
    thing('cottage-1', 'cottage', 5, 1), thing('tree-1', 'tree', 2, 2), thing('tree-2', 'tree', 8, 7), thing('pile-1', 'pile', 4, 5),
    thing('fire-1', 'fire', 3, 7), thing('seat-1', 'seat', 2, 6), thing('seat-2', 'seat', 4, 7), thing('flower-1', 'flower', 8, 2),
    thing('rock-1', 'rock', 17, 4, { island: 'isle' }), thing('tree-3', 'tree', 15, 3, { island: 'isle' }), thing('crystal-1', 'crystal', 18, 3, { island: 'isle' }),
  ],
  bridges: [{ id: 'bridge-1', from: [10, 4], to: [14, 4] }],
  helpers: [
    { id: 'h1', name: 'Pip', job: 'wood', island: 'home' },
    { id: 'h2', name: 'Moss', job: 'stone', island: 'isle' },
    { id: 'h3', name: 'Fern', job: null, island: 'home' },
  ],
};

export const SAMPLE_WORLDS = {
  tiny: { name: 'Tiny home island', world: tiny },
  grown: { name: 'Grown home island', world: grown },
  two: { name: 'Two islands and a bridge', world: two },
};

// A small island just big enough to show one kind, with the kind in the middle.
export function kindWorld(kind) {
  const [w, h] = KINDS[kind]?.size ?? [1, 1];
  const W = w + 4, H = h + 4;
  const corner = (c, r) => (r === 0 || r === H - 1) && (c === 0 || c === W - 1);
  const rows = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (corner(c, r) ? '.' : 'g')).join(''));
  const world = { islands: [{ id: 'home', kind: 'home', origin: [0, 0], rows }], things: [thing(`${kind}-1`, kind, 2, 2)], bridges: [], helpers: [] };
  // Frame the thing itself, with a little ground around it.
  world.debugView = { at: [2 + (w - 1) / 2, 2 + (h - 1) / 2], radius: Math.max(w, h) / 2 + 0.6 };
  return world;
}

// One helper in a fixed pose on a small island, with the thing they work at (if any) just behind them.
export function poseWorld({ anim, tool, carry, job = null, prop, propFacing = 0, seat, at = [2, 2], yaw = 0.5, local }) {
  const rows = ['.ggg.', 'ggggg', 'ggggg', 'ggggg', '.ggg.'];
  const [w] = KINDS[prop]?.size ?? [1, 1];
  // Seats and fires sit under or beside the helper; work things stand just behind them.
  const spot = prop === 'seat' ? [2, 2] : prop === 'fire' ? [2, 1] : [w > 1 ? 1 : 2, w > 1 ? 0 : 1];
  const things = prop ? [thing(`${prop}-1`, prop, spot[0], spot[1], { facing: propFacing })] : [];
  const face = prop && prop !== 'seat' ? [spot[0] + (w - 1) / 2, spot[1] + (w - 1) / 2] : undefined;
  const pose = { anim, tool, carry, at, face, yaw: face ? undefined : yaw, seat, local: local ?? (anim === 'walk' ? 0.12 : 0.45) };
  // Frame a close-up of the helper (and the thing they use), not the whole island.
  const centre = face ? [(at[0] + face[0]) / 2, (at[1] + face[1]) / 2] : at;
  const radius = face ? Math.max(1.1, Math.hypot(at[0] - face[0], at[1] - face[1]) / 2 + (w > 1 ? 1.1 : 0.7)) : 0.9;
  return { islands: [{ id: 'home', kind: 'home', origin: [0, 0], rows }], things, bridges: [], helpers: [{ id: 'h1', name: 'Pip', job, island: 'home', debugPose: pose }], debugView: { at: centre, radius } };
}

// Every kind in kinds.js on one big island, so a test can check that any world draws.
export function everyKindWorld() {
  const kinds = Object.keys(KINDS);
  const things = [];
  let c = 1, r = 1, rowHeight = 0;
  const width = 22;
  for (const kind of kinds) {
    const [w, h] = KINDS[kind].size;
    if (c + w > width - 1) { c = 1; r += rowHeight + 1; rowHeight = 0; }
    things.push(thing(`${kind}-1`, kind, c, r));
    c += w + 1;
    rowHeight = Math.max(rowHeight, h);
  }
  const height = r + rowHeight + 2;
  const rows = Array.from({ length: height }, () => 'g'.repeat(width));
  const helpers = ['wood', 'stone', 'planks', 'soil', 'saplings', null].map((job, i) => ({ id: `h${i}`, name: `H${i}`, job, island: 'home' }));
  return { islands: [{ id: 'home', kind: 'meadow', origin: [0, 0], rows }], things, bridges: [], helpers };
}
