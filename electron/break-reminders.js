const REPEAT_MS = 5 * 60 * 1000;

function breakOpportunity(state) {
  if (state.dayEndedAt) return null;
  if (state.todaySituation === 'afterDay') return { kind: 'endDay', identity: state.todayKey };
  if (state.dayEnding) return null;
  if (state.phase === 'focus' && state.breakDue && state.todaySituation !== 'working' && !state.inferredBreakActive) {
    return { kind: 'timer', identity: state.timer?.sessionID };
  }
  if (state.phase === 'idle' && state.todaySituation === 'rest' && state.todayGuidance?.action?.type === 'rest') {
    return { kind: 'planned', identity: state.todayKey };
  }
  return null;
}

function createBreakReminder() {
  let current = null;
  let episode = 0;

  return {
    next(state) {
      const opportunity = breakOpportunity(state);
      if (!opportunity) { current = null; return null; }
      if (!current || current.kind !== opportunity.kind || current.identity !== opportunity.identity) {
        current = { ...opportunity, key: `${opportunity.kind}:${opportunity.identity}:${++episode}`, sentAt: null, sequence: -1 };
      }
      if (!state.notificationsEnabled || state.suspended || state.activity?.state !== 'active') return null;
      const now = Number(state.currentWallTime) * 1000;
      const sequence = Number(state.reminderSequence) || 0;
      if (current.sentAt !== null && now - current.sentAt < REPEAT_MS &&
        (current.kind !== 'timer' || sequence <= current.sequence)) return null;
      current.sentAt = now;
      current.sequence = sequence;
      return { kind: current.kind, key: current.key, at: state.currentWallTimeISO };
    },
    isCurrent(key, state) {
      const opportunity = breakOpportunity(state);
      return Boolean(current && opportunity && current.key === key && current.kind === opportunity.kind &&
        current.identity === opportunity.identity && state.notificationsEnabled && !state.suspended && state.activity?.state === 'active');
    },
    reset() { current = null; episode = 0; },
  };
}

module.exports = { createBreakReminder };
