// Natural kinds the layout scatters: tree, rock, bush, flower, pile, fire, seat, mushroom, crystal,
// plus the tiny lawn decorations. Every model has the same signature: (ctx, thing, base), where base
// is the thing's ground point at the middle of its footprint, already turned to face its way.
// Local +z is the thing's front. See models/index.js for what ctx offers.
import * as THREE from 'three';
import { P } from '../style.js';
import { Batch, hash01, hashString, place } from '../ground.js';
import { chunk, crystalGeometry, glowTexture, logGeometry, rbox, teardrop } from '../parts.js';

const R = 2; // rounded-box segments
const seedOf = thing => hashString(thing.id) * 1000;

// ---------- Rare looks ----------
// Little surprises that make a player smile when they notice them. They are look-only: nothing is
// saved. Each look is picked from the thing's own id with its own pick name (`${id}:<look>`), so the
// same id always gives the same look, and a new look never changes an older pick (pine, colours).
// The shapes are reused or swapped, so the triangle count barely moves. Shares are rough; tune them by
// eye in the gallery (development-tools/game-gallery/views/variety.js). Tested in scene/variety.test.js.
// The looks apply to ids that already exist, so some trees and rocks already standing changed look
// once when they arrived.
export const RARE = {
  blossom: 1 / 10, // round trees: a pale pink crown
  autumn: 1 / 13, // round trees: a warm orange crown (blossom wins when both come up: about 1 in 14)
  nest: 1 / 20, // trees: a bird nest with two eggs on a branch
  moss: 1 / 4, // rocks: a green moss cap
  door: 1 / 40, // rocks: a tiny round door
  bluecap: 1 / 6, // mushrooms: blue caps
  glowcap: 1 / 30, // mushrooms: pale caps that glow softly in the evening (wins over blue)
  fairyring: 1 / 12, // decoration mushrooms: a ring of six small caps instead of three
  rose: 1 / 20, // crystals: rose pink
  birdbath: 1 / 12, // flower spots: a stone bird bath instead of flowers
  bird: 1 / 3, // bird baths: a little bird on the rim that dips its head about every 20 seconds
  sunflowers: 1 / 8, // flower spots (not bird baths): two or three tall sunflowers among the daisies
  stripes: 1 / 3, // windmills: red and cream striped sails (making.js)
};
// A thing's roll for one look, 0..1. It has the look when the roll is under RARE[look].
export const lookRoll = (thing, look) => hashString(`${thing.id}:${look}`);
export const rare = (thing, look) => lookRoll(thing, look) < RARE[look];
// Where a roll that came up falls inside its look's share, 0..1: for a second choice within the look.
const within = (thing, look) => lookRoll(thing, look) / RARE[look];

const LOOK = {
  blossom: ['#ffc4da', '#ffd5e5', '#ffb3cd'], blossomDot: '#ff7fa8',
  autumn: ['#ff9636', '#ffb444', '#f2772b'], autumnDot: '#e9453f',
  nest: '#a26d45', nestFloor: '#7d5034', egg: '#9fdcff',
  moss: '#79cf57', door: '#e9553f', knob: '#ffcf3a',
  blueCap: '#4f8dff', glowCap: '#a6f2ff',
  rose: '#ff5f8f', roseLight: '#ffc9da',
  petal: '#ffcc22', seeds: '#7a4a24',
  water: '#8fd8ff',
  birds: [['#4f9bff', '#fff1d6'], ['#ff5a4f', '#ffd9c2'], ['#ffd23f', '#fff6d6']], // [body, breast]
  beak: '#ff9d2e',
};

// The local direction of the camera from a thing: world +z (Today looks from the south), turned back
// by the thing's own yaw. Details meant to be seen go on that side.
const towardCamera = thing => -(Number.isFinite(thing.yaw) ? thing.yaw : 0);

// Where a ray from outside first meets some parts, in the model's own frame. parts: [[geometry, local]].
// Returns { point, normal, part } or null. Used to set a detail into a lumpy, faceted surface.
const rayMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function hitAlong(parts, from, dir) {
  const meshes = parts.map(([geometry, local], part) => {
    const mesh = new THREE.Mesh(geometry, rayMaterial);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(local);
    mesh.matrixWorld.copy(local);
    mesh.userData.part = part;
    return mesh;
  });
  const [hit] = new THREE.Raycaster(from, dir.clone().normalize()).intersectObjects(meshes, false);
  if (!hit) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (normal.dot(dir) > 0) normal.negate();
  return { point: hit.point, normal, part: hit.object.userData.part };
}

