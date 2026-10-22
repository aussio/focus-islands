import Foundation

public struct TimerInstant: Sendable, Equatable {
    public var wall: Date
    public var monotonicSeconds: TimeInterval

    public init(wall: Date, monotonicSeconds: TimeInterval) {
        self.wall = wall
        self.monotonicSeconds = monotonicSeconds
    }
}

public protocol Clock: Sendable {
    func now() -> TimerInstant
}

public struct SystemClock: Clock {
    public init() {}

    public func now() -> TimerInstant {
        TimerInstant(wall: Date(), monotonicSeconds: ProcessInfo.processInfo.systemUptime)
    }
}

public enum TimerPhase: String, Sendable, Equatable {
    case idle, focus, `break`
}

public enum TimerSignal: Sendable, Equatable {
    case breakDue
    case overdueNudge
    case breakComplete
}

public struct TimerState: Sendable, Equatable {
    public var phase: TimerPhase = .idle
    public var sessionID: UUID?
    public var startedAt: Date?
    public var targetSeconds: TimeInterval = 0
    public var elapsedSeconds: TimeInterval = 0
    public var isSleeping = false
    public var isDue = false
    public var unknownGapStartedAt: Date?

    public var remainingSeconds: TimeInterval { max(0, targetSeconds - elapsedSeconds) }
    public var cappedFocusSeconds: TimeInterval {
        phase == .focus ? min(elapsedSeconds, targetSeconds) : 0
    }

    public init() {}
}

public struct TimerEngine: Sendable {
    public private(set) var state = TimerState()
    private var lastTick: TimeInterval?
    private var nextNudgeAt: TimeInterval?
    private var sleepBeganAt: Date?
    private let nudgeInterval: TimeInterval

    public init(nudgeInterval: TimeInterval = 5 * 60) {
        self.nudgeInterval = max(60, nudgeInterval)
    }

    @discardableResult
    public mutating func startFocus(target: TimeInterval, at instant: TimerInstant) -> UUID {
        let id = UUID()
        state = TimerState()
        state.phase = .focus
        state.sessionID = id
        state.startedAt = instant.wall
        state.targetSeconds = max(1, target)
        lastTick = instant.monotonicSeconds
        nextNudgeAt = nil
        sleepBeganAt = nil
        return id
    }

    @discardableResult
    public mutating func startBreak(target: TimeInterval, at instant: TimerInstant) -> UUID {
        let id = UUID()
        state = TimerState()
        state.phase = .break
        state.sessionID = id
        state.startedAt = instant.wall
        state.targetSeconds = max(1, target)
        lastTick = instant.monotonicSeconds
        nextNudgeAt = nil
        sleepBeganAt = nil
        return id
    }

    public mutating func advance(to instant: TimerInstant) -> [TimerSignal] {
        guard state.phase != .idle else { return [] }
        guard let lastTick else {
            self.lastTick = instant.monotonicSeconds
            return []
        }
        let delta = max(0, instant.monotonicSeconds - lastTick)
        self.lastTick = instant.monotonicSeconds
        if !state.isSleeping { state.elapsedSeconds += delta }
        if state.elapsedSeconds >= state.targetSeconds && !state.isDue {
            state.isDue = true
            if state.phase == .focus {
                nextNudgeAt = instant.monotonicSeconds + nudgeInterval
                return [.breakDue]
            }
            return [.breakComplete]
        }
        if state.phase == .focus, state.isDue,
           let nextNudgeAt, instant.monotonicSeconds >= nextNudgeAt {
            self.nextNudgeAt = instant.monotonicSeconds + nudgeInterval
            return [.overdueNudge]
        }
        return []
    }

    public mutating func snooze(minutes: Int, at instant: TimerInstant) {
        guard state.phase == .focus && state.isDue else { return }
        nextNudgeAt = instant.monotonicSeconds + TimeInterval(max(1, minutes) * 60)
    }

    @discardableResult
    public mutating func endFocus(at instant: TimerInstant) -> TimeInterval {
        _ = advance(to: instant)
        let elapsed = min(state.elapsedSeconds, state.targetSeconds)
        state = TimerState()
        lastTick = nil
        nextNudgeAt = nil
        sleepBeganAt = nil
        return elapsed
    }

