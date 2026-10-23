import AppKit
import CoreGraphics
import Foundation
import SwiftUI
import UserNotifications
import CozyFocusCore

enum AppPage: String, CaseIterable, Identifiable {
    case today, plan, history, room, settings
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var symbol: String {
        switch self {
        case .today: "sun.max.fill"
        case .plan: "calendar"
        case .history: "chart.bar.fill"
        case .room: "house.fill"
        case .settings: "gearshape.fill"
        }
    }
}

enum FocusPhase { case idle, focus, rest }
enum DevScenario { case morning, breakDue, completedDay }

struct MeetingRow: Identifiable {
    let id: UUID
    var title: String
    var start: Date
    var duration: Int
}
struct SuggestedRow: Identifiable {
    let id = UUID()
    var kind: String
    var start: Date
    var minutes: Int
    var title: String?
}
struct HistoryRow: Identifiable {
    let id: UUID
    var title: String
    var symbol: String
    var date: Date
}
struct ShopItem: Identifiable {
    let id: String
    let name: String
    let symbol: String
    let cost: Int
}

private struct EmptyPayload: Codable {}
private struct AwayPayload: Codable { let reason: String }
private enum SuspensionReason: Hashable { case idle, sleep, locked }
private struct AppPreferences: Codable {
    let focusMinutes: Int
    let breakMinutes: Int
    let notificationsEnabled: Bool
}

final class AppModel: ObservableObject {
    @Published var page: AppPage = .today
    @Published private(set) var profile: DataProfile = .personal
    @Published var displaySeconds: TimeInterval = 0
    @Published var focusLength = 25 { didSet { planInputsChanged() } }
    @Published var breakLength = 5 { didSet { planInputsChanged() } }
    @Published var notificationsEnabled = true
    @Published var previewFocusCredits = BalancePolicy.current.focusCreditsPerMinute
    @Published var previewBreakBonus = BalancePolicy.current.breakBonus
    @Published var dayStart: Date { didSet { planInputsChanged() } }
    @Published var dayEnd: Date { didSet { planInputsChanged() } }
    @Published private(set) var currentWallTime = Date()
    @Published var meetingDraft = ""
    @Published var meetingTime: Date = .now
    @Published var meetingDuration = 30
    @Published var showingMeetingEditor = false
    @Published var reflection = ""
    @Published private(set) var savedReflection: String?
    @Published var reflectionIsEditing = true
    @Published private(set) var meetings: [MeetingRow] = []
    @Published private(set) var suggestions: [SuggestedRow] = []
    @Published private(set) var history: [HistoryRow] = []
    @Published private(set) var plannedTimeline: [PlanBlock] = []
    @Published private(set) var actualTimeline: [ActualInterval] = []
    @Published private(set) var yesterdayTimeline: [ActualInterval] = []
    @Published private(set) var yesterdayFocusMinutes = 0
    @Published private(set) var yesterdayBreakMinutes = 0
    @Published private(set) var coins = 0
    @Published private(set) var focusMinutesToday = 0
    @Published private(set) var breakMinutesToday = 0
    @Published private(set) var unlockedItems: Set<String> = []
    @Published var statusMessage: String?
    @Published private(set) var breakDue = false

    let shopItems = RoomCatalog.shopItems(policy: .current)

    private var timer = TimerEngine()
    private var store: SQLiteEventStore?
    private var clockOffset: TimeInterval = 0
    private var wallClockOffset: TimeInterval = 0
    private var awayStartedAt: Date?
    private var suspendedReasons: Set<SuspensionReason> = []
    private var lastCheckpoint: Date = .distantPast
    private var lastStatusPublish: Date = .distantPast
    private var lastInputReminder: Date = .distantPast
    private var lastTickInstant: TimerInstant?
    private let statusURL: URL
    private var databaseURL: URL
    private let applicationSupportURL: URL
    private let isDevelopmentMode: Bool
    private var latestPlanEventID: UUID?
    private var currentPlan: DayPlan?
    private var isLoadingPlan = false
    private var persistedPlan: DayPlan?
    private var pendingPlan: DayPlan?
    private var pendingPlanWork: DispatchWorkItem?
    private let defaults = UserDefaults.standard

    var todayPlan: DayPlan? {
        currentPlan.flatMap { Calendar.current.isDate($0.day, inSameDayAs: currentWallTime) ? $0 : nil }
    }
    var todayGuidance: TodayGuidance { guidance(at: currentWallTime) }
    var timerTargetSeconds: TimeInterval { timer.state.targetSeconds }
    var todayProposedSeconds: TimeInterval {
        switch todayGuidance.action {
        case .focus(let end), .rest(let end): max(0, end.timeIntervalSince(currentWallTime))
        default: 0
        }
    }

