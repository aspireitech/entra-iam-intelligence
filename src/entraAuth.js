import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

const DEFAULT_CLIENT_ID = 'ab342dfc-cab4-45f3-acdb-3e49d606f418';
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID || DEFAULT_CLIENT_ID;
const authority = import.meta.env.VITE_ENTRA_AUTHORITY || 'https://login.microsoftonline.com/organizations';

export const AUTH_CONFIGURED = Boolean(clientId);
export const GRAPH_SCOPES = [
  'User.ReadBasic.All',
  'Application.Read.All',
  'Group.Read.All',
  'Device.Read.All',
  'AuditLog.Read.All',
];
export const OPTIONAL_PROVISIONING_SCOPE = 'ProvisioningLog.Read.All';

let msalInstance;
let initPromise;
let redirectResult;

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
      cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
    });
  }
  if (!initPromise) initPromise = msalInstance.initialize();
  return msalInstance;
}

export async function initializeAuth() {
  const instance = getMsal();
  if (!instance) return null;
  await initPromise;
  redirectResult = await instance.handleRedirectPromise();
  if (redirectResult?.account) instance.setActiveAccount(redirectResult.account);
  const accounts = instance.getAllAccounts();
  if (accounts.length && !instance.getActiveAccount()) instance.setActiveAccount(accounts[0]);
  return instance.getActiveAccount() || accounts[0] || null;
}

export function getRedirectResult() { return redirectResult; }

export async function signIn() {
  const instance = getMsal();
  if (!instance) throw new Error('Microsoft Entra authentication is not configured.');
  await initPromise;
  await instance.loginRedirect({ scopes: ['User.Read'], redirectStartPage: window.location.href });
}

export async function connectTenant() {
  const instance = getMsal();
  if (!instance) throw new Error('Microsoft Entra authentication is not configured.');
  await initPromise;
  const account = instance.getActiveAccount() || instance.getAllAccounts()[0];
  if (!account) throw new Error('Sign in before connecting a tenant.');
  sessionStorage.setItem('iam_connect_pending', 'true');
  await instance.acquireTokenRedirect({
    account,
    scopes: GRAPH_SCOPES,
    prompt: 'consent',
    redirectStartPage: window.location.href,
  });
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
      sessionStorage.setItem('iam_connect_pending', 'true');
      await instance.acquireTokenRedirect({ account, scopes, redirectStartPage: window.location.href });
      return null;
    }
    throw error;
  }
}

export async function graphGet(path, scopes = GRAPH_SCOPES) {
  const token = await getGraphToken(scopes);
  if (!token) throw new Error('Microsoft authentication redirect in progress.');
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
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
  return {
    applications: applications['@odata.count'] ?? 0,
    users: users['@odata.count'] ?? 0,
    groups: groups['@odata.count'] ?? 0,
    devices: devices['@odata.count'] ?? 0,
  };
}
