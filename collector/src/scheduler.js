import { collectTenant, fetchAppCreationEvents } from './graph.js';
import { saveSnapshot } from './store.js';
import { appendSnapshot, upsertAppEvents } from './db.js';

export function startScheduler(config) {
  // Guards against a slow cycle overlapping the next scheduled one. setInterval
  // fires on a fixed clock regardless of whether the previous run() is still
  // in flight - for many tenants, or one very large tenant whose full
  // pagination takes a while, a cycle can legitimately run longer than
  // intervalSeconds. Without this guard, that means two collection passes for
  // the same tenant(s) running concurrently: double the simultaneous Graph
  // calls, which undermines the exact throttling protection intervalSeconds
  // exists to provide. Skipping (not queuing) an overlapping tick is correct
  // here - the next tick after this one finishes will pick up any tenant this
  // one is still working through.
  let running = false;
  const run = async () => {
    if (running) {
      console.log('[collector] Previous collection cycle still running - skipping this tick rather than overlapping it.');
      return;
    }
    running = true;
    try {
      await runOnce(config);
    } finally {
      running = false;
    }
  };
  run();
  // Multi-tenant collection multiplies Graph calls per tenant, so this floor is higher
  // than the single-tenant SPA's 30s floor to reduce throttling risk across tenants.
  const intervalMs = Math.max(300, Number(config.intervalSeconds) || 900) * 1000;
  return setInterval(run, intervalMs);
}

async function runOnce(config) {
  for (const tenant of config.tenants) {
    try {
      const snapshot = await collectTenant(tenant, config);
      saveSnapshot(tenant.id, snapshot);
      appendSnapshot(tenant.id, snapshot);
      const failures = snapshot.permissionFailures.length;
      console.log(`[collector] ${snapshot.displayName} collected at ${snapshot.collectedAt}${failures ? ` (${failures} query failure${failures === 1 ? '' : 's'})` : ''}`);
      for (const reason of snapshot.permissionFailures) console.log(`[collector]   - ${reason}`);
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
}
