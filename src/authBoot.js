import { initializeAuth, signIn, connectTenant, getTenantSnapshot, AUTH_CONFIGURED } from './entraAuth.js';
import './authBoot.css';

const root = document.getElementById('root');
const gate = document.createElement('div');
gate.id = 'iam-auth-gate';
document.body.appendChild(gate);

const connected = sessionStorage.getItem('iam_tenant_connected') === 'true';

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
  // Keep the initial dashboard usable even if a tenant has no log data yet.
  // The next data-sync layer will replace demo metrics with the normalized snapshot.
  window.dispatchEvent(new CustomEvent('iam-authenticated', { detail: { account } }));
}

async function handleConnect() {
  const button = document.getElementById('iam-connect');
  if (button) { button.disabled = true; button.textContent = 'Connecting…'; }
  try {
    const result = await connectTenant();
    sessionStorage.setItem('iam_tenant_connected', 'true');
    sessionStorage.setItem('iam_tenant_id', result.account?.tenantId || '');
    await loadDashboard(result.account);
  } catch (error) {
    renderError(error);
  }
}

function renderError(error) {
  render(`<div class="auth-card error-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Connection could not be completed</h1><p>${escapeHtml(error?.message || 'Microsoft authentication failed.')}</p><div class="auth-error">Check that the App Registration is multitenant, the SPA redirect URI is <b>http://localhost:5173</b>, and admin consent has been granted.</div><button class="auth-primary" id="iam-retry">Try again</button></div>`);
  document.getElementById('iam-retry')?.addEventListener('click', bootstrap);
}

async function bootstrap() {
  if (!AUTH_CONFIGURED) {
    render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Configuration required</h1><p>The application client ID is not configured. Run the repository bootstrap script, then restart the app.</p><div class="auth-error">Expected VITE_ENTRA_CLIENT_ID for the IAM Intelligence multitenant SPA.</div></div>`);
    return;
  }
  try {
    const account = await initializeAuth();
    if (!account) {
      render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">IAM INTELLIGENCE</div><h1>Identity operations, in one view.</h1><p>Sign in with Microsoft to access your IAM Intelligence workspace. Tenant data is only accessed after you explicitly connect a Microsoft Entra tenant.</p><button class="auth-primary" id="iam-login">Sign in with Microsoft</button><div class="auth-foot">Read-only monitoring • Least privilege • Human approval for actions</div></div>`);
      document.getElementById('iam-login')?.addEventListener('click', async () => {
        try {
          const signedIn = await signIn();
          render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">SIGNED IN</div><h1>Connect Microsoft Entra</h1><p>Signed in as <b>${escapeHtml(signedIn.username || signedIn.name || 'Microsoft account')}</b>. Connect a tenant to enable read-only identity monitoring.</p><div class="permission-list"><div>✓ Applications</div><div>✓ Users</div><div>✓ Groups</div><div>✓ Devices</div><div>✓ Sign-in & audit activity</div></div><button class="auth-primary" id="iam-connect">Connect Microsoft Entra</button><div class="auth-foot">No write or delete permissions are requested.</div></div>`);
          document.getElementById('iam-connect')?.addEventListener('click', handleConnect);
        } catch (error) { renderError(error); }
      });
      return;
    }
    if (!connected) {
      render(`<div class="auth-card"><div class="auth-logo">◆</div><div class="auth-kicker">WELCOME BACK</div><h1>Connect Microsoft Entra</h1><p>Signed in as <b>${escapeHtml(account.username || account.name || 'Microsoft account')}</b>. Your tenant is not connected in this browser session.</p><div class="permission-list"><div>✓ Applications</div><div>✓ Users</div><div>✓ Groups</div><div>✓ Devices</div><div>✓ Sign-in & audit activity</div></div><button class="auth-primary" id="iam-connect">Connect Microsoft Entra</button><div class="auth-foot">Read-only monitoring • Additional capabilities request access only when enabled</div></div>`);
      document.getElementById('iam-connect')?.addEventListener('click', handleConnect);
      return;
    }
    await loadDashboard(account);
  } catch (error) { renderError(error); }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

bootstrap();
