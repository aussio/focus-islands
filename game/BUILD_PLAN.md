# Game build plan

The plan for building the sky-island game for real. [NOTES.md](NOTES.md) has the design, and the user's decisions are at the bottom. The first prototypes are on the branch `prototype/sky-island-game`. The town look prototypes are on `prototype/town-grid`, with a copy in `.build/reference/development-tools/grid-prototype/` (`wonky/` is the chosen direction, `bent/paths.js` has good lane pieces). Copy code from them; never import them.

## Where things stand

- **Built** on `game/sky-island`: the rules (earning, check-ins, building, helpers, Starlight and wonders, more islands, surprises and firsts), the gallery, the screenshot tour, and the island on Today with its check-in card.
- **The town is on Today** (stages 0 to 2 done; decisions 5 to 9). Each island has its own uneven grid. Houses grow block by block, special buildings sit on pads, paths are lanes, bridge feet sit at the end of piers, and the view follows the helpers. Islands grow at different speeds and float at different heights, and bridges join them in a network with loops, some of them fancy surprise bridges. The square-grid layout and scene are deleted.
- **Next: stage 3, the look, with the user.** Speed work waits (decision 10). [LATER.md](LATER.md) lists what was left for later and why.

## How the pieces fit

- **Rules**, in `electron/core/game/`, run in the app's main process next to the timer.
  - They read the saved history from the day the game started and work out the game state: resources, islands, buildings, helpers, and whether a check-in is waiting.
  - The rules never read the clock and never use plain randomness. A "dice roll" comes from mixing a saved record's id with what the roll is for, so a new roll never changes old results.
- **Layout**, in `electron/renderer/game/town/` (new; it replaces `layout/` in stage 2), is plain code with its own tests and no 3D. It turns the game state into a town: each island's grid, its land, lanes, house blocks, pads, natural things, where each island floats, bridges, and which island the view looks at. The same state always gives the same town, and nothing far from a change moves. Its seeds come only from island ids, building ids and grid point numbers.
- **Scene**, in `electron/renderer/game/scene/`, is Three.js and draws the town in style D. The town drawing lives in `scene/town/`. It holds nothing worth saving.
- **Gallery**, in `development-tools/game-gallery/`, never ships. It shows every model and piece in both moods, each helper animation, and towns built from real-rule states from day 1 to day 180.

The scene is built as a second script, `game.js`, next to `app.js`, because packaging copies only `electron/`. `three` stays pinned at 0.186.1.

## Saved records

Game records are kinds of their own, separate from the old acorn `rewardGranted` records. Each carries `rulesVersion` inside it. Its unique key names only its source, so a rules change can't grant twice.

- `gameStarted` (key `game:started`): the line after which history counts, in saved order. Only one ever exists. The core writes it the first time it opens a database without one. It also stores the starting land and supplies, so a rules change can't rewrite the start.
- `gameGranted`: what one finished focus session, one rest, or one whole day earned, as `{ rulesVersion, source: 'focus' | 'rest' | 'day', sourceID, dayKey, amounts: { wood, stone, ... }, restMinutes }`. Keys: `game:grant:focus:<sessionID>`, `game:grant:rest:<sessionID or away id>`, `game:grant:day:<dayKey>`. After each saved change, the core writes any grant that's due and missing. Once written, the amount never changes, so new numbers never rewrite the past.
- `gameCheckedIn` (key `game:checkin:<number>`): one tap on the check-in card. It stores everything that happened: what was collected, new land, arrivals, the surprise, firsts, and the choice made (or none). The game state is these records added up, plus the next check-in worked out from grants since the last one. A rules change only affects check-ins that haven't happened yet. The card carries a `token`; a tap with an old token is refused, so a card that changed underneath can't pick the wrong thing.

A rest is a confirmed break (`breakConfirmed` + `breakEnded`), or time away during focus that the core counted as a break (its `awayEnded` notes `countedAsBreak`, `restSeconds`, and `targetSeconds`). `breakStarted` and a counted `awayEnded` note `followsSessionID` (the focus session just before), and `focusStarted` notes `reason` (`suggestion`, `afterBreak`, `snooze`, `manual`). Starlight needs both. Older records without them fall back to "the last focus session before it in saved order".

The page gets the game state as `status.game` in the once-a-second status. The core works it out only when the saved history changes, from the events it already read.

**Version 2 (the town).** The record shapes stay the same. `rulesVersion` becomes 2, and:

- Land amounts count grid points: `gameStarted.startingLand`, `gameCheckedIn.newLand[].amount`, and `built.landWhenBuilt`.
- `built.blueprint` can be `house`, `room` or `floor`. `cottage` is gone.
- A bridge's `built.link` becomes `{ from, to, type: 'rope', land: { [from]: n, [to]: m } }`: the two islands it joins (always neighbours in the sky table), and each one's land at that moment, so the layout can place the bridge's feet at the right point in the replay.
- A new island in `gameCheckedIn.islands[]` also stores `ring`, `angle`, `lift` and `appetite`, worked out when it arrives (see "Islands grow at different speeds"). They never change, so a rules change can't move an island.
- A fancy bridge surprise stores what it did in `gameCheckedIn.surprise`: `link: { id, from, to, type, land }` for a new bridge, or `upgrade: { link, type }` for a rope bridge that changed type.
- Version-1 records were only ever made on this branch, for testing. `fold()` reads them through a small converter, so a database that tried the square island still opens:
  - land amounts × 7, and `cottage` read as `house`;
  - islands missing `ring`, `angle`, `lift` or `appetite` get them from the same rules and rolls as new ones;
  - each old link becomes a rope bridge from the new island's first neighbour in the sky table (home, for the first eight islands) to that island.

## Shapes passed between the pieces

**Game state** (rules → page). Amounts can have fractions; the page shows whole numbers.

```js
{
  rulesVersion, change,                 // change: saved order of the newest game record
  onHand: { wood, stone, planks, soil, saplings, starlight },
  waiting: { ... },                     // earned since the last check-in
  islands: [{ id, name, kind, size, land, golden,   // kind: home | mossy | rocky | meadow | crystal | misty; size: small | medium | large
    ring, angle, lift,                  // its place in the sky table: ring 0 is home; angle in degrees, null for home; lift: how high it floats, home 0
    buildings: [{ id, blueprint, name, landWhenBuilt, checkIn }] }],
  links: [{ id, from, to, type, checkIn, land: { [islandId]: landThen } }],  // bridges between sky-table neighbours;
                                        // type: rope | arch | slide | cloudsteps | flowerarch | rainbow
  helpers: [{ id, name, job, island }], // job: wood | stone | planks | soil | saplings | null
  wonders: [blueprint ids],
  checkIn: null | { number, token, collected, newLand: [{ island, amount }],
    arrivals: [text], moments: [text], surprise: text | null, nextUp: text | null,
    choice: null
      | { kind: 'job', helper, helperName, options: [{ job, name, doing }] }
      | { kind: 'build', options: [{ blueprint, name, kind, does, price, island }] } },
  lastCheckIn: null | { number, moments, built, job },  // what the last tap did, so the page can show it
  nextUp: text | null, activeDays, checkIns,
}
```

`land` is the number of grid points on the island that are land. Home starts with 40. `size` picks the island's grid; home uses the large grid. Buildings are listed in the order they were built. `landWhenBuilt` and each link's `land` let the layout replay growth, so nothing already placed moves. A link's `checkIn` is the check-in that made it, by building or by surprise; an upgrade changes only its `type`. A `house`, `room` or `floor` is part of a block house. Every other building except the bridge stands on a pad.

**World** (layout → scene). Each island has its own grid. `p` below is a point number in that island's grid.

