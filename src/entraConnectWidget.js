import {
  AUTH_CONFIGURED,
  connectTenant,
  disconnectTenant,
  getTenantSnapshot,
  initializeAuth,
  signIn,
} from './entraAuth.js';

const root = document.createElement('div');
root.id = 'entra-connect-root';
document.body.appendChild(root);

const style = document.createElement('style');
style.textContent = `
#entra-connect-root{position:fixed;right:18px;top:76px;z-index:40;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.eii-connect{display:flex;align-items:center;gap:8px;border:1px solid rgba(91,151,222,.22);background:#0b1b2b;color:#dce9f5;border-radius:8px;padding:7px 10px;box-shadow:0 8px 28px rgba(0,0,0,.28);font-size:10px}
.eii-status{width:7px;height:7px;border-radius:50%;background:#6f8499}.eii-status.on{background:#38c66a;box-shadow:0 0 8px #38c66a}.eii-status.err{background:#ed6262}
.eii-button{border:1px solid rgba(91,151,222,.22);background:#123255;color:#75b5fa;border-radius:6px;padding:6px 9px;font-size:9px;cursor:pointer}.eii-button:hover{background:#18436d}.eii-button.danger{background:#251b22;color:#ee8a8a;border-color:rgba(238,98,98,.15)}
.eii-panel{position:absolute;right:0;top:43px;width:330px;border:1px solid rgba(119,171,225,.2);border-radius:10px;background:#0b1b2b;color:#dce8f2;box-shadow:0 22px 60px rgba(0,0,0,.5);padding:15px;display:none}.eii-panel.open{display:block}.eii-panel h3{margin:0;font-size:13px;font-weight:600}.eii-panel p{font-size:9px;line-height:1.55;color:#8499ac;margin:7px 0 12px}.eii-panel .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(151,187,222,.07);font-size:9px}.eii-panel .row span:last-child{color:#9fc7ed}.eii-message{font-size:9px;line-height:1.5;margin:9px 0;padding:8px;border-radius:6px;background:#081624;color:#91a7bb}.eii-message.error{color:#f18b8b;border:1px solid rgba(238,98,98,.12)}
`;
document.head.appendChild(style);

let connected = false;
let panelOpen = false;
let account = null;
let errorMessage = '';

function fmt(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat().format(value);
}

function render() {
  const signedIn = Boolean(account);
  const stateText = connected ? `Connected · ${account?.name || account?.username || 'Tenant'}` : signedIn ? `Signed in · ${account?.username || 'Microsoft'}` : 'Not signed in';
  const buttonText = connected ? 'Manage' : signedIn ? 'Connect' : AUTH_CONFIGURED ? 'Sign in' : 'Setup';
  root.innerHTML = `
    <div class="eii-connect">
      <span class="eii-status ${connected ? 'on' : (errorMessage ? 'err' : '')}"></span>
      <span>${stateText}</span>
      <button class="eii-button" id="eii-toggle">${buttonText}</button>
      <div class="eii-panel ${panelOpen ? 'open' : ''}" id="eii-panel">
        <h3>Microsoft Entra connection</h3>
        <p>${connected ? 'Read-only monitoring connection. The dashboard is using your tenant data for this connected session.' : signedIn ? 'You are signed in to the application. Connect a tenant only when you want Entra IAM Intelligence to request the monitoring permissions.' : AUTH_CONFIGURED ? 'Step 1: sign in to the application. Step 2: choose Connect Tenant to request the read-only Microsoft Graph permissions.' : 'Authentication is not configured on this machine. Add VITE_ENTRA_CLIENT_ID to .env.local and restart the dev server.'}</p>
        ${connected ? `
          <div class="row"><span>Tenant</span><span>${account?.tenantId || 'Current tenant'}</span></div>
          <div class="row"><span>Signed in as</span><span>${account?.username || '—'}</span></div>
          <div class="row"><span>Applications</span><span id="eii-app-count">Loading…</span></div>
          <div class="row"><span>Users</span><span id="eii-user-count">Loading…</span></div>
          <div class="row"><span>Groups</span><span id="eii-group-count">Loading…</span></div>
          <div class="row"><span>Devices</span><span id="eii-device-count">Loading…</span></div>
          <div class="eii-message">Read-only monitoring. No write or delete permissions are requested by this MVP.</div>
          <button class="eii-button danger" id="eii-disconnect">Disconnect tenant</button>
        ` : signedIn ? `
          <div class="row"><span>Signed in as</span><span>${account?.username || '—'}</span></div>
          <button class="eii-button" id="eii-connect">Connect tenant & request monitoring access</button>
          <button class="eii-button danger" id="eii-signout">Sign out</button>
        ` : `
          <button class="eii-button" id="eii-signin">${AUTH_CONFIGURED ? 'Sign in with Microsoft' : 'Authentication not configured'}</button>
        `}
        ${errorMessage ? `<div class="eii-message error">${escapeHtml(errorMessage)}</div>` : ''}
      </div>
    </div>`;

  document.getElementById('eii-toggle')?.addEventListener('click', () => { panelOpen = !panelOpen; render(); if (connected) loadSnapshot(); });
  document.getElementById('eii-signin')?.addEventListener('click', handleSignIn);
  document.getElementById('eii-connect')?.addEventListener('click', handleConnect);
  document.getElementById('eii-signout')?.addEventListener('click', handleDisconnect);
  document.getElementById('eii-disconnect')?.addEventListener('click', handleDisconnect);
}