// A ray in toward the point (0, y, 0) from angle a (0 is local +z), coming down from `rise` radians above
// level. out: the level way outward.
function inward(parts, a, y, rise = 0) {
  const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  const from = out.clone().multiplyScalar(Math.cos(rise)).setY(Math.sin(rise));
  return { out, hit: hitAlong(parts, from.clone().multiplyScalar(2).add(new THREE.Vector3(0, y, 0)), from.negate()) };
}

// A rod from a to b (local points).
function rod(ctx, base, a, b, r0, r1, colour) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const local = new THREE.Matrix4().compose(from.add(to).multiplyScalar(0.5), turn, new THREE.Vector3(1, 1, 1));
  ctx.add(new THREE.CylinderGeometry(r1, r0, dir.length(), 5, 1, true), 'facet', colour, local, base, false);
}

// A chunky twig nest with two pale blue eggs, sitting on a short branch. at: the nest's middle
// (local); out: the way the branch points, away from the trunk.
function nest(ctx, base, at, out) {
  const [x, y, z] = at;
  rod(ctx, base, [x - out.x * 0.16, y - 0.1, z - out.z * 0.16], [x + out.x * 0.05, y - 0.02, z + out.z * 0.05], 0.026, 0.016, P.trunk);
  ctx.add(new THREE.TorusGeometry(0.07, 0.034, 4, 8).rotateX(Math.PI / 2), 'facet', LOOK.nest, place(x, y, z, { ry: x * 9 }), base, false);
  ctx.add(new THREE.IcosahedronGeometry(0.075, 0).scale(1, 0.4, 1), 'facet', LOOK.nestFloor, place(x, y - 0.012, z), base, false);
  for (const k of [-1, 1]) ctx.add(new THREE.IcosahedronGeometry(0.027, 0).scale(1, 1.25, 1), 'facet', LOOK.egg, place(x + k * 0.024, y + 0.016, z + k * 0.01), base, false);
}

function roundTree(ctx, thing, base, s, seed, crown) {
  ctx.add(new THREE.CylinderGeometry(0.05, 0.085, 0.55, 7), 'facet', P.trunk, place(0, 0.27, 0), base);
  const leaves = crown ? LOOK[crown] : P.leaf;
  const clumps = [[0, 0.78, 0, 0.37], [0.21, 0.62, 0.12, 0.26], [-0.21, 0.64, 0.06, 0.26], [0.03, 1.03, -0.04, 0.25]]
    .map(([x, y, z, r], i) => [chunk(r * s, i + seed, [1, 0.9, 1], i ? 0 : 1, i ? 0.1 : 0.13), place(x * s, y * s, z * s, { ry: i * 0.9 + seed })]);
  // The nest sits on the crown's shoulder towards the camera, a little to one side, half in the leaves
  // (lower down, the crown's overhang hides it from Today's camera).
  if (rare(thing, 'nest')) {
    const { out, hit } = inward(clumps, towardCamera(thing) + (within(thing, 'nest') - 0.5) * 1.4, 0.78 * s, 0.45);
    const at = hit ? hit.point.clone().addScaledVector(out, 0.015) : out.clone().multiplyScalar(0.3 * s).setY(0.9 * s);
    nest(ctx, base, [at.x, at.y, at.z], out);
  }
  clumps.forEach(([geometry, local], i) => ctx.add(geometry, 'facet', leaves[i % 3], local, base, false, [0.35 * s, 1.25 * s, 0.8, 1.1]));
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + seed, rr = 0.31 * s;
    ctx.add(new THREE.IcosahedronGeometry(0.038, 0), 'facet', crown ? LOOK[`${crown}Dot`] : P.blossom, place(Math.cos(a) * rr, (0.7 + (i % 2) * 0.22) * s, Math.sin(a) * rr * 0.6 + 0.15 * s), base, false);
  }
}

