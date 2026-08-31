import { signOut } from './entraAuth.js';

export const DATA_SOURCES = [
  { id: 'entra', name: 'Microsoft Entra ID', type: 'Cloud identity', live: true, capabilities: ['users','groups','applications','devices','signins','risk','mfa','roles','conditionalAccess'] },
  { id: 'ad', name: 'Active Directory', type: 'On-premises directory', live: false, capabilities: ['users','groups','computers','domainControllers','gpo','staleAccounts','privilegedGroups'] },
  { id: 'combined', name: 'All Identity Sources', type: 'Aggregated multi-tenant', live: false, capabilities: ['users','applications','groups','devices','risk','roles','licenses','credentialExpiry'] },
  { id: 'sailpoint', name: 'SailPoint', type: 'Identity governance', live: false, capabilities: ['identities','accessProfiles','roles','entitlements'] },
  { id: 'saviynt', name: 'Saviynt', type: 'Identity governance', live: false, capabilities: ['identities','roles','entitlements'] },
];

export function getActiveSource(){ return sessionStorage.getItem('iam_active_source') || 'entra'; }
export function setActiveSource(id){ sessionStorage.setItem('iam_active_source',id); window.dispatchEvent(new CustomEvent('iam-source-changed',{detail:{source:id}})); }
export function sourceById(id){ return DATA_SOURCES.find(s=>s.id===id) || DATA_SOURCES[0]; }
export function clearTenantSession(){ sessionStorage.removeItem('iam_active_source'); sessionStorage.removeItem('iam_tenant_connected'); sessionStorage.removeItem('iam_tenant_id'); sessionStorage.removeItem('iam_connect_pending'); }
export { signOut };

export async function checkAdAgent(){
  const base=(import.meta.env.VITE_AD_AGENT_URL||'').replace(/\/$/,'');
  if(!base) return {configured:false,connected:false,detail:'Set VITE_AD_AGENT_URL to connect an AD Intelligence Agent.'};
  try{
    const response=await fetch(`${base}/health`,{headers:{'Accept':'application/json'}});
    if(!response.ok) throw new Error(`Agent returned HTTP ${response.status}`);
    const data=await response.json();
    return {configured:true,connected:true,detail:data.version?`Agent ${data.version}`:'Agent online',data};
  }catch(error){return {configured:true,connected:false,detail:error.message||'AD agent unavailable'};}
}

export async function getAdSnapshot(){
  const base=(import.meta.env.VITE_AD_AGENT_URL||'').replace(/\/$/,'');
  if(!base) throw new Error('Active Directory agent is not configured. Set VITE_AD_AGENT_URL.');
  const token=import.meta.env.VITE_AD_AGENT_TOKEN||'';
  const response=await fetch(`${base}/snapshot`,{headers:{'Accept':'application/json','X-IAM-Agent-Token':token}});
  if(!response.ok) throw new Error(`AD agent returned HTTP ${response.status}`);
  return response.json();
}

export async function checkCollector(){
  const base=(import.meta.env.VITE_COLLECTOR_URL||'').replace(/\/$/,'');
  if(!base) return {configured:false,connected:false,detail:'Set VITE_COLLECTOR_URL to connect the multi-tenant collector.'};
  try{
    const response=await fetch(`${base}/health`,{headers:{'Accept':'application/json','X-IAM-Collector-Token':import.meta.env.VITE_COLLECTOR_TOKEN||''}});
    if(!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
    const data=await response.json();
    return {configured:true,connected:true,detail:`${data.tenantCount} tenant(s) configured`,data};
  }catch(error){return {configured:true,connected:false,detail:error.message||'Collector unavailable'};}
}

export async function getCombinedSnapshot(){
  const base=(import.meta.env.VITE_COLLECTOR_URL||'').replace(/\/$/,'');
  if(!base) throw new Error('The collector is not configured. Set VITE_COLLECTOR_URL.');
  const token=import.meta.env.VITE_COLLECTOR_TOKEN||'';
  const response=await fetch(`${base}/combined`,{headers:{'Accept':'application/json','X-IAM-Collector-Token':token}});
  if(!response.ok) throw new Error(`Collector returned HTTP ${response.status}`);
  return response.json();
}

function collectorBase(){return (import.meta.env.VITE_COLLECTOR_URL||'').replace(/\/$/,'');}
async function collectorGet(path){
  const base=collectorBase();
  if(!base) return {ok:false,reason:'Collector not configured (set VITE_COLLECTOR_URL) - no history without it.'};
  try{
    const response=await fetch(`${base}${path}`,{headers:{'Accept':'application/json','X-IAM-Collector-Token':import.meta.env.VITE_COLLECTOR_TOKEN||''}});
    if(!response.ok) return {ok:false,reason:`Collector returned HTTP ${response.status}`};
    return {ok:true,data:await response.json()};
  }catch(error){return {ok:false,reason:error.message||'Collector unreachable'};}
}
// These read this tenant's own history from the collector - only meaningful if the
// collector is configured to track this same tenant ID. If it isn't (or isn't
// running), callers get an explicit reason, never a fabricated trend.
export const getTenantDelta=(tenantId,days=30)=>collectorGet(`/tenants/${encodeURIComponent(tenantId)}/delta?days=${days}`);
export const getTenantHistory=(tenantId,days=30)=>collectorGet(`/tenants/${encodeURIComponent(tenantId)}/history?days=${days}`);
export const getAppEvents=(tenantId,days=30)=>collectorGet(`/tenants/${encodeURIComponent(tenantId)}/app-events?days=${days}`);
