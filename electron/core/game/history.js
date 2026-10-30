'use strict';
// One pass over the saved events that keeps only what the game reads. Everything here uses saved
// order (the `sequence` field), never `occurredAt` order, because some records are backdated.

const READ_KINDS = new Set(['gameStarted', 'gameGranted', 'gameCheckedIn', 'focusStarted', 'focusEnded',
  'breakStarted', 'breakConfirmed', 'breakEnded', 'awayEnded', 'dayEnded']);

// Returns null when the game hasn't started. Otherwise:
// - focus: finished focus sessions after the start, in saved order
// - breaks: every finished break after the start (confirmed or not) and every away time counted as a break.
//   `rest` is true for confirmed breaks and counted away time. `follows` is the focus session just before.
// - dayEnds, grants, checkIns: game-relevant records after the start, in saved order
// - keys: unique keys of every game record, so nothing is written twice
// - grantDays: the day saved in each existing grant, by `source:sourceID`. A source keeps that day for
//   good, even if the Mac's time zone changes later and the same moment falls on another calendar day.
function scan(events) {
  let started = null, startedSequence = 0, newestGameSequence = 0, lastFocus = null;
  const focus = [], breaks = [], dayEnds = [], grants = [], checkIns = [], keys = new Set(), grantDays = new Map();
  const focusStarts = new Map(), breakStarts = new Map(), confirmed = new Set(), focusSeen = new Set(), breakSeen = new Set();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!READ_KINDS.has(event.kind)) continue;
    const payload = event.payload || {}, sequence = event.sequence ?? i + 1;
    switch (event.kind) {
      case 'gameStarted':
        if (!started) { started = event; startedSequence = sequence; }
        if (event.uniqueKey) keys.add(event.uniqueKey);
        newestGameSequence = Math.max(newestGameSequence, sequence);
        break;
      case 'gameGranted':
      case 'gameCheckedIn':
        if (event.uniqueKey) keys.add(event.uniqueKey);
        if (event.kind === 'gameGranted' && payload.source && payload.sourceID != null && payload.dayKey) {
          grantDays.set(`${payload.source}:${payload.sourceID}`, payload.dayKey);
        }
        if (!started) break;
        newestGameSequence = Math.max(newestGameSequence, sequence);
        (event.kind === 'gameGranted' ? grants : checkIns).push({ sequence, event, payload });
        break;
      case 'focusStarted':
        if (payload.sessionID) focusStarts.set(payload.sessionID, payload);
        break;
      case 'focusEnded': {
        const id = payload.sessionID;
        if (!id) break;
        lastFocus = id;
        if (!started || focusSeen.has(id)) break;
        focusSeen.add(id);
        const begun = focusStarts.get(id);
        focus.push({ sessionID: id, sequence, at: event.occurredAt, elapsedSeconds: Number(payload.elapsedSeconds) || 0,
          // The planned length is the target the session started with, before any snooze stretched it.
          plannedSeconds: Number(begun?.targetSeconds ?? payload.targetSeconds) || 0, reason: begun?.reason || null });
        break;
      }
      case 'breakStarted':
        if (payload.sessionID) breakStarts.set(payload.sessionID, { payload, lastFocus });
        break;
      case 'breakConfirmed':
        if (payload.sessionID) confirmed.add(payload.sessionID);
        break;
      case 'breakEnded': {
        const id = payload.sessionID;
        if (!started || !id || breakSeen.has(id)) break;
        breakSeen.add(id);
        const begun = breakStarts.get(id);
        breaks.push({ key: id, kind: 'break', sequence, at: event.occurredAt, rest: false,
          follows: begun?.payload.followsSessionID || (begun ? begun.lastFocus : lastFocus),
          elapsedSeconds: Number(payload.elapsedSeconds) || 0,
          targetSeconds: Number(payload.targetSeconds ?? begun?.payload.targetSeconds) || 0 });
        break;
      }
      case 'awayEnded':
        if (!started || !payload.countedAsBreak) break;
        breaks.push({ key: event.id, kind: 'away', sequence, at: event.occurredAt, rest: true,
          follows: payload.followsSessionID || lastFocus,
          elapsedSeconds: Number(payload.restSeconds) || 0, targetSeconds: Number(payload.targetSeconds) || 0 });
        break;
      case 'dayEnded':
        if (started && payload.dayKey) dayEnds.push({ sequence, dayKey: payload.dayKey });
        break;
    }
  }
  if (!started) return null;
  for (const item of breaks) if (item.kind === 'break') item.rest = confirmed.has(item.key);
  const lastSequence = events.length ? events[events.length - 1].sequence ?? events.length : 0;
  return { started, startedSequence, focus, breaks, dayEnds, grants, checkIns, keys, grantDays, newestGameSequence, lastSequence };
}

// The newest record after `sequence` that makes a check-in ready: back from a break (any finished
// break or counted away time), or a day that ended (a dayEnded record or a day grant).
function latestTrigger(facts, after) {
  let best = null;
  const consider = item => { if (item.sequence > after && (!best || item.sequence > best.sequence)) best = item; };
  const lastBreak = facts.breaks[facts.breaks.length - 1], lastDayEnd = facts.dayEnds[facts.dayEnds.length - 1];
  if (lastBreak) consider({ kind: 'break', sequence: lastBreak.sequence, at: lastBreak.at, follows: lastBreak.follows });
  if (lastDayEnd) consider({ kind: 'dayEnded', sequence: lastDayEnd.sequence, dayKey: lastDayEnd.dayKey });
  for (let i = facts.grants.length - 1; i >= 0 && facts.grants[i].sequence > after; i--) {
    const grant = facts.grants[i];
    if (grant.payload.source !== 'day') continue;
    consider({ kind: 'dayGrant', sequence: grant.sequence, dayKey: grant.payload.dayKey });
    break;
  }
  return best;
}

module.exports = { scan, latestTrigger };
