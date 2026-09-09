import http from 'node:http';
import { loadAllSnapshots, loadSnapshot, getSnapshotJson, combineSnapshots } from './store.js';
import { certExpiry } from './msal.js';
import { getHistory, getDelta, getAppEvents, listReportSchedules, createReportSchedule, deleteReportSchedule, listRiskRegister, upsertRiskRegisterEntry, deleteRiskRegisterEntry } from './db.js';
import { REPORT_DEFINITIONS, generateReportCsv } from './reports.js';
import { sendReportEmail, mailerConfigured } from './mailer.js';

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
  });
  res.end(JSON.stringify(payload));
}

// For handlers that already have a pre-serialized JSON string on hand (see
// store.js's getSnapshotJson) - writes it directly instead of parsing it back
// into an object just to hand it to JSON.stringify again.
function rawJson(res, status, jsonString) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
  });
  res.end(jsonString);
}

// Fixed-window rate limit, keyed by remote address - generous enough that the
// traffic pattern real dashboard viewers produce never comes close (one poll
// every several seconds per open tab), but catches a single client stuck in a
// fast retry loop before it can monopolize this single-process server. Behind a
// reverse proxy that terminates all connections from one address (see
// collector/README.md's IIS section), every client shares one bucket - raise
// rateLimitPerSecond in tenants.json if that's a legitimate high-traffic setup
// rather than removing the protection.
const RATE_LIMIT_WINDOW_MS = 1000;
const rateBuckets = new Map(); // remoteAddress -> { count, windowStart }
function rateLimited(remoteAddress, maxPerSecond) {
  const now = Date.now();
  const bucket = rateBuckets.get(remoteAddress);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(remoteAddress, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maxPerSecond;
}
// Sweep stale buckets periodically so long-running processes don't accumulate
// an entry per distinct client address forever.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, bucket] of rateBuckets) if (bucket.windowStart < cutoff) rateBuckets.delete(key);
}, 60_000).unref();

function csv(res, filename, content) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
  });
  res.end(content);
}

function authorized(req, config) {
  if (!config.collectorToken) return true;
  return req.headers['x-iam-collector-token'] === config.collectorToken;
}

// Bounded to 1MB - request bodies here are just {reportId, frequency, recipients}
// JSON, never a file upload; a runaway/malicious body gets cut off rather than
// buffered without limit.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function startServer(config) {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, config);
    } catch (error) {
      // A rejected readJsonBody (bad/oversized JSON) or an unexpected error from a
      // handler above would otherwise become an unhandled promise rejection inside
      // this async callback - Node wouldn't crash, but the request would just hang
      // with no response ever sent. Catching here guarantees every request gets a
      // reply.
      if (!res.headersSent) json(res, 400, { error: error.message || 'Request failed' });
    }
  });
  const port = config.port || 8766;
  server.listen(port, '127.0.0.1', () => console.log(`[collector] API listening on http://127.0.0.1:${port}`));
  return server;
}

