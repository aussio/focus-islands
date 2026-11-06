// Waterfalls off an island's edge (look only; nothing is saved). An island with a pond or a rain catcher
// (the thing kind id 'nursery'), and every mossy or misty island, has one: water slips out from under the
// grass rim over a flat stone, slides slowly down and fades into soft mist far below.
//
//   hasWaterfall(island) => boolean
//   waterfallSpot(island, loop) => { x, z, out: [dx, dz], bearing } | null   (island units, y = 0 grass)
//   buildWaterfall(ctx, island, loop) => waterfall | null      the island's own (called by buildGround)
//   addWaterfall(ctx, { x, y, z, out, width, drop, seed }) => { update(t), water, mist }
//     one waterfall anywhere: its mouth at (x, y, z), pouring out along out. For reuse (an edge spring).
//
// Where: from the island's middle (its grid's 0, 0) a line goes out at a bearing picked from the island's
// id (hashString, pick 'waterfall-side'), within about 26 degrees of due south, the side the camera sees
// through its whole sway (scene/drift.js SWAY turns at most 45 degrees either way). The waterfall sits
// where that line last crosses the coast. A spot whose coast faces away from the camera, whose water the
// camera would see edge-on at either end of its sway (SEEN), or near a bridge foot or its deck, or near a
// coast building (thing.edge), is skipped: the line turns a little further
// each try, nearer bearings first, at most about 60 degrees from south. No spot: no waterfall. A foot is
// only its point and way out here (clear is not in the island's draw key, world.js drawKey).
//
// Motion follows scene time (ctx.dynamic): the water's soft streaks slide down and the mist puffs sink and
// fade below it. At time 0 everything stands at its built pose. Nothing casts a shadow. The mood
// (ctx.onMood) tints the mist and lets the water glow a little in the evening.
//
// The flat stone and the two rocks go into the island's batch under the slab's key (`slab`): like the
// slab, they follow the whole coast and the island's things, so the drawing checks skip them. The water (about 260 triangles)
// and the mist (4 points) are their own small meshes, outside the island's triangle stats.
import * as THREE from 'three';
import { P } from '../style.js';
import { hashString, place } from '../ground.js';
import { chunk, glowTexture, rbox } from '../parts.js';
import { SWAY } from '../drift.js';

export const WATER_THINGS = new Set(['pond', 'nursery']); // nursery: the rain catcher
export const WATER_ISLANDS = new Set(['mossy', 'misty']);
const SPREAD = 0.45; // the picked bearing stays within this many radians of due south (about 26 degrees)
const TURN = 0.2; // each further try turns this much more (about 11 degrees)
const WIDEST = 1.05; // and never further round than this (about 60 degrees)
const FACING = 0.4; // the coast at the spot faces at least this much south (the cosine)
const SEEN = 0.15; // the water faces the camera at both ends of its sway at least this much (the cosine)
const SWAY_END = SWAY.degrees * Math.PI / 180;
const FOOT_CLEAR = 1.3; // units kept from a bridge foot and the start of its deck
const DECK = 1.6; // how far out along a foot's way out its deck is kept clear
const EDGE_CLEAR = 1.0; // units kept from a coast building's points
const SIDE = 8; // loop points either side that set the coast's way out at the spot (about 0.35 units)
const LIP = 0.05; // the mouth sits this far out from the coast line
const MOUTH_Y = -0.2; // just under the grass rim, where the soil starts

// Water motion: the streaks slide FLOW texture repeats a second (a streak takes about 14 s to fall), the
// mist puffs take 1 / MIST_RATE seconds to sink and fade.
const ROWS = 18, AROUND = 7, REPEAT = [2, 2.5];
const FLOW = 0.18;
const MIST_RATE = 0.06;
const MIST_SINK = 0.32;
const PUFFS = [[-0.1, 0.0, 0.02], [0.11, 0.25, -0.02], [-0.02, 0.5, 0.05], [0.14, 0.75, 0.03]]; // [x, phase, z]
export const WATER_MOODS = {
  focus: { mist: '#ffffff', mistOpacity: 0.6, glow: 0.2 },
  break: { mist: '#ffe4ee', mistOpacity: 0.5, glow: 0.36 },
  away: { mist: '#e2e2f2', mistOpacity: 0.45, glow: 0.32 },
  done: { mist: '#aab6f0', mistOpacity: 0.38, glow: 0.4 },
};