```js
{
  islands: [{
    id, kind, size,
    grid,             // from gridFor(id, size): { key, points: [[x, z]], cells: [[p, p, p, p]], neighbours: [[p, ...]] }
                      // in world units around the grid's middle; one shared, frozen object per island, never copied
    at: [x, z],       // where the grid's middle floats; it only ever moves outward, along the island's own angle from home
    lift,             // how high it floats, from the game state; it never changes
    land: [p, ...],   // land points, in the order they filled
    kept: [p, ...],   // sky points kept open for good: in front of bridge feet and coast buildings
    lanes: [p, ...],  // points with a lane
    houses: [{ id, look, door: { point, outside },   // id: the house building that started it; look: colour pair number
      blocks: [{ point, floors }] }],                // floors 1 to 3
    reach,            // the farthest land from the grid's middle, for spacing and the camera
  }],
  things: [{ id, kind, island, points: [p, ...],   // the points it covers
    at: [x, z], yaw, scale,                         // middle in island units; yaw 0 faces south, toward the camera;
                                                    // scale: a pad's fit (its cell size ÷ 0.62, kept between 0.85 and 1.15), else 1
    pad, front, coast }],                           // pad: true for special buildings; front: the point its lane starts at, or null;
                                                    // coast: { yaw, width } for coast buildings (the way out to the sky), else null
  bridges: [{ id, type,                             // type as in links; a slide's from end is always the higher island
    from: { island, point, out, clear },            // point: the bridge foot, a lane point on the coast;
    to: { island, point, out, clear } }],           // out: the end's fixed way out to the sky, as a unit direction [dx, dz];
                                                    // clear: how far the deck runs straight along out before it may bend
  helpers: [{ id, name, job, island }],
  view: { island, points: [p, ...] },               // the busiest island, and the points the camera keeps in view there
}
```

Thing kinds, their footprints, which job works at each, and pad and coast flags live in `electron/renderer/game/kinds.js`. Layout and scene both read it. Footprints on the uneven grid:

- **point:** one point. Natural things, the pile, the campfire, seats, lanterns, the golden sapling.
- **pair:** two neighbouring points. The flower bed.
- **cell:** one cell's four corner points. Most special buildings, the lighthouse, the sky waterfall.
- **cells:** two cells that share a side, six points. The airship dock.
- **ring:** a point with exactly four cells around it, nine points. The observatory, the aurora garden.

**Promises.** The same state always gives a deep-equal world, with the same grid objects. Between a state and the state after one more check-in:

- each island keeps its grid; the old land is the start of the new land, in the same order
- old lanes stay lanes; kept sky only grows and never covers land
- every house keeps its blocks, colour and door, and floors never go down
- every built thing (start things, buildings, the golden sapling) keeps its points, `at`, `yaw` and `scale`
- small natural things may vanish only where their point, or a point next to it, gets used or stops being coast; they may appear only on or next to new land
- an island moves only outward along its own angle, and its `lift` never changes
- a bridge's `island` and `out` never change; its foot moves only outward along its pier, through lane points that each sit farther out along `out`; an upgrade changes only its `type`, and for a water slide the higher end is listed as `from`
- the deck's bend (foot + `out` × `clear`) never moves inward
- `view` may change: that is the camera following the helpers

**Scene** (`electron/renderer/game/scene/`): `createIslandScene(host)` returns `{ setWorld(world), setMood(mood), capture(), dispose() }`. Mood is `focus`, `break`, `away`, or `done`. `capture()` resolves after a fresh frame is drawn, with any camera move finished first. It stops drawing when the page is hidden or the host is off screen, and puts helpers back at their starting spots when it's shown again.

**Page glue** (`electron/renderer/game/index.js`, built as `electron/renderer/game.js`): sets `window.cozyGame = { mount(host), show({ game, mood }), capture() }`. It runs the layout and hands the world to the scene.

## Town rules

### What a check-in can add

- **Land:** rest minutes turn into land points, as now, and grow the coast a little at almost every check-in after a break. Each point goes to one island by a weighted roll, so older islands and hungrier ones grow faster, and home stays the largest (see "Islands grow at different speeds").
- **A new house:** two blocks. A **room:** one more block on a house. A **floor:** one more storey on one block. These are the `house`, `room` and `floor` blueprints, in a new offer kind, `homes`.
- **A special building** on a pad: every current blueprint except the cottage, with no change to what they do.
- A **rope bridge** between two neighbouring islands, a **wonder**, a **helper's job**, as now. Still at most one choice per check-in.
- **A surprise** can add a fancy bridge, or turn a rope bridge into one (see "Bridges").

The rules only say which island a house, room or floor goes on. The layout picks which house grows and where.

### Land is counted in grid points

- One unit of `land` is one point of the island's grid. One old building spot is about 7 points.
- The room an island has for buildings: `land − 4 × √land − 0.12 × land − used`. The `4 × √land` part is the coast, where houses and pads don't go. The `0.12 × land` part is lanes. `used` is the start things plus every building's ground, plus 4 for each bridge end on the island (`groundPerBridgeEnd`).
- Ground each building needs, as a new `ground` field on each blueprint: point 1, pair 2, cell 5, cells 7, ring 11, house 3, room 1, floor 0, bridge 0. Start things use 4 on home and 2 on a new island. Each bridge end, rope or fancy, uses 4 on its island instead: its foot needs a lane to the other lanes (about 5 points when it is laid). Bridges are never refused for room, so room may dip below 0 until the land catches up.
- Example: home starts with 40 points, which gives room 5, enough for one cell pad. After day 1's breaks (about +7 points), it has room for a second pad. That matches today's day 1 (garden and nursery).
- Each island has a most land it can hold, `maxLand`, sized to fit its grid: small 320, medium 450, large 600, home 600. Land skips islands that are full. If all are full, extra rest minutes wait in `landProgress`.

### Islands grow at different speeds (decision 9)

Home is always the largest, because it's the oldest. Older islands are usually bigger, and each island has its own appetite, so no two grow alike.

- **Appetite:** each new island gets `appetite`, a roll from 0.7 to 1.3, when it arrives. Home's is 1.3 (`homeAppetite`).
- **Who gets each land point:** a roll weighted by `appetite ÷ (1 + 0.3 × order)` (`landAgeStep: 0.3`). `order` is 0 for home, 1 for the first new island, and so on. With average appetites, home gets 1.3, then 0.77, 0.63, 0.53, 0.45. So every island keeps growing a little, home grows most, and the newest least. Each point has its own roll, keyed by the check-in and the point's number in it.
- **Home stays the largest:** an island can't take a point if it is full, or if it would pass 85% of home's land (`homeLead: 0.85`). The roll is made only among islands that can take it.
- **Starting size:** unchanged. The size roll (small 35%, medium 40%, large 25%) and `startLand` (30, 40, 55).
- **Height:** each new island gets `lift`, a roll from −0.5 to 0.5 in steps of 0.05, when it arrives. Home's is 0.
- **Place in the sky:** each new island gets its `ring` and `angle` from the sky table (below).
- `appetite`, `lift`, `ring` and `angle` are saved with the island's arrival, so they never change.

### The sky table (decision 8)

The rules can't see where islands float, so a small fixed table in `electron/core/game/sky.js` says where each island goes and which islands may be joined. Each island in the game state carries its `ring` and `angle`, so the layout never needs its own copy of the table.

