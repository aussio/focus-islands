// Checks a world against the layout rules and returns a list of problems (empty when all is well).
// Used by the tests; the gallery can show the same list.
import { KINDS } from '../kinds.js';
import { STEP } from './grid.js';

const cellKey = (c, r) => `${c},${r}`;
const FACING_STEP = STEP; // 0 south, 1 east, 2 north, 3 west

export function checkWorld(world) {
  const problems = [];
  const land = new Map(); // "c,r" -> { island, path }
  const islandIds = new Set();

  for (const island of world.islands) {
    if (islandIds.has(island.id)) problems.push(`island ${island.id} listed twice`);
    islandIds.add(island.id);
    const width = island.rows[0]?.length ?? 0;
    island.rows.forEach((row, r) => {
      if (row.length !== width) problems.push(`island ${island.id} row ${r} has a different width`);
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        if (ch !== 'g' && ch !== 'p') problems.push(`island ${island.id} has unknown cell '${ch}'`);
        const k = cellKey(island.origin[0] + c, island.origin[1] + r);
        if (land.has(k)) problems.push(`islands ${land.get(k).island} and ${island.id} overlap at ${k}`);
        land.set(k, { island: island.id, path: ch === 'p' });
      });
    });
  }
  const at = (c, r) => land.get(cellKey(c, r));
  const isLand = (c, r, island) => { const cell = at(c, r); return Boolean(cell) && (!island || cell.island === island); };

  // Island shapes: one piece, no holes, no corner-only joins, no one-cell spits, sky between islands.
  for (const island of world.islands) {
    const cells = [...land.entries()].filter(([, v]) => v.island === island.id).map(([k]) => k.split(',').map(Number));
    if (!cells.length) { problems.push(`island ${island.id} has no land`); continue; }
    const own = (c, r) => isLand(c, r, island.id);
    const seen = new Set([cellKey(...cells[0])]);
    const queue = [cells[0]];
    while (queue.length) {
      const [c, r] = queue.pop();
      for (const [dc, dr] of STEP) {
        const k = cellKey(c + dc, r + dr);
        if (!seen.has(k) && own(c + dc, r + dr)) { seen.add(k); queue.push([c + dc, r + dr]); }
      }
    }
    if (seen.size !== cells.length) problems.push(`island ${island.id} land is in ${cells.length - seen.size} loose cells`);
    for (const [c, r] of cells) {
      if (!own(c, r - 1) && !own(c, r + 1)) problems.push(`island ${island.id} has a thin spit at ${c},${r}`);
      if (!own(c - 1, r) && !own(c + 1, r)) problems.push(`island ${island.id} has a thin spit at ${c},${r}`);
      for (const [dc, dr] of [[1, 1], [1, -1]]) {
        if (own(c + dc, r + dr) && !own(c + dc, r) && !own(c, r + dr)) problems.push(`island ${island.id} joins only at a corner at ${c},${r}`);
      }
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const other = at(c + dc, r + dr);
        if (other && other.island !== island.id) problems.push(`islands ${island.id} and ${other.island} are too close at ${c},${r}`);
      }
    }
    const width = island.rows[0].length, height = island.rows.length;
    const [oc, or] = island.origin;
    const outside = new Set();
    const flood = [[oc - 1, or - 1]];
    outside.add(cellKey(oc - 1, or - 1));
    while (flood.length) {
      const [c, r] = flood.pop();
      for (const [dc, dr] of STEP) {
        const nc = c + dc, nr = r + dr;
        if (nc < oc - 1 || nc > oc + width || nr < or - 1 || nr > or + height) continue;
        const k = cellKey(nc, nr);
        if (outside.has(k) || own(nc, nr)) continue;
        outside.add(k);
        flood.push([nc, nr]);
      }
    }
    for (let r = or; r < or + height; r++) for (let c = oc; c < oc + width; c++) {
      if (!own(c, r) && !outside.has(cellKey(c, r))) problems.push(`island ${island.id} has a hole at ${c},${r}`);
    }
  }

  // Things: known island, on its own grass (never on paths or sky), no overlaps.
  const thingAt = new Map();
  for (const thing of world.things) {
    if (!islandIds.has(thing.island)) problems.push(`${thing.id} is on unknown island ${thing.island}`);
    if (![0, 1, 2, 3].includes(thing.facing)) problems.push(`${thing.id} has facing ${thing.facing}`);
    for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) {
      const c = thing.c + a, r = thing.r + b, cell = at(c, r);
      if (!cell || cell.island !== thing.island) problems.push(`${thing.id} is off its island at ${c},${r}`);
      else if (cell.path) problems.push(`${thing.id} sits on a path at ${c},${r}`);
      const k = cellKey(c, r);
      if (thingAt.has(k)) problems.push(`${thing.id} overlaps ${thingAt.get(k).id} at ${k}`);
      thingAt.set(k, thing);
    }
    const def = KINDS[thing.kind];
    if (def) {
      const [sw, sh] = def.size;
      const [w, h] = thing.facing % 2 ? [sh, sw] : [sw, sh];
      if (thing.w !== w || thing.h !== h) problems.push(`${thing.id} is ${thing.w}x${thing.h}, expected ${w}x${h} for facing ${thing.facing}`);
    }
  }
  const ids = new Set();
  for (const thing of world.things) {
    if (ids.has(thing.id)) problems.push(`thing id ${thing.id} used twice`);
    ids.add(thing.id);
  }

  const NATURAL = new Set(['tree', 'rock', 'bush', 'flower', 'pile', 'fire', 'seat', 'mushroom', 'crystal', 'goldentree']);
  const buildings = world.things.filter(thing => !NATURAL.has(thing.kind));
  const sideCells = thing => {
    const out = [];
    const [dc, dr] = FACING_STEP[thing.facing];
    for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) {
      const c = thing.c + a + dc, r = thing.r + b + dr;
      if (c >= thing.c && c < thing.c + thing.w && r >= thing.r && r < thing.r + thing.h) continue;
      out.push([c, r]);
    }
    return out;
  };
  for (const thing of buildings) {
    const fronts = sideCells(thing).filter(([c, r]) => at(c, r)?.path);
    if (!fronts.length) problems.push(`${thing.id} (${thing.kind}) does not face a path`);
    if (KINDS[thing.kind]?.edge) {
      let coast = false;
      for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) {
        for (const [dc, dr] of STEP) if (!at(thing.c + a + dc, thing.r + b + dr)) coast = true;
      }
      if (!coast) problems.push(`${thing.id} (${thing.kind}) should touch the coast`);
    }
  }

  // Bridges: straight, between coast cells of two islands, sky in between, landing cells free.
  const bridgeCells = new Map();
  for (const bridge of world.bridges) {
    const [c0, r0] = bridge.from, [c1, r1] = bridge.to;
    if (c0 !== c1 && r0 !== r1) { problems.push(`bridge ${bridge.id} is not straight`); continue; }
    const a = at(c0, r0), b = at(c1, r1);
    if (!a || !b) { problems.push(`bridge ${bridge.id} does not start and end on land`); continue; }
    if (a.island === b.island) problems.push(`bridge ${bridge.id} joins island ${a.island} to itself`);
    if (thingAt.has(cellKey(c0, r0)) || thingAt.has(cellKey(c1, r1))) problems.push(`bridge ${bridge.id} lands on a thing`);
    const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
    let span = 0;
    for (let c = c0 + dc, r = r0 + dr; c !== c1 || r !== r1; c += dc, r += dr) {
      span++;
      if (at(c, r)) problems.push(`bridge ${bridge.id} crosses land at ${c},${r}`);
    }
    if (!span) problems.push(`bridge ${bridge.id} has no span`);
    bridgeCells.set(cellKey(c0, r0), cellKey(c1, r1));
    bridgeCells.set(cellKey(c1, r1), cellKey(c0, r0));
  }

  // Walking: from each island's pile over grass and paths (and bridges), every work spot, seat,
  // campfire and building front must be reachable.
  const blocked = new Set();
  for (const thing of world.things) {
    if (!KINDS[thing.kind]?.blocks) continue;
    for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) blocked.add(cellKey(thing.c + a, thing.r + b));
  }
  const walkable = (c, r) => Boolean(at(c, r)) && !blocked.has(cellKey(c, r));
  const reach = new Set();
  const starts = [];
  for (const pile of world.things.filter(t => t.kind === 'pile')) {
    for (const [dc, dr] of STEP) if (walkable(pile.c + dc, pile.r + dr)) starts.push([pile.c + dc, pile.r + dr]);
    if (!STEP.some(([dc, dr]) => at(pile.c + dc, pile.r + dr)?.path)) problems.push(`${pile.id} has no path beside it`);
  }
  for (const [c, r] of starts) reach.add(cellKey(c, r));
  const queue = [...starts];
  while (queue.length) {
    const [c, r] = queue.pop();
    const next = STEP.map(([dc, dr]) => [c + dc, r + dr]);
    const across = bridgeCells.get(cellKey(c, r));
    if (across) next.push(across.split(',').map(Number));
    for (const [nc, nr] of next) {
      const k = cellKey(nc, nr);
      if (reach.has(k) || !walkable(nc, nr)) continue;
      reach.add(k);
      queue.push([nc, nr]);
    }
  }
  const touchesReach = thing => {
    for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) {
      for (const [dc, dr] of STEP) if (reach.has(cellKey(thing.c + a + dc, thing.r + b + dr))) return true;
    }
    return false;
  };
  for (const thing of world.things) {
    const def = KINDS[thing.kind];
    if (thing.kind === 'seat' && !reach.has(cellKey(thing.c, thing.r))) problems.push(`${thing.id} cannot be reached`);
    if ((def?.work || thing.kind === 'fire') && !touchesReach(thing)) problems.push(`${thing.id} (${thing.kind}) cannot be reached`);
  }
  for (const thing of buildings) {
    if (!sideCells(thing).some(([c, r]) => at(c, r)?.path && reach.has(cellKey(c, r)))) problems.push(`${thing.id} (${thing.kind}) front cannot be reached`);
  }
  for (const bridge of world.bridges) {
    if (!reach.has(cellKey(...bridge.from)) || !reach.has(cellKey(...bridge.to))) problems.push(`bridge ${bridge.id} cannot be reached from a pile`);
  }

  // Paths on each island form one network that touches its pile.
  for (const island of world.islands) {
    const paths = [...land.entries()].filter(([, v]) => v.island === island.id && v.path).map(([k]) => k);
    if (!paths.length) continue;
    const pathSet = new Set(paths);
    const pile = world.things.find(t => t.island === island.id && t.kind === 'pile');
    if (!pile) { problems.push(`island ${island.id} has paths but no pile`); continue; }
    const startPaths = STEP.map(([dc, dr]) => cellKey(pile.c + dc, pile.r + dr)).filter(k => pathSet.has(k));
    const seen = new Set(startPaths);
    const todo = [...startPaths];
    while (todo.length) {
      const [c, r] = todo.pop().split(',').map(Number);
      for (const [dc, dr] of STEP) {
        const k = cellKey(c + dc, r + dr);
        if (pathSet.has(k) && !seen.has(k)) { seen.add(k); todo.push(k); }
      }
    }
    if (seen.size !== paths.length) problems.push(`island ${island.id} has ${paths.length - seen.size} path cells not joined to its pile`);
  }

  return problems;
}