function pineTree(ctx, thing, base, s, seed) {
  ctx.add(new THREE.CylinderGeometry(0.045, 0.075, 0.4, 7), 'facet', P.trunk, place(0, 0.2, 0), base);
  const tiers = [[0.42, 0.34, 0.5], [0.66, 0.27, 0.42], [0.88, 0.19, 0.34]]
    .map(([y, r, h], i) => [new THREE.ConeGeometry(r * s, h * s, 7), place(0, (y + h / 2 - 0.05) * s, 0, { ry: i * 0.5 + seed })]);
  // The nest rests on the middle tier's slope, just under the top tier's skirt.
  if (rare(thing, 'nest')) {
    const y = 0.7 * s;
    const { out, hit } = inward(tiers, towardCamera(thing) + (within(thing, 'nest') - 0.5) * 1.4, y);
    const at = hit ? hit.point.clone().addScaledVector(out, 0.03) : out.clone().multiplyScalar(0.22 * s);
    nest(ctx, base, [at.x, y + 0.02, at.z], out);
  }
  tiers.forEach(([geometry, local], i) => ctx.add(geometry, 'facet', P.leaf[(i + 2) % 3], local, base, false, [0.3 * s, 1.2 * s, 0.82, 1.1]));
}

// A tiny round door set into a rock's big stone, on the side towards the camera: a red door in a pale
// stone frame, a gold knob and a doorstep. Tries a few angles so a small stone never hides it.
function rockDoor(ctx, thing, base, parts, s) {
  const y = 0.1 * s, aim = towardCamera(thing) + (within(thing, 'door') - 0.5) * 0.6;
  for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    const { out, hit } = inward(parts, aim + turn, y);
    if (!hit || hit.part !== 0) continue;
    // Upright, facing the stone's face, tipped back no more than a little.
    const flat = Math.hypot(hit.normal.x, hit.normal.z);
    const ry = Math.atan2(hit.normal.x, hit.normal.z), tip = Math.min(0.35, Math.max(-0.35, Math.atan2(hit.normal.y, flat)));
    const at = (forward, up = 0, side = 0) => {
      const local = place(hit.point.x, hit.point.y, hit.point.z, { ry, rx: -tip });
      return local.multiply(place(side, up, forward));
    };
    ctx.add(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10).rotateX(Math.PI / 2), 'facet', P.trim, at(0), base, false);
    ctx.add(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 10).rotateX(Math.PI / 2), 'facet', LOOK.door, at(0.016), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.017, 0), 'facet', LOOK.knob, at(0.045, 0, 0.032), base, false);
    ctx.add(chunk(0.06, out.x * 40, [1.3, 0.35, 0.9], 0, 0.1), 'facet', P.stoneDark, place(hit.point.x + out.x * 0.07, 0.008, hit.point.z + out.z * 0.07, { ry }), base, false);
    return;
  }
}

// A low stone bird bath: a foot, a column, a wide bowl with water in it, and a few leaves at its foot.
// Sometimes a little bird perches on the rim and dips its head to drink.
function birdBath(ctx, thing, base) {
  ctx.add(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 8), 'facet', P.stoneDark, place(0, 0.025, 0), base);
  ctx.add(new THREE.CylinderGeometry(0.045, 0.062, 0.18, 8), 'facet', P.stone, place(0, 0.14, 0), base);
  ctx.add(new THREE.CylinderGeometry(0.17, 0.085, 0.075, 10), 'facet', P.stone, place(0, 0.266, 0), base, false);
  ctx.add(new THREE.CircleGeometry(0.135, 10).rotateX(-Math.PI / 2), 'matte', LOOK.water, place(0, 0.305, 0), base, false);
  for (const [x, z] of [[0.13, 0.08], [-0.12, 0.1], [0.02, -0.15]]) ctx.add(chunk(0.06, x * 50, [1, 0.6, 1], 0, 0.1), 'facet', P.leaf[1], place(x, 0.025, z), base, false);
  ctx.blob(base, 0.55);
  if (rare(thing, 'bird')) perchedBird(ctx, thing, base);
}

