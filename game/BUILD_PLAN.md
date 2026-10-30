# Game build plan

The plan for building the sky-island game for real. [NOTES.md](NOTES.md) has the design. The prototypes it draws on are on the branch `prototype/sky-island-game`. The user's decisions are at the bottom.

## How the pieces fit

- **Rules**, in `electron/core/game/`, run in the app's main process next to the timer.
  - They read the saved history from the day the game started and work out the game state: resources, islands, buildings, helpers, and whether a check-in is waiting.
  - The rules never read the clock and never use plain randomness. A "dice roll" comes from mixing a saved record's id with what the roll is for, so a new roll never changes old results.
  - Starting numbers come from `DEFAULT_RULES` and the lists next to it in the pacing prototype. Its pure helpers (`isRealBreak`, `restValue`, `focusOnPlan`, `priceOf`, `islandDueAt`, `helperDueAt`, `teaser`) carry over. Its made-up day loop and its auto-picking player don't.
- **Layout**, in `electron/renderer/game/layout/`, is plain code with its own tests and no 3D. It turns the game state into a map: island shapes, building spots and which way buildings face, paths, bridges, and where each island floats. The same state always gives the same map, and things already placed never move. Its seeds come from each island's id and its own grid, not from world positions. It starts from the prototype's `kit/model.js` (route finding, helper plans) and the `kit/worlds.js` format.
- **Scene**, in `electron/renderer/game/scene/`, is Three.js and draws the map in the chosen style D. It holds nothing worth saving. It starts from the prototype's `kit/ground.js`, `kit/parts.js`, `kit/helpers.js`, `kit/build.js`, the models in `variant-d-townscaper.js`, and `createRig`, `pose`, and `driveHelpers` in `shared.js`. Variants B, C, and E and the switcher are thrown away.
- **Gallery**, in `development-tools/game-gallery/`, follows `development-tools/forecast/` and never ships. It shows every model in both moods, each helper animation, and islands built from made-up states at days 1, 7, 30, 90, and 180.

The scene is built as a second script, `game.js`, next to `app.js`, because packaging copies only `electron/`. Pin `three` to the version the prototype used (0.186.1).

## New saved records

Game records are new kinds, separate from the old acorn `rewardGranted` records. Each carries `rulesVersion` inside it. Its unique key names only its source, so a rules change can't grant twice.

- `gameStarted` (key `game:started`): the line after which history counts, in saved order. Only one ever exists. The core writes it the first time it opens a database without one. It also stores the starting land and supplies, so a rules change can't rewrite the start.
- `gameGranted`: what one finished focus session, one rest, or one whole day earned, as `{ rulesVersion, source: 'focus' | 'rest' | 'day', sourceID, dayKey, amounts: { wood, stone, ... }, restMinutes }`. Keys: `game:grant:focus:<sessionID>`, `game:grant:rest:<sessionID or away id>`, `game:grant:day:<dayKey>`. After each saved change, the core writes any grant that's due and missing. Once written, the amount never changes, so new numbers never rewrite the past.
- `gameCheckedIn` (key `game:checkin:<number>`): one tap on the check-in card. It stores everything that happened: what was collected, new land, arrivals, the surprise, firsts, and the choice made (or none). The game state is these records added up, plus the next check-in worked out from grants since the last one. A rules change only affects check-ins that haven't happened yet. The card carries a `token`; a tap with an old token is refused, so a card that changed underneath can't pick the wrong thing.

A rest is a confirmed break (`breakConfirmed` + `breakEnded`), or time away during focus that the core counted as a break (from now on, its `awayEnded` notes `countedAsBreak`, `restSeconds`, and `targetSeconds`). Two small additions to existing records, from now on: `breakStarted` and a counted `awayEnded` note `followsSessionID` (the focus session just before), and `focusStarted` notes `reason` (`suggestion`, `afterBreak`, `snooze`, `manual`). Starlight needs both. Older records without them fall back to "the last focus session before it in saved order".

The page gets the game state as `status.game` in the once-a-second status. The core works it out only when the saved history changes, from the events it already read.

## Shapes passed between the pieces

**Game state** (rules → page). Amounts can have fractions; the page shows whole numbers.

