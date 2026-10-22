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
           fixedMeetings(in: blocks) == fixedMeetings(in: plan) {
            return blocks
        }
        return optimize(plan, minimumFocusMinutes: minimumFocusMinutes)
    }

    private static func fixedMeetings(in blocks: [PlanBlock]) -> [PlanBlock] {
        blocks.filter { $0.kind == .meeting }
    }

    private static func fixedMeetings(in plan: DayPlan) -> [PlanBlock] {
        let clipped = plan.meetings
            .filter { $0.end > $0.start && $0.end > plan.start && $0.start < plan.end }
            .sorted { $0.start < $1.start }
        var meetings: [PlanBlock] = []
        var cursor = plan.start
        for meeting in clipped {
            let start = max(plan.start, meeting.start, cursor)
            let end = min(plan.end, meeting.end)
            if end > start {
                meetings.append(PlanBlock(kind: .meeting, start: start, end: end, title: meeting.title))
                cursor = end
            }
        }
        return meetings
    }

    private struct State: Hashable {
        let work: Int
        let last: PlanBlockKind
        let focused: Bool
    }

    private struct Path {
        let cost: Double
        let previousTime: Int
        let previousState: State?
        let block: PlanBlock?
    }

    private static func ordered(_ lhs: State, _ rhs: State) -> Bool {
        if lhs.work != rhs.work { return lhs.work < rhs.work }
        if lhs.last != rhs.last { return lhs.last.rawValue < rhs.last.rawValue }
        return !lhs.focused && rhs.focused
    }

    private static func optimize(_ plan: DayPlan, minimumFocusMinutes: Int) -> [PlanBlock] {
        let goal = max(1, plan.focusMinutes)
        let maximum = goal + min(5, Int(Double(goal) * 0.1))
        let minimum = min(maximum, max(minimumFocusMinutes, goal / 2))
        let rest = max(1, plan.breakMinutes)
        let meetings = fixedMeetings(in: plan)
        var times = Set<Date>([plan.start, plan.end])
        var tick = plan.start.addingTimeInterval(60)
        while tick < plan.end {
            times.insert(tick)
            tick = tick.addingTimeInterval(60)
        }
        for meeting in meetings {
            times.insert(meeting.start)
            times.insert(meeting.end)
        }
        let grid = times.sorted()
        let positions = Dictionary(uniqueKeysWithValues: grid.enumerated().map { ($0.element, $0.offset) })
        let starts = Dictionary(uniqueKeysWithValues: meetings.map { (positions[$0.start]!, $0) })
        var nextMeeting = Array(repeating: grid.count - 1, count: grid.count)
        var next = grid.count - 1
        for index in grid.indices.reversed() {
            if starts[index] != nil { next = index }
            nextMeeting[index] = next
        }
        var paths = Array(repeating: [State: Path](), count: grid.count)
        let initial = State(work: 0, last: .free, focused: false)
        paths[0][initial] = Path(cost: 0, previousTime: 0, previousState: nil, block: nil)
        let workCap = max(2 * goal, 180)
        func put(_ time: Int, _ state: State, _ cost: Double, _ from: Int, _ previous: State, _ block: PlanBlock) {
            if let existing = paths[time][state], existing.cost <= cost { return }
            paths[time][state] = Path(cost: cost, previousTime: from, previousState: previous, block: block)
        }
        for index in grid.indices.dropLast() {
            for (state, path) in paths[index].sorted(by: { ordered($0.key, $1.key) }) {
                if let meeting = starts[index] {
                    let endIndex = positions[meeting.end]!
                    let duration = Int(meeting.end.timeIntervalSince(meeting.start) / 60)
                    put(endIndex, State(work: min(workCap, state.work + duration), last: .meeting, focused: false), path.cost,
                        index, state, meeting)
                    continue
                }
                let limit = nextMeeting[index] == index ? grid.count - 1 : nextMeeting[index]
                if index + 1 <= limit {
                    let duration = grid[index + 1].timeIntervalSince(grid[index]) / 60
                    let freeCost = 3 * duration + (state.last == .free && index != 0 ? 0 : 12)
                    put(index + 1, State(work: state.work, last: .free, focused: false), path.cost + freeCost,
                        index, state, PlanBlock(kind: .free, start: grid[index], end: grid[index + 1]))
                }
                if !state.focused {
                    for endIndex in (index + 1)..<grid.count {
                        if endIndex > limit { break }
                        let duration = grid[endIndex].timeIntervalSince(grid[index]) / 60
                        if duration > Double(maximum) { break }
                        if duration < Double(minimum) { continue }
                        let deviation = Double(goal) - duration
                        let overload = max(0, Double(state.work) + duration - Double(goal + 15))
                        let offFiveMinutes = duration.truncatingRemainder(dividingBy: 5) == 0 ? 0.0 : 1.5
                        let afterFree = state.last == .free && index > 0 ? 15.0 : 0.0
                        let cost = 8 + 0.03 * deviation * deviation + 0.015 * overload * overload + offFiveMinutes + afterFree
                        put(endIndex, State(work: min(workCap, state.work + Int(duration)), last: .focus, focused: true), path.cost + cost,
                            index, state, PlanBlock(kind: .focus, start: grid[index], end: grid[endIndex]))
                    }
                }
                if state.work > 0 && state.last != .break {
                    let end = grid[index].addingTimeInterval(TimeInterval(rest * 60))
                    if let endIndex = positions[end], endIndex <= limit, endIndex < grid.count - 1 {
                        let deviation = Double(state.work - goal)
                        let cost = 6 + (deviation < 0 ? 0.002 : 0.025) * deviation * deviation
                            + (state.last == .free ? 20 : 0)
                        put(endIndex, State(work: 0, last: .break, focused: false), path.cost + cost,
                            index, state, PlanBlock(kind: .break, start: grid[index], end: end))
                    }
                }
            }
        }
        guard let (finalState, _) = paths[grid.count - 1]
            .filter({ $0.key.work > 0 })
            .min(by: {
                if $0.value.cost != $1.value.cost { return $0.value.cost < $1.value.cost }
                return ordered($0.key, $1.key)
            }) else {
            return [PlanBlock(kind: .free, start: plan.start, end: plan.end)]
        }
        var blocks: [PlanBlock] = []
        var time = grid.count - 1
        var state = finalState
        while let path = paths[time][state], let block = path.block, let previousState = path.previousState {
            if block.kind == .free && blocks.last?.kind == .free && blocks.last?.start == block.end {
                blocks[blocks.count - 1].start = block.start
            } else {
                blocks.append(block)
            }
            time = path.previousTime
            state = previousState
        }
        return blocks.reversed()
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
