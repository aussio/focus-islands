import Foundation
import XCTest
@testable import CozyFocusCore

final class TodayGuideTests: XCTestCase {
    private let start = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_750_000_000)).addingTimeInterval(9 * 3600)
    private func date(_ minutes: Double) -> Date { start.addingTimeInterval(minutes * 60) }
    private func plan(focus: Int = 60, rest: Int = 15, meetings: [PlannedMeeting] = []) -> DayPlan {
        DayPlan(day: start, start: start, end: date(240), meetings: meetings, focusMinutes: focus, breakMinutes: rest)
    }
    private func guide(_ plan: DayPlan?, at minutes: Double, timer: TimerState = TimerState(), actual: [ActualInterval] = []) -> TodayGuidance {
        TodayGuide.guidance(plan: plan, blocks: plan.map { DayPlanner.suggest($0) } ?? [], actual: actual, at: date(minutes), timer: timer)
    }

    func testCompletedFocusRecommendsBreakFromActualEnd() {
        let work = ActualInterval(kind: .focus, start: date(0), end: date(40), confirmed: false, observedSeconds: 40 * 60)
        let result = guide(plan(), at: 40, actual: [work])
        XCTAssertEqual(result.situation, .rest)
        XCTAssertEqual(result.action, .rest(until: date(55)))
        XCTAssertTrue(result.detail.contains("completed focus"), result.detail)
    }

    func testCompletedFocusStopsOverridingScheduleAfterRestWindow() {
        let work = ActualInterval(kind: .focus, start: date(0), end: date(40), confirmed: false, observedSeconds: 40 * 60)
        let withActual = guide(plan(), at: 56, actual: [work])
        let scheduled = guide(plan(), at: 56)
        XCTAssertEqual(withActual.situation, scheduled.situation)
        XCTAssertEqual(withActual.action, scheduled.action)
    }

    func testCompletedBreakRecommendsFocusUntilMeetingBuffer() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(100), end: date(130))
        let rest = ActualInterval(kind: .break, start: date(50), end: date(65), confirmed: true, observedSeconds: 15 * 60)
        let result = guide(plan(meetings: [meeting]), at: 65, actual: [rest])
        XCTAssertEqual(result.situation, .focus)
        XCTAssertEqual(result.action, .focus(until: date(98)))
        XCTAssertTrue(result.detail.contains("completed break"), result.detail)

        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 80, actual: [rest]).action, .focus(until: date(98)))
    }

    func testActualFocusRecommendationYieldsToNearbyMeetingBoundary() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(58), end: date(88))
        let work = ActualInterval(kind: .focus, start: date(0), end: date(50), confirmed: false, observedSeconds: 50 * 60)
        let result = guide(plan(meetings: [meeting]), at: 50, actual: [work])
        XCTAssertEqual(result.situation, .meetingSoon)
        XCTAssertEqual(result.action, .rest(until: date(56)))
    }

    func testFocusUsesExactTimeLeftToScheduledBreak() {
        let day = plan()
        let firstFocus = DayPlanner.suggest(day)[0]
        let result = guide(day, at: 18.5)
        XCTAssertEqual(result.situation, .focus)
        XCTAssertEqual(result.action, .focus(until: firstFocus.end))
        if case .focus(let end) = result.action {
            XCTAssertEqual(end.timeIntervalSince(date(18.5)), firstFocus.end.timeIntervalSince(date(18.5)))
        }
    }

    func testChangingRhythmRecalculatesBothKindsOfSuggestion() {
        let longFocus = plan(focus: 60)
        let shortFocus = plan(focus: 40)
        let longEnd = DayPlanner.suggest(longFocus)[0].end
        let shortEnd = DayPlanner.suggest(shortFocus)[0].end
        XCTAssertNotEqual(longEnd, shortEnd)
        XCTAssertEqual(guide(longFocus, at: 18).action, .focus(until: longEnd))
        XCTAssertEqual(guide(shortFocus, at: 18).action, .focus(until: shortEnd))

        for rest in [15, 20] {
            let day = plan(rest: rest)
            let scheduledBreak = DayPlanner.suggest(day).first { $0.kind == .break }!
            let at = scheduledBreak.start.timeIntervalSince(start) / 60 + 1
            XCTAssertEqual(guide(day, at: at).action, .rest(until: scheduledBreak.end))
            XCTAssertEqual(scheduledBreak.end.timeIntervalSince(scheduledBreak.start), TimeInterval(rest * 60))
        }
    }

    func testNewMeetingShortensFocusAndLeavesReturnBuffer() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(42), end: date(72))
        let ordinaryEnd = DayPlanner.suggest(plan())[0].end
        XCTAssertEqual(guide(plan(), at: 0).action, .focus(until: ordinaryEnd))
        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 0).action, .focus(until: date(40)))
        XCTAssertGreaterThan(ordinaryEnd, date(40))
    }

    func testMeetingSoonSuggestsPauseAndDoesNotOfferTinyFocus() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(42), end: date(72))
        let result = guide(plan(meetings: [meeting]), at: 37)
        XCTAssertEqual(result.situation, .meetingSoon)
        XCTAssertEqual(result.action, .rest(until: date(40)))
        XCTAssertNil(guide(plan(meetings: [meeting]), at: 41).action)
        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 42).situation, .meeting)
        XCTAssertNil(guide(plan(meetings: [meeting]), at: 42).action)
        XCTAssertNotEqual(guide(plan(meetings: [meeting]), at: 72).situation, .meeting)
    }

    func testBreakCanUseNearbyMeetingBoundaryWithBuffer() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(78), end: date(108))
        var timer = TimerEngine()
        timer.startFocus(target: 3600, at: TimerInstant(wall: start, monotonicSeconds: 0))
        let result = guide(plan(meetings: [meeting]), at: 60, timer: timer.state)
        XCTAssertEqual(result.breakAction, .rest(until: date(76)))
    }

    func testCustomBlocksAreAuthoritative() {
        var custom = plan()
        custom.customBlocks = [
            PlanBlock(kind: .focus, start: start, end: date(42)),
            PlanBlock(kind: .break, start: date(42), end: date(62)),
            PlanBlock(kind: .focus, start: date(62), end: date(240))
        ]
        XCTAssertEqual(guide(custom, at: 18).action, .focus(until: date(42)))
        XCTAssertEqual(guide(custom, at: 45).action, .rest(until: date(62)))
    }

    func testRunningTimerKeepsOriginalTargetAfterPlanEdit() throws {
        var timer = TimerEngine()
        let original = try XCTUnwrap(guide(plan(), at: 18).action)
        guard case .focus(let end) = original else { return XCTFail("Expected focus") }
        let id = timer.startFocus(target: end.timeIntervalSince(date(18)), at: TimerInstant(wall: date(18), monotonicSeconds: 0))
        let changed = guide(plan(focus: 25), at: 20, timer: timer.state)
        XCTAssertEqual(changed.situation, .runningFocus)
        XCTAssertNil(changed.action)
        XCTAssertEqual(timer.state.targetSeconds, end.timeIntervalSince(date(18)))
        let payload = SessionPayload(sessionID: id, targetSeconds: timer.state.targetSeconds)
        XCTAssertEqual(payload.targetSeconds, end.timeIntervalSince(date(18)))
    }

    func testRunningFocusCallsOutMeetingThatStartsBeforeTimerEnds() {
        var timer = TimerEngine()
        timer.startFocus(target: 20 * 60, at: TimerInstant(wall: date(18), monotonicSeconds: 0))
        let meeting = PlannedMeeting(title: "Quick sync", start: date(25), end: date(40))
        let result = guide(plan(meetings: [meeting]), at: 18, timer: timer.state)
        XCTAssertEqual(result.situation, .runningFocus)
        XCTAssertTrue(result.detail.contains("Quick sync starts in 7 minutes"), result.detail)
        XCTAssertTrue(result.detail.contains("will not stop automatically"), result.detail)
        XCTAssertEqual(timer.state.targetSeconds, 20 * 60)
    }

    func testBreakDuePromptDoesNotUseAfterDayPlanCopy() {
        var timer = TimerEngine()
        timer.startFocus(target: 20 * 60, at: TimerInstant(wall: date(230), monotonicSeconds: 0))
        _ = timer.advance(to: TimerInstant(wall: date(250), monotonicSeconds: 20 * 60))
        let result = guide(plan(), at: 250, timer: timer.state)
        XCTAssertEqual(result.situation, .runningFocus)
        XCTAssertEqual(result.title, "Time for a real break")
        XCTAssertTrue(result.detail.contains("Start a break, snooze, or skip"), result.detail)
    }

    func testDayBoundsAndMidnightNeverReuseYesterdaysPlan() {
        XCTAssertEqual(guide(nil, at: 20).situation, .noPlan)
        XCTAssertEqual(guide(plan(), at: -1).situation, .beforeDay)
        XCTAssertEqual(guide(plan(), at: 240).situation, .afterDay)
        XCTAssertEqual(guide(plan(), at: 1440).situation, .noPlan)
        XCTAssertEqual(guide(plan(), at: 1440).action, .editPlan)
    }

    func testLongOpenTimeDoesNotTurnIntoAnOversizedBreak() {
        var custom = plan()
        custom.customBlocks = [PlanBlock(kind: .free, start: start, end: date(240))]
        XCTAssertEqual(guide(custom, at: 10).action, .rest(until: date(25)))
    }

    func testDeliberatelyShortFocusRhythmCanStillStartAwayFromMeetings() {
        var custom = plan(focus: 5)
        custom.customBlocks = [
            PlanBlock(kind: .focus, start: start, end: date(5)),
            PlanBlock(kind: .free, start: date(5), end: date(240))
        ]
        XCTAssertEqual(guide(custom, at: 1).action, .focus(until: date(5)))
    }

    func testRunningBreakDescribesFocusAvailableWhenItEnds() {
        var timer = TimerEngine()
        timer.startBreak(target: 15 * 60, at: TimerInstant(wall: date(60), monotonicSeconds: 0))
        _ = timer.advance(to: TimerInstant(wall: date(65), monotonicSeconds: 5 * 60))
        var changed = plan(focus: 40, rest: 20)
        changed.customBlocks = [
            PlanBlock(kind: .focus, start: start, end: date(60)),
            PlanBlock(kind: .break, start: date(60), end: date(75)),
            PlanBlock(kind: .focus, start: date(75), end: date(100)),
            PlanBlock(kind: .free, start: date(100), end: date(240))
        ]
        let result = guide(changed, at: 65, timer: timer.state)
        XCTAssertEqual(result.situation, .runningBreak)
        XCTAssertTrue(result.detail.contains("25 minutes of focus"), result.detail)
        XCTAssertEqual(timer.state.targetSeconds, 15 * 60)
    }

    func testEarlyBreakIsClippedToEndOfDay() {
        var timer = TimerEngine()
        timer.startFocus(target: 3600, at: TimerInstant(wall: date(220), monotonicSeconds: 0))
        XCTAssertEqual(guide(plan(rest: 20), at: 235, timer: timer.state).breakAction, .rest(until: date(240)))
    }
}
