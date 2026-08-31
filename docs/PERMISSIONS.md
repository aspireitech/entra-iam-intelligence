# IAM Intelligence — Connector Permission Registry

This is the source of truth for what each connector reads, which permission
it needs, and why. Every dashboard feature must trace back to a row here.
Nothing in this table grants write/delete access — the monitoring MVP is
read-only across every connector.

Status legend: **Live** = implemented and querying real data today.
**Planned** = connector not built yet; permissions below are the documented
target, not something already requested or granted.

## Microsoft Entra ID — Live

Auth model: browser MSAL delegated auth (redirect flow, PKCE), no client
secret. Core scopes are requested at first sign-in; Security and License
scopes are requested separately, only when the operator opens a feature that
needs them (progressive consent — see `src/entraAuth.js`).

| Scope | Type | Consent | Purpose | Endpoint(s) | Dashboard feature |
|---|---|---|---|---|---|
| `User.Read` | Delegated | User | Sign in, identify operator | `/me` | Auth gate |
| `User.Read.All` | Delegated | Admin | User inventory, manager relationships, license assignment | `/users`, `/users?$expand=manager` | Total Users, Stale Enabled Users, Users Without Manager, License page |
| `Application.Read.All` | Delegated | Admin | App/service-principal inventory and credentials | `/applications`, `/reports/servicePrincipalSignInActivities` (beta) | Total Applications, Application Usage buckets, Application Credential Expiry |
| `Group.Read.All` | Delegated | Admin | Group inventory | `/groups` | Total Groups |
| `Device.Read.All` | Delegated | Admin | Device inventory | `/devices` | Active Devices |
| `AuditLog.Read.All` | Delegated | Admin | Sign-in/audit telemetry, MFA registration report | `/auditLogs/signIns`, `/reports/authenticationMethods/userRegistrationDetails` | Sign-ins (7D), Recent Activity, Sign-in trend, MFA gap count |
| `IdentityRiskyUser.Read.All` | Delegated | Admin | Requested separately | `/identityProtection/riskyUsers` | Risky Users, Identity Risk Overview |
| `RoleManagement.Read.Directory` | Delegated | Admin | Requested separately | `/roleManagement/directory/roleAssignments`, `/roleManagement/directory/roleDefinitions` | Privileged Users |
| `Policy.Read.All` | Delegated | Admin | Requested separately | `/identity/conditionalAccess/policies` | Conditional Access policy count |
| `Organization.Read.All` | Delegated | Admin | Requested separately, only when Licenses is opened | `/subscribedSkus`, `/organization` | License Inventory, tenant display name/ID |
| `ProvisioningLog.Read.All` | Delegated | Admin | Not requested until Provisioning feature ships | `/auditLogs/provisioning` | (not yet built) |

Never requested: `Directory.Read.All` or any `.ReadWrite` scope. See
`docs/ENTRA-APP-REGISTRATION.md` for app-registration setup.

### Microsoft Entra ID — application (app-only) permissions for the collector

Used only by the optional, unattended `collector/` service (certificate
auth, no browser involvement — see `collector/README.md`). Application
permissions always require admin consent, and on a multitenant app
registration **every connected tenant's own admin must grant it separately**.

| Permission | Purpose | Endpoint(s) |
|---|---|---|
| `User.Read.All` | User inventory, stale/manager signals, license assignment | `/users` |
| `Application.Read.All` | App/service-principal inventory and credential expiry | `/applications` |
| `Group.Read.All` | Group inventory | `/groups` |
| `Device.Read.All` | Device inventory | `/devices` |
| `AuditLog.Read.All` | Sign-in counts, MFA registration report | `/auditLogs/signIns`, `/reports/authenticationMethods/userRegistrationDetails` |
| `IdentityRiskyUser.Read.All` | Risky users | `/identityProtection/riskyUsers` |
| `RoleManagement.Read.Directory` | Privileged role assignments | `/roleManagement/directory/roleAssignments` |
| `Policy.Read.All` | Conditional Access policy count | `/identity/conditionalAccess/policies` |
| `Organization.Read.All` | Tenant identity, license SKUs | `/organization`, `/subscribedSkus` |

Never requested: any `.ReadWrite` application permission, `Directory.Read.All`,
or `Mail.Read`/`Files.Read.All`-class permissions unrelated to identity.

## Active Directory — Live (agent-based, not OAuth)

Auth model is different by necessity: a browser cannot reach an on-prem
domain controller. `agent/IAM-AD-Agent.ps1` runs on a domain-joined Windows
host and exposes a local, read-only HTTP API (`/health`, `/snapshot`) that
the SPA calls instead of Graph.

