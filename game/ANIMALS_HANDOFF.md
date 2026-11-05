# Animal feature handoff

The first production release is implemented in the working tree: a persistent cat, visiting birds, and a chicken yard with one later Barn extension. The broader animal and building-family brainstorm is **not complete**. Continue from this foundation without treating every suggested species as a settled requirement.

The user authorized autonomous progress and liberal use of subagents. Pause for a concrete game-balance concern, substantial implementation complexity, or a decision that cannot reasonably be inferred. Keep user-facing updates spoiler-free; avoid revealing unlock conditions, prices, or unrelated progression content.

## Design constraints

- This is an idle companion with little decision-making or interaction. Animals must not introduce feeding, care, happiness meters, penalties, currencies, jobs, or chores.
- Keep the scene calm. A few animals doing distinct, leisurely things are preferable to many constantly moving creatures.
- Discoveries should feel like occasional surprises. Existing playthroughs need no backfill.
- Keep durable identity and arrival facts in saved events. Positions, routes, poses, and animation belong to the renderer and may restart freely.
- Build art in code using the existing Three.js style. Review models at actual Today size, not only enlarged in the gallery.
- The user approved the longer awake cat silhouette and particularly liked its curled sleeping pose. Preserve both.

## Implemented scope

| Area | Current behavior |
| --- | --- |
| Cat | One persistent home-island resident. It arrives with the first soil surprise after 5 active days (`residentChanceInSoilSurprise: 1`). It sits on a quiet grass spot away from lanes, work spots, pads, doors, and tall things, and a little away from the coast. In every mood it keeps a gap from the spots where helpers work, sit, or sleep. Packed islands loosen these rules in steps. It mostly rests and takes short local walks. It curls up asleep in the 'done' and 'away' moods. Between turns it settles by moving its own body, never by sliding. It grows with Today's size boost, like the helpers. |
| Bird | Temporary visitor. After 5 active days, every plain stones surprise is a bird's visit (`birdChanceInPlainStonesSurprise: 1`). It has three arrival lines, picked by a keyed roll, and none of them names a tree. Drawn at 1.3 times model size. It perches on a short leafy branch. On crowded islands it uses a solid roof or crown instead. It prefers a perch in Today's view: a tree in view, then a roof in view, then any tree, then any roof. It moves only on its own turns. It turns its head aside, and in break it also flies one slow circle, with a faint shadow on the ground. |
| Farmyard | A hen coop and fenced straw yard that fill the six-point plot, with two hens. The layout turns it along the plot's long side, and the plot is drawn as straw instead of a stone pad. When the plot runs from north to south, the coop stands at the end away from the camera. The yard is centred with an even straw border, the gate has taller posts and an open leaf, and the roof is moss/olive green. Building it adds `landGift: 6` land points to its island, and the fit check counts that gift. |
| Barn | The one extension of the saved parent farmyard, within the same parcel. It is offered only once the farmyard is 25 check-ins old (`extensionAfterCheckIns`), and it costs less overall than the farmyard. It swaps the coop for a red barn and adds one sheep to the yard. Its text hints at that animal. No extra housing capacity, production, or jobs. |
| Motion | `scene/calm.js` decides who may move now. Each 64-second loop on an island belongs to the cat, the yard animals, the bird, or nobody, so at most one animal moves on an island at a time, and each is still most of the time. All animals hold still in the 'done' and 'away' moods and under reduced motion. They also hold still while a moving visitor (rain cloud, balloon, or fireflies) is anywhere in the world. The bird is not one of these. It takes turns like the others. |
| Progression | Animal surprise presentation preserves the original resource gift. New construction uses existing resources. The farmyard's land gift and the one-time top-up for older games (see Compatibility) are the only land changes. There is no land-growth rate increase or catch-up bonus. |
| Compatibility | Old histories gain no retroactive residents. The land gift is saved on the build record (`built.landGift`) and replay reads only that, so old histories replay unchanged. Existing housing placement and extension targeting remain unchanged. Lanes now take a bigger share of land, so an older game gets a one-time `landTopUp` on its next check-in record. The core spots an older game because its start record has no `laneShareOfLand`. A frozen older history (`development-tools/old-saves/main-78be455-steady.json`) checks this in `electron/core/game/old-saves.test.js`. |