async function handleRequest(req, res, config) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'X-IAM-Collector-Token,Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      });
      return res.end();
    }
    if (rateLimited(req.socket.remoteAddress, Number(config.rateLimitPerSecond) || 50)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '1' });
      return res.end(JSON.stringify({ error: 'Too many requests' }));
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
      return json(res, 200, { status: 'ok', version: '0.1.0', tenantCount: config.tenants.length, tenants, emailConfigured: mailerConfigured(config), collectedAt: new Date().toISOString() });
    }

    if (url.pathname === '/reports') {
      return json(res, 200, { reports: Object.entries(REPORT_DEFINITIONS).map(([id, def]) => ({ id, label: def.label })) });
    }

    if (url.pathname === '/tenants') {
      const snaps = loadAllSnapshots(config.tenants.map((t) => t.id));
      return json(res, 200, { tenants: snaps.map((s) => ({ tenantId: s.tenantId, displayName: s.displayName, collectedAt: s.collectedAt })) });
    }

    const tenantMatch = url.pathname.match(/^\/tenants\/([^/]+)\/snapshot$/);
    if (tenantMatch) {
      // This is the hottest path in the whole API - every open dashboard tab hits
      // it every few seconds. getSnapshotJson returns the string already produced
      // at collection time (see store.js) instead of re-serializing the object on
      // every request.
      const snapJson = getSnapshotJson(tenantMatch[1]);
      if (!snapJson) return json(res, 404, { error: 'No snapshot collected yet for this tenant' });
      return rawJson(res, 200, snapJson);
    }

    if (url.pathname === '/combined') {
      const snaps = loadAllSnapshots(config.tenants.map((t) => t.id));
      return json(res, 200, combineSnapshots(snaps));
    }

    const historyMatch = url.pathname.match(/^\/tenants\/([^/]+)\/history$/);
    if (historyMatch) {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      return json(res, 200, { tenantId: historyMatch[1], days, points: getHistory(historyMatch[1], days) });
    }

    const deltaMatch = url.pathname.match(/^\/tenants\/([^/]+)\/delta$/);
    if (deltaMatch) {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      const delta = getDelta(deltaMatch[1], days);
      if (!delta) return json(res, 200, { tenantId: deltaMatch[1], days, available: false, reason: 'Not enough historical data yet - need at least two collection cycles in this window.' });
      return json(res, 200, { tenantId: deltaMatch[1], days, available: true, ...delta });
    }

    const eventsMatch = url.pathname.match(/^\/tenants\/([^/]+)\/app-events$/);
    if (eventsMatch) {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      return json(res, 200, { tenantId: eventsMatch[1], days, events: getAppEvents(eventsMatch[1], days) });
    }

    const reportCsvMatch = url.pathname.match(/^\/tenants\/([^/]+)\/reports\/([^/]+)\/csv$/);
    if (reportCsvMatch && req.method === 'GET') {
      try {
        const { label, csv: content } = generateReportCsv(reportCsvMatch[1], reportCsvMatch[2]);
        return csv(res, `${reportCsvMatch[2]}.csv`, content);
      } catch (error) {
        return json(res, 400, { error: error.message, label: REPORT_DEFINITIONS[reportCsvMatch[2]]?.label });
      }
    }

    const reportSendMatch = url.pathname.match(/^\/tenants\/([^/]+)\/reports\/([^/]+)\/send$/);
    if (reportSendMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const recipients = String(body.recipients || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!recipients.length) return json(res, 400, { error: 'At least one recipient email is required.' });
      try {
        const { label, csv: content, collectedAt } = generateReportCsv(reportSendMatch[1], reportSendMatch[2]);
        await sendReportEmail(config, {
          to: recipients,
          subject: `IAM Intelligence report: ${label}`,
          text: `Attached: ${label}, generated from the tenant snapshot collected at ${collectedAt}.`,
          attachmentName: `${reportSendMatch[2]}.csv`,
          attachmentContent: content,
        });
        return json(res, 200, { sent: true, label, recipients });
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    const schedulesMatch = url.pathname.match(/^\/tenants\/([^/]+)\/report-schedules$/);
    if (schedulesMatch && req.method === 'GET') {
      return json(res, 200, { schedules: listReportSchedules(schedulesMatch[1]), emailConfigured: mailerConfigured(config) });
    }
    if (schedulesMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const reportId = String(body.reportId || '');
      const frequency = body.frequency === 'weekly' ? 'weekly' : 'daily';
      const recipients = String(body.recipients || '').split(',').map((s) => s.trim()).filter(Boolean).join(',');
      if (!REPORT_DEFINITIONS[reportId]) return json(res, 400, { error: `Unknown report: ${reportId}` });
      if (!recipients) return json(res, 400, { error: 'At least one recipient email is required.' });
      const id = createReportSchedule(schedulesMatch[1], reportId, frequency, recipients);
      return json(res, 201, { id, tenantId: schedulesMatch[1], reportId, frequency, recipients });
    }

    const scheduleDeleteMatch = url.pathname.match(/^\/tenants\/([^/]+)\/report-schedules\/(\d+)$/);
    if (scheduleDeleteMatch && req.method === 'DELETE') {
      deleteReportSchedule(Number(scheduleDeleteMatch[2]), scheduleDeleteMatch[1]);
      return json(res, 200, { deleted: true });
    }

    const riskRegisterMatch = url.pathname.match(/^\/tenants\/([^/]+)\/risk-register$/);
    if (riskRegisterMatch && req.method === 'GET') {
      return json(res, 200, { entries: listRiskRegister(riskRegisterMatch[1]) });
    }

    const riskRegisterEntryMatch = url.pathname.match(/^\/tenants\/([^/]+)\/risk-register\/([^/]+)$/);
    if (riskRegisterEntryMatch && req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!body.note) return json(res, 400, { error: 'A note is required to acknowledge a risk register entry.' });
      upsertRiskRegisterEntry(riskRegisterEntryMatch[1], decodeURIComponent(riskRegisterEntryMatch[2]), body);
      return json(res, 200, { saved: true });
    }
    if (riskRegisterEntryMatch && req.method === 'DELETE') {
      deleteRiskRegisterEntry(riskRegisterEntryMatch[1], decodeURIComponent(riskRegisterEntryMatch[2]));
      return json(res, 200, { deleted: true });
    }

    json(res, 404, { error: 'Not found', endpoints: ['/health', '/tenants', '/tenants/:id/snapshot', '/tenants/:id/history', '/tenants/:id/delta', '/tenants/:id/app-events', '/combined', '/reports', '/tenants/:id/reports/:reportId/csv', '/tenants/:id/reports/:reportId/send', '/tenants/:id/report-schedules', '/tenants/:id/risk-register'] });
}
