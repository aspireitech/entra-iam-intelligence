import { getAppToken } from './msal.js';

const GRAPH_BASE = 'https://graph.microsoft.com';

async function graphGet(token, path, version = 'v1.0') {
  const url = path.startsWith('https://') ? path : `${GRAPH_BASE}/${version}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Microsoft Graph ${response.status} on ${path}: ${body}`);
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

// Follows @odata.nextLink until exhausted, so a tenant with more records than one
// page (999 for most list endpoints, 500 for roleManagement/riskyUsers) doesn't get
// silently truncated - at 17,000 app registrations or 30,000 users, a single-page
// fetch would undercount stale users, inactive apps, expiring credentials etc.
// rather than reporting them accurately. maxPages is a hard safety cap.
async function graphGetAllPages(token, path, version = 'v1.0', maxPages = 60) {
  let url = path, all = [], pages = 0, page;
  while (url && pages < maxPages) {
    page = await graphGet(token, url, version);
    all = all.concat(page.value || []);
    url = page['@odata.nextLink'] || null;
    pages++;
  }
  return { value: all, truncated: Boolean(url) };
}

async function graphGetAllPagesOptional(token, path, version) {
  try {
    return { ok: true, data: await graphGetAllPages(token, path, version) };
  } catch (error) {
    return { ok: false, error };
  }
}

// Who/what registered new applications, from directory audit logs - not a fabricated
// "manual vs API vs internal tool" label, which Graph doesn't provide. The real,
// defensible signal is the actor type: a human user (interactive sign-in - portal,
// CLI, PowerShell run by a person) vs. an application/service principal (automation
// using its own credential). When the acting app has a display name, it's shown, and
// is often enough to identify the actual source (a Terraform/CI service principal, etc).
export async function fetchAppCreationEvents(tenant, config, sinceIso) {
  const token = await getAppToken(tenant, config);
  const filter = `activityDisplayName eq 'Add application' and activityDateTime ge ${sinceIso}`;
  const result = await graphGetOptional(token, `/auditLogs/directoryAudits?$filter=${encodeURIComponent(filter)}&$top=200&$orderby=activityDateTime desc`);
  if (!result.ok) return { ok: false, error: result.error, events: [] };
  const events = (result.data.value || []).map((a) => {
    const target = (a.targetResources || [])[0] || {};
    const actorType = a.initiatedBy?.app ? 'application' : a.initiatedBy?.user ? 'user' : 'unknown';
    const actorName = a.initiatedBy?.app?.displayName || a.initiatedBy?.user?.userPrincipalName || a.initiatedBy?.user?.displayName || null;
    return {
      audit_id: a.id,
      app_id: target.id || null,
      app_name: target.displayName || null,
      event_type: 'created',
      actor_type: actorType,
      actor_name: actorName,
      activity_datetime: a.activityDateTime,
    };
  });
  return { ok: true, events };
}

