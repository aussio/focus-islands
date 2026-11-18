# Game notes

Notes for the game side of Focus Islands: an idle game where the only income comes from real focus and real breaks, with rewards for following the day's plan closely. The game replaced the old acorns, shop, and pixel garden, and it started fresh with nothing carried over.

## Prototypes (kept on a separate branch)

Two throwaway prototypes are saved on the branch `prototype/sky-island-game`. They are a record only, so never merge it. Read files with `git show prototype/sky-island-game:<path>`, or open the branch in its own folder with `git worktree add`. The commit message lists the question each prototype answered and its answer.

- **Pacing:** `game/prototypes/pacing-prototype.html` is a single page that plays five kinds of user through months of the game. It produced the numbers under "Pacing defaults".
- **Look:** `electron/renderer/island-prototype/` is a Three.js scene shown on the Today page in development Testing runs. It has four styles, B to E; style D was picked. `kit/` is a grid tile kit: islands as text grids, ground drawn from the grid, helpers finding routes, and bridges. Screenshots are in `game/prototypes/screenshots/`, the user's reference images are in `game/prototypes/art-references/`, and the scripts used to take screenshots and measure CPU are in `game/prototypes/tools/`.

## Game direction (agreed so far)

Inspired by Minecraft Skyblock (start tiny, end huge) and Tower Wizard (workers you assign to jobs). It must stay a calm thing beside work, never a game that pulls you away from it.

**Pitch:** a tiny floating island in the sky with one tree, one rock, and one helper. Helpers work while you focus. The island grows while you rest. Every so often you spend a few seconds picking what to build next. Over weeks it becomes a sky village spread across several islands.

**Focus makes things, breaks grow things:**

- Focus time earns building materials (wood, stone, planks).
- Break time earns growth (water, soil, new land, crops, flowers). Water is caught from the sky while you rest, and most buildings need a little. It starts a water theme that can grow later: waterfalls, rain clouds, fountains, bird baths.
- Building needs both. Skipping breaks takes nothing away, but materials pile up with nowhere to put them. The islands only get bigger when you rest.
- **Starlight** is a rare third resource earned by following the day's plan closely. It unlocks special things, such as a lighthouse, an airship dock, or a new island.

**The live scene is just something to look at:** during focus and breaks, helpers move around the islands and look busy in believable ways, like watching ants. Nothing on the island changes while you watch. Collected materials, new buildings, and new land appear only at a check-in.

**Check-ins:**

- A check-in is ready when you come back from a break. Anything that interrupts you waits until then, never at the moment focus ends. It waits on Today until you open the window.
- You collect with one tap what the helpers made and, if you can afford something, pick 1 of up to 3 blueprints, or collect and save. The aim is about 10 seconds.
- Many check-ins have nothing to decide yet because you haven't earned enough. Then you just collect.
- Start with this and watch whether it distracts. Make it smaller if it does.

**Helpers:** every helper starts out the same. When a new one arrives, you choose which job or resource they work on. Buildings feed each other, for example logs to the sawmill, planks to houses, and houses to more helpers.

**Look:**

- An angled, mostly top-down view like a classic base-builder game.
- Helpers are tiny and in scale with buildings and trees, like a small colony at work.
- Art direction: bright, saturated colours that are easy to read, with a softer, more crafted, artistic feel. Rounded or bevelled shapes, chunky and simple, and less busy than the references.
- Look-test feedback: the "clay" style felt the most artistic, and the blocky style was the most readable. Neither looked right on its own.
- **Chosen look:** the Townscaper-like style (D in the art prototype). It has bright, colourful houses with white trim and sharp roofs, angular grey-lilac rocks, faceted trees, and rope bridges. The ground has a soft rounded edge, and the underside is faceted with hanging roots. In break mood there is a dusk sky with stars, glowing windows, and a campfire. Keep the colours and brightness, and keep shapes crisp: small bevels, not puffy. Clay shapes don't fit the grid, so they're out. `D-grown-focus.png` and `D-grown-break.png` on the prototype branch show the target. Decision 5 below later replaced its square grid and stepping-stone paths.
- References (on the prototype branch, in `game/prototypes/art-references/`):
  - a cozy room diorama (too busy)
  - a stylized island city
  - a medieval village builder
  - Townscaper (not saved)

**World structure (the art must support this):**

- Islands grow, and they connect to each other with bridges.
- Helpers walk set paths or find simple routes to work spots. This is simulated, not player-driven.
- Adding helpers, resource types, building types, and islands must stay easy.
- How it works:
  - Each island has its own uneven grid stored as data (decision 5).
  - The ground is drawn from that grid, so edges look soft rather than blocky.
  - Buildings, trees, and rocks sit on grid points, and helpers work at the walkable points next to them.
  - Helpers find routes along walkable points and bridges.
  - Changing the map means changing the data. The drawing is rebuilt from it at check-ins.