const BIRD_EVERY = 20; // seconds between dips, roughly
// How far the bird leans in to drink at time t (radians, 0 = sitting up): two quick dips, then still
// until the next turn. Each bird keeps its own time, so a town's birds don't dip together.
export function birdTilt(thing, t) {
  const way = lookRoll(thing, 'bird-way');
  const every = BIRD_EVERY * (0.85 + ((way * 13) % 1) * 0.3);
  const u = ((t + way * every) % every + every) % every;
  return u < 1.8 ? 0.9 * Math.sin(Math.PI * u / 0.9) ** 2 : 0;
}

// The little bird: its own small mesh (not in the island batch) so it can lean, perched on the rim
// side-on to the camera, facing the water. Chunky: about a third of a helper's height.
function perchedBird(ctx, thing, base) {
  const way = lookRoll(thing, 'bird-way');
  const [body, breast] = LOOK.birds[Math.floor(way * LOOK.birds.length) % LOOK.birds.length];
  const side = (way * 7) % 1 < 0.5 ? 1 : -1;
  const a = towardCamera(thing) + side * 1.1; // about 60 degrees round from the front, to one side
  const rim = 0.15, top = 0.304;
  const parts = new Batch();
  const add = (geometry, colour, local) => { parts.add(geometry, 'facet', { color: colour, matrix: local }); geometry.dispose(); };
  add(new THREE.IcosahedronGeometry(0.058, 0).scale(0.85, 0.8, 1.2), body, place(0, 0.05, -0.005));
  add(new THREE.IcosahedronGeometry(0.04, 0), breast, place(0, 0.045, 0.03));
  add(new THREE.IcosahedronGeometry(0.042, 0), body, place(0, 0.11, 0.045));
  add(new THREE.ConeGeometry(0.016, 0.045, 4).rotateX(Math.PI / 2), LOOK.beak, place(0, 0.105, 0.098));
  add(new THREE.ConeGeometry(0.03, 0.08, 4).rotateX(-Math.PI / 2), body, place(0, 0.075, -0.085, { rx: -0.45 }));
  const perch = new THREE.Group(), lean = new THREE.Group();
  base.clone().multiply(place(Math.sin(a) * rim, top, Math.cos(a) * rim, { ry: a + Math.PI })).decompose(perch.position, perch.quaternion, perch.scale);
  perch.add(lean);
  // No shadow, like the windmill's sails: shadows are drawn only when the town or mood changes.
  for (const mesh of parts.build(ctx.materials, lean)) { mesh.castShadow = false; ctx.track(mesh.geometry); }
  ctx.root.add(perch);
  ctx.dynamic.push(t => { lean.rotation.x = birdTilt(thing, t); });
  // The bird is not in the island batch, so tell the camera how high it reaches.
  ctx.batch.top = Math.max(ctx.batch.top, base.elements[13] + top + 0.16);
}

// A tall sunflower: a stem with one leaf and a yellow star of petals round a brown middle, turned to
// face the camera and tipped up towards it.
function sunflower(ctx, thing, base, x, z, h, k) {
  ctx.add(new THREE.CylinderGeometry(0.012, 0.017, h, 5, 1, true), 'matte', P.grassSide, place(x, h / 2, z), base, false);
  ctx.add(chunk(0.05, k * 7 + 1, [1, 0.3, 0.55], 0, 0.08), 'facet', P.leaf[0], place(x + 0.04, h * 0.45, z, { ry: k * 2.1, rz: 0.4 }), base, false);
  const head = place(x, h + 0.01, z, { ry: towardCamera(thing) + (k - 1) * 0.3, rx: 0.9 });
  ctx.add(petalStar(0.082, 0.024, 10), 'facet', LOOK.petal, head, base, false);
  ctx.add(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 7), 'facet', LOOK.seeds, head.clone().multiply(place(0, 0.01, 0)), base, false);
}

// A flat disc whose rim points go in and out: a ring of petals for the price of a plain disc.
function petalStar(r, h, points) {
  const g = new THREE.CylinderGeometry(r, r, h, points * 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
    if (d < r * 0.5) continue;
    const step = Math.round(Math.atan2(x, z) / (Math.PI / points));
    if (step % 2) p.setXYZ(i, x * 0.68, p.getY(i), z * 0.68);
  }
  g.computeVertexNormals();
  return g;
}

