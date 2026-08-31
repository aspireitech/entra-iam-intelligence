import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, 'history.sqlite'));
  db.pragma('journal_mode = WAL');
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
  `);
  return db;
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
    mfa_missing: snapshot.mfaMissing, credential_expiring_soon: snapshot.credentialExpiry?.expiringSoon ?? null,
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
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO app_events (audit_id, tenant_id, app_id, app_name, event_type, actor_type, actor_name, activity_datetime, observed_at)
    VALUES (@audit_id, @tenant_id, @app_id, @app_name, @event_type, @actor_type, @actor_name, @activity_datetime, @observed_at)
  `);
  const insertMany = getDb().transaction((rows) => { for (const r of rows) stmt.run(r); });
  insertMany(events.map(e => ({ ...e, tenant_id: tenantId, observed_at: new Date().toISOString() })));
}

export function getAppEvents(tenantId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return getDb().prepare(`
    SELECT audit_id, app_id, app_name, event_type, actor_type, actor_name, activity_datetime
    FROM app_events WHERE tenant_id = ? AND activity_datetime >= ? ORDER BY activity_datetime DESC
  `).all(tenantId, since);
}
