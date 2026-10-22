import Foundation

public struct BalancePolicy: Codable, Sendable, Equatable {
    public var version: Int
    public var focusCreditsPerMinute: Int
    public var maximumFocusMinutesPerSession: Int
    public var minimumBreakMinutesForBonus: Int
    public var breakBonus: Int
    public var itemCosts: [String: Int]

    public static let v1 = BalancePolicy(version: 1, focusCreditsPerMinute: 1, maximumFocusMinutesPerSession: 25, minimumBreakMinutesForBonus: 3, breakBonus: 10, itemCosts: ["plant": 35, "cushion": 50, "lamp": 75])
    public static var current: BalancePolicy { (try? bundled()) ?? .v1 }

    public static func bundled() throws -> BalancePolicy {
        guard let url = Bundle.module.url(forResource: "balance-v1", withExtension: "json") else { return .v1 }
        return try JSONDecoder().decode(BalancePolicy.self, from: Data(contentsOf: url))
    }
}

public enum RewardEngine {
    public struct RebalancePreview: Sendable, Equatable {
        public let currentBalance: Int
        public let projectedBalance: Int
        public let focusSessions: Int
        public let confirmedBreaks: Int
    }

    /// Replays session facts under a proposed policy. It never changes events.
    public static func previewRebalance(events: [Event], policy: BalancePolicy) -> RebalancePreview {
        let confirmed = Set(events.filter { $0.kind == .breakConfirmed }.compactMap {
            try? $0.payload(as: SessionPayload.self).sessionID
        })
        var seenFocus = Set<UUID>()
        var seenBreak = Set<UUID>()
        var credits = 0
        for event in events.sorted(by: { $0.sequence < $1.sequence }) {
            guard let payload = try? event.payload(as: SessionPayload.self) else { continue }
            if event.kind == .focusEnded && seenFocus.insert(payload.sessionID).inserted {
                credits += focusGrant(sessionID: payload.sessionID,
                                      observedSeconds: payload.elapsedSeconds ?? 0,
                                      targetSeconds: payload.targetSeconds, policy: policy).amount
            } else if event.kind == .breakEnded && confirmed.contains(payload.sessionID) &&
                        seenBreak.insert(payload.sessionID).inserted {
                credits += breakGrant(sessionID: payload.sessionID, confirmed: true,
                                      observedSeconds: payload.elapsedSeconds ?? 0, policy: policy).amount
            }
        }
        let adjustments = events.reduce(0) { total, event in
            guard event.kind == .rewardDebited || event.kind == .rewardAdjusted,
                  let payload = try? event.payload(as: RewardPayload.self) else { return total }
            return total + payload.amount
        }
        return RebalancePreview(currentBalance: balance(events: events),
                                projectedBalance: credits + adjustments,
                                focusSessions: seenFocus.count, confirmedBreaks: seenBreak.count)
    }

    public static func focusGrant(sessionID: UUID, observedSeconds: TimeInterval, targetSeconds: TimeInterval, policy: BalancePolicy = .current) -> RewardPayload {
        let eligibleMinutes = Int(max(0, min(observedSeconds, targetSeconds, TimeInterval(policy.maximumFocusMinutesPerSession * 60))) / 60)
        return RewardPayload(amount: eligibleMinutes * policy.focusCreditsPerMinute, policyVersion: policy.version, sourceID: sessionID, reason: "focus")
    }

    public static func breakGrant(sessionID: UUID, confirmed: Bool, observedSeconds: TimeInterval, policy: BalancePolicy = .current) -> RewardPayload {
        let qualifies = confirmed && observedSeconds >= TimeInterval(policy.minimumBreakMinutesForBonus * 60)
        return RewardPayload(amount: qualifies ? policy.breakBonus : 0, policyVersion: policy.version, sourceID: sessionID, reason: "break")
    }

    public static func uniqueGrantKey(reason: String, sourceID: UUID, policyVersion: Int) -> String {
        "grant:\(policyVersion):\(reason):\(sourceID.uuidString)"
    }

    public static func balance(events: [Event]) -> Int {
        events.reduce(0) { total, event in
            guard [.rewardGranted, .rewardDebited, .rewardAdjusted].contains(event.kind),
                  let payload = try? event.payload(as: RewardPayload.self) else { return total }
            return total + payload.amount
        }
    }

    public static func unlockedItems(events: [Event]) -> Set<String> {
        Set(events.filter { $0.kind == .itemPurchased || $0.kind == .itemUnlocked }.compactMap {
            try? $0.payload(as: PurchasePayload.self).itemID
        })
    }
}
