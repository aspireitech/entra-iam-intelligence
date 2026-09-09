import { loadSnapshot } from './store.js';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  return [header, ...lines].join('\r\n');
}

// Mirrors the same report shapes the dashboard SPA already exports as CSV from
// its own in-memory snapshot (see main.jsx's ExportBar usages) - kept as a
// separate, smaller catalog here because the collector's stored snapshot (see
// collector/src/graph.js) uses the same field names, so the same column
// definitions apply directly to `snapshot.<field>` server-side.
export const REPORT_DEFINITIONS = {
  'users-without-mfa': {
    label: 'Users Without MFA',
    rows: (s) => s.mfa?.missingUsers || [],
    columns: [{ label: 'Name', value: 'name' }, { label: 'User Principal Name', value: 'upn' }],
  },
  'stale-users': {
    label: 'Stale Enabled Users (90+ Days)',
    rows: (s) => s.staleUserList || [],
    columns: [
      { label: 'Name', value: 'name' },
      { label: 'User Principal Name', value: 'upn' },
      { label: 'Last Sign-in', value: (u) => u.lastSignIn || 'Never observed' },
    ],
  },
  'users-without-manager': {
    label: 'Users Without Manager',
    rows: (s) => s.usersWithoutManagerList || [],
    columns: [{ label: 'Name', value: 'name' }, { label: 'User Principal Name', value: 'upn' }],
  },
  groups: {
    label: 'Group Inventory',
    rows: (s) => s.groupList || [],
    columns: [
      { label: 'Group', value: 'name' },
      { label: 'Type', value: 'type' },
      { label: 'Membership', value: (g) => (g.dynamic ? 'Dynamic' : 'Assigned') },
      { label: 'Sync', value: (g) => (g.onPremSynced ? 'Synced from on-prem' : 'Cloud-only') },
    ],
  },
  devices: {
    label: 'Device Inventory',
    rows: (s) => s.deviceList || [],
    columns: [
      { label: 'Device', value: 'name' },
      { label: 'OS', value: (d) => `${d.os || ''} ${d.osVersion || ''}`.trim() },
      { label: 'Compliant', value: (d) => (d.compliant == null ? 'Unknown' : d.compliant ? 'Yes' : 'No') },
      { label: 'Last Sign-in', value: (d) => d.lastSignIn || '' },
    ],
  },
  'application-inventory': {
    label: 'Application Inventory',
    rows: (s) => s.appDetails || [],
    columns: [
      { label: 'Application', value: 'name' },
      { label: 'Status', value: (a) => (a.bucket === 'active' ? 'Active' : `Inactive (${a.bucket}d)`) },
      { label: 'Days Since Activity', value: (a) => (a.days == null ? 'Never observed' : a.days) },
    ],
  },
  'credential-expiry': {
    label: 'Application Credential Expiry',
    rows: (s) => s.credentialExpiry?.items || [],
    columns: [
      { label: 'Application', value: 'name' },
      { label: 'Type', value: (c) => (c.type === 'certificate' ? 'Certificate' : 'Client secret') },
      { label: 'Expires', value: 'expiresAt' },
      { label: 'Days Remaining', value: (c) => (c.daysRemaining < 0 ? 'Expired' : c.daysRemaining) },
    ],
  },
  'toxic-combinations': {
    label: 'Toxic Combinations',
    rows: (s) => s.toxicCombinations || [],
    columns: [{ label: 'User', value: 'name' }, { label: 'Compounding Signals', value: (c) => (c.flags || []).join(', ') }],
  },
  'risky-users': {
    label: 'Risky Users',
    rows: (s) => s.riskyUserList || [],
    columns: [
      { label: 'User', value: 'name' },
      { label: 'Risk Level', value: 'riskLevel' },
      { label: 'Risk State', value: 'riskState' },
    ],
  },
};

export function generateReportCsv(tenantId, reportId) {
  const def = REPORT_DEFINITIONS[reportId];
  if (!def) throw new Error(`Unknown report: ${reportId}`);
  const snap = loadSnapshot(tenantId);
  if (!snap) throw new Error('No snapshot collected yet for this tenant.');
  return { label: def.label, csv: toCsv(def.rows(snap), def.columns), collectedAt: snap.collectedAt };
}