```js
{
  rulesVersion, change,                 // change: saved order of the newest game record
  onHand: { wood, stone, planks, soil, saplings, starlight },
  waiting: { ... },                     // earned since the last check-in
  islands: [{ id, name, kind, size, land, golden,   // kind: home | mossy | rocky | meadow | crystal | misty
    buildings: [{ id, blueprint, name, landWhenBuilt, checkIn }] }],
  links: [{ id, from, to }],            // rope bridges between island ids
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

`land` is the island's number of building spots. The home island starts with 4. Buildings are listed in the order they were built, and `landWhenBuilt` lets the layout replay growth so nothing already placed moves.

**World** (layout → scene). One shared square grid for all islands.

```js
{
  islands: [{ id, kind, origin: [c, r], rows: ['..ggpg..', ...], heights }],  // '.' sky, 'g' grass, 'p' path
  things: [{ id, kind, island, c, r, w, h, facing }],  // c, r: top-left cell on the shared grid; facing 0 south (toward camera), 1 east, 2 north, 3 west
  bridges: [{ id, from: [c, r], to: [c, r] }],         // two coast cells on one row or column
  helpers: [{ id, name, job, island }],
}
```

Thing kinds, their sizes, and which job works at each live in `electron/renderer/game/kinds.js`. Layout and scene both read it. A thing kind is a blueprint id or a natural kind (tree, rock, bush, flower, pile, fire, seat, mushroom, crystal).

**Scene** (`electron/renderer/game/scene/`): `createIslandScene(host)` returns `{ setWorld(world), setMood(mood), capture(), dispose() }`. Mood is `focus`, `break`, `away`, or `done`. `capture()` resolves after a fresh frame is drawn. It stops drawing when the page is hidden or the host is off screen, and puts helpers back at their starting spots when it's shown again.

**Page glue** (`electron/renderer/game/index.js`, built as `electron/renderer/game.js`): sets `window.cozyGame = { mount(host), show({ game, mood }), capture() }`. It runs the layout and hands the world to the scene.

## Stages

Each stage is done when:

- its rules tests pass
- the gallery and the screenshot tour show its changes
- the screenshots have been shared with the user

1. **The tiny island on Today.** This is the thinnest path through every piece.
   - Remove the placeholders: acorns, the shop, and the pixel garden (see the decisions below). Update the core tests and `ui-smoke.sh` checks that expect acorns.
   - Add the `gameStarted` record, and rules that return the starting island: one tree, one rock, one helper.
   - Build one-island layout, and the scene in style D where the pixel garden was. Focus and break change only the light and sky.
   - Make the live timer update in place, so the canvas survives Today's once-a-second refresh. This also fixes clicks that get lost when a refresh lands mid-click.
   - Pause drawing while the window is hidden. When it's shown again, put the helpers back at their starting spots.
   - Have the screenshot command ask the scene for a fresh frame before it captures.
   - Fix the coastline so diagonals come out straight: trace through the cell-edge midpoints and merge points that lie on one line before rounding.
   - Start the gallery, and the tour scenes (focus, break, break due, away, day done) with dev scenarios that create game records in Testing.
2. **Earning and check-ins.** Focus earns wood and stone, and breaks earn soil and saplings on the 10/20-minute curve.
   - Grants are saved as sessions close, and they appear on the island only at a check-in.
   - Add the check-in card, and the "next up" line when there's nothing to choose.
   - Add a long-run test that feeds months of made-up days through the real rules and checks the pacing targets:
     - about 3 choices on day 1
     - the first new island around active day 9
     - the first wonder around active day 22
3. **Building.**
   - Offers of 2 or 3 blueprints, a choice, and the layout placing the building.
   - Break minutes add land, and islands grow as rounded shapes next to what's built.
   - Repeat items cost more and fill at most a quarter of an island.
   - Fill the lawn with yards, fences, and flowers along paths.
   - Taller walls and lower roofs, so houses read from above.
4. **Helpers.**
   - Helpers arrive by active days, you pick each one's job, and they have names.
   - Buildings feed each other, for example logs to the sawmill to planks.
5. **Starlight and wonders.** Earned by sessions and days that follow the plan, and spent on the five wonders.
6. **More islands.**
   - Island kinds and sizes, bridges, and islands drifting apart.
   - A camera that never lets helpers shrink to specks.
7. **Surprises and firsts.** Rare surprises from keyed dice rolls, and celebrated firsts.

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
  - `npm test` only runs `electron/core/*.test.js`. Widen it to include subfolders.
  - The dev app marks you away after 5 seconds without input, so the tour sets activity before each capture.
  - Smoke tests use a hidden window, so everything must work when the scene never draws.
- **The page:**
  - Mark the canvas as hidden from screen readers, and respect the reduce-motion setting.
  - Handle the drawing context being lost and restored.

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