    @discardableResult
    public mutating func endBreak(at instant: TimerInstant) -> TimeInterval {
        _ = advance(to: instant)
        let elapsed = state.elapsedSeconds
        state = TimerState()
        lastTick = nil
        nextNudgeAt = nil
        sleepBeganAt = nil
        return elapsed
    }

    public mutating func skipBreak(at instant: TimerInstant) {
        _ = endFocus(at: instant)
    }

    public mutating func pauseForSleep(at instant: TimerInstant) {
        _ = advance(to: instant)
        state.isSleeping = true
        sleepBeganAt = instant.wall
    }

    /// Idle input is discovered late. Remove the interval since the last input
    /// from focus credit, then keep the timer suspended until activity returns.
    public mutating func discountIdleFocus(seconds: TimeInterval) {
        guard state.phase == .focus && state.isSleeping else { return }
        state.elapsedSeconds = max(0, state.elapsedSeconds - max(0, seconds))
        state.isDue = state.elapsedSeconds >= state.targetSeconds
        if !state.isDue { nextNudgeAt = nil }
    }

    @discardableResult
    public mutating func resumeFromSleep(at instant: TimerInstant) -> [TimerSignal] {
        guard state.isSleeping else { return [] }
        let slept = max(0, instant.wall.timeIntervalSince(sleepBeganAt ?? instant.wall))
        sleepBeganAt = nil
        state.isSleeping = false
        lastTick = instant.monotonicSeconds
        if state.phase == .break && !state.isDue {
            state.elapsedSeconds += min(slept, state.remainingSeconds)
            if state.elapsedSeconds >= state.targetSeconds {
                state.isDue = true
                return [.breakComplete]
            }
        }
        return []
    }

    /// Unobserved time after a relaunch never advances focus or earns credit.
    public mutating func restorePausedSession(
        phase: TimerPhase,
        sessionID: UUID,
        startedAt: Date,
        targetSeconds: TimeInterval,
        observedElapsedSeconds: TimeInterval,
        lastObservedAt: Date,
        at instant: TimerInstant
    ) {
        state = TimerState()
        state.phase = phase
        state.sessionID = sessionID
        state.startedAt = startedAt
        state.targetSeconds = max(1, targetSeconds)
        state.elapsedSeconds = max(0, observedElapsedSeconds)
        state.unknownGapStartedAt = lastObservedAt
        state.isDue = state.elapsedSeconds >= state.targetSeconds
        lastTick = instant.monotonicSeconds
        nextNudgeAt = state.isDue && phase == .focus ? instant.monotonicSeconds + nudgeInterval : nil
        sleepBeganAt = nil
    }

    /// Rebuild an unfinished timer from persisted transitions. Time between the
    /// latest recorded observation and this launch is explicitly unknown.
    public static func recover(events: [Event], at instant: TimerInstant) -> TimerEngine {
        var active: (phase: TimerPhase, payload: SessionPayload, startedAt: Date, lastObservedAt: Date)?
        for event in events.sorted(by: { $0.sequence < $1.sequence }) {
            switch event.kind {
            case .focusStarted, .breakStarted:
                guard let payload = try? event.payload(as: SessionPayload.self) else { continue }
                active = (event.kind == .focusStarted ? .focus : .break, payload, event.occurredAt, event.occurredAt)
            case .focusPaused, .focusResumed, .breakProgress:
                guard let payload = try? event.payload(as: SessionPayload.self),
                      var current = active,
                      current.payload.sessionID == payload.sessionID else { continue }
                current.payload.elapsedSeconds = payload.elapsedSeconds ?? current.payload.elapsedSeconds
                current.lastObservedAt = event.occurredAt
                active = current
            case .focusEnded, .breakEnded, .breakSkipped:
                guard let payload = try? event.payload(as: SessionPayload.self) else {
                    active = nil
                    continue
                }
                if active?.payload.sessionID == payload.sessionID { active = nil }
            default: break
            }
        }
        var engine = TimerEngine()
        if let active {
            engine.restorePausedSession(
                phase: active.phase,
                sessionID: active.payload.sessionID,
                startedAt: active.startedAt,
                targetSeconds: active.payload.targetSeconds,
                observedElapsedSeconds: active.payload.elapsedSeconds ?? 0,
                lastObservedAt: active.lastObservedAt,
                at: instant
            )
        }
        return engine
    }
}
