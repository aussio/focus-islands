'use strict';
// Keyed dice. A roll comes from a text naming what it is for (for example
// "<gameStarted id>:checkin:4:surprise"), so the same text always gives the same roll and a new
// roll never shifts an old one.

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A number from 0 (included) to 1 (not included).
function roll(text) {
  let t = (hash32(String(text)) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// One of the items, picked by a keyed roll.
function pickOne(text, items) {
  return items[Math.min(items.length - 1, Math.floor(roll(text) * items.length))];
}

// A short text fingerprint, used for check-in tokens.
function fingerprint(text) {
  const a = hash32(String(text)), b = hash32('~' + String(text));
  return a.toString(36) + b.toString(36);
}

module.exports = { roll, pickOne, fingerprint, hash32 };
