// Who may move now: the one place that decides when the town's small animals move.
//
// Time runs in loops of LOOP seconds on the scene clock (scene/index.js starts it again at 0 on every
// world or mood change and when the page shows). Each loop on each island belongs to at most one kind of
// animal (TURNS), picked from the loop's number and the island's id, so the same island always has the
// same rhythm and a different one, and some loops belong to nobody. So at most one animal moves per
// island at a time, nothing moves like clockwork, and the animals are still most of the time.
//
// The first loop after the clock starts again belongs to nobody, so whatever an interruption left
// half done settles first. Nobody starts a turn:
// - in a quiet mood (isQuietMood: done and away, when everyone sleeps, or reduced motion);
// - at time 0 exactly, which is how the scene holds everything still under reduced motion;
// - while a moving visitor is anywhere in the world (visitorMoving, read from the live world). The
//   bird is not one: it takes turns like the cat and the yard animals, so only its own turns keep them
//   still, and only on its island;
// - when the animal says it is not ready (the cat still walking home, say).
// A turn that is cut short by any of these ends at once; the animal then eases back to rest on its own
// (Turn.weight helps with that).
//
// To add a kind (ducks, frogs, bees...), give it a share in TURNS and ask a Turn before moving.

export const LOOP = 64; // seconds
// Each kind's share of the loops on one island. The rest belong to nobody. A kind that is not on an
// island just leaves its loops still.
export const TURNS = { cat: 0.3, yard: 0.3, bird: 0.3 };
const GRACE = 2; // seconds after a loop starts that an animal may still begin its turn
const MAX_STEP = 0.25; // the longest frame step that counts, in seconds

// Surprises that move about the sky or the ground all the time. While one is in the world, the animals
// keep still.
export const MOVING_VISITORS = new Set(['raincloud', 'balloon', 'fireflies']);
export const visitorMoving = model => (model?.islands ?? []).some(island => MOVING_VISITORS.has(island?.visitor));

export const isQuietMood = (mood, still = false) => still || mood === 'done' || mood === 'away';

// A number from 0 to 1 for a text, the same every time. FNV-1a, then a mixing step so that texts that
// differ only in their last digit (loop 7, loop 8) still land far apart.
function unit(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The kind that owns loop n on an island, or null.
export function loopOwner(island, n) {
  if (!(n > 0)) return null;
  let u = unit(`${island ?? ''}:${n}`);
  for (const [kind, share] of Object.entries(TURNS)) {
    if (u < share) return kind;
    u -= share;
  }
  return null;
}

// One animal's (or one group's) turns. model: returns the current world (a ctx.model getter).
// settle: seconds for weight to fall from 1 to 0 after a turn ends.
//   step(time, { mood, still, ready }) => seconds into the turn, or null when not its turn
//   weight: 1 during a turn, then down to 0 over `settle` seconds (at once when held still)
export function createTurn(kind, island, { model = () => null, settle = 2 } = {}) {
  let start = null, last = null, weight = 0, seen, moving = false;
  const visitorNow = () => {
    const world = model();
    if (world !== seen) { seen = world; moving = visitorMoving(world); }
    return moving;
  };
  return {
    get weight() { return weight; },
    get active() { return start !== null; },
    step(time, { mood = 'focus', still = false, ready = true } = {}) {
      const t = Number.isFinite(time) ? Math.max(0, time) : 0;
      const dt = last === null ? 0 : Math.min(MAX_STEP, t >= last ? t - last : t);
      last = t;
      const stopped = still || t === 0;
      const held = stopped || isQuietMood(mood) || visitorNow();
      if (start !== null && (held || t < start || t - start >= LOOP)) start = null;
      if (start === null && !held && ready) {
        const n = Math.floor(t / LOOP);
        if (t - n * LOOP <= GRACE && loopOwner(island, n) === kind) start = n * LOOP;
      }
      if (start !== null) { weight = 1; return t - start; }
      weight = stopped ? 0 : Math.max(0, weight - dt / Math.max(1e-3, settle));
      return null;
    },
  };
}

// Shared motion helpers. ease: a smooth 0 to 1 (clamped). turnToward: an angle part of the short way
// round to another.
export const ease = value => { const t = Math.max(0, Math.min(1, value)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const turnToward = (from, to, amount) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;
