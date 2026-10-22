import Foundation
import XCTest
@testable import CozyFocusCore

final class TodayGuideTests: XCTestCase {
    private let start = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_750_000_000)).addingTimeInterval(9 * 3600)
    private func date(_ minutes: Double) -> Date { start.addingTimeInterval(minutes * 60) }
    private func plan(focus: Int = 60, rest: Int = 15, meetings: [PlannedMeeting] = []) -> DayPlan {
        DayPlan(day: start, start: start, end: date(240), meetings: meetings, focusMinutes: focus, breakMinutes: rest)
    }
    private func guide(_ plan: DayPlan?, at minutes: Double, timer: TimerState = TimerState()) -> TodayGuidance {
        TodayGuide.guidance(plan: plan, blocks: plan.map { DayPlanner.suggest($0) } ?? [], at: date(minutes), timer: timer)
    }

    func testFocusUsesExactTimeLeftToScheduledBreak() {
        let result = guide(plan(), at: 18.5)
        XCTAssertEqual(result.situation, .focus)
        XCTAssertEqual(result.action, .focus(until: date(60)))
        if case .focus(let end) = result.action {
            XCTAssertEqual(end.timeIntervalSince(date(18.5)), 41.5 * 60)
        }
    }

    func testChangingRhythmRecalculatesBothKindsOfSuggestion() {
        XCTAssertEqual(guide(plan(focus: 60), at: 18).action, .focus(until: date(60)))
        XCTAssertEqual(guide(plan(focus: 40), at: 18).action, .focus(until: date(40)))
        XCTAssertEqual(guide(plan(rest: 15), at: 62).action, .rest(until: date(75)))
        XCTAssertEqual(guide(plan(rest: 20), at: 62).action, .rest(until: date(80)))
    }

    func testNewMeetingShortensFocusAndLeavesReturnBuffer() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(42), end: date(72))
        XCTAssertEqual(guide(plan(), at: 0).action, .focus(until: date(60)))
        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 0).action, .focus(until: date(40)))
    }

    func testMeetingSoonSuggestsPauseAndDoesNotOfferTinyFocus() {
        let meeting = PlannedMeeting(title: "Check-in", start: date(42), end: date(72))
        let result = guide(plan(meetings: [meeting]), at: 37)
        XCTAssertEqual(result.situation, .meetingSoon)
        XCTAssertEqual(result.action, .rest(until: date(40)))
        XCTAssertNil(guide(plan(meetings: [meeting]), at: 41).action)
        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 42).situation, .meeting)
        XCTAssertNil(guide(plan(meetings: [meeting]), at: 42).action)
        XCTAssertEqual(guide(plan(meetings: [meeting]), at: 72).situation, .focus)
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
        XCTAssertEqual(timer.state.targetSeconds, 42 * 60)
        let payload = SessionPayload(sessionID: id, targetSeconds: timer.state.targetSeconds)
        XCTAssertEqual(payload.targetSeconds, 42 * 60)
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
        let changed = plan(focus: 40, rest: 20)
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
