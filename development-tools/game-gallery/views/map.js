// Stream B's view: flat maps of the town layout (town/map.js townToSvg). Never ships.
//
//   #map-overview          every town state, small, side by side
//   #map-<state id>        one state's whole sky, big enough to read floors (say #map-steady-day-180)
//   #map-film              the steady planner's growth film as maps; what changed since the map before
//                          is ringed in orange, with compareTowns' answer under each map
//   #map-close             steady day 180, each island alone and close up: piers, feet, ways out, bays
//   #map-sky, #map-sky-close   a full sky made the way sky.test.js makes one (24 islands, every
//                          neighbour pair joined), and its home up close
//
// What a map shows: grid points (faint dots), land (green, coast a darker green, white grid edges),
// kept sky (blue dots: the bays in front of coast buildings), lanes (pale, the plaza ringed brown; a
// bridge's pier is the straight lane out to its foot), blocks (squares in the house's colour with
// their floors), doors (dark ticks), pads (grey, with a short name, a dashed line to the front, a black
// facing tick and a blue tick out to sea for coast buildings), things (trees, rocks...; decoration is
// smaller), golden points (gold rings), bridge feet (red, with a red line along the way out as long as
// `clear`), and decks labelled by type. Each island is labelled with its id, land and lift.
//
// The states are data.town.states: build.js lays them out with buildTown in Node, and tools.js puts the
// grids back with gridFor. The full sky is laid out here in the page.
import { data } from '../tools.js';
import { townToSvg } from '../../../electron/renderer/game/town/map.js';
import { buildTown, checkTown, compareTowns } from '../../../electron/renderer/game/town/index.js';
import { BRIDGE_TYPES } from '../../../electron/renderer/game/kinds.js';
import sky from '../../../electron/core/game/sky.js';
import rules from '../../../electron/core/game/rules.js';

const SMALL = 8, BIG = 22, CLOSE = 34, FILM = 9, SKY = 9;

const states = () => data.town.states.filter(entry => entry.world?.islands?.length);
const steady = () => states().filter(entry => entry.person === 'steady').sort((a, b) => a.day - b.day);
const labelOf = entry => `${entry.personName ?? entry.person}, day ${entry.day}`;

// An SVG map as an element a card can hold.
function mapElement(svgText) {
  const box = document.createElement('div');
  box.className = 'gallery-map';
  box.innerHTML = svgText;
  return box;
}

// Plain lines under a map: what checkTown (or compareTowns) said.
function problemList(problems, none = 'checkTown: no problems') {
  const box = document.createElement('div');
  box.style.cssText = 'font: 12px ui-sans-serif, -apple-system, sans-serif; max-width: 640px; margin-top: 4px;';
  if (!problems?.length) { box.style.color = '#2e7d32'; box.textContent = none; return box; }
  box.style.color = '#9a3b32';
  box.textContent = `${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.slice(0, 8).join(' · ')}${problems.length > 8 ? ' · …' : ''}`;
  return box;
}

const facts = world => {
  const blocks = world.islands.reduce((n, i) => n + i.houses.reduce((m, h) => m + h.blocks.length, 0), 0);
  const built = world.things.filter(t => !t.id.includes(':decor-')).length;
  const borrowed = world.islands.reduce((n, i) => n + (i.borrowed ?? 0), 0);
  return `${world.islands.length} islands · ${blocks} blocks · ${built} built things · ${world.bridges.length} bridges${borrowed ? ` · borrowed ${borrowed}` : ''}`;
};

function noStates(host, tools) {
  tools.note(data.town.note || 'No town states with islands yet.');
}

// ---------- Sections ----------

async function overview(host, tools) {
  const list = states();
  if (!list.length) return noStates(host, tools);
  tools.note('Every town state, small. Open #map-<state> for one big enough to read.');
  const row = tools.grid();
  for (const entry of list) row.append(tools.card(labelOf(entry), `${entry.problems?.length ? `${entry.problems.length} problems` : 'checks pass'}`, [mapElement(townToSvg(entry.world, { scale: SMALL }))]));
}

