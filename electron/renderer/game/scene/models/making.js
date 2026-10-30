// Making buildings: sawmill, workshop, windmill, Lookout tower, Crystal forge, Mist loom and Stone
// quarry. Every model has the signature (ctx, thing, base); see models/index.js for what ctx offers.
// All of these fill a 2 x 2 footprint (1.2 x 1.2 units, so x and z run from -0.6 to 0.6) and face
// local +z. Each keeps to one or two strong colours with white trim, so it reads from the high
// camera at a small size. Nothing moves except the windmill's sails, which turn very slowly.
import * as THREE from 'three';
import { P } from '../style.js';
import { Batch, hashString, place } from '../ground.js';
import { chunk, crystalGeometry, logGeometry, rbox } from '../parts.js';
import { addDoor, addRoof, addWindow } from './buildings.js';
import { rare } from './nature.js';

const R = 2; // rounded-box segments
const E = 0.012; // edge rounding: a sliver, not pillowy
const QUARTER = Math.PI / 2;
const WIND = 0.35; // the way every windmill's sails face, in world terms (0 faces the camera)

const C = {
  sawRoof: '#2fb8a5',
  shopWall: '#5cc9a7', shopRoof: '#ff8a3d', shopDoor: '#c48a5f', toolbox: '#ff4f5e',
  millBody: '#fff1cf', millCap: '#5b6fd6', millDoor: '#e9553f',
  towerWall: '#b9a8f5', towerRoof: '#f5b52e', flag: '#ff4f5e',
  forgeRoof: '#8a7be0', forgeFire: '#ffa25a', anvil: '#8f98b3',
  loomRoof: '#e58fd0', cloth: ['#fffaf5', '#ffbfdc', '#fffaf5', '#b8ecd8', '#fffaf5', '#d6c6ff'], yarn: ['#ff9cc0', '#b99cff', '#8fe0c0'],
  crane: '#ffcf2e', lantern: '#ffd27a',
};

// A box with a sliver of rounding, placed by its centre.
function box(ctx, base, [w, h, d], [x, y, z], colour, { mat = 'matte', ao = true, r = E, ...turn } = {}) {
  ctx.add(rbox(w, h, d, r, R), mat, colour, place(x, y, z, turn), base, ao);
}

// A post standing on y0 (default the ground), h tall.
function post(ctx, base, x, z, h, colour = P.post, { size = 0.07, y0 = 0 } = {}) {
  box(ctx, base, [size, h, size], [x, y0 + h / 2, z], colour);
}

// A thin bar or rope from point a to point b (local coordinates).
function strut(ctx, base, a, b, size, colour, { rope = false, ao = false } = {}) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from), length = dir.length();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const local = new THREE.Matrix4().compose(from.add(to).multiplyScalar(0.5), turn, new THREE.Vector3(1, 1, 1));
  const geometry = rope ? new THREE.CylinderGeometry(size / 2, size / 2, length, 5) : rbox(size, length, size, 0.006, 1);
  ctx.add(geometry, 'matte', colour, local, base, ao);
}

// A turned base: the same spot, rotated about the vertical by a.
const turned = (base, a) => base.clone().multiply(place(0, 0, 0, { ry: a }));

// A small lantern hanging from a bracket: a warm pane that glows in the evening.
function lantern(ctx, base, x, y, z) {
  box(ctx, base, [0.07, 0.025, 0.07], [x, y + 0.055, z], P.trim, { ao: false, r: 0.006 });
  box(ctx, base, [0.05, 0.08, 0.05], [x, y, z], C.lantern, { mat: 'glow', ao: false, r: 0.008 });
  box(ctx, base, [0.06, 0.02, 0.06], [x, y - 0.048, z], P.trim, { ao: false, r: 0.006 });
}

// A neat stack of planks lying along x: layers of three, each layer a touch lighter or darker.
function plankStack(ctx, base, x, z, { layers = 4, length = 0.4, y0 = 0 } = {}) {
  for (let i = 0; i < layers; i++) {
    for (const k of [-1, 0, 1]) box(ctx, base, [length - (i % 2) * 0.02, 0.034, 0.086], [x + (i % 2) * 0.01, y0 + 0.017 + i * 0.036, z + k * 0.092], i % 2 ? P.plank : P.plankDark, { r: 0.005 });
  }
}

