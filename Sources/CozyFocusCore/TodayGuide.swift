import Foundation

public struct TodayGuidance: Sendable, Equatable {
    public enum Situation: String, Sendable {
        case noPlan, beforeDay, afterDay, meeting, meetingSoon, focus, rest, free
        case runningFocus, runningBreak
    }

    public enum Action: Sendable, Equatable {
        case focus(until: Date)
        case rest(until: Date)
        case editPlan
    }

    public var situation: Situation
    public var title: String
    public var detail: String
    public var action: Action? = nil
    public var breakAction: Action? = nil
}

public enum TodayGuide {
    public static let meetingBuffer: TimeInterval = 2 * 60
    public static let minimumFocus: TimeInterval = 10 * 60

    public static func guidance(
        plan: DayPlan?, blocks: [PlanBlock], at now: Date,
        timer: TimerState = TimerState(), calendar: Calendar = .current
    ) -> TodayGuidance {
        let plan = plan.flatMap { calendar.isDate($0.day, inSameDayAs: now) ? $0 : nil }
        let scheduled = scheduleGuidance(plan: plan, blocks: blocks, at: now)
        guard timer.phase != .idle else { return scheduled }
        let isFocus = timer.phase == .focus
        let title: String
        if timer.isSleeping {
            title = isFocus ? "Focus is paused" : "Your break is paused"
        } else if timer.isDue {
            title = isFocus ? "Time for a real break" : "Welcome back, whenever you're ready"
        } else {
            title = isFocus ? "One thing at a time" : "A little room to recharge"
        }
        let boundary = blocks.first { $0.end > now }
        let context: String
        if let plan, !isFocus, now >= plan.start, now < plan.end {
            context = nextFocusDescription(blocks: blocks, after: now.addingTimeInterval(timer.remainingSeconds))
        } else if let plan, let boundary, now >= plan.start, now < plan.end {
            context = "\(boundary.title ?? label(boundary.kind)) until \(time(boundary.end)). Your running timer keeps the length you started."
        } else {
            context = scheduled.detail
        }
        return TodayGuidance(
            situation: isFocus ? .runningFocus : .runningBreak, title: title,
            detail: context, action: nil,
            breakAction: isFocus ? proposedBreak(plan: plan, blocks: blocks, at: now) : nil
        )
    }

    private static func scheduleGuidance(plan: DayPlan?, blocks: [PlanBlock], at now: Date) -> TodayGuidance {
        guard let plan else {
            return TodayGuidance(situation: .noPlan, title: "Give today a little shape",
                                 detail: "Set your day bounds and meetings to see what fits next.", action: .editPlan)
        }
        guard now >= plan.start else {
            return TodayGuidance(situation: .beforeDay, title: "Your day starts at \(time(plan.start))",
                                 detail: "Your schedule is ready. Start when your day begins, or adjust your plan.", action: .editPlan)
        }
        guard now < plan.end else {
            return TodayGuidance(situation: .afterDay, title: "You've reached the end of your plan",
                                 detail: "Leave some room for life. You can adjust your finish time if there's more to do.", action: .editPlan)
        }
        let block = blocks.first { $0.start <= now && now < $0.end }
        let meeting = blocks.first { $0.kind == .meeting && $0.end > now }
        if let block, block.kind == .meeting {
            return TodayGuidance(situation: .meeting, title: block.title ?? "Meeting time",
                                 detail: "You're in a meeting until \(time(block.end)). Your next suggestion will be here when it ends.")
        }
        if let meeting, meeting.start.timeIntervalSince(now) < minimumFocus + meetingBuffer {
            let rest = proposedBreak(plan: plan, blocks: blocks, at: now)
            return TodayGuidance(situation: .meetingSoon, title: "\(meeting.title ?? "Your meeting") starts soon",
                                 detail: "Only \(minutes(meeting.start.timeIntervalSince(now))) minutes until \(time(meeting.start)). Take a pause and leave two minutes to get ready.", action: rest)
        }
        guard let block else {
            return TodayGuidance(situation: .free, title: "A little open time",
                                 detail: "Your plan has room here. Take a pause or adjust what comes next.", action: .editPlan)
        }
        let focusEnd = min(block.end, meeting.map { $0.start.addingTimeInterval(-meetingBuffer) } ?? plan.end)
        switch block.kind {
        case .focus where focusEnd.timeIntervalSince(now) >= 60:
            let next = blocks.first { $0.start >= block.end }
            let detail = next.map { "\(label($0.kind)) at \(time($0.start)). This focus session fits the time left in your plan." }
                ?? "Your planned day ends at \(time(plan.end)). This session fits the time you have left."
            return TodayGuidance(situation: .focus, title: "Focus for \(minutes(focusEnd.timeIntervalSince(now))) minutes",
                                 detail: detail, action: .focus(until: focusEnd))
        case .break:
            let action = proposedBreak(plan: plan, blocks: blocks, at: now)
            return TodayGuidance(situation: .rest, title: "Make room for a break",
                                 detail: nextFocusDescription(blocks: blocks, after: block.end), action: action)
        default:
            return TodayGuidance(situation: .free, title: "A short pause fits here",
                                 detail: "There's a little time before the next block. Step away or get ready for what's coming.",
                                 action: proposedBreak(plan: plan, blocks: blocks, at: now))
        }
    }

    private static func proposedBreak(plan: DayPlan?, blocks: [PlanBlock], at now: Date) -> TodayGuidance.Action? {
        guard let plan, now >= plan.start, now < plan.end,
              !blocks.contains(where: { $0.kind == .meeting && $0.start <= now && now < $0.end }) else { return nil }
        let block = blocks.first { $0.start <= now && now < $0.end }
        let meeting = blocks.first { $0.kind == .meeting && $0.start > now }
        var end = min(plan.end, now.addingTimeInterval(TimeInterval(max(1, plan.breakMinutes) * 60)))
        if let block, block.kind == .break { end = block.end }
        if let block, block.kind == .free { end = min(end, block.end) }
        if let meeting {
            let readyAt = meeting.start.addingTimeInterval(-meetingBuffer)
            if readyAt.timeIntervalSince(end) <= 5 * 60 { end = readyAt }
            end = min(end, readyAt)
        }
        guard end.timeIntervalSince(now) >= 60 else { return nil }
        return .rest(until: end)
    }

    private static func nextFocusDescription(blocks: [PlanBlock], after date: Date) -> String {
        guard let next = blocks.first(where: { $0.end > date }) else { return "Your planned day ends at \(time(date))." }
        if next.kind == .focus {
            return "Then \(minutes(next.end.timeIntervalSince(max(date, next.start)))) minutes of focus until \(time(next.end))."
        }
        if next.start < date {
            return "\(next.title ?? label(next.kind)) is scheduled until \(time(next.end))."
        }
        return "\(next.title ?? label(next.kind)) is next at \(time(next.start))."
    }

    private static func minutes(_ seconds: TimeInterval) -> Int { max(1, Int(ceil(seconds / 60))) }
    private static func time(_ date: Date) -> String { date.formatted(.dateTime.hour().minute()) }
    private static func label(_ kind: PlanBlockKind) -> String {
        switch kind {
        case .focus: "Focus time"
        case .break: "A break"
        case .meeting: "A meeting"
        case .free: "Open time"
        }
    }
}
