// A volatile estimate of computer presence. Never stores input events or writes to SQLite.
const INACTIVE_AFTER_SECONDS = 120;

function createActivityDetector(inactiveAfterSeconds = INACTIVE_AFTER_SECONDS) {
  let unavailable = false;
  let state = 'unknown';
  let idleSeconds = null;

  function updateState() {
    state = unavailable ? 'inactive' : idleSeconds === null ? 'unknown'
      : idleSeconds >= inactiveAfterSeconds ? 'inactive' : 'active';
  }

  return {
    observe(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        state = 'unknown';
        idleSeconds = null;
      } else {
        idleSeconds = Math.floor(seconds);
        updateState();
      }
      return this.status();
    },
    setUnavailable(value) {
      unavailable = Boolean(value);
      idleSeconds = null;
      updateState();
      return this.status();
    },
    setInactiveAfterSeconds(value) {
      if (!Number.isInteger(value) || value < 1 || value > 3600) throw new Error('Invalid activity delay.');
      inactiveAfterSeconds = value;
      updateState();
      return this.status();
    },
    status() {
      return { state, idleSeconds, inactiveAfterSeconds };
    },
  };
}

module.exports = { createActivityDetector, INACTIVE_AFTER_SECONDS };