// A round saw blade in the x-y plane, with teeth around the rim.
function sawBlade(radius, teeth = 16, thickness = 0.016) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i / teeth * Math.PI * 2, b = (i + 0.6) / teeth * Math.PI * 2;
    const tip = [Math.cos(a) * radius, Math.sin(a) * radius], root = [Math.cos(b) * radius * 0.86, Math.sin(b) * radius * 0.86];
    if (i) shape.lineTo(...tip); else shape.moveTo(...tip);
    shape.lineTo(...root);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
}

// A sail cloth in bands across its length, coloured face by face so the stripes stay crisp. A plain
// box split into bands: fewer triangles than the rounded cloth it stands in for.
function stripedCloth(w, h, d, colours) {
  const g = new THREE.BoxGeometry(w, h, d, 1, colours.length, 1).toNonIndexed();
  const p = g.attributes.position, rgb = new Float32Array(p.count * 3), colour = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    colour.set(colours[Math.min(colours.length - 1, Math.max(0, Math.floor((y / h + 0.5) * colours.length)))]);
    for (let k = 0; k < 3; k++) rgb.set([colour.r, colour.g, colour.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return g;
}

// A little pennant: a flat triangle in the x-y plane, pointing along +x from the pole at x = 0.
function pennant(length, height, thickness = 0.012) {
  const shape = new THREE.Shape([new THREE.Vector2(0, -height / 2), new THREE.Vector2(length, 0), new THREE.Vector2(0, height / 2)]);
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
}

export const MAKING = {
  // An open-sided shed with a teal roof over neat plank stacks and a short log pile. In front of it,
  // a saw bench with a big round blade, a log fed into it and fresh planks coming out. The front strip
  // stays clear for the helper who saws there.
  sawmill(ctx, thing, base) {
    const shed = base.clone().multiply(place(0, 0, -0.15));
    // A pale stone floor, so the wood stacked on it stands out.
    box(ctx, shed, [1.04, 0.05, 0.74], [0, 0.025, 0], P.stone, { r: 0.015 });
    // Posts, top beams and knee braces.
    const top = 0.7;
    for (const x of [-0.46, 0.46]) for (const z of [-0.3, 0.3]) post(ctx, shed, x, z, top, P.post, { y0: 0.04 });
    for (const x of [-0.46, 0.46]) box(ctx, shed, [0.08, 0.07, 0.68], [x, top + 0.01, 0], P.post);
    for (const z of [-0.3, 0.3]) box(ctx, shed, [0.98, 0.07, 0.08], [0, top + 0.01, z], P.post);
    for (const s of [-1, 1]) strut(ctx, shed, [s * 0.46, top - 0.2, 0.3], [s * 0.3, top - 0.02, 0.3], 0.04, P.post);
    addRoof(ctx, shed, { w: 0.92, d: 0.6, top: top + 0.04, roof: C.sawRoof, wall: P.plank, chimney: false, gableWindow: false });
    // Under the roof: planks on the left, logs waiting on the right.
    plankStack(ctx, shed, -0.2, -0.08, { layers: 4, length: 0.4, y0: 0.05 });
    for (const [x, y, z] of [[0.24, 0.115, -0.15], [0.24, 0.115, 0.0], [0.24, 0.21, -0.075]]) ctx.add(logGeometry(0.36, 0.062, P.log, P.logCut, 9), 'facet', null, place(x, y, z), shed);
    // The saw bench in front of the shed.
    const z = 0.3;
    box(ctx, base, [0.84, 0.18, 0.15], [0, 0.09, z], P.plankDark);
    box(ctx, base, [0.9, 0.035, 0.19], [0, 0.195, z], P.plank, { r: 0.008 });
    ctx.add(sawBlade(0.19, 18), 'matte', P.steel, place(0.08, 0.23, z), base, false);
    for (const s of [-1, 1]) ctx.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12).rotateX(QUARTER), 'matte', '#e9553f', place(0.08, 0.23, z + s * 0.012), base, false);
    ctx.add(logGeometry(0.32, 0.06, P.log, P.logCut, 9), 'facet', null, place(-0.27, 0.272, z), base);
    for (const k of [0, 1]) box(ctx, base, [0.18, 0.026, 0.09], [0.36, 0.226 + k * 0.028, z + (k ? 0.01 : -0.01)], k ? P.plank : P.plankDark, { r: 0.005, ry: k * 0.08 });
    lantern(ctx, shed, 0.46, top - 0.12, 0.355);
    ctx.blob(base, 1.25, 1.1, 0, -0.05);
  },

  // A sturdy mint-green workshop on a stone footing under a wide orange gable with a white gear in it,
  // wide braced barn doors, a tool board on the wall and a workbench with a red toolbox outside.
  workshop(ctx, thing, base) {
    const shop = base.clone().multiply(place(0, 0, -0.07));
    const w = 0.98, d = 0.76, wallH = 0.78, front = d / 2;
    ctx.add(rbox(w, wallH, d, E, R), 'matte', C.shopWall, place(0, wallH / 2 + 0.02, 0), shop);
    box(ctx, shop, [w + 0.06, 0.16, d + 0.06], [0, 0.08, 0], P.stone);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(ctx, shop, [0.05, wallH - 0.16, 0.05], [sx * w / 2, wallH / 2 + 0.08, sz * d / 2], P.trim, { ao: false, r: 0.008 });
    box(ctx, shop, [w + 0.03, 0.045, d + 0.03], [0, wallH - 0.005, 0], P.trim, { ao: false, r: 0.008 });
    const rise = addRoof(ctx, shop, { w, d, top: wallH + 0.02, roof: C.shopRoof, wall: C.shopWall, gableWindow: false });
    // A white gear in the gable: the workshop's sign.
    const gy = wallH + 0.02 + rise * 0.42;
    ctx.add(sawBlade(0.08, 8, 0.03), 'matte', P.trim, place(0, gy, front + 0.01), shop, false);
    ctx.add(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 12).rotateX(QUARTER), 'matte', C.shopRoof, place(0, gy, front + 0.015), shop, false);
    // Wide barn doors: two wooden leaves with white braces in a white frame.
    const dx = -0.17;
    box(ctx, shop, [0.52, 0.52, 0.035], [dx, 0.27, front + 0.01], P.trim);
    for (const s of [-1, 1]) {
      box(ctx, shop, [0.205, 0.44, 0.045], [dx + s * 0.107, 0.24, front + 0.02], C.shopDoor);
      box(ctx, shop, [0.03, 0.44, 0.05], [dx + s * 0.107, 0.24, front + 0.025], P.trim, { rz: s * 0.42, ao: false, r: 0.006 });
    }
    box(ctx, shop, [0.012, 0.44, 0.05], [dx, 0.24, front + 0.025], P.plankDark, { ao: false, r: 0.004 });
    // Tool board with a saw and a hammer above the bench.
    const tx = 0.29;
    box(ctx, shop, [0.3, 0.22, 0.02], [tx, 0.47, front + 0.012], P.plank, { ao: false, r: 0.006 });
    box(ctx, shop, [0.15, 0.055, 0.012], [tx - 0.05, 0.5, front + 0.028], P.steel, { rz: 0.12, ao: false, r: 0.004 });
    box(ctx, shop, [0.05, 0.05, 0.018], [tx + 0.04, 0.51, front + 0.03], C.toolbox, { ao: false, r: 0.006 });
    box(ctx, shop, [0.022, 0.13, 0.016], [tx + 0.1, 0.43, front + 0.03], P.handle, { ao: false, r: 0.004 });
    box(ctx, shop, [0.075, 0.032, 0.022], [tx + 0.1, 0.495, front + 0.032], P.steel, { ao: false, r: 0.005 });
    // Side and back windows, so the workshop still reads when turned.
    for (const turn of [QUARTER, -QUARTER]) addWindow(ctx, turned(shop, turn), 0, 0.46, w / 2, 0.2);
    addWindow(ctx, turned(shop, Math.PI), 0, 0.46, d / 2, 0.2);
    // Workbench outside, under the eave.
    const bz = front + 0.12;
    box(ctx, shop, [0.4, 0.04, 0.15], [tx, 0.2, bz], P.plank, { r: 0.006 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, shop, tx + sx * 0.17, bz + sz * 0.05, 0.18, P.post, { size: 0.03 });
    box(ctx, shop, [0.12, 0.06, 0.07], [tx - 0.09, 0.25, bz], C.toolbox, { r: 0.008 });
    box(ctx, shop, [0.06, 0.012, 0.012], [tx - 0.09, 0.288, bz], P.trim, { r: 0.004, ao: false });
    box(ctx, shop, [0.16, 0.022, 0.06], [tx + 0.08, 0.231, bz], P.plankDark, { r: 0.005, ry: 0.1 });
    ctx.blob(base, 1.3, 1.15, 0, -0.03);
  },

  // A cream windmill: an eight-sided tapered tower on a stone ring, a blue cap and four white sails
  // that turn very slowly. The sails are their own small mesh so they can turn; everything else is
  // baked with the island. About one windmill in three has red and cream striped sails (a rare look,
  // picked from its id: see RARE in nature.js).
  windmill(ctx, thing, base) {
    const y0 = 0.1, h = 1.0, r0 = 0.42, r1 = 0.3, top = y0 + h;
    const apothem = r => r * Math.cos(Math.PI / 8);
    const radiusAt = y => r0 - (r0 - r1) * (y - y0) / h;
    const tilt = Math.atan((r0 - r1) * Math.cos(Math.PI / 8) / h);
    const octagon = (rt, rb, height) => new THREE.CylinderGeometry(rt, rb, height, 8).rotateY(Math.PI / 8);
    ctx.add(octagon(0.5, 0.52, y0), 'facet', P.stone, place(0, y0 / 2, 0), base);
    ctx.add(octagon(r1, r0, h), 'facet', C.millBody, place(0, y0 + h / 2, 0), base);
    for (const [y, r] of [[y0 + 0.02, r0 + 0.012], [top - 0.02, r1 + 0.02]]) ctx.add(octagon(r, r, 0.045), 'facet', P.trim, place(0, y, 0), base, false);
    // Cap: a white rim and a blue eight-sided cone with a small knob.
    ctx.add(octagon(r1 + 0.07, r1 + 0.07, 0.05), 'facet', P.trim, place(0, top + 0.02, 0), base, false);
    ctx.add(new THREE.ConeGeometry(r1 + 0.06, 0.36, 8).rotateY(Math.PI / 8), 'facet', C.millCap, place(0, top + 0.045 + 0.18, 0), base, false);
    ctx.add(new THREE.IcosahedronGeometry(0.035, 0), 'facet', P.trim, place(0, top + 0.43, 0), base, false);
    // Door and windows on the front face, leaning back with the taper.
    const face = (y, s = 1) => base.clone().multiply(place(0, y, apothem(radiusAt(y)), { rx: -tilt, s }));
    addDoor(ctx, face(y0, 0.82), 0, 0, C.millDoor);
    addWindow(ctx, face(0.66), 0, 0, 0, 0.14);
    for (const turn of [QUARTER, -QUARTER, Math.PI]) addWindow(ctx, turned(base, turn).multiply(place(0, 0.62, apothem(radiusAt(0.62)), { rx: -tilt })), 0, 0, 0, 0.13);
    // The cap turns into the wind, like a real mill's, so every windmill's sails face the same way:
    // towards the camera at a slight angle, whichever way its door faces. Seen side-on or from behind
    // the sails would vanish.
    const wind = base.clone().multiply(place(0, 0, 0, { ry: WIND - (thing.facing ?? 0) * QUARTER }));
    const hubY = top + 0.09, hubZ = 0.44;
    ctx.add(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8).rotateX(QUARTER), 'matte', P.post, place(0, hubY, hubZ - 0.12), wind, false);
    // The sails: four arms, each a wooden spar with a white cloth panel and three crossbars.
    const striped = rare(thing, 'stripes');
    const sails = new Batch();
    const add = (geometry, colour, local) => { sails.add(geometry, 'matte', { color: colour, matrix: local }); geometry.dispose(); };
    const arm = 0.55;
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 12).rotateX(QUARTER), C.millDoor, place(0, 0, 0.01));
    for (let i = 0; i < 4; i++) {
      const at = local => place(0, 0, 0, { rz: i * QUARTER }).multiply(local);
      add(rbox(0.045, arm, 0.03, 0.006, 1), P.post, at(place(0, arm / 2, 0)));
      // Three wide bands, swapped on every other sail, so the stripes still show at Today's size.
      if (striped) add(stripedCloth(0.15, 0.38, 0.01, i % 2 ? [C.millBody, C.millDoor, C.millBody] : [C.millDoor, C.millBody, C.millDoor]), null, at(place(0.1, arm - 0.21, -0.012)));
      else add(rbox(0.15, 0.38, 0.01, 0.003, 1), P.trim, at(place(0.1, arm - 0.21, -0.012)));
      add(rbox(0.018, 0.4, 0.018, 0.004, 1), P.post, at(place(0.18, arm - 0.21, -0.004)));
      for (const y of [arm - 0.37, arm - 0.21, arm - 0.05]) add(rbox(0.16, 0.016, 0.016, 0.004, 1), P.post, at(place(0.1, y, -0.002)));
    }
    const pivot = new THREE.Group(), spinner = new THREE.Group();
    wind.clone().multiply(place(0, hubY, hubZ)).decompose(pivot.position, pivot.quaternion, pivot.scale);
    pivot.add(spinner);
    // No shadow from the sails: shadows are drawn again only when the town or mood changes, so a turning
    // sail would leave its shadow standing still.
    for (const mesh of sails.build(ctx.materials, spinner)) { mesh.castShadow = false; ctx.track(mesh.geometry); }
    ctx.root.add(pivot);
    const offset = hashString(thing.id) * QUARTER;
    spinner.rotation.z = offset;
    ctx.dynamic.push(t => { spinner.rotation.z = offset - t * 0.2; });
    // The sails are not in the island batch, so tell the camera how high they reach.
    ctx.batch.top = Math.max(ctx.batch.top, base.elements[13] + hubY + arm);
    ctx.blob(base, 1.15, 1.15);
  },

  // The Lookout tower: a stone foot, a tall lilac shaft, a wooden lookout deck with a white railing,
  // a little lookout under a sunny yellow roof, and a red pennant.
  tower(ctx, thing, base) {
    box(ctx, base, [0.78, 0.08, 0.78], [0, 0.04, 0], P.stoneDark);
    box(ctx, base, [0.66, 0.6, 0.66], [0, 0.38, 0], P.stone);
    // A few raised stones so the foot reads as stonework.
    for (const [x, y, s] of [[-0.18, 0.2, 1], [0.2, 0.52, -1], [-0.22, 0.58, 1]]) box(ctx, base, [0.13, 0.07, 0.02], [x, y, 0.335], P.stoneDark, { ao: false, r: 0.006, rz: s * 0.02 });
    box(ctx, base, [0.68, 0.05, 0.68], [0, 0.68, 0], P.trim, { ao: false });
    box(ctx, base, [0.56, 0.66, 0.56], [0, 1.03, 0], C.towerWall);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(ctx, base, [0.045, 0.64, 0.045], [sx * 0.28, 1.03, sz * 0.28], P.trim, { ao: false, r: 0.008 });
    addDoor(ctx, base.clone().multiply(place(0, 0.06, 0)), 0, 0.33);
    for (let k = 0; k < 4; k++) addWindow(ctx, turned(base, k * QUARTER), 0, 1.06, 0.28, 0.16);
    // Corbels and the lookout deck.
    for (let k = 0; k < 4; k++) for (const x of [-0.18, 0, 0.18]) box(ctx, turned(base, k * QUARTER), [0.06, 0.08, 0.1], [x, 1.33, 0.3], P.trim, { ao: false, r: 0.008 });
    const deckY = 1.4, half = 0.43;
    box(ctx, base, [half * 2, 0.07, half * 2], [0, deckY, 0], P.plank);
    box(ctx, base, [half * 2 + 0.02, 0.03, half * 2 + 0.02], [0, deckY - 0.04, 0], P.trim, { ao: false });
    for (let k = 0; k < 4; k++) {
      const side = turned(base, k * QUARTER);
      for (const x of [-half + 0.02, 0, half - 0.02]) post(ctx, side, x, half - 0.02, 0.17, P.trim, { size: 0.035, y0: deckY + 0.035 });
      box(ctx, side, [half * 2, 0.03, 0.035], [0, deckY + 0.2, half - 0.02], P.trim, { ao: false, r: 0.006 });
    }
    // The little lookout: four posts and a red pyramid roof with a white rim.
    const hutTop = deckY + 0.38;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(ctx, base, sx * 0.24, sz * 0.24, hutTop - deckY - 0.035, P.post, { size: 0.05, y0: deckY + 0.035 });
    box(ctx, base, [0.62, 0.05, 0.62], [0, hutTop, 0], P.trim, { ao: false });
    // Steep, so from the high camera its sides show lit and shaded rather than one flat square.
    ctx.add(new THREE.ConeGeometry(0.46, 0.52, 4).rotateY(Math.PI / 4), 'facet', C.towerRoof, place(0, hutTop + 0.025 + 0.26, 0), base, false);
    lantern(ctx, base, 0, hutTop - 0.08, 0);
    // The pennant on a short white pole from the roof's peak.
    const poleFoot = hutTop + 0.48;
    ctx.add(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6), 'matte', P.trim, place(0, poleFoot + 0.13, 0), base, false);
    ctx.add(pennant(0.2, 0.11), 'matte', C.flag, place(0.006, poleFoot + 0.2, 0), base, false);
    ctx.blob(base, 1.1, 1.1);
  },

  // The Crystal forge: a stone smithy with a violet roof, a crystal in its gable and a tall stone
  // chimney. Its arched mouth glows warm, an anvil stands on a stump, and a crate of crystal ore glows
  // cool beside the door.
  forge(ctx, thing, base) {
    const smithy = base.clone().multiply(place(0, 0, -0.1));
    const w = 0.92, d = 0.66, wallH = 0.72, front = d / 2;
    box(ctx, smithy, [w + 0.06, 0.08, d + 0.06], [0, 0.04, 0], P.stoneDark);
    box(ctx, smithy, [w, wallH, d], [0, wallH / 2 + 0.04, 0], P.stone);
    // Corner quoins, so the walls read as stonework.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) {
      box(ctx, smithy, [0.09, 0.1, 0.09], [sx * (w / 2 - 0.035), 0.16 + k * 0.2, sz * (d / 2 - 0.035)], k % 2 ? P.boulder : P.trim, { r: 0.008 });
    }
    box(ctx, smithy, [w + 0.03, 0.045, d + 0.03], [0, wallH + 0.035, 0], P.trim, { ao: false, r: 0.008 });
    const rise = addRoof(ctx, smithy, { w, d, top: wallH + 0.06, roof: C.forgeRoof, wall: P.stone, chimney: false, gableWindow: false });
    // A glowing crystal set in a white ring in the gable: the forge's sign.
    const gy = wallH + 0.06 + rise * 0.42;
    ctx.add(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16).rotateX(QUARTER), 'matte', P.trim, place(0, gy, front + 0.01), smithy, false);
    ctx.add(new THREE.OctahedronGeometry(0.065, 0), 'shine', P.crystal[0], place(0, gy, front + 0.025, { sz: 0.5, sx: 0.8 }), smithy, false);
    // Tall chimney at the back right, with a white cap.
    box(ctx, smithy, [0.24, 1.36, 0.24], [0.26, 0.68, -0.16], P.stoneDark);
    box(ctx, smithy, [0.3, 0.06, 0.3], [0.26, 1.37, -0.16], P.trim, { ao: false });
    // The forge mouth: a stone arch around a warm glowing hearth.
    const mx = -0.08;
    box(ctx, smithy, [0.42, 0.4, 0.04], [mx, 0.25, front + 0.012], P.trim);
    ctx.add(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 16, 1, false, QUARTER, Math.PI).rotateX(QUARTER), 'matte', P.trim, place(mx, 0.45, front + 0.012), smithy, false);
    box(ctx, smithy, [0.3, 0.28, 0.03], [mx, 0.22, front + 0.024], C.forgeFire, { mat: 'glow', ao: false, r: 0.006 });
    ctx.add(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 16, 1, false, QUARTER, Math.PI).rotateX(QUARTER), 'glow', C.forgeFire, place(mx, 0.36, front + 0.024), smithy, false);
    box(ctx, smithy, [0.44, 0.06, 0.12], [mx, 0.06, front + 0.06], P.stoneDark);
    addWindow(ctx, smithy, 0.25, 0.44, front, 0.17);
    for (const turn of [QUARTER, -QUARTER]) addWindow(ctx, turned(smithy, turn), 0, 0.42, w / 2, 0.17);
    addWindow(ctx, turned(smithy, Math.PI), -0.15, 0.42, d / 2, 0.17);
    // Anvil on a stump, front left.
    ctx.add(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 8), 'facet', P.log, place(-0.36, 0.07, 0.38), base);
    ctx.add(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 8), 'facet', P.logCut, place(-0.36, 0.145, 0.38), base, false);
    box(ctx, base, [0.08, 0.06, 0.07], [-0.36, 0.18, 0.38], C.anvil, { r: 0.006 });
    box(ctx, base, [0.2, 0.055, 0.09], [-0.37, 0.235, 0.38], C.anvil, { r: 0.008 });
    ctx.add(new THREE.ConeGeometry(0.035, 0.09, 6).rotateZ(-QUARTER), 'matte', C.anvil, place(-0.225, 0.24, 0.38), base, false);
    // A crate of glowing crystal ore, front right.
    const cx = 0.33, cz = 0.36;
    box(ctx, base, [0.26, 0.13, 0.2], [cx, 0.065, cz], P.plankDark);
    box(ctx, base, [0.27, 0.025, 0.21], [cx, 0.13, cz], P.plank, { r: 0.006 });
    const ore = [[-0.07, 0.02, 0.22, 0.05, 0.25, 0.2], [0.04, -0.03, 0.28, 0.055, -0.2, -0.1], [0.08, 0.05, 0.18, 0.045, -0.4, 0.3], [-0.01, 0.05, 0.16, 0.04, 0.1, 0.4]];
    ore.forEach(([x, z, h, r, rz, rx], i) => ctx.add(crystalGeometry(h, r), 'shine', i % 3 === 2 ? P.white : P.crystal[i % 2], place(cx + x, 0.11, cz + z, { rz, rx, ry: i }), base, false));
    // A few loose shards by the hearth.
    for (const [x, z, h, i] of [[0.14, 0.36, 0.12, 2], [0.06, 0.42, 0.09, 1]]) ctx.add(crystalGeometry(h, 0.03), 'shine', P.crystal[i], place(x, 0, z, { rz: 0.3, ry: i }), base, false);
    ctx.blob(base, 1.3, 1.15, 0, -0.04);
  },

  // The Mist loom: a tall wooden loom with soft pale striped cloth under a small pink roof, on a board
  // floor, with a low bench, a basket of yarn and a stack of finished cloth.
  loom(ctx, thing, base) {
    for (let i = 0; i < 7; i++) box(ctx, base, [1.04, 0.045, 0.14], [0, 0.0225, -0.44 + i * 0.145], i % 2 ? P.plank : P.plankDark, { r: 0.008 });
    const floor = 0.045;
    // Frame: front uprights hold the loom, back posts help carry the roof.
    const top = 1.16, fz = -0.04, bz = -0.42;
    for (const x of [-0.44, 0.44]) {
      post(ctx, base, x, fz, top, P.post, { y0: 0.04, size: 0.075 });
      post(ctx, base, x, bz, top, P.post, { y0: 0.04, size: 0.065 });
      box(ctx, base, [0.07, 0.07, 0.48], [x, top + 0.02, (fz + bz) / 2], P.post);
      box(ctx, base, [0.05, 0.05, 0.4], [x, 0.22, (fz + bz) / 2], P.post);
    }
    addRoof(ctx, base.clone().multiply(place(0, 0, (fz + bz) / 2)), { w: 0.94, d: 0.42, top: top + 0.06, roof: C.loomRoof, wall: P.plank, chimney: false, gableWindow: false });
    // Beams with the cloth between them: soft pale stripes, a few warp threads above.
    const cz = fz + 0.01;
    ctx.add(logGeometry(0.88, 0.035, P.log, P.logCut, 8), 'facet', null, place(0, 1.0, cz), base, false);
    ctx.add(logGeometry(0.88, 0.04, P.log, P.logCut, 8), 'facet', null, place(0, 0.28, cz + 0.02), base);
    const bands = [0.1, 0.06, 0.1, 0.07, 0.1, 0.07];
    let y = 0.31;
    bands.forEach((h, i) => { box(ctx, base, [0.72, h, 0.016], [0, y + h / 2, cz + 0.02], C.cloth[i], { ao: false, r: 0.003 }); y += h; });
    for (let k = 0; k < 8; k++) strut(ctx, base, [-0.33 + k * 0.094, y, cz + 0.02], [-0.33 + k * 0.094, 0.985, cz + 0.005], 0.008, P.trim, { rope: true });
    box(ctx, base, [0.76, 0.03, 0.04], [0, y + 0.06, cz + 0.015], P.post, { r: 0.006 });
    // Bench, yarn basket and finished cloth.
    box(ctx, base, [0.46, 0.035, 0.11], [0, floor + 0.17, 0.22], P.plank, { r: 0.006 });
    for (const x of [-0.19, 0.19]) post(ctx, base, x, 0.22, 0.155, P.post, { size: 0.035, y0: floor });
    ctx.add(new THREE.CylinderGeometry(0.09, 0.075, 0.09, 10), 'matte', P.plankDark, place(0.4, floor + 0.045, 0.36), base);
    C.yarn.forEach((colour, i) => ctx.add(new THREE.IcosahedronGeometry(0.042, 1), 'matte', colour, place(0.4 + [-0.035, 0.04, 0.0][i], floor + 0.1 + (i === 2 ? 0.02 : 0), 0.36 + [0.02, 0.01, -0.035][i]), base, false));
    for (let k = 0; k < 3; k++) box(ctx, base, [0.22 - k * 0.01, 0.035, 0.15 - k * 0.01], [-0.36, floor + 0.0175 + k * 0.035, 0.36], C.cloth[[1, 3, 5][k]], { r: 0.008, ry: k * 0.06 });
    lantern(ctx, base, 0.44, top - 0.14, fz + 0.065);
    ctx.blob(base, 1.25, 1.15, 0, -0.04);
  },

  // The Stone quarry: a shallow stepped cut in a horseshoe of rough grey-lilac rock, a neat pile of
  // cut blocks and a little yellow crane lifting one. The front stays open for the helper.
  quarry(ctx, thing, base) {
    const seed = hashString(thing.id) * 1000;
    // Gravel floor in front of the cut: a pale, slightly uneven patch.
    ctx.add(new THREE.CylinderGeometry(0.46, 0.47, 0.02, 9), 'matte', P.stoneDark, place(0, 0.01, 0.28, { sz: 0.6, ry: 0.2 }), base, false);
    // The cut: three steps with lilac faces, a few tool marks and pale flat tops.
    const steps = [[0.48, -0.3, 0.24, 0.5], [0.32, -0.1, 0.2, 0.56], [0.16, 0.08, 0.18, 0.6]];
    for (const [h, z, depth, width] of steps) {
      box(ctx, base, [width, h - 0.03, depth + 0.02], [0, (h - 0.03) / 2, z], P.lilac);
      box(ctx, base, [width + 0.01, 0.035, depth + 0.03], [0, h - 0.0175, z], P.stone, { ao: false });
      for (const x of [-0.16, 0.05, 0.19]) box(ctx, base, [0.012, (h - 0.06) * 0.7, 0.01], [x * width / 0.5, (h - 0.03) * 0.5, z + depth / 2 + 0.012], P.lilacDeep, { ao: false, r: 0.003 });
    }
    // Rough rock wrapped around the back and the sides, taller than the cut, so the steps read as
    // carved into it.
    const rim = [
      [-0.32, 0.25, -0.38, 0.22, [1.1, 1.5, 0.9], P.rock],
      [0.0, 0.3, -0.45, 0.22, [1.2, 1.4, 0.6], P.lilacDeep],
      [0.32, 0.24, -0.37, 0.22, [1.1, 1.45, 0.9], P.rock],
      [-0.44, 0.14, -0.08, 0.18, [0.8, 1.4, 1.3], P.lilac],
      [0.44, 0.13, -0.06, 0.18, [0.8, 1.35, 1.3], P.rockDeep],
      [0.46, 0.06, 0.16, 0.1, [1, 1.1, 1], P.rock],
    ];
    rim.forEach(([x, y, z, r, squash, colour], i) => ctx.add(chunk(r, seed + i * 5, squash, 0, 0.14), 'facet', colour, place(x, y, z, { ry: i * 1.1 + seed }), base, true, [0, 0.7, 0.86, 1.08]));
    // Cut blocks, front right.
    const blocks = [[0.27, 0.06, 0.4, 0, '#eceef6'], [0.45, 0.06, 0.38, 0.12, P.stone], [0.36, 0.18, 0.39, -0.1, P.boulder]];
    for (const [x, y, z, turn, colour] of blocks) box(ctx, base, [0.15, 0.12, 0.13], [x, y, z], colour, { ry: turn, r: 0.01 });
    // A yellow crane at the front left lifting a block off the middle step.
    const mx = -0.42, mz = 0.32, armY = 0.8, tip = [0.02, armY, -0.08];
    for (const turn of [0, QUARTER]) box(ctx, base, [0.26, 0.04, 0.06], [mx, 0.02, mz], P.post, { ry: turn + 0.4 });
    post(ctx, base, mx, mz, armY + 0.06, C.crane, { size: 0.06, y0: 0.0 });
    strut(ctx, base, [mx, armY, mz], tip, 0.05, C.crane);
    strut(ctx, base, [mx, armY - 0.28, mz], [(mx + tip[0]) / 2, armY - 0.02, (mz + tip[2]) / 2], 0.035, C.crane);
    box(ctx, base, [0.14, 0.1, 0.12], [tip[0], 0.32 + 0.05, tip[2]], '#eceef6', { r: 0.01 });
    strut(ctx, base, [tip[0], armY - 0.02, tip[2]], [tip[0], 0.44, tip[2]], 0.012, P.rope, { rope: true });
    box(ctx, base, [0.05, 0.03, 0.05], [tip[0], 0.435, tip[2]], P.steel, { r: 0.006, ao: false });
    lantern(ctx, base, mx + 0.06, armY - 0.1, mz);
    // A few loose chips on the gravel.
    for (const [x, z, r, i] of [[-0.12, 0.42, 0.04, 1], [0.08, 0.5, 0.03, 2], [-0.25, 0.22, 0.035, 3]]) ctx.add(chunk(r, seed + i * 9), 'facet', i % 2 ? P.lilac : P.stone, place(x, r * 0.5, z), base, false);
    ctx.blob(base, 1.25, 1.2, 0, -0.03);
  },
};