async function dailySignIns(token, days = 7) {
  const now = new Date();
  const requests = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - i);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const filter = `createdDateTime ge ${start.toISOString()} and createdDateTime lt ${end.toISOString()}`;
    requests.push(graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(filter)}`));
  }
  const results = await Promise.all(requests);
  return results.map((r, i) => {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - i));
    return { date: d.toISOString().slice(0, 10), total: r.ok ? Number(r.data['@odata.count'] || 0) : null };
  });
}
function lastActivity(item) {
  const values = [item.lastSignInActivity?.lastSignInDateTime, item.applicationAuthenticationClientSignInActivity?.lastSignInDateTime, item.applicationAuthenticationResourceSignInActivity?.lastSignInDateTime, item.delegatedClientSignInActivity?.lastSignInDateTime, item.delegatedResourceSignInActivity?.lastSignInDateTime].filter(Boolean).map((x) => new Date(x).getTime());
  return values.length ? Math.max(...values) : 0;
}
// Kept identical to bucketAppActivity() in src/entraAuth.js - see that file's comment
// for why activityRecords must already be scoped to this tenant's own applications.
function bucketAppActivity(ownApps, activityRecords) {
  const now = Date.now(); const cutoff = (d) => now - d * 86400000;
  const activityByAppId = new Map((activityRecords || []).map((a) => [a.appId, a]));
  const buckets = { active30: 0, inactive31to90: 0, inactive91to180: 0, inactive180: 0 };
  const inactiveApps = []; const all = [];
  for (const app of ownApps) {
    const activity = activityByAppId.get(app.appId);
    const ts = activity ? lastActivity(activity) : 0;
    const name = app.displayName || app.appId || 'Unnamed application';
    const days = ts ? Math.floor((now - ts) / 86400000) : null;
    let bucket;
    if (!ts || ts < cutoff(180)) { buckets.inactive180++; bucket = '180+'; inactiveApps.push({ name, appId: app.appId, days }); }
    else if (ts < cutoff(90)) { buckets.inactive91to180++; bucket = '91-180'; inactiveApps.push({ name, appId: app.appId, days }); }
    else if (ts < cutoff(30)) { buckets.inactive31to90++; bucket = '31-90'; inactiveApps.push({ name, appId: app.appId, days }); }
    else { buckets.active30++; bucket = 'active'; }
    all.push({ name, appId: app.appId, days, bucket });
  }
  inactiveApps.sort((a, b) => (b.days ?? 99999) - (a.days ?? 99999));
  all.sort((a, b) => (b.days ?? 99999) - (a.days ?? 99999));
  return { buckets, inactiveApps: inactiveApps.slice(0, 25), all };
}

// Application-permission collection for one tenant. Returns the same field shape as
// src/entraAuth.js getTenantSnapshot() (the delegated live-view snapshot) for every
// field the dashboard actually renders, so the browser can use whichever one it gets
// interchangeably - see src/liveTenantData.js syncTenantData(). Anything
// getTenantSnapshot() computes but the UI never reads (permissions, healthInputs,
// coreQueryFailures, failedSignIns7d, applicationList, staleUserList) is intentionally
// left out here to keep the collector's per-poll workload and stored JSON smaller.
export async function collectTenant(tenant, config) {
  const collectedAt = new Date().toISOString();
  const token = await getAppToken(tenant, config);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const staleCutoff = Date.now() - 90 * 86400000;
  const now = Date.now();

  const [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d, riskySignIns7d, recentSignInsResult, signInTrend] = await Promise.all([
    graphGetOptional(token, '/organization?$select=id,displayName,verifiedDomains'),
    graphGetOptional(token, '/applications?$count=true&$top=1'),
    graphGetOptional(token, '/users?$count=true&$top=1'),
    graphGetOptional(token, '/groups?$count=true&$top=1'),
    graphGetOptional(token, '/devices?$count=true&$top=1'),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo}`)}`),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo} and riskLevelAggregated ne 'none'`)}`),
    graphGetOptional(token, '/auditLogs/signIns?$top=50&$orderby=createdDateTime desc'),
    dailySignIns(token, 7),
  ]);

  // /roleManagement/directory/* and /identityProtection/riskyUsers both cap $top at
  // 500, unlike the 999 most other Graph list endpoints (users, applications, groups,
  // devices) allow - confirmed by Graph's own "Invalid page size... 1 and 500" error.
  const [riskyUsers, roleAssignments, roleDefinitions, conditionalAccess, subscribedSkus, appCredentials, activityResult, userActivity, managerRecords, deviceList, registration, servicePrincipalCount, managedIdentityCount] = await Promise.all([
    graphGetAllPagesOptional(token, '/identityProtection/riskyUsers?$top=500'),
    graphGetAllPagesOptional(token, '/roleManagement/directory/roleAssignments?$top=500'),
    graphGetAllPagesOptional(token, '/roleManagement/directory/roleDefinitions?$top=500&$filter=isBuiltIn eq true'),
    graphGetOptional(token, '/identity/conditionalAccess/policies?$top=999'),
    graphGetOptional(token, '/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits'),
    graphGetAllPagesOptional(token, '/applications?$top=999&$select=id,appId,displayName,keyCredentials,passwordCredentials&$expand=owners($select=id)'),
    graphGetAllPagesOptional(token, '/reports/servicePrincipalSignInActivities?$top=999', 'beta'),
    graphGetAllPagesOptional(token, '/users?$top=999&$select=id,displayName,userPrincipalName,accountEnabled,signInActivity,assignedLicenses'),
    graphGetAllPagesOptional(token, '/users?$top=999&$select=id,displayName,userPrincipalName,accountEnabled&$expand=manager($select=id,displayName,userPrincipalName)'),
    graphGetAllPagesOptional(token, '/devices?$top=999&$select=id,displayName,operatingSystem,operatingSystemVersion,trustType,isCompliant,accountEnabled,approximateLastSignInDateTime'),
    graphGetAllPagesOptional(token, '/reports/authenticationMethods/userRegistrationDetails?$top=999'),
    graphGetOptional(token, '/servicePrincipals?$count=true&$top=1'),
    graphGetOptional(token, `/servicePrincipals?$count=true&$top=1&$filter=${encodeURIComponent(`servicePrincipalType eq 'ManagedIdentity'`)}`),
  ]);

  const definitions = roleDefinitions.ok ? roleDefinitions.data.value || [] : [];
  const privilegedRoleIds = new Set(definitions.filter((r) => /administrator|global reader|security reader|privileged role/i.test(r.displayName || '')).map((r) => r.id));
  const assignments = roleAssignments.ok ? roleAssignments.data.value || [] : [];
  const privilegedPrincipalIds = roleAssignments.ok ? new Set(assignments.filter((a) => privilegedRoleIds.has(a.roleDefinitionId)).map((a) => a.principalId)) : new Set();
  const privilegedUsers = roleAssignments.ok ? privilegedPrincipalIds.size : null;

  const users = userActivity.ok ? userActivity.data.value || [] : [];
  const userActivityAvailable = userActivity.ok;
  const staleUserList = userActivity.ok ? users.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)) : [];
  const staleUsers = userActivity.ok ? staleUserList.length : null;
  const userActivityList = userActivity.ok ? users.map((u) => ({ id: u.id, name: u.displayName || u.userPrincipalName, upn: u.userPrincipalName, enabled: u.accountEnabled, lastSignIn: u.signInActivity?.lastSignInDateTime || null })) : [];
  const licensedUsers = users.filter((u) => (u.assignedLicenses || []).length > 0);
  const staleLicensedUserCount = userActivity.ok
    ? licensedUsers.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)).length
    : null;

  const managerAvailable = managerRecords.ok;
  const usersWithoutManager = managerAvailable ? (managerRecords.data.value || []).filter((u) => u.accountEnabled !== false && !u.manager).length : null;

  const registrationAvailable = registration.ok;
  const registrationList = registration.ok ? registration.data.value || [] : [];
  const mfaRegistered = registrationAvailable ? registrationList.filter((u) => u.isMfaRegistered).length : null;
  const mfaMissing = registrationAvailable ? registrationList.filter((u) => !u.isMfaRegistered).length : null;
  const mfaMissingUsers = registrationAvailable ? registrationList.filter((u) => !u.isMfaRegistered).map((u) => ({ id: u.id, name: u.userDisplayName || u.userPrincipalName, upn: u.userPrincipalName })) : [];

  const skus = subscribedSkus.ok
    ? (subscribedSkus.data.value || []).map((s) => ({ skuId: s.skuId, skuPartNumber: s.skuPartNumber, purchased: s.prepaidUnits?.enabled || 0, consumed: s.consumedUnits || 0 }))
    : [];
  const totalPurchased = subscribedSkus.ok ? skus.reduce((a, s) => a + s.purchased, 0) : null;
  const totalConsumed = subscribedSkus.ok ? skus.reduce((a, s) => a + s.consumed, 0) : null;

  const ownApps = appCredentials.ok ? appCredentials.data.value || [] : [];
  const credentialItems = [];
  for (const app of ownApps) {
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
  const ownerlessApps = appCredentials.ok ? ownApps.filter((a) => !(a.owners || []).length).map((a) => ({ name: a.displayName || a.appId || 'Unnamed application', appId: a.appId })) : [];
  const credentialBearingApps = appCredentials.ok ? ownApps.filter((a) => (a.keyCredentials || []).length || (a.passwordCredentials || []).length).length : null;

  const appActivityAvailable = activityResult.ok && appCredentials.ok;
  const appActivity = appActivityAvailable ? bucketAppActivity(ownApps, activityResult.data.value || []) : { buckets: null, inactiveApps: [], all: [] };

  // Toxic combinations: cross-reference signals already collected by AAD object id -
  // kept identical to the cross-reference in src/entraAuth.js getTenantSnapshot().
  const nameById = new Map();
  if (managerAvailable) for (const u of managerRecords.data.value || []) nameById.set(u.id, u.displayName || u.userPrincipalName);
  if (userActivityAvailable) for (const u of users) if (!nameById.has(u.id)) nameById.set(u.id, u.displayName || u.userPrincipalName);
  if (registrationAvailable) for (const u of registrationList) if (!nameById.has(u.id)) nameById.set(u.id, u.userDisplayName || u.userPrincipalName);
  const mfaMissingIds = new Set(mfaMissingUsers.map((u) => u.id));
  const riskyUserRecords = riskyUsers.ok ? riskyUsers.data.value || [] : [];
  const riskyIds = new Set(riskyUserRecords.map((u) => u.id));
  const staleIds = new Set(staleUserList.map((u) => u.id));
  const toxicCombinations = [];
  for (const id of privilegedPrincipalIds) {
    const flags = [];
    if (registrationAvailable && mfaMissingIds.has(id)) flags.push('No MFA');
    if (riskyUsers.ok && riskyIds.has(id)) flags.push('Risky sign-in (ID Protection)');
    if (userActivityAvailable && staleIds.has(id)) flags.push('Stale 90+ days');
    if (flags.length) toxicCombinations.push({ id, name: nameById.get(id) || id, flags });
  }
  toxicCombinations.sort((a, b) => b.flags.length - a.flags.length);
  const toxicCombinationsAvailable = roleAssignments.ok && (registrationAvailable || riskyUsers.ok || userActivityAvailable);

  const usersCountValue = usersCount.ok ? usersCount.data['@odata.count'] : null;
  const healthInputs = {
    mfaCoverage: registrationAvailable && usersCountValue ? mfaRegistered / usersCountValue : null,
    riskyUserRate: riskyUsers.ok && usersCountValue ? riskyUserRecords.length / usersCountValue : null,
    inactiveAppRate: appActivityAvailable && ownApps.length ? (appActivity.buckets.inactive91to180 + appActivity.buckets.inactive180) / ownApps.length : null,
    staleUserRate: userActivityAvailable && usersCountValue ? staleUsers / usersCountValue : null,
  };
  const scoreContributors = [];
  if (healthInputs.mfaCoverage != null) scoreContributors.push({ key: 'mfaCoverage', label: 'MFA coverage', score: healthInputs.mfaCoverage * 100 });
  if (healthInputs.riskyUserRate != null) scoreContributors.push({ key: 'riskyUserRate', label: 'Risky users', score: Math.max(0, 100 - healthInputs.riskyUserRate * 1000) });
  if (healthInputs.inactiveAppRate != null) scoreContributors.push({ key: 'inactiveAppRate', label: 'Application hygiene', score: Math.max(0, 100 - healthInputs.inactiveAppRate * 100) });
  if (healthInputs.staleUserRate != null) scoreContributors.push({ key: 'staleUserRate', label: 'Stale accounts', score: Math.max(0, 100 - healthInputs.staleUserRate * 100) });
  const healthScore = scoreContributors.length ? Math.round(scoreContributors.reduce((a, c) => a + c.score, 0) / scoreContributors.length) : null;
  const healthExcludedSignals = [
    healthInputs.mfaCoverage == null && 'MFA coverage (permission required)',
    healthInputs.riskyUserRate == null && 'Risky users (permission/license required)',
    healthInputs.inactiveAppRate == null && 'Application hygiene (beta report unavailable)',
    healthInputs.staleUserRate == null && 'Stale accounts (permission required)',
  ].filter(Boolean);

  const orgValue = org.ok ? (org.data.value || [])[0] : null;
  const results = [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d, riskySignIns7d, recentSignInsResult, riskyUsers, roleAssignments, conditionalAccess, subscribedSkus, appCredentials, activityResult, userActivity, managerRecords, deviceList, registration, servicePrincipalCount, managedIdentityCount];

  return {
    tenantId: tenant.id,
    displayName: tenant.displayName || orgValue?.displayName || tenant.id,
    organization: orgValue ? { id: orgValue.id, displayName: orgValue.displayName, verifiedDomains: orgValue.verifiedDomains || [] } : null,
    users: usersCountValue,
    applications: appsCount.ok ? appsCount.data['@odata.count'] : null,
    groups: groupsCount.ok ? groupsCount.data['@odata.count'] : null,
    devices: devicesCount.ok ? devicesCount.data['@odata.count'] : null,
    signIns7d: signIns7d.ok ? signIns7d.data['@odata.count'] : null,
    riskySignIns7d: riskySignIns7d.ok ? riskySignIns7d.data['@odata.count'] : null,
    recentSignIns: recentSignInsResult.ok ? recentSignInsResult.data.value || [] : [],
    signInTrend,
    signInsAvailable: signIns7d.ok,
    signInsReason: signIns7d.ok ? null : String(signIns7d.error?.message || ''),
    appActivity: appActivity.buckets,
    appPopulation: ownApps.length,
    inactiveApps: appActivity.inactiveApps,
    appDetails: appActivity.all,
    appActivityAvailable,
    appActivityReason: appActivityAvailable ? null : String((activityResult.error || appCredentials.error)?.message || 'Unavailable'),
    riskyUsers: riskyUsers.ok ? riskyUserRecords.length : null,
    riskyUsersAvailable: riskyUsers.ok,
    riskyUsersReason: riskyUsers.ok ? null : String(riskyUsers.error?.message || ''),
    riskyUserList: riskyUsers.ok ? riskyUserRecords.map((u) => ({ id: u.id, name: u.userDisplayName || u.userPrincipalName, riskLevel: u.riskLevel, riskState: u.riskState, riskLastUpdated: u.riskLastUpdatedDateTime })) : [],
    privilegedUsers,
    privilegedUsersAvailable: roleAssignments.ok,
    conditionalAccessPolicies: conditionalAccess.ok ? (conditionalAccess.data.value || []).length : null,
    conditionalAccessAvailable: conditionalAccess.ok,
    conditionalAccessPolicyList: conditionalAccess.ok ? (conditionalAccess.data.value || []).map((p) => ({ id: p.id, name: p.displayName, state: p.state })) : [],
    staleUsers,
    userActivityAvailable,
    userActivityList,
    usersWithoutManager,
    toxicCombinations,
    toxicCombinationsAvailable,
    toxicCombinationsCount: toxicCombinations.length,
    mfa: { registered: mfaRegistered, missing: mfaMissing, observed: registrationAvailable ? registrationList.length : null, missingUsers: mfaMissingUsers },
    nonHumanIdentities: {
      available: appCredentials.ok && servicePrincipalCount.ok,
      totalServicePrincipals: servicePrincipalCount.ok ? servicePrincipalCount.data['@odata.count'] : null,
      managedIdentities: managedIdentityCount.ok ? managedIdentityCount.data['@odata.count'] : null,
      appRegistrations: appsCount.ok ? appsCount.data['@odata.count'] : null,
      credentialBearing: credentialBearingApps,
      ownerlessCount: appCredentials.ok ? ownerlessApps.length : null,
      ownerlessApps: ownerlessApps.slice(0, 200),
    },
    deviceList: deviceList.ok ? (deviceList.data.value || []).map((d) => ({ id: d.id, name: d.displayName, os: d.operatingSystem, osVersion: d.operatingSystemVersion, trustType: d.trustType, compliant: d.isCompliant, enabled: d.accountEnabled, lastSignIn: d.approximateLastSignInDateTime })) : [],
    healthScore,
    healthContributors: scoreContributors,
    healthExcludedSignals,
    securityPermissionReady: riskyUsers.ok && roleAssignments.ok && conditionalAccess.ok,
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
