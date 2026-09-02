import { getTenantSnapshot } from './entraAuth.js';
import { getTenantSnapshotFromCollector } from './dataSources.js';

const CACHE_KEY='iam_overview_cache';
// Deliberately tiny - counts and availability flags only, never the per-record
// lists (userActivityList, applicationList, deviceList, ...). Those scale with
// tenant size (30k+ users, 17k+ apps in a large org) and would risk blowing
// sessionStorage's ~5-10MB quota; this summary stays well under 1KB regardless
// of tenant size, so it's always safe to cache.
function summarize(snapshot){
  return {
    collectedAt:snapshot.collectedAt,
    organization:{displayName:snapshot.organization?.displayName},
    users:snapshot.users,applications:snapshot.applications,devices:snapshot.devices,groups:snapshot.groups,
    signIns7d:snapshot.signIns7d,riskySignIns7d:snapshot.riskySignIns7d,
    riskyUsers:snapshot.riskyUsers,riskyUsersAvailable:snapshot.riskyUsersAvailable,
    privilegedUsers:snapshot.privilegedUsers,privilegedUsersAvailable:snapshot.privilegedUsersAvailable,
    staleUsers:snapshot.staleUsers,mfaMissing:snapshot.mfa?.missing,
    credentialExpiringSoon:snapshot.credentialExpiry?.expiringSoon,credentialExpiryAvailable:snapshot.credentialExpiry?.available,
    toxicCombinationsCount:snapshot.toxicCombinationsCount,toxicCombinationsAvailable:snapshot.toxicCombinationsAvailable,
    healthScore:snapshot.healthScore,
    ownerlessCount:snapshot.nonHumanIdentities?.ownerlessCount,nonHumanIdentitiesAvailable:snapshot.nonHumanIdentities?.available,
  };
}
export function getCachedOverview(){
  try{const raw=sessionStorage.getItem(CACHE_KEY);return raw?JSON.parse(raw):null;}catch{return null;}
}
function cacheAndBroadcast(snapshot){
  window.__IAM_SNAPSHOT__=snapshot;
  try{sessionStorage.setItem(CACHE_KEY,JSON.stringify(summarize(snapshot)));}catch{/* ignore quota/private-mode errors - cache is a convenience, not a requirement */}
  document.dispatchEvent(new CustomEvent('iam-live-data',{detail:snapshot}));
}
// Direct-Graph fetch - always available (delegated auth only, no collector needed),
// but costly: ~20-40+ Graph requests at large-tenant scale. Used as the fallback when
// no collector is tracking this tenant, and exported for a manual "force live refresh".
export async function syncLiveTenantData(){
  const snapshot=await getTenantSnapshot();
  snapshot.dataSource='live-graph';
  cacheAndBroadcast(snapshot);
  return snapshot;
}
// Prefers the collector's SQLite-backed snapshot (one HTTP call to localhost, no
// Graph traffic) over a live Graph pull, when a collector is configured and already
// tracking this signed-in tenant. Falls back to the direct Graph fetch otherwise -
// the dashboard must never go blank just because the collector isn't running.
export async function syncTenantData(){
  const tenantId=sessionStorage.getItem('iam_tenant_id');
  if(tenantId){
    const result=await getTenantSnapshotFromCollector(tenantId);
    if(result.ok){
      const snapshot={...result.data,dataSource:'collector'};
      cacheAndBroadcast(snapshot);
      return snapshot;
    }
  }
  return syncLiveTenantData();
}
