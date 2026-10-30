# Later

Things we chose to leave for later, so the town could reach a whole stopping point first. Each one says what it is, why it waited, and where to start. [BUILD_PLAN.md](BUILD_PLAN.md) has the plan these come from.

## The look (stage 3, with the user)

- **Roofs from the Today camera.** A roof whose ridge runs across the view can read as a flat lid. The roof height went from 0.25 to 0.3 to help (`roofRise` in `electron/renderer/game/scene/style.js`). Still to try: a gable at three-way row ends, which get a hip today, and a stronger ridge trim. Code: `scene/town/blocks.js`.
- **Bridge feet.** Each bridge foot used to leave a thin strip of sky that looked like a crack. The layout now turns it into a pier, and coast buildings move aside. Look at it again in the gallery's map and pads views.
- **How close the camera sits.** Mostly done: between check-ins the camera now drifts slowly. It rests on the busy view, pulls back to the whole group now and then, and visits each other island framed whole. It also sways (the default): it turns slowly up to 14° each way and back, one swing every 150 s, even with one island (BUILD_PLAN "Moods and camera", `scene/drift.js`). Left to judge by eye:
  - The speed and rest times (`DRIFT` in `drift.js`), watched in the real app for a few minutes, not only in still pictures.
  - Whether shadow edges crawl faintly while the camera moves. The shadow box moves in whole texel steps, but the soft-edge filter's grain is fixed to the screen, so it may shift a little against the ground.
  - The sway's speed and size (`SWAY` in `drift.js`), watched in the real app for a few minutes. Both ends of the swing were checked in still pictures (gallery `#town-sway-first` to `#town-sway-today`): the north coast stays hidden, join-wall windows look right, and no model, bridge or pier shows a hole. Its wider fit sometimes makes the shadow box one step bigger, so shadows are a little softer; check that they still read.
  - From about day 60 the busy view is close, so the town still shows under the page's resource bar at home.
  - The drift and sway clocks keep running while the window is hidden (nothing is drawn). When the window is shown again, the camera may be mid-trip or turned, rather than at home facing north.
- **Numbers to tune by eye:** land per break, model size on pads (`MODEL_SCALE` 0.9 in `kinds.js`), underside depth, how many trees and flowers, lane stones.
- **Shadows at dusk.** The tree's shadow used to print as a hard box on the grass apart from the tree in the break and away moods. The dusk sun now stands higher with softer edges, which fixed it but made dusk shadows shorter and less dramatic. Shadows are also faint in focus.
- **Small things a look review saw** (pictures were in `/tmp/look/`, which the Mac clears; the gallery sections are named so they can be found again):
  - the miner stands partly inside the rock (`#helpers-work`);
  - helpers' heads peek over shed roofs at day 30;
  - the airship pier's struts read as legs standing on nothing, because the airship hides the pier (`#pieces-bay`, `#pads-coast`);
  - from day 30 the old tree's crown nearly touches the yellow roof beside it (hidden from Today's camera);
  - at night the lighthouse beam sweeps through the market stall.