export function hasWaterfall(island) {
  if (!island) return false;
  return WATER_ISLANDS.has(island.kind) || (island.things ?? []).some(thing => WATER_THINGS.has(thing.kind));
}

export function buildWaterfall(ctx, island, loop) {
  if (!hasWaterfall(island)) return null;
  const spot = waterfallSpot(island, loop);
  if (!spot) return null;
  ctx.piece?.('slab'); // with the slab: it follows the whole coast
  try {
    const [dx, dz] = spot.out;
    return addWaterfall(ctx, { x: spot.x + dx * LIP, y: MOUTH_Y, z: spot.z + dz * LIP, out: spot.out, seed: hashString(`${island.id}:waterfall-rocks`) });
  } finally {
    ctx.piece?.(null);
  }
}

// ---------- Where ----------

export function waterfallSpot(island, loop) {
  if (!Array.isArray(loop) || loop.length < 3) return null;
  const first = (hashString(`${island.id}:waterfall-side`) * 2 - 1) * SPREAD;
  for (const bearing of bearings(first)) {
    const dir = [Math.sin(bearing), Math.cos(bearing)]; // bearing 0: +z, south, toward the camera
    const hit = lastCrossing(loop, dir);
    if (!hit) continue;
    const { point: [x, z], facing, out } = hit;
    if (facing[1] < FACING || facing[0] * dir[0] + facing[1] * dir[1] < 0.5) continue;
    const way = [round4(out[0]), round4(out[1])];
    // The camera at either end of its sway looks from (sin, cos) of its turn.
    if ([-1, 1].some(s => way[0] * Math.sin(s * SWAY_END) + way[1] * Math.cos(SWAY_END) <= SEEN)) continue;
    if (nearFoot(island, x, z) || nearEdgeThing(island, x, z)) continue;
    return { x: round4(x), z: round4(z), out: way, bearing };
  }
  return null;
}

// The first bearing, then turning further each way in turn (toward south first), within WIDEST.
function bearings(first) {
  const list = [first];
  const toward = first > 0 ? -1 : 1;
  for (let k = 1; k * TURN <= 2 * WIDEST; k++) for (const s of [toward, -toward]) {
    const b = first + s * k * TURN;
    if (Math.abs(b) <= WIDEST) list.push(b);
  }
  return list;
}

// Where a line from the island's middle along dir last crosses the loop, and the coast's way out there
// (from a few loop points either side, so the rounded coast's small steps don't tip it).
function lastCrossing(loop, dir) {
  const n = loop.length;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const det = ex * dir[1] - dir[0] * ez;
    if (Math.abs(det) < 1e-9) continue;
    const t = (ex * a[1] - a[0] * ez) / det;
    const u = (dir[0] * a[1] - dir[1] * a[0]) / det;
    if (t <= 0 || u < 0 || u >= 1 || (best && t <= best.t)) continue;
    best = { t, i };
  }
  if (!best) return null;
  const a = loop[(best.i - SIDE + n) % n], b = loop[(best.i + SIDE + 1) % n];
  const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
  let facing = [ez / l, -ex / l];
  if (facing[0] * dir[0] + facing[1] * dir[1] < 0) facing = [-facing[0], -facing[1]];
  // The water pours half along the coast's own way out and half straight out from the middle, so a
  // slanted bit of coast doesn't send it off sideways.
  const mx = facing[0] + dir[0], mz = facing[1] + dir[1], ml = Math.hypot(mx, mz) || 1;
  return { point: [dir[0] * best.t, dir[1] * best.t], facing, out: [mx / ml, mz / ml] };
}