function setDashboardValue(index, value) {
  const values = document.querySelectorAll('.kpi-value');
  if (values[index] && value !== null) values[index].textContent = fmt(value);
}

function updateDashboard(snapshot) {
  setDashboardValue(0, snapshot.counts.users);
  setDashboardValue(1, snapshot.counts.applications);
  setDashboardValue(2, snapshot.counts.devices);
  const live = document.querySelector('.live-row');
  if (live && snapshot.tenant) live.innerHTML = `<span class="live-dot"></span> Tenant: <strong>${escapeHtml(snapshot.tenant.displayName || 'Connected tenant')}</strong><span class="separator">•</span> Live Graph connection`;
  const source = document.querySelector('.sources > div:first-child');
  if (source) source.innerHTML = '<span>◆ Microsoft Entra ID</span><small>Connected · Live</small>';
}

async function loadSnapshot() {
  try {
    const snapshot = await getTenantSnapshot();
    updateDashboard(snapshot);
    const map = { applications: 'eii-app-count', users: 'eii-user-count', groups: 'eii-group-count', devices: 'eii-device-count' };
    Object.entries(map).forEach(([key, id]) => { const el = document.getElementById(id); if (el) el.textContent = fmt(snapshot.counts[key]); });
  } catch (error) {
    errorMessage = formatAuthError(error);
    render();
    panelOpen = true;
  }
}

async function handleSignIn() {
  errorMessage = '';
  const button = document.getElementById('eii-signin');
  if (button) { button.disabled = true; button.textContent = 'Signing in…'; }
  try {
    account = await signIn();
    panelOpen = true;
    render();
  } catch (error) {
    errorMessage = formatAuthError(error);
    panelOpen = true;
    render();
  }
}

async function handleConnect() {
  errorMessage = '';
  const button = document.getElementById('eii-connect');
  if (button) { button.disabled = true; button.textContent = 'Requesting access…'; }
  try {
    const result = await connectTenant();
    account = result.account;
    connected = true;
    panelOpen = true;
    render();
    await loadSnapshot();
  } catch (error) {
    errorMessage = formatAuthError(error);
    panelOpen = true;
    render();
  }
}

async function handleDisconnect() {
  try {
    await disconnectTenant();
  } finally {
    connected = false;
    account = null;
    errorMessage = '';
    panelOpen = false;
    render();
  }
}

function formatAuthError(error) {
  const text = String(error?.message || error);
  if (text.includes('AADSTS65001') || text.toLowerCase().includes('consent')) return 'Microsoft Entra admin consent is required for one or more read-only monitoring permissions. An authorized tenant administrator must approve the requested Graph permissions.';
  if (text.includes('AADSTS50011')) return 'Redirect URI mismatch. Add this exact URL to the app registration: ' + window.location.origin;
  if (text.includes('AADSTS700016')) return 'Client ID was not found. Verify VITE_ENTRA_CLIENT_ID in .env.local.';
  return text;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

(async () => {
  try { account = await initializeAuth(); } catch (_) { /* keep demo mode available */ }
  render();
})();
