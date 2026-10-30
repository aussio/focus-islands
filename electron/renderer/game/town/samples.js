// Three small sample towns in the world shape (shape.js), made by replaying scripted steps like the
// grid prototype's growth film (wonky/film.js). The scene streams draw these before the real layout
// exists, and the gallery can play them as a film. The rules here are a short cut of the plan's layout
// rules, steered by hints in the scripts; the real layout lives in town/index.js. Plain code: no DOM,
// no Three.js. Nothing in the app imports this.
//
//   SAMPLE_NAMES                 firstDay, village, manyIslands
//   sampleTown(name, steps)      the world after the first `steps` steps (all of them by default)
//   sampleFilm(name)             [{ label, world }] after each step
//
// Between them they show lanes, a lone block, joined houses, two and three storeys, a pad of every
// footprint, coast buildings, a golden tree, islands of clearly different sizes (home the largest) at
// heights from -0.5 to 0.5, every bridge type, an island with four bridges, two loops, a bent bridge
// around a ring, a water slide that drops the full 1.0, and a view on an island other than home. Islands
// sit where the sky table puts them (ring and angle), and bridges join only table neighbours, with feet
// along their fixed ways out (sky.js).
import { KINDS, JOB_SPOTS } from '../kinds.js';
import { gridFor, roll, canFill } from './grid.js';
import { growthOrder, fillLand, straightOut } from './growth.js';
import { HOUSE_LOOK_COUNT, MAX_FLOORS } from './shape.js';
import { placeIslands as floatIslands, wayOut, pickFoot, clearOf } from './sky.js';

