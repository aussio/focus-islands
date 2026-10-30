# Working on the game layer

The game turns focus and break facts into a growing set of sky islands. The agreed design, its guardrails, and the research sources are in [NOTES.md](NOTES.md). Read its "Game direction" section before changing how the game plays. Before building, read the parts of [BUILD_PLAN.md](BUILD_PLAN.md) that cover your change: "How the pieces fit" for where code lives, plus the section for the area you touch (saved records, town rules, layout, scene, or gallery and checks).

The live scene stays calm: helpers move about and look busy, and the islands change only at check-ins.

## Rules and drawing stay separate

- **Rules** are plain code that replays the saved event history and returns the game state: resources, islands, buildings, and helpers. The same events always give the same state. Test rules with `node --test`, the same way `electron/core/` is tested. Rules follow the core's event rules: append-only events, unique reward grants, versioned reward values.
- **Drawing** reads the game state and shows it. All reward and progress math lives in the rules (see `STATE_PLAN.md`).

## Art

Use Three.js, with every model built in code from simple shapes. This keeps all art in the repo as code an agent can read and change.

The scene is decoration with no game clock. All progress comes from the saved events, so the scene holds nothing worth keeping. Helpers start fresh each time it's shown, and it pauses while the window is hidden.

## Checking visual work

- **Gallery page:** one page shows every model, item, outfit, and helper state. Add each new piece of art to it. A gallery view can hold a camera pose or moment still, which is the quick way to check anything that moves.
- **Screenshot tour:** a fixed set of scenes (focus, break, break due, away, day done) captured with `scripts/dev-control.sh screenshot` from the Testing app. A covered window redraws only while being captured, so take one throwaway capture before the real one. Run it once, after a scene or Today layout change is finished.
- A visual change is done when a few cropped pictures of what changed (gallery or app) have been inspected and their paths are in the report. Agents miss obvious problems in their own screenshots, so a person looks too: list what you're unsure of.
