import { getTenantSnapshot } from './entraAuth.js';

export async function syncLiveTenantData(){
  const snapshot=await getTenantSnapshot();
  window.__IAM_SNAPSHOT__=snapshot;
  document.dispatchEvent(new CustomEvent('iam-live-data',{detail:snapshot}));
  return snapshot;
}