- **Where each island goes:** the n-th new island (n from 1) goes to ring ⌈n ÷ 8⌉, at angle `ANGLES[(n − 1) mod 8]`.
  - `ANGLES` is 0, 180, 315, 135, 225, 45, 270, 90 in degrees, with east 0 and south 90 (toward the camera). These are today's `SLOT_ANGLES`, so the south slot, which would hide home, comes last.
  - Ring 2 uses the same angles as ring 1, not today's 22.5° turn. Each ring-2 island sits straight out beyond the ring-1 island at its angle.
  - Home is ring 0.
- **Neighbours,** in this order:
  1. inward: home for ring 1, otherwise the island at the same angle one ring in;
  2. around: the islands in the same ring 45° either side, the earlier arrival first;
  3. outward: the island at the same angle one ring out.
  - Only pairs where both islands have arrived count. Islands more than 45° apart are never neighbours, even when the slots between them are empty, because a later island would sit under their bridge.
- **Why a table:** it lets the rules know which islands are near each other without seeing positions, and the layout can always place every bridge it allows without crossings (see Layout, "Why bridges never cross"). Inward comes first because the layout puts each island as close to its inward neighbour as the sky gap allows, so it's usually the nearest.
- **The table is never edited, only added to,** like saved records, so a rules change can't move an island or a bridge.

### Bridges (decision 8)

