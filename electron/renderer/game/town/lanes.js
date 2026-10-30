// Lanes and step counts on one island's grid (game/BUILD_PLAN.md, "Lanes"). Plain code: no DOM.
//
//   stepsFrom(grid, starts, ok) => Int32Array   steps from the nearest start through points that pass ok (-1: no way)
//   laneChain(isle, from) => [p, ...] | null    the free points that join `from` to the lanes, from first
//   joinLane(isle, from) => boolean             makes that chain into lanes
//
// Lanes start at the plaza, each door's outside, each pad's front and each bridge foot. A new lane is
// the shortest run of free points to the nearest lane (ties: the lower point number, because grid
// neighbours are listed in number order). Lanes are never removed and never built over.

export function stepsFrom(grid, starts, ok) {
  const steps = new Int32Array(grid.points.length).fill(-1);
  const queue = new Int32Array(grid.points.length);
  let tail = 0;
  for (const s of starts) if (steps[s] < 0) { steps[s] = 0; queue[tail++] = s; }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    for (const n of grid.neighbours[p]) if (steps[n] < 0 && ok(n)) { steps[n] = steps[p] + 1; queue[tail++] = n; }
  }
  return steps;
}

// `from` itself (if it isn't a lane yet), then the free points on the shortest way to a lane.
export function laneChain(isle, from) {
  if (isle.isLane[from]) return [];
  if (!isle.lanes.length) return [from];
  const { grid } = isle;
  const prev = new Map([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    for (const n of grid.neighbours[p]) {
      if (prev.has(n)) continue;
      if (isle.isLane[n]) {
        const chain = [];
        for (let k = p; k !== -1; k = prev.get(k)) chain.push(k);
        return chain;
      }
      if (!isle.isFree(n)) continue;
      prev.set(n, p);
      queue.push(n);
    }
  }
  return null;
}

export function joinLane(isle, from) {
  const chain = laneChain(isle, from);
  if (!chain) return false;
  for (const p of chain) isle.addLane(p);
  return true;
}
