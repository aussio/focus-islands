const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomUUID } = require('node:crypto');

const LEGACY_EPOCH = 978307200;
const uuid = () => randomUUID().toUpperCase();
const dateFields = new Set(['day', 'start', 'end']);

function encodePayload(value) {
  return JSON.stringify(value, (key, item) => {
    if (item instanceof Date) return (item.getTime() / 1000) - LEGACY_EPOCH;
    if (dateFields.has(key) && typeof item === 'string' && !Number.isNaN(Date.parse(item))) {
      return (Date.parse(item) / 1000) - LEGACY_EPOCH;
    }
    return item;
  });
}

function decodePayload(event) {
  try {
    const payload = JSON.parse(event.payloadJSON);
    if (['dayPlan', 'dayPlanRevision', 'dayPlanRevised', 'reflection'].includes(event.kind)) {
      const dates = event.kind === 'reflection' ? ['day'] : ['day', 'start', 'end'];
      for (const key of dates) if (typeof payload[key] === 'number') payload[key] = new Date((payload[key] + LEGACY_EPOCH) * 1000).toISOString();
      for (const meeting of payload.meetings || []) {
        for (const key of ['start', 'end']) if (typeof meeting[key] === 'number') meeting[key] = new Date((meeting[key] + LEGACY_EPOCH) * 1000).toISOString();
      }
      for (const block of payload.customBlocks || []) {
        for (const key of ['start', 'end']) if (typeof block[key] === 'number') block[key] = new Date((block[key] + LEGACY_EPOCH) * 1000).toISOString();
      }
    }
    return payload;
  } catch { return null; }
}

function rowEvent(row) {
  return {
    sequence: row.seq, id: row.id, kind: row.kind, schemaVersion: row.schema_version,
    occurredAt: new Date(row.occurred_at * 1000).toISOString(),
    recordedAt: new Date(row.recorded_at * 1000).toISOString(),
    timeZoneID: row.timezone, source: row.source, payloadJSON: row.payload,
    uniqueKey: row.unique_key, payload: decodePayload({ kind: row.kind, payloadJSON: row.payload }),
  };
}

function openStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)');
  const version = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  if (version < 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL, occurred_at REAL NOT NULL, recorded_at REAL NOT NULL,
        timezone TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, unique_key TEXT UNIQUE
      ); CREATE INDEX events_occurred_idx ON events(occurred_at);
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, strftime('%s','now')); COMMIT`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        focus_minutes INTEGER NOT NULL,
        break_minutes INTEGER NOT NULL,
        notifications_enabled INTEGER NOT NULL
      ); INSERT INTO schema_migrations(version, applied_at) VALUES (2, strftime('%s','now')); COMMIT`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE settings ADD COLUMN start_time TEXT NOT NULL DEFAULT '09:00';
        ALTER TABLE settings ADD COLUMN end_time TEXT NOT NULL DEFAULT '17:00';
        INSERT INTO schema_migrations(version, applied_at) VALUES (3, strftime('%s','now')); COMMIT`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE settings ADD COLUMN activity_delay_seconds INTEGER;
        INSERT INTO schema_migrations(version, applied_at) VALUES (4, strftime('%s','now')); COMMIT`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const insert = db.prepare(`INSERT INTO events
    (id, kind, schema_version, occurred_at, recorded_at, timezone, source, payload, unique_key)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`);
  const select = db.prepare('SELECT * FROM events ORDER BY seq');
  const selectLastSequence = db.prepare('SELECT COALESCE(MAX(seq), 0) AS sequence FROM events');
  const allEvents = () => select.all().map(rowEvent);
  const lastSequence = () => selectLastSequence.get().sequence;
  const settingsRow = db.prepare('SELECT focus_minutes, break_minutes, notifications_enabled, start_time, end_time, activity_delay_seconds FROM settings WHERE id = 1');
  const updateSettings = db.prepare(`INSERT INTO settings (id, focus_minutes, break_minutes, notifications_enabled, start_time, end_time, activity_delay_seconds)
    VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    focus_minutes = excluded.focus_minutes, break_minutes = excluded.break_minutes,
    notifications_enabled = excluded.notifications_enabled, start_time = excluded.start_time, end_time = excluded.end_time,
    activity_delay_seconds = excluded.activity_delay_seconds`);
  function getSettings() {
    const row = settingsRow.get();
    return row && { focusMinutes: row.focus_minutes, breakMinutes: row.break_minutes,
      startTime: row.start_time, endTime: row.end_time,
      notificationsEnabled: Boolean(row.notifications_enabled), activityDelaySeconds: row.activity_delay_seconds };
  }
  function saveSettings(settings) {
    const previous = getSettings();
    updateSettings.run(settings.focusMinutes, settings.breakMinutes, settings.notificationsEnabled ? 1 : 0,
      settings.startTime ?? previous?.startTime ?? '09:00', settings.endTime ?? previous?.endTime ?? '17:00',
      settings.activityDelaySeconds ?? previous?.activityDelaySeconds ?? null);
    return getSettings();
  }
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function append(kind, payload = {}, { occurredAt = new Date(), source = 'user', uniqueKey = null } = {}) {
    const id = uuid();
    const recordedAt = new Date();
    const payloadJSON = encodePayload(payload);
    if (payloadJSON === undefined) throw new Error('Event payload must encode to JSON.');
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
      const result = insert.run(id, kind, +new Date(occurredAt) / 1000, +recordedAt / 1000, zone, source, payloadJSON, uniqueKey);
      return rowEvent(db.prepare('SELECT * FROM events WHERE seq = ?').get(result.lastInsertRowid));
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint/.test(error.message)) throw new Error('An event with this unique key already exists.');
      throw error;
    }
  }
  function purchase(itemID, cost, occurredAt = new Date()) {
    if (!itemID || !(cost > 0)) throw new Error('Purchase item and cost must be valid.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const events = allEvents();
      const unlocked = new Set(events.filter(event => ['itemPurchased', 'itemUnlocked'].includes(event.kind)).map(event => event.payload?.itemID));
      const balance = events.filter(event => ['rewardGranted', 'rewardDebited', 'rewardAdjusted'].includes(event.kind)).reduce((sum, event) => sum + (event.payload?.amount || 0), 0);
      if (unlocked.has(itemID) || balance < cost) { db.exec('ROLLBACK'); return false; }
      const purchaseID = uuid();
      append('rewardDebited', { amount: -cost, policyVersion: 1, sourceID: purchaseID, reason: `purchase:${itemID}` }, { occurredAt, uniqueKey: `purchase:${purchaseID}:debit` });
      append('itemPurchased', { itemID, cost, purchaseID }, { occurredAt, uniqueKey: `purchase:${purchaseID}:unlock` });
      db.exec('COMMIT');
      return true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { db, allEvents, lastSequence, append, purchase, getSettings, saveSettings, transaction, close: () => db.close() };
}

module.exports = { openStore, uuid, encodePayload, decodePayload, LEGACY_EPOCH };
