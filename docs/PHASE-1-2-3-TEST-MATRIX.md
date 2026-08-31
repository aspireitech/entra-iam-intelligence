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

**Expected:** no Contoso names, demo users, hard-coded dashboard numbers, or fabricated application names appear.

## Phase 2 — Security intelligence

| Scope | Graph operation | Dashboard validation |
|---|---|---|
| `IdentityRiskyUser.Read.All` | `/identityProtection/riskyUsers` | Risky-user count loads; otherwise UI says permission required |
| `RoleManagement.Read.Directory` | `/roleManagement/directory/roleAssignments` | Privileged principal count loads |
| `RoleManagement.Read.Directory` | `/roleManagement/directory/roleDefinitions` | Built-in privileged role definitions are resolved |
| `Policy.Read.All` | `/identity/conditionalAccess/policies` | Conditional Access policy count loads |

Security scopes are requested separately. A missing security permission must not prevent the core dashboard from loading.

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

### Other sources

Microsoft 365, ServiceNow and Splunk are represented in the source control plane but remain `Connector not configured` until their dedicated API connectors are implemented/configured. They are never presented as connected or populated with demo values.

## Manual acceptance test

1. Start the Vite app.
2. Sign in with a work/school Microsoft account.
3. Connect Microsoft Entra.
4. Confirm the tenant name is the real organization name, not `Contoso` or `Connected tenant`.
5. Confirm KPI values match the Entra admin center / Graph Explorer for the same tenant and time window.
6. Click Refresh and verify `Last refresh` changes and Graph values are re-queried.
7. Open Data Sources and confirm Entra is live while unconfigured sources are not shown as connected.
8. Click Sign out. Confirm the app returns to the Microsoft sign-in gate.
9. Sign in again with another authorized tenant and confirm the tenant name/data change.
10. Grant the optional security scopes and confirm risky users, privileged users and Conditional Access policy count populate.
11. Start the AD agent and configure `VITE_AD_AGENT_URL`; switch the source to Active Directory and verify domain/user/group/computer/DC counts match PowerShell.
12. Stop the AD agent; confirm the source changes to unavailable rather than showing stale/fake data.

## Security expectations

- No client secret or certificate is stored in the browser.
- The SPA client ID is public configuration.
- Access tokens stay in MSAL session storage.
- Dashboard operations are read-only.
- No write Graph permissions are requested by this implementation.
- AD agent is read-only and should be bound to localhost or protected with an enterprise HTTPS/reverse-proxy deployment when used remotely.
