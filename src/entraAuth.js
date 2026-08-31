import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

const DEFAULT_CLIENT_ID = 'ab342dfc-cab4-45f3-acdb-3e49d606f418';
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID || DEFAULT_CLIENT_ID;
const authority = import.meta.env.VITE_ENTRA_AUTHORITY || 'https://login.microsoftonline.com/organizations';

export const AUTH_CONFIGURED = Boolean(clientId);
export const CORE_SCOPES = ['User.Read','User.Read.All','Application.Read.All','Group.Read.All','Device.Read.All','AuditLog.Read.All'];
export const SECURITY_SCOPES = ['IdentityRiskyUser.Read.All','RoleManagement.Read.Directory','Policy.Read.All'];
export const GRAPH_SCOPES = CORE_SCOPES;

let msalInstance;
let initPromise;
let redirectResult;

function getMsal(){
  if(!AUTH_CONFIGURED) return null;
  if(!msalInstance) msalInstance=new PublicClientApplication({auth:{clientId,authority,redirectUri:window.location.origin,postLogoutRedirectUri:window.location.origin},cache:{cacheLocation:'sessionStorage',storeAuthStateInCookie:false}});
  if(!initPromise) initPromise=msalInstance.initialize();
  return msalInstance;
}

export async function initializeAuth(){const instance=getMsal();if(!instance)return null;await initPromise;redirectResult=await instance.handleRedirectPromise();if(redirectResult?.account)instance.setActiveAccount(redirectResult.account);const accounts=instance.getAllAccounts();if(accounts.length&&!instance.getActiveAccount())instance.setActiveAccount(accounts[0]);return instance.getActiveAccount()||accounts[0]||null;}
export function getRedirectResult(){return redirectResult;}
export async function signIn(){const instance=getMsal();if(!instance)throw new Error('Microsoft Entra authentication is not configured.');await initPromise;await instance.loginRedirect({scopes:['User.Read'],redirectStartPage:window.location.href});}

async function acquireToken(scopes,allowRedirect=true){const instance=getMsal();if(!instance)throw new Error('Microsoft Entra authentication is not configured.');await initPromise;const account=instance.getActiveAccount()||instance.getAllAccounts()[0];if(!account)throw new Error('Sign in before connecting a tenant.');try{return await instance.acquireTokenSilent({account,scopes});}catch(error){if(error instanceof InteractionRequiredAuthError&&allowRedirect){await instance.acquireTokenRedirect({account,scopes,redirectStartPage:window.location.href});return null;}throw error;}}
export async function connectTenant(){const result=await acquireToken(CORE_SCOPES,true);return result?{account:result.account,accessToken:result.accessToken,scopes:result.scopes}:null;}
export async function connectSecurityScopes(){const result=await acquireToken(SECURITY_SCOPES,true);return result?{account:result.account,accessToken:result.accessToken,scopes:result.scopes}:null;}
export async function getGraphToken(scopes=CORE_SCOPES,allowRedirect=true){const result=await acquireToken(scopes,allowRedirect);return result?.accessToken||null;}

