import Foundation

public struct PlannedMeeting: Codable, Sendable, Equatable, Identifiable {
    public var id: UUID
    public var title: String
    public var start: Date
    public var end: Date

    public init(id: UUID = UUID(), title: String, start: Date, end: Date) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
    }
}

public struct DayPlan: Codable, Sendable, Equatable {
    public var day: Date
    public var start: Date
    public var end: Date
    public var meetings: [PlannedMeeting]
    public var focusMinutes: Int
    public var breakMinutes: Int
    public var revisesEventID: UUID?
    public var customBlocks: [PlanBlock]?

    public init(day: Date, start: Date, end: Date, meetings: [PlannedMeeting] = [], focusMinutes: Int = 25, breakMinutes: Int = 5, revisesEventID: UUID? = nil, customBlocks: [PlanBlock]? = nil) {
        self.day = day
        self.start = start
        self.end = end
        self.meetings = meetings
        self.focusMinutes = focusMinutes
        self.breakMinutes = breakMinutes
        self.revisesEventID = revisesEventID
        self.customBlocks = customBlocks
    }
}

public enum PlanBlockKind: String, Codable, Sendable {
    case meeting, focus, `break`, free
}

public struct PlanBlock: Codable, Sendable, Equatable {
    public var kind: PlanBlockKind
    public var start: Date
    public var end: Date
    public var title: String?

    public init(kind: PlanBlockKind, start: Date, end: Date, title: String? = nil) {
        self.kind = kind
        self.start = start
        self.end = end
        self.title = title
    }
}

public enum DayPlanner {
    public enum Edit: Sendable {
        case start(Date)
        case durationMinutes(Int)
    }

    /// Moves one edge of a non-meeting block. The neighboring flexible block
    /// absorbs the change; a shorter block next to a meeting leaves open time.
    public static func edit(_ blocks: [PlanBlock], at index: Int, change: Edit) -> [PlanBlock]? {
        guard blocks.indices.contains(index), blocks[index].kind != .meeting else { return nil }
        var result = blocks
        let minimum: TimeInterval = 60
        switch change {
        case .start(let start):
            let old = result[index].start
            guard start != old, start >= blocks[0].start,
                  start <= result[index].end.addingTimeInterval(-minimum) else { return nil }
            if index > 0 && result[index - 1].kind != .meeting {
                guard start >= result[index - 1].start.addingTimeInterval(minimum) else { return nil }
                result[index - 1].end = start
                result[index].start = start
            } else {
                guard start > old else { return nil }
                result[index].start = start
                result.insert(PlanBlock(kind: .free, start: old, end: start), at: index)
            }
        case .durationMinutes(let minutes):
            guard minutes >= 1 else { return nil }
            let old = result[index].end
            let end = result[index].start.addingTimeInterval(TimeInterval(minutes * 60))
            guard end != old, end <= blocks.last!.end else { return nil }
            if index + 1 < result.count && result[index + 1].kind != .meeting {
                guard end <= result[index + 1].end.addingTimeInterval(-minimum) else { return nil }
                result[index].end = end
                result[index + 1].start = end
            } else {
                guard end < old else { return nil }
                result[index].end = end
                result.insert(PlanBlock(kind: .free, start: end, end: old), at: index + 1)
            }
        }
        guard result.allSatisfy({ $0.end > $0.start }),
              zip(result, result.dropFirst()).allSatisfy({ $0.0.end == $0.1.start }) else { return nil }
        return result
    }

    public static func suggest(_ plan: DayPlan, minimumFocusMinutes: Int = 10) -> [PlanBlock] {
        guard plan.end > plan.start else { return [] }
        if let blocks = plan.customBlocks,
           blocks.first?.start == plan.start,
           blocks.last?.end == plan.end,
           blocks.allSatisfy({ $0.end > $0.start }),
           zip(blocks, blocks.dropFirst()).allSatisfy({ $0.0.end == $0.1.start }),
           fixedMeetings(in: blocks) == fixedMeetings(in: suggest(DayPlan(
               day: plan.day, start: plan.start, end: plan.end, meetings: plan.meetings,
               focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes
           ))) {
            return blocks
        }
        let meetings = plan.meetings
            .filter { $0.end > $0.start && $0.end > plan.start && $0.start < plan.end }
            .sorted { $0.start < $1.start }
        var result: [PlanBlock] = []
        var cursor = plan.start
        for meeting in meetings {
            let meetingStart = max(meeting.start, plan.start)
            let meetingEnd = min(meeting.end, plan.end)
            if meetingStart > cursor {
                result += fillGap(start: cursor, end: meetingStart, focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes, minimumFocusMinutes: minimumFocusMinutes)
            }
            if meetingEnd > cursor {
                result.append(PlanBlock(kind: .meeting, start: max(cursor, meetingStart), end: meetingEnd, title: meeting.title))
                cursor = meetingEnd
            }
        }
        if cursor < plan.end {
            result += fillGap(start: cursor, end: plan.end, focusMinutes: plan.focusMinutes, breakMinutes: plan.breakMinutes, minimumFocusMinutes: minimumFocusMinutes)
        }
        return result
    }

