import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// In-memory cache, keyed by tenant ID, of both the parsed snapshot object and its
// already-serialized JSON string. Without this, every single HTTP request for a
// tenant's snapshot (GET /tenants/:id/snapshot, and every /combined call for every
// tenant) did a synchronous fs.readFileSync + JSON.parse from disk, and the server
// re-ran JSON.stringify on the full object again on the way out. That's fine for a
// handful of requests, but this collector is meant to serve every open dashboard
// tab across an organization: at 100 concurrent viewers polling every ~8s, that's
// ~12.5 requests/second, and a large tenant's snapshot (uncapped user/group/device/
// application lists - tens of thousands of rows in a big org) can run into tens of
// megabytes. Synchronously parsing/serializing that repeatedly, on Node's single
// event-loop thread, blocks every other request (including collection itself)
// while it happens - the collector becomes the bottleneck, not Microsoft Graph.
// Caching the object AND its serialized form turns a request into an O(1) memory
// read with zero parsing/serialization, regardless of viewer count or tenant size.
// Safe because this process is the only writer: saveSnapshot() is the only thing
// that changes a tenant's data, and it updates the cache in the same call that
// writes to disk.
const cache = new Map(); // tenantId -> { snapshot, json }

export function saveSnapshot(tenantId, snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(DATA_DIR, `${tenantId}.json`), json);
  cache.set(tenantId, { snapshot, json });
}

function loadFromDisk(tenantId) {
  const file = path.join(DATA_DIR, `${tenantId}.json`);
  if (!fs.existsSync(file)) return null;
  const json = fs.readFileSync(file, 'utf8');
  const snapshot = JSON.parse(json);
  const entry = { snapshot, json };
  cache.set(tenantId, entry);
  return entry;
}

// Cold-start fallback only: the very first read for a tenant after a process
// restart (before that tenant's next collection cycle) still has to touch disk
// once. Every read after that is served from the in-memory cache instead.
function getEntry(tenantId) {
  return cache.get(tenantId) || loadFromDisk(tenantId);
}

export function loadSnapshot(tenantId) {
  return getEntry(tenantId)?.snapshot ?? null;
}

// The pre-serialized string for this tenant, for handlers that just want to write
// the response body directly (server.js's /tenants/:id/snapshot route) without
// paying to re-stringify an object that was already stringified once at
// collection time.
export function getSnapshotJson(tenantId) {
  return getEntry(tenantId)?.json ?? null;
}

export function loadAllSnapshots(tenantIds) {
  return tenantIds.map((id) => loadSnapshot(id)).filter(Boolean);
}

export function combineSnapshots(snapshots) {
  const sum = (key) => snapshots.reduce((a, s) => a + (typeof s[key] === 'number' ? s[key] : 0), 0);
  return {
    tenantCount: snapshots.length,
    users: sum('users'),
    applications: sum('applications'),
    groups: sum('groups'),
    devices: sum('devices'),
    signIns7d: sum('signIns7d'),
    riskyUsers: sum('riskyUsers'),
    privilegedUsers: sum('privilegedUsers'),
    staleUsers: sum('staleUsers'),
    credentialExpiry: {
      expiringSoon: snapshots.reduce((a, s) => a + (s.credentialExpiry?.expiringSoon || 0), 0),
      items: snapshots
        .flatMap((s) => (s.credentialExpiry?.items || []).map((i) => ({ ...i, tenant: s.displayName })))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .slice(0, 20),
    },
    licenses: {
      totalPurchased: snapshots.reduce((a, s) => a + (s.licenses?.totalPurchased || 0), 0),
      totalConsumed: snapshots.reduce((a, s) => a + (s.licenses?.totalConsumed || 0), 0),
    },
    perTenant: snapshots.map((s) => ({
      tenantId: s.tenantId,
      displayName: s.displayName,
      users: s.users,
      applications: s.applications,
      riskyUsers: s.riskyUsers,
      privilegedUsers: s.privilegedUsers,
      credentialExpiringSoon: s.credentialExpiry?.expiringSoon,
      collectedAt: s.collectedAt,
    })),
    collectedAt: new Date().toISOString(),
  };
}
