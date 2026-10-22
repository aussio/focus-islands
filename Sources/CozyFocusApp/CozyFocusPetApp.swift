import AppKit
import Darwin
import ScreenCaptureKit
import SwiftUI
import UserNotifications
import CozyFocusCore

@main
struct CozyFocusPetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem?
    private var window: NSWindow?
    private var model: AppModel?
    private var ticker: Timer?
    private var reloadSignal: DispatchSourceSignal?
    #if DEBUG
    private var controlDirectory: URL?
    #endif

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if let iconURL = Bundle.main.url(forResource: "red-panda", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
        }
        let model = AppModel()
        self.model = model
        let notificationCenter = UNUserNotificationCenter.current()
        notificationCenter.delegate = self
        notificationCenter.setNotificationCategories([
            UNNotificationCategory(identifier: "break-prompt", actions: [
                UNNotificationAction(identifier: "start-break", title: "Start break"),
                UNNotificationAction(identifier: "snooze", title: "Snooze 5 min"),
                UNNotificationAction(identifier: "skip", title: "Skip")
            ], intentIdentifiers: [])
        ])

        let window = TrayWindow(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 650),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Cozy Focus Pet"
        window.center()
        window.minSize = NSSize(width: 790, height: 590)
        window.contentView = NSHostingView(rootView: ContentView(model: model))
        window.delegate = self
        window.isReleasedWhenClosed = false
        self.window = window

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = "CozyFocusPet.status"
        item.isVisible = true
        if let button = item.button {
            button.image = NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "Cozy Focus Pet")
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(statusButtonPressed)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.toolTip = "Open Cozy Focus Pet"
        }
        statusItem = item
        updateStatusTitle()
        let workspaceNotifications = NSWorkspace.shared.notificationCenter
        workspaceNotifications.addObserver(self, selector: #selector(systemWillSleep),
                                           name: NSWorkspace.willSleepNotification, object: nil)
        workspaceNotifications.addObserver(self, selector: #selector(systemDidWake),
                                           name: NSWorkspace.didWakeNotification, object: nil)
        workspaceNotifications.addObserver(self, selector: #selector(sessionDidResignActive),
                                           name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        workspaceNotifications.addObserver(self, selector: #selector(sessionDidBecomeActive),
                                           name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        #if DEBUG
        if ProcessInfo.processInfo.environment["COZY_FOCUS_DEV"] == "1",
           let path = ProcessInfo.processInfo.environment["COZY_FOCUS_CONTROL_DIR"] {
            controlDirectory = URL(fileURLWithPath: path, isDirectory: true)
        }
        #endif
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.model?.tick()
            self?.updateStatusTitle()
            #if DEBUG
            Task { @MainActor [weak self] in await self?.processDevCommands() }
            #endif
        }
        // The optional Personal watch launcher asks this process to quit through
        // AppKit so pending plan edits are flushed before the new build opens.
        signal(SIGUSR1, SIG_IGN)
        let reloadSignal = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        reloadSignal.setEventHandler { NSApp.terminate(nil) }
        reloadSignal.resume()
        self.reloadSignal = reloadSignal

        if ProcessInfo.processInfo.arguments.contains("--background-window") {
            window.orderBack(nil)
        } else if ProcessInfo.processInfo.arguments.contains("--show-window") {
            showWindow()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        ticker?.invalidate()
        reloadSignal?.cancel()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        model?.flushPendingPlan()
        model?.publishIdleStatus()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    @objc private func systemWillSleep() { model?.systemWillSleep() }
    @objc private func systemDidWake() { model?.systemDidWake() }
    @objc private func sessionDidResignActive() { model?.systemSessionDidResignActive() }
    @objc private func sessionDidBecomeActive() { model?.systemSessionDidBecomeActive() }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            switch response.actionIdentifier {
            case "start-break": model?.startBreak()
            case "snooze": model?.snooze()
            case "skip": model?.skipBreak()
            default: break
            }
            updateStatusTitle()
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    @objc private func statusButtonPressed() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showStatusMenu()
        } else {
            toggleWindow()
        }
    }

    private func showStatusMenu() {
        guard let button = statusItem?.button, let model else { return }
        let menu = NSMenu()
        let profile = NSMenuItem(title: "\(model.profile.title) profile", action: nil, keyEquivalent: "")
        profile.isEnabled = false
        menu.addItem(profile)
        menu.addItem(.separator())
        let show = NSMenuItem(title: "Open Window", action: #selector(openWindow), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        let quit = NSMenuItem(title: "Quit Cozy Focus Pet", action: #selector(quitApp), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height), in: button)
    }

    @objc private func openWindow() { showWindow() }

    @objc private func quitApp() { NSApp.terminate(nil) }

    @objc private func toggleWindow() {
        guard let window else { return }
        if window.isVisible && NSApp.isActive {
            window.orderOut(nil)
        } else {
            showWindow()
        }
    }

    private func showWindow() {
        guard let window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func updateStatusTitle() {
        guard let button = statusItem?.button, let model else { return }
        let timer = model.phase == .idle ? "" : "  \(model.timeString)"
        button.title = timer
        button.toolTip = "Cozy Focus Pet · \(model.profile.title) · \(model.phaseLabel) · Right-click to quit"
    }

    #if DEBUG
    /// Only the isolated development launch enables this app-owned control inbox.
    /// It accepts named app actions and captures this window, without Accessibility
    /// or Screen Recording access to the rest of the computer.
    private func processDevCommands() async {
        guard let controlDirectory,
              let requests = try? FileManager.default.contentsOfDirectory(
                at: controlDirectory, includingPropertiesForKeys: nil
              ) else { return }
        for request in requests where request.pathExtension == "json" &&
            UUID(uuidString: request.deletingPathExtension().lastPathComponent) != nil {
            let id = request.deletingPathExtension().lastPathComponent
            let responseURL = controlDirectory.appendingPathComponent("\(id).response")
            let response: [String: Any]
            do {
                let data = try Data(contentsOf: request)
                try FileManager.default.removeItem(at: request)
                guard let command = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      command["id"] as? String == id,
                      let action = command["action"] as? String else {
                    throw DevControlError.invalidCommand
                }
                response = try await handleDevCommand(action, value: command["value"])
            } catch {
                response = ["ok": false, "error": error.localizedDescription]
            }
            if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
                try? data.write(to: responseURL, options: .atomic)
            }
        }
    }

    private func handleDevCommand(_ action: String, value: Any?) async throws -> [String: Any] {
        guard let model else { throw DevControlError.unavailable }
        switch action {
        case "status": break
        case "quit":
            // Return a response before terminating so the control client knows it worked.
            Task { @MainActor in NSApp.terminate(nil) }
        case "show-window": showWindow()
        case "background-window": window?.orderBack(nil)
        case "close-window": window?.performClose(nil)
        case "minimize-window": window?.performMiniaturize(nil)
        case "menu-click": statusItem?.button?.performClick(nil)
        case "navigate":
            guard let name = value as? String, let page = AppPage(rawValue: name) else {
                throw DevControlError.invalidValue
            }
            if model.page == .plan && page != .plan { model.flushPendingPlan() }
            model.page = page
        case "open-meeting-editor":
            model.page = .plan
            model.showingMeetingEditor = true
        case "close-meeting-editor":
            model.showingMeetingEditor = false
            model.flushPendingPlan()
        case "flush-plan":
            guard model.flushPendingPlan() else { throw DevControlError.unavailable }
        case "meeting-window", "revise-meeting":
            guard let text = value as? String else { throw DevControlError.invalidValue }
            let parts = text.split(separator: ":", maxSplits: 2)
            guard parts.count == 3, let offset = Int(parts[1]), let duration = Int(parts[2]),
                  (0...1400).contains(offset), (15...480).contains(duration) else {
                throw DevControlError.invalidValue
            }
            let start = model.dayStart.addingTimeInterval(TimeInterval(offset * 60))
            let existingID = action == "revise-meeting" ? model.meetings.first(where: { $0.title == String(parts[0]) })?.id : nil
            guard action != "revise-meeting" || existingID != nil else { throw DevControlError.invalidValue }
            guard model.upsertMeeting(id: existingID, title: String(parts[0]), start: start,
                                      end: start.addingTimeInterval(TimeInterval(duration * 60))) else {
                throw DevControlError.invalidValue
            }
        case "today-suggestion": model.startTodaySuggestion()
        case "today-break": model.startTodayBreak()
        case "day-time":
            guard let text = value as? String, let minutes = Int(text),
                  (0...1439).contains(minutes), model.phase == .idle else { throw DevControlError.invalidValue }
            model.setDevelopmentDayMinute(minutes)
        case "rhythm":
            guard let text = value as? String else { throw DevControlError.invalidValue }
            let parts = text.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, let focus = Int(parts[0]), let rest = Int(parts[1]),
                  (5...120).contains(focus), focus.isMultiple(of: 5),
                  (5...60).contains(rest), rest.isMultiple(of: 5) else {
                throw DevControlError.invalidValue
            }
            model.focusLength = focus
            model.breakLength = rest
            guard model.savePlan() else { throw DevControlError.invalidValue }
        case "start-focus": model.startFocus()
        case "end-focus": model.endFocus()
        case "start-break": model.startBreak()
        case "finish-break": model.finishBreak()
        case "snooze": model.snooze()
        case "skip-break": model.skipBreak()
        case "advance":
            guard let text = value as? String, let minutes = Int(text),
                  (1...1440).contains(minutes) else { throw DevControlError.invalidValue }
            model.advance(minutes: minutes)
        case "wall-jump":
            guard let text = value as? String, let minutes = Int(text),
                  (-60...60).contains(minutes), minutes != 0 else { throw DevControlError.invalidValue }
            model.simulateWallClockChange(minutes: minutes)
        case "away": model.simulateAway()
        case "return": model.simulateReturn()
        case "sleep-wake": model.simulateSleepWake()
        case "lock": model.systemSessionDidResignActive()
        case "unlock": model.systemSessionDidBecomeActive()
        case "scenario":
            guard let name = value as? String else { throw DevControlError.invalidValue }
            switch name {
            case "morning": model.loadScenario(.morning)
            case "break-due": model.loadScenario(.breakDue)
            case "completed-day": model.loadScenario(.completedDay)
            default: throw DevControlError.invalidValue
            }
        case "edit-block":
            guard let text = value as? String else { throw DevControlError.invalidValue }
            let parts = text.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, let index = Int(parts[0]),
                  let kind = PlanBlockKind(rawValue: String(parts[1])),
                  kind != .meeting else { throw DevControlError.invalidValue }
            model.changeSuggestion(at: index, to: kind)
        case "edit-block-start", "edit-block-duration":
            guard let text = value as? String else { throw DevControlError.invalidValue }
            let parts = text.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, let index = Int(parts[0]),
                  model.suggestions.indices.contains(index),
                  let minutes = Int(parts[1]), (-240...240).contains(minutes) else {
                throw DevControlError.invalidValue
            }
            if action == "edit-block-start" {
                let start = model.suggestions[index].start.addingTimeInterval(TimeInterval(minutes * 60))
                model.changeSuggestion(at: index, edit: .start(start))
            } else {
                model.changeSuggestion(at: index, edit: .durationMinutes(minutes))
            }
        case "save-reflection":
            guard let note = value as? String, !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  note.count <= 500 else { throw DevControlError.invalidValue }
            model.reflection = note
            guard model.saveReflection() else { throw DevControlError.unavailable }
        case "edit-reflection": model.editReflection()
        case "purchase":
            guard let itemID = value as? String,
                  let item = model.shopItems.first(where: { $0.id == itemID }) else {
                throw DevControlError.invalidValue
            }
            model.purchase(item)
        case "screenshot":
            guard let window else { throw DevControlError.unavailable }
            if !window.isVisible { window.orderBack(nil) }
            let captureWindow = window.attachedSheet ?? window
            let shareable = try await SCShareableContent.currentProcess
            guard let ownWindow = shareable.windows.first(where: {
                $0.windowID == CGWindowID(captureWindow.windowNumber)
            }) else { throw DevControlError.unavailable }
            let filter = SCContentFilter(desktopIndependentWindow: ownWindow)
            let configuration = SCStreamConfiguration()
            configuration.width = Int(captureWindow.frame.width * captureWindow.backingScaleFactor)
            configuration.height = Int(captureWindow.frame.height * captureWindow.backingScaleFactor)
            configuration.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(
                contentFilter: filter, configuration: configuration
            )
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
                  let controlDirectory else { throw DevControlError.unavailable }
            let shots = controlDirectory.appendingPathComponent("screenshots", isDirectory: true)
            try FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
            let filename = "window-\(UUID().uuidString).png"
            let destination = shots.appendingPathComponent(filename)
            try data.write(to: destination, options: .atomic)
            return ["ok": true, "screenshot": destination.path, "status": devStatus(model)]
        default: throw DevControlError.invalidCommand
        }
        updateStatusTitle()
        return ["ok": true, "status": devStatus(model)]
    }

    private func devStatus(_ model: AppModel) -> [String: Any] {
        [
            "page": model.page.rawValue,
            "profile": model.profile.rawValue,
            "phase": model.phase == .idle ? "idle" : model.phase == .focus ? "focus" : "break",
            "countdown": model.timeString,
            "currentWallTime": model.currentWallTime.timeIntervalSince1970,
            "todaySituation": model.todayGuidance.situation.rawValue,
            "todayTitle": model.todayGuidance.title,
            "todayProposedSeconds": model.todayProposedSeconds,
            "timerTargetSeconds": model.timerTargetSeconds,
            "plannedWindows": model.plannedTimeline.map {
                ["kind": $0.kind.rawValue, "start": $0.start.timeIntervalSince1970, "end": $0.end.timeIntervalSince1970] as [String: Any]
            },
            "breakDue": model.breakDue,
            "suspended": model.isSuspended,
            "coins": model.coins,
            "focusMinutesToday": model.focusMinutesToday,
            "breakMinutesToday": model.breakMinutesToday,
            "focusLength": model.focusLength,
            "breakLength": model.breakLength,
            "meetings": model.meetings.map(\.title),
            "meetingWindows": model.meetings.map { ["title": $0.title, "start": $0.start.timeIntervalSince1970, "duration": Double($0.duration)] },
            "meetingEditorOpen": model.showingMeetingEditor,
            "planSavePending": model.planSavePending,
            "suggestions": model.suggestions.map(\.kind),
            "suggestionMinutes": model.suggestions.map(\.minutes),
            "reflection": model.reflection,
            "savedReflection": model.savedReflection ?? "",
            "reflectionIsEditing": model.reflectionIsEditing,
            "unlockedItems": model.unlockedItems.sorted(),
            "windowVisible": window?.isVisible == true,
            "windowFrame": window.map {
                ["x": $0.frame.origin.x, "y": $0.frame.origin.y,
                 "width": $0.frame.width, "height": $0.frame.height]
            } ?? [:],
            "statusItemReady": statusItem?.button?.image != nil,
            "statusItemVisible": statusItem?.isVisible == true,
            "statusItemWindowAttached": statusItem?.button?.window != nil,
            "statusItemWindowVisible": statusItem?.button?.window?.isVisible == true,
            "statusItemFrame": statusItem?.button?.window.map {
                ["x": $0.frame.origin.x, "y": $0.frame.origin.y,
                 "width": $0.frame.width, "height": $0.frame.height]
            } ?? [:],
            "dockIconActive": NSApp.activationPolicy() == .regular,
            "appActive": NSApp.isActive,
            "message": model.statusMessage ?? ""
        ]
    }

    private enum DevControlError: LocalizedError {
        case invalidCommand, invalidValue, unavailable
        var errorDescription: String? {
            switch self {
            case .invalidCommand: "Unknown or malformed development command"
            case .invalidValue: "Invalid development command value"
            case .unavailable: "App window or model is unavailable"
            }
        }
    }
    #endif
}

/// Both traffic-light controls hide the window; the menu bar item keeps the
/// app available until the user explicitly chooses Quit.
private final class TrayWindow: NSWindow {
    override func performMiniaturize(_ sender: Any?) { orderOut(sender) }
    override func miniaturize(_ sender: Any?) { orderOut(sender) }
}
