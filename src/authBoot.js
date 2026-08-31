import { initializeAuth, signIn, connectTenant, getRedirectResult, AUTH_CONFIGURED } from './entraAuth.js';
import { syncLiveTenantData } from './liveTenantData.js';
import './authBoot.css';

const root = document.getElementById('root');
const gate = document.createElement('div');
gate.id = 'iam-auth-gate';
document.body.appendChild(gate);

function render(html) {
  gate.innerHTML = `<div class="auth-shell"><section class="auth-visual"><div class="auth-brand"><div class="auth-brand-mark"><span>◆</span></div><div><div class="auth-brand-name">IAM Intelligence</div><div class="auth-brand-tag">Identity security. Simplified.</div></div></div><h1>See your identity environment clearly.</h1><p>Connect Microsoft Entra to turn identity telemetry into actionable security intelligence — with least privilege and human approval built in.</p><div class="auth-features"><div class="auth-feature"><b>Live Entra telemetry</b>Users, apps, groups, devices and sign-ins.</div><div class="auth-feature"><b>Risk intelligence</b>Surface identity signals that need attention.</div><div class="auth-feature"><b>Governance</b>Application and access hygiene insights.</div><div class="auth-feature"><b>Read-only first</b>No destructive action without approval.</div></div></section><section class="auth-panel"><div class="auth-content">${html}</div></section></div>`;
  gate.style.display = 'grid';
  if (root) root.style.visibility = 'hidden';
}
function release() { gate.style.display = 'none'; if (root) root.style.visibility = 'visible'; document.title = 'IAM Intelligence'; replaceBranding(); }
function replaceBranding() { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode); nodes.forEach(n=>{if(n.nodeValue?.includes('Entra IAM Intelligence')) n.nodeValue=n.nodeValue.replaceAll('Entra IAM Intelligence','IAM Intelligence');}); }
async function loadDashboard(account) { release(); window.dispatchEvent(new CustomEvent('iam-authenticated',{detail:{account}})); await new Promise(resolve=>setTimeout(resolve,0)); try { await syncLiveTenantData(); } catch(error) { console.error('IAM live Graph sync failed:',error); const live=document.querySelector('.live-row'); if(live) live.insertAdjacentText('beforeend',' • Live sync unavailable'); } }
async function handleConnect(){ const button=document.getElementById('iam-connect'); if(button){button.disabled=true;button.textContent='Connecting…';} try{const result=await connectTenant(); if(result?.accessToken){sessionStorage.setItem('iam_tenant_connected','true');sessionStorage.setItem('iam_tenant_id',result.account?.tenantId||'');sessionStorage.removeItem('iam_connect_pending');await loadDashboard(result.account);}}catch(error){renderError(error);} }
function renderError(error){ render(`<div class="auth-card error-card"><div class="auth-kicker">CONNECTION ERROR</div><h2>Connection could not be completed</h2><p>${escapeHtml(error?.message||'Microsoft authentication failed.')}</p><div class="auth-error">Check that the App Registration is multitenant, the SPA redirect URI matches this site, and the signed-in administrator has the required Microsoft Entra role for audit-log access.</div><button class="auth-primary" id="iam-retry">Try again</button></div>`); document.getElementById('iam-retry')?.addEventListener('click',bootstrap); }
function renderConnect(account,kicker='SIGNED IN'){ render(`<div class="auth-card"><div class="auth-kicker">${kicker}</div><h2>Connect Microsoft Entra</h2><p>Signed in as <b>${escapeHtml(account.username||account.name||'Microsoft account')}</b>. Connect a tenant to enable live, read-only identity monitoring.</p><div class="permission-list"><div>✓ Applications</div><div>✓ Users</div><div>✓ Groups</div><div>✓ Devices</div><div>✓ Sign-in activity</div><div>✓ Audit activity</div></div><button class="auth-primary" id="iam-connect">Connect Microsoft Entra</button><div class="auth-foot">Read-only monitoring • Existing admin consent is reused silently</div></div>`); document.getElementById('iam-connect')?.addEventListener('click',handleConnect); }
async function bootstrap(){
  if(!AUTH_CONFIGURED){render(`<div class="auth-card"><div class="auth-kicker">IAM INTELLIGENCE</div><h2>Configuration required</h2><p>The Microsoft Entra application client ID is not configured.</p><div class="auth-error">Expected VITE_ENTRA_CLIENT_ID for the IAM Intelligence multitenant SPA.</div></div>`);return;}
  try{
    const account=await initializeAuth();
    const redirectResult=getRedirectResult();
    const pendingConnect=sessionStorage.getItem('iam_connect_pending')==='true';
    const connected=sessionStorage.getItem('iam_tenant_connected')==='true';

    // After the initial Microsoft sign-in, immediately try to reuse existing admin
    // consent. If consent is missing, connectTenant() starts the one-time interactive
    // consent flow. This keeps the normal experience: sign in -> dashboard.
    if(account && (pendingConnect || redirectResult?.account) && !connected){
      try{
        const result=await connectTenant();
        if(result?.accessToken){
          sessionStorage.setItem('iam_tenant_connected','true');
          sessionStorage.setItem('iam_tenant_id',result.account?.tenantId||account.tenantId||'');
          sessionStorage.removeItem('iam_connect_pending');
          await loadDashboard(result.account||account);
          return;
        }
        return;
      }catch(error){
        sessionStorage.removeItem('iam_connect_pending');
        renderError(error);
        return;
      }
    }

    if(!account){
      render(`<div class="auth-card"><div class="auth-kicker">WELCOME</div><h2>Sign in to IAM Intelligence</h2><p>Use your Microsoft account to access your workspace. Tenant data is only accessed after you explicitly connect an Entra tenant.</p><button class="auth-primary" id="iam-login">Sign in with Microsoft</button><div class="auth-foot">Least privilege • Read-only monitoring • Human approval for actions</div></div>`);
      document.getElementById('iam-login')?.addEventListener('click',async()=>{try{await signIn();}catch(error){renderError(error);}});
      return;
    }

    if(!connected){renderConnect(account,'WELCOME BACK');return;}
    await loadDashboard(account);
  }catch(error){renderError(error);}
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
bootstrap();
