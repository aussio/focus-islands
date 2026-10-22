import AppKit
import SwiftUI
import CozyFocusCore

private struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CozyPalette.card, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(CozyPalette.ink.opacity(0.06)))
    }
}

/// The same hour ruler and day canvas back both the meeting editor and its read-only plan preview.
private struct DayCalendarGrid<Background: View, Blocks: View>: View {
    let dayStart: Date
    let dayMinutes: Int
    let pointsPerMinute: CGFloat
    let width: CGFloat
    @ViewBuilder let background: () -> Background
    @ViewBuilder let blocks: () -> Blocks

    var body: some View {
        ZStack(alignment: .topLeading) {
            background()
            ForEach(0...Int(ceil(Double(dayMinutes) / 60.0)), id: \.self) { hour in
                let minute = hour * 60
                if minute <= dayMinutes {
                    HStack(alignment: .top, spacing: 8) {
                        Text(dayStart.addingTimeInterval(TimeInterval(minute * 60))
                            .formatted(.dateTime.hour().minute()))
                            .font(.system(size: 10).monospacedDigit())
                            .foregroundStyle(CozyPalette.muted)
                            .frame(width: 49, alignment: .trailing)
                        Rectangle().fill(CozyPalette.ink.opacity(0.12)).frame(height: 1)
                    }
                    .offset(y: CGFloat(minute) * pointsPerMinute)
                    .allowsHitTesting(false)
                }
            }
            blocks()
        }
        .frame(width: width, height: CGFloat(dayMinutes) * pointsPerMinute, alignment: .topLeading)
    }
}

private struct SuggestedDayCalendar: View {
    let dayStart: Date
    let dayEnd: Date
    let suggestions: [SuggestedRow]

    private let pointsPerMinute: CGFloat = 1.2
    private var dayMinutes: Int { max(15, Int(dayEnd.timeIntervalSince(dayStart) / 60)) }
    private var gridHeight: CGFloat { CGFloat(dayMinutes) * pointsPerMinute }

    var body: some View {
        ScrollView {
            GeometryReader { geometry in
                DayCalendarGrid(dayStart: dayStart, dayMinutes: dayMinutes,
                                pointsPerMinute: pointsPerMinute, width: geometry.size.width) {
                    CozyPalette.card
                } blocks: {
                    ForEach(suggestions.indices, id: \.self) { index in
                        let block = suggestions[index]
                        let startMinute = Int(block.start.timeIntervalSince(dayStart) / 60)
                        let visibleStart = max(0, startMinute)
                        let visibleEnd = min(dayMinutes, startMinute + block.minutes)
                        if visibleEnd > visibleStart {
                            blockView(block, duration: visibleEnd - visibleStart)
                                .frame(width: max(0, geometry.size.width - 70),
                                       height: CGFloat(visibleEnd - visibleStart) * pointsPerMinute)
                                .offset(x: 62, y: CGFloat(visibleStart) * pointsPerMinute)
                        }
                    }
                }
            }
            .frame(height: gridHeight + 4)
        }
        .frame(height: min(430, gridHeight + 4))
        .background(CozyPalette.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(CozyPalette.ink.opacity(0.08)))
        .accessibilityIdentifier("suggested-day-calendar")
    }

    private func blockView(_ block: SuggestedRow, duration: Int) -> some View {
        let fill: AnyShapeStyle = switch block.kind {
        case "Focus": AnyShapeStyle(CozyPalette.focusBlock)
        case "Break": AnyShapeStyle(CozyPalette.breakRainbow)
        case "Meeting": AnyShapeStyle(CozyPalette.meetingBlock)
        default: AnyShapeStyle(CozyPalette.sidebar.opacity(0.45))
        }
        return HStack(alignment: .top, spacing: 8) {
            if duration >= 15 {
                Text(block.title ?? block.kind)
                    .fontWeight(block.kind == "Meeting" ? .semibold : .medium)
                Spacer(minLength: 0)
                Text("\(duration)m")
            }
        }
        .font(.system(size: duration <= 15 ? 10 : 11))
        .foregroundStyle(block.kind == "Meeting" ? CozyPalette.card : CozyPalette.ink)
        .padding(.horizontal, 9)
        .padding(.vertical, duration <= 15 ? 1 : 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(fill, in: RoundedRectangle(cornerRadius: 7))
        .clipped()
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(block.title ?? block.kind), \(block.start.formatted(.dateTime.hour().minute())), \(duration) minutes")
    }
}

private struct MeetingDayEditor: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: UUID?
    @State private var title = ""
    @State private var preview: MeetingPlacement?
    @State private var activeDrag: MeetingDrag?
    @State private var titleSaveWork: DispatchWorkItem?

