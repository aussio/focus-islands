import Foundation
import XCTest
@testable import CozyFocusCore

final class CoreTests: XCTestCase {
    private func instant(_ second: TimeInterval) -> TimerInstant {
        TimerInstant(wall: Date(timeIntervalSince1970: 1_700_000_000 + second), monotonicSeconds: second)
    }

    func testFocusDueSleepAndOvertimeCreditCap() {
        var timer = TimerEngine(nudgeInterval: 60)
        _ = timer.startFocus(target: 300, at: instant(0))
        XCTAssertEqual(timer.advance(to: instant(240)), [])
        timer.pauseForSleep(at: instant(240))
        timer.resumeFromSleep(at: instant(1_240))
        XCTAssertEqual(timer.advance(to: instant(1_300)), [.breakDue])
        XCTAssertEqual(timer.state.elapsedSeconds, 300)
        XCTAssertEqual(timer.advance(to: instant(1_400)), [.overdueNudge])
        XCTAssertEqual(timer.endFocus(at: instant(1_500)), 300)
    }

    func testSnoozeDefersNudge() {
        var timer = TimerEngine(nudgeInterval: 60)
        _ = timer.startFocus(target: 60, at: instant(0))
        XCTAssertEqual(timer.advance(to: instant(60)), [.breakDue])
        timer.snooze(minutes: 5, at: instant(60))
        XCTAssertEqual(timer.advance(to: instant(120)), [])
        XCTAssertEqual(timer.advance(to: instant(360)), [.overdueNudge])
    }

    func testBreakSleepCountsOnlyToTarget() {
        var timer = TimerEngine()
        _ = timer.startBreak(target: 300, at: instant(0))
        timer.pauseForSleep(at: instant(60))
        XCTAssertEqual(timer.resumeFromSleep(at: instant(3_660)), [.breakComplete])
        XCTAssertEqual(timer.state.elapsedSeconds, 300)
    }

