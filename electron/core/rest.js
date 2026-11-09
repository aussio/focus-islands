function qualifyingRestSeconds(breakMinutes) {
  return Math.max(3 * 60, Number(breakMinutes || 10) * 60 * .75);
}

module.exports = { qualifyingRestSeconds };
