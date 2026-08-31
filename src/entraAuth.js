import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

// Public SPA identifier; never a secret.
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

  // Reuse existing admin consent silently. Only trigger an interactive consent screen
  // when Microsoft says a token/consent interaction is actually required.
  try {
    const result = await instance.acquireTokenSilent({ account, scopes: GRAPH_SCOPES });
    return { account: result.account || account, accessToken: result.accessToken, scopes: result.scopes };
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      sessionStorage.setItem('iam_connect_pending', 'true');
      await instance.acquireTokenRedirect({ account, scopes: GRAPH_SCOPES, redirectStartPage: window.location.href });
      return null;
    }
    throw error;
  }
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
      await instance.acquireTokenRedirect({ account, scopes, redirectStartPage: window.location.href });
      return null;
    }
    throw error;
  }
}

export async function graphGet(path, scopes = GRAPH_SCOPES, version = 'v1.0') {
  const token = await getGraphToken(scopes);
  if (!token) throw new Error('Microsoft authentication redirect in progress.');
  const response = await fetch(`https://graph.microsoft.com/${version}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Microsoft Graph ${response.status}: ${body}`);
  }
  return response.json();
}

export async function getTenantSnapshot() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [applications, users, groups, devices, signIns, riskySignIns, recentSignIns] = await Promise.all([
    graphGet('/applications?$count=true&$top=1'),
    graphGet('/users?$count=true&$top=1'),
    graphGet('/groups?$count=true&$top=1'),
    graphGet('/devices?$count=true&$top=1'),
    graphGet(`/auditLogs/signIns?$count=true&$top=1&$filter=createdDateTime%20ge%20${encodeURIComponent(sevenDaysAgo)}`, GRAPH_SCOPES),
    graphGet(`/auditLogs/signIns?$count=true&$top=1&$filter=createdDateTime%20ge%20${encodeURIComponent(sevenDaysAgo)}%20and%20riskLevelAggregated%20ne%20%27none%27`, GRAPH_SCOPES),
    graphGet(`/auditLogs/signIns?$top=5&$orderby=createdDateTime%20desc`, GRAPH_SCOPES),
  ]);

  let appActivity = [];
  try {
    const activity = await graphGet('/reports/servicePrincipalSignInActivities?$top=999', GRAPH_SCOPES, 'beta');
    appActivity = activity.value || [];
  } catch {
    // This preview reporting endpoint is optional. Core tenant counts/sign-ins remain available.
  }

  const cutoff = (days) => now.getTime() - days * 24 * 60 * 60 * 1000;
  const lastActivity = (item) => {
    const values = [
      item.lastSignInActivity?.lastSignInDateTime,
      item.applicationAuthenticationClientSignInActivity?.lastSignInDateTime,
      item.applicationAuthenticationResourceSignInActivity?.lastSignInDateTime,
      item.delegatedClientSignInActivity?.lastSignInDateTime,
      item.delegatedResourceSignInActivity?.lastSignInDateTime,
    ].filter(Boolean).map(x => new Date(x).getTime());
    return values.length ? Math.max(...values) : 0;
  };
  const activityBuckets = { active30: 0, inactive31to90: 0, inactive91to180: 0, inactive180: 0 };
  appActivity.forEach(item => {
    const ts = lastActivity(item);
    if (!ts || ts < cutoff(180)) activityBuckets.inactive180 += 1;
    else if (ts < cutoff(90)) activityBuckets.inactive91to180 += 1;
    else if (ts < cutoff(30)) activityBuckets.inactive31to90 += 1;
    else activityBuckets.active30 += 1;
  });

  return {
    applications: applications['@odata.count'] ?? 0,
    users: users['@odata.count'] ?? 0,
    groups: groups['@odata.count'] ?? 0,
    devices: devices['@odata.count'] ?? 0,
    signIns7d: signIns['@odata.count'] ?? 0,
    riskySignIns7d: riskySignIns['@odata.count'] ?? 0,
    appActivity: activityBuckets,
    recentSignIns: recentSignIns.value || [],
    collectedAt: now.toISOString(),
  };
}