// Each step adds events to the end, the way check-ins would.
//   island: a new island and its start things. land: grow to `to` points. house: a new house of
//   `blocks` blocks (near: aim beside that house). room: one more block (join: prefer touching that
//   house). floor: one more storey. build: a building by its kind's footprint. thing: a natural thing
//   (where: coast | inland). bridge: a bridge of `type` between two sky-table neighbours (a water slide
//   runs from the higher island down). golden: the island turns golden. An island's ring and angle are
//   its place in the sky table, and its lift is its height.
const SCRIPTS = {
  firstDay: [
    { label: 'Day 1: a tiny island', events: [
      { do: 'island', id: 'home', kind: 'home', size: 'large', land: 40 },
      { do: 'helper', id: 'pip', name: 'Pip', job: 'wood', island: 'home' },
      { do: 'build', id: 'garden', kind: 'garden', island: 'home' },
    ] },
    { label: 'Day 1, after the breaks', events: [
      { do: 'land', island: 'home', to: 56 },
      { do: 'build', id: 'nursery', kind: 'nursery', island: 'home' },
      { do: 'helper', id: 'moss', name: 'Moss', job: 'soil', island: 'home' },
    ] },
    { label: 'Day 3: a first block', events: [
      { do: 'land', island: 'home', to: 72 },
      { do: 'house', id: 'h1', island: 'home', blocks: 1, look: 0 },
      { do: 'build', id: 'flowers', kind: 'flowers', island: 'home' },
    ] },
  ],
  village: [
    { label: 'Day 1', events: [
      { do: 'island', id: 'home', kind: 'home', size: 'large', land: 40 },
      { do: 'helper', id: 'pip', name: 'Pip', job: 'wood', island: 'home' },
    ] },
    { label: 'Week 1: a garden and a house', events: [
      { do: 'land', island: 'home', to: 80 },
      { do: 'build', id: 'garden', kind: 'garden', island: 'home' },
      { do: 'build', id: 'nursery', kind: 'nursery', island: 'home' },
      { do: 'house', id: 'h1', island: 'home', blocks: 2, look: 0 },
      { do: 'helper', id: 'moss', name: 'Moss', job: 'soil', island: 'home' },
    ] },
    { label: 'Week 3: a sawmill and a second house', events: [
      { do: 'land', island: 'home', to: 125 },
      { do: 'build', id: 'sawmill', kind: 'sawmill', island: 'home' },
      { do: 'room', id: 'h1-r1', house: 'h1' },
      { do: 'house', id: 'h2', island: 'home', blocks: 2, look: 1, near: 'h1' },
      { do: 'build', id: 'flowers', kind: 'flowers', island: 'home' },
      { do: 'build', id: 'lanterns', kind: 'lanterns', island: 'home' },
      { do: 'thing', id: 'tree-2', kind: 'tree', island: 'home', where: 'coast' },
      { do: 'thing', id: 'bush-1', kind: 'bush', island: 'home', where: 'coast' },
      { do: 'helper', id: 'bram', name: 'Bram', job: 'planks', island: 'home' },
    ] },
    { label: 'Month 2: the houses join and rise', events: [
      { do: 'land', island: 'home', to: 185 },
      { do: 'room', id: 'h1-r2', house: 'h1', join: 'h2' },
      { do: 'floor', id: 'h1-f1', house: 'h1' },
      { do: 'floor', id: 'h1-f2', house: 'h1' },
      { do: 'floor', id: 'h1-f3', house: 'h1' },
      { do: 'room', id: 'h2-r1', house: 'h2' },
      { do: 'floor', id: 'h2-f1', house: 'h2' },
      { do: 'build', id: 'windmill', kind: 'windmill', island: 'home' },
      { do: 'build', id: 'lighthouse', kind: 'lighthouse', island: 'home' },
      { do: 'thing', id: 'flower-1', kind: 'flower', island: 'home', where: 'inland' },
      { do: 'helper', id: 'wren', name: 'Wren', job: 'stone', island: 'home' },
    ] },
    { label: 'Month 3: an observatory and a third house', events: [
      { do: 'land', island: 'home', to: 245 },
      { do: 'build', id: 'observatory', kind: 'observatory', island: 'home' },
      { do: 'house', id: 'h3', island: 'home', blocks: 2, look: 4 },
      { do: 'room', id: 'h3-r1', house: 'h3' },
      { do: 'floor', id: 'h3-f1', house: 'h3' },
      { do: 'thing', id: 'tree-3', kind: 'tree', island: 'home', where: 'coast' },
      { do: 'thing', id: 'bush-2', kind: 'bush', island: 'home', where: 'inland' },
    ] },
  ],
  manyIslands: [
    { label: 'Home in week 2', events: [
      { do: 'island', id: 'home', kind: 'home', size: 'large', land: 40 },
      { do: 'build', id: 'garden', kind: 'garden', island: 'home' },
      { do: 'land', island: 'home', to: 100 },
      { do: 'build', id: 'nursery', kind: 'nursery', island: 'home' },
      { do: 'build', id: 'sawmill', kind: 'sawmill', island: 'home' },
      { do: 'house', id: 'h1', island: 'home', blocks: 2, look: 3 },
      { do: 'room', id: 'h1-r1', house: 'h1' },
      { do: 'floor', id: 'h1-f1', house: 'h1' },
      { do: 'helper', id: 'pip', name: 'Pip', job: 'wood', island: 'home' },
      { do: 'helper', id: 'moss', name: 'Moss', job: 'soil', island: 'home' },
    ] },
    { label: 'A mossy island drifts in, and a rope bridge', events: [
      { do: 'island', id: 'isle-1', kind: 'mossy', size: 'medium', land: 40, ring: 1, angle: 0, lift: 0.5 },
      { do: 'bridge', id: 'bridge-1', type: 'rope', from: 'home', to: 'isle-1' },
      { do: 'helper', id: 'bram', name: 'Bram', job: 'wood', island: 'isle-1' },
      { do: 'helper', id: 'wren', name: 'Wren', job: 'stone', island: 'isle-1' },
      { do: 'helper', id: 'fern', name: 'Fern', job: null, island: 'isle-1' },
    ] },
    { label: 'Both grow: a dock, a grotto, a waterfall', events: [
      { do: 'land', island: 'home', to: 150 },
      { do: 'build', id: 'airship', kind: 'airship', island: 'home' },
      { do: 'build', id: 'aurora', kind: 'aurora', island: 'home' },
      { do: 'land', island: 'isle-1', to: 85 },
      { do: 'build', id: 'grotto', kind: 'grotto', island: 'isle-1' },
      { do: 'house', id: 'm1', island: 'isle-1', blocks: 2, look: 2 },
      { do: 'build', id: 'skyfall', kind: 'skyfall', island: 'isle-1' },
      { do: 'thing', id: 'mushroom-2', kind: 'mushroom', island: 'isle-1', where: 'coast' },
      { do: 'golden', island: 'isle-1' },
    ] },
    { label: 'Two more islands, and a loop of bridges', events: [
      { do: 'island', id: 'isle-2', kind: 'rocky', size: 'small', land: 30, ring: 1, angle: 180, lift: -0.25 },
      { do: 'island', id: 'isle-3', kind: 'meadow', size: 'medium', land: 55, ring: 1, angle: 315, lift: -0.5 },
      { do: 'bridge', id: 'bridge-2', type: 'arch', from: 'home', to: 'isle-3' },
      // Around the ring between islands at different distances, so it bends; it drops the full 1.0.
      { do: 'bridge', id: 'bridge-3', type: 'slide', from: 'isle-1', to: 'isle-3' },
      { do: 'bridge', id: 'bridge-4', type: 'rainbow', from: 'home', to: 'isle-2' },
      { do: 'build', id: 'beehives', kind: 'beehives', island: 'isle-3' },
      { do: 'helper', id: 'tam', name: 'Tam', job: 'stone', island: 'isle-2' },
    ] },
    { label: 'A crystal island, cloud steps and a flower arch', events: [
      { do: 'island', id: 'isle-4', kind: 'crystal', size: 'small', land: 30, ring: 1, angle: 135, lift: 0.35 },
      { do: 'bridge', id: 'bridge-5', type: 'cloudsteps', from: 'home', to: 'isle-4' },
      { do: 'bridge', id: 'bridge-6', type: 'flowerarch', from: 'isle-2', to: 'isle-4' },
      { do: 'land', island: 'isle-1', to: 100 },
      { do: 'land', island: 'isle-3', to: 70 },
      { do: 'helper', id: 'opal', name: 'Opal', job: null, island: 'isle-4' },
    ] },
  ],
};