// The mushroom look: which colour and material its caps take.
function capLook(thing) {
  if (rare(thing, 'glowcap')) return { colour: LOOK.glowCap, mat: 'shine' };
  if (rare(thing, 'bluecap')) return { colour: LOOK.blueCap, mat: 'facet' };
  return { colour: P.mushroomCap, mat: 'facet' };
}

// A fairy ring: six small capped mushrooms in a circle with an empty middle, each with one white spot.
function fairyRing(ctx, thing, base, seed, cap) {
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + seed, rr = 0.27 + (hash01(k, seed, 5) - 0.5) * 0.04;
    const s = 0.42 + hash01(k, seed, 6) * 0.12, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    const stemH = 0.2 * s, capR = 0.17 * s;
    ctx.add(new THREE.CylinderGeometry(0.045 * s, 0.06 * s, stemH, 6), 'matte', P.mushroomStem, place(x, stemH / 2, z), base);
    ctx.add(new THREE.SphereGeometry(capR, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1), cap.mat, cap.colour, place(x, stemH - 0.01, z, { ry: a }), base, false);
    // A pale underside closes the cap, so its shadow on the grass is a whole round, not a thin curl.
    ctx.add(new THREE.CircleGeometry(capR, 8).rotateX(Math.PI / 2), 'matte', P.mushroomStem, place(x, stemH - 0.01, z, { ry: a }), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.022, 0).scale(1, 0.45, 1), 'matte', P.white, place(x + capR * 0.2, stemH - 0.01 + capR * 0.7, z), base, false);
  }
  ctx.blob(base, 0.85);
}