    func setDevelopmentDayMinute(_ minute: Int) {
        guard isDevelopmentMode, phase == .idle else { return }
        let date = dayStart.addingTimeInterval(TimeInterval(minute * 60))
        wallClockOffset += date.timeIntervalSince(now().wall)
        tick()
    }

    private func guidance(at date: Date) -> TodayGuidance {
        TodayGuide.guidance(plan: currentPlan, blocks: plannedTimeline, at: date, timer: timer.state)
    }

    func todayActionLabel(_ action: TodayGuidance.Action) -> String {
        switch action {
        case .editPlan: return "Shape today's plan"
        case .focus(let end): return "Focus for \(max(1, Int(ceil(end.timeIntervalSince(currentWallTime) / 60)))) min"
        case .rest(let end): return "Take a \(max(1, Int(ceil(end.timeIntervalSince(currentWallTime) / 60)))) min break"
        }
    }

    func startTodaySuggestion() {
        let instant = now()
        synchronizeDay(at: instant.wall)
        currentWallTime = instant.wall
        guard phase == .idle, let action = guidance(at: instant.wall).action else { return }
        switch action {
        case .editPlan: page = .plan
        case .focus(let end): startFocus(target: end.timeIntervalSince(instant.wall), at: instant)
        case .rest(let end): startBreak(target: end.timeIntervalSince(instant.wall), at: instant)
        }
    }

    func startTodayBreak() {
        let instant = now()
        synchronizeDay(at: instant.wall)
        currentWallTime = instant.wall
        if case .rest(let end) = guidance(at: instant.wall).breakAction {
            startBreak(target: end.timeIntervalSince(instant.wall), at: instant)
        }
    }

    private func planInputsChanged() {
        guard store != nil, !isLoadingPlan else { return }
        _ = savePlan()
    }

    var canSwitchProfiles: Bool { !isDevelopmentMode }
    var planSavePending: Bool { pendingPlan != nil }
    var isSuspended: Bool { timer.state.isSleeping }
    var rebalancePreview: RewardEngine.RebalancePreview? {
        guard let events = try? store?.allEvents() else { return nil }
        var policy = BalancePolicy.current
        policy.focusCreditsPerMinute = previewFocusCredits
        policy.breakBonus = previewBreakBonus
        return RewardEngine.previewRebalance(events: events, policy: policy)
    }

