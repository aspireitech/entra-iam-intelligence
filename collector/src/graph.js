import { getAppToken } from './msal.js';

const GRAPH_BASE = 'https://graph.microsoft.com';

async function graphGet(token, path, version = 'v1.0') {
  const response = await fetch(`${GRAPH_BASE}/${version}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Microsoft Graph ${response.status}: ${body}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function graphGetOptional(token, path, version) {
  try {
    return { ok: true, data: await graphGet(token, path, version) };
  } catch (error) {
    return { ok: false, error };
  }
}

// Application-permission collection for one tenant. Field shapes intentionally mirror
// src/entraAuth.js getTenantSnapshot()/getLicenseSnapshot() in the SPA so a combined
// view and a single-tenant delegated view can eventually share rendering code.
export async function collectTenant(tenant, config) {
  const collectedAt = new Date().toISOString();
  const token = await getAppToken(tenant, config);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const staleCutoff = Date.now() - 90 * 86400000;
  const now = Date.now();

  const [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d] = await Promise.all([
    graphGetOptional(token, '/organization?$select=id,displayName,verifiedDomains'),
    graphGetOptional(token, '/applications?$count=true&$top=1'),
    graphGetOptional(token, '/users?$count=true&$top=1'),
    graphGetOptional(token, '/groups?$count=true&$top=1'),
    graphGetOptional(token, '/devices?$count=true&$top=1'),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo}`)}`),
  ]);

  const riskyUsers = await graphGetOptional(token, '/identityProtection/riskyUsers?$top=999');
  const roleAssignments = await graphGetOptional(token, '/roleManagement/directory/roleAssignments?$top=999');
  const roleDefinitions = await graphGetOptional(token, '/roleManagement/directory/roleDefinitions?$top=999&$filter=isBuiltIn eq true');
  const conditionalAccess = await graphGetOptional(token, '/identity/conditionalAccess/policies?$top=999');
  const subscribedSkus = await graphGetOptional(token, '/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits');
  const appCredentials = await graphGetOptional(token, '/applications?$top=999&$select=id,appId,displayName,keyCredentials,passwordCredentials');
  const userActivity = await graphGetOptional(token, '/users?$top=999&$select=id,displayName,userPrincipalName,accountEnabled,signInActivity,assignedLicenses');
  const registration = await graphGetOptional(token, '/reports/authenticationMethods/userRegistrationDetails?$top=999');

  const definitions = roleDefinitions.ok ? roleDefinitions.data.value || [] : [];
  const privilegedRoleIds = new Set(definitions.filter((r) => /administrator|global reader|security reader|privileged role/i.test(r.displayName || '')).map((r) => r.id));
  const assignments = roleAssignments.ok ? roleAssignments.data.value || [] : [];
  const privilegedUsers = roleAssignments.ok ? new Set(assignments.filter((a) => privilegedRoleIds.has(a.roleDefinitionId)).map((a) => a.principalId)).size : null;

  const users = userActivity.ok ? userActivity.data.value || [] : [];
  const staleUsers = userActivity.ok
    ? users.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)).length
    : null;
  const licensedUsers = users.filter((u) => (u.assignedLicenses || []).length > 0);
  const staleLicensedUserCount = userActivity.ok
    ? licensedUsers.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)).length
    : null;

  const registrationList = registration.ok ? registration.data.value || [] : [];
  const mfaMissing = registration.ok ? registrationList.filter((u) => !u.isMfaRegistered).length : null;

  const skus = subscribedSkus.ok
    ? (subscribedSkus.data.value || []).map((s) => ({ skuId: s.skuId, skuPartNumber: s.skuPartNumber, purchased: s.prepaidUnits?.enabled || 0, consumed: s.consumedUnits || 0 }))
    : [];
  const totalPurchased = subscribedSkus.ok ? skus.reduce((a, s) => a + s.purchased, 0) : null;
  const totalConsumed = subscribedSkus.ok ? skus.reduce((a, s) => a + s.consumed, 0) : null;

  const apps = appCredentials.ok ? appCredentials.data.value || [] : [];
  const credentialItems = [];
  for (const app of apps) {
    const creds = [
      ...(app.keyCredentials || []).map((c) => ({ type: 'certificate', endDateTime: c.endDateTime })),
      ...(app.passwordCredentials || []).map((c) => ({ type: 'secret', endDateTime: c.endDateTime })),
    ];
    for (const c of creds) {
      if (!c.endDateTime) continue;
      const daysRemaining = Math.floor((new Date(c.endDateTime).getTime() - now) / 86400000);
      credentialItems.push({ name: app.displayName || app.appId || 'Unnamed application', appId: app.appId, type: c.type, daysRemaining, expiresAt: c.endDateTime });
    }
  }
  credentialItems.sort((a, b) => a.daysRemaining - b.daysRemaining);

  const orgValue = org.ok ? (org.data.value || [])[0] : null;
  const results = [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d, riskyUsers, roleAssignments, conditionalAccess, subscribedSkus, appCredentials, userActivity, registration];

  return {
    tenantId: tenant.id,
    displayName: tenant.displayName || orgValue?.displayName || tenant.id,
    organization: orgValue ? { id: orgValue.id, displayName: orgValue.displayName, verifiedDomains: orgValue.verifiedDomains || [] } : null,
    users: usersCount.ok ? usersCount.data['@odata.count'] : null,
    applications: appsCount.ok ? appsCount.data['@odata.count'] : null,
    groups: groupsCount.ok ? groupsCount.data['@odata.count'] : null,
    devices: devicesCount.ok ? devicesCount.data['@odata.count'] : null,
    signIns7d: signIns7d.ok ? signIns7d.data['@odata.count'] : null,
    riskyUsers: riskyUsers.ok ? (riskyUsers.data.value || []).length : null,
    privilegedUsers,
    conditionalAccessPolicies: conditionalAccess.ok ? (conditionalAccess.data.value || []).length : null,
    staleUsers,
    mfaMissing,
    licenses: {
      available: subscribedSkus.ok,
      skus,
      totalPurchased,
      totalConsumed,
      totalAvailable: subscribedSkus.ok ? Math.max(0, totalPurchased - totalConsumed) : null,
      staleLicensedUserCount,
    },
    credentialExpiry: {
      available: appCredentials.ok,
      items: credentialItems.slice(0, 50),
      expiringSoon: appCredentials.ok ? credentialItems.filter((i) => i.daysRemaining <= 30).length : null,
    },
    permissionFailures: results.filter((r) => !r.ok).map((r) => String(r.error?.message || r.error)),
    collectedAt,
  };
}
