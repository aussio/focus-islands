// Places islands in the sky around home and joins linked islands with straight bridges.
//
// Home sits in the middle. Each other island, in list order, gets a preferred direction by its
// index (east, west, north-east, south-west, ...) and is pushed outward until it has GAP cells of
// sky to every placed island. It is placed so a straight bridge to the island it is linked to
// (or to home, if it has no link yet) is possible, so a new link rarely moves it.
import { key, keyX, keyY } from './grid.js';

export const GAP = 3; // cells of sky kept between islands

// Preferred directions by index (screen: +x east, +y south toward the camera), in degrees.
const SLOT_ANGLES = [0, 180, 315, 135, 225, 45, 270, 90];

const SIDES = [
  { axis: 'x', sign: 1 }, // east
  { axis: 'x', sign: -1 }, // west
  { axis: 'y', sign: 1 }, // south
  { axis: 'y', sign: -1 }, // north
];

// For each line across the axis, the first and last land cell along it.
// axis 'x': Map(y -> [minX, maxX]); axis 'y': Map(x -> [minY, maxY]).
function spansOf(layout, axis) {
  const spans = new Map();
  for (const k of layout.land) {
    const along = axis === 'x' ? keyX(k) : keyY(k);
    const across = axis === 'x' ? keyY(k) : keyX(k);
    const span = spans.get(across);
    if (!span) spans.set(across, [along, along]);
    else {
      if (along < span[0]) span[0] = along;
      if (along > span[1]) span[1] = along;
    }
  }
  return spans;
}

function occupiedOf(layout) {
  const cells = new Set();
  for (const thing of layout.things) {
    for (let b = 0; b < thing.h; b++) for (let a = 0; a < thing.w; a++) cells.add(key(thing.x + a, thing.y + b));
  }
  return cells;
}