export const SAMPLE_NAMES = Object.keys(SCRIPTS);

export function sampleTown(name, steps = Infinity) {
  const script = SCRIPTS[name];
  if (!script) throw new Error(`No sample town called ${name}`);
  return replay(script.slice(0, steps));
}

export function sampleFilm(name) {
  return (SCRIPTS[name] ?? []).map((step, n) => ({ label: step.label, world: sampleTown(name, n + 1) }));
}

// ---------- The replay ----------
const START_EXTRA = { mossy: 'mushroom', rocky: 'rock', meadow: 'flower', crystal: 'crystal', misty: 'bush' };
const round4 = v => Math.round(v * 1e4) / 1e4 + 0;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const middle = list => [round4(list.reduce((s, p) => s + p[0], 0) / list.length), round4(list.reduce((s, p) => s + p[1], 0) / list.length)];
// Facing cost for a way out [dx, dz]: south 0, east and west 0.7, north 2.4, smooth in between.
const facingCost = ([dx, dz]) => { const c = 1 - dz / (Math.hypot(dx, dz) || 1); return 0.2 * c + 0.5 * c * c; };
const yawOf = ([dx, dz]) => round4(Math.atan2(dx, dz));

function replay(steps) {
  const islands = new Map();
  const things = [];
  const bridges = [];
  const helpers = [];
  let built = 0; // counts buildings, so the view can find the newest

  for (const step of steps) {
    for (const event of step.events) run(event);
    placeIslands();
  }
  return world();

  function run(event) {
    const isle = islands.get(event.island ?? (event.house ? houseIsland(event.house) : null));
    switch (event.do) {
      case 'island': newIsland(event); break;
      case 'land': grow(isle, event.to); break;
      case 'house': newHouse(isle, event); break;
      case 'room': room(isle, event); break;
      case 'floor': floor(isle, event); break;
      case 'build': build(isle, event); break;
      case 'thing': natural(isle, event); break;
      case 'bridge': bridge(event); break;
      case 'golden': addThing(isle, { id: `${isle.id}:golden`, kind: 'goldentree', points: [isle.golden], yaw: round4(roll('yaw', isle.id, 'golden') * 6.28) }); break;
      case 'helper': helpers.push({ id: event.id, name: event.name, job: event.job ?? null, island: event.island }); break;
      default: throw new Error(`Sample step ${event.do} is unknown`);
    }
  }
  function houseIsland(id) {
    for (const isle of islands.values()) if (isle.houses.some(h => h.id === id)) return isle.id;
    return null;
  }

  // ---- Islands, land and the start ----
  function newIsland({ id, kind, size, land, ring = 0, angle = null, lift = 0 }) {
    const grid = gridFor(id, size);
    const isle = {
      id, kind, size, ring, angle, lift, grid, order: growthOrder(grid, id), land: [], landSet: new Set(), kept: [], keptSet: new Set(),
      lanes: [], laneSet: new Set(), taken: new Map(), blockOf: new Map(), houses: [], entrances: new Set(),
      golden: -1, plaza: -1, at: [0, 0], distance: 0, newest: [], newestAt: -1,
    };
    islands.set(id, isle);
    grow(isle, land);
    start(isle);
  }

  function grow(isle, count) {
    isle.land = fillLand(isle.grid, isle.order, count, isle.keptSet);
    isle.landSet = new Set(isle.land);
  }

  function start(isle) {
    const { grid, id } = isle;
    const t = tools(isle);
    isle.plaza = isle.order[0];
    t.addLane(isle.plaza);
    const byRoll = (list, what) => list.slice().sort((a, b) => roll(what, id, a) - roll(what, id, b) || a - b);
    if (id === 'home') {
      // The plaza is three lane points; the pile sits beside it and the campfire 2 steps away.
      for (const n of byRoll(grid.neighbours[isle.plaza].filter(t.isLand), 'plaza').slice(0, 2)) t.addLane(n);
      const steps = t.stepsFrom(isle.lanes, t.isLand);
      placePoint(isle, 'home:pile', 'pile', byRoll(isle.land.filter(p => steps.get(p) === 1 && t.inland(p)), 'pile'));
      const fire = placePoint(isle, 'home:fire', 'fire', byRoll(isle.land.filter(p => steps.get(p) === 2), 'fire'));
      const firePoint = grid.points[fire.points[0]];
      for (const n of [1, 2]) {
        const seats = byRoll(grid.neighbours[fire.points[0]].filter(t.isLand), `seat${n}`);
        placePoint(isle, `home:seat-${n}`, 'seat', seats, p => yawOf([firePoint[0] - grid.points[p][0], firePoint[1] - grid.points[p][1]]));
      }
      // The old tree and the big rock on the coast, on opposite sides.
      const coastal = isle.land.filter(p => t.coast(p) && steps.get(p) >= 2 && steps.get(p) <= 3);
      const tree = placePoint(isle, 'home:tree', 'tree', byRoll(coastal, 'tree'));
      const far = p => -dist(grid.points[p], grid.points[tree.points[0]]);
      placePoint(isle, 'home:rock', 'rock', byRoll(coastal, 'rock').sort((a, b) => far(a) - far(b)));
    } else {
      const steps = t.stepsFrom([isle.plaza], t.isLand);
      const near = byRoll(isle.land.filter(p => steps.get(p) >= 1 && steps.get(p) <= 3), 'start');
      placePoint(isle, `${id}:tree`, 'tree', near);
      placePoint(isle, `${id}:rock`, 'rock', near);
      placePoint(isle, `${id}:extra`, START_EXTRA[isle.kind] ?? 'bush', near);
    }
    // The golden point: one of the first 12 growth points, kept free for good.
    isle.golden = byRoll(isle.order.slice(0, 12).filter(t.free), 'golden')[0];
  }

  // ---- Houses ----
  function newHouse(isle, { id, blocks = 2, look, near }) {
    const { grid } = isle;
    const t = tools(isle);
    const mine = new Set();
    const otherHouse = p => grid.neighbours[p].some(n => isle.blockOf.has(n) && !mine.has(n));
    const roomy = p => t.free(p) && t.inland(p) && !otherHouse(p) && !t.nextToPad(p);
    const anchor = near ? isle.houses.find(h => h.id === near).blocks.map(b => b.point) : isle.houses.flatMap(h => h.blocks.map(b => b.point));
    const fromHouse = anchor.length ? t.stepsFrom(anchor, t.isLand) : t.stepsFrom([isle.plaza], t.isLand);
    const want = anchor.length ? 2 : 3;
    const fromLane = t.stepsFrom(isle.lanes, t.isLand);
    const options = isle.land.filter(p => roomy(p) && grid.neighbours[p].filter(roomy).length >= 3);
    const score = p => 10 * Math.abs((fromHouse.get(p) ?? 99) - want) + 2 * (fromLane.get(p) ?? 99) + 3 * t.crowd([p]) + 4 * roll(id, 'site', p);
    for (const first of sortBy(options, score)) {
      mine.clear();
      mine.add(first);
      for (let k = 1; k < blocks; k++) {
        const next = sortBy([...mine].flatMap(b => grid.neighbours[b]).filter(p => !mine.has(p) && roomy(p)), p => -t.touching(p, mine) + roll(id, 'block', k, p) * 0.9)[0];
        if (next === undefined) break;
        mine.add(next);
      }
      if (mine.size < blocks || !t.reachable([...mine])) continue;
      const door = t.doorFor(mine, id);
      if (!door) continue;
      const house = { id, look: look ?? Math.floor(roll('look', id) * HOUSE_LOOK_COUNT), door: null, blocks: [] };
      isle.houses.push(house);
      for (const p of mine) t.addBlock(house, p);
      t.openDoor(house, door);
      isle.newest = [...mine];
      isle.newestAt = built++;
      return;
    }
    throw new Error(`Sample town: no place for house ${id}`);
  }

  function room(isle, { id, house: houseId, join }) {
    const { grid } = isle;
    const t = tools(isle);
    const house = isle.houses.find(h => h.id === houseId);
    const mine = new Set(house.blocks.map(b => b.point));
    const other = join ? new Set(isle.houses.find(h => h.id === join).blocks.map(b => b.point)) : null;
    const options = [...new Set([...mine].flatMap(b => grid.neighbours[b]))].filter(p => t.free(p) && t.inland(p) && !t.nextToPad(p));
    const score = p => -2 * t.touching(p, mine) - (other ? 4 * t.touching(p, other) : 0) + roll(id, 'room', p) * 0.9;
    const pick = sortBy(options, score).find(p => t.reachable([p]));
    if (pick === undefined) throw new Error(`Sample town: no room for ${id}`);
    t.addBlock(house, pick);
    isle.newest = [pick];
    isle.newestAt = built++;
  }

  function floor(isle, { id, house: houseId }) {
    const house = isle.houses.find(h => h.id === houseId);
    const mine = new Set(house.blocks.map(b => b.point));
    const t = tools(isle);
    const block = sortBy(house.blocks.filter(b => b.floors < MAX_FLOORS), b => -t.touching(b.point, mine) + roll(id, 'floor', b.point) * 0.5)[0];
    if (!block) throw new Error(`Sample town: no block to raise for ${id}`);
    block.floors += 1;
    isle.newest = [block.point];
    isle.newestAt = built++;
  }

  // ---- Buildings on pads (and flower beds and lanterns) ----
  function build(isle, { id, kind }) {
    const { grid } = isle;
    const t = tools(isle);
    const def = KINDS[kind];
    const ok = p => t.free(p) && !t.nextToBlock(p) && (def.edge || !t.coast(p)) && (kind !== 'lanterns' || grid.neighbours[p].some(n => isle.laneSet.has(n)));
    const fromPlaza = t.stepsFrom([isle.plaza], t.isLand);
    const fromLane = t.stepsFrom(isle.lanes, p => t.free(p) || isle.laneSet.has(p));
    const wanted = 3 + things.filter(th => th.island === isle.id).length / 4;
    // The front: the point next to the pad that is closest to the lanes. The model faces it.
    const frontOf = option => {
      const inPad = new Set(option.points);
      const fronts = [...new Set(option.points.flatMap(p => grid.neighbours[p]))].filter(n => !inPad.has(n) && fromLane.has(n));
      return sortBy(fronts, n => fromLane.get(n))[0] ?? null;
    };
    const awayTo = (option, p) => [grid.points[p][0] - option.at[0], grid.points[p][1] - option.at[1]];
    const options = [];
    for (const option of footOptions(grid, def.foot, isle.land, ok)) {
      if (def.pad) {
        option.front = frontOf(option);
        if (option.front === null) continue;
      }
      if (def.edge) {
        // A coast building: one side on the coast, with clear sky straight out from it.
        for (const side of option.sides) {
          if (!side.every(t.coast)) continue;
          const way = [middle(side.map(p => grid.points[p]))[0] - option.at[0], middle(side.map(p => grid.points[p]))[1] - option.at[1]];
          const strips = side.map(p => straightOut(grid, p, way));
          if (strips.some(s => s.length < 3) || strips.flat().some(p => isle.landSet.has(p) || isle.keptSet.has(p))) continue;
          const north = way[1] < -0.5 * Math.hypot(...way) ? 100 : 0;
          options.push({ ...option, way, strips, side, score: 10 * facingCost(way) + north + 3 * t.crowd(option.points) + 4 * roll(id, 'pad', option.points[0]) });
        }
      } else {
        const beside = option.points.some(p => grid.neighbours[p].some(n => isle.laneSet.has(n) || isle.blockOf.has(n)));
        const gap = Math.abs(Math.min(...option.points.map(p => fromPlaza.get(p) ?? 99)) - wanted);
        const facing = def.pad ? facingCost(awayTo(option, option.front)) : beside ? -5 : 0;
        options.push({ ...option, score: 10 * gap + facing + 3 * t.crowd(option.points) + 4 * roll(id, 'pad', option.points[0]) });
      }
    }
    for (const option of options.sort((a, b) => a.score - b.score || a.points[0] - b.points[0])) {
      if (def.blocks && !t.reachable(option.points)) continue;
      const front = def.pad ? option.front : null;
      if (front !== null && !t.canJoinLane(front)) continue;
      let yaw = 0;
      if (def.edge) yaw = yawOf(option.way);
      else if (front !== null) yaw = yawOf(awayTo(option, front));
      else if (def.foot === 'pair') {
        // A flower bed lies along its two points and faces the camera's side.
        const [a, b] = option.points.map(p => grid.points[p]);
        const along = [b[0] - a[0], b[1] - a[1]];
        yaw = yawOf(along[0] >= 0 ? [-along[1], along[0]] : [along[1], -along[0]]);
      } else yaw = round4(roll('yaw', id) * 6.28);
      addThing(isle, {
        id, kind, points: option.points, at: option.at, yaw, scale: def.pad ? fit(grid, option.cells) : 1, front,
        coast: def.edge ? { yaw, width: round4(dist(grid.points[option.side[0]], grid.points[option.side[option.side.length - 1]])) } : null,
      });
      if (front !== null) { t.joinLane(front); isle.entrances.add(front); }
      if (def.edge) keep(isle, option.strips.flat());
      isle.newest = option.points;
      isle.newestAt = built++;
      return;
    }
    throw new Error(`Sample town: no place for ${kind} ${id}`);
  }

  // ---- Natural things and start things on one point ----
  function natural(isle, { id, kind, where }) {
    const t = tools(isle);
    const ok = p => t.free(p) && !isle.grid.neighbours[p].some(n => isle.entrances.has(n)) && (where === 'coast' ? t.coast(p) : t.inland(p));
    const options = isle.land.filter(ok).sort((a, b) => roll(id, a) - roll(id, b) || a - b);
    placePoint(isle, id, kind, options);
  }

  function placePoint(isle, id, kind, options, yawFor = () => round4(roll('yaw', id) * 6.28)) {
    const t = tools(isle);
    const blocks = KINDS[kind].blocks;
    const p = options.find(q => t.free(q) && (!blocks || t.reachable([q])));
    if (p === undefined) throw new Error(`Sample town: no place for ${kind} ${id}`);
    return addThing(isle, { id, kind, points: [p], yaw: yawFor(p) });
  }

  function addThing(isle, { id, kind, points, at, yaw, scale = 1, front = null, coast = null }) {
    const thing = {
      id, kind, island: isle.id, points: [...points], at: at ? [...at] : middle(points.map(p => isle.grid.points[p])),
      yaw, scale, pad: Boolean(KINDS[kind].pad), front, coast,
    };
    things.push(thing);
    for (const p of points) isle.taken.set(p, thing);
    return thing;
  }

  // Kept sky: only points that can ever fill.
  function keep(isle, points) {
    for (const p of points) {
      if (isle.keptSet.has(p) || !canFill(isle.grid, p)) continue;
      isle.keptSet.add(p);
      isle.kept.push(p);
    }
  }

  // ---- Islands in the sky and bridges ----
  function placeIslands() {
    const list = [...islands.values()];
    floatIslands(list).forEach(({ at }, i) => { list[i].at = at; });
  }

  function bridge({ id, type, from, to }) {
    const a = islands.get(from), b = islands.get(to);
    if (type === 'slide' && !(a.lift > b.lift)) throw new Error(`Sample town: water slide ${id} must run downhill`);
    const ends = [[a, wayOut(a, b)], [b, wayOut(b, a)]].map(([isle, out]) => ({ island: isle.id, point: foot(isle, out), out }));
    bridges.push({ id, type, from: ends[0], to: ends[1] });
  }

  // A bridge foot: the free coast point nearest the line from the grid's middle along the way out, whose
  // strip straight out meets no land (sky.js). It becomes a lane, and the strip is kept sky.
  function foot(isle, out) {
    const t = tools(isle);
    const ok = p => (t.free(p) || isle.laneSet.has(p)) && (isle.laneSet.has(p) || t.canJoinLane(p));
    const found = pickFoot(isle.grid, isle.land, t.isLand, out, ok);
    if (!found) throw new Error(`Sample town: no bridge foot on ${isle.id}`);
    t.joinLane(found.point);
    t.addLane(found.point);
    keep(isle, [...found.pier.chain, ...found.pier.hold.keys()]); // samples keep the whole pier as sky
    return found.point;
  }

  // ---- The world ----
  function world() {
    const list = [...islands.values()];
    return {
      islands: list.map(isle => ({
        id: isle.id, kind: isle.kind, size: isle.size, grid: isle.grid, at: [...isle.at], lift: isle.lift,
        land: [...isle.land], kept: [...isle.kept], lanes: [...isle.lanes],
        houses: isle.houses.map(h => ({ id: h.id, look: h.look, door: { ...h.door }, blocks: h.blocks.map(b => ({ ...b })) })),
        reach: reachOf(isle),
        borrowed: 0,
      })),
      things: things.map(t => ({ ...t, points: [...t.points], at: [...t.at], coast: t.coast && { ...t.coast } })),
      bridges: bridges.map(b => ({ id: b.id, type: b.type, from: endOf(b.from), to: endOf(b.to) })),
      helpers: helpers.map(h => ({ ...h })),
      view: viewOf(list),
    };
  }

  // A bridge end with how far its deck runs straight, from the land as it is now.
  function endOf({ island, point, out }) {
    const isle = islands.get(island);
    return { island, point, out: [...out], clear: clearOf(isle.grid, isle.land, point, out) };
  }

  // The island with the most helpers at work (ties: the newest building, then home), and the points
  // the camera keeps in view there: where they work, the plaza, and the newest building.
  function viewOf(list) {
    if (!list.length) return { island: null, points: [] };
    const working = helpers.filter(h => h.job);
    const busy = isle => working.filter(h => h.island === isle.id).length;
    const isle = list.slice().sort((a, b) => busy(b) - busy(a) || b.newestAt - a.newestAt || (a.id === 'home' ? -1 : b.id === 'home' ? 1 : 0))[0];
    const points = new Set([isle.plaza]);
    const plaza = isle.grid.points[isle.plaza];
    for (const helper of working.filter(h => h.island === isle.id)) {
      const kinds = JOB_SPOTS[helper.job] ?? [];
      const spot = sortBy(things.filter(th => th.island === isle.id && kinds.includes(th.kind)), th => dist(th.at, plaza))[0];
      for (const p of spot?.points ?? []) points.add(p);
    }
    for (const p of isle.newest) points.add(p);
    return { island: isle.id, points: [...points] };
  }

  // ---- Point tests and small searches for one island ----
  function tools(isle) {
    const { grid } = isle;
    const isLand = p => isle.landSet.has(p);
    const coast = p => isLand(p) && grid.neighbours[p].some(n => !isLand(n));
    const inland = p => isLand(p) && grid.neighbours[p].every(isLand);
    const free = p => isLand(p) && !isle.laneSet.has(p) && !isle.blockOf.has(p) && !isle.taken.has(p) && p !== isle.golden;
    const blocking = thing => KINDS[thing.kind].blocks;
    const walkable = p => isLand(p) && !isle.blockOf.has(p) && !(isle.taken.has(p) && blocking(isle.taken.get(p)));
    const stepsFrom = (starts, ok) => {
      const steps = new Map(starts.map(s => [s, 0]));
      const queue = [...starts];
      for (let h = 0; h < queue.length; h++) {
        for (const n of grid.neighbours[queue[h]]) if (!steps.has(n) && ok(n)) { steps.set(n, steps.get(queue[h]) + 1); queue.push(n); }
      }
      return steps;
    };
    // The free points that join `from` to the lanes, shortest first (ties: the lower point number).
    const laneChain = from => {
      if (isle.laneSet.has(from) || !isle.lanes.length) return [];
      const prev = new Map([[from, -1]]);
      const queue = [from];
      for (let h = 0; h < queue.length; h++) {
        for (const n of grid.neighbours[queue[h]]) {
          if (prev.has(n)) continue;
          if (isle.laneSet.has(n)) {
            const chain = [];
            for (let k = queue[h]; k !== -1; k = prev.get(k)) chain.push(k);
            return chain;
          }
          if (!free(n)) continue;
          prev.set(n, queue[h]);
          queue.push(n);
        }
      }
      return null;
    };
    const addLane = p => { if (!isle.laneSet.has(p)) { isle.laneSet.add(p); isle.lanes.push(p); } };
    const pads = () => new Set(things.filter(th => th.island === isle.id && th.pad).flatMap(th => th.points));
    return {
      isLand, coast, inland, free, stepsFrom, addLane,
      nextToBlock: p => grid.neighbours[p].some(n => isle.blockOf.has(n)),
      nextToPad: p => { const set = pads(); return grid.neighbours[p].some(n => set.has(n)); },
      touching: (p, set) => grid.neighbours[p].filter(n => set.has(n)).length,
      // Used points within 2 steps.
      crowd: points => {
        const near = new Set(points.flatMap(p => grid.neighbours[p].flatMap(n => [n, ...grid.neighbours[n]])));
        for (const p of points) near.delete(p);
        return [...near].filter(n => isle.blockOf.has(n) || isle.taken.has(n)).length;
      },
      // Can every walkable point still be reached from the plaza with these points blocked?
      reachable: blocked => {
        const shut = new Set(blocked);
        const ok = p => walkable(p) && !shut.has(p);
        const steps = stepsFrom([isle.plaza], ok);
        return isle.land.filter(ok).every(p => steps.has(p));
      },
      canJoinLane: p => laneChain(p) !== null,
      joinLane: p => { for (const q of laneChain(p) ?? []) addLane(q); },
      addBlock: (house, p) => { house.blocks.push({ point: p, floors: 1 }); isle.blockOf.set(p, house); },
      // The door looks onto the free neighbour closest to the lanes.
      doorFor: (blocks, id) => {
        const fromLane = stepsFrom(isle.lanes, p => free(p) || isle.laneSet.has(p));
        let best = null;
        for (const b of blocks) for (const n of grid.neighbours[b]) {
          if (blocks.has(n) || !fromLane.has(n) || n === isle.golden) continue;
          const k = fromLane.get(n) + roll(id, 'door', b, n) * 0.5;
          if (!best || k < best.k) best = { k, point: b, outside: n };
        }
        return best && laneChain(best.outside) !== null ? best : null;
      },
      openDoor: (house, door) => {
        house.door = { point: door.point, outside: door.outside };
        for (const q of laneChain(door.outside)) addLane(q);
        isle.entrances.add(door.outside);
      },
    };
  }
}