function oneState(entry) {
  return async (host, tools) => {
    tools.note(`${entry.summary ?? ''}`);
    const row = tools.grid();
    row.append(tools.card(labelOf(entry), facts(entry.world), [mapElement(townToSvg(entry.world, { scale: BIG })), problemList(entry.problems)]));
  };
}

// The growth film: each map rings what changed since the one before, and says what compareTowns found.
async function film(host, tools) {
  const list = steady();
  if (!list.length) return noStates(host, tools);
  tools.note('The steady planner, day by day. Orange rings: new land, lanes, blocks, floors and built things since the map before (a new island is all new). Under each map: what compareTowns found between the two.');
  const row = tools.grid();
  list.forEach((entry, i) => {
    const before = list[i - 1]?.world;
    const mark = {};
    let words = 'the first map';
    if (before) {
      for (const island of entry.world.islands) {
        const old = before.islands.find(o => o.id === island.id);
        mark[island.id] = newPoints(before, entry.world, old, island);
      }
      words = growthWords(before, entry.world);
    }
    const problems = before ? compareTowns(before, entry.world) : [];
    row.append(tools.card(labelOf(entry), words, [mapElement(townToSvg(entry.world, { scale: FILM, mark })),
      before ? problemList(problems, `compareTowns with day ${list[i - 1].day}: no problems`) : problemList(entry.problems)]));
  });
}

// Points that are new on one island since the world before: land, lanes, blocks or floors, and built
// things (not decoration). A new island is all new.
function newPoints(before, after, old, island) {
  if (!old) return island.land;
  const marks = new Set(island.land.slice(old.land.length));
  const oldLanes = new Set(old.lanes);
  for (const p of island.lanes) if (!oldLanes.has(p)) marks.add(p);
  const floors = new Map(old.houses.flatMap(h => h.blocks.map(b => [b.point, b.floors])));
  for (const h of island.houses) for (const b of h.blocks) if (floors.get(b.point) !== b.floors) marks.add(b.point);
  const built = new Set(before.things.map(t => t.id));
  for (const t of after.things) if (t.island === island.id && !built.has(t.id) && !t.id.includes(':decor-')) t.points.forEach(p => marks.add(p));
  return [...marks];
}

