// Helper routes on the town grid. Plans have the same shape as routes.js: [{ job | rest, line }],
// one per helper, in helper order.
//
//   planHelpers(model, mood)
import { timeline } from '../motion.js';

// Stream D (pads, models, bridges, helpers) owns this. Stub from stage 0: everyone stands and looks about.
export function planHelpers(model, mood) {
  return (model?.helpers ?? []).map((helper, index) => ({ rest: 'idle', line: timeline([{ at: [0, 0], anim: 'look', dur: 3, yaw: 0 }], index) }));
}