Not implemented: a birdhouse keepsake for the bird, a second resident, unrestricted roaming, or a general system for expandable building families and proximity rules. Multiple building clusters are possible in existing layouts; this work inspected that behavior rather than introducing a new clustering system.

## Code map

Read the repository instructions, [game instructions](AGENTS.md), [state ownership plan](../STATE_PLAN.md), and relevant headings in [BUILD_PLAN.md](BUILD_PLAN.md) before changing behavior. The build plan now includes “Residents, visiting birds and reserved yards.”

| Responsibility | Files |
| --- | --- |
| Eligibility, catalogue, animal words (`ANIMAL_FLAVOURS`), saved arrival and parent records, land top-up | `electron/core/game/rules.js`, `electron/core/game/play.js`, `electron/core/game/index.js` |
| Replay and construction checks | `electron/core/game/residents.test.js`, `electron/core/game/farms.test.js`, `electron/core/game/old-saves.test.js` |
| Who may move now | `electron/renderer/game/scene/calm.js` and `calm.test.js` |
| Cat model, route, routine, lifecycle, table by kind | `electron/renderer/game/scene/residents/` |
| Shared cat and bird materials | `electron/renderer/game/scene/models/creature-material.js` |
| Bird model and safe perch selection | `electron/renderer/game/scene/models/bird.js`, `bird-perch.js` and their tests |
| Farm model | `electron/renderer/game/scene/models/farm.js` and `farm.test.js` |
| World transport and placement | `electron/renderer/game/town/`, `electron/renderer/game/scene/town/`, `electron/renderer/game/scene/core.js`, and the `along` and `padLook` flags in `electron/renderer/game/kinds.js` |
| Held visual reviews | `development-tools/game-gallery/views/residents.js`, `birds.js`, `farm.js` |

Resident arrivals store identity, kind, island, appearance seed, and arrival check-in in `surprise.resident`. These fields participate in the pending check-in token. The scene reads replayed residents and owns their disposable visual objects.

Extensions save `parentBuildingId`; replay and layout retain that exact earlier parent. The extension changes the parent's rendered parcel rather than placing another building. `town/island.js` treats any record with a `parentBuildingId` as its parent's extension. Do not generalize this by silently changing how historical house extensions choose their targets.

The farm reserves six layout points. Its capacity charge is 8: the usual charge of 7 plus a margin of 1. The margin is accounting headroom, not an extra point kept on the map. To make room for it, building the farm gives its island 6 land points. The amount is worked out with the offer, is part of the pending check-in token, and is saved as `built.landGift`. Replay applies it only from that record. `placeFor` counts the gift when it checks whether the farm fits. Its price now includes 35 planks, which keeps it near an Orchard's timing (see "Pacing" in the build plan). The room check skips the Barn (it takes no ground), and it leaves out bridges built after an island's last building. This is not a universal packing guarantee.

Moving parts read `ctx.model`, which is now a live getter for the current world (`scene/town/build.js`). This lets an island kept between check-ins see another island's visitor come and go.

## Validation completed

Current state, after the farm fit and price change, the land top-up, the turn-taking bird, and the farm art changes:

- `scripts/test.sh`: **343 passed, 0 failed**.
- `npm run check:source` passed.

Design, visual, and code reviews looked at this round, and their findings were fixed. The changes since the last handoff include the farm's roof colour, gate, building position, and earlier arrival, the cat's distance from the coast, and the bird's perch in view.

On the code side, `calm.js` is now the one owner of who may move, and the cat and bird share one material cache. The farm reads kind flags instead of its name and uses the shared slab outline. The animal words live in one table, and the gallery's resident checks were folded into the scene tests.

Earlier checks, from before these changes (still useful, but not rerun):