export const NATURE = {
  // Faceted trees: mostly round with white blossoms, sometimes a stacked pine. The old (first) tree is always round.
  // Rarely a round tree's crown is blossom pink or autumn orange, and rarely a tree holds a nest. Each
  // island's first tree keeps its green crown: its id is the same in every town (home:tree would be
  // orange for everyone).
  tree(ctx, thing, base) {
    const seed = seedOf(thing);
    const s = 0.9 + hash01(thing.c, thing.r, 2) * 0.3;
    const crown = thing.old ? null : rare(thing, 'blossom') ? 'blossom' : rare(thing, 'autumn') ? 'autumn' : null;
    if (!thing.old && hashString(`${thing.id}:pine`) < 0.3) pineTree(ctx, thing, base, s, seed);
    else roundTree(ctx, thing, base, thing.old ? 1.12 : s, seed, crown);
    ctx.blob(base, 0.95 * s);
  },

  // Angular grey-lilac rocks: a big chunk and two small ones with broad flat faces. Rarely the big one
  // wears a green moss cap, and very rarely it has a tiny round door.
  rock(ctx, thing, base) {
    const seed = seedOf(thing);
    const s = 0.95 + hash01(thing.c, thing.r, 3) * 0.2;
    const parts = [
      [0, 0.17, 0, 0.3, [1.2, 0.74, 1], P.boulder],
      [0.26, 0.1, 0.12, 0.17, [1, 0.85, 1.1], P.lilac],
      [-0.22, 0.08, 0.15, 0.13, [1.1, 0.8, 1], P.stoneDark],
    ].map(([x, y, z, r, squash, color], i) => [chunk(r * s, seed + i * 7 + 1, squash, 0, 0.18),
      place(x * s, y * s, z * s, { ry: i * 1.3 + seed, rz: (i - 1) * 0.15 }), color]);
    if (rare(thing, 'door')) rockDoor(ctx, thing, base, parts, s);
    // The moss cap: a flat green chunk on the big stone's top, in the big stone's own tilt.
    if (rare(thing, 'moss')) ctx.add(chunk(0.21 * s, seed + 5, [1.15, 0.42, 1], 0, 0.12), 'facet', LOOK.moss, parts[0][1].clone().multiply(place(0, 0.15 * s, 0)), base, false, [0, 0.45, 0.88, 1.06]);
    parts.forEach(([geometry, local, color]) => ctx.add(geometry, 'facet', color, local, base, true, [0, 0.45, 0.88, 1.06]));
    ctx.blob(base, 0.95 * s, 0.8 * s, 0, 0.03);
  },

  bush(ctx, thing, base) {
    const seed = seedOf(thing);
    for (const [x, z, r, i] of [[0, 0, 0.2, 0], [0.17, 0.08, 0.15, 1], [-0.15, 0.07, 0.14, 2]]) {
      ctx.add(chunk(r, i + seed, [1, 0.85, 1], 1, 0.08), 'facet', P.leaf[i % 3], place(x, r * 0.8, z, { ry: i }), base, true, [0, 0.4, 0.8, 1.1]);
    }
    const berry = P.flower[1 + Math.floor(hashString(thing.id) * 3) % 3];
    for (const [x, y, z] of [[0.05, 0.3, 0.14], [-0.1, 0.22, 0.17], [0.19, 0.2, 0.17]]) ctx.add(new THREE.IcosahedronGeometry(0.032, 0), 'facet', berry, place(x, y, z), base, false);
    ctx.blob(base, 0.7);
  },

  // A patch of daisies in two or three colours. Rarely a bird bath stands there instead, and now and
  // then two or three tall sunflowers grow at the back of the patch, in place of daisies.
  flower(ctx, thing, base) {
    if (rare(thing, 'birdbath')) { birdBath(ctx, thing, base); return; }
    const seed = hashString(thing.id);
    const colours = [P.flower[Math.floor(seed * 5) % 5], P.flower[(Math.floor(seed * 5) + 2) % 5], P.white];
    const spots = [[-0.15, -0.1], [0.12, -0.14], [0.02, 0.04], [-0.13, 0.16], [0.17, 0.12], [0.0, -0.22], [-0.2, 0.0]];
    // The sunflowers take the spots farthest from the camera, so they hide no daisies.
    const tall = rare(thing, 'sunflowers') ? (within(thing, 'sunflowers') < 0.5 ? 2 : 3) : 0;
    const yaw = Number.isFinite(thing.yaw) ? thing.yaw : 0;
    const back = spots.map(([x, z], i) => [i, z * Math.cos(yaw) - x * Math.sin(yaw)]).sort((a, b) => a[1] - b[1]).slice(0, tall).map(([i]) => i);
    spots.forEach(([x, z], i) => {
      const k = back.indexOf(i);
      if (k >= 0) { sunflower(ctx, thing, base, x, z, 0.34 + k * 0.05, k); return; }
      const h = 0.09 + hash01(i, seed * 9, 4) * 0.06;
      ctx.add(new THREE.CylinderGeometry(0.008, 0.01, h, 4), 'matte', P.grassSide, place(x, h / 2, z), base, false);
      ctx.add(new THREE.CylinderGeometry(0.048, 0.04, 0.018, 7), 'facet', colours[i % 3], place(x, h + 0.008, z, { rx: 0.25, ry: i }), base, false);
      ctx.add(new THREE.IcosahedronGeometry(0.018, 0), 'facet', '#ffcf3a', place(x, h + 0.022, z), base, false);
    });
    for (const [x, z] of [[0.08, 0.2], [-0.06, -0.06], [0.2, -0.02]]) ctx.add(chunk(0.06, x * 50, [1, 0.6, 1], 0, 0.1), 'facet', P.leaf[1], place(x, 0.025, z), base, false);
  },

  // Storage pile: stacked logs, a few stones and planks on a little pallet.
  pile(ctx, thing, base) {
    ctx.add(rbox(0.5, 0.04, 0.42, 0.006, R), 'matte', P.plankDark, place(-0.03, 0.02, 0), base);
    for (const [x, y, z] of [[-0.05, 0.1, -0.08], [-0.05, 0.1, 0.08], [-0.05, 0.22, 0]]) ctx.add(logGeometry(0.42, 0.065, P.log, P.logCut, 8), 'facet', null, place(x, y, z), base);
    for (const [x, z, r, color] of [[0.27, 0.12, 0.08, P.lilac], [0.3, -0.05, 0.065, P.stone], [0.22, 0.02, 0.05, P.boulder]]) ctx.add(chunk(r, x * 10), 'facet', color, place(x, r * 0.7, z), base);
    for (let i = 0; i < 2; i++) ctx.add(rbox(0.4, 0.035, 0.1, 0.005, R), 'matte', i ? P.plank : P.plankDark, place(-0.05, 0.02 + i * 0.035, -0.25, { ry: i * 0.15 }), base);
    ctx.blob(base, 0.75);
  },

  // Campfire: stone ring and log teepee. Lit in break, low when away, embers at night, cold by day.
  fire(ctx, thing, base) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      ctx.add(chunk(0.055, i * 3 + 1, [1, 0.7, 1]), 'facet', i % 2 ? P.stone : P.trim, place(Math.cos(a) * 0.19, 0.035, Math.sin(a) * 0.19, { ry: i }), base);
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.3;
      ctx.add(logGeometry(0.26, 0.03, P.log, P.logCut, 6), 'facet', null, place(Math.cos(a) * 0.05, 0.07, Math.sin(a) * 0.05, { ry: -a, rz: 0.55 }), base);
    }
    const at = new THREE.Vector3().setFromMatrixPosition(base);
    // The ash bed changes colour with the mood, so it is its own small mesh.
    const bedMaterial = new THREE.MeshStandardMaterial({ color: P.ash, roughness: 0.9, emissive: '#ff7a3a', emissiveIntensity: 0 });
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 16), bedMaterial);
    bed.position.set(at.x, at.y + 0.011, at.z);
    bed.receiveShadow = true;
    const flames = new THREE.Group();
    flames.position.set(at.x, at.y + 0.03, at.z);
    const shape = teardrop(0.34, 0.09, 14);
    const parts = [[1, '#ff7a3a', 0, 0, 0], [0.7, '#ff9d3f', 0.05, 0.03, -0.35], [0.66, '#ff9d3f', -0.05, 0.02, 0.35], [0.5, '#ffe28a', 0, 0.05, 0]].map(([s, color, x, z, tilt]) => {
      const material = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(shape, material);
      mesh.position.set(x, 0, z); mesh.rotation.z = tilt; mesh.scale.setScalar(s); mesh.userData.s = s;
      flames.add(mesh);
      ctx.track(material);
      return mesh;
    });
    // Warm light pooled on the grass (a flat soft disc, so it never cuts a hard line where it meets
    // the ground), and a small halo around the flames that stays clear of the ground.
    const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff7f30', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glowShape = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const glow = new THREE.Mesh(glowShape, glowMaterial);
    glow.position.set(at.x, at.y + 0.02, at.z);
    glow.renderOrder = 2;
    const haloMaterial = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a50', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.set(at.x, at.y + 0.3, at.z);
    halo.scale.setScalar(0.42);
    halo.renderOrder = 2;
    const light = new THREE.PointLight('#ff9550', 0, 3.0, 1.8);
    light.position.set(at.x, at.y + 0.45, at.z);
    ctx.root.add(bed, flames, glow, halo, light);
    ctx.track(bedMaterial, bed.geometry, shape, glowMaterial, glowShape, haloMaterial);
    let level = 0, size = 1;
    ctx.onMood((name, mood) => {
      level = { lit: 1, low: 0.6, embers: 0.2, out: 0 }[mood.fire] ?? 0;
      size = mood.fire === 'low' ? 0.62 : 1;
      flames.visible = level >= 0.5;
      flames.scale.setScalar(size);
      glow.visible = level > 0;
      glow.scale.setScalar(level >= 0.5 ? 1.9 * size : 0.9);
      glowMaterial.opacity = level >= 0.5 ? 0.3 : 0.26;
      halo.visible = level >= 0.5;
      bedMaterial.color.set(level > 0 ? P.ember : P.ash);
      bedMaterial.emissiveIntensity = level > 0 ? 0.35 + level * 0.5 : 0;
      light.intensity = level >= 0.5 ? 2.2 * size : level * 1.6;
      light.visible = level > 0;
    });
    ctx.dynamic.push(t => {
      if (!flames.visible) return;
      parts.forEach((m, i) => m.scale.set(m.userData.s * (1 + Math.sin(t * 8 + i) * 0.06), m.userData.s * (1 + Math.sin(t * 10.5 + i * 2) * 0.16), m.userData.s));
      light.intensity = (2.2 + Math.sin(t * 11) * 0.35 + Math.sin(t * 6.3) * 0.25) * size;
    });
  },

  // A log to sit on. It lies across the thing's facing, so a sitter faces the way the seat faces.
  seat(ctx, thing, base) {
    // A chunky log resting slightly into the grass (its top is at sitting height), with a soft shadow.
    ctx.add(logGeometry(0.44, 0.068, P.log, P.logCut, 9), 'facet', null, place(0, 0.052, 0), base);
    ctx.blob(base, 0.66, 0.4, 0, 0.02);
    ctx.blob(base, 0.5, 0.26, 0, 0.02);
  },

  // Bright red-capped mushrooms with white spots, one big and two small. Rarely the caps are blue, or
  // pale and softly glowing in the evening (the crystals' shine material: no lights), and rarely a
  // decoration mushroom is a fairy ring of six small caps instead.
  mushroom(ctx, thing, base) {
    const seed = seedOf(thing);
    const look = capLook(thing);
    if (String(thing.id).includes(':decor-') && rare(thing, 'fairyring')) { fairyRing(ctx, thing, base, seed, look); return; }
    const caps = [[0, 0, 1, 0], [0.18, 0.1, 0.62, 0.4], [-0.15, 0.12, 0.5, -0.3]];
    caps.forEach(([x, z, s, tilt], i) => {
      const stemH = 0.2 * s, capR = 0.17 * s;
      ctx.add(new THREE.CylinderGeometry(0.045 * s, 0.06 * s, stemH, 8), 'matte', P.mushroomStem, place(x, stemH / 2, z, { rz: tilt * 0.3 }), base);
      const cap = new THREE.SphereGeometry(capR, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1);
      ctx.add(cap, look.mat, look.colour, place(x + tilt * 0.03, stemH - 0.01, z, { rz: tilt * 0.3, ry: seed + i }), base, false);
      ctx.add(new THREE.CylinderGeometry(capR * 0.98, capR * 0.9, 0.02, 10), 'matte', P.mushroomStem, place(x + tilt * 0.03, stemH - 0.005, z, { rz: tilt * 0.3 }), base, false);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.6 + seed + i, rr = capR * 0.55;
        ctx.add(new THREE.SphereGeometry(0.022 * s + 0.008, 6, 4).scale(1, 0.45, 1), 'matte', P.white,
          place(x + tilt * 0.03 + Math.cos(a) * rr, stemH + capR * 0.52 - (k ? 0.012 : -0.01), z + Math.sin(a) * rr, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }), base, false);
      }
    });
    ctx.blob(base, 0.6);
  },

  // A cluster of glowing crystals on a rocky base. Rarely rose pink, with blush spikes for white.
  crystal(ctx, thing, base) {
    const seed = seedOf(thing);
    const rose = rare(thing, 'rose');
    const colour = rose ? LOOK.rose : P.crystal[Math.floor(hashString(thing.id) * 3) % 3];
    ctx.add(chunk(0.2, seed, [1.3, 0.5, 1.1]), 'facet', P.lilacDeep, place(0, 0.05, 0), base);
    const spikes = [[0, 0, 0.62, 0.09, 0, 0], [0.13, 0.05, 0.4, 0.065, 0.35, 0.2], [-0.12, 0.07, 0.36, 0.06, -0.4, -0.1], [0.04, -0.12, 0.3, 0.055, 0.15, -0.45]];
    spikes.forEach(([x, z, h, r, rz, rx], i) => ctx.add(crystalGeometry(h, r), 'shine', i % 2 ? (rose ? LOOK.roseLight : P.white) : colour, place(x, 0.04, z, { rz, rx, ry: seed + i }), base, false));
    ctx.blob(base, 0.6);
  },
};

// Tiny lawn decorations on free grass: a little flower or a grass tuft. roll is 0..1.
export function decor(ctx, base, roll) {
  if (roll < 0.55) {
    const color = P.flower[Math.floor(roll * 9) % 3];
    ctx.add(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), 'matte', P.grassSide, place(0, 0.05, 0), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.042, 0), 'facet', color, place(0, 0.11, 0), base, false);
  } else {
    ctx.add(chunk(0.1, roll * 20, [1, 0.75, 1], 1, 0.08), 'facet', P.leaf[1], place(0, 0.06, 0), base, true, [0, 0.14, 0.85, 1.1]);
  }
}
