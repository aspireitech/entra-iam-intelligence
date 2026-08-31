import { collectTenant } from './graph.js';
import { saveSnapshot } from './store.js';

export function startScheduler(config) {
  const run = async () => {
    for (const tenant of config.tenants) {
      try {
        const snapshot = await collectTenant(tenant, config);
        saveSnapshot(tenant.id, snapshot);
        const failures = snapshot.permissionFailures.length;
        console.log(`[collector] ${snapshot.displayName} collected at ${snapshot.collectedAt}${failures ? ` (${failures} query failures - see permissionFailures)` : ''}`);
      } catch (error) {
        console.error(`[collector] ${tenant.displayName || tenant.id} collection failed:`, error.message);
      }
    }
  };
  run();
  // Multi-tenant collection multiplies Graph calls per tenant, so this floor is higher
  // than the single-tenant SPA's 30s floor to reduce throttling risk across tenants.
  const intervalMs = Math.max(300, Number(config.intervalSeconds) || 900) * 1000;
  return setInterval(run, intervalMs);
}
