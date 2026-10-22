import Foundation
import SQLite3

public final class SQLiteEventStore: EventStore, @unchecked Sendable {
    private let db: OpaquePointer
    private let lock = NSRecursiveLock()

    public init(url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Could not open database"
            if let handle { sqlite3_close(handle) }
            throw EventStoreError.sqlite(message)
        }
        db = handle
        do {
            try execute("PRAGMA journal_mode=WAL")
            try execute("PRAGMA foreign_keys=ON")
            try migrate()
        } catch {
            sqlite3_close(handle)
            throw error
        }
    }

    deinit { sqlite3_close(db) }

    @discardableResult
    public func append<P: Encodable>(kind: EventKind, payload: P, occurredAt: Date = .now, source: EventSource = .user, uniqueKey: String? = nil) throws -> Event {
        lock.lock()
        defer { lock.unlock() }
        return try insert(kind: kind, payload: payload, occurredAt: occurredAt, source: source, uniqueKey: uniqueKey)
    }

    public func allEvents() throws -> [Event] {
        lock.lock()
        defer { lock.unlock() }
        return try readEvents(sql: "SELECT seq, id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key FROM events ORDER BY seq")
    }

    public func events(on day: Date, calendar: Calendar = .current) throws -> [Event] {
        guard let interval = calendar.dateInterval(of: .day, for: day) else { return [] }
        lock.lock()
        defer { lock.unlock() }
        let statement = try prepare("SELECT seq, id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key FROM events WHERE occurred_at >= ? AND occurred_at < ? ORDER BY seq")
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_double(statement, 1, interval.start.timeIntervalSince1970)
        sqlite3_bind_double(statement, 2, interval.end.timeIntervalSince1970)
        return try rows(statement)
    }

    public func balance() throws -> Int { RewardEngine.balance(events: try allEvents()) }

    /// Returns false if this item is already unlocked or the balance is too low.
    @discardableResult
    public func purchase(itemID: String, cost: Int, occurredAt: Date = .now) throws -> Bool {
        guard !itemID.isEmpty && cost > 0 else { throw EventStoreError.invalidPurchase }
        lock.lock()
        defer { lock.unlock() }
        try execute("BEGIN IMMEDIATE")
        do {
            let events = try readEvents(sql: "SELECT seq, id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key FROM events ORDER BY seq")
            guard !RewardEngine.unlockedItems(events: events).contains(itemID), RewardEngine.balance(events: events) >= cost else {
                try execute("ROLLBACK")
                return false
            }
            let purchaseID = UUID()
            _ = try insert(
                kind: .rewardDebited,
                payload: RewardPayload(amount: -cost, policyVersion: BalancePolicy.current.version, sourceID: purchaseID, reason: "purchase:\(itemID)"),
                occurredAt: occurredAt,
                source: .user,
                uniqueKey: "purchase:\(purchaseID.uuidString):debit"
            )
            _ = try insert(
                kind: .itemPurchased,
                payload: PurchasePayload(itemID: itemID, cost: cost, purchaseID: purchaseID),
                occurredAt: occurredAt,
                source: .user,
                uniqueKey: "purchase:\(purchaseID.uuidString):unlock"
            )
            try execute("COMMIT")
            return true
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    public func exportJSON(to url: URL) throws {
        let events = try allEvents()
        let items: [[String: Any]] = try events.map { event in
            let payload = try JSONSerialization.jsonObject(with: Data(event.payloadJSON.utf8))
            return [
                "sequence": event.sequence,
                "id": event.id.uuidString,
                "kind": event.kind.rawValue,
                "schemaVersion": event.schemaVersion,
                "occurredAt": ISO8601DateFormatter().string(from: event.occurredAt),
                "recordedAt": ISO8601DateFormatter().string(from: event.recordedAt),
                "timeZoneID": event.timeZoneID,
                "source": event.source.rawValue,
                "payload": payload,
                "uniqueKey": event.uniqueKey as Any? ?? NSNull(),
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: items, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])
        try data.write(to: url, options: .atomic)
    }

    /// SQLite's backup API includes committed changes still resident in the WAL.
    public func backup(to url: URL) throws {
        lock.lock()
        defer { lock.unlock() }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var destination: OpaquePointer?
        guard sqlite3_open_v2(url.path, &destination, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let destination else {
            let message = destination.map { String(cString: sqlite3_errmsg($0)) } ?? "Could not open backup"
            if let destination { sqlite3_close(destination) }
            throw EventStoreError.sqlite(message)
        }
        defer { sqlite3_close(destination) }
        guard let backup = sqlite3_backup_init(destination, "main", db, "main") else {
            throw EventStoreError.sqlite(String(cString: sqlite3_errmsg(destination)))
        }
        let result = sqlite3_backup_step(backup, -1)
        let finishResult = sqlite3_backup_finish(backup)
        guard result == SQLITE_DONE && finishResult == SQLITE_OK else {
            throw EventStoreError.sqlite(String(cString: sqlite3_errmsg(destination)))
        }
    }

    private func migrate() throws {
        try execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
        let statement = try prepare("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
        let currentVersion = sqlite3_step(statement) == SQLITE_ROW ? sqlite3_column_int(statement, 0) : 0
        sqlite3_finalize(statement)
        if currentVersion < 1 {
            try execute("BEGIN IMMEDIATE")
            do {
                try execute("""
                    CREATE TABLE events (
                        seq INTEGER PRIMARY KEY AUTOINCREMENT,
                        id TEXT NOT NULL UNIQUE,
                        kind TEXT NOT NULL,
                        schema_version INTEGER NOT NULL,
                        occurred_at REAL NOT NULL,
                        recorded_at REAL NOT NULL,
                        timezone TEXT NOT NULL,
                        source TEXT NOT NULL,
                        payload TEXT NOT NULL,
                        unique_key TEXT UNIQUE
                    )
                    """)
                try execute("CREATE INDEX events_occurred_idx ON events(occurred_at)")
                try execute("INSERT INTO schema_migrations(version, applied_at) VALUES (1, strftime('%s','now'))")
                try execute("COMMIT")
            } catch {
                try? execute("ROLLBACK")
                throw error
            }
        }
    }

    private func insert<P: Encodable>(kind: EventKind, payload: P, occurredAt: Date, source: EventSource, uniqueKey: String?) throws -> Event {
        let data = try JSONEncoder().encode(payload)
        guard let payloadJSON = String(data: data, encoding: .utf8) else { throw EventStoreError.invalidPayload }
        let id = UUID()
        let recordedAt = Date()
        let timeZoneID = TimeZone.current.identifier
        let statement = try prepare("INSERT INTO events (id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        defer { sqlite3_finalize(statement) }
        bind(id.uuidString, to: statement, at: 1)
        bind(kind.rawValue, to: statement, at: 2)
        sqlite3_bind_int(statement, 3, 1)
        sqlite3_bind_double(statement, 4, occurredAt.timeIntervalSince1970)
        sqlite3_bind_double(statement, 5, recordedAt.timeIntervalSince1970)
        bind(timeZoneID, to: statement, at: 6)
        bind(source.rawValue, to: statement, at: 7)
        bind(payloadJSON, to: statement, at: 8)
        if let uniqueKey { bind(uniqueKey, to: statement, at: 9) } else { sqlite3_bind_null(statement, 9) }
        let result = sqlite3_step(statement)
        if result == SQLITE_CONSTRAINT { throw EventStoreError.duplicateUniqueKey }
        guard result == SQLITE_DONE else { throw sqliteError() }
        return Event(sequence: sqlite3_last_insert_rowid(db), id: id, kind: kind, schemaVersion: 1, occurredAt: occurredAt, recordedAt: recordedAt, timeZoneID: timeZoneID, source: source, payloadJSON: payloadJSON, uniqueKey: uniqueKey)
    }

    private func readEvents(sql: String) throws -> [Event] {
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        return try rows(statement)
    }

    private func rows(_ statement: OpaquePointer) throws -> [Event] {
        var events: [Event] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return events }
            guard result == SQLITE_ROW else { throw sqliteError() }
            guard let id = UUID(uuidString: columnText(statement, 1)),
                  let kind = EventKind(rawValue: columnText(statement, 2)),
                  let source = EventSource(rawValue: columnText(statement, 7)) else {
                throw EventStoreError.sqlite("Invalid event row")
            }
            events.append(Event(
                sequence: sqlite3_column_int64(statement, 0),
                id: id,
                kind: kind,
                schemaVersion: Int(sqlite3_column_int(statement, 3)),
                occurredAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)),
                recordedAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 5)),
                timeZoneID: columnText(statement, 6),
                source: source,
                payloadJSON: columnText(statement, 8),
                uniqueKey: sqlite3_column_type(statement, 9) == SQLITE_NULL ? nil : columnText(statement, 9)
            ))
        }
    }

    private func execute(_ sql: String) throws {
        var errorPointer: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(db, sql, nil, nil, &errorPointer)
        if result != SQLITE_OK {
            let message = errorPointer.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(db))
            sqlite3_free(errorPointer)
            throw EventStoreError.sqlite(message)
        }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw sqliteError() }
        return statement
    }

    private func bind(_ value: String, to statement: OpaquePointer, at index: Int32) {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, index, value, -1, transient)
    }

    private func columnText(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let pointer = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: pointer)
    }

    private func sqliteError() -> EventStoreError {
        .sqlite(String(cString: sqlite3_errmsg(db)))
    }
}