    private let pointsPerMinute: CGFloat = 1.2
    private let slotMinutes = 15
    private let minimumSlots = 1
    private var dayMinutes: Int { max(15, Int(model.dayEnd.timeIntervalSince(model.dayStart) / 60)) }
    private var slotCount: Int { max(minimumSlots, dayMinutes / slotMinutes) }
    private var gridHeight: CGFloat { CGFloat(dayMinutes) * pointsPerMinute }

    private struct MeetingPlacement {
        let id: UUID?
        let start: Int
        let end: Int
    }
    private enum MeetingDrag {
        case move(id: UUID, start: Int, length: Int)
        case resizeTop(id: UUID, end: Int)
        case resizeBottom(id: UUID, start: Int)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Meetings").font(.system(size: 23, weight: .semibold))
                    Text("Drag empty space to add. Drag a block’s middle to move it, or its edges to resize. Snaps to 15 minutes.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                }
                Spacer()
                Button { persistTitle(); dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close calendar")
            }
            HStack(spacing: 10) {
                if let selectedID, let meeting = model.meetings.first(where: { $0.id == selectedID }) {
                    TextField("Meeting name", text: $title)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("meeting-name")
                    Text(timeLabel(for: meeting))
                        .font(.system(size: 12, weight: .medium).monospacedDigit())
                        .foregroundStyle(CozyPalette.muted)
                } else {
                    Text("Select a meeting to rename it. Right-click a block to delete it.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                }
                Spacer(minLength: 0)
            }
            .frame(height: 28)
            if let message = model.statusMessage,
               message.hasPrefix("Could not save today’s plan") ||
               message.hasPrefix("Choose a meeting") {
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
            }
            ScrollView {
                GeometryReader { geometry in
                    calendarGrid(width: geometry.size.width)
                }
                .frame(height: gridHeight + 4)
            }
            .background(CozyPalette.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(CozyPalette.ink.opacity(0.08)))
        }
        .padding(22)
        .frame(width: 690, height: 710)
        .background(CozyPalette.background)
        .fontDesign(.rounded)
        .foregroundStyle(CozyPalette.ink)
        .onChange(of: title) { _, _ in scheduleTitleSave() }
        .onDisappear {
            titleSaveWork?.cancel()
            persistTitle()
            model.flushPendingPlan()
        }
    }

    private func calendarGrid(width: CGFloat) -> some View {
        DayCalendarGrid(dayStart: model.dayStart, dayMinutes: dayMinutes,
                        pointsPerMinute: pointsPerMinute, width: width) {
            Rectangle()
                .fill(CozyPalette.card)
                .contentShape(Rectangle())
                .gesture(createGesture)
        } blocks: {
            if let preview, preview.id == nil {
                RoundedRectangle(cornerRadius: 7)
                    .fill(CozyPalette.peach.opacity(0.8))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(CozyPalette.green, lineWidth: 2))
                    .frame(width: max(0, width - 70), height: CGFloat((preview.end - preview.start) * slotMinutes) * pointsPerMinute)
                    .offset(x: 62, y: CGFloat(preview.start * slotMinutes) * pointsPerMinute)
                    .allowsHitTesting(false)
            }
            ForEach(model.meetings) { meeting in
                meetingBlock(meeting, width: width)
            }
            if let preview, let id = preview.id,
               let meeting = model.meetings.first(where: { $0.id == id }) {
                HStack {
                    Text(meeting.title).fontWeight(.semibold)
                    Spacer()
                    Text("\((preview.end - preview.start) * slotMinutes)m")
                }
                .font(.system(size: 11))
                .padding(.horizontal, 9)
                .frame(width: max(0, width - 70),
                       height: CGFloat((preview.end - preview.start) * slotMinutes) * pointsPerMinute)
                .background(CozyPalette.peach, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(CozyPalette.green, lineWidth: 2))
                .offset(x: 62, y: CGFloat(preview.start * slotMinutes) * pointsPerMinute)
                .allowsHitTesting(false)
            }
        }
        .coordinateSpace(name: "meetingGrid")
    }

