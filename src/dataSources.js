import { signOut } from './entraAuth.js';

export const DATA_SOURCES = [
  { id: 'entra', name: 'Microsoft Entra ID', type: 'Cloud identity', live: true, capabilities: ['users','groups','applications','devices','signins','risk','mfa','roles','conditionalAccess'] },
  { id: 'ad', name: 'Active Directory', type: 'On-premises directory', live: false, capabilities: ['users','groups','computers','domainControllers','gpo','staleAccounts','privilegedGroups'] },
  { id: 'm365', name: 'Microsoft 365', type: 'Cloud productivity', live: false, capabilities: ['mail','sharepoint','teams','licenses','activity'] },
  { id: 'servicenow', name: 'ServiceNow', type: 'ITSM / CMDB', live: false, capabilities: ['incidents','requests','cmdb','identityTickets'] },
  { id: 'splunk', name: 'Splunk', type: 'Security analytics', live: false, capabilities: ['events','detections','risk','search'] },
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
