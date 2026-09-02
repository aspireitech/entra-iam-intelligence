import { getTenantSnapshot } from './entraAuth.js';

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
export async function syncLiveTenantData(){
  const snapshot=await getTenantSnapshot();
  window.__IAM_SNAPSHOT__=snapshot;
  try{sessionStorage.setItem(CACHE_KEY,JSON.stringify(summarize(snapshot)));}catch{/* ignore quota/private-mode errors - cache is a convenience, not a requirement */}
  document.dispatchEvent(new CustomEvent('iam-live-data',{detail:snapshot}));
  return snapshot;
}