    func testPlannerKeepsMeetingsAndDoesNotEndWithBreak() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let meeting = PlannedMeeting(title: "Standup", start: start.addingTimeInterval(30 * 60), end: start.addingTimeInterval(60 * 60))
        let plan = DayPlan(day: start, start: start, end: start.addingTimeInterval(120 * 60), meetings: [meeting], focusMinutes: 25, breakMinutes: 5)
        let blocks = DayPlanner.suggest(plan)
        XCTAssertTrue(blocks.contains { $0.kind == .meeting && $0.title == "Standup" })
        XCTAssertEqual(blocks.last?.end, plan.end)
        XCTAssertNotEqual(blocks.last?.kind, .break)
        for pair in zip(blocks, blocks.dropFirst()) { XCTAssertEqual(pair.0.end, pair.1.start) }
    }

    func testLegacyPlanWithTasksStillDecodes() throws {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let plan = DayPlan(day: start, start: start, end: start.addingTimeInterval(3_600))
        let encoded = try JSONEncoder().encode(plan)
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        legacy["tasks"] = ["Old task"]
        let legacyData = try JSONSerialization.data(withJSONObject: legacy)
        XCTAssertEqual(try JSONDecoder().decode(DayPlan.self, from: legacyData), plan)
        let current = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(current["tasks"])
    }

    func testStoreReplayGrantsPurchaseAndBackup() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SQLiteEventStore(url: directory.appendingPathComponent("events.sqlite"))
        let sessionID = UUID()
        let grant = RewardEngine.focusGrant(sessionID: sessionID, observedSeconds: 60 * 40, targetSeconds: 60 * 25)
        XCTAssertEqual(grant.amount, 25)
        _ = try store.append(kind: .rewardGranted, payload: grant, uniqueKey: RewardEngine.uniqueGrantKey(reason: "focus", sourceID: sessionID, policyVersion: 1))
        XCTAssertThrowsError(try store.append(kind: .rewardGranted, payload: grant, uniqueKey: RewardEngine.uniqueGrantKey(reason: "focus", sourceID: sessionID, policyVersion: 1)))
        XCTAssertEqual(try store.balance(), 25)
        XCTAssertFalse(try store.purchase(itemID: "plant", cost: 35))
        XCTAssertTrue(try store.purchase(itemID: "leaf", cost: 20))
        XCTAssertFalse(try store.purchase(itemID: "leaf", cost: 20))
        XCTAssertEqual(try store.balance(), 5)
        let events = try store.allEvents()
        XCTAssertEqual(events.map(\.sequence), [1, 2, 3])
        XCTAssertTrue(RewardEngine.unlockedItems(events: events).contains("leaf"))
        let backupURL = directory.appendingPathComponent("backup.sqlite")
        try store.backup(to: backupURL)
        let backup = try SQLiteEventStore(url: backupURL)
        XCTAssertEqual(try backup.balance(), 5)
        let exportURL = directory.appendingPathComponent("events.json")
        try store.exportJSON(to: exportURL)
        let export = try String(contentsOf: exportURL, encoding: .utf8)
        XCTAssertTrue(export.contains("\"rewardGranted\""))
    }

    func testTestingProfileCannotMixEventsWithLegacyPersonalDatabase() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let personalURL = DataProfile.personal.databaseURL(in: directory)
        let testingURL = DataProfile.testing.databaseURL(in: directory)
        XCTAssertEqual(personalURL.lastPathComponent, "events.sqlite")
        XCTAssertNotEqual(personalURL, testingURL)

        let personal = try SQLiteEventStore(url: personalURL)
        let personalEvent = try personal.append(kind: .reflection, payload: ReflectionPayload(day: .now, note: "personal fact"))
        let testing = try SQLiteEventStore(url: testingURL)
        _ = try testing.append(kind: .reflection, payload: ReflectionPayload(day: .now, note: "test fact"))

        XCTAssertEqual(try personal.allEvents().map(\.id), [personalEvent.id])
        XCTAssertEqual(try testing.allEvents().count, 1)
        XCTAssertNotEqual(try testing.allEvents().first?.id, personalEvent.id)
        XCTAssertEqual(try SQLiteEventStore(url: personalURL).allEvents().map(\.id), [personalEvent.id])
    }

    func testDayProjectionKeepsPlanSeparateFromActual() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SQLiteEventStore(url: directory.appendingPathComponent("events.sqlite"))
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let plan = DayPlan(day: start, start: start, end: start.addingTimeInterval(3_600))
        _ = try store.append(kind: .dayPlan, payload: plan, occurredAt: start)
        let sessionID = UUID()
        _ = try store.append(kind: .focusStarted, payload: SessionPayload(sessionID: sessionID, targetSeconds: 1_500), occurredAt: start)
        _ = try store.append(kind: .focusEnded, payload: SessionPayload(sessionID: sessionID, targetSeconds: 1_500, elapsedSeconds: 1_200), occurredAt: start.addingTimeInterval(3_600))
        let projection = DayProjection.project(events: try store.allEvents(), on: start)
        XCTAssertNotNil(projection.plan)
        XCTAssertFalse(projection.suggestions.isEmpty)
        XCTAssertEqual(projection.focusSeconds, 1_200)
        XCTAssertEqual(projection.actual.first?.end.timeIntervalSince(projection.actual.first!.start), 3_600)
        XCTAssertEqual(projection.breakSeconds, 0)
    }

    func testEditedTimelineSurvivesPlanRevisionAndReload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("events.sqlite")
        let store = try SQLiteEventStore(url: url)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let original = DayPlan(day: start, start: start, end: start.addingTimeInterval(3_600))
        let first = try store.append(kind: .dayPlan, payload: original, occurredAt: start)
        var edited = original
        var blocks = DayPlanner.suggest(original)
        XCTAssertFalse(blocks.isEmpty)
        blocks[0].kind = .free
        edited.customBlocks = blocks
        edited.revisesEventID = first.id
        _ = try store.append(kind: .dayPlanRevised, payload: edited, occurredAt: start.addingTimeInterval(60))
        let reopened = try SQLiteEventStore(url: url)
        let projection = DayProjection.project(events: try reopened.allEvents(), on: start)
        XCTAssertEqual(projection.plan?.revisesEventID, first.id)
        XCTAssertEqual(projection.suggestions.first?.kind, .free)
        XCTAssertEqual(projection.suggestions.first?.start, original.start)
    }

    func testTimelineTimingEditsPreserveMeetingsAndDayBounds() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let meeting = PlannedMeeting(title: "Check-in", start: start.addingTimeInterval(35 * 60), end: start.addingTimeInterval(65 * 60))
        var plan = DayPlan(day: start, start: start, end: start.addingTimeInterval(100 * 60), meetings: [meeting])
        let original = DayPlanner.suggest(plan)
        let fixed = original.filter { $0.kind == .meeting }
        guard let first = DayPlanner.edit(original, at: 0, change: .durationMinutes(20)),
              let second = DayPlanner.edit(first, at: 0, change: .start(start.addingTimeInterval(5 * 60))) else {
            return XCTFail("Expected valid timing edits")
        }
        XCTAssertEqual(second.first?.start, start)
        XCTAssertEqual(second.last?.end, plan.end)
        XCTAssertEqual(second.filter { $0.kind == .meeting }, fixed)
        XCTAssertTrue(zip(second, second.dropFirst()).allSatisfy { $0.end == $1.start })
        XCTAssertNil(DayPlanner.edit(second, at: 0, change: .durationMinutes(50)))
        plan.customBlocks = second
        XCTAssertEqual(DayPlanner.suggest(plan), second)
        var invalid = second
        if let index = invalid.firstIndex(where: { $0.kind == .meeting }) {
            invalid[index].start = invalid[index].start.addingTimeInterval(60)
        }
        plan.customBlocks = invalid
        XCTAssertEqual(DayPlanner.suggest(plan).filter { $0.kind == .meeting }, fixed)
    }

    func testIdleFocusDiscountRemovesUnobservedCredit() {
        var timer = TimerEngine()
        let start = instant(0)
        timer.startFocus(target: 1_500, at: start)
        _ = timer.advance(to: instant(130))
        timer.pauseForSleep(at: instant(130))
        timer.discountIdleFocus(seconds: 125)
        XCTAssertEqual(timer.state.elapsedSeconds, 5)
        _ = timer.advance(to: instant(730))
        XCTAssertEqual(timer.state.elapsedSeconds, 5)
        _ = timer.resumeFromSleep(at: instant(730))
        _ = timer.advance(to: instant(790))
        XCTAssertEqual(timer.state.elapsedSeconds, 65)
    }

    func testRewardRebalancePreviewUsesFactsWithoutChangingBalance() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SQLiteEventStore(url: directory.appendingPathComponent("events.sqlite"))
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let focusID = UUID()
        let breakID = UUID()
        _ = try store.append(kind: .focusEnded, payload: SessionPayload(sessionID: focusID, targetSeconds: 1_500, elapsedSeconds: 1_200), occurredAt: date)
        _ = try store.append(kind: .breakConfirmed, payload: SessionPayload(sessionID: breakID, targetSeconds: 300, elapsedSeconds: 300), occurredAt: date)
        _ = try store.append(kind: .breakEnded, payload: SessionPayload(sessionID: breakID, targetSeconds: 300, elapsedSeconds: 300), occurredAt: date)
        _ = try store.append(kind: .rewardGranted, payload: RewardPayload(amount: 30, policyVersion: 1, reason: "old"), occurredAt: date)
        _ = try store.append(kind: .rewardDebited, payload: RewardPayload(amount: -5, policyVersion: 1, reason: "purchase"), occurredAt: date)
        let events = try store.allEvents()
        var proposed = BalancePolicy.v1
        proposed.focusCreditsPerMinute = 2
        proposed.breakBonus = 15
        let preview = RewardEngine.previewRebalance(events: events, policy: proposed)
        XCTAssertEqual(preview.currentBalance, 25)
        XCTAssertEqual(preview.projectedBalance, 50)
        XCTAssertEqual(preview.focusSessions, 1)
        XCTAssertEqual(preview.confirmedBreaks, 1)
        XCTAssertEqual(RewardEngine.balance(events: try store.allEvents()), 25)
    }

    func testRecoveryDoesNotCreditUnknownWallGap() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SQLiteEventStore(url: directory.appendingPathComponent("events.sqlite"))
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let sessionID = UUID()
        _ = try store.append(kind: .focusStarted, payload: SessionPayload(sessionID: sessionID, targetSeconds: 1_500), occurredAt: start)
        _ = try store.append(kind: .focusPaused, payload: SessionPayload(sessionID: sessionID, targetSeconds: 1_500, elapsedSeconds: 600), occurredAt: start.addingTimeInterval(600))
        let recovered = TimerEngine.recover(events: try store.allEvents(), at: TimerInstant(wall: start.addingTimeInterval(86_400), monotonicSeconds: 10))
        XCTAssertEqual(recovered.state.phase, .focus)
        XCTAssertEqual(recovered.state.elapsedSeconds, 600)
        XCTAssertEqual(recovered.state.unknownGapStartedAt, start.addingTimeInterval(600))
    }
}