export function placeIslands(layouts, links) {
  const count = layouts.length;
  const anchors = new Array(count).fill(null);
  if (!count) return { anchors: [], bridges: [] };
  const info = layouts.map(layout => ({
    layout,
    spans: { x: spansOf(layout, 'x'), y: spansOf(layout, 'y') },
    occupied: occupiedOf(layout),
    box: layout.box,
  }));
  const indexOf = new Map(layouts.map((layout, i) => [layout.id, i]));
  const cleanLinks = (links ?? [])
    .map(link => ({ id: link.id, a: indexOf.get(String(link.from)), b: indexOf.get(String(link.to)) }))
    .filter(link => link.a !== undefined && link.b !== undefined && link.a !== link.b);

  const centre = i => {
    const { box } = info[i];
    return [anchors[i][0] + (box.minX + box.maxX) / 2, anchors[i][1] + (box.minY + box.maxY) / 2];
  };

  // World line spans for a placed (or trial) island.
  const worldSpan = (i, anchor, axis, line) => {
    const localLine = line - (axis === 'x' ? anchor[1] : anchor[0]);
    const span = info[i].spans[axis].get(localLine);
    if (!span) return null;
    const shift = axis === 'x' ? anchor[0] : anchor[1];
    return [span[0] + shift, span[1] + shift];
  };

  // Does island i at anchor come within GAP cells of any placed island?
  const clashes = (i, anchor) => {
    const box = info[i].box;
    const cMinX = anchor[0] + box.minX, cMaxX = anchor[0] + box.maxX;
    const cMinY = anchor[1] + box.minY, cMaxY = anchor[1] + box.maxY;
    for (let j = 0; j < count; j++) {
      if (!anchors[j] || j === i) continue;
      const other = info[j].box, oa = anchors[j];
      if (cMaxX < oa[0] + other.minX - GAP || cMinX > oa[0] + other.maxX + GAP) continue;
      if (cMaxY < oa[1] + other.minY - GAP || cMinY > oa[1] + other.maxY + GAP) continue;
      for (const [localY, [lo, hi]] of info[i].spans.x) {
        const y = localY + anchor[1];
        for (let dy = -GAP; dy <= GAP; dy++) {
          const span = worldSpan(j, oa, 'x', y + dy);
          if (!span) continue;
          if (lo + anchor[0] <= span[1] + GAP && hi + anchor[0] >= span[0] - GAP) return true;
        }
      }
    }
    return false;
  };

  // Is any island's land between along0 and along1 (exclusive) on this line?
  const lineBlocked = (axis, line, along0, along1) => {
    for (let j = 0; j < count; j++) {
      if (!anchors[j]) continue;
      const span = worldSpan(j, anchors[j], axis, line);
      if (span && span[0] < along1 && span[1] > along0) return true;
    }
    return false;
  };

  // A bridge lands on a cell with nothing on it that helpers can walk to from the pile.
  const freeEnd = (i, anchor, c, r) => {
    const k = key(c - anchor[0], r - anchor[1]);
    return !info[i].occupied.has(k) && info[i].layout.reach.has(k);
  };

  // The shortest straight bridge between two placed islands (or trial anchor for b), or null.
  const findBridge = (a, b, anchorA, anchorB) => {
    let best = null;
    for (const axis of ['x', 'y']) {
      const lines = info[a].spans[axis];
      for (const localLine of lines.keys()) {
        const line = localLine + (axis === 'x' ? anchorA[1] : anchorA[0]);
        const spanA = worldSpan(a, anchorA, axis, line);
        const spanB = worldSpan(b, anchorB, axis, line);
        if (!spanA || !spanB) continue;
        let fromAlong, toAlong;
        if (spanA[1] < spanB[0]) { fromAlong = spanA[1]; toAlong = spanB[0]; }
        else if (spanB[1] < spanA[0]) { fromAlong = spanA[0]; toAlong = spanB[1]; }
        else continue;
        const length = Math.abs(toAlong - fromAlong) - 1;
        if (length < 1) continue;
        const lo = Math.min(fromAlong, toAlong), hi = Math.max(fromAlong, toAlong);
        if (lineBlocked(axis, line, lo, hi)) continue;
        const from = axis === 'x' ? [fromAlong, line] : [line, fromAlong];
        const to = axis === 'x' ? [toAlong, line] : [line, toAlong];
        if (!freeEnd(a, anchorA, ...from) || !freeEnd(b, anchorB, ...to)) continue;
        // Prefer short bridges near the middle of both islands.
        const midA = axis === 'x' ? anchorA[1] : anchorA[0];
        const midB = axis === 'x' ? anchorB[1] : anchorB[0];
        const score = length + 0.05 * Math.abs(line - (midA + midB) / 2);
        if (!best || score < best.score) best = { score, length, from, to };
      }
    }
    return best;
  };

  anchors[0] = [0, 0];
  const bridges = [];
  const usedLinks = new Set();

  for (let i = 1; i < count; i++) {
    const link = cleanLinks.find(l => (l.a === i && l.b < i) || (l.b === i && l.a < i));
    const parent = link ? (link.a === i ? link.b : link.a) : 0;
    // Each island keeps its own direction around home, even when it hangs off another island,
    // so the islands stay in a cluster instead of a long chain.
    const wanted = (SLOT_ANGLES[(i - 1) % SLOT_ANGLES.length] + 22.5 * Math.floor((i - 1) / SLOT_ANGLES.length)) * Math.PI / 180;
    const home = centre(0);
    const childBox = info[i].box, parentBox = info[parent].box;
    let best = null;
    for (const side of SIDES) {
      const across = side.axis === 'x' ? 'y' : 'x';
      const pa = anchors[parent];
      const reach = (across === 'y' ? (parentBox.maxY - parentBox.minY + childBox.maxY - childBox.minY) : (parentBox.maxX - parentBox.minX + childBox.maxX - childBox.minX)) / 2 + 1;
      for (let t = -Math.ceil(reach); t <= Math.ceil(reach); t++) {
        // Child anchor across the axis, then the nearest spot along it beyond the parent.
        const acrossValue = (across === 'y' ? pa[1] : pa[0]) + t;
        let start = null;
        for (const [localLine, span] of info[i].spans[side.axis]) {
          const line = localLine + acrossValue;
          const parentSpan = worldSpan(parent, pa, side.axis, line);
          if (!parentSpan) continue;
          const need = side.sign > 0 ? parentSpan[1] + GAP + 1 - span[0] : parentSpan[0] - GAP - 1 - span[1];
          if (start === null || (side.sign > 0 ? need > start : need < start)) start = need;
        }
        if (start === null) continue;
        let anchor = null;
        for (let step = 0; step < 120; step++) {
          const along = start + side.sign * step;
          const trial = side.axis === 'x' ? [along, acrossValue] : [acrossValue, along];
          if (!clashes(i, trial)) { anchor = trial; break; }
        }
        if (!anchor) continue;
        anchors[i] = anchor;
        const bridge = findBridge(parent, i, pa, anchor);
        const [cx, cy] = centre(i);
        anchors[i] = null;
        if (!bridge && link) continue;
        let angle = Math.abs(Math.atan2(cy - home[1], cx - home[0]) - wanted) % (2 * Math.PI);
        if (angle > Math.PI) angle = 2 * Math.PI - angle;
        const score = (bridge ? bridge.length : 20) + angle * 8 + Math.hypot(cx - home[0], cy - home[1]) * 0.2 + Math.abs(t) * 0.02;
        if (!best || score < best.score) best = { score, anchor, bridge };
      }
    }
    if (!best) {
      // Nothing worked (should not happen): float it far out to the east.
      let along = 0;
      for (let j = 0; j < i; j++) along = Math.max(along, anchors[j][0] + info[j].box.maxX);
      best = { anchor: [along + GAP + 1 - childBox.minX, 0], bridge: null };
    }
    anchors[i] = best.anchor;
    if (link && best.bridge) {
      usedLinks.add(link);
      const forward = link.a === parent;
      bridges.push({ id: link.id, from: forward ? best.bridge.from : best.bridge.to, to: forward ? best.bridge.to : best.bridge.from });
    }
  }

  // Links not used for placing an island: join them if a straight bridge fits.
  for (const link of cleanLinks) {
    if (usedLinks.has(link) || bridges.some(b => b.id === link.id)) continue;
    const bridge = findBridge(link.a, link.b, anchors[link.a], anchors[link.b]);
    if (bridge) bridges.push({ id: link.id, from: bridge.from, to: bridge.to });
  }

  // Shift everything so the world grid starts at 0,0.
  let minC = Infinity, minR = Infinity;
  for (let i = 0; i < count; i++) {
    minC = Math.min(minC, anchors[i][0] + info[i].box.minX);
    minR = Math.min(minR, anchors[i][1] + info[i].box.minY);
  }
  const shifted = anchors.map(([c, r]) => [c - minC, r - minR]);
  const shiftedBridges = bridges.map(b => ({ id: b.id, from: [b.from[0] - minC, b.from[1] - minR], to: [b.to[0] - minC, b.to[1] - minR] }));
  return { anchors: shifted, bridges: shiftedBridges };
}