    var phase: FocusPhase {
        switch timer.state.phase {
        case .idle: .idle
        case .focus: .focus
        case .break: .rest
        }
    }
    var phaseLabel: String {
        switch phase {
        case .idle: "Ready when you are"
        case .focus: breakDue ? "Break is due" : "Focus time"
        case .rest: "Break time"
        }
    }
    var phaseSymbol: String {
        switch phase {
        case .idle: "sparkles"
        case .focus: "hourglass"
        case .rest: "cup.and.saucer.fill"
        }
    }
    var timeString: String {
        guard phase != .idle else { return String(format: "%02d:00", focusLength) }
        let seconds = Int(max(0, displaySeconds).rounded(.up))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    init() {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        dayStart = calendar.date(byAdding: .hour, value: 9, to: today) ?? .now
        dayEnd = calendar.date(byAdding: .hour, value: 17, to: today) ?? .now
        let base = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/CozyFocusPet", isDirectory: true)
        applicationSupportURL = base
        let environment = ProcessInfo.processInfo.environment
        isDevelopmentMode = environment["COZY_FOCUS_DEV"] == "1"
        // Every ordinary launch starts in Personal. Agents are locked to Testing.
        let selectedProfile: DataProfile = isDevelopmentMode ? .testing : .personal
        profile = selectedProfile
        if isDevelopmentMode, let override = environment["COZY_FOCUS_DB_PATH"] {
            let requested = URL(fileURLWithPath: override).standardizedFileURL.resolvingSymlinksInPath()
            let support = base.standardizedFileURL.resolvingSymlinksInPath()
            // A development override may never open any Application Support data.
            databaseURL = requested.path.hasPrefix(support.path + "/") ?
                DataProfile.testing.databaseURL(in: base) : requested
        } else {
            databaseURL = selectedProfile.databaseURL(in: base)
        }
        let statusOverride = environment["COZY_FOCUS_STATUS_FILE"]
        statusURL = statusOverride.map { URL(fileURLWithPath: $0) } ?? base.appendingPathComponent("focus-status.json")
        focusLength = defaults.object(forKey: preferenceKey("focusMinutes")) as? Int ?? 25
        breakLength = defaults.object(forKey: preferenceKey("breakMinutes")) as? Int ?? 5
        notificationsEnabled = defaults.object(forKey: preferenceKey("notificationsEnabled")) as? Bool ?? true
        do {
            try FileManager.default.createDirectory(at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            store = try SQLiteEventStore(url: databaseURL)
            reloadFromStore()
            recoverSession()
            if latestPlanEventID == nil && phase == .idle { page = .plan }
        } catch {
            statusMessage = "Could not open local history: \(error.localizedDescription)"
        }
        publishFocusStatus()
        if notificationsEnabled && !isQuietDevelopment {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    private func now() -> TimerInstant {
        TimerInstant(wall: Date().addingTimeInterval(clockOffset + wallClockOffset), monotonicSeconds: ProcessInfo.processInfo.systemUptime + clockOffset)
    }

    func tick() {
        let instant = now()
        synchronizeDay(at: instant.wall)
        currentWallTime = instant.wall
        if let previous = lastTickInstant, phase != .idle, suspendedReasons.isEmpty, !timer.state.isSleeping {
            let monotonicGap = instant.monotonicSeconds - previous.monotonicSeconds
            let wallGap = instant.wall.timeIntervalSince(previous.wall)
            if monotonicGap > 10 || abs(wallGap - monotonicGap) > 10 {
                let state = timer.state
                if let id = state.sessionID {
                    timer.restorePausedSession(
                        phase: state.phase, sessionID: id,
                        startedAt: state.startedAt ?? previous.wall,
                        targetSeconds: state.targetSeconds,
                        observedElapsedSeconds: state.elapsedSeconds,
                        lastObservedAt: previous.wall, at: instant
                    )
                    _ = append(phase == .focus ? .focusPaused : .breakProgress,
                               payload: currentSessionPayload(), at: previous.wall, source: .system)
                    statusMessage = "An unobserved gap was paused, so it did not earn focus credit."
                }
            }
        }
        lastTickInstant = instant
        observeActivity(at: instant.wall)
        let signals = timer.advance(to: instant)
        displaySeconds = timer.state.remainingSeconds
        breakDue = timer.state.isDue && phase == .focus
        for signal in signals {
            switch signal {
            case .breakDue:
                _ = append(.breakDue, payload: currentSessionPayload(), source: .system)
                notify(title: "Time for a little break", body: "Your focus block is complete. Step away when you can.", category: "break-prompt")
            case .overdueNudge:
                notify(title: "Your break is still waiting", body: "A short pause is enough to begin.", category: "break-prompt")
            case .breakComplete:
                notify(title: "Break complete", body: "Welcome back whenever you're ready.")
            }
        }
        if phase != .idle && !timer.state.isSleeping && instant.wall.timeIntervalSince(lastCheckpoint) >= 30 {
            _ = append(phase == .focus ? .focusResumed : .breakProgress, payload: currentSessionPayload(), source: .system)
            lastCheckpoint = instant.wall
        }
        if instant.wall.timeIntervalSince(lastStatusPublish) >= 20 { publishFocusStatus() }
    }

    private func currentSessionPayload() -> SessionPayload {
        SessionPayload(sessionID: timer.state.sessionID ?? UUID(), targetSeconds: timer.state.targetSeconds, elapsedSeconds: timer.state.elapsedSeconds)
    }

    func startFocus() {
        startFocus(target: TimeInterval(focusLength * 60), at: now())
    }

    private func startFocus(target: TimeInterval, at instant: TimerInstant) {
        guard target > 0 else { return }
        suspendedReasons.removeAll()
        currentWallTime = instant.wall
        let id = timer.startFocus(target: target, at: instant)
        _ = append(.focusStarted, payload: SessionPayload(sessionID: id, targetSeconds: timer.state.targetSeconds), at: instant.wall)
        breakDue = false
        displaySeconds = timer.state.remainingSeconds
        publishFocusStatus()
    }

    func endFocus() {
        guard phase == .focus, let id = timer.state.sessionID else { return }
        let instant = now()
        let target = timer.state.targetSeconds
        let elapsed = timer.endFocus(at: instant)
        _ = append(.focusEnded, payload: SessionPayload(sessionID: id, targetSeconds: target, elapsedSeconds: elapsed), at: instant.wall)
        grant(RewardEngine.focusGrant(sessionID: id, observedSeconds: elapsed, targetSeconds: target), id: id, reason: "focus", at: instant.wall)
        refreshSummary()
        publishFocusStatus()
    }

    func startBreak() {
        startBreak(target: TimeInterval(breakLength * 60), at: now())
    }

    private func startBreak(target: TimeInterval, at instant: TimerInstant) {
        guard target > 0 else { return }
        if phase == .focus { endFocus() }
        suspendedReasons.removeAll()
        currentWallTime = instant.wall
        let id = timer.startBreak(target: target, at: instant)
        _ = append(.breakStarted, payload: SessionPayload(sessionID: id, targetSeconds: timer.state.targetSeconds), at: instant.wall)
        breakDue = false
        displaySeconds = timer.state.remainingSeconds
        publishFocusStatus()
    }

    func finishBreak() {
        guard phase == .rest, let id = timer.state.sessionID else { return }
        let instant = now()
        let target = timer.state.targetSeconds
        let elapsed = timer.endBreak(at: instant)
        _ = append(.breakConfirmed, payload: SessionPayload(sessionID: id, targetSeconds: target, elapsedSeconds: elapsed), at: instant.wall)
        _ = append(.breakEnded, payload: SessionPayload(sessionID: id, targetSeconds: target, elapsedSeconds: elapsed), at: instant.wall)
        grant(RewardEngine.breakGrant(sessionID: id, confirmed: true, observedSeconds: elapsed), id: id, reason: "break", at: instant.wall)
        refreshSummary()
        publishFocusStatus()
    }

    func snooze() {
        guard breakDue else { return }
        let instant = now()
        timer.snooze(minutes: 5, at: instant)
        _ = append(.breakSnoozed, payload: currentSessionPayload(), at: instant.wall)
        statusMessage = "Another reminder will arrive in five minutes."
    }

    func skipBreak() {
        guard phase == .focus else { return }
        let instant = now()
        _ = append(.breakSkipped, payload: currentSessionPayload(), at: instant.wall)
        endFocus()
    }

    func addMeeting() {
        let title = meetingDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if upsertMeeting(id: nil, title: title, start: meetingTime,
                         end: meetingTime.addingTimeInterval(TimeInterval(meetingDuration * 60))) {
            meetingDraft = ""
        }
    }
    @discardableResult
    func upsertMeeting(id: UUID?, title: String, start: Date, end: Date) -> Bool {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, end.timeIntervalSince(start) >= 15 * 60,
              start >= dayStart, end <= dayEnd else {
            statusMessage = "Choose a meeting of at least 15 minutes within your day bounds."
            return false
        }
        let row = MeetingRow(id: id ?? UUID(), title: name, start: start,
                             duration: Int(end.timeIntervalSince(start) / 60))
        let previous = meetings
        if let index = meetings.firstIndex(where: { $0.id == id }) {
            meetings[index] = row
        } else {
            meetings.append(row)
        }
        guard savePlan() else {
            meetings = previous
            return false
        }
        return true
    }
    func removeMeeting(_ id: UUID) {
        let previous = meetings
        meetings.removeAll { $0.id == id }
        if !savePlan() { meetings = previous }
    }
    @discardableResult
    func savePlan() -> Bool {
        guard dayEnd.timeIntervalSince(dayStart) >= 15 * 60 else {
            statusMessage = "Finish must be at least 15 minutes after start."
            return false
        }
        let plan = DayPlan(
            day: now().wall,
            start: dayStart,
            end: dayEnd,
            meetings: meetings.map { PlannedMeeting(id: $0.id, title: $0.title, start: $0.start, end: $0.start.addingTimeInterval(TimeInterval($0.duration * 60))) },
            focusMinutes: focusLength,
            breakMinutes: breakLength,
            revisesEventID: latestPlanEventID
        )
        stagePlan(plan)
        return true
    }

    func changeSuggestion(at index: Int, to kind: PlanBlockKind) {
        guard var plan = currentPlan else { return }
        var blocks = plannedTimeline
        guard blocks.indices.contains(index), blocks[index].kind != .meeting else { return }
        blocks[index].kind = kind
        saveEditedTimeline(blocks, in: &plan)
    }

    func changeSuggestion(at index: Int, edit: DayPlanner.Edit) {
        guard var plan = currentPlan,
              let blocks = DayPlanner.edit(plannedTimeline, at: index, change: edit) else {
            statusMessage = "That timing would move a meeting or cross a day boundary."
            return
        }
        saveEditedTimeline(blocks, in: &plan)
    }

    private func saveEditedTimeline(_ blocks: [PlanBlock], in plan: inout DayPlan) {
        plan.customBlocks = blocks
        stagePlan(plan)
    }

    private func stagePlan(_ plan: DayPlan) {
        currentPlan = plan
        updatePlanPresentation(plan)
        pendingPlanWork?.cancel()
        if let persistedPlan, samePlanContent(plan, persistedPlan) {
            pendingPlan = nil
            statusMessage = "Today’s plan saved."
            return
        }
        pendingPlan = plan
        statusMessage = "Saving today’s plan…"
        let work = DispatchWorkItem { [weak self] in _ = self?.flushPendingPlan() }
        pendingPlanWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: work)
    }

    private func samePlanContent(_ first: DayPlan, _ second: DayPlan) -> Bool {
        first.start == second.start && first.end == second.end &&
        first.meetings == second.meetings &&
        first.focusMinutes == second.focusMinutes && first.breakMinutes == second.breakMinutes &&
        first.customBlocks == second.customBlocks
    }

    @discardableResult
    func flushPendingPlan() -> Bool {
        pendingPlanWork?.cancel()
        pendingPlanWork = nil
        guard var plan = pendingPlan else { return true }
        if let persistedPlan, samePlanContent(plan, persistedPlan) {
            pendingPlan = nil
            return true
        }
        plan.revisesEventID = latestPlanEventID
        let kind: EventKind = latestPlanEventID == nil ? .dayPlan : .dayPlanRevised
        guard let event = append(kind, payload: plan) else {
            statusMessage = "Could not save today’s plan."
            return false
        }
        latestPlanEventID = event.id
        persistedPlan = plan
        currentPlan = plan
        pendingPlan = nil
        statusMessage = "Today’s plan saved."
        return true
    }

    private func updatePlanPresentation(_ plan: DayPlan) {
        let blocks = DayPlanner.suggest(plan)
        plannedTimeline = blocks
        suggestions = blocks.map {
            SuggestedRow(kind: $0.kind.rawValue.capitalized, start: $0.start,
                         minutes: Int($0.end.timeIntervalSince($0.start) / 60), title: $0.title)
        }
    }

    @discardableResult
    func saveReflection() -> Bool {
        let note = reflection.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty else { return false }
        if note == savedReflection {
            reflectionIsEditing = false
            return true
        }
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now().wall) ?? .now
        if append(.reflection, payload: ReflectionPayload(day: yesterday, note: note)) != nil {
            reflection = note
            savedReflection = note
            reflectionIsEditing = false
            statusMessage = "Reflection saved."
            return true
        }
        return false
    }

    func editReflection() {
        reflection = savedReflection ?? ""
        reflectionIsEditing = true
    }

    func cancelReflectionEdit() {
        reflection = savedReflection ?? ""
        reflectionIsEditing = savedReflection == nil
    }

    func savePreferences() {
        defaults.set(focusLength, forKey: preferenceKey("focusMinutes"))
        defaults.set(breakLength, forKey: preferenceKey("breakMinutes"))
        defaults.set(notificationsEnabled, forKey: preferenceKey("notificationsEnabled"))
        statusMessage = "Preferences saved."
    }

    func switchProfile(to next: DataProfile) {
        guard canSwitchProfiles, next != profile else { return }
        guard flushPendingPlan() else { return }
        let nextURL = next.databaseURL(in: applicationSupportURL)
        do {
            let nextStore = try SQLiteEventStore(url: nextURL)
            publishIdleStatus()
            store = nextStore
            profile = next
            databaseURL = nextURL
            resetForProfile()
            reloadFromStore()
            recoverSession()
            if latestPlanEventID == nil && phase == .idle { page = .plan }
            publishFocusStatus()
        } catch {
            statusMessage = "Could not open \(next.title) profile: \(error.localizedDescription)"
        }
    }

    private func preferenceKey(_ name: String) -> String {
        profile == .personal ? name : "profile.testing.\(name)"
    }

    private func resetForProfile() {
        isLoadingPlan = true
        defer { isLoadingPlan = false }
        currentWallTime = Date()
        timer = TimerEngine()
        clockOffset = 0
        wallClockOffset = 0
        awayStartedAt = nil
        suspendedReasons.removeAll()
        lastCheckpoint = .distantPast
        lastStatusPublish = .distantPast
        lastInputReminder = .distantPast
        lastTickInstant = nil
        latestPlanEventID = nil
        currentPlan = nil
        persistedPlan = nil
        pendingPlan = nil
        pendingPlanWork?.cancel()
        pendingPlanWork = nil
        page = .today
        meetingDraft = ""
        reflection = ""
        savedReflection = nil
        reflectionIsEditing = true
        meetingTime = .now
        meetingDuration = 30
        meetings = []
        suggestions = []
        history = []
        plannedTimeline = []
        actualTimeline = []
        yesterdayTimeline = []
        yesterdayFocusMinutes = 0
        yesterdayBreakMinutes = 0
        coins = 0
        focusMinutesToday = 0
        breakMinutesToday = 0
        unlockedItems = []
        breakDue = false
        displaySeconds = 0
        let today = Calendar.current.startOfDay(for: .now)
        dayStart = Calendar.current.date(byAdding: .hour, value: 9, to: today) ?? .now
        dayEnd = Calendar.current.date(byAdding: .hour, value: 17, to: today) ?? .now
        focusLength = defaults.object(forKey: preferenceKey("focusMinutes")) as? Int ?? 25
        breakLength = defaults.object(forKey: preferenceKey("breakMinutes")) as? Int ?? 5
        notificationsEnabled = defaults.object(forKey: preferenceKey("notificationsEnabled")) as? Bool ?? true
        statusMessage = nil
    }

    func purchase(_ item: ShopItem) {
        do {
            if try store?.purchase(itemID: item.id, cost: item.cost, occurredAt: now().wall) == true {
                refreshSummary()
                statusMessage = "\(item.name) unlocked."
            }
        } catch { statusMessage = error.localizedDescription }
    }

    func exportJSON() {
        let destination = exportURL(extension: "json")
        do { try store?.exportJSON(to: destination); statusMessage = "Exported to \(destination.path)" }
        catch { statusMessage = error.localizedDescription }
    }
    func backupDatabase() {
        let destination = exportURL(extension: "sqlite")
        do { try store?.backup(to: destination); statusMessage = "Backed up to \(destination.path)" }
        catch { statusMessage = error.localizedDescription }
    }

    private func exportURL(extension fileExtension: String) -> URL {
        let directory = isDevelopmentMode ? databaseURL.deletingLastPathComponent() :
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Desktop")
        let name = isDevelopmentMode ? "cozy-focus-development" :
            (profile == .personal ? "cozy-focus" : "cozy-focus-testing")
        let suffix = fileExtension == "json" ? "export" : "backup"
        return directory.appendingPathComponent("\(name)-\(suffix).\(fileExtension)")
    }

    func advance(minutes: Int) {
        clockOffset += TimeInterval(minutes * 60)
        lastTickInstant = now()
        tick()
    }
    func simulateWallClockChange(minutes: Int) {
        wallClockOffset += TimeInterval(minutes * 60)
        tick()
    }
    func simulateAway() {
        guard awayStartedAt == nil else { return }
        awayStartedAt = now().wall
        _ = append(.awayStarted, payload: AwayPayload(reason: "development"), source: .inferred)
        beginSuspension(.idle)
    }
    func simulateReturn() {
        guard awayStartedAt != nil else { return }
        awayStartedAt = nil
        _ = append(.awayEnded, payload: AwayPayload(reason: "development"), source: .inferred)
        endSuspension(.idle)
        refreshSummary()
    }
    func simulateSleepWake() {
        systemWillSleep()
        clockOffset += 20 * 60
        systemDidWake()
    }

    func systemWillSleep() {
        guard phase != .idle else { return }
        let instant = now()
        beginSuspension(.sleep)
        _ = append(.sleepStarted, payload: currentSessionPayload(), at: instant.wall, source: .system)
    }

    func systemDidWake() {
        guard phase != .idle else { return }
        let instant = now()
        endSuspension(.sleep)
        lastTickInstant = instant
        _ = append(.sleepEnded, payload: currentSessionPayload(), at: instant.wall, source: .system)
        publishFocusStatus()
    }

    func systemSessionDidResignActive() {
        guard phase != .idle else { return }
        if awayStartedAt == nil {
            awayStartedAt = now().wall
            _ = append(.awayStarted, payload: AwayPayload(reason: "session locked"), source: .inferred)
        }
        beginSuspension(.locked)
    }

    func systemSessionDidBecomeActive() {
        endSuspension(.locked)
        if awayStartedAt != nil && !suspendedReasons.contains(.idle) {
            awayStartedAt = nil
            _ = append(.awayEnded, payload: AwayPayload(reason: "session unlocked"), source: .inferred)
        }
    }

    private func beginSuspension(_ reason: SuspensionReason, idleSeconds: TimeInterval = 0) {
        guard phase != .idle, !suspendedReasons.contains(reason) else { return }
        let wasRunning = suspendedReasons.isEmpty
        suspendedReasons.insert(reason)
        if wasRunning {
            let instant = now()
            timer.pauseForSleep(at: instant)
            timer.discountIdleFocus(seconds: idleSeconds)
            _ = append(phase == .focus ? .focusPaused : .breakProgress,
                       payload: currentSessionPayload(), at: instant.wall, source: .system)
            displaySeconds = timer.state.remainingSeconds
            breakDue = timer.state.isDue && phase == .focus
        }
    }

    private func endSuspension(_ reason: SuspensionReason) {
        guard suspendedReasons.remove(reason) != nil, suspendedReasons.isEmpty, phase != .idle else { return }
        let instant = now()
        let signals = timer.resumeFromSleep(at: instant)
        lastTickInstant = instant
        _ = append(phase == .focus ? .focusResumed : .breakProgress,
                   payload: currentSessionPayload(), at: instant.wall, source: .system)
        displaySeconds = timer.state.remainingSeconds
        breakDue = timer.state.isDue && phase == .focus
        if signals.contains(.breakComplete) {
            notify(title: "Break complete", body: "Welcome back whenever you're ready.")
        }
    }
    func loadScenario(_ scenario: DevScenario) {
        switch scenario {
        case .morning:
            page = .plan
            meetingDraft = "Team check-in"
            meetingTime = Calendar.current.date(bySettingHour: 10, minute: 30, second: 0, of: now().wall) ?? .now
            addMeeting()
        case .breakDue:
            if phase == .rest { finishBreak() }
            if phase == .focus { endFocus() }
            startFocus()
            advance(minutes: focusLength)
            page = .today
        case .completedDay:
            if phase == .focus { endFocus() }
            if phase == .rest { finishBreak() }
            startFocus()
            advance(minutes: focusLength)
            startBreak()
            advance(minutes: breakLength)
            finishBreak()
            page = .history
        }
    }

    func publishIdleStatus() {
        writeStatus(phase: "idle")
    }
    private func publishFocusStatus() {
        writeStatus(phase: phase == .focus ? "focus" : phase == .rest ? "break" : "idle")
        lastStatusPublish = now().wall
    }
    private func writeStatus(phase: String) {
        let current = Date()
        let iso = ISO8601DateFormatter()
        let payload = ["phase": phase, "updatedAt": iso.string(from: current), "expiresAt": iso.string(from: current.addingTimeInterval(90))]
        do {
            try FileManager.default.createDirectory(at: statusURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            try data.write(to: statusURL, options: .atomic)
        } catch { statusMessage = "Could not update browser status: \(error.localizedDescription)" }
    }

    private func append<P: Encodable>(_ kind: EventKind, payload: P, at date: Date? = nil, source: EventSource = .user, uniqueKey: String? = nil) -> Event? {
        do {
            let event = try store?.append(kind: kind, payload: payload, occurredAt: date ?? now().wall, source: source, uniqueKey: uniqueKey)
            refreshSummary()
            return event
        } catch {
            statusMessage = "Could not save \(kind.rawValue): \(error.localizedDescription)"
            return nil
        }
    }

    private func grant(_ reward: RewardPayload, id: UUID, reason: String, at date: Date) {
        guard reward.amount > 0 else { return }
        _ = append(.rewardGranted, payload: reward, at: date, source: .system, uniqueKey: RewardEngine.uniqueGrantKey(reason: reason, sourceID: id, policyVersion: reward.policyVersion))
    }

    private func synchronizeDay(at date: Date) {
        guard !Calendar.current.isDate(currentWallTime, inSameDayAs: date) else { return }
        _ = flushPendingPlan()
        isLoadingPlan = true
        currentWallTime = date
        currentPlan = nil
        persistedPlan = nil
        latestPlanEventID = nil
        meetings = []
        suggestions = []
        plannedTimeline = []
        let day = Calendar.current.startOfDay(for: date)
        dayStart = Calendar.current.date(byAdding: .hour, value: 9, to: day) ?? day
        dayEnd = Calendar.current.date(byAdding: .hour, value: 17, to: day) ?? day
        isLoadingPlan = false
        reloadFromStore()
    }

    private func reloadFromStore() {
        isLoadingPlan = true
        defer { isLoadingPlan = false }
        guard let events = try? store?.allEvents() else { return }
        let today = now().wall
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: today) ?? today
        savedReflection = events.reversed().compactMap { event -> String? in
            guard event.kind == .reflection,
                  let payload = try? event.payload(as: ReflectionPayload.self),
                  Calendar.current.isDate(payload.day, inSameDayAs: yesterday) else { return nil }
            return payload.note
        }.first
        reflection = savedReflection ?? ""
        reflectionIsEditing = savedReflection == nil
        if let planEvent = events.last(where: { [.dayPlan, .dayPlanRevised].contains($0.kind) && (try? $0.payload(as: DayPlan.self)).map { Calendar.current.isDate($0.day, inSameDayAs: today) } == true }),
           let plan = try? planEvent.payload(as: DayPlan.self) {
            latestPlanEventID = planEvent.id
            currentPlan = plan
            persistedPlan = plan
            dayStart = plan.start
            dayEnd = plan.end
            focusLength = plan.focusMinutes
            breakLength = plan.breakMinutes
            meetings = plan.meetings.map { MeetingRow(id: $0.id, title: $0.title, start: $0.start, duration: Int($0.end.timeIntervalSince($0.start) / 60)) }
            updatePlanPresentation(plan)
        }
        refreshSummary()
    }

    private func refreshSummary() {
        guard let events = try? store?.allEvents() else { return }
        coins = RewardEngine.balance(events: events)
        unlockedItems = RewardEngine.unlockedItems(events: events)
        let projection = DayProjection.project(events: events, on: now().wall, includeSuggestions: false)
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now().wall) ?? now().wall
        let prior = DayProjection.project(events: events, on: yesterday, includeSuggestions: false)
        yesterdayTimeline = prior.actual.sorted { $0.start < $1.start }
        yesterdayFocusMinutes = Int(prior.focusSeconds / 60)
        yesterdayBreakMinutes = Int(prior.breakSeconds / 60)
        actualTimeline = projection.actual.sorted { $0.start < $1.start }
        focusMinutesToday = Int(projection.focusSeconds / 60)
        breakMinutesToday = Int(projection.breakSeconds / 60)
        history = events.filter { Calendar.current.isDate($0.occurredAt, inSameDayAs: now().wall) }
            .filter { [.focusStarted, .focusEnded, .breakStarted, .breakEnded, .breakDue, .breakSkipped, .reflection, .itemPurchased, .itemUnlocked].contains($0.kind) }
            .reversed()
            .map { event in
                let info: (String, String)
                switch event.kind {
                case .focusStarted: info = ("Focus started", "play.circle.fill")
                case .focusEnded: info = ("Focus finished", "checkmark.circle.fill")
                case .breakStarted: info = ("Break started", "cup.and.saucer.fill")
                case .breakEnded: info = ("Break finished", "leaf.fill")
                case .breakDue: info = ("Break was due", "bell.fill")
                case .breakSkipped: info = ("Break skipped", "forward.fill")
                case .reflection: info = ("Reflection saved", "bubble.left.fill")
                default: info = ("Room item unlocked", "gift.fill")
                }
                return HistoryRow(id: event.id, title: info.0, symbol: info.1, date: event.occurredAt)
            }
    }

    private func recoverSession() {
        guard let events = try? store?.allEvents() else { return }
        let starts = events.filter { $0.kind == .focusStarted || $0.kind == .breakStarted }
        guard let start = starts.last,
              let startPayload = try? start.payload(as: SessionPayload.self) else { return }
        let ended = events.contains { event in
            guard event.sequence > start.sequence, event.kind == .focusEnded || event.kind == .breakEnded,
                  let payload = try? event.payload(as: SessionPayload.self) else { return false }
            return payload.sessionID == startPayload.sessionID
        }
        guard !ended else { return }
        let latestCheckpoint = events.last { event in
            guard event.sequence > start.sequence,
                  event.kind == .focusResumed || event.kind == .breakProgress,
                  let payload = try? event.payload(as: SessionPayload.self) else { return false }
            return payload.sessionID == startPayload.sessionID
        }
        let checkpointPayload = latestCheckpoint.flatMap { try? $0.payload(as: SessionPayload.self) }
        timer.restorePausedSession(
            phase: start.kind == .focusStarted ? .focus : .break,
            sessionID: startPayload.sessionID,
            startedAt: start.occurredAt,
            targetSeconds: startPayload.targetSeconds,
            observedElapsedSeconds: checkpointPayload?.elapsedSeconds ?? 0,
            lastObservedAt: latestCheckpoint?.occurredAt ?? start.occurredAt,
            at: now()
        )
        displaySeconds = timer.state.remainingSeconds
        breakDue = timer.state.isDue && phase == .focus
        statusMessage = "A session was restored. Unobserved time was not counted."
    }

    private func notify(title: String, body: String, category: String? = nil) {
        guard notificationsEnabled && !isQuietDevelopment else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let category { content.categoryIdentifier = category }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    private var isQuietDevelopment: Bool {
        let environment = ProcessInfo.processInfo.environment
        return environment["COZY_FOCUS_DEV"] == "1" && environment["COZY_FOCUS_DEV_NOTIFICATIONS"] != "1"
    }

    private func observeActivity(at date: Date) {
        guard !isDevelopmentMode else { return }
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null)
        guard idle.isFinite else { return }
        if idle >= 120 {
            if awayStartedAt == nil {
                awayStartedAt = date.addingTimeInterval(-idle)
                _ = append(.awayStarted, payload: AwayPayload(reason: "idle"), at: awayStartedAt, source: .inferred)
            }
            beginSuspension(.idle, idleSeconds: idle)
        } else if idle < 3, suspendedReasons.contains(.idle) {
            endSuspension(.idle)
            if awayStartedAt != nil && !suspendedReasons.contains(.locked) {
                awayStartedAt = nil
                _ = append(.awayEnded, payload: AwayPayload(reason: "input resumed"), at: date, source: .inferred)
            }
            if phase == .rest && date.timeIntervalSince(lastInputReminder) > 60 {
                notify(title: "Your break is still going", body: "You can return when you’re ready.")
                lastInputReminder = date
            }
        }
    }
}