- **Lanes that meet a pad or door at a slant.** In real layouts, 13 of 315 pads and 2 of 71 doors are reached by a lane in a V shape, because of where the front point sits. Fixing it means changing how the layout picks a front, which would move many buildings.
- **Where a lower roof meets a taller wall.** A little sunlight can slip through the notch where a tall block steps down to a lower one, leaving a thin lit sliver in the house's shadow. Today's camera never sees it, so it was left: the sun always comes from the camera's side, even at the ends of the sway, where the shadow behind a stepped house looks the same as in the middle. The real fix is running the lower roof up to the wall, which changes how steps look. Walls just behind a lower roof now get windows only when they face the camera, which removed window frames poking out along the roof.
- **A lane tip under a gable corner.** The review saw a small shard under the left corner of a gabled wing, which turned out to be the tip of a lane end. The smoother lane ends added afterward may have fixed it; check in `#blocks-real`.
- **Town planning by eye:** at day 180 the main row of houses reads as one long wall of roofs; the day-30 town has four windmills and a lighthouse in the middle of town. Both come from where the layout puts things.
- **The check-in card** is now a slim strip that covers about a quarter to a third of the island (look C, the user's pick). The camera doesn't make room for it; it's only up briefly.

## Speed (decision 10: pretty first, fast later)

At day 180 the scene draws about 590,000 triangles, about twice the old budget of 300,000. Most are the things on the islands (trees, flowers, buildings), then ground and lanes, then houses. Laying out the town and building the scene takes about half a second at day 180 (about 0.1 s for the layout), each time the game changes, not every frame. A month-old town takes about 0.3 s. Fine on this Mac for now. Where to start when it matters:

- share one shape for repeated models (trees, flowers, stones) instead of a copy each;
- use simpler models when the camera is far away;
- lay the town out once and add only what changed, instead of from scratch;
- the "Speed" part of BUILD_PLAN.md has the old budgets and test plan.

## The game

- **Month-three pacing:** about 5.6 choices a week for the steady planner, inside the 2.5 to 6 target but near the top. Check after people play for real.
- **Borrowed land on unusual histories.** On the five made-up people, the layout never needs land the rules didn't give. On eight other random histories it still borrowed 17 points in total (early home pads, one observatory, one house), spread out with no common cause. Borrowing only makes an island a little bigger than the rules say, so nobody would notice. One risk not yet seen on the real rules: a 3×3 observatory sent to a small young island.
- **Hedges.** When a full island squeezes a special building in, any free point it cuts off gets a bush (a "hedge"), so nobody has an unreachable spot. It happens twice in 180 days for one made-up person. It looks like a plain bush; it could get its own hedge model.
- **An island with no pile and no house** sends its workers across a bridge to another island's pile. Cute, but maybe give it its own small pile.
- The first bridge to a new island picks inward twice as often as sideways, and outward only once there are nine or more islands.
- **Things noticed while building the game demo** (`scripts/run-game-demo.sh`). Left alone so the user can judge them by playing:
  - a break too short to count (under 7.5 minutes) still brings a card;
  - an end-of-day card left unpicked shows "Back from your break" the next morning;
  - a day with focus but no real break doesn't count as an active day;
  - after a month, resources pile up (about 1,600 wood, 71 Starlight), so spending may be too slow;
  - after one day the island looks almost the same as the morning.

## Code tidying

- Unused since the square island was deleted, kept to avoid a wider tidy-up: `slabGeometry`, `colourSlab`, `undersideGeometry` and `noise2` in `scene/ground.js`, `decor` in `scene/models/nature.js`, and `stage.frame` (used only by a test).
- `town/samples.js` still keeps a sample bridge's whole pier as sky, while the real layout now grows land onto piers. The samples are only for tests and the gallery.
- The gallery's `#town-speed` table shows the layout at 0.0 ms because it times a cached result. `views/town.js` also still says dots "stand in for undrawn ground", which is out of date.
- `scene/town/build.js` and `scene/core.js` could share the helper size rule, `islandFrame` and `closePoints`. `development-tools/game-gallery/views/pads.js` copies them today.

## The rename to Focus Islands

The app, icon, menu bar and docs say Focus Islands. Some inside names still say Cozy Focus Pet on purpose, because changing them would lose the saved history or break the Chrome extension link. The list and the safe order to change them are in `.build/agent-plans/rename-later.md`:

- the data folder `~/Library/Application Support/CozyFocusPet` (holds Personal history; needs a careful move);
- `COZY_FOCUS_*` settings, the bundle id, the program name (Activity Monitor still shows "CozyFocusPet"), and the Chrome host id;
- the project folder and repo name;
- `brainstorming.html` and other old development pages (the gallery's title is already updated).

## The timer (outside the game)

- **A session that sleeps across midnight loses its sleep time** (for example, a break from 11:50 PM to 12:22 AM shows 2 minutes). **Decided: leave it.** The user never works across midnight. Awake, the app loses at most about 30 seconds at midnight. The cause, if it ever matters: a new day reloads the timer from its last save and forgets sleep in progress (`syncDay()` → `load()` → `Timer.recover` in `electron/core/index.js`).

## Development app

- The Dock icon flashes for about a fifth of a second when the development app starts.
- Clicking the Testing menu bar island opens a menu instead of the window. Nobody has tried it with a real click yet.