    private func meetingBlock(_ meeting: MeetingRow, width: CGFloat) -> some View {
        let minute = Int(meeting.start.timeIntervalSince(model.dayStart) / 60)
        let duration = meeting.duration
        return Group {
            if minute >= 0 && minute < dayMinutes {
                VStack(spacing: 0) {
                    Capsule().fill(CozyPalette.green.opacity(0.7)).frame(width: 42, height: 3)
                    Spacer(minLength: 0)
                    HStack {
                        Text(meeting.title).fontWeight(.semibold)
                        Spacer()
                        Text("\(duration)m")
                    }
                    Spacer(minLength: 0)
                    Capsule().fill(CozyPalette.green.opacity(0.7)).frame(width: 42, height: 3)
                }
                .font(.system(size: 11))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frame(width: max(0, width - 70), height: max(18, CGFloat(duration) * pointsPerMinute))
                .background(selectedID == meeting.id ? CozyPalette.green.opacity(0.35) : CozyPalette.paleGreen,
                            in: RoundedRectangle(cornerRadius: 7))
                .contentShape(Rectangle())
                .onTapGesture { select(meeting) }
                .gesture(meetingGesture(meeting, originY: CGFloat(minute) * pointsPerMinute,
                                        height: max(18, CGFloat(duration) * pointsPerMinute)))
                .contextMenu {
                    Button("Delete meeting", role: .destructive) {
                        if selectedID == meeting.id {
                            titleSaveWork?.cancel()
                            selectedID = nil
                            title = ""
                        }
                        model.removeMeeting(meeting.id)
                    }
                }
                .offset(x: 62, y: CGFloat(minute) * pointsPerMinute)
                .opacity(preview?.id == meeting.id ? 0.25 : 1)
            }
        }
    }

