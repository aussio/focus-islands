import Foundation

public enum EventKind: String, Codable, Sendable, CaseIterable {
    case dayPlan, dayPlanRevision, dayPlanRevised, focusStarted, focusPaused, focusResumed, focusEnded
    case breakDue, breakSnoozed, breakStarted, breakProgress, breakConfirmed, breakEnded, breakSkipped
    case awayStarted, awayEnded, sleepStarted, sleepEnded, reflection
    case rewardGranted, rewardDebited, rewardAdjusted, itemPurchased, itemUnlocked
}

public enum EventSource: String, Codable, Sendable {
    case user, system, inferred
}

public struct Event: Codable, Sendable, Identifiable, Equatable {
    public let sequence: Int64
    public let id: UUID
    public let kind: EventKind
    public let schemaVersion: Int
    public let occurredAt: Date
    public let recordedAt: Date
    public let timeZoneID: String
    public let source: EventSource
    public let payloadJSON: String
    public let uniqueKey: String?

    public func payload<T: Decodable>(as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(payloadJSON.utf8))
    }
}

public struct SessionPayload: Codable, Sendable, Equatable {
    public var sessionID: UUID
    public var targetSeconds: TimeInterval
    public var elapsedSeconds: TimeInterval?

    public init(sessionID: UUID, targetSeconds: TimeInterval, elapsedSeconds: TimeInterval? = nil) {
        self.sessionID = sessionID
        self.targetSeconds = targetSeconds
        self.elapsedSeconds = elapsedSeconds
    }
}

public struct RewardPayload: Codable, Sendable, Equatable {
    public var amount: Int
    public var policyVersion: Int
    public var sourceID: UUID?
    public var reason: String

    public init(amount: Int, policyVersion: Int, sourceID: UUID? = nil, reason: String) {
        self.amount = amount
        self.policyVersion = policyVersion
        self.sourceID = sourceID
        self.reason = reason
    }
}

public struct PurchasePayload: Codable, Sendable, Equatable {
    public var itemID: String
    public var cost: Int
    public var purchaseID: UUID

    public init(itemID: String, cost: Int, purchaseID: UUID) {
        self.itemID = itemID
        self.cost = cost
        self.purchaseID = purchaseID
    }
}

public struct ReflectionPayload: Codable, Sendable, Equatable {
    public var day: Date
    public var note: String
    public var preferredFocusMinutes: Int?
    public var preferredBreakMinutes: Int?

    public init(day: Date, note: String, preferredFocusMinutes: Int? = nil, preferredBreakMinutes: Int? = nil) {
        self.day = day
        self.note = note
        self.preferredFocusMinutes = preferredFocusMinutes
        self.preferredBreakMinutes = preferredBreakMinutes
    }
}

public enum EventStoreError: Error, LocalizedError {
    case invalidPayload
    case duplicateUniqueKey
    case insufficientBalance
    case invalidPurchase
    case sqlite(String)

    public var errorDescription: String? {
        switch self {
        case .invalidPayload: "Event payload must encode to JSON."
        case .duplicateUniqueKey: "An event with this unique key already exists."
        case .insufficientBalance: "There is not enough credit for this item."
        case .invalidPurchase: "Purchase item and cost must be valid."
        case .sqlite(let message): message
        }
    }
}

public protocol EventStore: Sendable {
    @discardableResult
    func append<P: Encodable>(kind: EventKind, payload: P, occurredAt: Date, source: EventSource, uniqueKey: String?) throws -> Event
    func allEvents() throws -> [Event]
}
