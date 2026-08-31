import http from 'node:http';
import { loadAllSnapshots, loadSnapshot, combineSnapshots } from './store.js';
import { certExpiry } from './msal.js';

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function authorized(req, config) {
  if (!config.collectorToken) return true;
  return req.headers['x-iam-collector-token'] === config.collectorToken;
}

export function startServer(config) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      });
      return res.end();
    }
    if (!authorized(req, config)) return json(res, 401, { error: 'Unauthorized' });

    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      const tenants = config.tenants.map((t) => {
        let cert = null;
        try {
          cert = certExpiry(t.certPath || config.certPath);
        } catch (error) {
          cert = { error: error.message };
        }
        return { id: t.id, displayName: t.displayName || t.id, certExpiresInDays: cert?.daysRemaining ?? null, certExpiresAt: cert?.expiresAt ?? null, certError: cert?.error };
      });
      return json(res, 200, { status: 'ok', version: '0.1.0', tenantCount: config.tenants.length, tenants, collectedAt: new Date().toISOString() });
    }

    if (url.pathname === '/tenants') {
      const snaps = loadAllSnapshots(config.tenants.map((t) => t.id));
      return json(res, 200, { tenants: snaps.map((s) => ({ tenantId: s.tenantId, displayName: s.displayName, collectedAt: s.collectedAt })) });
    }

    const tenantMatch = url.pathname.match(/^\/tenants\/([^/]+)\/snapshot$/);
    if (tenantMatch) {
      const snap = loadSnapshot(tenantMatch[1]);
      if (!snap) return json(res, 404, { error: 'No snapshot collected yet for this tenant' });
      return json(res, 200, snap);
    }

    if (url.pathname === '/combined') {
      const snaps = loadAllSnapshots(config.tenants.map((t) => t.id));
      return json(res, 200, combineSnapshots(snaps));
    }

    json(res, 404, { error: 'Not found', endpoints: ['/health', '/tenants', '/tenants/:id/snapshot', '/combined'] });
  });
  const port = config.port || 8766;
  server.listen(port, '127.0.0.1', () => console.log(`[collector] API listening on http://127.0.0.1:${port}`));
  return server;
}