    private var createGesture: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named("meetingGrid"))
            .onChanged { value in updateCreate(at: value.startLocation.y, currentY: value.location.y) }
            .onEnded { value in
                updateCreate(at: value.startLocation.y, currentY: value.location.y)
                if let preview, preview.id == nil {
                    persistTitle()
                    let id = UUID()
                    let start = date(for: preview.start)
                    let end = date(for: preview.end)
                    if model.upsertMeeting(id: id, title: "Meeting", start: start, end: end) {
                        selectedID = id
                        title = "Meeting"
                    }
                }
                preview = nil
                activeDrag = nil
            }
    }

    private func meetingGesture(_ meeting: MeetingRow, originY: CGFloat, height: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named("meetingGrid"))
            .onChanged { value in updateMeetingDrag(meeting, originY: originY, height: height, value: value) }
            .onEnded { value in
                updateMeetingDrag(meeting, originY: originY, height: height, value: value)
                if let preview, preview.id == meeting.id {
                    persistTitle()
                    let currentTitle = model.meetings.first(where: { $0.id == meeting.id })?.title ?? meeting.title
                    if model.upsertMeeting(id: meeting.id, title: currentTitle,
                                           start: date(for: preview.start), end: date(for: preview.end)) {
                        selectedID = meeting.id
                        title = currentTitle
                    }
                }
                preview = nil
                activeDrag = nil
            }
    }

    private func updateCreate(at startY: CGFloat, currentY: CGFloat) {
        let height = CGFloat(slotMinutes) * pointsPerMinute
        let first = min(slotCount - 1, max(0, Int(floor(min(startY, currentY) / height))))
        let last = min(slotCount, max(first + 1, Int(ceil(max(startY, currentY) / height))))
        let start = min(first, slotCount - minimumSlots)
        preview = MeetingPlacement(id: nil, start: start, end: min(slotCount, max(last, start + minimumSlots)))
    }

    private func updateMeetingDrag(_ meeting: MeetingRow, originY: CGFloat, height: CGFloat,
                                   value: DragGesture.Value) {
        if activeDrag == nil {
            let start = min(slotCount - minimumSlots, max(0, Int((meeting.start.timeIntervalSince(model.dayStart) / TimeInterval(slotMinutes * 60)).rounded())))
            let length = min(slotCount, max(minimumSlots, Int((Double(meeting.duration) / Double(slotMinutes)).rounded())))
            let end = min(slotCount, start + length)
            let edgeHeight = min(11, max(4, height / 3))
            let localStartY = value.startLocation.y - originY
            if localStartY <= edgeHeight {
                activeDrag = .resizeTop(id: meeting.id, end: end)
            } else if localStartY >= height - edgeHeight {
                activeDrag = .resizeBottom(id: meeting.id, start: start)
            } else {
                activeDrag = .move(id: meeting.id, start: start, length: end - start)
            }
        }
        // Step to the next quarter-hour as soon as the pointer moves into it.
        // Rounding to the nearest slot made short adjustments feel unresponsive.
        let delta = Int((value.translation.height / (CGFloat(slotMinutes) * pointsPerMinute))
            .rounded(.awayFromZero))
        switch activeDrag {
        case .move(let id, let start, let length) where id == meeting.id:
            let newStart = min(max(0, start + delta), slotCount - length)
            preview = MeetingPlacement(id: id, start: newStart, end: newStart + length)
        case .resizeTop(let id, let end) where id == meeting.id:
            let newStart = min(max(0, Int((meeting.start.timeIntervalSince(model.dayStart) / TimeInterval(slotMinutes * 60)).rounded()) + delta), end - minimumSlots)
            preview = MeetingPlacement(id: id, start: newStart, end: end)
        case .resizeBottom(let id, let start) where id == meeting.id:
            let originalEnd = Int((meeting.start.timeIntervalSince(model.dayStart) / TimeInterval(slotMinutes * 60)).rounded()) + max(minimumSlots, Int((Double(meeting.duration) / Double(slotMinutes)).rounded()))
            let newEnd = max(start + minimumSlots, min(slotCount, originalEnd + delta))
            preview = MeetingPlacement(id: id, start: start, end: newEnd)
        default: break
        }
    }

    private func date(for slot: Int) -> Date {
        model.dayStart.addingTimeInterval(TimeInterval(slot * slotMinutes * 60))
    }

    private func timeLabel(for meeting: MeetingRow) -> String {
        let end = meeting.start.addingTimeInterval(TimeInterval(meeting.duration * 60))
        return "\(meeting.start.formatted(.dateTime.hour().minute()))–\(end.formatted(.dateTime.hour().minute()))"
    }

    private func select(_ meeting: MeetingRow) {
        persistTitle()
        titleSaveWork?.cancel()
        selectedID = meeting.id
        title = meeting.title
    }

    private func scheduleTitleSave() {
        titleSaveWork?.cancel()
        guard selectedID != nil else { return }
        let work = DispatchWorkItem { persistTitle() }
        titleSaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func persistTitle() {
        guard let selectedID,
              let meeting = model.meetings.first(where: { $0.id == selectedID }) else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != meeting.title else { return }
        _ = model.upsertMeeting(id: selectedID, title: name, start: meeting.start,
                                end: meeting.start.addingTimeInterval(TimeInterval(meeting.duration * 60)))
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel
    @FocusState private var focusedSidebarPage: AppPage?
    @FocusState private var reflectionFieldFocused: Bool

    private var petImage: Image {
        if let url = Bundle.main.url(forResource: "red-panda", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            Image(nsImage: image)
        } else {
            Image(systemName: "pawprint.fill")
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 170)
            ScrollView {
                Group {
                    switch model.page {
                    case .today: todayPage
                    case .plan: planPage
                    case .history: historyPage
                    case .room: roomPage
                    case .settings: settingsPage
                    }
                }
                .padding(28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(CozyPalette.background)
            .simultaneousGesture(TapGesture().onEnded { focusedSidebarPage = nil })
        }
        .frame(minWidth: 790, minHeight: 590)
        .foregroundStyle(CozyPalette.ink)
        .fontDesign(.rounded)
        .environment(\.colorScheme, .light)
        .onChange(of: model.page) { oldPage, newPage in
            focusedSidebarPage = nil
            if oldPage == .plan && newPage != .plan { model.flushPendingPlan() }
        }
        .sheet(isPresented: $model.showingMeetingEditor) {
            MeetingDayEditor(model: model)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "leaf.fill")
                    .foregroundStyle(CozyPalette.green)
                Text("cozy focus")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
            }
            .padding(.bottom, 10)
            VStack(alignment: .leading, spacing: 7) {
                Label("\(model.profile.title) profile", systemImage: model.profile == .testing ? "checkmark.shield.fill" : "person.crop.circle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(CozyPalette.green)
                if model.canSwitchProfiles && model.profile == .personal && model.phase == .idle {
                    Button("Use Testing") { model.switchProfile(to: .testing) }
                        .font(.system(size: 11, weight: .medium))
                        .buttonStyle(.plain)
                        .foregroundStyle(CozyPalette.green)
                        .accessibilityIdentifier("switch-to-testing")
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CozyPalette.card, in: RoundedRectangle(cornerRadius: 10))
            .padding(.bottom, 14)
            ForEach(AppPage.allCases) { page in
                Button {
                    model.page = page
                    focusedSidebarPage = nil
                } label: {
                    Label(page.title, systemImage: page.symbol)
                        .font(.system(size: 13, weight: model.page == page ? .semibold : .medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(model.page == page ? CozyPalette.card : .clear, in: RoundedRectangle(cornerRadius: 11))
                        .contentShape(RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(.plain)
                .focused($focusedSidebarPage, equals: page)
                .accessibilityIdentifier("nav-\(page.rawValue)")
            }
            Spacer()
            HStack(spacing: 7) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 7))
                    .foregroundStyle(CozyPalette.green)
                Text("Stored on this Mac")
                    .font(.system(size: 11))
                    .foregroundStyle(CozyPalette.muted)
            }
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(CozyPalette.sidebar)
    }

    private var todayPage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("A gentler workday", subtitle: Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
            HStack(alignment: .top, spacing: 18) {
                Card {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Text(model.phaseLabel.uppercased())
                                .font(.system(size: 11, weight: .bold))
                                .tracking(1.5)
                                .foregroundStyle(CozyPalette.green)
                            Spacer()
                            Image(systemName: model.phaseSymbol)
                                .foregroundStyle(CozyPalette.green)
                        }
                        Text(model.timeString)
                            .font(.system(size: 58, weight: .medium, design: .rounded).monospacedDigit())
                            .contentTransition(.numericText())
                            .accessibilityIdentifier("timer-countdown")
                        Text(model.phaseMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(CozyPalette.muted)
                            .frame(height: 34, alignment: .topLeading)
                        HStack(spacing: 8) {
                            if model.phase == .idle {
                                primaryButton("Start focus", symbol: "play.fill") { model.startFocus() }
                                    .accessibilityIdentifier("start-focus")
                            } else if model.phase == .focus {
                                if model.breakDue {
                                    primaryButton("Start break", symbol: "cup.and.saucer.fill") { model.startBreak() }
                                        .accessibilityIdentifier("start-break")
                                    quietButton("Snooze") { model.snooze() }
                                        .accessibilityIdentifier("snooze-break")
                                    quietButton("Skip") { model.skipBreak() }
                                        .accessibilityIdentifier("skip-break")
                                } else {
                                    primaryButton("Take a break", symbol: "cup.and.saucer.fill") { model.startBreak() }
                                        .accessibilityIdentifier("start-break")
                                    quietButton("End focus") { model.endFocus() }
                                        .accessibilityIdentifier("end-focus")
                                }
                            } else {
                                primaryButton("Finish break", symbol: "checkmark") { model.finishBreak() }
                                    .accessibilityIdentifier("finish-break")
                            }
                        }
                    }
                }
                .frame(maxWidth: 340)
                Card {
                    VStack(alignment: .center, spacing: 2) {
                        petImage
                            .resizable()
                            .scaledToFit()
                            .frame(height: 188)
                            .accessibilityLabel("A smiling red panda pet")
                        Text(model.petMessage)
                            .font(.system(size: 14, weight: .semibold))
                            .multilineTextAlignment(.center)
                        Text("\(model.coins) acorns earned")
                            .font(.system(size: 12))
                            .foregroundStyle(CozyPalette.muted)
                    }
                    .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: 270)
            }
            HStack(spacing: 18) {
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("Today at a glance", symbol: "sun.max")
                        metricRow("Focus", value: "\(model.focusMinutesToday) min")
                        metricRow("Breaks", value: "\(model.breakMinutesToday) min")
                        metricRow("Meetings", value: "\(model.meetings.count)")
                    }
                }
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("A little nudge", symbol: "sparkle")
                        Text(model.nudgeMessage)
                            .font(.system(size: 13))
                            .foregroundStyle(CozyPalette.muted)
                        Spacer(minLength: 2)
                        Button("Shape today’s plan →") { model.page = .plan }
                            .buttonStyle(.plain)
                            .foregroundStyle(CozyPalette.green)
                            .font(.system(size: 12, weight: .semibold))
                    }
                }
            }
        }
    }

    private var planPage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Shape your day", subtitle: "A plan is a guide. Change it whenever you need.")
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        sectionTitle("Yesterday, briefly", symbol: "bubble.left")
                        Spacer()
                        if model.savedReflection != nil && !model.reflectionIsEditing {
                            Button {
                                withAnimation(.easeInOut(duration: 0.25)) { model.editReflection() }
                            } label: {
                                Label("Edit reflection", systemImage: "pencil")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(CozyPalette.green)
                            .accessibilityIdentifier("edit-reflection")
                        }
                    }
                    HStack(spacing: 18) {
                        Text("Focus · \(model.yesterdayFocusMinutes) min")
                        Text("Confirmed breaks · \(model.yesterdayBreakMinutes) min")
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(CozyPalette.green)
                    ForEach(model.yesterdayTimeline.indices, id: \.self) { index in
                        let interval = model.yesterdayTimeline[index]
                        if interval.kind == .focus || (interval.kind == .break && interval.confirmed) {
                            HStack {
                                Text(interval.kind == .focus ? "Focus" : "Break")
                                Spacer()
                                Text(interval.start.formatted(.dateTime.hour().minute()))
                                Text("\(Int(interval.observedSeconds / 60)) min")
                            }
                            .font(.system(size: 11))
                            .foregroundStyle(CozyPalette.muted)
                        }
                    }
                    if model.reflectionIsEditing {
                        Text("What felt good? What would make breaks easier today?")
                            .font(.system(size: 12))
                            .foregroundStyle(CozyPalette.muted)
                        TextField("A few words are enough…", text: $model.reflection)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.done)
                            .onSubmit { submitReflection() }
                            .focused($reflectionFieldFocused)
                            .accessibilityIdentifier("reflection-input")
                        HStack {
                            Spacer()
                            if model.savedReflection != nil {
                                quietButton("Cancel") {
                                    withAnimation(.easeInOut(duration: 0.25)) { model.cancelReflectionEdit() }
                                }
                                .accessibilityIdentifier("cancel-reflection-edit")
                            }
                            quietButton("Save reflection") { submitReflection() }
                                .disabled(model.reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                          model.reflection.trimmingCharacters(in: .whitespacesAndNewlines) == model.savedReflection)
                                .accessibilityIdentifier("save-reflection")
                        }
                        if let message = model.statusMessage, message.hasPrefix("Could not save reflection") {
                            Text(message).font(.system(size: 12)).foregroundStyle(.red)
                        }
                    } else if let saved = model.savedReflection {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(CozyPalette.green)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Saved").fontWeight(.semibold)
                                Text(saved).foregroundStyle(CozyPalette.muted)
                            }
                        }
                        .font(.system(size: 13))
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    sectionTitle("Day bounds & rhythm", symbol: "clock")
                    HStack {
                        DatePicker("Start", selection: $model.dayStart, displayedComponents: .hourAndMinute)
                        DatePicker("Finish", selection: $model.dayEnd, displayedComponents: .hourAndMinute)
                    }
                    HStack {
                        Stepper("Focus · \(model.focusLength) min", value: $model.focusLength, in: 5...120, step: 5)
                        Stepper("Break · \(model.breakLength) min", value: $model.breakLength, in: 2...60, step: 1)
                    }
                    .font(.system(size: 12))
                    Text(model.planSavePending ? "Saving changes…" : "Changes save automatically.")
                        .font(.system(size: 11))
                        .foregroundStyle(CozyPalette.muted)
                    if model.dayEnd.timeIntervalSince(model.dayStart) < 15 * 60 {
                        Text("Finish must be at least 15 minutes after start.")
                            .font(.system(size: 11))
                            .foregroundStyle(.red)
                    }
                }
                .onChange(of: model.dayStart) { _, _ in model.savePlan() }
                .onChange(of: model.dayEnd) { _, _ in model.savePlan() }
                .onChange(of: model.focusLength) { _, _ in model.savePlan() }
                .onChange(of: model.breakLength) { _, _ in model.savePlan() }
            }
            Button { model.showingMeetingEditor = true } label: {
                Card {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            sectionTitle("Meetings", symbol: "person.2")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 11))
                                .foregroundStyle(CozyPalette.muted)
                        }
                        ForEach(model.meetings) { meeting in
                            HStack {
                                Text(meeting.title)
                                Spacer()
                                Text("\(meeting.start.formatted(.dateTime.hour().minute()))–\(meeting.start.addingTimeInterval(TimeInterval(meeting.duration * 60)).formatted(.dateTime.hour().minute()))")
                                    .foregroundStyle(CozyPalette.muted)
                            }
                            .font(.system(size: 12))
                        }
                        if model.meetings.isEmpty {
                            Text("No meetings planned yet.")
                                .font(.system(size: 12))
                                .foregroundStyle(CozyPalette.muted)
                        }
                        Text("Open day calendar")
                            .font(.system(size: 11))
                            .foregroundStyle(CozyPalette.green)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("open-meetings")
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Suggested timeline", symbol: "rectangle.stack")
                    if model.suggestions.isEmpty {
                        Text("Set your day bounds to see suggested focus and break times.")
                            .foregroundStyle(CozyPalette.muted)
                    } else {
                        SuggestedDayCalendar(dayStart: model.dayStart, dayEnd: model.dayEnd,
                                             suggestions: model.suggestions)
                    }
                }
            }
        }
    }

    private func submitReflection() {
        reflectionFieldFocused = false
        withAnimation(.easeInOut(duration: 0.3)) {
            _ = model.saveReflection()
        }
    }

    private var historyPage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Your rhythm", subtitle: "Small steps, recorded honestly.")
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    sectionTitle("Planned and actual timeline", symbol: "rectangle.split.2x1")
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PLANNED").font(.system(size: 11, weight: .bold)).foregroundStyle(CozyPalette.green)
                            if model.plannedTimeline.isEmpty {
                                Text("No plan saved today.").foregroundStyle(CozyPalette.muted)
                            }
                            ForEach(model.plannedTimeline.indices, id: \.self) { index in
                                let block = model.plannedTimeline[index]
                                timelineRow(block.title ?? block.kind.rawValue.capitalized,
                                            start: block.start, end: block.end)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("ACTUAL").font(.system(size: 11, weight: .bold)).foregroundStyle(CozyPalette.green)
                            if model.actualTimeline.isEmpty {
                                Text("No sessions recorded today.").foregroundStyle(CozyPalette.muted)
                            }
                            ForEach(model.actualTimeline.indices, id: \.self) { index in
                                let interval = model.actualTimeline[index]
                                timelineRow(interval.kind == .free ? "Away" :
                                            interval.kind == .break ? (interval.confirmed ? "Confirmed break" : "Break") : "Focus",
                                            start: interval.start, end: interval.end)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .font(.system(size: 12))
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    sectionTitle("Today’s actual moments", symbol: "chart.bar.xaxis")
                    if model.history.isEmpty {
                        Text("Your first focus session will appear here.")
                            .foregroundStyle(CozyPalette.muted)
                    } else {
                        ForEach(model.history) { entry in
                            HStack(spacing: 12) {
                                Image(systemName: entry.symbol)
                                    .foregroundStyle(CozyPalette.green)
                                    .frame(width: 20)
                                Text(entry.title)
                                Spacer()
                                Text(entry.date.formatted(.dateTime.hour().minute()))
                                    .foregroundStyle(CozyPalette.muted)
                            }
                            .font(.system(size: 13))
                            Divider()
                        }
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    sectionTitle("The whole day", symbol: "calendar")
                    metricRow("Focus time recorded", value: "\(model.focusMinutesToday) min")
                    metricRow("Break time confirmed", value: "\(model.breakMinutesToday) min")
                    metricRow("Acorns available", value: "\(model.coins)")
                }
            }
        }
    }

    private var roomPage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Your little room", subtitle: "Show up, rest, and make it your own.")
            Card {
                VStack(spacing: 4) {
                    ZStack {
                        ForEach(RoomCatalog.decorations.filter { $0.id == "cushion" && model.unlockedItems.contains($0.id) }) { decoration in
                            decorationImage(decoration)
                        }
                        petImage
                            .resizable()
                            .scaledToFit()
                            .frame(height: 270)
                        ForEach(RoomCatalog.decorations.filter { $0.id != "cushion" && model.unlockedItems.contains($0.id) }) { decoration in
                            decorationImage(decoration)
                        }
                    }
                    .frame(height: 290)
                    Text("A cozy corner for your companion")
                        .font(.system(size: 18, weight: .semibold))
                    Text("\(model.coins) acorns to spend")
                        .foregroundStyle(CozyPalette.muted)
                }
                .frame(maxWidth: .infinity)
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Little comforts", symbol: "gift")
                    ForEach(model.shopItems) { item in
                        HStack {
                            Image(systemName: item.symbol)
                                .frame(width: 24)
                                .foregroundStyle(CozyPalette.green)
                            Text(item.name)
                            Spacer()
                            if model.unlockedItems.contains(item.id) {
                                Text("Unlocked")
                                    .foregroundStyle(CozyPalette.muted)
                            } else {
                                Button("\(item.cost) acorns") { model.purchase(item) }
                                    .disabled(model.coins < item.cost)
                                    .accessibilityIdentifier("purchase-\(item.id)")
                            }
                        }
                        .font(.system(size: 13))
                    }
                }
            }
        }
    }

    private func decorationImage(_ decoration: RoomDecoration) -> some View {
        Image(systemName: decoration.symbol)
            .font(.system(size: decoration.size))
            .foregroundStyle(decoration.tint)
            .offset(x: decoration.x, y: decoration.y)
            .accessibilityLabel(decoration.accessibilityLabel)
    }

    private var settingsPage: some View {
        VStack(alignment: .leading, spacing: 18) {
            pageHeader("Make it yours", subtitle: "A few gentle defaults.")
            Card {
                VStack(alignment: .leading, spacing: 14) {
                    sectionTitle("Focus & breaks", symbol: "slider.horizontal.3")
                    Stepper("Focus length · \(model.focusLength) minutes", value: $model.focusLength, in: 5...120, step: 5)
                    Stepper("Break length · \(model.breakLength) minutes", value: $model.breakLength, in: 2...60, step: 1)
                    Toggle("Gentle notifications", isOn: $model.notificationsEnabled)
                    Button("Save preferences") { model.savePreferences() }
                        .buttonStyle(.borderedProminent)
                        .tint(CozyPalette.green)
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Reward preview", symbol: "leaf.circle")
                    Text("Try different reward values against your saved sessions. This preview does not change your balance or history.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                    Stepper("Focus credit · \(model.previewFocusCredits) per minute",
                            value: $model.previewFocusCredits, in: 0...5)
                    Stepper("Break bonus · \(model.previewBreakBonus) acorns",
                            value: $model.previewBreakBonus, in: 0...50, step: 5)
                    if let preview = model.rebalancePreview {
                        Text("\(preview.focusSessions) focus sessions · \(preview.confirmedBreaks) confirmed breaks")
                        Text("Current \(preview.currentBalance) → Preview \(preview.projectedBalance) acorns")
                            .fontWeight(.semibold)
                    }
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Data profile", symbol: "person.crop.circle")
                    Picker("Profile", selection: Binding(
                        get: { model.profile },
                        set: { model.switchProfile(to: $0) }
                    )) {
                        ForEach(DataProfile.allCases) { profile in
                            Text(profile.title).tag(profile)
                        }
                    }
                    .disabled(!model.canSwitchProfiles)
                    .accessibilityIdentifier("data-profile")
                    Text(model.canSwitchProfiles
                         ? "Each profile has its own history and rewards. Testing never writes to Personal."
                         : "Development runs are locked to the isolated Testing profile.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Your data", symbol: "externaldrive")
                    Text("Your timeline stays in a local SQLite database on this Mac.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                    HStack {
                        quietButton("Export JSON") { model.exportJSON() }
                        quietButton("Back up database") { model.backupDatabase() }
                    }
                }
            }
            #if DEBUG
            if ProcessInfo.processInfo.environment["COZY_FOCUS_DEV"] == "1" { Card {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Development scenarios", symbol: "wand.and.stars")
                    Text("Exercise the full loop without waiting for real time.")
                        .font(.system(size: 12))
                        .foregroundStyle(CozyPalette.muted)
                    HStack {
                        quietButton("Morning setup") { model.loadScenario(.morning) }
                        quietButton("Break due") { model.loadScenario(.breakDue) }
                        quietButton("Completed day") { model.loadScenario(.completedDay) }
                    }
                    HStack {
                        quietButton("Advance 5 min") { model.advance(minutes: 5) }
                        quietButton("Simulate away") { model.simulateAway() }
                        quietButton("Simulate return") { model.simulateReturn() }
                        quietButton("Sleep / wake") { model.simulateSleepWake() }
                    }
                }
            } }
            #endif
            if let message = model.statusMessage {
                Text(message).font(.system(size: 12)).foregroundStyle(CozyPalette.green)
            }
        }
    }

    private func pageHeader(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 27, weight: .bold))
            Text(subtitle).font(.system(size: 13)).foregroundStyle(CozyPalette.muted)
        }
        .padding(.bottom, 4)
    }

    private func sectionTitle(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 15, weight: .semibold))
    }

    private func metricRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(CozyPalette.muted)
            Spacer()
            Text(value).fontWeight(.semibold)
        }
        .font(.system(size: 12))
    }

    private func timelineRow(_ title: String, start: Date, end: Date) -> some View {
        HStack(spacing: 8) {
            Text(start.formatted(.dateTime.hour().minute()))
                .monospacedDigit()
                .foregroundStyle(CozyPalette.muted)
            Text(title).fontWeight(.medium)
            Spacer(minLength: 4)
            Text("\(Int(end.timeIntervalSince(start) / 60))m")
                .foregroundStyle(CozyPalette.muted)
        }
    }

    private func primaryButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
        }
        .foregroundStyle(.white)
        .background(CozyPalette.green, in: RoundedRectangle(cornerRadius: 8))
        .buttonStyle(.plain)
    }

    private func quietButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.bordered)
            .controlSize(.small)
    }
}
