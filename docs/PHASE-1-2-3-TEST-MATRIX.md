# IAM Intelligence Phase 1 / 2 / 3 Test Matrix

## Phase 1 — Live dashboard

| Scope | Graph operation | Dashboard validation |
|---|---|---|
| `User.Read` | Login + organization basic identity | Sign-in succeeds; tenant display name/ID appear |
| `User.Read.All` | `/users` + manager expansion | User count and stale/manager metrics load |
| `Application.Read.All` | `/applications` | Application count loads |
| `Group.Read.All` | `/groups` | Group count loads |
| `Device.Read.All` | `/devices` | Device count loads |
| `AuditLog.Read.All` | `/auditLogs/signIns` | 7-day count, recent activity and daily trend load |
| `AuditLog.Read.All` | `/reports/authenticationMethods/userRegistrationDetails` | MFA registered/missing counts load |
| `AuditLog.Read.All` | `/reports/servicePrincipalSignInActivities` (beta) | Application activity buckets / inactive-app list load when the report endpoint is available |
| `User.Read.All` | `/users?$expand=manager` | Stale enabled users and users without manager load |
| `Application.Read.All` | `/applications?$select=id,appId,displayName,keyCredentials,passwordCredentials` | Application Credential Expiry card populates; entries ≤30 days show as a Need Attention finding |

**Sign-in and dashboard landing:** after Microsoft sign-in, the dashboard opens automatically once silent token acquisition succeeds against existing consent — there is no separate "Connect Microsoft Entra" button to click. A short "Opening your dashboard…" screen is expected while this happens. Interactive consent only appears the first time a scope has never been granted for that tenant, or if consent was revoked.

**Auto-refresh:** while the Microsoft Entra source is active and the tab is visible, the dashboard re-queries Graph every `VITE_REFRESH_INTERVAL_SECONDS` (default 60s, minimum 30s) without user action. This does not collect data when no browser tab is open and signed in — see `docs/PERMISSIONS.md` for why continuous unattended collection needs a backend collector, not the current SPA-only architecture.

### Fixed: application-population mismatch (first real-tenant test finding)

`/reports/servicePrincipalSignInActivities` returns every service principal in
the directory, including hundreds of Microsoft first-party ones (Graph,
Exchange Online, Teams, ...) that were never part of "Total Applications".
Bucketing that unfiltered report against the smaller `/applications` count
produced bucket totals and percentages above 100% (observed: 364 of 11 =
3309%) and fed a corrupted `inactiveAppRate` into the Identity Health Score.
Fixed by matching the activity report to the tenant's own app registrations
by `appId` before bucketing (`src/entraAuth.js` `bucketAppActivity`) — bucket
totals now always sum to the real application count.

### Fixed: risk/health cards silently treating "unavailable" as "zero"

Identity Risk Overview rendered a green "100% not flagged" donut whenever
`riskyUsers` was `null` (permission/license unavailable), which is the exact
"BAD: Risky users = 0" pattern this product's core principle forbids. It now
renders an explicit "permission/license required" state instead, and reports
the real Graph error text via `riskyUsersReason`. The same pattern was
applied to the sign-in trend/KPIs (`signInsAvailable`/`signInsReason`) — a
tenant without an Entra ID P1/P2 license will see why sign-in data is
unavailable rather than a bare "No data" or a false zero.

### Added: Toxic Combinations and a Risk Register

New nav sections cross-reference signals already collected (by AAD object
id) into compound findings instead of five unrelated counts: a privileged
user who also lacks MFA, is flagged risky by ID Protection, or is stale
90+ days shows up as one row under **Toxic Combinations**, not scattered
across three separate cards. Every acknowledged Need Attention or Toxic
Combination finding now lands in a dedicated **Risk Register** page (still
`localStorage`-backed, not yet shared across users) instead of only being
visible transiently on the Overview page.

### Added: adjustable thresholds on Users and Applications detail pages

The Users page's stale-account table and the Applications page's
credential-expiry highlighting both have a selector (30/60/90/180 days for
staleness; 15/30/60/90 for credential expiry) computed client-side from data
already in the snapshot — no extra Graph calls. The Overview KPIs and Need
Attention counts always use the fixed thresholds (90 days stale, 30 days
credential expiry) for consistency; the detail-page selectors are for
investigation, not for changing what counts as "attention-worthy" tenant-wide.

### Added: per-metric drill-down navigation and Need Attention exceptions

KPI tiles, Need Attention rows, and card footers now navigate to a real
detail page (Users, Applications, Devices, Sign-ins, Risk Overview,
Conditional Access) built from data already collected in the snapshot,
instead of silently re-rendering Overview. Sidebar navigation is pruned per
data source — only sections with a real implementation for the active
source are shown. Need Attention rows can be acknowledged with a required
note (stored in browser `localStorage`, not synced/shared); acknowledged
items stay visible in a footer chip rather than disappearing, so nothing is
silently hidden.

**Expected:** no Contoso names, demo users, hard-coded dashboard numbers, or fabricated application names appear.

## Phase 2 — Security intelligence

