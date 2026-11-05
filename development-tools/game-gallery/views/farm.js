// Farmyard development fixtures. No app state or game records are written.
import * as THREE from 'three';
import { farmyard } from '../../../electron/renderer/game/scene/models/farm.js';
import { place } from '../../../electron/renderer/game/scene/ground.js';
import { P } from '../../../electron/renderer/game/scene/style.js';
import { buildThings } from '../../../electron/renderer/game/scene/town/pads.js';
import { parseTown } from '../../../electron/renderer/game/scene/town/world.js';
import { buildTown } from '../../../electron/renderer/game/town/index.js';

// A saved town with a farm (and, with `extension`, its later building) added on one island.
function withFarm(game, island, extension) {
  const copy = structuredClone(game), home = copy.islands.find(i => i.id === island);
  home.land = Math.max(140, home.land);
  const checkIn = Math.max(0, ...copy.islands.flatMap(i => i.buildings.map(b => b.checkIn || 0))) + 1;
  home.buildings.push({ id: 'farm-fixture', blueprint: 'farmyard', checkIn, landWhenBuilt: home.land });
  if (extension) home.buildings.push({ id: 'extension-fixture', blueprint: 'farmextension', parentBuildingId: 'farm-fixture', checkIn: checkIn + 1, landWhenBuilt: home.land });
  return copy;
}

// The way from a farm's middle to its front lane: south, east, north or west (south faces the camera).
function facingOf(world, thing) {
  const grid = world.islands.find(i => i.id === thing.island).grid;
  const [x, z] = grid.points[thing.front];
  return ['east', 'south', 'west', 'north'][((Math.round(Math.atan2(z - thing.at[1], x - thing.at[0]) / (Math.PI / 2)) % 4) + 4) % 4];
}

// The first real farm facing each way, from the saved gallery towns (a farm added to each island in turn).
// Each world looks at the farm's island, as Today would once the farm is that island's newest building.
let facings = null;
function farmsByFacing(states) {
  if (facings) return facings;
  facings = new Map();
  for (const entry of states) {
    if (!entry.game || facings.size === 4) continue;
    for (const island of entry.game.islands.map(i => i.id)) {
      const world = buildTown(withFarm(entry.game, island, false));
      const thing = world.things.find(t => t.id === 'farm-fixture');
      if (!thing || facings.has(facingOf(world, thing))) continue;
      const looking = w => ({ ...w, view: { island, points: [...thing.points] } });
      facings.set(facingOf(world, thing), { label: `${entry.id} ${island}`, entry, island, thing, coop: looking(world), barn: looking(buildTown(withFarm(entry.game, island, true))) });
      if (facings.size === 4) break;
    }
  }
  return facings;
}

export default {
  id: 'farm', title: 'Reserved farmyard', sections: [
    {
      id: 'facings', title: 'Four facings at Today size',
      async render(host, tools) {
        const found = farmsByFacing(tools.data.town.states);
        tools.note('Real plots from the saved towns, one for each way the front lane can lie. The building should stand at the end away from the camera, with the yard and its gate in view.');
        for (const stage of ['coop', 'barn']) {
          const row = tools.grid();
          for (const way of ['south', 'east', 'north', 'west']) {
            const farm = found.get(way);
            if (!farm) { row.append(tools.card(`Front ${way}`, 'No saved town has one', [])); continue; }
            row.append(tools.card(`Front ${way} · ${stage === 'coop' ? 'original' : 'extended'}`, farm.label, [await tools.worldShot(farm[stage], 'focus', { width: 591, height: 357 })]));
          }
        }
      },
    },
    {
      id: 'close', title: 'Close-up on a real plot',
      async render(host, tools) {
        const found = farmsByFacing(tools.data.town.states);
        tools.note('The plot, yard, fence, gate and building as Today draws them, close up. Held at rest.');
        for (const way of ['north', 'south']) {
          const farm = found.get(way);
          if (!farm) continue;
          const row = tools.grid();
          for (const stage of ['coop', 'barn']) {
            const world = parseTown(farm[stage]);
            const island = world.islands.find(i => i.id === farm.island);
            const thing = world.things.find(t => t.id === 'farm-fixture');
            const [x, z] = thing.at;
            const aim = thing.points.map(p => island.point(p)).flatMap(([px, pz]) => [[px, 0, pz], [px, 0.9, pz]]);
            for (const mood of ['focus', 'break']) {
              const img = await tools.shot(ctx => {
                ctx.add(new THREE.BoxGeometry(8, 0.06, 6), 'matte', P.grass, place(x, -0.03, z), null, false);
                buildThings(ctx, island, [thing]);
              }, { width: 500, height: 330, mood, time: 0, aim });
              row.append(tools.card(`Front ${way} · ${stage === 'coop' ? 'original' : 'extended'}`, mood, [img]));
            }
          }
        }
      },
    },
    {
      id: 'stages', title: 'Original and extended shelter',
      async render(host, tools) {
        tools.note('The shelter grows within its original parcel. Yard, entrance and animals stay in place. Held at rest; the done mood shows the evening light.');
        for (const mood of ['focus', 'done']) {
          const row = tools.grid();
          for (const extension of [null, 'extension-fixture']) {
            const img = await tools.shot(ctx => {
              ctx.add(new THREE.BoxGeometry(2.1, 0.06, 1.3), 'matte', P.grass, place(0, -0.06, 0));
              farmyard(ctx, { id: 'farm-fixture', extension }, place(0, 0, 0));
            }, { width: 500, height: 330, mood, time: 0, aim: [[-0.9, 0, -0.55], [0.9, 0, -0.55], [0.9, 0, 0.55], [-0.9, 0, 0.55], [-0.6, 0.75, 0]] });
            row.append(tools.card(extension ? 'Extended shelter' : 'Original shelter', mood, [img]));
          }
        }
      },
    },
    {
      id: 'town', title: 'Farmyard in a town',
      async render(host, tools) {
        const entry = tools.data.town.states.find(x => x.person === 'steady' && x.day === 30);
        if (!entry?.game) { tools.note('Missing town fixture.'); return; }
        const game = withFarm(entry.game, entry.game.islands[0].id, false);
        const extended = withFarm(entry.game, entry.game.islands[0].id, true);
        tools.note('Development fixture with a reserved parcel, at Today size; actual purchase fit is checked separately by rules and long-run layout tests.');
        for (const [label, world] of [['Original shelter', buildTown(game)], ['Extended shelter', buildTown(extended)]]) {
          const row = tools.grid();
          for (const mood of ['focus', 'done']) row.append(tools.card(label, mood, [await tools.worldShot(world, mood, { width: 591, height: 357 })]));
        }
      },
    },
  ],
};
