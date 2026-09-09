import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Uses Node's own built-in SQLite (stable since Node 22.5, no --experimental-sqlite
// flag needed on the Node versions this project targets) instead of a third-party
// native module. better-sqlite3 was tried first but requires compiling a C++ addon
// via node-gyp when no prebuilt binary matches the host - which needs Visual Studio
// Build Tools on Windows and isn't installed on most machines by default. Node's
// built-in SQLite ships with the Node binary itself: zero extra install, ever.
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'history.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      users INTEGER, applications INTEGER, groups_count INTEGER, devices INTEGER,
      risky_users INTEGER, privileged_users INTEGER, stale_users INTEGER,
      mfa_missing INTEGER, credential_expiring_soon INTEGER,
      license_purchased INTEGER, license_consumed INTEGER,
      toxic_combinations INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_time ON snapshots(tenant_id, collected_at);

    CREATE TABLE IF NOT EXISTS app_events (
      audit_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      app_id TEXT,
      app_name TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_name TEXT,
      activity_datetime TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_events_tenant_time ON app_events(tenant_id, activity_datetime);

    CREATE TABLE IF NOT EXISTS report_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      frequency TEXT NOT NULL,
      recipients TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_report_schedules_tenant ON report_schedules(tenant_id);

    CREATE TABLE IF NOT EXISTS risk_register (
      tenant_id TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      title TEXT,
      category TEXT,
      note TEXT NOT NULL,
      acknowledged_by TEXT,
      acknowledged_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, entry_key)
    );
  `);
  return db;
}

// --- Risk Register (Need Attention / Toxic Combination acknowledgments) --
// Shared across every admin pointed at this collector - unlike the SPA's
// standalone fallback (browser localStorage), this is one row per
// (tenant, finding) that everyone reads and writes the same copy of.
export function listRiskRegister(tenantId) {
  return getDb().prepare(`
    SELECT entry_key AS key, title, category, note, acknowledged_by AS acknowledgedBy, acknowledged_at AS at
    FROM risk_register WHERE tenant_id = ? ORDER BY acknowledged_at DESC
  `).all(tenantId);
}
export function upsertRiskRegisterEntry(tenantId, key, { title, category, note, acknowledgedBy, at }) {
  getDb().prepare(`
    INSERT INTO risk_register (tenant_id, entry_key, title, category, note, acknowledged_by, acknowledged_at)
    VALUES (@tenant_id, @entry_key, @title, @category, @note, @acknowledged_by, @acknowledged_at)
    ON CONFLICT(tenant_id, entry_key) DO UPDATE SET
      title = excluded.title, category = excluded.category, note = excluded.note,
      acknowledged_by = excluded.acknowledged_by, acknowledged_at = excluded.acknowledged_at
  `).run({
    tenant_id: tenantId, entry_key: key,
    title: title ?? null, category: category ?? null, note,
    acknowledged_by: acknowledgedBy ?? null, acknowledged_at: at || new Date().toISOString(),
  });
}
export function deleteRiskRegisterEntry(tenantId, key) {
  getDb().prepare(`DELETE FROM risk_register WHERE tenant_id = ? AND entry_key = ?`).run(tenantId, key);
}

// --- Scheduled email reports ---------------------------------------------
// A schedule just says "email report X to these addresses every N days" - the
// actual sending (and SMTP config) lives in mailer.js/reportScheduler.js; this
// is only the persisted list of what's due and when it last went out.
export function listReportSchedules(tenantId) {
  return getDb().prepare(`
    SELECT id, tenant_id AS tenantId, report_id AS reportId, frequency, recipients, created_at AS createdAt, last_sent_at AS lastSentAt
    FROM report_schedules WHERE tenant_id = ? ORDER BY created_at DESC
  `).all(tenantId);
}
export function listAllReportSchedules() {
  return getDb().prepare(`
    SELECT id, tenant_id AS tenantId, report_id AS reportId, frequency, recipients, created_at AS createdAt, last_sent_at AS lastSentAt
    FROM report_schedules
  `).all();
}
export function createReportSchedule(tenantId, reportId, frequency, recipients) {
  const info = getDb().prepare(`
    INSERT INTO report_schedules (tenant_id, report_id, frequency, recipients, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(tenantId, reportId, frequency, recipients, new Date().toISOString());
  return info.lastInsertRowid;
}
export function deleteReportSchedule(id, tenantId) {
  getDb().prepare(`DELETE FROM report_schedules WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
}
export function markReportScheduleSent(id, when) {
  getDb().prepare(`UPDATE report_schedules SET last_sent_at = ? WHERE id = ?`).run(when, id);
}

// Append-only: every poll adds a new row rather than overwriting the previous one,
// so this is the one place in the product that actually builds history over time.
export function appendSnapshot(tenantId, snapshot) {
  getDb().prepare(`
    INSERT INTO snapshots (tenant_id, collected_at, users, applications, groups_count, devices,
      risky_users, privileged_users, stale_users, mfa_missing, credential_expiring_soon,
      license_purchased, license_consumed, toxic_combinations)
    VALUES (@tenant_id, @collected_at, @users, @applications, @groups_count, @devices,
      @risky_users, @privileged_users, @stale_users, @mfa_missing, @credential_expiring_soon,
      @license_purchased, @license_consumed, @toxic_combinations)
  `).run({
    tenant_id: tenantId,
    collected_at: snapshot.collectedAt,
    users: snapshot.users, applications: snapshot.applications, groups_count: snapshot.groups, devices: snapshot.devices,
    risky_users: snapshot.riskyUsers, privileged_users: snapshot.privilegedUsers, stale_users: snapshot.staleUsers,
    mfa_missing: snapshot.mfa?.missing ?? null, credential_expiring_soon: snapshot.credentialExpiry?.expiringSoon ?? null,
    license_purchased: snapshot.licenses?.totalPurchased ?? null, license_consumed: snapshot.licenses?.totalConsumed ?? null,
    toxic_combinations: snapshot.toxicCombinationsCount ?? null,
  });
}

export function getHistory(tenantId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return getDb().prepare(`
    SELECT collected_at, users, applications, groups_count AS groups, devices, risky_users, privileged_users,
      stale_users, mfa_missing, credential_expiring_soon, license_purchased, license_consumed, toxic_combinations
    FROM snapshots WHERE tenant_id = ? AND collected_at >= ? ORDER BY collected_at ASC
  `).all(tenantId, since);
}

// Delta between the first and most recent point in the window - e.g. "applications
// went from 100 to 150 over 30 days, +50%". Returns null fields when there's not yet
// enough history rather than fabricating a percentage from one data point.
export function getDelta(tenantId, days = 30) {
  const rows = getHistory(tenantId, days);
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const metrics = ['users', 'applications', 'groups', 'devices', 'risky_users', 'privileged_users', 'stale_users', 'mfa_missing', 'credential_expiring_soon', 'toxic_combinations'];
  const deltas = {};
  for (const m of metrics) {
    if (first[m] == null || last[m] == null) { deltas[m] = null; continue; }
    const change = last[m] - first[m];
    const pct = first[m] === 0 ? (last[m] === 0 ? 0 : null) : (change / first[m]) * 100;
    deltas[m] = { from: first[m], to: last[m], change, pct };
  }
  return { sinceDate: first.collected_at, days, deltas };
}

export function upsertAppEvents(tenantId, events) {
  if (!events.length) return;
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO app_events (audit_id, tenant_id, app_id, app_name, event_type, actor_type, actor_name, activity_datetime, observed_at)
    VALUES (@audit_id, @tenant_id, @app_id, @app_name, @event_type, @actor_type, @actor_name, @activity_datetime, @observed_at)
  `);
  // node:sqlite's DatabaseSync has no .transaction() convenience wrapper (unlike
  // better-sqlite3), so this wraps the batch explicitly.
  database.exec('BEGIN');
  try {
    for (const e of events) stmt.run({ ...e, tenant_id: tenantId, observed_at: new Date().toISOString() });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function getAppEvents(tenantId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return getDb().prepare(`
    SELECT audit_id, app_id, app_name, event_type, actor_type, actor_name, activity_datetime
    FROM app_events WHERE tenant_id = ? AND activity_datetime >= ? ORDER BY activity_datetime DESC
  `).all(tenantId, since);
}