- A **link** joins two neighbours from the sky table. Its `type` is `rope` when built, or a fancy type from a surprise: `arch` (stone arch), `slide` (water slide), `cloudsteps` (cloud steps), `flowerarch` (flower arch) or `rainbow`.
- An island is **joined** when a chain of links reaches home.
- **Rope bridge (the blueprint):** offered while some neighbour pair has no link. This replaces `perExtraIsland`. The next rope bridge goes to:
  1. the earliest island that isn't joined yet but has a joined neighbour, linked to one of its joined neighbours by a roll (keyed by the check-in): inward weight 2, each side neighbour weight 1. So islands don't all hang off home;
  2. otherwise the first neighbour pair with no link, in table order (pairs listed by the newer island's arrival, then its neighbour order). This closes a loop.
  - So each new island first joins a joined neighbour: usually the one inward (home for ring 1), sometimes a joined side neighbour, which makes a chain instead of a star. Later bridges make loops.
  - The option names both islands, for example "A rope bridge from Home island to Mossy Hollow."
- **Fancy bridges** are a new surprise kind, `bridge`, with weight 1 next to the others (seeds 4, soil 3, stones 3, fireflies 2, golden 1, lost 1).
  - Allowed only while fancy bridges number fewer than the islands other than home. Otherwise it falls back to seeds, like the other surprises.
  - If some neighbour pair has no link, one such pair, by roll, gets a new fancy link. Otherwise one rope bridge, by roll, gets upgraded. If there are neither, it falls back to seeds.
  - **Type by roll:** stone arch 3, water slide 3, cloud steps 3, flower arch 3, rainbow 1. A water slide needs the two islands' `lift` at least 0.25 apart; otherwise it's left out of the roll.
  - **An upgrade changes only the type.** The link keeps its id, ends, `land` and `checkIn`, so the upgrade itself places nothing.
  - A new fancy link's id is `gift-<check-in number>`, and its `land` is each island's land at that check-in.
  - **Texts,** for example: "Overnight, a stone arch grew between Home island and Mossy Hollow." "The rope bridge to Flint Peak turned into a rainbow." "A water slide now runs from Flint Peak down to Home island."
- Helpers walk every type, and the water slide works both ways (see Scene, "Helpers").

### Homes and beds

- Beds: 3 to start (the old tree's hollow), plus 1 per block storey. A new house gives 2, a room 1, a floor 1. `bedsPerCottage` becomes `bedsPerBlock: 1`.
- **House:** offered when the island has room for 3 and has at least as many rooms as houses, so houses grow before new ones start. The first house is always allowed.
- **Room:** needs a house on that island and room for 1.
- **Floor:** tier 2, so it needs the Sawmill. It is offered while the island's floors are fewer than its blocks, so the average stays under 2 storeys. The layout keeps every block at 3 storeys or less.
- Blocks may cover at most 30% of an island's land (`homesShareOfIsland: 0.3`).
- Homes are offered whenever they fit, not only when a helper needs a bed (decision 7). The `homes` slot in an offer shows one blueprint: the affordable one with the lowest number owned ÷ weight (room 3, floor 2, house 1). Over time that gives about 3 rooms and 2 floors for each new house.

### Prices and caps

| Blueprint | Kind | Tier | Ground | Price | Each one owned adds |
|---|---|---|---|---|---|
| `house` | homes | 1 | 3 | wood 40, stone 20, soil 20, saplings 10 | 25% |
| `room` | homes | 1 | 1 | wood 20, stone 12, soil 10, saplings 5 | 6% |
| `floor` | homes | 2 | 0 | stone 14, planks 18, soil 8, saplings 4 | 6% |

- `priceOf` reads a blueprint's own `step` when it has one, before `fastRepeatPriceStep` and `repeatPriceStep`.
- `KIND_NAMES` gains `homes: 'homes'`, and `decor` becomes `'pretty things'`. An offer now draws its 2 or 3 blueprints from four kinds: making, growing, decor, homes. A wonder can still come on its own.
- Pad buildings keep their prices, `perIsland` caps and `maxShareOfIsland`, now counted against each island's things.
- `placeFor` picks, among the islands with enough room for the blueprint's ground, the one with the fewest buildings for its land (buildings ÷ land, homes included). Ties go to the most room, then the earlier island. Rooms and floors only go to islands with a house, and the `perIsland` caps still apply.
  - This way every island fills up alike, and a young island gets the next things until it runs out of room.
  - Room ÷ land was tried first. It counts the coast, which takes most of a small young island (about 63% of 40 points), so a new island looked full while nearly empty. By day 180 the newest island had only 1 or 2 buildings besides flower beds, and month 3 rose to 6.3 choices a week.
  - The house rule counts each island's own houses and rooms, so a new island can always start its first house.
- `teaser` counts the land points still missing, not spots, when it says "about N more breaks".
- The arrival line "A Cottage would give them a home" becomes "A new house or room would give them a home."

### Pacing

The targets in `pacing.test.js` stay: about 3 choices on day 1 (2 to 4), the first island on active day 7 to 9, the first wonder in weeks 2 to 3 (now day 18 for the steady planner), and 2.5 to 6 choices a week in month 3 (was 5; widened because homes are offered whenever they fit, decision 7).

- **Unchanged,** because they don't depend on land or buildings: grants, the rest curve, Starlight, island and helper timing, how often surprises come, wonder prices. Islands and wonders should land on the same days as now. The surprise mix gains fancy bridges.
- **To retune together** until the targets pass and the layout never needs extra land: `startingLand` (40, was `startingSpots` 4), `restMinutesPerLand` (5, was `restMinutesPerNewSpot` 35), the new islands' `startLand` (small 30, medium 40, large 55, was 2, 3, 5), the coast and lane parts of the room sum (4 and 0.12), the ground per bridge end (`groundPerBridgeEnd` 4), the homes prices, steps and weights, `homesShareOfIsland`, and the land share (`landAgeStep` 0.3, `homeAppetite` 1.3, `homeLead` 0.85).
- **New town targets,** for the steady planner by day 180 unless it says otherwise:
  - at least 20 blocks over all islands, with at least 8 on home, so the town reads as a town;
  - home has the most land on every day, for every person in `PEOPLE`;
  - the biggest new island has at least 1.4 × the land of the smallest;
  - every island is joined, with at least one loop;
  - 2 to 4 fancy bridges;
  - every island that arrived at least 30 days earlier has at least 3 buildings besides flower beds (houses, rooms and floors count);
  - home holds at most 60% of all blocks.
- **Simulated player** (`simulate.js`): a wonder first. Then homes if a helper is waiting for a bed. Then a rope bridge if some island isn't joined yet. Then the homes option on every third build choice where it's offered, standing in for a player who likes the town. Otherwise something new before something repeated.
- The test that compared with the pacing prototype's own replay is removed. Its export is no longer in `.build`, so it was already skipped, and it has done its job of checking the port.

## Layout

All in `electron/renderer/game/town/`. Plain code with no Three.js and no DOM, so it runs in Node tests, in the gallery build, and in the page.

### The grid

- `gridFor(id, size)` makes the island's grid once, from the prototype's `wonky/grid.js`:
  1. a hexagon cut into triangles,
  2. neighbouring triangles joined into four-sided shapes at random, from a seed made from the island id,
  3. every shape split into four-sided cells,
  4. 60 rounds of smoothing.
- Sizes: the triangle side is 1.3, so cells are about 0.65 across, close to the old 0.6 cell. The hexagon is 7 triangles across from the middle for small islands, 8 for medium, and 9 for large and home. That gives about 420, 585 and 765 usable points.
- Points within 3 steps of the hexagon's rim never fill, so the coast never touches the rim.
- Point positions are rounded to 4 decimals. Grids are cached by id. One takes 7 to 12 ms to make.

### How land grows

- `growthOrder(grid, id)` is fixed when the grid is made. It starts at the four-cell point nearest the middle. Then it keeps taking the waiting neighbour with the smallest "lobed distance": distance from the start, stretched by three seeded waves around the island so it grows in soft lobes, plus a tiny roll for each point. Ties go to the lower point number.
- `fillLand(grid, order, count, kept)` walks the order. It skips kept points, and holds back any point with no land neighbour yet until one fills. So land is always one piece with no holes.

### Replaying an island

- Start the island (below). Then take its buildings and bridge feet in check-in order. For each one, grow land to its `landWhenBuilt` (or the link's `land`, for built and surprise links alike), then place it. Upgrades place nothing. At the end, grow to the island's `land`.
- If something has no place, try looser rules first: houses and pads may touch the coast, pads may sit beside blocks, and lanterns needn't touch a lane. Then a pad may squeeze in (see "Free for a pad"). Only then add the next land points until it fits, and count them in `borrowed`. The long-run check requires `borrowed` to be 0 on the real rules.
- Land only grows next to land helpers can walk to from the plaza, so new land never starts from a corner a pad squeezed off.
- Every choice uses a roll from the island id, the building id and point numbers, never positions in the sky.

### The start of each island

- **Home:**
  - The plaza is the first point plus two of its neighbours, all lanes.
  - The pile (the hub) is next to the plaza.
  - The campfire is 2 steps away, with two log seats beside it.
  - The old tree and the big rock sit on coast points 2 to 3 steps out, on opposite sides.
- **New islands:** the plaza point, one tree and one rock (so any woodcutter or stone gatherer sent there has work), and one extra by kind: mossy a mushroom, rocky a second rock, meadow a flower, crystal a crystal, misty a bush.
- **Golden sapling:** from the island's first 12 growth points, the free one with the lowest roll is kept for good: never built on and never a lane. It shows grass until the island turns golden, then the golden tree.

### Houses

- **New house:**
  - The first block goes on a free inland point with at least 3 free inland neighbours.
  - Score, lowest wins: 10 × the gap between its steps to the nearest house and 2, plus 2 × its steps to the nearest lane, plus 3 × how crowded it is, plus 4 × a roll. The first house on an island aims for 3 steps from the plaza.
  - The second block is the free inland neighbour that touches the house most.
- **Door:** on the block side facing the free point closest to the lanes. That point is the door's outside, and a lane joins it to the others.
- **Room:**
  - It goes on the house on that island with the fewest blocks that can still grow (ties: the oldest).
  - The new block goes on a free inland point next to it that isn't a door's outside or a lane, and that leaves every free point reachable.
  - Prefer points that touch more of the house. Once the house has 3 blocks, prefer points that also touch another house, so the two join. Then a roll.
  - If no house can grow, the room starts a one-block house, placed like a new house.
- **Floor:** the biggest house on the island that has a block under 3 storeys. Raise its most central block (the most house neighbours) that is under 3. Ties: a roll.
- **Colours:** a colour pair by roll from the house id, from 6 pairs (the prototype's `LOOKS`). Joined houses keep their own colours and doors. Their roofs run together where the heights match.

### Pads for special buildings

- **Candidates by footprint:**
  - cell: a cell whose four points are free;
  - cells: two such cells sharing a side;
  - ring: a point with exactly four cells around it, all nine points free;
  - pair: two neighbouring free points;
  - point: one free point.
- **Free for a pad:** land, not coast, not a lane, not taken, not the golden point, not next to a block, and not a door's outside. Afterwards every free point must still be reachable from the lanes. When nothing fits, a pad may touch the coast and sit beside blocks. When still nothing fits, it may squeeze in: it may cut off coast points and points that already hold something, never a free inland point. Each free point it cuts off gets a hedge (a bush), so no free point is left that nobody can walk to.
- **Front:** the point next to the pad that is closest to the lanes. A lane joins it. The model faces it.
- **Score, lowest wins:**
  - 10 × the gap between its steps from the plaza and a wanted distance (3 + things on the island ÷ 4, so the town fills outward),
  - plus a facing cost for the front: south 0, east and west 0.7, north 2.4, smooth in between,
  - plus 3 × crowding, plus 4 × a roll.
- **Flower beds** (pair) prefer points next to a house or a lane. **Lanterns** (point) need a point next to a lane.
- **Coast buildings** (lighthouse, sky waterfall, airship dock):
  - The pad's outer side must be on coast points, with at least 3 sky points straight out from it that nothing else keeps.
  - It faces the sky. Facing cost: south 0, east and west 0.7, north 2.4. North only if nothing else fits, because the camera can't see the north coast.
  - It needs a **bay** of sky in front: 0.4 wider than the pad's sea side on each side, widening at 35° (`BAY_ANGLE` in `town/pads.js`) up to 1.6 on each side. The bay must be all sky when the building comes and never crosses a pier; spots with shallow bays (headlands) are preferred. Afterwards the bay is kept sky, so the building stays on the coast for good. (A one-point strip read as a crack; an unlimited bay left too little room.)
  - The thing gets `coast: { yaw, width }`, so the model needs no grid.

### Lanes

- Lanes start at the plaza, each door's outside, each pad's front and each bridge foot. A new lane is the shortest run of free points to the nearest lane (ties: the lower point number).
- Lanes are never removed and never built over. Each island's lanes form one network from the plaza.

### Natural things

- **Start things and the golden sapling are built things.** They never move.
- **Everything else natural is light decoration:**
  - A free point shows something only if its own roll is under the chance for its place. The places are beside a building, beside a lane, on the coast, or open lawn. The kinds and chances by island kind move over from the `DECOR` table in `layout/island.js`.
  - Big trees can appear on coast points (6% on home, mossy, meadow and misty).
  - Decoration never goes on lanes, blocks, pads, start things or the golden point, and never next to a door's outside or a pad's front.
  - Because it depends only on the point and its neighbours, it changes only where something new is built or the coast moves.

### Islands in the sky and bridges

- **Where islands float:**
  - Home sits at [0, 0]. Every other island keeps the `angle` the rules gave it. Ring-2 islands share their angle with a ring-1 island and sit straight out beyond it.
  - Its distance along that angle is the smallest that leaves 2.4 units of sky between its land and the land of home and every earlier island:
    - home's farthest land toward it, plus its own farthest land toward home, plus 2.4;
    - against other islands, their reach circles.
  - It is rounded up to steps of 0.65 and only grows, so islands drift apart slowly as they grow and never bump.
  - Each island floats at its `lift`. Heights don't change spacing.
- **Each bridge end's way out (`out`):**
  - Picture each island at a standard spot: home at the middle, a ring-r island r units along its angle. An end's way out is the direction from its island's standard spot toward the other island's.
  - Bridges along one angle (home to ring 1, ring 1 to ring 2) get ways out that face each other along that angle. A bridge around a ring leaves each island 112.5° from its own angle, toward the other.
  - Ways out come only from the table, never from where islands really float, so they never change.
- **Feet:**
  - A bridge's feet are placed in the replay when its link comes up, at the link's `land`.
  - Each end's foot is its free coast point nearest the line from the grid's middle along `out` (ties: the lower number), whose strip straight out (below) meets no land. Free means not a block, pad, start thing or the golden point; an existing lane is fine.
  - The foot becomes a lane point joined to that island's lanes. The points straight out from it along `out` form its **pier** (`pierOf` in `town/sky.js`). Land may grow onto the pier only in order, each point after the one inward of it, and every pier point that becomes land becomes a lane. The foot is always the pier's outermost land point, so as the island grows the foot moves out along its fixed `out`, at the end of a straight lane. Points near the deck's line ahead of the foot wait until the foot has passed them, so land never grows under a deck. (This replaced kept sky strips, which looked like cracks in the coast.)
  - An upgrade changes only the type, so it places nothing.
  - For a water slide, the layout lists the higher island's end as `from`.
- **The deck:**
  - From each foot, the deck runs straight along `out` for `clear` units: past that island's land along and beside the pier, so the bend can't pass over it. `clear` is measured along the first foot's line, so the bend only ever moves outward; as the foot moves out, `clear` shrinks.
  - Between the two straight parts, it bends smoothly across open sky.
  - Bridges along one angle are straight. Bridges around a ring bend a little when their two islands float at different distances from home, and drift moves only the bend.
  - The deck rises or falls from one island's `lift` to the other's.
- **Why bridges never cross:**
  - A bridge along an angle lies on that angle.
  - A bridge around a ring stays inside the wedge between its two angles. Every island sits on one of the eight angles, so none sits inside a wedge.
  - Two bridges in the same wedge join the inner pair and the outer pair of islands, in the same order on both angles, so they can't cross.
  - Ways out from one island are at least 45° apart (home's eight) or 67.5° apart (any other island's four), so decks leaving the same island never touch.
  - `sky.test.js` (below) tests this hard, for three full rings.
- **Kept sky per island:** home can have up to 8 bridges, and any other island up to 4 (inward, two around, outward).

### Where the view looks

- `view.island` is the island with the most helpers working there (job not null). Ties go to the island with the newest building, then home.
- `view.points` are the points of the things those helpers work at, the plaza, and the newest building on that island.
- The world only changes at check-ins. Grants change `game.change` but give the same world, so the camera stays put.

### Files

- `grid.js`: `gridFor`, rolls.
- `growth.js`: `growthOrder`, `fillLand`, and `straightOut` (the points from one point straight out to the grid's edge, for piers and bays).
- `shape.js`: notes on the world shape; `islandKey`, `townKey`.
- `samples.js`: sample towns.
- `island.js`: the per-island replay. Its helpers are in `houses.js`, `pads.js`, `lanes.js` and `nature.js`.
- `sky.js`: island places, bridge feet, ways out, `clear` and deck shape notes.
- `view.js`: where the view looks.
- `index.js`: `buildTown(game)`, cached for the same input like `buildWorld` today.
- `check.js`: `checkTown(world)`.
- `compare.js`: `compareTowns(before, after)`.
- `map.js`: `townToSvg(world)`, a flat map for reviews.

### What gets tested

- **`grid.test.js`:**
  - The same id and size give the same grid.
  - For 200 ids of each size, the usable points (less room for bays) cover that size's `maxLand`. The bays cut on the way are 3 coast buildings on any island; bridge feet keep nothing. If home's large grid can't hold 600 land with those, home gets 10 triangles from the middle.
  - Every cell has four points.
  - The first n points of any island are one piece with no holes, also with kept points skipped.
- **`town.test.js`:**
  - The same state gives a deep-equal world.
  - `checkTown` is empty:
    - land is one piece with no holes;
    - blocks, pads, start things and lanes never share a point;
    - houses and pads sit off the coast, except coast buildings;
    - every door's outside, pad front and bridge foot is a lane point;
    - each island's lanes connect;
    - every free point can be walked to;
    - coast buildings have a bay of kept sky in front;
    - islands keep 2.4 of sky between them;
    - no two decks cross, and no deck passes over any island's land;
    - every joined island can be walked to from home's plaza, over lanes and bridges;
    - every water slide runs from a higher island to a lower one;
    - the golden point is free;
    - floors are 1 to 3;
    - blocks cover at most 30% of land.
  - Single changes, each followed by `compareTowns`: one land point, one room, one floor, a new house, a pad, a coast building, a rope bridge, a fancy bridge from a surprise, and an upgrade (only that bridge's type changes).
  - `compareTowns` matches bridge ends by island, so a slide listing its higher end first isn't a move.
- **`sky.test.js`:**
  - It reads the table from `electron/core/game/sky.js`. Tests may read core code; the page never does.
  - For 50 random sets of ids, fill all three rings (24 islands) at random sizes, from start land to `maxLand`, and link every neighbour pair the table allows, in a random order.
  - Every pair gets feet. No two decks cross, no deck passes over land, and islands keep 2.4 of sky.
  - Growing one island more never changes any `out`, and moves feet only outward along their piers.
- **`long-run.test.js`** (real rules, see below).

## Scene

The new drawing is in `electron/renderer/game/scene/town/`. It is ported from the prototype's `wonky/island.js` and `bent/paths.js`. The scene draws only town worlds; anything else shows an empty sky.

### Ground, coast and underside

- **Coast:** it follows the outer edge of the land points' areas, then gets rounded: one pull toward the neighbouring points, then three rounds of corner cutting. (The prototype's `roundLoop` moved coast points far from a change, so it isn't used.) Each coast point depends only on a few points nearby. The loop always starts at the same place, so the same land gives the same list.
- **Top:** the slab is drawn from the loop with `slabGeometry` and `colourSlab`, in the island kind's grass colours (`ISLAND_GRASS`).
- **Underside, rebuilt so it only changes near new land:**
  - Each land point gets a depth from its steps to the coast, at most 5 steps: depths 0, 1.5, 2.9, 4.0, 4.9 and 5.5 for 0 to 5 steps, plus its own small roll. (The first guess, 0.3 + 0.5 per step, barely showed from Today's camera.)
  - The underside is faceted pieces below each corner piece at those depths. It meets the slab's bottom along the rounded coast.
  - A few deep points (by roll) hang a long rock drip of up to 1.2. Roots hang from coast points (by roll).
  - A land change moves depths only within 6 steps, unlike the prototype, whose single underside tip shifted with every change.

### Corner pieces

- Every cell has four points. It is cut into four corner pieces, one per point.
- Each piece looks only at its own point, its two neighbours in the cell, and the opposite point. It is drawn in a unit square and bent into the real cell, so pieces always meet without cracks (`cornerPiece` and `parts` from the prototype).
- Every piece is tagged with a key (`ctx.piece(key)`), so the stability check can compare pieces between states.

### Lanes

- These are the prototype's lane slab pieces: 0.42 of a piece wide, raised 0.022, cream, with outer corners cut and inner corners filled.
- Add `bent/`'s soft sloped rim (0.12 piece units; 0.07 barely showed), with no rim on the seams between pieces.
- A lane reaches a little under a door or pad front, and onto a bridge deck.
- Flagstones (from `bent/paths.js`) only if the gallery shows they read at Today's size.

### Block houses

- **From the prototype:** a block storey is 0.5 tall, roofs rise 0.25, and walls sit 0.17 in from the cell edge. Walls have outer and inner corners with white corner boards. A storey that steps in leaves a ledge. Eaves get white trim and a shaded underside. Small windows have frames and sills, and glass that glows at dusk. Each house has one door, on its ground-floor door side.
- **New: gables and ridges.**
  - Each top block picks a ridge line: along a straight run of same-height neighbours (two neighbours roughly opposite), or toward its one same-height neighbour. A lone block runs its ridge along its longer direction.
  - Roofs slope down from the ridge on both sides.
  - Where a ridge reaches an open end, that end is a gable: a flat triangle in the wall colour, with white boards along its sloped edges. The eave then runs only along the sides.
  - Where ridges meet at a corner, a T or a cross, roofs meet in valleys and hips, as in the prototype.
  - A thin white ridge trim runs along every ridge.
- **Also new:** chimneys on some blocks, by roll.
- Window and door choices use a roll for each piece, so they never shuffle.

### Special buildings on pads

- **Pad:** the prototype's stone pad, 0.74 of a piece wide and raised 0.05, with cut corners.
- **The model on top:**
  - It sits at the pad's middle and turns to face its front, at any angle rather than quarter turns.
  - Size: `MODEL_SCALE` 0.9 (was 0.8; models looked small on their pads in the line-up) × `thing.scale`, the pad's own fit from the layout. At 0.8 the sawmill is about one storey plus a roof, the windmill about two, the tower three.
  - A kind can override the scale in `kinds.js` if the line-up shows it looks wrong.
  - Windmill sails keep the shared wind direction.
- **Stay as models on pads:** garden, nursery, sawmill, workshop, windmill, orchard, tower, pond, great tree, grotto, quarry, beehives, forge, loom, and all five wonders.
- **Stay as one-point things:** tree, rock, bush, flower, pile, fire, seat, mushroom, crystal, golden tree, lanterns. The flower bed sits on a pair.
- **Became block houses:** the cottage (its model and `townHouse` were deleted in stage 2). The keeper's house inside the lighthouse and the kiosk on the airship dock stay as parts of those models.
- **Model fixes:**
  - The edge models read `thing.coast` instead of looking at square cells (`coastFrame` in `wonders.js`).
  - The garden's gate and the orchard's rows use `yaw`, not quarter turns (`cameraSide`).

### Bridges

All six types are in `scene/town/bridges.js`, built in code from simple shapes like the other models.

- **One path for all:** `deckPath(bridge, model)` gives the deck's middle line in world space, foot to foot. It runs straight along each end's `out` for `clear`, bends smoothly between, and eases in height from one island's `lift` to the other's. The drawing and `walk.js` both use it.
- **The types:**
  - **rope:** today's `buildBridge`: planks every 0.17, posts at each end, and sagging rope rails. The planks follow the bends and the slope.
  - **arch** (stone arch): a stone deck that humps up 0.25 in the middle, on top of the slope, with low stone walls and an arched underside with a keystone.
  - **slide** (water slide): a rounded chute from the higher foot down to the lower one. Light stripes on the water run downhill at 0.8 units a second, and a small splash pool sits at the bottom foot. A narrow stair with a hand rail runs beside the chute, for climbing back up.
  - **cloudsteps** (cloud steps): a flat-topped cloud puff every 0.45 along the path, each bobbing 0.03 up and down slowly, out of step with its neighbours.
  - **flowerarch** (flower arch): a plank walk under a hoop every 0.6, each hoop wound with leaves and flowers in the island kind's flower colours.
  - **rainbow:** a band 0.5 wide in six soft stripes that arcs up to 0.6 above the path, and glows a little at dusk.
- Every type uses the mood materials. With reduced motion, the water stripes and the clouds hold still.
- Each bridge is its own small group, at most 4,000 triangles. It is rebuilt when either island drifts, its `clear` changes, or its type changes.
- Islands without a bridge just float.

### Helpers

- They walk on the grid: from point to neighbouring point, over land points that aren't blocks, pads or blocking things (tree, rock, bush, pile, fire, mushroom, crystal, golden tree).
- Lanes cost 0.7 of grass, as now, and routes get today's corner rounding.
- **Bridges:** every bridge of every type joins its two feet along `deckPath`.
  - Crossing costs the deck's length, like grass.
  - The water slide is two-way: down the chute costs 0.5 × its length, and up the stair 1.5 ×, so helpers would rather slide down than climb.
- **Heights:** each route step carries a height, so helpers stand at their island's `lift` and follow each deck up and down. `driveHelper` already takes a `y`; it now gets one for each step.
- **How they cross:**
  - rope, stone arch, flower arch and rainbow: the normal walk.
  - cloud steps: a small hop from puff to puff, using a new `hop` move (crouch, jump about 0.12, land).
  - water slide, going down: `sitdown` at the top, then a slide down the chute sitting, at 2.5 × walking speed with arms up, a splash puff at the bottom, and `standup`.
  - water slide, going up: a walk up the stair beside the chute, with a slightly higher step bob.
- **Work spots:** walkable points next to the thing. Helpers stand a little toward it (up to 0.45 of a step).
- **Carrying:** to the nearest pile by route, otherwise to the nearest house door on the same island. Routes can cross bridges, so a helper on an island without a pile carries over to the nearest pile it can reach.
- `helpers.js` and today's plans (work, rest cycles, idle by the first tree) stay. `motion.js` gains the `hop` and slide moves. The route finding changes: `scene/town/walk.js` exports `planHelpers(model, mood)` with the same plan shape as `routes.js`.

### Moods and camera

- **Moods:** unchanged (`MOODS`, `moodMaterials`, mood hooks). Block windows use the glass material, so the town lights up at dusk.
- **Camera (decision 6):**
  - The yaw stays fixed (looking north), so the north coast stays hidden.
  - It frames `view.island` whole if helpers there stay at least 18 px tall, with a size boost of at most 1.4 (was 1.7). Otherwise it frames `view.points` plus 4 steps around them.
  - Other islands are not forced into view; they peek in at the edges.
  - A new `stage.aim(points, aspect, { ease })` moves smoothly over 2.5 s, and only when `setWorld` changes where it should look. That only happens at a check-in.
  - Mood changes never move it.
  - It jumps without moving on the first world, on resize, with reduced motion, and while hidden.
  - `capture()` finishes any move first.
- **Shadows:** the shadow area covers the framed island. Islands at the edges can go without shadows.

### Speed

**On hold (decision 10):** the budgets below are measured and reported, but they are not limits yet. Nothing is simplified for speed until the look is settled.

- Each island is its own group at its `lift`, built from the existing `Batch` (one mesh per material).
- Only islands whose part of the world changed are rebuilt (key: that island's data without the grid). An island that drifts just moves its group. Bridges are their own groups (see "Bridges").
- **Budgets for the steady planner at day 180 (5 islands), at Today's size:**
  - at most 300,000 triangles in the scene (the prototype's day-180 island alone was 84,000);
  - at most 80 draw calls;
  - a frame of 4 ms or less on average;
  - one island rebuilt in 60 ms or less, and everything in 250 ms or less.
- Keep windows as plain boxes. A heavier window took the prototype from 140,000 to 405,000 triangles.
- `buildTown` takes 30 ms or less at day 180 once grids are cached.

### Keeping today's promises

`scene/index.js` keeps:

- pausing when the page is hidden or the host is off screen, with helpers starting fresh when shown;
- `capture()` drawing a fresh frame even while paused;
- the lost drawing context: stop, then rebuild every island when it comes back;
- reduced motion: one still frame per change, and no camera moves;
- the quiet fallback without WebGL;
- the canvas hidden from screen readers.

## Gallery, tour and checks

- **Gallery views**, each in its own file under `development-tools/game-gallery/views/`. `client.js` loads them.
  - `map.js` (layout): a flat map per state day showing points, land, kept sky, lanes, blocks with floors, pads, things, bridge feet with their ways out, and decks labelled with their type. Each island is labelled with its land and `lift`. Also the growth film as maps.
  - `pieces.js` (ground, lanes, blocks):
    - grid lines on each grid size;
    - lane pieces (end, straight, bend, T, cross);
    - block pieces: a lone block, rows of 2 to 4 with gables, L, T, cross, 2 and 3 storeys, a step-in ledge, two joined houses of different colours, ridge trims, doors and windows;
    - coast and underside close-ups.
  - `pads.js` (pads, models, bridges, helpers):
    - every special model on a pad next to a 1- and a 2-storey block (the scale line-up), in focus and break;
    - coast buildings on south, east and west coasts;
    - every bridge type (rope, stone arch, water slide, cloud steps, flower arch, rainbow) in focus and break: level, sloping by the largest real drop (1.0), and bent;
    - a helper crossing each type both ways, including sliding down the water slide and climbing its stair;
    - helpers walking and working on the grid.
  - `town.js` (scene):
    - real states at days 1, 7, 21, 30, 40, 60, 90, 130 and 180, large and at Today's size (591 × 357) with the follow camera;
    - the growth film on one page;
    - all four moods at day 180;
    - before and after a check-in that moves the camera;
    - a speed view showing triangles, draw calls, frame time and rebuild time.
- **States:** `make-states.js` writes the steady planner at days 1, 7, 21, 30, 40, 60, 90, 130 and 180, plus day 180 for the other four people, all from the real rules. They go in `states/town/<person>-day-<n>.json` and reach views as `tools.data.town.states`; `--commit <ref>` makes them from the rules as committed at that point. The old square `states/day-*.json` were deleted in stage 2.
- **Tour** (`scripts/game-tour.sh`): the same scenes. After the week check-in, it waits 3 s and adds `08b-after-check-in` to show where the camera settled.
- **Long-run check:** `electron/renderer/game/town/long-run.test.js` checks that nothing moves from day 1 to day 180 on the real rules.
  - For each person in `PEOPLE`, `sim.run(person, 180, { snapshots })`: every day for the steady planner, every 7th day and day 180 for the others.
  - For each snapshot: `buildTown`, an empty `checkTown`, and `borrowed` = 0. That includes no crossing decks and no deck over land.
  - For each pair of neighbouring snapshots, an empty `compareTowns`. That includes no island's `lift` changing and no bridge end moving.
  - Islands differ by age: the land targets in "Pacing" (home largest, new islands at least 1.4 × apart) hold here too, so the layout's drawings come from varied islands.
  - The whole file runs in under 30 s.
- **Drawing check:** `electron/renderer/game/scene/town/stability.test.js` does what the prototype's `wonky/check.mjs` did, with real rules.
  - It uses the steady planner's states at the film days, with every piece logged.
  - Between neighbouring days:
    - every changed piece is within 2 grid steps of a changed point (the underside within 6);
    - no built thing's pieces change unless its own points did;
    - coast points move only within 1.3 units of changed land.
  - Drawing the same state twice gives identical pieces.
  - Single changes at day 180 (one land point, one room, one floor, a new house, a pad) stay within the same limits.
  - A bridge upgrade changes only that bridge's pieces, and nothing on either island.

## Work streams

Agents work in parallel, and each owns its files. Nobody edits another stream's files; ask its owner instead. The shared files are written first, in stage 0.

| Stream | Owns | Needs |
|---|---|---|
| **0. Shared files** (one agent, first) | `electron/renderer/game/kinds.js`; `town/grid.js`, `town/growth.js`, `town/shape.js`, `town/samples.js`, `town/grid.test.js`; `scene/town/pieces.js`; the town sizes and `HOUSE_LOOKS` in `scene/style.js`; empty versions of every function named below, so imports work from day one | the prototypes |
| **A. Rules** | `electron/core/game/` (`rules.js`, `play.js`, `simulate.js`, `index.js`, `version1.js`, a new `sky.js` with the sky table, `game.test.js`, `pacing.test.js`); the game dev scenarios in `electron/core/index.js` if they need a change; a throwaway converter in `electron/renderer/game/layout/index.js` (the square island draws every link as a rope bridge and ignores `lift`) | nothing |
| **B. Layout** | everything else in `electron/renderer/game/town/`, and later the deletion of `layout/`; `development-tools/game-gallery/views/map.js` | stage 0; A for real states |
| **C. Ground, lanes, blocks** | `scene/town/pieces.js` (after stage 0), `ground.js`, `lanes.js`, `blocks.js`, `pieces.test.js`; `views/pieces.js` | stage 0 |
| **D. Pads, models, bridges, helpers** | `scene/town/pads.js`, `bridges.js` (all six bridge types and `deckPath`), `walk.js`, `walk.test.js`; `scene/models/`; `scene/helpers.js`, `scene/actors.js`, `scene/motion.js` (the `hop` and slide moves); later the deletion of `routes.js` and the cottage; `views/pads.js` | stage 0 |
| **E. Scene glue and camera** | `scene/town/world.js`, `scene/town/build.js`, `scene/town/stability.test.js`, `scene/town/town-scene.test.js`; `scene/stage.js`, `scene/core.js`, `scene/index.js`, `scene/style.js` (after stage 0); later `electron/renderer/game/index.js` and the deletion of the square scene files; `views/town.js` | C and D's functions |
| **F. Gallery shell and tour** | `development-tools/game-gallery/` `build.js`, `client.js`, `make-states.js`, `states/`, `styles.css`; `scripts/game-tour.sh` | A for states |

**Function names agreed in stage 0:**

- `town/index.js`: `buildTown(game) → world`. `town/check.js`: `checkTown(world) → [problems]`. `town/compare.js`: `compareTowns(before, after) → [problems]`.
- `scene/town/world.js`: `parseTown(world) → model`, with `islands[]` holding `{ id, kind, grid, at, lift, land: Set, lanes: Set, floors: Map, look: Map, doors, kept }`, plus `things`, `bridges`, `helpers` and `view`, all in world positions. Each bridge end becomes `{ island, at: [x, y, z], out, clear }`, with `y` its island's `lift`.
- `scene/town/ground.js`: `buildGround(ctx, island) → { loop, framePoints }`. `lanes.js`: `buildLanes(ctx, island)`. `blocks.js`: `buildBlocks(ctx, island)`.
- `scene/town/pads.js`: `buildThings(ctx, island, things)`. `bridges.js`: `deckPath(bridge, model) → [[x, y, z], ...]` and `buildBridge(ctx, bridge, model)`, which picks the drawing by `bridge.type`. `walk.js`: `planHelpers(model, mood)`.
- `ctx` is today's model context from `scene/build.js` (`batch`, `materials`, `root`, `dynamic`, `palette`, `add`, `blob`, `onMood`, `track`), plus `piece(key)` for the stability check.

## Stages

Each stage ends with the app still working.

**Stage 0: shared files.** One agent writes the stream 0 files, porting the grid, growth order and corner pieces from the prototype. In `kinds.js` it gives every kind a `foot` and, for buildings, `pad: true`, and adds `MODEL_SCALE = 0.8`, `BLOCK_BLUEPRINTS = ['house', 'room', 'floor']` and `BRIDGE_TYPES`. It keeps `size` and `cottage` until stage 2, because the square layout still reads them. `samples.js` makes three small towns in the world shape by replaying scripted events, like the prototype's `film.js`, so the scene streams can draw before the layout is done.

- Between them, the samples show every bridge type, an island with three bridges, a loop, a bent bridge around a ring, islands of clearly different sizes with home the largest, and lifts from −0.5 to 0.5. One water slide drops the full 1.0.
- Their bridges join only sky-table neighbours, and their ends carry `out` and `clear`.

- Done when `npm test` passes, the sample towns pass `grid.test.js`'s shape check, and Today is unchanged.

**Stage 1: build in parallel, away from Today.** Streams A to F at once. A goes first because it's small. B's long-run check and F's states need its version-2 rules.

- **A is done when:**
  - `node --test electron/core/game/` passes with the version-2 rules and the new town targets;
  - Today still shows the square island through the converter (version-2 land ÷ 7, `house` drawn as a cottage, rooms and floors left out);
  - the tour's `10-month` scene still draws.
- **B is done when** the grid, town and long-run tests pass on the real rules with nothing borrowed, and the map view shows days 1 to 180.
- **C, D and E are done when:**
  - their tests pass, including the drawing check;
  - the gallery shows the pieces, houses, the scale line-up, coast buildings, every bridge type with helpers crossing, the film from real states, the moods, and speed within budget.
- **F is done when** the views load and the states are written.
- Screenshots of the pieces, houses, line-up, film and moods are shared with the user.

**Stage 2: the town on Today.**

- E switches `electron/renderer/game/index.js` to `buildTown` and the scene to the town path only.
- D switches `actors.js` to `walk.js`.
- A removes the converter.
- Each stream deletes its square-grid code:
  - B: `layout/`;
  - D: `routes.js`, the cottage model and `townHouse`;
  - E: `world.js`, `sample-worlds.js`, the square parts of `build.js`, and `outlineLoops`, `traceCorners`, `loopToWorld`, `pathStones` and `mergeStraight` in `ground.js`;
  - F: the square gallery views;
  - stage 0's owner: `size` and `cottage` in `kinds.js`.
- F updates the tour.
- Done when:
  - `npm test` and `npm run check:source` pass;
  - nothing imports `layout/` or `routes.js`;
  - `scripts/game-tour.sh` shows the town in every scene with `appActive=false`;
  - the screenshots have been shared with the user.

**Stage 3: the look, with the user.** The user reviews the film, the line-up and the tour. Agents fix what they flag and tune the numbers: land per break, model scale, underside depth, decoration density, gables, lane flagstones.

- Done when the user is happy with the tour and the film.

## Gotchas found while planning

- **Stored values:** the store silently turns date-like text under the names `day`, `start`, or `end` into numbers. Give game values other names.
- **Unique keys:**
  - A repeated unique key throws an error and undoes the whole save. Check for the key first, or skip ones that already exist.
  - Put the rules version in the record, not in its unique key.
- **Order and days:**
  - Some records are backdated, so saved order and clock order can differ. Use saved order for "after the game started", and say which order each rule uses.
  - Days follow the Mac's time zone, and Testing runs use a fake clock. Pass day boundaries into the rules instead of reading the clock.
- **Speed:** reading every record takes about 100 ms on six weeks of history, and the core already does this after each change. The game must not add a second full read. Read only the record kinds it needs, or add only the new records.
- **Tests and the tour:**
  - `npm test` runs every `electron/**/*.test.js`.
  - The dev app marks you away after 5 seconds without input, so the tour sets activity before each capture.
  - Smoke tests use a hidden window, so everything must work when the scene never draws.
- **The page:**
  - Mark the canvas as hidden from screen readers, and respect the reduce-motion setting.
  - Handle the drawing context being lost and restored.
- **The town:**
  - Round grid points to 4 decimals and never compare raw positions. Tests compare rounded text, as the prototype's check did.
  - Grids are big. Don't copy or stringify them on every status tick: `buildTown` hands out the shared frozen grid, and change checks use `grid.key`.
  - Kept sky only ever applies to points that aren't land yet.
  - Layout code also runs in Node, for the gallery build and the tests, so keep `town/` free of the DOM.
  - The north coast is hidden from the camera. Keep coast buildings off it unless nothing else fits.
  - The gallery builds the layout in Node and hands the result to the page. The grids make that data larger; keep an eye on the gallery page's size.

## Decisions made (by the user)

1. **Acorns go.** They were a placeholder. Remove acorn earning, the shop, the acorn counter on Today, the acorn total in History, and the reward preview in Settings. Previously earned acorns are thrown away and don't carry over. Their old records stay in the saved history, because records are never deleted, but nothing reads or shows them.
2. **Fresh start.** The game starts on the day it's turned on, so the island starts tiny. Past weeks don't count.
3. **The island replaces the pixel garden on Today.** Delete the placeholder garden (`garden-scene.js` and its styles).
4. **Anything that interrupts waits until you're back from a break.** That includes the check-in, choices, and celebrations. Ending focus is exactly when you should be stepping away, and break growth is only known once the break is over. The check-in waits on Today until you open the window. Collecting is one tap on a small card, because that tap is the "cash in" moment.
5. **The islands become a Townscaper-style town.**
   - **Grid:** each island gets its own uneven grid, made from triangles joined into four-sided cells. It is seeded from the island id and sized for the island's largest size, so growth only fills more cells.
   - **Houses:** houses grow block by block and join their neighbours.
   - **Special buildings:** the sawmill, windmill, wonders and the rest sit on small flat pads.
   - **Paths:** joined lanes, not stepping stones.
   - **Change stays local:** only pieces right next to a change reshape, and nothing farther away moves.
   - **Settled by two look prototypes** on the branch `prototype/town-grid`:
     - `bent/`: square grid, bent drawing, joined paths;
     - `wonky/`: the full town, with a growth film from day 1 to day 180.
   - **Next step:** this replaces the square-grid layout and ground drawing built in stages 1 to 5.
6. **The view follows the action.** It frames the island where helpers are busiest, close enough to see them, with other islands peeking in at the edges. It moves only at a check-in, and slowly.
7. **Homes are a choice whenever they fit.** A new house, a room or a floor can be one of the 2 or 3 build options at any check-in where there's room, not only when a helper needs a bed. Blocks cover at most 30% of an island.
8. **Bridges form a network, and some are fancy.**
   - An island can have more than one bridge. A new island's first bridge joins its nearest island that is already joined: often home, not always.
   - Later rope bridges join neighbouring islands that aren't directly joined yet, so routes form loops. Bridges never cross each other or pass over another island.
   - Fancy bridges arrive as surprises: a stone arch, a water slide, cloud steps, a flower arch, and a rare rainbow. A surprise either adds a fancy bridge between two neighbours that aren't joined, or turns a rope bridge into a fancy one. An upgrade changes only the look; the bridge's ends never move.
   - The rope bridge stays the one you build.
   - Helpers walk every type. The water slide works both ways: they slide down it and climb the steps beside it.
9. **Islands differ in size and float at different heights.** "Lack of uniformity is pleasing to the eye."
   - Home is always the largest, because it's the oldest. Older islands are generally bigger, and each island has its own appetite for growth, so sizes vary. Every island still keeps growing a little.
   - Each island floats at its own height: home in the middle, others a little above or below. Bridges slope between them, and a water slide always runs downhill.
10. **Pretty first, fast later.** Make the town look nice now. Don't simplify models or merge pieces to meet the speed budgets; that work comes later, once the look is settled.
