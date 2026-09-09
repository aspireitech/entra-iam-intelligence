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

// --- Full-snapshot local cache (stale-while-revalidate + break-glass local login) ---
// Unlike the tiny summary above, this persists a whole usable snapshot (list fields
// capped, not dropped) to localStorage - not sessionStorage - so it survives across
// browser restarts, not just page reloads in the same tab. Two things read it:
//  1. App() hydrates its initial `data` from this on every boot, before the live
//     sync resolves, so Groups/Devices/Applications/Reports etc. show real (if a
//     few minutes/hours stale) content immediately instead of a blank "Collecting
//     live data..." screen - which is what made the dashboard look empty for ~30s
//     on a slow/different network.
//  2. Local login mode (src/localLogin.js) reads the same cache as its entire data
//     source, for when Microsoft sign-in itself isn't working.
const LOCAL_SNAPSHOT_PREFIX='iam_local_snapshot_';
const LAST_TENANT_KEY='iam_last_tenant_id';
const LIST_CAP=300;
function capList(arr){return Array.isArray(arr)?arr.slice(0,LIST_CAP):arr;}
// A full snapshot from a large tenant (30k+ users, 17k+ apps) can run several MB -
// too big to safely assume it fits alongside everything else in localStorage's
// ~5-10MB per-origin quota. Capping each list field keeps the cached fallback
// representative (still hundreds of real rows per page) without risking a
// QuotaExceededError silently losing the whole cache. Counts/availability flags
// (data.users, data.groups, KPI numbers, etc.) are never capped - only list bodies.
function capForLocalCache(snapshot){
  return {
    ...snapshot,
    userActivityList:capList(snapshot.userActivityList),
    staleUserList:capList(snapshot.staleUserList),
    usersWithoutManagerList:capList(snapshot.usersWithoutManagerList),
    groupList:capList(snapshot.groupList),
    deviceList:capList(snapshot.deviceList),
    applicationList:capList(snapshot.applicationList),
    appDetails:capList(snapshot.appDetails),
    inactiveApps:capList(snapshot.inactiveApps),
    recentSignIns:capList(snapshot.recentSignIns),
    riskyUserList:capList(snapshot.riskyUserList),
    toxicCombinations:capList(snapshot.toxicCombinations),
    conditionalAccessPolicyList:capList(snapshot.conditionalAccessPolicyList),
    mfa:snapshot.mfa?{...snapshot.mfa,missingUsers:capList(snapshot.mfa.missingUsers)}:snapshot.mfa,
    guests:snapshot.guests?{...snapshot.guests,list:capList(snapshot.guests.list)}:snapshot.guests,
    legacyAuth:snapshot.legacyAuth?{...snapshot.legacyAuth,sample:capList(snapshot.legacyAuth.sample)}:snapshot.legacyAuth,
    nonHumanIdentities:snapshot.nonHumanIdentities?{...snapshot.nonHumanIdentities,ownerlessApps:capList(snapshot.nonHumanIdentities.ownerlessApps)}:snapshot.nonHumanIdentities,
    privilegedAccess:snapshot.privilegedAccess?{...snapshot.privilegedAccess,eligibleNotActive:capList(snapshot.privilegedAccess.eligibleNotActive),activeNotEligible:capList(snapshot.privilegedAccess.activeNotEligible),activeList:capList(snapshot.privilegedAccess.activeList),eligibleList:capList(snapshot.privilegedAccess.eligibleList)}:snapshot.privilegedAccess,
  };
}
function localCacheKey(tenantId){return `${LOCAL_SNAPSHOT_PREFIX}${tenantId}`;}
function saveLocalSnapshot(snapshot){
  const tenantId=snapshot.organization?.id;
  if(!tenantId)return;
  try{
    localStorage.setItem(localCacheKey(tenantId),JSON.stringify({snapshot:capForLocalCache(snapshot),savedAt:new Date().toISOString()}));
    localStorage.setItem(LAST_TENANT_KEY,tenantId);
  }catch{
    // Quota exceeded or storage blocked (private mode) - this cache is a fallback
    // convenience; the live dashboard already works fine without it.
  }
}
// tenantId omitted falls back to whichever tenant last saved successfully on this
// device - the only option local login has, since it never signs in and so never
// gets a tenant ID of its own.
export function getLocalSnapshot(tenantId){
  try{
    const id=tenantId||localStorage.getItem(LAST_TENANT_KEY);
    if(!id)return null;
    const raw=localStorage.getItem(localCacheKey(id));
    return raw?JSON.parse(raw):null;
  }catch{return null;}
}

function cacheAndBroadcast(snapshot){
  window.__IAM_SNAPSHOT__=snapshot;
  try{sessionStorage.setItem(CACHE_KEY,JSON.stringify(summarize(snapshot)));}catch{/* ignore quota/private-mode errors - cache is a convenience, not a requirement */}
  saveLocalSnapshot(snapshot);
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
