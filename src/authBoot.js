import { initializeAuth, signIn, connectTenant, AUTH_CONFIGURED } from './entraAuth.js';
import { syncTenantData, getLocalSnapshot } from './liveTenantData.js';
import { isDemoMode, enterDemoMode } from './demoMode.js';
import { buildDemoSnapshot } from './demoData.js';
import { isLocalLoginConfigured, verifyLocalPassword, isLocalLoginMode, enterLocalLoginMode } from './localLogin.js';
import './authBoot.css';

const root=document.getElementById('root');
const gate=document.createElement('div');gate.id='iam-auth-gate';document.body.appendChild(gate);
// Every gate screen below includes these same two links - Entra being unreachable
// (the whole reason someone would need either) can show up as the "sign in" screen
// never getting a token, or as the "connection error" screen, so neither is only
// offered on the happy-path welcome screen. Local login only appears at all when
// an admin has actually configured a password for it (see localLogin.js) - it's
// opt-in, not a default open door.
const DEMO_LINK='<button class="auth-secondary" id="iam-demo" type="button">View demo dashboard (no Microsoft sign-in)</button>';
const LOCAL_LOGIN_LINK=isLocalLoginConfigured()?'<button class="auth-secondary" id="iam-local-login" type="button">Local login (view last saved real data)</button>':'';
function render(html){gate.innerHTML=`<div class="auth-shell"><section class="auth-visual"><div class="auth-brand"><div class="auth-brand-mark"><span>◆</span></div><div><div class="auth-brand-name">IAM Intelligence</div><div class="auth-brand-tag">Identity security. Simplified.</div></div></div><h1>See your identity environment clearly.</h1><p>Connect Microsoft Entra to turn live identity telemetry into actionable security intelligence — with least privilege and human approval built in.</p><div class="auth-features"><div class="auth-feature"><b>Live Entra telemetry</b>Users, apps, groups, devices and sign-ins.</div><div class="auth-feature"><b>Security intelligence</b>Risk, MFA, privileged access and Conditional Access when approved.</div><div class="auth-feature"><b>Source switching</b>Move between Entra ID and a read-only AD agent.</div><div class="auth-feature"><b>Read-only first</b>No destructive action without approval.</div></div></section><section class="auth-panel"><div class="auth-content">${html}</div></section></div>`;gate.style.display='grid';if(root)root.style.visibility='hidden';document.getElementById('iam-demo')?.addEventListener('click',loadDemoSnapshot);document.getElementById('iam-local-login')?.addEventListener('click',renderLocalLoginPrompt);}
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
// Local login's data source is whatever the last successful real sign-in on this
// device saved to localStorage (see liveTenantData.js saveLocalSnapshot) - real
// tenant numbers, just possibly hours/days old, never fabricated. Also never
// touches MSAL or the network, so it works exactly when it needs to: when
// Microsoft sign-in itself isn't working.
function loadLocalSnapshot(){
  const cached=getLocalSnapshot();
  if(!cached){
    render(`<div class="auth-card"><div class="auth-kicker">LOCAL LOGIN</div><h2>No saved snapshot yet</h2><p>This device hasn't completed a real Microsoft sign-in yet, so there's nothing saved locally to show. Sign in normally at least once first - after that, real data is saved automatically on every successful sync, for exactly this situation.</p><button class="auth-primary" id="iam-back">Back to sign-in</button></div>`);
    document.getElementById('iam-back')?.addEventListener('click',bootstrap);
    return;
  }
  enterLocalLoginMode();
  const snapshot={...cached.snapshot,dataSource:'local-cache',cachedAt:cached.savedAt};
  window.__IAM_SNAPSHOT__=snapshot;
  release();
  document.dispatchEvent(new CustomEvent('iam-live-data',{detail:snapshot}));
}
function renderLocalLoginPrompt(){
  render(`<div class="auth-card"><div class="auth-kicker">LOCAL LOGIN</div><h2>View last saved data</h2><p>Enter the local login password to view the most recently saved real snapshot from this device - stale data from the last successful sign-in, not fabricated. Use this when Microsoft sign-in itself isn't working.</p><input type="password" id="iam-local-pass" class="auth-input" placeholder="Local login password" autocomplete="off"/><div class="auth-error" id="iam-local-error" style="display:none"></div><button class="auth-primary" id="iam-local-submit">View saved data</button><button class="auth-secondary" id="iam-local-cancel" type="button">Back to sign-in</button></div>`);
  const passInput=document.getElementById('iam-local-pass');
  passInput?.focus();
  const submit=async()=>{
    const ok=await verifyLocalPassword(passInput?.value||'');
    if(!ok){const err=document.getElementById('iam-local-error');if(err){err.textContent='Incorrect password.';err.style.display='block';}return;}
    loadLocalSnapshot();
  };
  document.getElementById('iam-local-submit')?.addEventListener('click',submit);
  passInput?.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
  document.getElementById('iam-local-cancel')?.addEventListener('click',bootstrap);
}
async function loadDashboard(account){release();window.dispatchEvent(new CustomEvent('iam-authenticated',{detail:{account}}));await new Promise(resolve=>setTimeout(resolve,0));try{await syncTenantData();}catch(error){console.error('IAM tenant data sync failed:',error);const live=document.querySelector('.live-row');if(live)live.insertAdjacentText('beforeend',' • Live sync unavailable');}}
function renderError(error){render(`<div class="auth-card error-card"><div class="auth-kicker">CONNECTION ERROR</div><h2>Connection could not be completed</h2><p>${escapeHtml(error?.message||'Microsoft authentication failed.')}</p><div class="auth-error">Check the multitenant App Registration, SPA redirect URI, and the signed-in administrator's Graph permissions/role. No client secret or certificate is required for this browser-based delegated flow.</div><button class="auth-primary" id="iam-retry">Try again</button>${LOCAL_LOGIN_LINK}${DEMO_LINK}</div>`);document.getElementById('iam-retry')?.addEventListener('click',bootstrap);}
function renderConnecting(account){render(`<div class="auth-card"><div class="auth-kicker">SIGNED IN</div><h2>Opening your dashboard…</h2><p>Reusing the existing Microsoft Entra consent for <b>${escapeHtml(account.username||account.name||'your account')}</b>. No extra click needed unless a new permission requires approval.</p></div>`);}
async function connectAndLoad(account){try{const result=await connectTenant();if(result?.accessToken){sessionStorage.setItem('iam_tenant_connected','true');sessionStorage.setItem('iam_tenant_id',result.account?.tenantId||account.tenantId||'');await loadDashboard(result.account||account);}}catch(error){renderError(error);}}
async function bootstrap(){
  if(isDemoMode()){loadDemoSnapshot();return;}
  if(isLocalLoginMode()){loadLocalSnapshot();return;}
  if(!AUTH_CONFIGURED){render(`<div class="auth-card"><div class="auth-kicker">IAM INTELLIGENCE</div><h2>Configuration required</h2><p>The Microsoft Entra application client ID is not configured.</p><div class="auth-error">Expected VITE_ENTRA_CLIENT_ID for the multitenant SPA.</div>${LOCAL_LOGIN_LINK}${DEMO_LINK}</div>`);return;}
  try{const account=await initializeAuth();if(!account){render(`<div class="auth-card"><div class="auth-kicker">WELCOME</div><h2>Sign in to IAM Intelligence</h2><p>Use your Microsoft work or school account. You will land on the dashboard automatically once signed in — no separate connect step when consent already exists.</p><button class="auth-primary" id="iam-login">Sign in with Microsoft</button><div class="auth-foot">Least privilege • Read-only monitoring • Human approval for actions</div>${LOCAL_LOGIN_LINK}${DEMO_LINK}</div>`);document.getElementById('iam-login')?.addEventListener('click',async()=>{try{await signIn();}catch(error){renderError(error);}});return;}const connected=sessionStorage.getItem('iam_tenant_connected')==='true';if(connected){await loadDashboard(account);return;}renderConnecting(account);await connectAndLoad(account);}catch(error){renderError(error);}
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
bootstrap();
