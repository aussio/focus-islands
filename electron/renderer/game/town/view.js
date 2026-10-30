// Where the view looks (game/BUILD_PLAN.md, "Where the view looks"). Plain code: no DOM.
//
//   viewOf(islands, things, helpers) => { island, points }
//     islands: [{ id, plaza, newest: { checkIn, points } | null }] in the world's order
//
// view.island is the island with the most helpers working there (job not null). Ties go to the island
// with the newest building, then home, then the earlier island. view.points are the plaza, the points
// of the things those helpers work at, and the newest building on that island.
import { JOB_SPOTS } from '../kinds.js';

export function viewOf(islands, things, helpers, grids) {
  if (!islands.length) return { island: null, points: [] };
  const working = helpers.filter(h => h.job);
  const busy = id => working.filter(h => h.island === id).length;
  const newest = isle => isle.newest?.checkIn ?? -Infinity;
  const ranked = islands.map((isle, i) => ({ isle, i }))
    .sort((a, b) => busy(b.isle.id) - busy(a.isle.id) || newest(b.isle) - newest(a.isle)
      || (a.isle.id === 'home' ? -1 : b.isle.id === 'home' ? 1 : 0) || a.i - b.i);
  const isle = ranked[0].isle;
  const points = new Set(isle.plaza >= 0 ? [isle.plaza] : []);
  const grid = grids.get(isle.id);
  const plaza = grid && isle.plaza >= 0 ? grid.points[isle.plaza] : [0, 0];
  const mine = things.filter(t => t.island === isle.id);
  const far = t => Math.hypot(t.at[0] - plaza[0], t.at[1] - plaza[1]);
  for (const helper of working.filter(h => h.island === isle.id)) {
    const kinds = JOB_SPOTS[helper.job] ?? [];
    // Built things first (start things and buildings); decoration only if there is nothing else.
    const spots = mine.filter(t => kinds.includes(t.kind));
    const built = spots.filter(t => !t.id.includes(':decor-'));
    const spot = (built.length ? built : spots).sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1))[0];
    for (const p of spot?.points ?? []) points.add(p);
  }
  for (const p of isle.newest?.points ?? []) points.add(p);
  return { island: isle.id, points: [...points] };
}
