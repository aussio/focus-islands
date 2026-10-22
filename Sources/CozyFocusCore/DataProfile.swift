import Foundation

/// Each profile owns an entire SQLite database, including its migrations and
/// unique event keys. The legacy database path remains the personal profile.
public enum DataProfile: String, CaseIterable, Identifiable, Codable, Sendable {
    case personal
    case testing

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .personal: "Personal"
        case .testing: "Testing"
        }
    }

    public func databaseURL(in applicationSupport: URL) -> URL {
        switch self {
        case .personal: applicationSupport.appendingPathComponent("events.sqlite")
        case .testing: applicationSupport.appendingPathComponent("profiles/testing/events.sqlite")
        }
    }
}