| Requirement | Type | Purpose |
|---|---|---|
| Domain-read rights for the account running the agent | AD ACL (not OAuth) | `Get-ADUser`/`Get-ADGroup`/`Get-ADComputer`/`Get-ADDomainController` — all default-readable by any authenticated domain account | 
| `X-IAM-Agent-Token` shared secret (`VITE_AD_AGENT_TOKEN`) | App-level bearer token | Authorizes the SPA to call the agent; not an AD permission |

**Do not run the agent as Domain Admin or any privileged-group member.** A
standard domain user account has sufficient read access for every field the
agent currently collects (`docs/PHASE-1-2-3-TEST-MATRIX.md` §Phase 3 lists
exactly what it returns). No password or credential retrieval is performed.

## Okta — Planned, not connected

| Scope (org auth server) | Type | Purpose |
|---|---|---|
| `okta.users.read` | OAuth2 / read-only API token | User inventory, status, MFA factors |
| `okta.groups.read` | OAuth2 / read-only API token | Group inventory and membership |
| `okta.apps.read` | OAuth2 / read-only API token | Application/SSO inventory |
| `okta.roles.read` | OAuth2 / read-only API token | Admin role assignments (privileged-user equivalent) |
| `okta.logs.read` | OAuth2 / read-only API token | System log / sign-in events |
| `okta.policies.read` | OAuth2 / read-only API token | Policy inventory (Conditional Access equivalent) |

Use a dedicated **Read-Only Administrator** role API token or an OAuth2
service app scoped to only the scopes above — never a Super Admin token.

## SailPoint (IdentityNow / Identity Security Cloud) — Planned, not connected

| Scope (representative — confirm against the tenant's exact API/ISC version before implementing) | Type | Purpose |
|---|---|---|
| `idn:identities:read` | OAuth2 client-credentials PAT | Identity inventory |
| `idn:access-profiles:read` | OAuth2 client-credentials PAT | Access profile inventory (governance context) |
| `idn:roles:read` | OAuth2 client-credentials PAT | Role model |
| `idn:entitlements:read` | OAuth2 client-credentials PAT | Entitlement catalog |
| `idn:sources:read` | OAuth2 client-credentials PAT | Connected source/application inventory |
| `idn:accounts:read` | OAuth2 client-credentials PAT | Account-to-identity correlation |

SailPoint scope names vary by API generation (IdentityNow vs. Identity
Security Cloud) — validate the exact scope strings against the target
tenant's API documentation before requesting consent; do not copy this list
into a client-credentials request without that check.

## Saviynt — Planned, not connected

*(Assuming "Saviant" in the request refers to Saviynt, the identity
governance vendor commonly compared with SailPoint — flag if a different
product was meant.)*

| Requirement | Type | Purpose |
|---|---|---|
| Read-only REST API service account scoped to identity/entitlement endpoints | OAuth2 / API token | Identity, role, and entitlement inventory |

Saviynt's permission model is role-based within its own admin console; the
concrete scope/role name must be confirmed against the customer's Saviynt
version before this connector is built.

## CyberArk — Planned, not connected

| Requirement | Type | Purpose |
|---|---|---|
| Dedicated PVWA API user with **Auditor**-level Safe permissions (List accounts, View Safe Members, View audit) | REST API (CyberArk-native or LDAP auth) | Privileged account/safe inventory |

**Never request "Retrieve password" permission.** IAM Intelligence never
needs to read a stored secret's value — only inventory/audit metadata.

## ServiceNow — Planned, not connected

| Requirement | Type | Purpose |
|---|---|---|
| OAuth2 inbound REST integration user with a custom read-only role scoped to specific tables (`sys_user`, `cmdb_ci`, `incident`) via ACL | OAuth2 | Business ownership / ticket context for identity findings |

Do not use an `admin` or unrestricted `itil` role; scope the role to the
tables above via ACL.

## Splunk — Planned, not connected

| Requirement | Type | Purpose |
|---|---|---|
| Read-only role restricted to the identity-relevant index/search | REST API token or HEC (read path) | Security event enrichment |

## Change process

Adding a new scope to any connector requires updating this file in the same
change: scope name, purpose, exact endpoint(s), delegated vs. application,
consent requirement, and which dashboard feature depends on it. A scope is
never "validated" just because it appears in code — see
`docs/PHASE-1-2-3-TEST-MATRIX.md` for the live-tenant verification steps.
