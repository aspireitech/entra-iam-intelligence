import { initializeAuth, signIn, connectTenant, AUTH_CONFIGURED } from './entraAuth.js';
import { syncTenantData } from './liveTenantData.js';
import { isDemoMode, enterDemoMode } from './demoMode.js';
import { buildDemoSnapshot } from './demoData.js';
import './authBoot.css';

const root=document.getElementById('root');
const gate=document.createElement('div');gate.id='iam-auth-gate';document.body.appendChild(gate);
// Every gate screen below includes this same demo link - Entra being unreachable
// (the whole reason someone would need it) can show up as the "sign in" screen
// never getting a token, or as the "connection error" screen, so it isn't only
// offered on the happy-path welcome screen.
const DEMO_LINK='<button class="auth-secondary" id="iam-demo" type="button">View demo dashboard (no Microsoft sign-in)</button>';
function render(html){gate.innerHTML=`<div class="auth-shell"><section class="auth-visual"><div class="auth-brand"><div class="auth-brand-mark"><span>◆</span></div><div><div class="auth-brand-name">IAM Intelligence</div><div class="auth-brand-tag">Identity security. Simplified.</div></div></div><h1>See your identity environment clearly.</h1><p>Connect Microsoft Entra to turn live identity telemetry into actionable security intelligence — with least privilege and human approval built in.</p><div class="auth-features"><div class="auth-feature"><b>Live Entra telemetry</b>Users, apps, groups, devices and sign-ins.</div><div class="auth-feature"><b>Security intelligence</b>Risk, MFA, privileged access and Conditional Access when approved.</div><div class="auth-feature"><b>Source switching</b>Move between Entra ID and a read-only AD agent.</div><div class="auth-feature"><b>Read-only first</b>No destructive action without approval.</div></div></section><section class="auth-panel"><div class="auth-content">${html}</div></section></div>`;gate.style.display='grid';if(root)root.style.visibility='hidden';document.getElementById('iam-demo')?.addEventListener('click',loadDemoSnapshot);}
function release(){gate.style.display='none';if(root)root.style.visibility='visible';document.title='IAM Intelligence';}
// Deliberately never touches MSAL or the network - this is the one path that
// still works when Microsoft Entra itself is down, not configured yet, or the
// signed-in account's consent is broken. Fires the same 'iam-live-data' event
// the real sync path fires, so every page renders through its normal code path
// against fabricated-but-realistic data (see demoData.js) instead of a special
// "demo UI".
function loadDemoSnapshot(){
  enterDemoMode();
  const snapshot=buildDemoSnapshot();
  window.__IAM_SNAPSHOT__=snapshot;
  release();
  document.dispatchEvent(new CustomEvent('iam-live-data',{detail:snapshot}));
}
async function loadDashboard(account){release();window.dispatchEvent(new CustomEvent('iam-authenticated',{detail:{account}}));await new Promise(resolve=>setTimeout(resolve,0));try{await syncTenantData();}catch(error){console.error('IAM tenant data sync failed:',error);const live=document.querySelector('.live-row');if(live)live.insertAdjacentText('beforeend',' • Live sync unavailable');}}
function renderError(error){render(`<div class="auth-card error-card"><div class="auth-kicker">CONNECTION ERROR</div><h2>Connection could not be completed</h2><p>${escapeHtml(error?.message||'Microsoft authentication failed.')}</p><div class="auth-error">Check the multitenant App Registration, SPA redirect URI, and the signed-in administrator's Graph permissions/role. No client secret or certificate is required for this browser-based delegated flow.</div><button class="auth-primary" id="iam-retry">Try again</button>${DEMO_LINK}</div>`);document.getElementById('iam-retry')?.addEventListener('click',bootstrap);}
function renderConnecting(account){render(`<div class="auth-card"><div class="auth-kicker">SIGNED IN</div><h2>Opening your dashboard…</h2><p>Reusing the existing Microsoft Entra consent for <b>${escapeHtml(account.username||account.name||'your account')}</b>. No extra click needed unless a new permission requires approval.</p></div>`);}
async function connectAndLoad(account){try{const result=await connectTenant();if(result?.accessToken){sessionStorage.setItem('iam_tenant_connected','true');sessionStorage.setItem('iam_tenant_id',result.account?.tenantId||account.tenantId||'');await loadDashboard(result.account||account);}}catch(error){renderError(error);}}
async function bootstrap(){
  if(isDemoMode()){loadDemoSnapshot();return;}
  if(!AUTH_CONFIGURED){render(`<div class="auth-card"><div class="auth-kicker">IAM INTELLIGENCE</div><h2>Configuration required</h2><p>The Microsoft Entra application client ID is not configured.</p><div class="auth-error">Expected VITE_ENTRA_CLIENT_ID for the multitenant SPA.</div>${DEMO_LINK}</div>`);return;}
  try{const account=await initializeAuth();if(!account){render(`<div class="auth-card"><div class="auth-kicker">WELCOME</div><h2>Sign in to IAM Intelligence</h2><p>Use your Microsoft work or school account. You will land on the dashboard automatically once signed in — no separate connect step when consent already exists.</p><button class="auth-primary" id="iam-login">Sign in with Microsoft</button><div class="auth-foot">Least privilege • Read-only monitoring • Human approval for actions</div>${DEMO_LINK}</div>`);document.getElementById('iam-login')?.addEventListener('click',async()=>{try{await signIn();}catch(error){renderError(error);}});return;}const connected=sessionStorage.getItem('iam_tenant_connected')==='true';if(connected){await loadDashboard(account);return;}renderConnecting(account);await connectAndLoad(account);}catch(error){renderError(error);}
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
bootstrap();