function nearFoot(island, x, z) {
  for (const foot of island.feet ?? []) {
    const [fx, fz] = island.grid.points[foot.point] ?? [];
    if (!Number.isFinite(fx)) continue;
    const [ox, oz] = Array.isArray(foot.out) ? foot.out : [0, 0];
    if (segmentDistance(x, z, fx, fz, fx + ox * DECK, fz + oz * DECK) < FOOT_CLEAR) return true;
  }
  return false;
}

function nearEdgeThing(island, x, z) {
  for (const thing of island.things ?? []) {
    if (!thing.edge) continue;
    const spots = [thing.at, ...(thing.points ?? []).map(p => island.grid.points[p])].filter(Boolean);
    if (spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < EDGE_CLEAR)) return true;
  }
  return false;
}

function segmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

const round4 = v => Math.round(v * 1e4) / 1e4 + 0;

// ---------- Drawing ----------

// One waterfall: a flat stone under the mouth with a rock either side (into ctx's batch, under whatever
// piece key is current), the falling water and the mist (own meshes under ctx.root). In ctx.root's units.
export function addWaterfall(ctx, { x, y, z, out, width = 0.25, drop = 1.4, seed = 0 }) {
  const ry = Math.atan2(out[0], out[1]); // turns local +z to out
  const frame = place(x, y, z, { ry });

  // The stone the water pours over and the rocks beside it: chunky enough to read at Today's size.
  ctx.add(rbox(width + 0.12, 0.045, 0.24, 0.012, 1), 'matte', P.stone, place(0, -0.022, 0.02), frame, false);
  ctx.add(chunk(0.085, 31 + seed * 50, [1.2, 0.85, 1.05], 0, 0.16), 'facet', P.lilac, place(-(width / 2 + 0.08), -0.01, 0.03, { ry: seed * 6 }), frame, false);
  ctx.add(chunk(0.07, 57 + seed * 50, [1.1, 0.8, 1.1], 0, 0.16), 'facet', P.boulder, place(width / 2 + 0.075, -0.015, 0.05, { ry: seed * 9 }), frame, false);
  ctx.add(chunk(0.05, 77 + seed * 50, [1.3, 0.6, 1.1], 0, 0.12), 'facet', '#6fcf6a', place(-(width / 2 + 0.08), 0.045, 0.03), frame, false);

  // The falling water: soft streaks slide down it (the texture's offset), fading out toward the bottom.
  const texture = streakTexture().clone();
  texture.userData.shared = false; // the clone is this waterfall's own (its image stays shared)
  texture.repeat.set(REPEAT[0], REPEAT[1]);
  const material = new THREE.MeshStandardMaterial({
    map: texture, emissiveMap: texture, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    roughness: 0.3, metalness: 0, emissive: '#d4f3ff', emissiveIntensity: WATER_MOODS.focus.glow,
  });
  const shape = fallShape(width, drop).applyMatrix4(frame);
  const water = new THREE.Mesh(shape, material);
  water.castShadow = false;
  water.receiveShadow = false;
  water.renderOrder = 2;
  water.name = 'waterfall';

  // Mist far below: a few soft puffs that sink slowly and fade in and out, each at its own turn.
  const bottom = -drop * 0.72, reach = 0.06 + 0.32 * Math.sqrt(drop);
  const mistShape = new THREE.BufferGeometry();
  mistShape.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PUFFS.length * 3), 3));
  mistShape.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(PUFFS.length * 4).fill(1), 4));
  const mistMaterial = new THREE.PointsMaterial({
    map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false,
    size: 0.55, sizeAttenuation: true, color: WATER_MOODS.focus.mist, opacity: WATER_MOODS.focus.mistOpacity,
  });
  const mist = new THREE.Points(mistShape, mistMaterial);
  mist.applyMatrix4(frame);
  mist.castShadow = false;
  mist.frustumCulled = false; // the puffs move; four points cost nothing to draw
  mist.renderOrder = 3;
  mist.name = 'waterfall-mist';

  ctx.root.add(water, mist);
  ctx.track(material, shape, texture, mistMaterial, mistShape);

  const position = mistShape.attributes.position, colour = mistShape.attributes.color;
  const update = t => {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0;
    texture.offset.y = (time * FLOW) % 1; // v runs up the water, so a growing offset slides it down
    PUFFS.forEach(([px, phase, pz], k) => {
      const f = (time * MIST_RATE + phase) % 1;
      position.setXYZ(k, px, bottom - f * MIST_SINK, reach + pz);
      colour.setW(k, Math.sin(Math.PI * f) * 0.9 + 0.1 * (1 - f));
    });
    position.needsUpdate = true;
    colour.needsUpdate = true;
  };
  update(0);
  ctx.dynamic.push(update);
  ctx.onMood(name => {
    const look = WATER_MOODS[name] ?? WATER_MOODS.focus;
    material.emissiveIntensity = look.glow;
    mistMaterial.color.set(look.mist);
    mistMaterial.opacity = look.mistOpacity;
  });
  return { update, water, mist, texture };
}

