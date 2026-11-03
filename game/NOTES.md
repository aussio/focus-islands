# Game notes

Notes for the game side of Focus Islands: an idle game where the only income comes from real focus and real breaks, with rewards for following the day's plan closely. No game code exists on `main` yet. Today's acorns, shop, and pixel garden are placeholders that the game replaces, starting fresh with nothing carried over.

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
- **Chosen look:** the Townscaper-like style (D in the art prototype). It has bright, colourful houses with white trim and sharp roofs, angular grey-lilac rocks, faceted trees, stepping-stone paths, and rope bridges. The ground has a soft rounded edge, and the underside is faceted with hanging roots. In break mood there is a dusk sky with stars, glowing windows, and a campfire. Keep the colours and brightness, and keep shapes crisp: small bevels, not puffy. Clay shapes don't fit the grid, so they're out. `D-grown-focus.png` and `D-grown-break.png` on the prototype branch show the target.
- Known gaps in the prototype look:
  - the grown island is mostly empty lawn
  - diagonal coastlines look stair-stepped
  - window details are hard to see at the app's size
- References (on the prototype branch, in `game/prototypes/art-references/`):
  - a cozy room diorama (too busy)
  - a stylized island city
  - a medieval village builder
  - Townscaper (not saved)

**World structure (the art must support this):**

- Islands grow, and they connect to each other with bridges.
- Helpers walk set paths or find simple routes to work spots. This is simulated, not player-driven.
- Adding helpers, resource types, building types, and islands must stay easy.
- Planned approach:
  - Each island is a square grid of cells stored as data.
  - The ground is drawn from that grid, using rounded tile pieces chosen by their neighbours (the way Townscaper does it), so edges look soft rather than blocky.
  - Buildings, trees, and rocks sit on cells, each with a footprint and a work spot.
  - Helpers find routes along walkable cells and bridges.
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

**Still open (decide after trying prototypes):**

- The setting and characters: sky islands with little helpers, or something else.
- How Starlight is measured from the plan.
- What decorating and personalizing looks like (colors, set decoration spots, names, outfits).

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
