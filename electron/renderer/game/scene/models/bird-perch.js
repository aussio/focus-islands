// A look-only branch on an existing tree. Search a few directions; never move town geometry
// or invent a landing point when a crowded island has no clear branch/takeoff column.
//
// The branch is short and sits at leaf height, so it starts inside the crown and only its outer end
// shows, with a small leaf tuft at the tip. With the bird away it reads as part of the tree, never as a
// bare pole. The bird sits just inside the tuft, on the side facing Today's camera where it can.
//   birdPerch(island, near) => { tree, from, to, perch } | null     all [x, y, z] in island units
//     from: where the branch leaves the trunk, to: the branch tip (the tuft's middle), perch: the bird's feet
//     near: optional ([x, z]) => boolean, the trees allowed (Today's framed view, see inView); the home
//     tree comes first among them, then the others by id
export const BRANCH = { height: 0.74, rise: 0.04, lengths: [0.44, 0.4], seat: 0.08, radius: 0.016 };

const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
};

export function birdPerch(island, near = null) {
  if (!island?.things?.length || !island.grid?.points) return null;
  const trees = island.things.filter(t => t.kind === 'tree' && (!near || (Array.isArray(t.local) && near(t.local)))).sort((a, b) =>
    Number(b.id === `${island.id}:tree`) - Number(a.id === `${island.id}:tree`) || a.id.localeCompare(b.id));
  const floors = [...(island.floors?.keys() ?? [])].map(point => ({ at: island.point(point), radius: 0.45 }));
  const solids = island.things.filter(t => t.pad || t.blocks).flatMap(thing => {
    // Tree crowns extend well beyond their trunk point, including their visible shoulder clumps.
    if (thing.kind === 'tree' || thing.kind === 'goldentree') return [{ owner: thing.id, at: thing.local, radius: 0.72 * Math.max(1, thing.scale || 1) }];
    return (thing.points ?? []).map(point => ({ owner: thing.id, at: island.point(point), radius: thing.pad ? 0.45 : 0.38 }));
  });
  for (const tree of trees) {
    const origin = tree.local;
    if (!Array.isArray(origin) || origin.length < 2) continue;
    const obstacles = [...floors, ...solids.filter(o => o.owner !== tree.id)];
    const candidates = [];
    for (const length of BRANCH.lengths) for (let k = 0; k < 16; k++) {
      const angle = k * Math.PI / 8;
      const point = [origin[0] + Math.sin(angle) * length, origin[1] + Math.cos(angle) * length];
      const seat = [origin[0] + Math.sin(angle) * (length - BRANCH.seat), origin[1] + Math.cos(angle) * (length - BRANCH.seat)];
      // The branch must clear buildings; the wider landing/takeoff column must clear their roofs.
      if (obstacles.some(o => distanceToSegment(o.at, origin, point) < o.radius + 0.035 ||
        Math.hypot(seat[0] - o.at[0], seat[1] - o.at[1]) < o.radius + 0.14)) continue;
      // Toward the camera (+z) reads best, a little to one side so the trunk doesn't line up behind it.
      const facing = Math.cos(angle - 0.5);
      candidates.push({ point, angle, length, k, facing });
    }
    candidates.sort((a, b) => b.length - a.length || b.facing - a.facing || a.k - b.k);
    if (!candidates.length) continue;
    const { point, angle, length } = candidates[0];
    const seat = (length - BRANCH.seat) / length;
    const tipY = BRANCH.height + BRANCH.rise;
    return {
      tree: tree.id,
      from: [origin[0], BRANCH.height, origin[1]],
      to: [point[0], tipY, point[1]],
      perch: [origin[0] + Math.sin(angle) * length * seat, BRANCH.height + BRANCH.rise * seat + BRANCH.radius * 0.6, origin[1] + Math.cos(angle) * length * seat],
    };
  }
  return null;
}

// Today frames a big island close, around the view's grid points and four steps out (core.js aim), so
// a spot within about three steps of one of them is in the picture whatever the camera's sway.
// inView(island, view) => ([x, z]) => boolean, or null when the view does not pick part of this island.
export const VIEW_REACH = 2;
export function inView(island, view) {
  if (!island || view?.island !== island.id || !view.ids?.length) return null;
  const spots = view.ids.map(p => island.point(p));
  return ([x, z]) => spots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) <= VIEW_REACH);
}
