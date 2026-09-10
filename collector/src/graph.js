import { getAppToken, getAzureManagementToken } from './msal.js';

const GRAPH_BASE = 'https://graph.microsoft.com';

// Bounded retry on throttling only (429, and 503 which Graph also uses for transient
// overload), honoring the Retry-After header Graph sends - the browser-side fetcher in
// src/entraAuth.js has always had this; this one didn't, which meant a single burst of
// throttling here failed a field outright instead of recovering within the same cycle.
// Confirmed as the actual cause of a real "Legacy Authentication: Unavailable (429)"
// report - the new full-7-day sign-in log fetch added for usage analytics (below) hits
// the same /auditLogs/signIns endpoint in the same burst as the legacy-auth queries,
// which was enough to occasionally trip this tenant's rate limit.
const GRAPH_MAX_RETRIES = 2;
async function graphGet(token, path, version = 'v1.0') {
  const url = path.startsWith('https://') ? path : `${GRAPH_BASE}/${version}${path}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      // A browser always sends an Accept-Language header on every request; Node's
      // fetch sends none at all. That's invisible almost everywhere, but the PIM
      // endpoints (roleEligibilityScheduleInstances) throw a 400
      // CultureNotFoundException ("* is an invalid culture identifier") server-side
      // when it's absent - confirmed as a known Graph PIM quirk, not specific to
      // this tenant. Harmless to send everywhere else, so it's not conditional.
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual', 'Accept-Language': 'en-US' },
    });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status === 503) && attempt < GRAPH_MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Math.min(30000, Math.max(500, (Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt) * 1000));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    const body = await response.text();
    const error = new Error(`Microsoft Graph ${response.status} on ${path}: ${body}`);
    error.status = response.status;
    throw error;
  }
}

async function graphGetOptional(token, path, version) {
  try {
    return { ok: true, data: await graphGet(token, path, version) };
  } catch (error) {
    // Previously swallowed with no trace anywhere - a dashboard page or report
    // going quietly "unavailable" gave no way to tell why short of guessing.
    // error.message already carries the status code and Graph's own response
    // body (see graphGet above), so this alone is enough to diagnose a 401
    // (consent revoked), 403 (permission missing), or 429 (throttled).
    console.warn(`[collector] ${error.message}`);
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
    console.warn(`[collector] ${error.message}`);
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

// Counts how many records in a list were created within each of four trailing
// windows, from a single date field - used for the "recent onboarding" chart across
// users/guests/devices/groups/applications. Deliberately cumulative (last7d includes
// what's in last24h, etc.) rather than disjoint buckets: "onboarded in the last 7
// days" is the question people actually ask, not "onboarded on exactly day 5-7".
// Missing/unparseable dates are skipped rather than counted, since Graph can return
// null for a field like registrationDateTime on an older device record.
function onboardingBuckets(records, dateField) {
  const now = Date.now();
  const windows = { last24h: now - 86400000, last7d: now - 7 * 86400000, last30d: now - 30 * 86400000, last6mo: now - 182 * 86400000 };
  const counts = { last24h: 0, last7d: 0, last30d: 0, last6mo: 0 };
  for (const record of records) {
    const raw = record[dateField];
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) continue;
    for (const key of Object.keys(windows)) if (t >= windows[key]) counts[key]++;
  }
  return counts;
}

// Counts occurrences of a field across a list of records and returns the top N as
// {name,value} - the shape BarChart already expects. Used for "which application/API/
// user accounts for the most sign-in volume" - three views over the same sign-in log,
// not three separate queries.
function topCounts(records, field, limit = 8) {
  const counts = new Map();
  for (const record of records) {
    const key = record[field] || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, value]) => ({ name, value }));
}

// Azure Resource Manager is a completely separate API/resource from Microsoft Graph
// (management.azure.com, not graph.microsoft.com/the GRAPH_BASE at the top of this
// file) - deliberately its own tiny fetch layer rather than reusing graphGet, same as
// the browser-side delegated equivalent in src/entraAuth.js.
async function armGet(token, path, version = '2022-12-01') {
  const url = path.startsWith('https://') ? path : `https://management.azure.com${path}${path.includes('?') ? '&' : '?'}api-version=${version}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Azure Resource Manager ${response.status} on ${path}: ${body}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
async function armGetOptional(token, path, version) {
  try {
    return { ok: true, data: await armGet(token, path, version) };
  } catch (error) {
    console.warn(`[collector] ${error.message}`);
    return { ok: false, error };
  }
}
// Fixed, documented GUIDs - identical across every Azure AD tenant for these four
// built-in roles. See the identical comment/list in src/entraAuth.js.
const BUILTIN_ROLE_NAMES = {
  '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner',
  'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor',
  'acdd72a7-3385-48ef-bd42-f606fba81ae7': 'Reader',
  '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9': 'User Access Administrator',
};
function armRoleName(roleDefinitionId) {
  const guid = (roleDefinitionId || '').split('/').pop();
  return BUILTIN_ROLE_NAMES[guid] || `Custom role (${guid || 'unknown'})`;
}
// Subscriptions + who has standing RBAC access to each, at subscription scope only
// ($filter=atScope()). Runs entirely on its own app-only ARM token - independent of
// the Graph token/data the rest of collectTenant() gathers, so it's kicked off
// concurrently with everything else and only awaited once its result is actually
// needed (see collectTenant()). Never throws: a tenant where the collector's service
// principal has no Azure RBAC role assigned yet (the common case before an admin
// grants it) just comes back {available:false, reason}, same as any other
// optional/permission-gated field elsewhere in this snapshot.
async function collectAzureSubscriptions(tenant, config) {
  try {
    const azureToken = await getAzureManagementToken(tenant, config);
    const subsResult = await armGetOptional(azureToken, '/subscriptions', '2022-12-01');
    if (!subsResult.ok) return { available: false, reason: String(subsResult.error?.message || ''), subscriptions: [], rawAssignments: [] };
    const subscriptions = (subsResult.data.value || []).map((s) => ({ id: s.subscriptionId, name: s.displayName, state: s.state }));
    const perSub = await Promise.all(subscriptions.map((s) => armGetOptional(azureToken, `/subscriptions/${s.id}/providers/Microsoft.Authorization/roleAssignments?$filter=atScope()`, '2022-04-01')));
    const rawAssignments = [];
    perSub.forEach((result, i) => {
      if (!result.ok) return;
      const sub = subscriptions[i];
      for (const ra of result.data.value || []) {
        rawAssignments.push({
          subscriptionId: sub.id, subscriptionName: sub.name,
          principalId: ra.properties?.principalId || null,
          principalType: ra.properties?.principalType || 'Unknown',
          role: armRoleName(ra.properties?.roleDefinitionId),
        });
      }
    });
    return { available: true, reason: null, subscriptions, rawAssignments };
  } catch (error) {
    return { available: false, reason: String(error.message || error), subscriptions: [], rawAssignments: [] };
  }
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
  // Kicked off now, awaited later (once nameById exists, for principal-name
  // resolution) - runs concurrently with every Graph call below since it's on its
  // own ARM token and shares no data with them.
  const azureSubscriptionsPromise = collectAzureSubscriptions(tenant, config);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const staleCutoff = Date.now() - 90 * 86400000;
  const now = Date.now();

  const [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d, riskySignIns7d, recentSignInsResult, signInTrend, groupRecordsResult] = await Promise.all([
    graphGetOptional(token, '/organization?$select=id,displayName,verifiedDomains'),
    graphGetOptional(token, '/applications?$count=true&$top=1'),
    graphGetOptional(token, '/users?$count=true&$top=1'),
    graphGetOptional(token, '/groups?$count=true&$top=1'),
    graphGetOptional(token, '/devices?$count=true&$top=1'),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo}`)}`),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo} and riskLevelAggregated ne 'none'`)}`),
    graphGetOptional(token, '/auditLogs/signIns?$top=50&$orderby=createdDateTime desc'),
    dailySignIns(token, 7),
    graphGetAllPagesOptional(token, '/groups?$top=999&$select=id,displayName,groupTypes,mailEnabled,securityEnabled,onPremisesSyncEnabled,membershipRule,createdDateTime'),
  ]);

  // /roleManagement/directory/* and /identityProtection/riskyUsers both cap $top at
  // 500, unlike the 999 most other Graph list endpoints (users, applications, groups,
  // devices) allow - confirmed by Graph's own "Invalid page size... 1 and 500" error.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [riskyUsers, roleAssignments, roleDefinitions, conditionalAccess, subscribedSkus, appCredentials, activityResult, userActivity, managerRecords, deviceList, registration, servicePrincipalCount, managedIdentityCount, roleEligibility, legacyAuthCount, legacyAuthCount30d, legacyAuthSample, servicePrincipalList, signInLog] = await Promise.all([
    graphGetAllPagesOptional(token, '/identityProtection/riskyUsers?$top=500'),
    graphGetAllPagesOptional(token, '/roleManagement/directory/roleAssignments?$top=500'),
    graphGetAllPagesOptional(token, '/roleManagement/directory/roleDefinitions?$top=500&$filter=isBuiltIn eq true'),
    graphGetOptional(token, '/identity/conditionalAccess/policies?$top=999'),
    graphGetOptional(token, '/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits'),
    graphGetAllPagesOptional(token, '/applications?$top=999&$select=id,appId,displayName,keyCredentials,passwordCredentials,createdDateTime&$expand=owners($select=id)'),
    graphGetAllPagesOptional(token, '/reports/servicePrincipalSignInActivities?$top=999', 'beta'),
    graphGetAllPagesOptional(token, '/users?$top=999&$select=id,displayName,userPrincipalName,accountEnabled,signInActivity,assignedLicenses,userType,createdDateTime'),
    graphGetAllPagesOptional(token, '/users?$top=999&$select=id,displayName,userPrincipalName,accountEnabled&$expand=manager($select=id,displayName,userPrincipalName)'),
    graphGetAllPagesOptional(token, '/devices?$top=999&$select=id,displayName,operatingSystem,operatingSystemVersion,trustType,isCompliant,accountEnabled,approximateLastSignInDateTime,registrationDateTime'),
    graphGetAllPagesOptional(token, '/reports/authenticationMethods/userRegistrationDetails?$top=999'),
    graphGetOptional(token, '/servicePrincipals?$count=true&$top=1'),
    graphGetOptional(token, `/servicePrincipals?$count=true&$top=1&$filter=${encodeURIComponent(`servicePrincipalType eq 'ManagedIdentity'`)}`),
    graphGetAllPagesOptional(token, '/roleManagement/directory/roleEligibilityScheduleInstances?$top=500'),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo} and clientAppUsed ne 'Browser' and clientAppUsed ne 'Mobile Apps and Desktop clients'`)}`),
    graphGetOptional(token, `/auditLogs/signIns?$count=true&$top=1&$filter=${encodeURIComponent(`createdDateTime ge ${thirtyDaysAgo} and clientAppUsed ne 'Browser' and clientAppUsed ne 'Mobile Apps and Desktop clients'`)}`),
    graphGetOptional(token, `/auditLogs/signIns?$top=50&$orderby=createdDateTime desc&$filter=${encodeURIComponent(`clientAppUsed ne 'Browser' and clientAppUsed ne 'Mobile Apps and Desktop clients'`)}`),
    // Full list (not just the count) so privileged role assignments can be
    // cross-referenced against real service principals - a roleAssignment's
    // principalId is opaque otherwise, silently mixing human admins and
    // non-human identities together in Privileged Access/Toxic Combinations
    // with no way to tell which is which.
    graphGetAllPagesOptional(token, '/servicePrincipals?$top=999&$select=id,appId,displayName,servicePrincipalType'),
    // Full 7-day sign-in log (not just the top-50 "recent activity" list above) so
    // "which client app / API / user accounts for the most sign-in volume" can be a
    // real tenant-wide count, not a guess from the last 50 events. $select trimmed to
    // just the three fields the aggregation needs - this is the single largest list
    // this collector fetches, so keeping the payload per record minimal matters at
    // scale. maxPages caps it at ~60,000 sign-ins/cycle as a hard safety limit.
    graphGetAllPagesOptional(token, `/auditLogs/signIns?$top=999&$select=appDisplayName,resourceDisplayName,userDisplayName,userPrincipalName&$filter=${encodeURIComponent(`createdDateTime ge ${sevenDaysAgo}`)}`),
  ]);

  const definitions = roleDefinitions.ok ? roleDefinitions.data.value || [] : [];
  const privilegedRoleIds = new Set(definitions.filter((r) => /administrator|global reader|security reader|privileged role/i.test(r.displayName || '')).map((r) => r.id));
  const assignments = roleAssignments.ok ? roleAssignments.data.value || [] : [];
  const privilegedPrincipalIds = roleAssignments.ok ? new Set(assignments.filter((a) => privilegedRoleIds.has(a.roleDefinitionId)).map((a) => a.principalId)) : new Set();

  // Kept identical in shape to src/entraAuth.js's caPolicyList/mfaCoverageAllUsers - a
  // mismatch here previously showed a false "No" (not an honest "unavailable") for every
  // policy's Requires MFA / Targets All Users columns in collector mode, since those
  // fields were simply missing rather than computed.
  const caPolicyList = conditionalAccess.ok ? (conditionalAccess.data.value || []).map((p) => ({ id: p.id, name: p.displayName, state: p.state, requiresMfa: (p.grantControls?.builtInControls || []).includes('mfa'), targetsAllUsers: (p.conditions?.users?.includeUsers || []).includes('All'), excludedUserCount: (p.conditions?.users?.excludeUsers || []).length })) : [];
  const mfaCoverageAllUsers = conditionalAccess.ok ? caPolicyList.some((p) => p.state === 'enabled' && p.requiresMfa && p.targetsAllUsers) : null;
  const privilegedUsers = roleAssignments.ok ? privilegedPrincipalIds.size : null;

  // PIM eligibility - see the identical comment in src/entraAuth.js for what these two
  // gaps mean (eligible-not-active = invisible blast radius, active-not-eligible =
  // standing access that bypasses just-in-time activation).
  const eligibilityRecords = roleEligibility.ok ? roleEligibility.data.value || [] : [];
  const eligiblePrincipalIds = roleEligibility.ok ? new Set(eligibilityRecords.filter((e) => privilegedRoleIds.has(e.roleDefinitionId)).map((e) => e.principalId)) : new Set();
  const eligibleNotActiveIds = [...eligiblePrincipalIds].filter((id) => !privilegedPrincipalIds.has(id));
  const activeNotEligibleIds = [...privilegedPrincipalIds].filter((id) => !eligiblePrincipalIds.has(id));

  const users = userActivity.ok ? userActivity.data.value || [] : [];
  const userActivityAvailable = userActivity.ok;
  const staleUserList = userActivity.ok ? users.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)) : [];
  const staleUsers = userActivity.ok ? staleUserList.length : null;
  const userActivityList = userActivity.ok ? users.map((u) => ({ id: u.id, name: u.displayName || u.userPrincipalName, upn: u.userPrincipalName, enabled: u.accountEnabled, lastSignIn: u.signInActivity?.lastSignInDateTime || null })) : [];

  // Group type/sync breakdown - see the identical comment in src/entraAuth.js.
  const groupRecordsAvailable = groupRecordsResult.ok;
  const groupRecords = groupRecordsResult.ok ? groupRecordsResult.data.value || [] : [];
  const groupTypeLabel = (g) => (g.groupTypes || []).includes('Unified') ? 'Microsoft 365' : g.securityEnabled && g.mailEnabled ? 'Mail-Enabled Security' : g.securityEnabled ? 'Security' : g.mailEnabled ? 'Distribution' : 'Security';
  const groupList = groupRecordsAvailable ? groupRecords.map((g) => ({ id: g.id, name: g.displayName || '(no name)', type: groupTypeLabel(g), dynamic: (g.groupTypes || []).includes('DynamicMembership'), onPremSynced: g.onPremisesSyncEnabled === true, membershipRule: g.membershipRule || null })) : [];
  const cloudOnlyGroups = groupRecordsAvailable ? groupList.filter((g) => !g.onPremSynced).length : null;
  const onPremSyncGroups = groupRecordsAvailable ? groupList.filter((g) => g.onPremSynced).length : null;
  const dynamicGroups = groupRecordsAvailable ? groupList.filter((g) => g.dynamic).length : null;

  // Guests - see the identical comment in src/entraAuth.js.
  const guestList = userActivityAvailable ? users.filter((u) => u.userType === 'Guest').map((u) => ({ id: u.id, name: u.displayName || u.userPrincipalName, upn: u.userPrincipalName, enabled: u.accountEnabled, lastSignIn: u.signInActivity?.lastSignInDateTime || null })) : [];
  const guestStaleCutoff = Date.now() - 90 * 86400000;
  const guests = { available: userActivityAvailable, total: userActivityAvailable ? guestList.length : null, memberCount: userActivityAvailable ? users.length - guestList.length : null, staleCount: userActivityAvailable ? guestList.filter((u) => u.enabled !== false && (!u.lastSignIn || new Date(u.lastSignIn).getTime() < guestStaleCutoff)).length : null, list: guestList };

  // Legacy authentication - see the identical comment in src/entraAuth.js.
  const legacyAuth = { available: legacyAuthCount.ok, signIns7d: legacyAuthCount.ok ? Number(legacyAuthCount.data['@odata.count'] || 0) : null, signIns30d: legacyAuthCount30d.ok ? Number(legacyAuthCount30d.data['@odata.count'] || 0) : null, reason: legacyAuthCount.ok ? null : String(legacyAuthCount.error?.message || ''), sample: legacyAuthSample.ok ? (legacyAuthSample.data.value || []).map((s) => ({ id: s.id, user: s.userDisplayName || s.userPrincipalName || 'Service principal', app: s.appDisplayName || '—', clientAppUsed: s.clientAppUsed || 'Unknown', createdDateTime: s.createdDateTime, success: s.status?.errorCode === 0 })) : [] };

  // Application/API/user usage - "who/what is generating the most sign-in traffic",
  // aggregated from the full 7-day sign-in log fetched above (not the 50-row recent
  // list, which skews toward whoever signed in most recently rather than most often).
  const usageAnalytics = {
    available: signInLog.ok,
    reason: signInLog.ok ? null : String(signInLog.error?.message || ''),
    windowDays: 7,
    totalSignIns: signInLog.ok ? (signInLog.data.value || []).length : null,
    truncated: signInLog.ok ? Boolean(signInLog.data.truncated) : false,
    apps: signInLog.ok ? topCounts(signInLog.data.value || [], 'appDisplayName') : [],
    resources: signInLog.ok ? topCounts(signInLog.data.value || [], 'resourceDisplayName') : [],
    users: signInLog.ok ? topCounts((signInLog.data.value || []).map((s) => ({ who: s.userDisplayName || s.userPrincipalName || 'Service principal / unattended' })), 'who') : [],
  };

  // Recent onboarding, across every identity/asset type the dashboard tracks - the
  // same createdDateTime/registrationDateTime fields already came back on the
  // existing users/groups/applications/devices queries above (see their $select),
  // so this costs zero extra Graph calls.
  const onboarding = {
    users: userActivityAvailable ? onboardingBuckets(users.filter((u) => u.userType !== 'Guest'), 'createdDateTime') : null,
    guests: userActivityAvailable ? onboardingBuckets(users.filter((u) => u.userType === 'Guest'), 'createdDateTime') : null,
    devices: deviceList.ok ? onboardingBuckets(deviceList.data.value || [], 'registrationDateTime') : null,
    groups: groupRecordsAvailable ? onboardingBuckets(groupRecords, 'createdDateTime') : null,
    applications: appCredentials.ok ? onboardingBuckets(appCredentials.data.value || [], 'createdDateTime') : null,
  };
  const licensedUsers = users.filter((u) => (u.assignedLicenses || []).length > 0);
  const staleLicensedUserCount = userActivity.ok
    ? licensedUsers.filter((u) => u.accountEnabled !== false && (!u.signInActivity?.lastSignInDateTime || new Date(u.signInActivity.lastSignInDateTime).getTime() < staleCutoff)).length
    : null;

  const managerAvailable = managerRecords.ok;
  const usersWithoutManagerList = managerAvailable ? (managerRecords.data.value || []).filter((u) => u.accountEnabled !== false && !u.manager).map((u) => ({ id: u.id, name: u.displayName || u.userPrincipalName, upn: u.userPrincipalName })) : [];
  const usersWithoutManager = managerAvailable ? usersWithoutManagerList.length : null;

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

  // Which privileged role assignments belong to a service principal/managed identity
  // rather than a human - a roleAssignment's principalId alone doesn't say, so without
  // this cross-reference an admin can't tell "Global Admin" apart from "an automation
  // account with permanent, unmonitored Global Admin" in Privileged Access or Toxic
  // Combinations. This is the actual risk non-human identities pose per the collector's
  // own design notes: standing, rarely-reviewed privileged access with no human tied to it.
  const servicePrincipalRecords = servicePrincipalList.ok ? servicePrincipalList.data.value || [] : [];
  const servicePrincipalById = new Map(servicePrincipalRecords.map((sp) => [sp.id, sp]));
  const privilegedServicePrincipalIds = roleAssignments.ok ? [...privilegedPrincipalIds].filter((id) => servicePrincipalById.has(id)) : [];
  const privilegedServicePrincipals = privilegedServicePrincipalIds.map((id) => {
    const sp = servicePrincipalById.get(id);
    return { id, name: sp.displayName || sp.appId || id, appId: sp.appId || null, type: sp.servicePrincipalType || 'ServicePrincipal' };
  });

  const appActivityAvailable = activityResult.ok && appCredentials.ok;
  const appActivity = appActivityAvailable ? bucketAppActivity(ownApps, activityResult.data.value || []) : { buckets: null, inactiveApps: [], all: [] };

  // Toxic combinations: cross-reference signals already collected by AAD object id -
  // kept identical to the cross-reference in src/entraAuth.js getTenantSnapshot().
  const nameById = new Map();
  if (managerAvailable) for (const u of managerRecords.data.value || []) nameById.set(u.id, u.displayName || u.userPrincipalName);
  if (userActivityAvailable) for (const u of users) if (!nameById.has(u.id)) nameById.set(u.id, u.displayName || u.userPrincipalName);
  if (registrationAvailable) for (const u of registrationList) if (!nameById.has(u.id)) nameById.set(u.id, u.userDisplayName || u.userPrincipalName);
  for (const sp of servicePrincipalRecords) if (!nameById.has(sp.id)) nameById.set(sp.id, sp.displayName || sp.appId || sp.id);
  const azureRaw = await azureSubscriptionsPromise;
  const azureSubscriptions = {
    available: azureRaw.available,
    reason: azureRaw.reason,
    subscriptions: azureRaw.subscriptions,
    totalSubscriptions: azureRaw.available ? azureRaw.subscriptions.length : null,
    roleAssignments: azureRaw.available ? azureRaw.rawAssignments.map((ra) => ({ ...ra, principalName: nameById.get(ra.principalId) || ra.principalId })) : [],
    collectedAt,
  };
  const privilegedAccess = { available: roleAssignments.ok && roleEligibility.ok, activeCount: privilegedUsers, eligibleCount: roleEligibility.ok ? eligiblePrincipalIds.size : null, eligibleNotActive: eligibleNotActiveIds.map((id) => ({ id, name: nameById.get(id) || id })), activeNotEligible: activeNotEligibleIds.map((id) => ({ id, name: nameById.get(id) || id })), activeList: roleAssignments.ok ? [...privilegedPrincipalIds].map((id) => ({ id, name: nameById.get(id) || id })) : [], eligibleList: roleEligibility.ok ? [...eligiblePrincipalIds].map((id) => ({ id, name: nameById.get(id) || id })) : [] };
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
    if (flags.length) toxicCombinations.push({ id, name: nameById.get(id) || id, flags, nonHuman: servicePrincipalById.has(id) });
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
  const results = [org, appsCount, usersCount, groupsCount, devicesCount, signIns7d, riskySignIns7d, recentSignInsResult, riskyUsers, roleAssignments, conditionalAccess, subscribedSkus, appCredentials, activityResult, userActivity, managerRecords, deviceList, registration, servicePrincipalCount, managedIdentityCount, roleEligibility, legacyAuthCount, legacyAuthCount30d, groupRecordsResult, servicePrincipalList, signInLog];

  return {
    tenantId: tenant.id,
    displayName: tenant.displayName || orgValue?.displayName || tenant.id,
    organization: orgValue ? { id: orgValue.id, displayName: orgValue.displayName, verifiedDomains: orgValue.verifiedDomains || [] } : null,
    users: usersCountValue,
    applications: appsCount.ok ? appsCount.data['@odata.count'] : null,
    groups: groupsCount.ok ? groupsCount.data['@odata.count'] : null,
    groupsAvailable: groupRecordsAvailable,
    groupList,
    cloudOnlyGroups,
    onPremSyncGroups,
    dynamicGroups,
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
    conditionalAccessPolicyList: caPolicyList,
    mfaCoverageAllUsers,
    staleUsers,
    userActivityAvailable,
    userActivityList,
    usersWithoutManager,
    usersWithoutManagerList,
    privilegedAccess,
    guests,
    legacyAuth,
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
      privilegedCount: roleAssignments.ok && servicePrincipalList.ok ? privilegedServicePrincipals.length : null,
      privilegedList: privilegedServicePrincipals,
    },
    onboarding,
    usageAnalytics,
    azureSubscriptions,
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
      expiredSecrets: appCredentials.ok ? credentialItems.filter((i) => i.daysRemaining < 0 && i.type === 'secret').length : null,
      expiredCerts: appCredentials.ok ? credentialItems.filter((i) => i.daysRemaining < 0 && i.type === 'certificate').length : null,
    },
    permissionFailures: results.filter((r) => !r.ok).map((r) => String(r.error?.message || r.error)),
    collectedAt,
  };
}
