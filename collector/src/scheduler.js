import { collectTenant, fetchAppCreationEvents } from './graph.js';
import { saveSnapshot } from './store.js';
import { appendSnapshot, upsertAppEvents } from './db.js';

export function startScheduler(config) {
  const run = async () => {
    for (const tenant of config.tenants) {
      try {
        const snapshot = await collectTenant(tenant, config);
        saveSnapshot(tenant.id, snapshot);
        appendSnapshot(tenant.id, snapshot);
        const failures = snapshot.permissionFailures.length;
        console.log(`[collector] ${snapshot.displayName} collected at ${snapshot.collectedAt}${failures ? ` (${failures} query failures - see permissionFailures)` : ''}`);
      } catch (error) {
        console.error(`[collector] ${tenant.displayName || tenant.id} collection failed:`, error.message);
      }
      try {
        // Look back 2x the poll interval so a slow cycle or a missed run doesn't
        // leave a gap - INSERT OR IGNORE on audit_id makes re-fetching the same
        // window harmless.
        const lookbackMs = Math.max(600, Number(config.intervalSeconds) || 900) * 2 * 1000;
        const since = new Date(Date.now() - lookbackMs).toISOString();
        const result = await fetchAppCreationEvents(tenant, config, since);
        if (result.ok && result.events.length) upsertAppEvents(tenant.id, result.events);
      } catch (error) {
        console.error(`[collector] ${tenant.displayName || tenant.id} app-event fetch failed:`, error.message);
      }
    }
  };
  run();
  // Multi-tenant collection multiplies Graph calls per tenant, so this floor is higher
  // than the single-tenant SPA's 30s floor to reduce throttling risk across tenants.
  const intervalMs = Math.max(300, Number(config.intervalSeconds) || 900) * 1000;
  return setInterval(run, intervalMs);
}