    private static func fixedMeetings(in blocks: [PlanBlock]) -> [PlanBlock] {
        blocks.filter { $0.kind == .meeting }
    }

    private static func fillGap(start: Date, end: Date, focusMinutes: Int, breakMinutes: Int, minimumFocusMinutes: Int) -> [PlanBlock] {
        let focus = TimeInterval(max(1, focusMinutes) * 60)
        let rest = TimeInterval(max(1, breakMinutes) * 60)
        let minimum = TimeInterval(max(1, minimumFocusMinutes) * 60)
        var blocks: [PlanBlock] = []
        var cursor = start
        while end.timeIntervalSince(cursor) >= minimum {
            let focusEnd = min(end, cursor.addingTimeInterval(focus))
            blocks.append(PlanBlock(kind: .focus, start: cursor, end: focusEnd))
            cursor = focusEnd
            let remaining = end.timeIntervalSince(cursor)
            // Do not suggest a break at the very end of the workday or meeting gap.
            if remaining >= rest + minimum {
                let breakEnd = cursor.addingTimeInterval(rest)
                blocks.append(PlanBlock(kind: .break, start: cursor, end: breakEnd))
                cursor = breakEnd
            } else { break }
        }
        if cursor < end { blocks.append(PlanBlock(kind: .free, start: cursor, end: end)) }
        return blocks
    }
}

public struct ActualInterval: Sendable, Equatable {
    public var kind: PlanBlockKind
    public var start: Date
    public var end: Date
    public var confirmed: Bool
    public var observedSeconds: TimeInterval
}

public struct DayProjection: Sendable {
    public var plan: DayPlan?
    public var suggestions: [PlanBlock]
    public var actual: [ActualInterval]
    public var focusSeconds: TimeInterval
    public var breakSeconds: TimeInterval
    public var awaySeconds: TimeInterval

    public static func project(events: [Event], on day: Date, calendar: Calendar = .current) -> DayProjection {
        let dayBounds = calendar.dateInterval(of: .day, for: day)!
        var plan: DayPlan?
        var starts: [EventKind: Date] = [:]
        var actual: [ActualInterval] = []
        var awaySeconds: TimeInterval = 0
        var confirmedBreaks = Set<UUID>()
        for event in events.sorted(by: { $0.sequence < $1.sequence }) {
            if (event.kind == .dayPlan || event.kind == .dayPlanRevision || event.kind == .dayPlanRevised),
               let candidate = try? event.payload(as: DayPlan.self),
               calendar.isDate(candidate.day, inSameDayAs: day) { plan = candidate }
            if event.kind == .breakConfirmed,
               let payload = try? event.payload(as: SessionPayload.self) {
                confirmedBreaks.insert(payload.sessionID)
            }
        }
        var sessionIDs: [EventKind: UUID] = [:]
        for event in events.sorted(by: { $0.sequence < $1.sequence }) {
            let startKind: EventKind?
            let endKind: EventKind?
            let blockKind: PlanBlockKind?
            switch event.kind {
            case .focusStarted: startKind = .focusStarted; endKind = nil; blockKind = .focus
            case .focusEnded: startKind = nil; endKind = .focusStarted; blockKind = .focus
            case .breakStarted: startKind = .breakStarted; endKind = nil; blockKind = .break
            case .breakEnded: startKind = nil; endKind = .breakStarted; blockKind = .break
            case .awayStarted: startKind = .awayStarted; endKind = nil; blockKind = .free
            case .awayEnded: startKind = nil; endKind = .awayStarted; blockKind = .free
            default: continue
            }
            if let startKind {
                starts[startKind] = event.occurredAt
                if let payload = try? event.payload(as: SessionPayload.self) { sessionIDs[startKind] = payload.sessionID }
            }
            if let endKind, let start = starts.removeValue(forKey: endKind), let blockKind {
                let clippedStart = max(start, dayBounds.start)
                let clippedEnd = min(event.occurredAt, dayBounds.end)
                if clippedEnd > clippedStart {
                    let confirmed = blockKind == .break && sessionIDs[endKind].map { confirmedBreaks.contains($0) } == true
                    let wallSeconds = clippedEnd.timeIntervalSince(clippedStart)
                    let reportedSeconds = (try? event.payload(as: SessionPayload.self).elapsedSeconds) ?? nil
                    let observedSeconds = blockKind == .free ? wallSeconds : min(wallSeconds, max(0, reportedSeconds ?? 0))
                    actual.append(ActualInterval(kind: blockKind, start: clippedStart, end: clippedEnd, confirmed: confirmed, observedSeconds: observedSeconds))
                    if endKind == .awayStarted { awaySeconds += clippedEnd.timeIntervalSince(clippedStart) }
                }
                sessionIDs.removeValue(forKey: endKind)
            }
        }
        return DayProjection(
            plan: plan,
            suggestions: plan.map { DayPlanner.suggest($0) } ?? [],
            actual: actual,
            focusSeconds: actual.filter { $0.kind == .focus }.reduce(0) { $0 + $1.observedSeconds },
            breakSeconds: actual.filter { $0.kind == .break && $0.confirmed }.reduce(0) { $0 + $1.observedSeconds },
            awaySeconds: awaySeconds
        )
    }
}