// The points a footprint could cover, where every point passes ok. Each option has its points (in the
// order shape.js gives), its middle `at`, its cells, and its sides (for coast buildings).
function footOptions(grid, foot, land, ok) {
  const out = [];
  if (foot === 'point') for (const p of land) if (ok(p)) out.push({ points: [p], at: [...grid.points[p]], cells: [], sides: [] });
  if (foot === 'pair') {
    for (const p of land) if (ok(p)) for (const q of grid.neighbours[p]) if (q > p && ok(q)) out.push({ points: [p, q], at: middle([grid.points[p], grid.points[q]]), cells: [], sides: [] });
  }
  if (foot === 'cell' || foot === 'cells') {
    const good = [...new Set(land.flatMap(p => grid.around[p]))].filter(c => grid.cells[c].every(ok)).sort((a, b) => a - b);
    for (const c of good) {
      const q = grid.cells[c];
      if (foot === 'cell') { out.push({ points: [...q], at: [...grid.centres[c]], cells: [c], sides: q.map((p, k) => [p, q[(k + 1) % 4]]) }); continue; }
      for (const d of good) {
        if (d <= c) continue;
        const r = grid.cells[d];
        const k = q.findIndex((p, i) => r.includes(p) && r.includes(q[(i + 1) % 4]));
        if (k < 0) continue;
        // Turn both cells so the shared side comes first: q = s1 s2 a3 a4, r = s2 s1 b3 b4.
        const a = [0, 1, 2, 3].map(i => q[(k + i) % 4]);
        const j = r.indexOf(a[1]);
        const b = [0, 1, 2, 3].map(i => r[(j + i) % 4]);
        out.push({
          points: [...q, ...r.filter(p => !q.includes(p))], at: middle([grid.centres[c], grid.centres[d]]), cells: [c, d],
          sides: [[a[3], a[0], b[2]], [b[3], a[1], a[2]]], // the two long sides
        });
      }
    }
  }
  if (foot === 'ring') {
    for (const m of land) {
      if (grid.around[m].length !== 4) continue;
      const points = [...new Set(grid.around[m].flatMap(c => grid.cells[c]))];
      if (points.length !== 9 || !points.every(ok)) continue;
      out.push({ points: [m, ...points.filter(p => p !== m).sort((a, b) => a - b)], at: [...grid.points[m]], cells: [...grid.around[m]], sides: [] });
    }
  }
  return out;
}

// A pad's fit: its cell size ÷ 0.62, kept between 0.85 and 1.15.
function fit(grid, cells) {
  if (!cells.length) return 1;
  const size = cells.reduce((sum, c) => {
    const q = grid.cells[c].map(p => grid.points[p]);
    return sum + (dist(q[0], q[2]) + dist(q[1], q[3])) / 2 / Math.SQRT2;
  }, 0) / cells.length;
  return round4(Math.min(1.15, Math.max(0.85, size / 0.62)));
}

function reachOf(isle) {
  return round4(Math.max(0, ...isle.land.map(p => Math.hypot(...isle.grid.points[p]))));
}

function sortBy(list, score) {
  const scored = list.map(item => ({ item, k: score(item) }));
  scored.sort((a, b) => a.k - b.k || (typeof a.item === 'number' ? a.item - b.item : 0));
  return scored.map(s => s.item);
}