function growthWords(before, after) {
  const land = after.islands.reduce((n, i) => n + i.land.length, 0) - before.islands.reduce((n, i) => n + i.land.length, 0);
  const built = world => world.things.filter(t => !t.id.includes(':decor-')).length + world.islands.reduce((n, i) => n + i.houses.reduce((m, h) => m + h.blocks.length, 0), 0);
  const parts = [`+${land} land`, `+${built(after) - built(before)} blocks and built things`];
  const islands = after.islands.length - before.islands.length;
  if (islands) parts.push(`+${islands} island${islands === 1 ? '' : 's'}`);
  const bridges = after.bridges.length - before.bridges.length;
  if (bridges) parts.push(`+${bridges} bridge${bridges === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function closeUp(worldOf, label) {
  return async (host, tools) => {
    const found = worldOf();
    if (!found) return noStates(host, tools);
    tools.note(`${label}: each island alone. Red: bridge feet, each at the end of its pier (a straight lane out), with a line along the way out as long as its clear stretch. Blue dots: kept sky, the bays in front of coast buildings, where land never grows.`);
    const row = tools.grid();
    for (const island of found.islands) {
      row.append(tools.card(island.id, `${island.kind} · ${island.size} · land ${island.land.length} · lift ${island.lift} · ${island.houses.length} houses${island.borrowed ? ` · borrowed ${island.borrowed}` : ''}`,
        [mapElement(townToSvg(found, { island: island.id, scale: CLOSE }))]));
    }
  };
}
const steadyLast = () => steady().at(-1)?.world ?? null;

// ---------- A full sky, made as sky.test.js makes one ----------
function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The same game as sky.test.js's skyGame(set): three full rings at random sizes, kinds, lifts and land,
// and every neighbour pair joined in a random order.
function skyGame(set) {
  const random = randomFrom(1000 + set);
  const pick = list => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const R = rules.DEFAULT_RULES;
  const islands = [{ id: 'home', kind: 'home', size: 'medium', ring: 0, angle: null, lift: 0, land: between(R.startingLand, R.maxLand.home), buildings: [] }];
  const used = new Set(['home']);
  for (let n = 1; n <= 3 * sky.PER_RING; n++) {
    let id;
    do id = `isle-${between(1, 120)}`; while (used.has(id));
    used.add(id);
    const size = pick(['small', 'medium', 'large']);
    const { ring, angle } = sky.placeOf(n);
    islands.push({ id, kind: pick(rules.NEW_ISLAND_KINDS), size, ring, angle, lift: Math.round((between(0, 20) * 0.05 - 0.5) * 100) / 100 || 0,
      land: between(R.startLand[size], R.maxLand[size]), buildings: [] });
  }
  const pairs = sky.neighbourPairs(islands);
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  const start = island => (island.id === 'home' ? R.startingLand : R.startLand[island.size]);
  const landAt = new Map(islands.map(island => {
    const count = pairs.filter(p => p.from === island.id || p.to === island.id).length;
    return [island.id, Array.from({ length: count }, () => between(start(island), island.land)).sort((a, b) => a - b)];
  }));
  const lift = id => islands.find(i => i.id === id).lift;
  const links = pairs.map((pair, k) => {
    const types = lift(pair.from) === lift(pair.to) ? BRIDGE_TYPES.filter(t => t !== 'slide') : BRIDGE_TYPES;
    return { id: `link-${k}`, from: pair.from, to: pair.to, type: pick(types), checkIn: k + 1,
      land: { [pair.from]: landAt.get(pair.from).shift(), [pair.to]: landAt.get(pair.to).shift() } };
  });
  return { islands, links, helpers: [] };
}
const SKY_SET = 7; // the set that once crossed two decks and ran one over land, before islands spread apart
let fullSky = null;
const skyWorld = () => (fullSky ??= buildTown(skyGame(SKY_SET)));

async function skySection(host, tools) {
  const started = performance.now();
  const world = skyWorld();
  const ms = Math.round(performance.now() - started);
  tools.note(`sky.test.js's set ${SKY_SET}: home and three full rings of ${sky.PER_RING}, every neighbour pair joined (${world.bridges.length} bridges). Laid out in the page in ${ms} ms, grids included.`);
  const row = tools.grid();
  row.append(tools.card(`full sky, set ${SKY_SET}`, facts(world), [mapElement(townToSvg(world, { scale: SKY })), problemList(checkTown(world))]));
}

async function skyClose(host, tools) {
  const world = skyWorld();
  const busiest = [...world.islands].sort((a, b) => feetOn(world, b.id) - feetOn(world, a.id)).slice(0, 4);
  tools.note(`The four islands with the most bridge feet in sky.test.js's set ${SKY_SET}, alone and close up.`);
  const row = tools.grid();
  for (const island of busiest) {
    row.append(tools.card(island.id, `${island.kind} · ${island.size} · land ${island.land.length} · lift ${island.lift} · ${feetOn(world, island.id)} feet`,
      [mapElement(townToSvg(world, { island: island.id, scale: CLOSE * 0.8 }))]));
  }
}
const feetOn = (world, id) => world.bridges.filter(b => b.from.island === id || b.to.island === id).length;

// ---------- The view ----------
const stateSections = data.town.states.filter(entry => entry.world?.islands?.length && /^[\w-]{1,60}$/.test(entry.id))
  .map(entry => ({ id: entry.id, title: labelOf(entry), render: oneState(entry) }));

export default {
  id: 'map',
  title: 'Town maps (stream B: layout)',
  sections: [
    { id: 'overview', title: 'Every state, small', render: overview },
    ...stateSections,
    { id: 'film', title: 'The growth film as maps', render: film },
    { id: 'close', title: 'Steady day 180, island by island', render: closeUp(steadyLast, 'Steady planner, day 180') },
    { id: 'sky', title: 'A full sky', render: skySection },
    { id: 'sky-close', title: 'A full sky: the busiest islands close up', render: skyClose },
  ],
};