export async function graphGet(path,scopes=CORE_SCOPES,version='v1.0',allowRedirect=true){const token=await getGraphToken(scopes,allowRedirect);if(!token)throw new Error('Microsoft authentication redirect in progress.');const response=await fetch(`https://graph.microsoft.com/${version}${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json',ConsistencyLevel:'eventual'}});if(!response.ok){const body=await response.text();const error=new Error(`Microsoft Graph ${response.status}: ${body}`);error.status=response.status;throw error;}return response.json();}
export async function graphGetOptional(path,scopes,version='v1.0'){try{return{ok:true,data:await graphGet(path,scopes,version,false)};}catch(error){return{ok:false,error};}}

async function dailySignIns(days=7){const now=new Date();const requests=[];for(let i=days-1;i>=0;i--){const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-i);const end=new Date(start);end.setDate(end.getDate()+1);const filter=`createdDateTime ge ${start.toISOString()} and createdDateTime lt ${end.toISOString()}`;requests.push(graphGet(`/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(filter)}`,CORE_SCOPES));}const results=await Promise.allSettled(requests);return results.map((r,i)=>{const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-(days-1-i));return{date:d.toISOString().slice(0,10),total:r.status==='fulfilled'?Number(r.value['@odata.count']||0):null};});}
function lastActivity(item){const values=[item.lastSignInActivity?.lastSignInDateTime,item.applicationAuthenticationClientSignInActivity?.lastSignInDateTime,item.applicationAuthenticationResourceSignInActivity?.lastSignInDateTime,item.delegatedClientSignInActivity?.lastSignInDateTime,item.delegatedResourceSignInActivity?.lastSignInDateTime].filter(Boolean).map(x=>new Date(x).getTime());return values.length?Math.max(...values):0;}
function bucketAppActivity(items){const now=Date.now();const cutoff=d=>now-d*86400000;const buckets={active30:0,inactive31to90:0,inactive91to180:0,inactive180:0};const inactiveApps=[];for(const item of items){const ts=lastActivity(item);const name=item.displayName||item.appDisplayName||item.appId||'Unnamed application';if(!ts||ts<cutoff(180)){buckets.inactive180++;inactiveApps.push({name,days:ts?Math.floor((now-ts)/86400000):null});}else if(ts<cutoff(90)){buckets.inactive91to180++;inactiveApps.push({name,days:Math.floor((now-ts)/86400000)});}else if(ts<cutoff(30)){buckets.inactive31to90++;inactiveApps.push({name,days:Math.floor((now-ts)/86400000)});}else buckets.active30++;}inactiveApps.sort((a,b)=>(b.days??99999)-(a.days??99999));return{buckets,inactiveApps:inactiveApps.slice(0,8)};}

export async function getTenantSnapshot(){
  const collectedAt=new Date().toISOString();
  const sevenDaysAgo=new Date(Date.now()-7*86400000).toISOString();
  const permissions=CORE_SCOPES.map(name=>({name,status:'granted',detail:'Requested by core dashboard token'}));
  const core=await Promise.allSettled([
    graphGet('/organization?$select=id,displayName,verifiedDomains'),
    graphGet('/applications?$count=true&$top=1'),graphGet('/users?$count=true&$top=1'),graphGet('/groups?$count=true&$top=1'),graphGet('/devices?$count=true&$top=1'),
    graphGet(`/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo}`)}`),
    graphGet(`/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo} and riskLevelAggregated ne 'none'`)}`),
    graphGet('/auditLogs/signIns?$top=8&$orderby=createdDateTime desc'),
    graphGet('/reports/authenticationMethods/userRegistrationDetails?$top=999'),
    graphGet('/users?$top=500&$select=id,displayName,userPrincipalName,userType,accountEnabled,createdDateTime,signInActivity&$expand=manager($select=id,displayName,userPrincipalName)')
  ]);
  const val=(i,f)=>core[i]?.status==='fulfilled'?core[i].value:f;
  const org=val(0,{value:[]})?.value?.[0]||{};const applications=val(1,{})?.['@odata.count']??0;const users=val(2,{})?.['@odata.count']??0;const groups=val(3,{})?.['@odata.count']??0;const devices=val(4,{})?.['@odata.count']??0;const signIns7d=val(5,{})?.['@odata.count']??0;const riskySignIns7d=val(6,{})?.['@odata.count']??0;const recentSignIns=val(7,{})?.value||[];const registration=val(8,{})?.value||[];const userRecords=val(9,{})?.value||[];
  const activityResult=await graphGetOptional('/reports/servicePrincipalSignInActivities?$top=999',CORE_SCOPES,'beta');
  const appActivity=activityResult.ok?bucketAppActivity(activityResult.data.value||[]):{buckets:{active30:0,inactive31to90:0,inactive91to180:0,inactive180:0},inactiveApps:[]};
  const mfaRegistered=registration.filter(u=>u.isMfaRegistered).length;const mfaMissing=registration.length?registration.filter(u=>!u.isMfaRegistered).length:null;const staleCutoff=Date.now()-90*86400000;
  const staleUsers=userRecords.filter(u=>{if(u.accountEnabled===false)return false;const ts=u.signInActivity?.lastSignInDateTime?new Date(u.signInActivity.lastSignInDateTime).getTime():0;return !ts||ts<staleCutoff;}).length;
  const usersWithoutManager=userRecords.filter(u=>u.accountEnabled!==false&&!u.manager).length;
  const securityRisk=await graphGetOptional('/identityProtection/riskyUsers?$top=999',SECURITY_SCOPES);const roleAssignments=await graphGetOptional('/roleManagement/directory/roleAssignments?$top=999',SECURITY_SCOPES);const roleDefinitions=await graphGetOptional('/roleManagement/directory/roleDefinitions?$top=999&$filter=isBuiltIn eq true',SECURITY_SCOPES);const conditionalAccess=await graphGetOptional('/identity/conditionalAccess/policies?$top=999',SECURITY_SCOPES);
  const riskyUsers=securityRisk.ok?(securityRisk.data.value||[]):[];const assignments=roleAssignments.ok?(roleAssignments.data.value||[]):[];const definitions=roleDefinitions.ok?(roleDefinitions.data.value||[]):[];const privilegedRoleIds=new Set(definitions.filter(r=>/administrator|global reader|security reader|privileged role/i.test(r.displayName||'')).map(r=>r.id));const privilegedUsers=new Set(assignments.filter(a=>privilegedRoleIds.has(a.roleDefinitionId)).map(a=>a.principalId)).size;
  permissions.push({name:'IdentityRiskyUser.Read.All',status:securityRisk.ok?'granted':'missing',detail:securityRisk.ok?'Validated by live Graph request':String(securityRisk.error?.message||'Consent or role required')});permissions.push({name:'RoleManagement.Read.Directory',status:roleAssignments.ok?'granted':'missing',detail:roleAssignments.ok?'Validated by live Graph request':String(roleAssignments.error?.message||'Consent or role required')});permissions.push({name:'Policy.Read.All',status:conditionalAccess.ok?'granted':'missing',detail:conditionalAccess.ok?'Validated by live Graph request':String(conditionalAccess.error?.message||'Consent or role required')});
  const signInTrend=await dailySignIns(7);const failed=await graphGetOptional(`/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo} and status/errorCode ne 0`)}`,CORE_SCOPES);
  const healthInputs={mfaCoverage:registration.length?mfaRegistered/registration.length:null,riskyUserRate:users?riskyUsers.length/users:null,inactiveAppRate:applications?(appActivity.buckets.inactive91to180+appActivity.buckets.inactive180)/applications:null,staleUserRate:users?staleUsers/users:null};const scores=[];if(healthInputs.mfaCoverage!=null)scores.push(healthInputs.mfaCoverage*100);if(healthInputs.riskyUserRate!=null)scores.push(Math.max(0,100-healthInputs.riskyUserRate*1000));if(healthInputs.inactiveAppRate!=null)scores.push(Math.max(0,100-healthInputs.inactiveAppRate*100));if(healthInputs.staleUserRate!=null)scores.push(Math.max(0,100-healthInputs.staleUserRate*100));const healthScore=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
  return {source:'entra',organization:{id:org.id||'',displayName:org.displayName||'',verifiedDomains:org.verifiedDomains||[]},applications,users,groups,devices,signIns7d,riskySignIns7d,appActivity:appActivity.buckets,inactiveApps:appActivity.inactiveApps,recentSignIns,signInTrend,failedSignIns7d:failed.ok?Number(failed.data['@odata.count']||0):null,mfa:{registered:mfaRegistered,missing:mfaMissing,observed:registration.length},staleUsers,usersWithoutManager,riskyUsers:riskyUsers.length,privilegedUsers,conditionalAccessPolicies:conditionalAccess.ok?(conditionalAccess.data.value||[]).length:null,healthScore,healthInputs,permissions,securityPermissionReady:securityRisk.ok&&roleAssignments.ok&&conditionalAccess.ok,collectedAt,coreQueryFailures:core.map((r,i)=>r.status==='rejected'?{index:i,error:String(r.reason?.message||r.reason)}:null).filter(Boolean)};
}

export async function signOut(){const instance=getMsal();if(!instance)return;await initPromise;sessionStorage.removeItem('iam_tenant_connected');sessionStorage.removeItem('iam_tenant_id');sessionStorage.removeItem('iam_connect_pending');await instance.logoutRedirect({postLogoutRedirectUri:window.location.origin});}