- An art style is a good fit only if it can be built from modular pieces like this. Hand-sculpted, organic shapes are hard to grow and connect.

**Growth you can see:**

- Islands grow outward (new land), upward (towers), downward (roots, caves, waterfalls), and across (bridges or balloons to new islands).
- The game places buildings in set spots so the islands always look tidy.
- The view zooms out as things grow.

**Many islands over time:**

- New islands arrive further and further apart. For example, the first after about a week, the next after two weeks, then a month, then levelling off at one every month or two.
- Islands come in different sizes. Every island keeps growing.
- Islands float in an open sky and move apart on their own as they grow, so nothing ever hits a size limit.
- If several islands make helper movement or the game rules too complicated, a single island that keeps growing is an acceptable fallback.

**Guardrails:**

- Clicking never speeds anything up. Real focus and break time are the only income.
- Each check-in has at most one choice.
- Rewards you haven't collected wait for you and never expire.
- No game notifications, and nothing is lost while you're away.
- No score on screen.

**Pacing defaults** (chosen by Claude using the pacing prototype on the prototype branch; adjust freely). The exact numbers and the building, wonder, island-kind, and surprise lists are in `electron/core/game/rules.js`, and `electron/core/game/pacing.test.js` checks the targets below over months of made-up days:

- New islands follow "active days": days with at least one focus session and one real break. Vacations pause the clock, and long days don't speed it up. Timing by time spent rewarded overwork, and timing by plain calendar days handed out islands during vacations.
- Each break counts fully for its first 10 minutes and at half value up to 20 minutes, so one long lunch can't stand in for a day of breaks.
- A focus session earns Starlight only if it stays close to its planned length and a real break follows it.
- The first day offers about 3 real choices. Later growth aims for about one accepted build or job every workday or two; optional single offers can appear more often while saving.
- Never offer a choice that doesn't matter. An offer has 1 to 3 blueprints of different kinds. Building now or saving is a meaningful choice even with one option. Cheap repeatable items are limited so no single item takes over.

**Fun, without extra interaction** (shown only at check-ins):

- Occasional surprises, a few per week and a bit more likely after real breaks. For example, a small rain cloud stops over the island for a while, or a lost helper finds the island.
- Celebrated firsts: the first helper, the first new island, the first wonder.
- Each new island has its own kind (for example mossy, rocky, meadow, or crystal) and one special building found only there.
- Starlight buys named wonders, such as a lighthouse, airship dock, or observatory. The first one takes about 2 or 3 weeks, then roughly one a month.
- Helpers have names.
- A check-in with no choice shows whether more room or materials are needed, with an approximate wait and without revealing undiscovered content.

**Still open:** what decorating and personalizing looks like (colors, set decoration spots, names, outfits).

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

## Patterns to follow

These come from Simon Willison's 2026 posts on building games with AI.

### 1. Keep the rules apart from the drawing, and check both

- His Battle Drones game keeps the game rules in their own folder with their own tests. Tests make sure the same inputs always give the same result. ([repo](https://github.com/simonw/battledrones))
- He uses a "screenshot tour" script that captures a set of scenes for review.
- He also has a gallery page that shows every 3D model, plus automatic portrait shots of each model.
- Screenshots reviewed only by the AI are not enough. In one game, the AI reviewed its screenshots and still missed raccoons with "huge black spheres" on them. A person had to point it out. ([Moonlight & Mayhem](https://simonwillison.net/2026/Aug/7/moonlight-mayhem/))

This fits the app as it is: rewards already come from replaying saved events, and `scripts/dev-control.sh screenshot` already captures the Testing window.

### 2. Three.js 3D, with models built in code

- "Claude doesn't have its own image generation model but is capable of building full-color 3D models that look and feel excellent." ([The October inflection point for vibe game development](https://simonwillison.net/2026/Oct/28/vibe-game-development/), Oct 28 2026)
- "Opus 5.5 is spectacular at 3D modeling using Three.js." In version 5 of Battle Drones, the models were "entirely constructed by Claude in TypeScript code." ([Battle Drones](https://simonwillison.net/2026/Oct/20/battledrones/))
- He built two cozy games this way: Tree Appreciator ([post](https://simonwillison.net/2026/Oct/14/tree-appreciator/)) and the Pumpkin Farmer farming game.
- Starting prompt he suggests: "Build a mobile-friendly three.js game where...". If the result is dull: "Make it a LOT more fun."