- Hidden Testing scene tour completed (`.build/animals-tour.log`, `.build/game-tour/`).
- Restart verification preserved one saved resident, construction records and parent links, and resources exactly (`.build/animals-persistence.log`). The Testing app remained inactive and was stopped afterward.
- Capacity screening logs (`.build/farm-ground-screen.jsonl`, `.build/farm-seed-daily.jsonl`) came before the land gift and lane share change. Do not read them as current results.
- Visuals inspected: `.build/bird-review-small.png`, `.build/farm-review-small.png`, `.build/farm-town-small.png`, `.build/animals-app-small.png`, and earlier cat pose/motion previews. They show the older farm and bird art. Some contain progression spoilers; do not embed them in user updates without checking their contents.

Two historical regression fixtures intentionally use the pre-farm construction catalogue: the fixed economy snapshot in `surprises.test.js` and a squeeze/hedge scenario in `town.test.js`. Their original assertions remain intact. Current-catalogue checks cover animal gift parity and new construction separately; keep both kinds of coverage.

The work remains uncommitted, including new untracked source and test files. Preserve the working tree. Artifacts and exploratory simulation scripts under `.build/` are local and ignored, so they may not survive a clean checkout. Personal data was not modified.

## Recommended continuation

These decisions came out of the design review:

- When an island has a birdhouse keepsake, the bird will later prefer it as its perch.
- Add at most one new resident at a time.
- Per the user, nothing is tied to a particular island kind: no resident, animal, or building variant belongs to one kind of island.
- Cut from the roster: dogs, worker-following pets, horses, cows, pigs, and farmhouse or ranch variants.

Steps:

1. Prototype the next single resident in the gallery before production integration. Compare silhouette, scale, and motion at Today size across early and crowded scenes. It must fit the one-animal-moving rule.
2. If building families are still wanted, investigate them separately. Define stable saved parent selection, family identity, extension limits, and proximity preferences first. Check that preferences can fail gracefully without moving historical buildings.
3. Revisit open space only when a concrete new footprint requires it. Test contiguous usable land as well as aggregate capacity. Prefer a saved land gift like the farmyard's over catch-up grants.
4. Integrate one accepted prototype at a time, using fresh agents for design, implementation, and independent review as useful. Share file ownership explicitly. Verify saved replay, unchanged gift amounts, placement, disposal, reduced motion, and overall motion density.

## Follow-ups

- New games still borrow some leftover land. Over 200 runs it was 21 runs and 170 points, against 12 and 58 before the farm fit change. This may be dice noise, or a small real rise because more farms get built. Most of it comes from ring and coast wonders on later islands, which is a problem with island shapes. The farm's own island borrowed 20 points, against 14 before.
- The shared simulator (`createHistory` in `electron/core/game/made-up-days.js`) gives every seed the same start id `EV-000001`, so all seeds share one dice stream.
- Day-1 choices are sometimes above target.
- Fixed-seed tests sit close to their limits: there is a free island pair on day 135.
- Some batches still show older "free point nobody can walk to" and "land hole" errors, depending on the seed.
- A tall thing is sometimes placed in front of the farm (11 of 48 real farms). Fixing it needs a layout change that would move saved towns.
- Dev Testing games started on the uncommitted tree before the top-up marker existed will get a top-up they do not need.
- Visual doubts:
  - The bird's flying shadow is faint.
  - A blue bird on a blue roof still blends in a little.
  - The straw turns slightly orange in break light.
  - Overall, the animals are deliberately subtle, so everyday readability at Today size is still the main doubt.

## Safe verification workflow

Use only isolated Testing instances through `FOCUS_ISLANDS_INSTANCE=<name> scripts/run-dev.sh --hidden-window`. Follow the full repository instructions for status checks and screenshots. Before interacting, require `profile=testing`, `appActive=false`, and empty `activations`; quit and report any activation. Use `dev-control.sh`, never launch Electron directly, and never use Personal launch scripts or alter the Personal database.

For changes, run focused tests while iterating, then the required source/core checks. Run the scene tour once after scene changes are finished, inspect a few relevant cropped pictures, and stop the Testing instance. Do not repeat the completed checks merely to resume this handoff.
