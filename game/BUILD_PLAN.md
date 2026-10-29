# Game build plan

The plan for building the sky-island game for real. [NOTES.md](NOTES.md) has the design. The prototypes it draws on are on the branch `prototype/sky-island-game`. This is a draft until the user answers "Decisions needed" at the bottom; the defaults shown there are the plan until then.

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

Game records are new kinds, so they never mix with acorn totals (the acorn balance adds up every `rewardGranted`). Each carries the rules version inside it. Its unique key names only its source, for example `game:grant:wood:<sessionID>`, so a rules change can't grant twice.

- `gameStarted`: the line after which history counts. Only one ever exists.
- `gameGranted`: one resource from one finished focus session, break, or day. After each saved change, the core writes any grant that's due and missing. Once written, the amount never changes, so new numbers never rewrite the past.
- `gameOfferShown`: the 2 or 3 blueprints shown at a check-in. Saving it means a later rules change can't alter a past offer.
- `gameChosen`: the blueprint picked from one offer.
- `gameHelperAssigned`: a new helper's job.
- `gameCheckedIn`: what was collected and celebrated.

Two small additions to existing records, from now on: a break notes which focus session it follows, and a focus session notes why it started (a suggestion, after a break, after a snooze). Starlight needs both.

The page gets a small `game` summary (a change number and whether a check-in is waiting) in the once-a-second status. It asks for the full world only when the change number moves.

## Stages

Each stage is done when:

- its rules tests pass
- the gallery and the screenshot tour show its changes
- the screenshots have been shared with the user

1. **The tiny island on Today.** This is the thinnest path through every piece.
   - Add the `gameStarted` record, and rules that return the starting island: one tree, one rock, one helper.
   - Build one-island layout, and the scene in style D in place of the pixel garden. Focus and break change only the light and sky.
   - Make the live timer update in place, so the canvas survives Today's once-a-second refresh. This also fixes clicks that get lost when a refresh lands mid-click.
   - Pause drawing while the window is hidden. When it's shown again, put the helpers back at their starting spots.
   - Have the screenshot command ask the scene for a fresh frame before it captures.
   - Fix the coastline so diagonals come out straight: trace through the cell-edge midpoints and merge points that lie on one line before rounding.
   - Start the gallery, and the tour scenes (focus, break, break due, away, day done) with dev scenarios that create game records in Testing.
2. **Earning and check-ins.** Focus earns wood and stone, and breaks earn soil and saplings on the 10/20-minute curve.
   - Grants are saved as sessions close, and they appear on the island only at a check-in.
   - Add the check-in card, and the "next up" line when there's nothing to choose.
   - Acorns stop being earned (see the decisions below).
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

## Decisions needed

These are the plan's current defaults. The user can change them.

1. **Acorns.** The game replaces them. Acorns stop being earned once the game starts. The acorn counter on Today and the reward preview in Settings go away; the counter also breaks the "no score on screen" rule. Old acorn records stay in the history. The shop already has no screen.
2. **Old history.** The game starts fresh on the day it's turned on, so the island starts tiny. Past weeks don't count.
3. **Where it shows.** It replaces the pixel garden on Today.
4. **Check-in timing.** The check-in is ready when you come back from a break, rather than the moment focus ends. Ending focus is exactly when you should be stepping away, and break growth is only known once the break is over. It waits on Today until you open the window. Collecting is one tap on a small card, because that tap is the "cash in" moment.
