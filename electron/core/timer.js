const { uuid } = require('./store');

function emptyState() {
  return { phase: 'idle', sessionID: null, startedAt: null, targetSeconds: 0,
    elapsedSeconds: 0, isSleeping: false, isDue: false, unknownGapStartedAt: null,
    observedSegmentStartedAt: null };
}

class Timer {
  constructor(nudgeInterval = 300) {
    this.nudgeInterval = Math.max(60, nudgeInterval);
    this.state = emptyState();
    this.lastTick = null;
    this.nextNudgeAt = null;
    this.sleepBeganAt = null;
  }
  get remainingSeconds() { return this.state.targetSeconds - this.state.elapsedSeconds; }
  clone() {
    const copy = new Timer(this.nudgeInterval);
    copy.state = { ...this.state };
    copy.lastTick = this.lastTick;
    copy.nextNudgeAt = this.nextNudgeAt;
    copy.sleepBeganAt = this.sleepBeganAt;
    return copy;
  }
  start(phase, target, instant, sessionID = uuid()) {
    if (!['focus', 'break'].includes(phase)) throw new Error('Invalid timer phase.');
    this.state = { ...emptyState(), phase, sessionID, startedAt: instant.wall.toISOString(),
      observedSegmentStartedAt: instant.wall.toISOString(), targetSeconds: Math.max(1, target) };
    this.lastTick = instant.monotonicSeconds;
    this.nextNudgeAt = null;
    this.sleepBeganAt = null;
    return this.state.sessionID;
  }
  advance(instant) {
    const state = this.state;
    if (state.phase === 'idle') return [];
    if (this.lastTick == null) { this.lastTick = instant.monotonicSeconds; return []; }
    const delta = Math.max(0, instant.monotonicSeconds - this.lastTick);
    this.lastTick = instant.monotonicSeconds;
    if (!state.isSleeping) state.elapsedSeconds += delta;
    if (state.elapsedSeconds >= state.targetSeconds && !state.isDue) {
      state.isDue = true;
      if (state.phase === 'focus') { this.nextNudgeAt = instant.monotonicSeconds + this.nudgeInterval; return ['breakDue']; }
      return ['breakComplete'];
    }
    if (state.phase === 'focus' && state.isDue && this.nextNudgeAt != null && instant.monotonicSeconds >= this.nextNudgeAt) {
      this.nextNudgeAt = instant.monotonicSeconds + this.nudgeInterval;
      return ['overdueNudge'];
    }
    return [];
  }
  snooze(minutes, instant) {
    if (this.state.phase === 'focus' && this.state.isDue) {
      this.advance(instant);
      this.state.targetSeconds = this.state.elapsedSeconds + Math.max(1, minutes) * 60;
      this.state.isDue = false;
      this.nextNudgeAt = null;
    }
  }
  end(instant) {
    this.advance(instant);
    const elapsed = this.state.elapsedSeconds;
    this.state = emptyState();
    this.lastTick = this.nextNudgeAt = this.sleepBeganAt = null;
    return elapsed;
  }
  pauseForSleep(instant) {
    this.advance(instant);
    this.state.isSleeping = true;
    this.sleepBeganAt = instant.wall;
  }
  discountIdleFocus(seconds) {
    if (this.state.phase !== 'focus' || !this.state.isSleeping) return;
    this.state.elapsedSeconds = Math.max(0, this.state.elapsedSeconds - Math.max(0, seconds));
    this.state.isDue = this.state.elapsedSeconds >= this.state.targetSeconds;
    if (!this.state.isDue) this.nextNudgeAt = null;
  }
  resumeFromSleep(instant) {
    if (!this.state.isSleeping) return [];
    const slept = Math.max(0, (instant.wall - (this.sleepBeganAt || instant.wall)) / 1000);
    this.sleepBeganAt = null;
    this.state.isSleeping = false;
    this.state.observedSegmentStartedAt = instant.wall.toISOString();
    this.lastTick = instant.monotonicSeconds;
    if (this.state.phase === 'break') {
      this.state.elapsedSeconds += slept;
      if (this.state.elapsedSeconds >= this.state.targetSeconds && !this.state.isDue) {
        this.state.isDue = true;
        return ['breakComplete'];
      }
    }
    return [];
  }
  restorePausedSession({ phase, sessionID, startedAt, targetSeconds, observedElapsedSeconds, lastObservedAt }, instant) {
    this.state = { ...emptyState(), phase, sessionID, startedAt, targetSeconds: Math.max(1, targetSeconds),
      elapsedSeconds: Math.max(0, observedElapsedSeconds || 0), unknownGapStartedAt: lastObservedAt,
      observedSegmentStartedAt: instant.wall.toISOString() };
    this.state.isDue = this.state.elapsedSeconds >= this.state.targetSeconds;
    this.lastTick = instant.monotonicSeconds;
    this.nextNudgeAt = this.state.isDue && phase === 'focus' ? instant.monotonicSeconds + this.nudgeInterval : null;
    this.sleepBeganAt = null;
  }
  static recover(events, instant) {
    let active = null;
    for (const event of events) {
      const payload = event.payload;
      if (['focusStarted', 'breakStarted'].includes(event.kind) && payload?.sessionID) {
        active = { phase: event.kind === 'focusStarted' ? 'focus' : 'break', sessionID: payload.sessionID,
          startedAt: event.occurredAt, targetSeconds: payload.targetSeconds, observedElapsedSeconds: 0, lastObservedAt: event.occurredAt };
      } else if (active && ['focusPaused', 'focusResumed', 'breakProgress'].includes(event.kind) && payload?.sessionID === active.sessionID) {
        active.observedElapsedSeconds = payload.elapsedSeconds ?? active.observedElapsedSeconds;
        active.targetSeconds = payload.targetSeconds ?? active.targetSeconds;
        active.lastObservedAt = event.occurredAt;
      } else if (active && ['focusEnded', 'breakEnded'].includes(event.kind) && payload?.sessionID === active.sessionID) {
        active = null;
      }
    }
    const timer = new Timer();
    if (active) timer.restorePausedSession(active, instant);
    return timer;
  }
}

module.exports = { Timer };
