import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const authority = import.meta.env.VITE_ENTRA_AUTHORITY || 'https://login.microsoftonline.com/organizations';

export const AUTH_CONFIGURED = Boolean(clientId);

// Monitoring MVP: delegated, read-only Graph permissions. No write/delete permissions are requested.
// These are intentionally resource-specific instead of using broad Directory.Read.All.
export const GRAPH_SCOPES = [
  'User.ReadBasic.All',
  'Application.Read.All',
  'Group.Read.All',
  'Device.Read.All',
  'AuditLog.Read.All',
];

// Request this only when the Provisioning view is enabled; it is not part of the initial consent set.
export const OPTIONAL_PROVISIONING_SCOPE = 'ProvisioningLog.Read.All';

let msalInstance;
let initPromise;

function getMsal() {
  if (!AUTH_CONFIGURED) return null;
  if (!msalInstance) {
    msalInstance = new PublicClientApplication({
      auth: {
        clientId,
        authority,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    });
  }
  if (!initPromise) initPromise = msalInstance.initialize();
  return msalInstance;
}

export async function initializeAuth() {
  const instance = getMsal();
  if (!instance) return null;
  await initPromise;
  const accounts = instance.getAllAccounts();
  if (accounts.length && !instance.getActiveAccount()) instance.setActiveAccount(accounts[0]);
  return instance.getActiveAccount() || accounts[0] || null;
}

export async function signIn() {
  const instance = getMsal();
  if (!instance) throw new Error('Microsoft Entra authentication is not configured. Add VITE_ENTRA_CLIENT_ID to .env.local.');
  await initPromise;
  const result = await instance.loginPopup({ scopes: ['User.Read'] });
  instance.setActiveAccount(result.account);
  return result.account;
}

export async function connectTenant() {
  const instance = getMsal();
  if (!instance) throw new Error('Microsoft Entra authentication is not configured. Add VITE_ENTRA_CLIENT_ID to .env.local.');
  await initPromise;
  let account = instance.getActiveAccount() || instance.getAllAccounts()[0];
  if (!account) account = await signIn();

  // Incremental consent: monitoring permissions are requested only when the user chooses Connect Tenant.
  const result = await instance.acquireTokenPopup({
    account,
    scopes: GRAPH_SCOPES,
    prompt: 'consent',
  });

  instance.setActiveAccount(result.account || account);
  return { account: result.account || account, accessToken: result.accessToken, scopes: result.scopes };
}

export async function getGraphToken(scopes = GRAPH_SCOPES) {
  const instance = getMsal();
  if (!instance) throw new Error('Microsoft Entra authentication is not configured.');
  await initPromise;
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0];
  if (!account) throw new Error('Sign in before connecting a tenant.');

  try {
    const result = await instance.acquireTokenSilent({ account, scopes });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const result = await instance.acquireTokenPopup({ account, scopes });
      return result.accessToken;
    }
    throw error;
  }
}

export async function graphGet(path, scopes = GRAPH_SCOPES) {
  const token = await getGraphToken(scopes);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ConsistencyLevel: 'eventual',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Microsoft Graph ${response.status}: ${body}`);
  }
  return response.json();
}

export async function getTenantSnapshot() {
  const [applications, users, groups, devices] = await Promise.all([
    graphGet('/applications?$count=true&$top=1'),
    graphGet('/users?$count=true&$top=1'),
    graphGet('/groups?$count=true&$top=1'),
    graphGet('/devices?$count=true&$top=1'),
  ]);

  const account = getSignedInAccount();
  return {
    tenant: account ? { id: account.tenantId, displayName: account.name || account.username } : null,
    counts: {
      applications: applications['@odata.count'] ?? null,
      users: users['@odata.count'] ?? null,
      groups: groups['@odata.count'] ?? null,
      devices: devices['@odata.count'] ?? null,
    },
  };
}

export async function getRecentSignIns() {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return graphGet(`/auditLogs/signIns?$filter=createdDateTime ge ${encodeURIComponent(from)}&$count=true&$top=50&$orderby=createdDateTime desc`);
}

export async function getRecentAuditLogs() {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return graphGet(`/auditLogs/directoryAudits?$filter=activityDateTime ge ${encodeURIComponent(from)}&$top=50&$orderby=activityDateTime desc`);
}

export function getSignedInAccount() {
  if (!msalInstance) return null;
  return msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
}

export async function disconnectTenant() {
  const instance = getMsal();
  if (!instance) return;
  await initPromise;
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0];
  instance.setActiveAccount(null);
  if (account) await instance.logoutPopup({ account, mainWindowRedirectUri: window.location.origin });
}
