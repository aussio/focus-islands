const ms = value => +new Date(value);
const iso = value => new Date(value).toISOString();
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

module.exports = { ms, iso, sameDay };
