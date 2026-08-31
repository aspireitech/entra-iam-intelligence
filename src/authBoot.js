import { initializeAuth, signIn, connectTenant, getRedirectResult, AUTH_CONFIGURED } from './entraAuth.js';
import { syncLiveTenantData } from './liveTenantData.js';
import './authBoot.css';

const root = document.getElementById('root');
const gate = document.createElement('div');
gate.id = 'iam-auth-gate';
document.body.appendChild(gate);

function render(html) {
  gate.innerHTML = html;
  gate.style.display = 'grid';
  if (root) root.style.visibility = 'hidden';
}

function release() {
  gate.style.display = 'none';
  if (root) root.style.visibility = 'visible';
  document.title = 'IAM Intelligence';
  replaceBranding();
}

function replaceBranding() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (node.nodeValue?.includes('Entra IAM Intelligence')) {
      node.nodeValue = node.nodeValue.replaceAll('Entra IAM Intelligence', 'IAM Intelligence');
    }
  });
}

async function loadDashboard(account) {
  release();
  try {
    await syncLiveTenantData();
  } catch (error) {
    console.error('IAM live Graph sync failed:', error);
    const live = document.querySelector('.live-row');
    if (live) live.insertAdjacentText('beforeend', ' • Live sync unavailable');
  }
  window.dispatchEvent(new CustomEvent('iam-authenticated', { detail: { account } }));
}

async function handleConnect() {
  const button = document.getElementById('iam-connect');
  if (button) { button.disabled = true; button.textContent = 'Connecting…'; }
  try {
    await connectTenant();
  } catch (error) {
    renderError(error);
  }
}

function renderError(error) {
  render(`<div class="auth-card error-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Connection could not be completed</h1><p>${escapeHtml(error?.message || 'Microsoft authentication failed.')}</p><div class="auth-error">Check that the App Registration is multitenant, the SPA redirect URI is <b>http://localhost:5173</b>, and the signed-in administrator has the required Microsoft Entra role for audit-log access.</div><button class="auth-primary" id="iam-retry">Try again</button></div>`);
  document.getElementById('iam-retry')?.addEventListener('click', bootstrap);
}

function renderConnect(account, kicker = 'SIGNED IN') {
  render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">${kicker}</div><h1>Connect Microsoft Entra</h1><p>Signed in as <b>${escapeHtml(account.username || account.name || 'Microsoft account')}</b>. Connect a tenant to enable read-only identity monitoring.</p><div class="permission-list"><div>✓ Applications</div><div>✓ Users</div><div>✓ Groups</div><div>✓ Devices</div><div>✓ Sign-in & audit activity</div></div><button class="auth-primary" id="iam-connect">Connect Microsoft Entra</button><div class="auth-foot">Read-only monitoring • Additional capabilities request access only when enabled</div></div>`);
  document.getElementById('iam-connect')?.addEventListener('click', handleConnect);
}

async function bootstrap() {
  if (!AUTH_CONFIGURED) {
    render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Configuration required</h1><p>The application client ID is not configured.</p><div class="auth-error">Expected VITE_ENTRA_CLIENT_ID for the IAM Intelligence multitenant SPA.</div></div>`);
    return;
  }
  try {
    const account = await initializeAuth();
    const redirectResult = getRedirectResult();
    const pendingConnect = sessionStorage.getItem('iam_connect_pending') === 'true';

    if (account && pendingConnect && redirectResult?.accessToken) {
      try {
        await syncLiveTenantData();
        sessionStorage.setItem('iam_tenant_connected', 'true');
        sessionStorage.setItem('iam_tenant_id', account.tenantId || '');
        sessionStorage.removeItem('iam_connect_pending');
        await loadDashboard(account);
        return;
      } catch (error) {
        sessionStorage.removeItem('iam_connect_pending');
        renderError(error);
        return;
      }
    }

    const connected = sessionStorage.getItem('iam_tenant_connected') === 'true';
    if (!account) {
      render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Identity operations, in one view.</h1><p>Sign in with Microsoft to access your IAM Intelligence workspace. Tenant data is only accessed after you explicitly connect a Microsoft Entra tenant.</p><button class="auth-primary" id="iam-login">Sign in with Microsoft</button><div class="auth-foot">Read-only monitoring • Least privilege • Human approval for actions</div></div>`);
      document.getElementById('iam-login')?.addEventListener('click', async () => {
        try { await signIn(); } catch (error) { renderError(error); }
      });
      return;
    }

    if (!connected) {
      renderConnect(account, 'WELCOME BACK');
      return;
    }

    await loadDashboard(account);
  } catch (error) { renderError(error); }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

bootstrap();