| Scope | Graph operation | Dashboard validation |
|---|---|---|
| `IdentityRiskyUser.Read.All` | `/identityProtection/riskyUsers` | Risky-user count loads; otherwise UI says permission required |
| `RoleManagement.Read.Directory` | `/roleManagement/directory/roleAssignments` | Privileged principal count loads |
| `RoleManagement.Read.Directory` | `/roleManagement/directory/roleDefinitions` | Built-in privileged role definitions are resolved |
| `Policy.Read.All` | `/identity/conditionalAccess/policies` | Conditional Access policy count loads |

Security scopes are requested separately. A missing security permission must not prevent the core dashboard from loading.

## Phase 2 — Licensing

| Scope | Graph operation | Dashboard validation |
|---|---|---|
| `Organization.Read.All` | `/subscribedSkus` | License Inventory table populates with purchased/assigned/available per SKU |
| `User.Read.All` | `/users?$select=...,assignedLicenses,signInActivity` | Stale Licensed Accounts count and drill-down list populate |

The Licenses nav page is gated behind its own "Grant license permissions"
banner and is never populated with placeholder SKU data — a missing grant
shows the banner, not zeros.

## Phase 3 — Source switching

### Microsoft Entra ID

- Status must be `Connected • Live`.
- Dashboard data comes from Microsoft Graph.
- Sign-out clears the MSAL session.

### Active Directory

Run on a domain-joined Windows host:

```powershell
.\agent\IAM-AD-Agent.ps1 -AgentToken '<choose-a-long-random-token>'
```

Configure the SPA environment:

```text
VITE_AD_AGENT_URL=http://127.0.0.1:8765
VITE_AD_AGENT_TOKEN=<same-token>
```

The dashboard checks `/health` before selecting AD as an active live source. The AD snapshot exposes read-only counts for users, groups, computers, domain controllers, stale accounts/computers, users without managers, and privileged-group membership.

### All Identity Sources (Combined) — multi-tenant collector

Run the collector (see `collector/README.md`): certificate-authenticated,
app-only Graph access, no browser secret. Configure `VITE_COLLECTOR_URL`
(and `VITE_COLLECTOR_TOKEN` if the collector sets `collectorToken`).

- `/health` reports each configured tenant's certificate expiry
  (`certExpiresInDays`) — the dashboard's Collector Certificate Health card
  must flag anything ≤30 days.
- The combined view aggregates users/applications/groups/devices/risky
  users/privileged users/credential-expiry across every tenant the
  collector is configured for, plus a per-tenant breakdown table.
- If the collector is unreachable, the combined view shows an explicit
  "collector not reachable" message — never zeros or stale numbers
  presented as current.

### Other sources

SailPoint and Saviynt are represented in the source control plane but
remain `Connector not configured` until their dedicated connectors are
built (see `docs/PERMISSIONS.md` for the target permission model). They are
never presented as connected or populated with demo values.

## Manual acceptance test

1. Start the Vite app.
2. Sign in with a work/school Microsoft account.
3. Confirm the dashboard opens automatically after sign-in (no manual "Connect" click) once consent already exists for that tenant.
4. Confirm the tenant name is the real organization name, not `Contoso` or `Connected tenant`.
5. Confirm KPI values match the Entra admin center / Graph Explorer for the same tenant and time window.
6. Click Refresh and verify `Last refresh` changes and Graph values are re-queried. Then leave the tab open and idle; confirm `Last refresh` advances again on its own after `VITE_REFRESH_INTERVAL_SECONDS` (default 60s).
7. Click each source tab in the topbar (Microsoft Entra ID, Active Directory, etc.) and confirm the dashboard switches in one click, with unconfigured sources showing "not configured" rather than fake data.
8. Open Data Sources and confirm Entra is live while unconfigured sources are not shown as connected.
9. Open Licenses, grant the license permission when prompted, and confirm the SKU table, stale-licensed-account count, and recommendations reflect real `/subscribedSkus` and `/users` data.
10. Open Overview and confirm the Application Credential Expiry card lists real app registrations with a ≤30-day badge where applicable, matching the Entra admin center's certificates/secrets view for the same app.
11. Click the labeled "Sign out" button. Confirm the app returns to the Microsoft sign-in gate.
12. Sign in again with another authorized tenant and confirm the tenant name/data change.
13. Grant the optional security scopes and confirm risky users, privileged users and Conditional Access policy count populate.
14. Start the AD agent and configure `VITE_AD_AGENT_URL`; switch the source to Active Directory and verify domain/user/group/computer/DC counts match PowerShell.
15. Stop the AD agent; confirm the source changes to unavailable rather than showing stale/fake data.
16. Start the collector against at least two real tenants (each admin-consented per `collector/README.md`), configure `VITE_COLLECTOR_URL`, select "All Identity Sources" and confirm the combined KPIs equal the sum of the two tenants' individual Entra dashboard values, the per-tenant table matches each tenant, and Collector Certificate Health shows the real certificate's remaining days.
17. Stop the collector; confirm the combined view shows "collector not reachable" rather than the last cached numbers presented as current.

## Security expectations

- No client secret or certificate is stored in the browser.
- The SPA client ID is public configuration.
- Access tokens stay in MSAL session storage.
- Dashboard operations are read-only.
- No write Graph permissions are requested by this implementation.
- AD agent is read-only and should be bound to localhost or protected with an enterprise HTTPS/reverse-proxy deployment when used remotely.
