// A volatile estimate of computer presence. Never stores input events or writes to SQLite.
const INACTIVE_AFTER_SECONDS = 5;

function createActivityDetector() {
  let unavailable = false;
  let state = 'unknown';
  let idleSeconds = null;

  return {
    observe(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        state = 'unknown';
        idleSeconds = null;
      } else {
        idleSeconds = Math.floor(seconds);
        state = unavailable || idleSeconds >= INACTIVE_AFTER_SECONDS ? 'inactive' : 'active';
      }
      return this.status();
    },
    setUnavailable(value) {
      unavailable = Boolean(value);
      state = unavailable ? 'inactive' : 'unknown';
      idleSeconds = null;
      return this.status();
    },
    status() {
      return { state, idleSeconds, inactiveAfterSeconds: INACTIVE_AFTER_SECONDS };
    },
  };
}

module.exports = { createActivityDetector, INACTIVE_AFTER_SECONDS };
