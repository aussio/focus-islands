// Draws a world as an ASCII map, for tests and reviews. One character per cell:
//   ' ' sky   '.' grass   'o' path   '=' or '|' bridge
//   T tree  R rock  b bush  * flower  P pile  F fire  s seat  m mushroom  c crystal  $ golden sapling
//   buildings use one capital letter per kind (see BUILDING_LETTERS); unknown kinds show '?'.
import { KINDS } from '../kinds.js';

export const THING_LETTERS = {
  tree: 'T', rock: 'R', bush: 'b', flower: '*', pile: 'P', fire: 'F', seat: 's', mushroom: 'm', crystal: 'c',
  goldentree: '$',
};

export const BUILDING_LETTERS = {
  cottage: 'H', garden: 'G', nursery: 'N', sawmill: 'W', workshop: 'K', windmill: 'M', orchard: 'O',
  lanterns: 'L', tower: 'Y', pond: 'D', greattree: 'E', grotto: 'U', quarry: 'Q', beehives: 'Z',
  forge: 'X', loom: 'V', lighthouse: 'I', airship: 'A', observatory: 'J', skyfall: 'S', aurora: 'B',
  flowers: 'C',
};

const FACING_NAMES = ['south', 'east', 'north', 'west'];

const letterFor = kind => THING_LETTERS[kind] ?? BUILDING_LETTERS[kind] ?? '?';

export function worldToText(world, { legend = false } = {}) {
  let maxC = 0, maxR = 0;
  for (const island of world.islands) {
    maxC = Math.max(maxC, island.origin[0] + (island.rows[0]?.length ?? 0) - 1);
    maxR = Math.max(maxR, island.origin[1] + island.rows.length - 1);
  }
  const grid = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(' '));
  const set = (c, r, ch) => { if (r >= 0 && c >= 0 && grid[r] && c <= maxC) grid[r][c] = ch; };
  for (const island of world.islands) {
    const [oc, or] = island.origin;
    island.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === 'g') set(oc + c, or + r, '.');
      else if (ch === 'p') set(oc + c, or + r, 'o');
    }));
  }
  for (const bridge of world.bridges) {
    const [c0, r0] = bridge.from, [c1, r1] = bridge.to;
    const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
    for (let c = c0 + dc, r = r0 + dr; c !== c1 || r !== r1; c += dc, r += dr) set(c, r, dc ? '=' : '|');
  }
  for (const thing of world.things) {
    const ch = letterFor(thing.kind);
    for (let a = 0; a < thing.w; a++) for (let b = 0; b < thing.h; b++) set(thing.c + a, thing.r + b, ch);
  }
  const lines = grid.map(row => row.join('').replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!legend) return lines.join('\n');
  const notes = world.things
    .filter(thing => !THING_LETTERS[thing.kind])
    .map(thing => `${letterFor(thing.kind)} ${thing.kind} ${thing.id} at ${thing.c},${thing.r} ${thing.w}x${thing.h} faces ${FACING_NAMES[thing.facing] ?? thing.facing}${KINDS[thing.kind]?.edge ? ' (edge)' : ''}`);
  return [...lines, '', ...notes].join('\n');
}