// The falling water in its own frame (mouth at 0, out along +z): a flattened, rounded column that arcs
// out over the stone and down, widening and fading toward the bottom. Rows bunch up near the top, where
// it curves over. u goes round, v down; vertex colours carry the fade in their alpha.
export function fallShape(width, drop) {
  const positions = [], colours = [], uvs = [], index = [];
  const foam = new THREE.Color('#ffffff'), light = new THREE.Color('#c8f1ff'), deep = new THREE.Color('#86d8fb'), c = new THREE.Color();
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS, d = drop * s * s;
    const out = 0.06 + 0.32 * Math.sqrt(d), w = width * (1 + 0.5 * s), thick = width * (0.45 + 0.3 * s);
    const alpha = 0.88 * (1 - THREE.MathUtils.smoothstep(s, 0.35, 1));
    for (let j = 0; j <= AROUND; j++) {
      const a = j / AROUND * Math.PI * 2;
      positions.push(Math.cos(a) * w / 2, 0.012 - d, out + Math.sin(a) * thick / 2);
      uvs.push(j / AROUND, 1 - s);
      c.copy(deep).lerp(light, 0.45).lerp(foam, Math.max(0, 1 - s * 6));
      colours.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < AROUND; j++) {
    const a = i * (AROUND + 1) + j, b = a + 1, cc = a + AROUND + 1, dd = cc + 1;
    index.push(a, b, cc, b, dd, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Soft lengthwise streaks: lighter and darker bands that wrap seamlessly both ways. Made from numbers
// (no canvas), one copy per page; each waterfall clones it for its own offset (the image is shared).
let streaks = null;
export function streakTexture() {
  if (streaks) return streaks;
  const W = 16, H = 64, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H, u = x / W, k = (x * 7) % W / W;
    const band = 0.5 + 0.3 * Math.sin(2 * Math.PI * (2 * v + k)) + 0.2 * Math.sin(2 * Math.PI * (3 * v + 2 * u + k * 2));
    const i = (y * W + x) * 4, light = 205 + Math.round(50 * band), alpha = 170 + Math.round(85 * band);
    data[i] = light; data[i + 1] = light; data[i + 2] = 255; data[i + 3] = alpha;
  }
  streaks = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  streaks.wrapS = streaks.wrapT = THREE.RepeatWrapping;
  streaks.magFilter = streaks.minFilter = THREE.LinearFilter;
  streaks.colorSpace = THREE.SRGBColorSpace;
  streaks.needsUpdate = true;
  streaks.userData.shared = true; // never disposed with a scene
  return streaks;
}
