import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export function saveSnapshot(tenantId, snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${tenantId}.json`), JSON.stringify(snapshot, null, 2));
}

export function loadSnapshot(tenantId) {
  const file = path.join(DATA_DIR, `${tenantId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
